// CF Pages Function: GET /api/debug-football  (TEMPORARY, admin-only)
// Probes /fixtures/statistics to confirm whether xG ("Expected Goals") is in
// the response. Remove once xG availability is confirmed.

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
  return r.json().catch(() => null)
}

export async function onRequestGet(context) {
  const { request, env } = context
  if (!await verifyAdmin(request, env)) return new Response(JSON.stringify({ error: 'admin only' }), { status: 403, headers: CORS })

  const fixtureId = new URL(request.url).searchParams.get('fixture') || '1528284'
  const stats = await api(env, `/fixtures/statistics?fixture=${fixtureId}`)
  const types = (stats?.response || []).flatMap(t => (t.statistics || []).map(s => s.type))

  return new Response(JSON.stringify({
    fixture: fixtureId,
    stat_count: stats?.results,
    all_stat_types: [...new Set(types)],   // does "Expected Goals" appear?
    full_response: stats?.response || [],  // raw per-team statistics
  }, null, 2), { status: 200, headers: CORS })
}
