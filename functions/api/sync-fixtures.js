/**
 * CF Pages Function: POST /api/sync-fixtures
 *
 * For "Round of 32": computes group standings from DB, resolves all 16 R32
 * slots from the hardcoded bracket map, then UPDATEs existing rows and INSERTs
 * the 3 missing Jun-28 rows. No API-Football dependency for R32.
 *
 * For all other rounds: fetches from API-Football and matches TBD rows by ±2 h.
 *
 * Auth: admin-only  |  Method: POST  |  Body: { round?: string }
 */

const ADMIN_UUID = '4a6e1f29-e18b-4fd3-9a7e-cec54501db54'
const API_BASE   = 'https://v3.football.api-sports.io'
const WC_LEAGUE  = 1
const WC_SEASON  = 2026

// Hardcoded R32 bracket — 16 slots in chronological order (UTC)
const R32_BRACKET = [
  { utc: '2026-06-28T19:00:00Z', home: '1A', away: '2B' }, // Mexico vs Canada
  { utc: '2026-06-28T22:00:00Z', home: '1C', away: '2D' }, // Brazil vs Australia
  { utc: '2026-06-29T01:00:00Z', home: '1E', away: '2F' }, // Germany vs Japan
  { utc: '2026-06-29T19:00:00Z', home: '1G', away: '2H' }, // Belgium vs Cape Verde
  { utc: '2026-06-29T22:00:00Z', home: '1I', away: '2J' }, // France vs Austria
  { utc: '2026-06-30T01:00:00Z', home: '1K', away: '2L' }, // Colombia vs Croatia
  { utc: '2026-06-30T19:00:00Z', home: '2A', away: '1B' }, // South Africa vs Switzerland
  { utc: '2026-06-30T22:00:00Z', home: '2C', away: '1D' }, // Morocco vs USA
  { utc: '2026-07-01T01:00:00Z', home: '2E', away: '1F' }, // Ivory Coast vs Netherlands
  { utc: '2026-07-01T19:00:00Z', home: '2G', away: '1H' }, // Egypt vs Spain
  { utc: '2026-07-01T22:00:00Z', home: '2I', away: '1J' }, // Norway vs Argentina
  { utc: '2026-07-02T01:00:00Z', home: '2K', away: '1L' }, // Portugal vs England
  { utc: '2026-07-02T19:00:00Z', home: '3B', away: '3F' }, // Bosnia-Herzegovina vs Sweden
  { utc: '2026-07-02T22:00:00Z', home: '3D', away: '3L' }, // Paraguay vs Ghana
  { utc: '2026-07-03T01:00:00Z', home: '3E', away: '3J' }, // Ecuador vs Algeria
  { utc: '2026-07-03T19:00:00Z', home: '3I', away: '3K' }, // Senegal vs DR Congo
]

const API_TO_METIS = {
  'United States':          'USA',
  'Turkey':                 'Turkiye',
  "Côte d'Ivoire":          'Ivory Coast',
  'Congo DR':               'DR Congo',
  'Czech Republic':         'Czechia',
  'Cabo Verde':             'Cape Verde',
  'Curaçao':                'Curacao',
  'Korea Republic':         'South Korea',
  'Bosnia and Herzegovina': 'Bosnia-Herzegovina',
}

function resolveMetisName(n) { return API_TO_METIS[n] ?? n }

function sbAuth(env) {
  return {
    'apikey':        env.SUPABASE_SERVICE_ROLE_KEY,
    'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
  }
}

const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' }
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS })
}

async function verifyAdmin(request, env) {
  const auth = request.headers.get('Authorization')
  if (!auth?.startsWith('Bearer ')) return null
  const r = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { 'Authorization': auth, 'apikey': env.SUPABASE_ANON_KEY },
  })
  if (!r.ok) return null
  const user = await r.json()
  return user?.id === ADMIN_UUID ? user : null
}

// ── Group standings ───────────────────────────────────────────────────────────

