/**
 * CF Pages Function: POST /api/sync-stats
 *
 * Bulk-syncs team stats from API-Football (league=1, season=2026) into the
 * team_stats table. Called by admin to populate stats for all upcoming matches.
 *
 * Auth: admin-only (verified via Supabase service role)
 * Method: POST
 * Body: { match_ids?: string[] }   — optional; if omitted, syncs all upcoming
 *
 * MT25: 30-second timeout — fails fast with structured JSON error
 * MT06: 5-game rolling window — rejects teams with < 5 games (flags, does not abort)
 * MT10: service role key from CF secrets only
 *
 * Rolling window stats written to team_stats:
 *   goals_scored_avg    — recency-weighted (weights [0.10,0.15,0.20,0.25,0.30])
 *   goals_conceded_avg  — recency-weighted
 *   home_goals_avg      — home games only (for V2 model)
 *   away_goals_avg      — away games only (for V2 model)
 *   form_string         — "WWDLL" latest-first (5 results)
 *   games_window        — always 5 (MT06)
 *   xgf_per_game        — overall xG for / match
 *   xga_per_game        — overall xG against / match
 */

const ADMIN_UUID = '4a6e1f29-e18b-4fd3-9a7e-cec54501db54'

const WINDOW = 5
const MIN_COMPETITIVE = 3   // include friendlies only if fewer than this many competitive games
// Recency weights oldest→newest, sum = 1.0 (MT06)
const RECENCY_WEIGHTS = [0.10, 0.15, 0.20, 0.25, 0.30]

// Metis name → API-Football team name overrides (only where they differ)
// API-Football returns plain names ("Mexico", "South Africa"). Only map the
// few that genuinely differ from our match team strings; everything else
// resolves by direct (normalized) match.
const NAME_MAP = {
  'USA': 'United States',
  'Turkiye': 'Turkey',
  'Ivory Coast': "Cote d'Ivoire",
  'DR Congo': 'Congo DR',
  'Czechia': 'Czech Republic',
}

// ── Auth ──────────────────────────────────────────────────────────────────

async function verifyAdmin(request, env) {
  const authHeader = request.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return null

  const response = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      'Authorization': authHeader,
      'apikey': env.SUPABASE_ANON_KEY,
    },
  })
  if (!response.ok) return null
  const user = await response.json()
  if (user?.id !== ADMIN_UUID) return null
  return user
}

// ── API-Football integration ───────────────────────────────────────────────
// league=1 (World Cup), season=2026. Auth via x-apisports-key (CF secret).

const API_BASE   = 'https://v3.football.api-sports.io'
const WC_LEAGUE  = 1
const WC_SEASON  = 2026
const FRIENDLY_LEAGUE = 10   // exclude friendlies from rolling window

async function apiFetch(env, path, signal) {
  const res = await fetch(`${API_BASE}${path}`, {
    signal,
    headers: { 'x-apisports-key': env.API_FOOTBALL_KEY },
  })
  if (!res.ok) throw new Error(`API-Football HTTP ${res.status}`)
  return res.json()
}

// Build 48-team name → team_id map from the WC team list. Keyed by lowercase
// name; also indexed by Metis name so our team strings resolve.
// Normalize for matching: lowercase, strip accents, drop "national team", trim.
function norm(name) {
  return (name || '').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/national team/g, '').replace(/[^a-z]/g, '').trim()
}

async function buildTeamIdMap(env, signal) {
  const data = await apiFetch(env, `/teams?league=${WC_LEAGUE}&season=${WC_SEASON}`, signal)
  const map = {}
  for (const { team } of data.response || []) {
    map[norm(team.name)] = team.id
  }
  return map
}

function resolveTeamId(map, metisName) {
  return map[norm(metisName)] ?? map[norm(NAME_MAP[metisName])] ?? null
}

