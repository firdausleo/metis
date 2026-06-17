import { supabase } from '../lib/supabase'

const ADMIN_UUID = '4a6e1f29-e18b-4fd3-9a7e-cec54501db54'

async function getGeoInfo() {
  try {
    const res = await fetch('https://ipapi.co/json/', {
      signal: AbortSignal.timeout(3000)
    })
    if (!res.ok) return {}
    const d = await res.json()
    return {
      ip_address: d.ip || null,
      country: d.country_name || null,
      city: d.city || null,
    }
  } catch {
    return {}
  }
}

function detectDevice() {
  const ua = navigator.userAgent
  if (/mobile/i.test(ua)) return 'mobile'
  if (/tablet|ipad/i.test(ua)) return 'tablet'
  return 'desktop'
}

let sessionId = null
let sessionStart = null
let heartbeatTimer = null
let pageCount = 0
let actionCount = 0

export async function startSession(userId) {
  console.log("[tracker] startSession called with:", userId)
  if (!userId || userId === ADMIN_UUID) return
  try {
    sessionStart = Date.now()
    pageCount = 0
    actionCount = 0
    const geo = await getGeoInfo()
    const { data, error } = await supabase
      .from('user_sessions')
      .insert({
        user_id: userId,
        user_agent: navigator.userAgent,
        device_type: detectDevice(),
        started_at: new Date().toISOString(),
        last_seen_at: new Date().toISOString(),
        ip_address: geo.ip_address || null,
        country: geo.country || null,
        city: geo.city || null,
      })
      .select('id')
      .single()
    if (error) throw error
    sessionId = data.id
    console.log("[tracker] session created:", sessionId)
    startHeartbeat()
  } catch (e) {
    console.warn('[tracker] startSession:', e.message)
  }
}

export async function endSession() {
  if (!sessionId || !sessionStart) return
  stopHeartbeat()
  const duration = Math.round((Date.now() - sessionStart) / 1000)
  try {
    await supabase
      .from('user_sessions')
      .update({
        ended_at: new Date().toISOString(),
        last_seen_at: new Date().toISOString(),
        duration_secs: duration,
        page_count: pageCount,
        action_count: actionCount,
      })
      .eq('id', sessionId)
  } catch (e) {
    console.warn('[tracker] endSession:', e.message)
  }
  sessionId = null
  sessionStart = null
}

function startHeartbeat() {
  stopHeartbeat()
  heartbeatTimer = setInterval(async () => {
    if (!sessionId) return
    try {
      await supabase
        .from('user_sessions')
        .update({
          last_seen_at: new Date().toISOString(),
          page_count: pageCount,
          action_count: actionCount,
        })
        .eq('id', sessionId)
    } catch (_) {}
  }, 60_000)
}

function stopHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer)
    heartbeatTimer = null
  }
}

export async function logActivity(userId, action, category, detail = {}, page = null) {
  if (!userId || userId === ADMIN_UUID) return
  actionCount++
  try {
    await supabase.from('user_activity_log').insert({
      session_id: sessionId,
      user_id: userId,
      action,
      category,
      detail,
      page: page || window.location.pathname,
      ts: new Date().toISOString(),
    })
  } catch (e) {
    console.warn('[tracker] logActivity:', e.message)
  }
}

export function logPageView(userId, pageName) {
  if (!userId || userId === ADMIN_UUID) return
  pageCount++
  return logActivity(userId, 'page_view', 'navigation', { page: pageName })
}

export const track = {
  matchView:   (uid, matchId, teams) => logActivity(uid, 'match_view',      'match',      { matchId, teams }),
  aiAnalysis:  (uid, matchId, teams) => logActivity(uid, 'ai_analysis_run', 'ai',         { matchId, teams }),
  oddsExtract: (uid, matchId, mkt)   => logActivity(uid, 'odds_extracted',  'betting',    { matchId, market: mkt }),
  betLogged:   (uid, matchId, stk)   => logActivity(uid, 'bet_logged',      'betting',    { matchId, stake: stk }),
  pasp:        (uid, matchId)        => logActivity(uid, 'pasp_generated',  'betting',    { matchId }),
  simulator:   (uid, sims)           => logActivity(uid, 'simulator_run',   'tools',      { simulations: sims }),
  modelPerf:   (uid)                 => logActivity(uid, 'model_perf_view', 'navigation', {}),
}