async function computeStandings(env) {
  const r = await fetch(
    `${env.SUPABASE_URL}/rest/v1/matches?group_name=not.is.null&status=eq.finished` +
    `&select=home_team,away_team,home_team_code,away_team_code,home_score,away_score,group_name`,
    { headers: sbAuth(env) }
  )
  if (!r.ok) throw new Error(`standings fetch HTTP ${r.status}`)
  const matches = await r.json()

  const groups = {}
  const codes  = {}

  for (const m of matches) {
    if (m.home_score == null || m.away_score == null) continue
    const g = m.group_name
    if (!groups[g]) groups[g] = {}
    codes[m.home_team] = m.home_team_code
    codes[m.away_team] = m.away_team_code

    const upd = (team, scored, conceded, pts) => {
      if (!groups[g][team]) groups[g][team] = { pts: 0, gd: 0, gf: 0 }
      groups[g][team].gf += scored
      groups[g][team].gd += scored - conceded
      groups[g][team].pts += pts
    }

    if (m.home_score > m.away_score) {
      upd(m.home_team, m.home_score, m.away_score, 3)
      upd(m.away_team, m.away_score, m.home_score, 0)
    } else if (m.away_score > m.home_score) {
      upd(m.home_team, m.home_score, m.away_score, 0)
      upd(m.away_team, m.away_score, m.home_score, 3)
    } else {
      upd(m.home_team, m.home_score, m.away_score, 1)
      upd(m.away_team, m.away_score, m.home_score, 1)
    }
  }

  const standings = {}
  for (const [g, teams] of Object.entries(groups)) {
    const sorted = Object.entries(teams)
      .sort(([, a], [, b]) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf)
      .map(([name]) => name)
    standings[g] = { w: sorted[0], r: sorted[1], third: sorted[2] }
  }

  return { standings, codes }
}

// Resolve bracket slot code ('1A', '2B', '3F', …) → team name
function resolveSlotCode(code, standings) {
  const rank  = code[0]
  const group = code.slice(1)
  const g     = standings[group]
  if (!g) return 'TBD'
  if (rank === '1') return g.w     || 'TBD'
  if (rank === '2') return g.r     || 'TBD'
  if (rank === '3') return g.third || 'TBD'
  return 'TBD'
}

// ── R32 population ────────────────────────────────────────────────────────────

