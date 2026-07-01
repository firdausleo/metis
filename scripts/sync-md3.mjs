/**
 * One-off: trigger sync-stats for the 10 MD3 matches at the live endpoint.
 * Uses supabase.auth.admin.generateLink to mint a session token for the admin
 * user without requiring a password.
 */

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL  = 'https://wmxhcwellqtagpndpyhk.supabase.co'
const SERVICE_KEY   = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndteGhjd2VsbHF0YWdwbmRweWhrIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MDgzODEzMSwiZXhwIjoyMDk2NDE0MTMxfQ.RvWIwMJ0Bm_2KQbvSeKV_yZQgU1_vTrPYkXHRavYHd4'
const ADMIN_EMAIL   = 'firdausleo@hotmail.com'
const LIVE_ENDPOINT = 'https://metis.tiga6.com/api/sync-stats'

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const MATCH_IDS = [
  { id: 'da264a24-f90c-497a-994f-f4150e718af3', label: 'Uruguay vs Spain' },
  { id: 'decc93c8-abf0-457f-9154-b584969e4b95', label: 'Cape Verde vs Saudi Arabia' },
  { id: '38448737-1d67-4282-ab1f-68e25e6fe721', label: 'New Zealand vs Belgium' },
  { id: '0d100be5-dc80-442a-8ec0-ace69ffc598b', label: 'Egypt vs Iran' },
  { id: 'b2df0876-04d5-4564-8bcb-d8c6292664ee', label: 'Panama vs England' },
  { id: 'a09b3357-9d3a-4b54-a767-f148d500b8d2', label: 'Croatia vs Ghana' },
  { id: '8f86acf0-dd21-486c-9685-4211c52a267d', label: 'Argentina vs Jordan' },
  { id: '5841a4c3-e9f0-4559-a4bc-5f6e9c352607', label: 'Algeria vs Austria' },
  { id: '7ede7e38-334d-4cd1-a0de-fe30514ea262', label: 'Colombia vs Portugal' },
  { id: '9e49eab2-b952-4d98-8bcd-40163f696021', label: 'DR Congo vs Uzbekistan' },
]

async function getAdminToken() {
  // Generate a magic-link for the admin user (no email sent — admin API returns token directly)
  const { data, error } = await supabase.auth.admin.generateLink({
    type: 'magiclink',
    email: ADMIN_EMAIL,
    options: { redirectTo: 'http://localhost' },
  })
  if (error) throw new Error(`generateLink failed: ${error.message}`)

  const actionLink = data?.properties?.action_link
  if (!actionLink) throw new Error(`No action_link in response: ${JSON.stringify(data)}`)

  // Follow the verify URL with redirect:manual — Supabase will 302 to
  // http://localhost#access_token=xxx&... which we parse from Location header
  const verifyRes = await fetch(actionLink, { redirect: 'manual' })
  const location  = verifyRes.headers.get('location') || ''

  // Fragment is after '#'
  const fragIdx = location.indexOf('#')
  if (fragIdx === -1) throw new Error(`No fragment in redirect: ${location.slice(0, 200)}`)

  const params       = new URLSearchParams(location.slice(fragIdx + 1))
  const access_token = params.get('access_token')
  if (!access_token) throw new Error(`No access_token in fragment: ${location.slice(fragIdx).slice(0, 200)}`)
  return access_token
}

async function syncMatch(token, matchId, label) {
  const res = await fetch(LIVE_ENDPOINT, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ match_ids: [matchId] }),
  })

  const text = await res.text()
  let json
  try { json = JSON.parse(text) } catch { json = { raw: text } }

  if (!res.ok) return { ok: false, status: res.status, error: json?.error || text.slice(0, 120) }
  return { ok: true, synced: json?.synced, predictions: json?.predictions, message: json?.message }
}

async function run() {
  console.log('Minting admin session token…')
  let token
  try {
    token = await getAdminToken()
    console.log('✅ Token obtained\n')
  } catch (err) {
    console.error('❌ Auth failed:', err.message)
    process.exit(1)
  }

  let okCount = 0, failCount = 0

  for (const m of MATCH_IDS) {
    const result = await syncMatch(token, m.id, m.label)
    const tag = m.label.padEnd(28)

    if (result.ok) {
      const detail = result.message
        ? result.message
        : `synced=${result.synced ?? '?'}  predictions=${result.predictions ?? '?'}`
      console.log(`✅  ${tag}  ${detail}`)
      okCount++
    } else {
      console.log(`❌  ${tag}  HTTP ${result.status} — ${result.error}`)
      failCount++
    }

    // 1 s delay between calls
    if (m !== MATCH_IDS.at(-1)) await new Promise(r => setTimeout(r, 1000))
  }

  console.log(`\nDone: ✅ ${okCount}  ❌ ${failCount}`)
}

run().catch(e => { console.error(e); process.exit(1) })
