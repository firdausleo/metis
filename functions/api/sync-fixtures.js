/**
 * CF Pages Function: POST /api/sync-fixtures
 *
 * Fetches knockout fixture assignments from API-Football and updates TBD rows
 * in the matches table with real team names, codes, and venue.
 *
 * Auth: admin-only
 * Method: POST
 * Body: { round?: string }   — default "Round of 32"
 *
 * Supported round values (API-Football strings):
 *   "Round of 32"   "Round of 16"   "Quarter-finals"
 *   "Semi-finals"   "3rd Place Final"   "Final"
 *
 * Match strategy: find the TBD row whose match_date falls within ±2 h of the
 * API fixture kickoff. Update home_team, away_team, home_team_code,
 * away_team_code, venue. group_name is left null (knockout has none).
 */

const ADMIN_UUID = '4a6e1f29-e18b-4fd3-9a7e-cec54501db54'
const API_BASE   = 'https://v3.football.api-sports.io'
const WC_LEAGUE  = 1
const WC_SEASON  = 2026

// API-Football team name → Metis team name (reverse of sync-stats NAME_MAP)
const API_TO_METIS = {
  'United States':         'USA',
  'Turkey':                'Turkiye',
  "Côte d'Ivoire":         'Ivory Coast',
  'Congo DR':              'DR Congo',
  'Czech Republic':        'Czechia',
  'Cabo Verde':            'Cape Verde',
  'Curaçao':               'Curacao',
  'Korea Republic':        'South Korea',
  'Bosnia and Herzegovina':'Bosnia-Herzegovina',
}

function resolveMetisName(apiName) {
  return API_TO_METIS[apiName] ?? apiName
}

// ── Auth ──────────────────────────────────────────────────────────────────

async function verifyAdmin(request, env) {
  const authHeader = request.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return null
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { 'Authorization': authHeader, 'apikey': env.SUPABASE_ANON_KEY },
  })
  if (!res.ok) return null
  const user = await res.json()
  return user?.id === ADMIN_UUID ? user : null
}

// ── Supabase helpers ──────────────────────────────────────────────────────

function sbAuth(env) {
  return {
    'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
    'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
  }
}

// ── CORS / response ───────────────────────────────────────────────────────

const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' }
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS })
}

// ── Main handler ──────────────────────────────────────────────────────────

export async function onRequestPost(context) {
  const { request, env } = context

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 28_000)

  try {
    const user = await verifyAdmin(request, env)
    if (!user) return jsonResponse({ error: 'Admin access required' }, 403)

    let body = {}
    try { body = await request.json() } catch { /* empty body OK */ }
    const round = body.round || 'Round of 32'

    // 1. Fetch fixtures from API-Football
    const encoded = encodeURIComponent(round)
    const apiRes = await fetch(
      `${API_BASE}/fixtures?league=${WC_LEAGUE}&season=${WC_SEASON}&round=${encoded}`,
      { signal: controller.signal, headers: { 'x-apisports-key': env.API_FOOTBALL_KEY } }
    )
    if (!apiRes.ok) {
      clearTimeout(timeout)
      return jsonResponse({ error: `API-Football HTTP ${apiRes.status}` }, 502)
    }
    const apiData = await apiRes.json()
    const fixtures = apiData.response || []

    if (!fixtures.length) {
      clearTimeout(timeout)
      return jsonResponse({ ok: true, updated: 0, skipped: 0, errors: [], message: `No fixtures found for round: ${round}` })
    }

    // 2. Fetch all current TBD matches
    const tbdRes = await fetch(
      `${env.SUPABASE_URL}/rest/v1/matches?home_team=eq.TBD&status=eq.upcoming&select=id,match_date`,
      { headers: sbAuth(env) }
    )
    if (!tbdRes.ok) {
      clearTimeout(timeout)
      return jsonResponse({ error: 'Failed to fetch TBD matches from DB' }, 502)
    }
    const tbdMatches = await tbdRes.json()

    // Build time-indexed lookup: for each TBD match, store its epoch
    const tbd = tbdMatches.map(m => ({ id: m.id, epoch: new Date(m.match_date).getTime() }))
    const TWO_HOURS = 2 * 60 * 60 * 1000

    let updated = 0
    let skipped = 0
    const errors = []

    // 3. Process each API fixture
    for (const f of fixtures) {
      const kickoffEpoch = new Date(f.fixture?.date).getTime()
      if (!kickoffEpoch) {
        errors.push(`No date for fixture ${f.fixture?.id}`)
        skipped++
        continue
      }

      const apiHomeName = f.teams?.home?.name
      const apiAwayName = f.teams?.away?.name
      if (!apiHomeName || !apiAwayName) {
        skipped++
        continue
      }

      // Skip if teams are still TBD on the API side
      if (apiHomeName === 'TBD' || apiAwayName === 'TBD' ||
          apiHomeName === 'To Be Defined' || apiAwayName === 'To Be Defined') {
        skipped++
        continue
      }

      const metisHome = resolveMetisName(apiHomeName)
      const metisAway = resolveMetisName(apiAwayName)
      const homeCode  = f.teams?.home?.code || metisHome.slice(0, 3).toUpperCase()
      const awayCode  = f.teams?.away?.code || metisAway.slice(0, 3).toUpperCase()
      const venue     = f.fixture?.venue?.name || 'TBD'

      // Find the TBD match closest in time (within ±2 h)
      const match = tbd.find(m => Math.abs(m.epoch - kickoffEpoch) <= TWO_HOURS)
      if (!match) {
        errors.push(`No TBD slot found for ${metisHome} vs ${metisAway} at ${f.fixture?.date}`)
        skipped++
        continue
      }

      // Update the match row
      const updateRes = await fetch(
        `${env.SUPABASE_URL}/rest/v1/matches?id=eq.${match.id}`,
        {
          method: 'PATCH',
          headers: { ...sbAuth(env), 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
          body: JSON.stringify({
            home_team:      metisHome,
            away_team:      metisAway,
            home_team_code: homeCode,
            away_team_code: awayCode,
            venue,
          }),
        }
      )

      if (!updateRes.ok) {
        const text = await updateRes.text()
        errors.push(`DB update failed for ${metisHome} vs ${metisAway}: ${text}`)
        skipped++
        continue
      }

      // Remove from tbd pool so it can't be claimed twice
      const idx = tbd.indexOf(match)
      tbd.splice(idx, 1)
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
  return new Response(null, { status: 204, headers: { ...CORS, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' } })
}
