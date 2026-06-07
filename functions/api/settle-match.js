// CF Pages Function: PATCH /api/settle-match
// Admin-only endpoint to record match results and mark as completed.
// Auth: requires admin Bearer token.
// Env: SUPABASE_URL (var), SUPABASE_ANON_KEY (var), SUPABASE_SERVICE_ROLE_KEY (secret)

const ADMIN_UUID = '4a6e1f29-e18b-4fd3-9a7e-cec54501db54'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
}

async function verifyAdmin(request, env) {
  const authHeader = request.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return null

  const response = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      'Authorization': authHeader,
      'apikey': env.SUPABASE_ANON_KEY,
    },
  })
  if (!response.ok) return null

  const user = await response.json()
  if (user.id !== ADMIN_UUID) return null
  return user
}

export async function onRequestPatch(context) {
  const { request, env } = context

  const admin = await verifyAdmin(request, env)
  if (!admin) {
    return new Response(
      JSON.stringify({ error: 'Forbidden — admin only' }),
      { status: 403, headers: CORS }
    )
  }

  let body
  try {
    body = await request.json()
  } catch {
    return new Response(
      JSON.stringify({ error: 'Invalid JSON body' }),
      { status: 400, headers: CORS }
    )
  }

  const { match_id, home_score, away_score } = body

  if (!match_id || home_score === undefined || away_score === undefined) {
    return new Response(
      JSON.stringify({ error: 'match_id, home_score, and away_score are required' }),
      { status: 400, headers: CORS }
    )
  }

  if (!Number.isInteger(home_score) || !Number.isInteger(away_score)) {
    return new Response(
      JSON.stringify({ error: 'Scores must be integers' }),
      { status: 400, headers: CORS }
    )
  }

  const updateResponse = await fetch(
    `${env.SUPABASE_URL}/rest/v1/matches?id=eq.${match_id}`,
    {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify({
        home_score,
        away_score,
        status: 'completed',
        updated_at: new Date().toISOString(),
      }),
    }
  )

  if (!updateResponse.ok) {
    const errText = await updateResponse.text()
    return new Response(
      JSON.stringify({ error: 'DB update failed', detail: errText }),
      { status: 502, headers: CORS }
    )
  }

  return new Response(
    JSON.stringify({ success: true, match_id, home_score, away_score }),
    { status: 200, headers: CORS }
  )
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'PATCH, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    },
  })
}
