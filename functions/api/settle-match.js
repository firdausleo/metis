// CF Pages Function: POST /api/settle-match
// Admin records final score → marks match finished → settles ALL pending bets
// across every user. Service role key bypasses RLS so one call settles the
// whole book instantly (MT05-compliant: server-side, never frontend).

const ADMIN_UUID = '4a6e1f29-e18b-4fd3-9a7e-cec54501db54'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Content-Type': 'application/json',
}
const res = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: CORS })
export const onRequestOptions = () => new Response(null, { status: 204, headers: CORS })

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

const sb = env => ({
  'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
  'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
  'Content-Type': 'application/json',
})

// 1X2 result for a selection vs final score.
function result1X2(selection, h, a) {
  const r = h > a ? 'home' : h < a ? 'away' : 'draw'
  return selection === r ? 'won' : 'lost'
}

export async function onRequestPost(context) {
  const { request, env } = context
  if (!await verifyAdmin(request, env)) return res({ error: 'Forbidden — admin only' }, 403)

  let body
  try { body = await request.json() } catch { return res({ error: 'Invalid JSON' }, 400) }
  const { match_id, home_score, away_score } = body
  if (!match_id || !Number.isInteger(home_score) || !Number.isInteger(away_score)) {
    return res({ error: 'match_id and integer home_score/away_score required' }, 400)
  }

  // Mark match finished with final score
  const mu = await fetch(`${env.SUPABASE_URL}/rest/v1/matches?id=eq.${match_id}`, {
    method: 'PATCH', headers: { ...sb(env), 'Prefer': 'return=minimal' },
    body: JSON.stringify({ home_score, away_score, status: 'finished', updated_at: new Date().toISOString() }),
  })
  if (!mu.ok) return res({ error: 'Match update failed', detail: await mu.text() }, 502)

  // Read all pending bets for this match (service role = all users)
  const br = await fetch(`${env.SUPABASE_URL}/rest/v1/bets?match_id=eq.${match_id}&status=eq.pending&select=*`, { headers: sb(env) })
  if (!br.ok) return res({ error: 'Bets fetch failed', detail: await br.text() }, 502)
  const pending = await br.json()

  // Settle each bet (1X2 only; other markets stay pending for manual review)
  let settled = 0
  for (const b of pending) {
    if (b.bet_type !== '1X2') continue
    const status = result1X2(b.selection, home_score, away_score)
    const pnl = status === 'won' ? b.stake * (b.odds - 1) : -b.stake
    const u = await fetch(`${env.SUPABASE_URL}/rest/v1/bets?id=eq.${b.id}`, {
      method: 'PATCH', headers: { ...sb(env), 'Prefer': 'return=minimal' },
      body: JSON.stringify({ status, pnl }),
    })
    if (u.ok) settled++
  }

  return res({ success: true, match_id, home_score, away_score, pending: pending.length, settled })
}
