// CF Pages Function: GET /api/debug-football  (TEMPORARY, admin-only)
// Probes API-Football fixtures for Mexico to inspect goals/xG structure.
// Remove after the sync fix is confirmed.

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

  // Find Mexico's team id
  const teams = await api(env, `/teams?league=1&season=2026`)
  const mexico = (teams?.response || []).find(t => t.team?.name?.toLowerCase() === 'mexico')
  const id = mexico?.team?.id

  const last10 = id ? await api(env, `/fixtures?team=${id}&last=10`) : null
  const wc5 = id ? await api(env, `/fixtures?team=${id}&last=5&league=1&season=2026`) : null

  return new Response(JSON.stringify({
    mexico_id: id,
    last10_count: last10?.results,
    last10_first2: (last10?.response || []).slice(0, 2),       // raw structure: goals, teams.winner, etc
    wc5_count: wc5?.results,
    wc5_first2: (wc5?.response || []).slice(0, 2),
  }, null, 2), { status: 200, headers: CORS })
}