async function populateR32(env) {
  const { standings, codes } = await computeStandings(env)

  // Load all existing knockout match rows indexed by normalised UTC
  const existRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/matches?group_name=is.null&select=id,match_date`,
    { headers: sbAuth(env) }
  )
  if (!existRes.ok) throw new Error('Failed to fetch knockout matches')
  const existRows = await existRes.json()

  const existByUTC = {}
  for (const m of existRows) {
    existByUTC[new Date(m.match_date).toISOString()] = m.id
  }

  let updated = 0, inserted = 0
  const errors = []
  const log    = []

  for (const slot of R32_BRACKET) {
    const utcNorm  = new Date(slot.utc).toISOString()
    const homeTeam = resolveSlotCode(slot.home, standings)
    const awayTeam = resolveSlotCode(slot.away, standings)
    const homeCode = codes[homeTeam] || homeTeam.slice(0, 3).toUpperCase()
    const awayCode = codes[awayTeam] || awayTeam.slice(0, 3).toUpperCase()

    const existId = existByUTC[utcNorm]

    if (existId) {
      const pRes = await fetch(
        `${env.SUPABASE_URL}/rest/v1/matches?id=eq.${existId}`,
        {
          method: 'PATCH',
          headers: { ...sbAuth(env), 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
          body: JSON.stringify({ home_team: homeTeam, away_team: awayTeam, home_team_code: homeCode, away_team_code: awayCode }),
        }
      )
      if (pRes.ok) { updated++; log.push(`UPDATE ${slot.utc}: ${homeTeam} vs ${awayTeam}`) }
      else          { errors.push(`UPDATE failed ${slot.utc}: HTTP ${pRes.status}`) }
    } else {
      const iRes = await fetch(
        `${env.SUPABASE_URL}/rest/v1/matches`,
        {
          method: 'POST',
          headers: { ...sbAuth(env), 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
          body: JSON.stringify({
            home_team:      homeTeam,
            away_team:      awayTeam,
            home_team_code: homeCode,
            away_team_code: awayCode,
            match_date:     slot.utc,
            stage:          'r32',
            status:         'upcoming',
          }),
        }
      )
      if (iRes.ok) { inserted++; log.push(`INSERT ${slot.utc}: ${homeTeam} vs ${awayTeam}`) }
      else          { const t = await iRes.text(); errors.push(`INSERT failed ${slot.utc}: ${t.slice(0, 100)}`) }
    }
  }

  return { updated, inserted, errors, log }
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function onRequestPost(context) {
  const { request, env } = context

  const controller = new AbortController()
  const timeout    = setTimeout(() => controller.abort(), 28_000)

  try {
    const user = await verifyAdmin(request, env)
    if (!user) return jsonResponse({ error: 'Admin access required' }, 403)

    let body = {}
    try { body = await request.json() } catch { /* empty body OK */ }
    const round = body.round || 'Round of 32'

    // R32: DB-driven bracket population — no API-Football needed
    if (round === 'Round of 32') {
      const result = await populateR32(env)
      clearTimeout(timeout)
      return jsonResponse({ ok: true, round, ...result })
    }

    // All other rounds: match TBD rows by time from API-Football
    const encoded = encodeURIComponent(round)
    const apiRes  = await fetch(
      `${API_BASE}/fixtures?league=${WC_LEAGUE}&season=${WC_SEASON}&round=${encoded}`,
      { signal: controller.signal, headers: { 'x-apisports-key': env.API_FOOTBALL_KEY } }
    )
    if (!apiRes.ok) {
      clearTimeout(timeout)
      return jsonResponse({ error: `API-Football HTTP ${apiRes.status}` }, 502)
    }
    const fixtures = (await apiRes.json()).response || []

    if (!fixtures.length) {
      clearTimeout(timeout)
      return jsonResponse({ ok: true, updated: 0, skipped: 0, errors: [], message: `No fixtures for: ${round}` })
    }

    const tbdRes = await fetch(
      `${env.SUPABASE_URL}/rest/v1/matches?home_team=eq.TBD&status=eq.upcoming&select=id,match_date`,
      { headers: sbAuth(env) }
    )
    if (!tbdRes.ok) {
      clearTimeout(timeout)
      return jsonResponse({ error: 'Failed to fetch TBD matches' }, 502)
    }
    const tbd      = (await tbdRes.json()).map(m => ({ id: m.id, epoch: new Date(m.match_date).getTime() }))
    const TWO_HOURS = 2 * 60 * 60 * 1000
    let updated = 0, skipped = 0
    const errors = []

    for (const f of fixtures) {
      const kickoffEpoch = new Date(f.fixture?.date).getTime()
      if (!kickoffEpoch) { errors.push(`No date for fixture ${f.fixture?.id}`); skipped++; continue }

      const apiHome = f.teams?.home?.name
      const apiAway = f.teams?.away?.name
      if (!apiHome || !apiAway) { skipped++; continue }
      if (['TBD', 'To Be Defined'].includes(apiHome) || ['TBD', 'To Be Defined'].includes(apiAway)) { skipped++; continue }

      const metisHome = resolveMetisName(apiHome)
      const metisAway = resolveMetisName(apiAway)
      const homeCode  = f.teams?.home?.code || metisHome.slice(0, 3).toUpperCase()
      const awayCode  = f.teams?.away?.code || metisAway.slice(0, 3).toUpperCase()
      const venue     = f.fixture?.venue?.name || 'TBD'

      const match = tbd.find(m => Math.abs(m.epoch - kickoffEpoch) <= TWO_HOURS)
      if (!match) { errors.push(`No TBD slot for ${metisHome} vs ${metisAway} at ${f.fixture?.date}`); skipped++; continue }

      const upd = await fetch(`${env.SUPABASE_URL}/rest/v1/matches?id=eq.${match.id}`, {
        method: 'PATCH',
        headers: { ...sbAuth(env), 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
        body: JSON.stringify({ home_team: metisHome, away_team: metisAway, home_team_code: homeCode, away_team_code: awayCode, venue }),
      })
      if (!upd.ok) { errors.push(`DB update failed for ${metisHome} vs ${metisAway}: HTTP ${upd.status}`); skipped++; continue }

      tbd.splice(tbd.indexOf(match), 1)
      updated++
    }

    clearTimeout(timeout)
    return jsonResponse({ ok: true, round, updated, skipped, errors })

  } catch (err) {
    clearTimeout(timeout)
    if (err.name === 'AbortError') return jsonResponse({ error: 'Timeout after 28 s' }, 504)
    return jsonResponse({ error: err.message }, 500)
  }
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: {
    ...CORS,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  }})
}
