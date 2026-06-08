/**
 * CF Pages Function: POST /api/test-parse  (DEBUG)
 *
 * Calls Claude with the exact composite-scorer JSON instruction and returns
 * the RAW text + stop_reason + parsed result, so we can see exactly what
 * Claude emits in production. Admin-only. Remove after Role 10 is fixed.
 */

const ADMIN_UUID    = '4a6e1f29-e18b-4fd3-9a7e-cec54501db54'
const HAIKU_MODEL   = 'claude-haiku-4-5-20251001'
const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VER = '2023-06-01'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Content-Type':                 'application/json',
}
const jsonRes = (d, s = 200) => new Response(JSON.stringify(d, null, 2), { status: s, headers: CORS_HEADERS })
export const onRequestOptions = () => new Response(null, { status: 204, headers: CORS_HEADERS })

async function verifyAdmin(request, env) {
  const auth = request.headers.get('Authorization')
  if (!auth?.startsWith('Bearer ')) return null
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { 'Authorization': auth, 'apikey': env.SUPABASE_ANON_KEY },
  })
  if (!res.ok) return null
  const user = await res.json()
  return user?.id === ADMIN_UUID ? user : null
}

const JSON_INSTRUCTION = `
CRITICAL: Your ENTIRE response must be ONLY a raw JSON object.
Do NOT use markdown. Do NOT use code blocks. Do NOT write backticks.
Do NOT write the word "json". Do NOT write anything before { or after }.
First character must be { and last character must be }. No prose, no preamble.
Required schema (copy exactly, fill in values):
{"role":<number>,"summary":"<text>","signals":["<signal>"],"confidence":<0.00-1.00>,"recommendation":"<home_win|away_win|draw|over|under|value_home|value_away|null>","flags":[]}
`.trim()

export async function onRequestPost(context) {
  const { request, env } = context
  const user = await verifyAdmin(request, env)
  if (!user) return jsonRes({ error: 'Admin access required' }, 403)

  const system = `You are the Composite Scorer (Role 10) in Metis.\n${JSON_INSTRUCTION}\nFocus: synthesise into a single confidence score and explain the top 3 drivers in the summary.`
  const userMsg = 'Synthesise a fictional WC2026 match into a composite confidence score. role=10.'

  const res = await fetch(ANTHROPIC_API, {
    method: 'POST',
    headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': ANTHROPIC_VER, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: HAIKU_MODEL, max_tokens: 1024, system, messages: [{ role: 'user', content: userMsg }] }),
  })
  const data = await res.json()
  const text = data.content?.[0]?.text || ''
  return jsonRes({
    stop_reason:   data.stop_reason,
    usage:         data.usage,
    raw_text:      text,
    raw_length:    text.length,
    first_chars:   text.slice(0, 40),
    last_chars:    text.slice(-40),
  })
}