// Build the 5-game rolling window from the team's last 10 fixtures (all
// competitions). Returns a ready-to-store stats fragment, or null if no games.
async function fetchTeamStats(env, teamId, signal) {
  const data = await apiFetch(env, `/fixtures?team=${teamId}&last=20`, signal)
  const finished = (data.response || []).filter(f => f.fixture?.status?.short === 'FT')
  if (!finished.length) return null

  // Prefer competitive games (exclude friendlies = league.id 10); fall back to
  // all finished only if fewer than 3 competitive available.
  const competitive = finished.filter(f => f.league?.id !== FRIENDLY_LEAGUE)
  const pool = competitive.length >= MIN_COMPETITIVE ? competitive : finished

  // Sort by date descending — API order is not guaranteed, so anchor on
  // fixture.date for a correct 5-most-recent window + form string.
  const fixtures = [...pool].sort((a, b) => new Date(b.fixture?.date) - new Date(a.fixture?.date))

  // 5 most recent, then chrono oldest→newest for recency weighting.
  const recent = fixtures.slice(0, WINDOW)
  const chrono = [...recent].reverse()
  const n = chrono.length

  const games = []
  const recentMeta = []  // parallel: raw fixture fields for recent_fixtures column
  for (const f of chrono) {
    const isHome = f.teams.home.id === teamId
    const scored = isHome ? f.goals.home : f.goals.away
    const conceded = isHome ? f.goals.away : f.goals.home
    // Result from winner flags (both null = draw); goals as fallback.
    const won = isHome ? f.teams.home.winner : f.teams.away.winner
    const lost = isHome ? f.teams.away.winner : f.teams.home.winner
    const result = won === true ? 'W' : lost === true ? 'L'
      : won == null && lost == null ? (scored > conceded ? 'W' : scored < conceded ? 'L' : 'D') : 'D'
    games.push({ fixtureId: f.fixture.id, isHome, scored, conceded, result, wc: f.league?.id === WC_LEAGUE })
    recentMeta.push({
      date: (f.fixture.date || '').slice(0, 10),
      opponent: isHome ? f.teams.away.name : f.teams.home.name,
      competition: f.league?.name || '',
      home_away: isHome ? 'H' : 'A',
    })
  }

  // xG per game (cached forever — finished fixtures don't change). Average only
  // non-null values. API-Football's plan returns null xG for international comps
  // (WC/Gold Cup/AFCON) — expected, model uses goals not xG (MT06).
  const xgPairs = await Promise.all(games.map(g => getFixtureXg(env, g.fixtureId, teamId, signal)))
  const xgf = xgPairs.map(p => p?.xgf).filter(v => v != null)
  const xga = xgPairs.map(p => p?.xga).filter(v => v != null)
  const avg = a => a.length ? a.reduce((s, v) => s + v, 0) / a.length : null

  // Recency weights only when exactly 5; otherwise simple average.
  const wAvg = arr => n === WINDOW
    ? arr.reduce((s, v, i) => s + v * RECENCY_WEIGHTS[i], 0)
    : arr.reduce((s, v) => s + v, 0) / n
  const r3 = x => x == null ? null : Number(x.toFixed(3))

  const homeGames = games.filter(g => g.isHome)
  const awayGames = games.filter(g => !g.isHome)
  const simpleAvg = gs => gs.length ? gs.reduce((s, g) => s + g.scored, 0) / gs.length : null

  // Build recent_fixtures array (newest first) for Stats tab transparency.
  // Weights: [0.30, 0.25, 0.20, 0.15, 0.10] newest→oldest (RECENCY_WEIGHTS reversed).
  // null weight for partial windows where simple average is used instead.
  const recent_fixtures = games.map((g, i) => ({
    fixture_id: g.fixtureId,
    date: recentMeta[i].date,
    opponent: recentMeta[i].opponent,
    competition: recentMeta[i].competition,
    home_away: recentMeta[i].home_away,
    score_for: g.scored,
    score_against: g.conceded,
    result: g.result,
    xgf: xgPairs[i]?.xgf ?? null,
    xga: xgPairs[i]?.xga ?? null,
    weight: n === WINDOW ? RECENCY_WEIGHTS[i] : null,
  })).reverse()

  return {
    games_window: n,
    goals_scored_avg: r3(wAvg(games.map(g => g.scored))),
    goals_conceded_avg: r3(wAvg(games.map(g => g.conceded))),
    home_goals_avg: homeGames.length ? r3(simpleAvg(homeGames)) : null,
    away_goals_avg: awayGames.length ? r3(simpleAvg(awayGames)) : null,
    form_string: games.map(g => g.result).reverse().join(''), // newest first
    wc_games_in_window: games.filter(g => g.wc).length,
    xgf: r3(avg(xgf)), xga: r3(avg(xga)),
    recent_fixtures,
  }
}

