/**
 * CF Pages Function: POST /api/learning-loop
 *
 * Role 11 — Learning Loop. Post-settlement calibration (MT03: Claude only here).
 * Aggregates role_accuracy per role, asks Sonnet to spot systematic bias, and
 * writes a confidence multiplier (0.50–1.50) + notes to role_calibration.
 * Admin-only. Idempotent — upserts one row per role each run.
 */

const ADMIN_UUID    = '4a6e1f29-e18b-4fd3-9a7e-cec54501db54'
const SONNET_MODEL  = 'claude-sonnet-4-6'
const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VER = '2023-06-01'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Content-Type': 'application/json',
}
const res = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: CORS })
export const onRequestOptions = () => new Response(null, { status: 204, headers: CORS })

const sb = env => ({
  'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
  'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
  'Content-Type': 'application/json',
})

async function verifyAdmin(request, env) {
  const auth = request.headers.get('Authorization')
  if (!auth?.startsWith('Bearer ')) return null
  const r = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { 'Authorization': auth, 'apikey': env.SUPABASE_ANON_KEY },
  })
  if (!r.ok) return null
  const u = await r.json()
  return u?.id === ADMIN_UUID ? u : null
}

// Clamp into the DB-checked range so an out-of-band model value never rejects.
function clampMultiplier(m) {
  if (typeof m !== 'number' || Number.isNaN(m)) return 1.0
  return Math.min(1.5, Math.max(0.5, m))
}

export async function onRequestPost(context) {
  const { request, env } = context
  if (!await verifyAdmin(request, env)) return res({ error: 'Forbidden — admin only' }, 403)

  // Pull every scored prediction with its role identity
  const ar = await fetch(`${env.SUPABASE_URL}/rest/v1/role_accuracy?select=accuracy_score,role:ai_roles(role_number,role_name)`, { headers: sb(env) })
  if (!ar.ok) return res({ error: 'role_accuracy fetch failed', detail: await ar.text() }, 502)
  const rows = await ar.json()

  // Aggregate hit rate + sample size per role_number
  const agg = {}
  for (const r of rows) {
    const n = r.role?.role_number
    if (n == null) continue
    const a = agg[n] || (agg[n] = { role_number: n, role_name: r.role?.role_name, total: 0, hits: 0 })
    a.total++
    if (Number(r.accuracy_score) >= 1) a.hits++
  }
  const stats = Object.values(agg).map(a => ({ ...a, hit_rate: a.total ? +(a.hits / a.total).toFixed(3) : null }))
  if (!stats.length) return res({ error: 'No settled predictions yet — nothing to calibrate' }, 400)

  // Role 11 (Sonnet): bias analysis → per-role calibration
  const system = `You are the Learning Loop (Role 11) in Metis, a WC2026 betting model. You receive each role's historical hit rate. Identify systematic over/under-confidence and emit a confidence_multiplier per role: 0.50–1.50 (1.0 = no change, <1.0 = trim confidence, >1.0 = boost). Respond ONLY with raw JSON, no markdown: {"calibrations":[{"role_number":<n>,"confidence_multiplier":<0.5-1.5>,"bias_notes":"<one line>"}]}`
  const userMsg = `Per-role hit rates (sample sizes):\n${stats.map(s => `Role ${s.role_number} ${s.role_name}: ${s.hits}/${s.total} = ${s.hit_rate == null ? 'n/a' : (s.hit_rate * 100).toFixed(0) + '%'}`).join('\n')}`

  let cal
  try {
    const r = await fetch(ANTHROPIC_API, {
      method: 'POST',
      headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': ANTHROPIC_VER, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: SONNET_MODEL, max_tokens: 1024, system, messages: [{ role: 'user', content: userMsg }] }),
    })
    if (!r.ok) return res({ error: 'Claude failed', detail: await r.text() }, 502)
    const data = await r.json()
    const text = data.content?.[0]?.text || ''
    cal = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1))
  } catch (e) { return res({ error: 'Calibration parse failed', detail: e.message }, 502) }

  // Map role_number → role_id, then upsert calibration rows
  const rolesRes = await fetch(`${env.SUPABASE_URL}/rest/v1/ai_roles?select=id,role_number`, { headers: sb(env) })
  const roleById = {}
  for (const r of await rolesRes.json()) roleById[r.role_number] = r.id

  const now = new Date().toISOString()
  const upserts = (cal.calibrations || []).filter(c => roleById[c.role_number]).map(c => {
    const s = stats.find(x => x.role_number === c.role_number)
    return { role_id: roleById[c.role_number], sample_size: s?.total ?? 0, hit_rate: s?.hit_rate ?? null, confidence_multiplier: clampMultiplier(c.confidence_multiplier), bias_notes: c.bias_notes || null, updated_at: now }
  })
  if (upserts.length) {
    const up = await fetch(`${env.SUPABASE_URL}/rest/v1/role_calibration`, {
      method: 'POST', headers: { ...sb(env), 'Prefer': 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(upserts),
    })
    if (!up.ok) return res({ error: 'Calibration upsert failed', detail: await up.text() }, 502)
  }

  return res({ success: true, roles_calibrated: upserts.length, stats })
}
