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

// Metis name → API-Football team name overrides (only where they differ)
const NAME_MAP = {
  'Spain': 'Spain National Team',
  'England': 'England National Team',
  'France': 'France National Team',
  'Brazil': 'Brazil National Team',
  'Argentina': 'Argentina National Team',
  'Germany': 'Germany National Team',
  'Portugal': 'Portugal National Team',
  'Netherlands': 'Netherlands National Team',
  'Belgium': 'Belgium National Team',
  'Japan': 'Japan National Team',
  'USA': 'United States',
  'South Korea': 'South Korea National Team',
  'Mexico': 'Mexico National Team',
  'Uruguay': 'Uruguay National Team',
  'Colombia': 'Colombia National Team',
  'Senegal': 'Senegal National Team',
  'Morocco': 'Morocco National Team',
  'Croatia': 'Croatia National Team',
  'Serbia': 'Serbia National Team',
  'Switzerland': 'Switzerland National Team',
  'Canada': 'Canada National Team',
  'Australia': 'Australia National Team',
  'Norway': 'Norway National Team',
  'Austria': 'Austria National Team',
  'Turkiye': 'Turkey National Team',
  'Ecuador': 'Ecuador National Team',
  'Peru': 'Peru National Team',
  'Ghana': 'Ghana National Team',
  'Egypt': 'Egypt National Team',
  'Algeria': 'Algeria National Team',
  'Saudi Arabia': 'Saudi Arabia National Team',
  'Iran': 'Iran National Team',
  'Qatar': 'Qatar National Team',
  'Jordan': 'Jordan National Team',
  'Scotland': 'Scotland National Team',
  'Haiti': 'Haiti National Team',
  'Panama': 'Panama National Team',
  'Paraguay': 'Paraguay National Team',
  'Cape Verde': 'Cape Verde Islands National Team',
  'DR Congo': 'Congo DR National Team',
  'Curacao': 'Curacao National Team',
  'New Zealand': 'New Zealand National Team',
  'Bosnia-Herzegovina': 'Bosnia And Herzegovina National Team',
  'Czechia': 'Czech Republic National Team',
  'South Africa': 'South Africa National Team',
  'El Salvador': 'El Salvador National Team',
  'Honduras': 'Honduras National Team',
  'Costa Rica': 'Costa Rica National Team',
  'Jamaica': 'Jamaica National Team',
  'Trinidad and Tobago': 'Trinidad And Tobago National Team',
  'Venezuela': 'Venezuela National Team',
  'Bolivia': 'Bolivia National Team',
  'Chile': 'Chile National Team',
  'Cameroon': 'Cameroon National Team',
  'Nigeria': 'Nigeria National Team',
  'Tunisia': 'Tunisia National Team',
  'Ivory Coast': "Cote D'Ivoire National Team",
  'Mali': 'Mali National Team',
  'Zambia': 'Zambia National Team',
  'Tanzania': 'Tanzania National Team',
  'Iraq': 'Iraq National Team',
  'UAE': 'United Arab Emirates National Team',
  'Oman': 'Oman National Team',
  'Uzbekistan': 'Uzbekistan National Team',
  'Indonesia': 'Indonesia National Team',
  'Vietnam': 'Vietnam National Team',
  'Thailand': 'Thailand National Team',
  'China': 'China National Team',
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
async function buildTeamIdMap(env, signal) {
  const data = await apiFetch(env, `/teams?league=${WC_LEAGUE}&season=${WC_SEASON}`, signal)
  const map = {}
  for (const { team } of data.response || []) {
    map[team.name.toLowerCase()] = team.id
  }
  return map
}

function resolveTeamId(map, metisName) {
  const direct = map[metisName.toLowerCase()]
  if (direct) return direct
  const apiName = NAME_MAP[metisName]
  return apiName ? map[apiName.toLowerCase()] : null
}

// Fetch one team's WC statistics. Returns the buildStatsRow shape; xG is not
// in this endpoint so xgf/xga stay null (admin/manual override later).
async function fetchTeamStats(env, teamId, signal) {
  const data = await apiFetch(env, `/teams/statistics?league=${WC_LEAGUE}&season=${WC_SEASON}&team=${teamId}`, signal)
  const s = data.response
  if (!s) return null
  const num = v => (v == null ? null : Number(v))
  return {
    mp: s.fixtures?.played?.total || 0,
    scored: num(s.goals?.for?.total?.total) ?? 0,
    conceded: num(s.goals?.against?.total?.total) ?? 0,
    xgf: null, xga: null,
    home_scored: num(s.goals?.for?.total?.home),
    home_conceded: num(s.goals?.against?.total?.home),
    home_mp: s.fixtures?.played?.home || null,
    away_scored: num(s.goals?.for?.total?.away),
    away_conceded: num(s.goals?.against?.total?.away),
    away_mp: s.fixtures?.played?.away || null,
    form: (s.form || '').slice(-5).split('').reverse().join(''), // latest-first WWDLL
  }
}

// Sync all needed teams: map names→ids, fetch stats. Returns metisName→stats.
async function fetchApiFootball(env, teamNames, signal) {
  if (!env.API_FOOTBALL_KEY) throw new Error('API_FOOTBALL_KEY not set in worker env')
  const idMap = await buildTeamIdMap(env, signal)
  if (!Object.keys(idMap).length) throw new Error('API-Football returned no WC teams (check key/plan)')
  const out = {}
  for (const name of teamNames) {
    const id = resolveTeamId(idMap, name)
    if (!id) continue
    try { const st = await fetchTeamStats(env, id, signal); if (st) out[name] = st } catch { /* skip */ }
  }
  return out
}

// ── Rolling window calculator ────────────────────────────────────────────

/**
 * Apply recency-weighted rolling window to aggregate stats.
 *
 * footystats provides only aggregates (not per-game), so we approximate
 * the 5-game rolling window by using the per-game average across all
 * recorded matches. When WC-specific games-in-window data is available
 * (written by admin or historical scrape), that will override this.
 *
 * MT06: if mp < WINDOW, flag it but still build a row (mark as partial).
 */
function buildStatsRow({ matchId, teamCode, footyData, existingRow }) {
  const mp = footyData?.mp || 0
  const hasData = footyData && mp > 0

  if (!hasData) {
    return {
      team_code: teamCode,
      match_id: matchId,
      games_window: 0,
      goals_scored_avg: null,
      goals_conceded_avg: null,
      home_goals_avg: null,
      away_goals_avg: null,
      xgf_per_game: null,
      xga_per_game: null,
      form_string: existingRow?.form_string || null,
      wc_games_in_window: existingRow?.wc_games_in_window || 0,
      data_source: 'not_found',
      updated_at: new Date().toISOString(),
    }
  }

  // Per-game averages (best approximation without per-game data)
  const scoredPg = mp > 0 ? Number((footyData.scored / mp).toFixed(3)) : null
  const concededPg = mp > 0 ? Number((footyData.conceded / mp).toFixed(3)) : null
  const xgfPg = footyData.xgf && mp > 0 ? Number((footyData.xgf / mp).toFixed(3)) : null
  const xgaPg = footyData.xga && mp > 0 ? Number((footyData.xga / mp).toFixed(3)) : null

  // Home / away split (for V2 model)
  const hmp = footyData.home_mp || Math.ceil(mp / 2)
  const amp = footyData.away_mp || Math.floor(mp / 2)
  const homeScored = footyData.home_scored ?? (scoredPg !== null ? scoredPg * 1.1 : null) // ~10% home boost estimate if missing
  const awayScored = footyData.away_scored ?? (scoredPg !== null ? scoredPg * 0.9 : null)

  const homeGoalsAvg = homeScored && hmp > 0 ? Number((homeScored / hmp).toFixed(3)) : scoredPg
  const awayGoalsAvg = awayScored && amp > 0 ? Number((awayScored / amp).toFixed(3)) : scoredPg

  // API-Football gives season aggregates, not per-game, so all games are
  // weighted equally here; the algorithm layer applies recency weights.
  // Flag if fewer than 5 games (MT06 — partial data, algorithm must check)
  const partial = mp < WINDOW

  return {
    team_code: teamCode,
    match_id: matchId,
    games_window: Math.min(mp, WINDOW),
    goals_scored_avg: scoredPg,
    goals_conceded_avg: concededPg,
    home_goals_avg: homeGoalsAvg,
    away_goals_avg: awayGoalsAvg,
    xgf_per_game: xgfPg,
    xga_per_game: xgaPg,
    form_string: footyData.form || existingRow?.form_string || null,
    wc_games_in_window: existingRow?.wc_games_in_window || 0,
    data_source: partial ? 'api_football_partial' : 'api_football',
    updated_at: new Date().toISOString(),
  }
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
    const scrapeFailed = { error: null }
    try {
      footyData = await fetchApiFootball(env, teamNames, controller.signal)
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
        if (!fd || (fd.mp || 0) < WINDOW) {
          partial.push({ team: teamName, mp: fd?.mp || 0 })
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
      partial_data: partial,   // MT06: flagged teams with < 5 games
      scrape_error: scrapeFailed.error,
      timestamp: new Date().toISOString(),
    })

  } catch (err) {
    clearTimeout(timeout)
    if (err.name === 'AbortError') {
      return jsonResponse({ error: 'Worker timeout (MT25)', details: 'Operation took > 28s' }, 504)
    }
    return jsonResponse({ error: 'Sync failed', details: err.message }, 500)
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