// xG for/against for one team in one fixture, cached in fixture_stats forever.
async function getFixtureXg(env, fixtureId, teamId, signal) {
  try {
    const cached = await readXgCache(env, fixtureId, teamId)
    if (cached) return cached
    const data = await apiFetch(env, `/fixtures/statistics?fixture=${fixtureId}`, signal)
    const teams = data.response || []
    const get = side => Number(side?.statistics?.find(s => s.type === 'expected_goals')?.value) || null
    const mine = teams.find(t => t.team?.id === teamId)
    const opp = teams.find(t => t.team?.id !== teamId)
    const pair = { xgf: get(mine), xga: get(opp) }
    await writeXgCache(env, fixtureId, teamId, pair)
    return pair
  } catch {
    return { xgf: null, xga: null }   // xG is optional — never fail the whole sync
  }
}

// Sync all needed teams: map names→ids, fetch stats. Returns metisName→stats.
async function fetchApiFootball(env, teamNames, signal) {
  if (!env.API_FOOTBALL_KEY) throw new Error('API_FOOTBALL_KEY not set in worker env')
  const idMap = await buildTeamIdMap(env, signal)
  if (!Object.keys(idMap).length) throw new Error('API-Football returned no WC teams (check key/plan)')
  const out = {}
  const unresolved = []
  for (const name of teamNames) {
    const id = resolveTeamId(idMap, name)
    if (!id) { unresolved.push(name); continue }
    // Record the team even if stats are empty (pre-tournament: 0 fixtures) so
    // it still maps; rolling-window guard handles partial data downstream.
    let st = null
    try { st = await fetchTeamStats(env, id, signal) } catch { /* keep null */ }
    out[name] = st || { games_window: 0 }
  }
  if (unresolved.length) out.__unresolved = unresolved
  return out
}

// ── Stats row builder ──────────────────────────────────────────────────────
// fetchTeamStats already computed the 5-game rolling window; map it to a
// team_stats row. No window → empty row (algorithm guards on games_window).
function buildStatsRow({ matchId, teamCode, footyData, existingRow }) {
  const w = footyData?.games_window ? footyData : null
  if (!w) {
    return {
      team_code: teamCode, match_id: matchId, games_window: 0,
      goals_scored_avg: null, goals_conceded_avg: null,
      home_goals_avg: null, away_goals_avg: null, xgf_per_game: null, xga_per_game: null,
      form_string: existingRow?.form_string || null,
      wc_games_in_window: existingRow?.wc_games_in_window || 0,
      recent_fixtures: null,
      data_source: 'not_found', updated_at: new Date().toISOString(),
    }
  }
  return {
    team_code: teamCode, match_id: matchId,
    games_window: w.games_window,
    goals_scored_avg: w.goals_scored_avg,
    goals_conceded_avg: w.goals_conceded_avg,
    home_goals_avg: w.home_goals_avg,
    away_goals_avg: w.away_goals_avg,
    xgf_per_game: w.xgf, xga_per_game: w.xga,
    form_string: w.form_string,
    wc_games_in_window: w.wc_games_in_window,
    recent_fixtures: w.recent_fixtures || null,
    data_source: w.games_window < WINDOW ? 'api_football_partial' : 'api_football',
    updated_at: new Date().toISOString(),
  }
}

// ── xG cache (fixture_stats) ───────────────────────────────────────────────

function sbAuth(env) {
  return { 'apikey': env.SUPABASE_SERVICE_ROLE_KEY, 'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` }
}

async function readXgCache(env, fixtureId, teamId) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/fixture_stats?fixture_id=eq.${fixtureId}&team_id=eq.${teamId}&select=xgf,xga&limit=1`, { headers: sbAuth(env) })
  if (!res.ok) return null
  const rows = await res.json()
  return rows.length ? { xgf: rows[0].xgf, xga: rows[0].xga } : null
}

async function writeXgCache(env, fixtureId, teamId, { xgf, xga }) {
  await fetch(`${env.SUPABASE_URL}/rest/v1/fixture_stats`, {
    method: 'POST',
    headers: { ...sbAuth(env), 'Content-Type': 'application/json', 'Prefer': 'resolution=merge-duplicates' },
    body: JSON.stringify({ fixture_id: fixtureId, team_id: teamId, xgf, xga }),
  }).catch(() => {})
}

// ── Supabase helpers ─────────────────────────────────────────────────────

async function getUpcomingMatches(env, matchIds) {
  let url = `${env.SUPABASE_URL}/rest/v1/matches?select=id,home_team,away_team,home_team_code,away_team_code,status`

  if (matchIds?.length) {
    url += `&id=in.(${matchIds.join(',')})`
  } else {
    url += '&status=eq.upcoming&home_team=neq.TBD&away_team=neq.TBD'
  }

  const res = await fetch(url, {
    headers: {
      'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
  })
  if (!res.ok) throw new Error(`Supabase matches fetch failed: ${res.status}`)
  return res.json()
}

async function getExistingStats(env, matchIds) {
  const url = `${env.SUPABASE_URL}/rest/v1/team_stats?match_id=in.(${matchIds.join(',')})&select=team_code,match_id,form_string,wc_games_in_window`

  const res = await fetch(url, {
    headers: {
      'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
  })
  if (!res.ok) return []
  return res.json()
}

async function upsertStats(env, rows) {
  const url = `${env.SUPABASE_URL}/rest/v1/team_stats?on_conflict=team_code,match_id`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates',
    },
    body: JSON.stringify(rows),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Supabase upsert failed: ${res.status} — ${text}`)
  }
}

