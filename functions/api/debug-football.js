// CF Pages Function: GET /api/debug-football  (TEMPORARY, admin-only)
// Returns raw API-Football responses so we can find the correct WC league id.
// Remove once the league id is confirmed in sync-stats.js.

const ADMIN_UUID = '4a6e1f29-e18b-4fd3-9a7e-cec54501db54'
const API_BASE = 'https://v3.football.api-sports.io'
const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' }

export const onRequestOptions = () => new Response(null, { status: 204, headers: { ...CORS, 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type' } })

async function verifyAdmin(request, env) {
  const auth = request.headers.get('Authorization')
  if (!auth?.startsWith('Bearer ')) return null
  const r = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { 'Authorization': auth, 'apikey': env.SUPABASE_ANON_KEY } })
  if (!r.ok) return null
  const u = await r.json()
  return u?.id === ADMIN_UUID ? u : null
}

async function api(env, path) {
  const r = await fetch(`${API_BASE}${path}`, { headers: { 'x-apisports-key': env.API_FOOTBALL_KEY } })
  return { status: r.status, body: await r.json().catch(() => null) }
}

export async function onRequestGet(context) {
  const { request, env } = context
  if (!await verifyAdmin(request, env)) return new Response(JSON.stringify({ error: 'admin only' }), { status: 403, headers: CORS })

  const keyPresent = !!env.API_FOOTBALL_KEY
  const leagues = await api(env, '/leagues?name=World Cup&season=2026')
  const teamsL1 = await api(env, '/teams?league=1&season=2026')
  const out = {
    key_present: keyPresent,
    leagues_found: (leagues.body?.response || []).map(l => ({ id: l.league?.id, name: l.league?.name, type: l.league?.type, season: 2026 })),
    leagues_status: leagues.status,
    leagues_errors: leagues.body?.errors,
    teams_league1_status: teamsL1.status,
    teams_league1_count: teamsL1.body?.results,
    teams_league1_errors: teamsL1.body?.errors,
  }
  return new Response(JSON.stringify(out, null, 2), { status: 200, headers: CORS })
}
