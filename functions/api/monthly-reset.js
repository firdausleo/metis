/**
 * CF Pages Function: POST /api/monthly-reset
 *
 * Resets credits for all power (50) and standard (20) users
 * where credits_reset_date <= TODAY, then bumps reset date to next month.
 *
 * Trigger: Cloudflare Dashboard → Pages → Settings → Functions → Cron Triggers
 *   Expression: 0 0 1 * *  (midnight UTC on the 1st of each month)
 *   Handler:    onScheduled (below)
 *
 * Manual trigger: POST /api/monthly-reset with header x-cron-secret: <CRON_SECRET>
 */

function sbHeaders(env) {
  return {
    'apikey':        env.SUPABASE_SERVICE_ROLE_KEY,
    'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type':  'application/json',
  }
}

async function runMonthlyReset(env) {
  const today = new Date().toISOString().slice(0, 10)

  // Power users: reset to 50
  const powerRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/user_profiles?tier=eq.power&credits_reset_date=lte.${today}`,
    {
      method: 'PATCH',
      headers: { ...sbHeaders(env), 'Prefer': 'return=representation' },
      body: JSON.stringify({
        credits_remaining: 50,
        credits_reset_date: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1)
          .toISOString().slice(0, 10),
      }),
    }
  )

  // Standard users: reset to 20
  const standardRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/user_profiles?tier=eq.standard&credits_reset_date=lte.${today}`,
    {
      method: 'PATCH',
      headers: { ...sbHeaders(env), 'Prefer': 'return=representation' },
      body: JSON.stringify({
        credits_remaining: 20,
        credits_reset_date: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1)
          .toISOString().slice(0, 10),
      }),
    }
  )

  const powerRows    = powerRes.ok    ? await powerRes.json()    : []
  const standardRows = standardRes.ok ? await standardRes.json() : []

  return {
    ok:              true,
    power_reset:     Array.isArray(powerRows) ? powerRows.length : 0,
    standard_reset:  Array.isArray(standardRows) ? standardRows.length : 0,
    timestamp:       new Date().toISOString(),
  }
}

// Scheduled event handler (CF Dashboard cron trigger)
export async function onScheduled(context) {
  const { env } = context
  await runMonthlyReset(env)
}

// Manual HTTP trigger (protected by CRON_SECRET)
export async function onRequestPost(context) {
  const { request, env } = context
  const secret = request.headers.get('x-cron-secret')
  if (!secret || secret !== env.CRON_SECRET) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  const result = await runMonthlyReset(env)
  return new Response(JSON.stringify(result), {
    headers: { 'Content-Type': 'application/json' },
  })
}
