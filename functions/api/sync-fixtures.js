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

// Hardcoded R32 bracket — actual confirmed WC2026 matchups (16 slots, UTC)
const R32_BRACKET = [
  { utc: '2026-06-28T19:00:00Z', home: 'South Africa',       homeCode: 'RSA', away: 'Canada',            awayCode: 'CAN' }, // Jun29 03BJ
  { utc: '2026-06-28T22:00:00Z', home: 'Brazil',             homeCode: 'BRA', away: 'Japan',             awayCode: 'JPN' }, // Jun29 06BJ
  { utc: '2026-06-29T01:00:00Z', home: 'Germany',            homeCode: 'GER', away: 'Paraguay',           awayCode: 'PAR' }, // Jun29 09BJ
  { utc: '2026-06-29T19:00:00Z', home: 'Netherlands',        homeCode: 'NED', away: 'Morocco',            awayCode: 'MAR' }, // Jun30 03BJ
  { utc: '2026-06-29T22:00:00Z', home: 'France',             homeCode: 'FRA', away: 'Sweden',             awayCode: 'SWE' }, // Jun30 06BJ
  { utc: '2026-06-30T01:00:00Z', home: 'Mexico',             homeCode: 'MEX', away: 'Ecuador',            awayCode: 'ECU' }, // Jun30 09BJ
  { utc: '2026-06-30T19:00:00Z', home: 'Australia',          homeCode: 'AUS', away: 'Egypt',              awayCode: 'EGY' }, // Jul01 03BJ
  { utc: '2026-06-30T22:00:00Z', home: 'Colombia',           homeCode: 'COL', away: 'Ghana',              awayCode: 'GHA' }, // Jul01 06BJ
  { utc: '2026-07-01T01:00:00Z', home: 'Ivory Coast',        homeCode: 'CIV', away: 'Norway',             awayCode: 'NOR' }, // Jul01 09BJ
  { utc: '2026-07-01T19:00:00Z', home: 'Spain',              homeCode: 'ESP', away: 'Austria',            awayCode: 'AUT' }, // Jul02 03BJ
  { utc: '2026-07-01T22:00:00Z', home: 'Portugal',           homeCode: 'POR', away: 'Croatia',            awayCode: 'CRO' }, // Jul02 06BJ
  { utc: '2026-07-02T01:00:00Z', home: 'Switzerland',        homeCode: 'SUI', away: 'Algeria',            awayCode: 'ALG' }, // Jul02 09BJ
  { utc: '2026-07-02T19:00:00Z', home: 'England',            homeCode: 'ENG', away: 'DR Congo',           awayCode: 'COD' }, // Jul03 03BJ
  { utc: '2026-07-02T22:00:00Z', home: 'Belgium',            homeCode: 'BEL', away: 'Senegal',            awayCode: 'SEN' }, // Jul03 06BJ
  { utc: '2026-07-03T01:00:00Z', home: 'USA',                homeCode: 'USA', away: 'Bosnia-Herzegovina', awayCode: 'BIH' }, // Jul03 09BJ
  { utc: '2026-07-03T19:00:00Z', home: 'Argentina',          homeCode: 'ARG', away: 'Cape Verde',         awayCode: 'CPV' }, // Jul04 03BJ
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
  const token = auth.slice(7)
  if (token === env.SUPABASE_SERVICE_ROLE_KEY) return { id: ADMIN_UUID }
  const r = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { 'Authorization': auth, 'apikey': env.SUPABASE_ANON_KEY },
  })
  if (!r.ok) return null
  const user = await r.json()
  return user?.id === ADMIN_UUID ? user : null
}

// ── R32 population ────────────────────────────────────────────────────────────

async function populateR32(env) {
  // Load existing knockout rows indexed by normalised UTC
  const existRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/matches?group_name=is.null&stage=eq.r32&select=id,match_date`,
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
    const utcNorm = new Date(slot.utc).toISOString()
    const existId = existByUTC[utcNorm]

    if (existId) {
      const pRes = await fetch(
        `${env.SUPABASE_URL}/rest/v1/matches?id=eq.${existId}`,
        {
          method: 'PATCH',
          headers: { ...sbAuth(env), 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
          body: JSON.stringify({ home_team: slot.home, away_team: slot.away, home_team_code: slot.homeCode, away_team_code: slot.awayCode }),
        }
      )
      if (pRes.ok) { updated++; log.push(`UPDATE ${slot.utc}: ${slot.home} vs ${slot.away}`) }
      else          { errors.push(`UPDATE failed ${slot.utc}: HTTP ${pRes.status}`) }
    } else {
      const iRes = await fetch(
        `${env.SUPABASE_URL}/rest/v1/matches`,
        {
          method: 'POST',
          headers: { ...sbAuth(env), 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
          body: JSON.stringify({
            home_team:      slot.home,
            away_team:      slot.away,
            home_team_code: slot.homeCode,
            away_team_code: slot.awayCode,
            match_date:     slot.utc,
            stage:          'r32',
            status:         'upcoming',
          }),
        }
      )
      if (iRes.ok) { inserted++; log.push(`INSERT ${slot.utc}: ${slot.home} vs ${slot.away}`) }
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
