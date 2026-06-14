/*
 MANUAL SUPABASE STEPS (do once in dashboard):
 1. Authentication → Sign In / Providers → Email → Enable
 2. Authentication → Sign In / Providers → Email → Disable "Confirm email"
 3. Authentication → URL Configuration → Site URL: https://metis.tiga6.com
 4. Authentication → URL Configuration → Redirect URLs: add https://metis.tiga6.com/**
 5. Keep "Allow new users to sign up" = ON (self-registration gated by pending status)
*/

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Content-Type':                 'application/json',
}

const DEFAULT_CREDITS = { standard: 20, power: 50, ultra: 9999, admin: 9999 }

function jsonRes(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS_HEADERS })
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS })
}

function sbHeaders(env) {
  return {
    'apikey':        env.SUPABASE_SERVICE_ROLE_KEY,
    'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type':  'application/json',
  }
}

async function verifyAdmin(request, env) {
  const auth = request.headers.get('Authorization')
  if (!auth?.startsWith('Bearer ')) return null

  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { 'Authorization': auth, 'apikey': env.SUPABASE_ANON_KEY },
  })
  if (!res.ok) return null
  const user = await res.json()
  if (!user?.id) return null

  const profileRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/user_profiles?id=eq.${user.id}&select=id,tier&limit=1`,
    { headers: sbHeaders(env) }
  )
  if (!profileRes.ok) return null
  const profiles = await profileRes.json()
  if (!profiles.length || profiles[0].tier !== 'admin') return null

  return user
}

function generateCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  let suffix = ''
  for (let i = 0; i < 4; i++) suffix += chars[Math.floor(Math.random() * chars.length)]
  return 'METIS-' + suffix
}

export async function onRequestPost(context) {
  const { request, env } = context

  const adminUser = await verifyAdmin(request, env)
  if (!adminUser) return jsonRes({ error: 'Admin access required' }, 403)

  let body = {}
  try { body = await request.json() } catch { /* empty ok */ }

  const { action } = body

  // ── list_users ────────────────────────────────────────────────
  if (action === 'list_users') {
    const res = await fetch(
      `${env.SUPABASE_URL}/rest/v1/user_profiles?select=*&order=created_at.desc`,
      { headers: sbHeaders(env) }
    )
    if (!res.ok) return jsonRes({ error: 'Failed to list users' }, 500)
    return jsonRes({ ok: true, users: await res.json() })
  }

  // ── approve_user ──────────────────────────────────────────────
  if (action === 'approve_user') {
    const { userId, tier = 'standard' } = body
    if (!userId) return jsonRes({ error: 'userId required' }, 400)
    const credits = DEFAULT_CREDITS[tier] ?? 20
    const res = await fetch(
      `${env.SUPABASE_URL}/rest/v1/user_profiles?id=eq.${userId}`,
      {
        method: 'PATCH',
        headers: { ...sbHeaders(env), 'Prefer': 'return=minimal' },
        body: JSON.stringify({ status: 'approved', tier, credits_remaining: credits }),
      }
    )
    if (!res.ok) return jsonRes({ error: 'Failed to approve user' }, 500)
    return jsonRes({ ok: true })
  }

  // ── reject_user ───────────────────────────────────────────────
  if (action === 'reject_user') {
    const { userId } = body
    if (!userId) return jsonRes({ error: 'userId required' }, 400)
    const res = await fetch(
      `${env.SUPABASE_URL}/rest/v1/user_profiles?id=eq.${userId}`,
      {
        method: 'PATCH',
        headers: { ...sbHeaders(env), 'Prefer': 'return=minimal' },
        body: JSON.stringify({ status: 'rejected' }),
      }
    )
    if (!res.ok) return jsonRes({ error: 'Failed to reject user' }, 500)
    return jsonRes({ ok: true })
  }

  // ── change_tier ───────────────────────────────────────────────
  if (action === 'change_tier') {
    const { userId, newTier } = body
    if (!userId || !newTier) return jsonRes({ error: 'userId and newTier required' }, 400)
    const credits = DEFAULT_CREDITS[newTier] ?? 20
    const res = await fetch(
      `${env.SUPABASE_URL}/rest/v1/user_profiles?id=eq.${userId}`,
      {
        method: 'PATCH',
        headers: { ...sbHeaders(env), 'Prefer': 'return=minimal' },
        body: JSON.stringify({ tier: newTier, credits_remaining: credits }),
      }
    )
    if (!res.ok) return jsonRes({ error: 'Failed to change tier' }, 500)
    return jsonRes({ ok: true })
  }

  // ── reset_credits ─────────────────────────────────────────────
  if (action === 'reset_credits') {
    const { userId } = body
    if (!userId) return jsonRes({ error: 'userId required' }, 400)
    // Look up current tier to determine default
    const profileRes = await fetch(
      `${env.SUPABASE_URL}/rest/v1/user_profiles?id=eq.${userId}&select=tier&limit=1`,
      { headers: sbHeaders(env) }
    )
    if (!profileRes.ok) return jsonRes({ error: 'Failed to fetch user' }, 500)
    const [profile] = await profileRes.json()
    if (!profile) return jsonRes({ error: 'User not found' }, 404)
    const credits = DEFAULT_CREDITS[profile.tier] ?? 20
    const res = await fetch(
      `${env.SUPABASE_URL}/rest/v1/user_profiles?id=eq.${userId}`,
      {
        method: 'PATCH',
        headers: { ...sbHeaders(env), 'Prefer': 'return=minimal' },
        body: JSON.stringify({ credits_remaining: credits }),
      }
    )
    if (!res.ok) return jsonRes({ error: 'Failed to reset credits' }, 500)
    return jsonRes({ ok: true, credits_remaining: credits })
  }

  // ── generate_invite ───────────────────────────────────────────
  if (action === 'generate_invite') {
    const { tier = 'standard' } = body
    // Try up to 5 times in case of collision
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = generateCode()
      const res = await fetch(
        `${env.SUPABASE_URL}/rest/v1/invite_codes`,
        {
          method: 'POST',
          headers: { ...sbHeaders(env), 'Prefer': 'return=representation' },
          body: JSON.stringify({
            code,
            tier,
            created_by: adminUser.id,
            expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          }),
        }
      )
      if (res.ok) {
        const [row] = await res.json()
        return jsonRes({ ok: true, code: row.code, id: row.id })
      }
      // 409 = collision, retry; other errors = fail
      if (res.status !== 409) return jsonRes({ error: 'Failed to generate invite code' }, 500)
    }
    return jsonRes({ error: 'Code generation failed after retries' }, 500)
  }

  // ── revoke_invite ─────────────────────────────────────────────
  if (action === 'revoke_invite') {
    const { codeId } = body
    if (!codeId) return jsonRes({ error: 'codeId required' }, 400)
    const res = await fetch(
      `${env.SUPABASE_URL}/rest/v1/invite_codes?id=eq.${codeId}`,
      {
        method: 'PATCH',
        headers: { ...sbHeaders(env), 'Prefer': 'return=minimal' },
        body: JSON.stringify({ revoked: true }),
      }
    )
    if (!res.ok) return jsonRes({ error: 'Failed to revoke invite code' }, 500)
    return jsonRes({ ok: true })
  }

  // ── list_invites ──────────────────────────────────────────────
  if (action === 'list_invites') {
    const res = await fetch(
      `${env.SUPABASE_URL}/rest/v1/invite_codes?created_by=eq.${adminUser.id}&order=created_at.desc`,
      { headers: sbHeaders(env) }
    )
    if (!res.ok) return jsonRes({ error: 'Failed to list invite codes' }, 500)
    return jsonRes({ ok: true, codes: await res.json() })
  }

  return jsonRes({ error: `Unknown action: ${action}` }, 400)
}