// ── CORS ─────────────────────────────────────────────────────────────────

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS })
}

// ── Main handler ─────────────────────────────────────────────────────────

export async function onRequestPost(context) {
  const { request, env } = context

  // MT25: 30-second timeout
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 28_000)

  try {
    // Admin-only
    const user = await verifyAdmin(request, env)
    if (!user) {
      return jsonResponse({ error: 'Admin access required' }, 403)
    }

    // Parse body
    let body = {}
    try { body = await request.json() } catch { /* empty body OK */ }
    const { match_ids } = body

    // 1. Fetch upcoming matches from Supabase
    const matches = await getUpcomingMatches(env, match_ids)
    if (!matches.length) {
      return jsonResponse({ ok: true, message: 'No upcoming matches found', synced: 0, skipped: [] })
    }

    // 2. Get existing stats rows (to preserve form_string + wc_games_in_window)
    const matchIds = matches.map(m => m.id)
    const existing = await getExistingStats(env, matchIds)
    const existingMap = {}
    for (const row of existing) {
      existingMap[`${row.match_id}:${row.team_code}`] = row
    }

    // 3. Collect unique team names, fetch from API-Football
    const teamNames = [...new Set(matches.flatMap(m => [m.home_team, m.away_team]))]
    let footyData = {}
    let unresolved = []
    const scrapeFailed = { error: null }
    try {
      footyData = await fetchApiFootball(env, teamNames, controller.signal)
      unresolved = footyData.__unresolved || []
      delete footyData.__unresolved
    } catch (err) {
      scrapeFailed.error = err.message
      // Continue — rows will be built with null stats
    }

    // 5. Build rows for each team × match
    const rows = []
    const partial = []

    for (const m of matches) {
      for (const [code, teamName] of [[m.home_team_code, m.home_team], [m.away_team_code, m.away_team]]) {
        const fd = footyData[teamName] || null
        const existingRow = existingMap[`${m.id}:${code}`] || null
        const row = buildStatsRow({ matchId: m.id, teamCode: code, footyData: fd, existingRow })
        rows.push(row)
        if (!fd || (fd.games_window || 0) < WINDOW) {
          partial.push({ team: teamName, games: fd?.games_window || 0 })
        }
      }
    }

    // 6. Upsert to Supabase
    if (rows.length) {
      await upsertStats(env, rows)
    }

    clearTimeout(timeout)
    return jsonResponse({
      ok: true,
      synced: rows.length,
      matches_processed: matches.length,
      teams_found: Object.keys(footyData).length,
      unresolved,               // names that didn't map to an API team
      partial_data: partial,   // MT06: flagged teams with < 5 games
      scrape_error: scrapeFailed.error,
      timestamp: new Date().toISOString(),
    })

  } catch (err) {
    clearTimeout(timeout)
    if (err.name === 'AbortError') {
      return jsonResponse({
        ok: false,
        error: 'Worker timeout',
        details: 'Sync took > 28s — reduce batch size or try individual matches',
        matches_processed: 0,
        synced: 0,
      })
    }
    // Never let the Worker return 500 — always structured JSON so the client
    // can display a useful message instead of a generic network error.
    return jsonResponse({
      ok: false,
      error: err.message || 'Sync failed',
      details: err.stack?.split('\n')[0] || null,
      matches_processed: 0,
      synced: 0,
    })
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    },
  })
}
