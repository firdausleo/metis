// CF Pages Function: POST /api/settle-match
// Admin records final score → marks match finished → settles ALL pending bets
// → scores role_accuracy per role → scores model_predictions (1x2, total_goals, correct_score)
// Service role key bypasses RLS. All operations are idempotent (re-settling safe).

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

// ── Bet settlement helpers ──────────────────────────────────────────────────

function result1X2(selection, h, a) {
  const r = h > a ? 'home' : h < a ? 'away' : 'draw'
  return selection === r ? 'won' : 'lost'
}

// ── Role accuracy helpers ───────────────────────────────────────────────────

function scoreRecommendation(rec, h, a) {
  if (!rec) return null
  const outcome = h > a ? 'home' : h < a ? 'away' : 'draw'
  const total = h + a
  switch (rec) {
    case 'home_win': case 'value_home': return outcome === 'home' ? 1 : 0
    case 'away_win': case 'value_away': return outcome === 'away' ? 1 : 0
    case 'draw':                        return outcome === 'draw' ? 1 : 0
    case 'over':                        return total > 2.5 ? 1 : 0
    case 'under':                       return total < 2.5 ? 1 : 0
    default:                            return null
  }
}

async function trackRoleAccuracy(env, matchId, h, a) {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/role_outputs?match_id=eq.${matchId}&select=role_id,output_json`, { headers: sb(env) })
  if (!r.ok) return 0
  const outputs = await r.json()
  const now = new Date().toISOString()
  const actual = { home_score: h, away_score: a }
  const rows = []
  for (const o of outputs) {
    const score = scoreRecommendation(o.output_json?.recommendation, h, a)
    if (score === null) continue
    rows.push({ role_id: o.role_id, match_id: matchId, predicted_json: o.output_json, actual_json: actual, accuracy_score: score, settled_at: now })
  }
  if (!rows.length) return 0
  await fetch(`${env.SUPABASE_URL}/rest/v1/role_accuracy?match_id=eq.${matchId}`, { method: 'DELETE', headers: sb(env) })
  const ins = await fetch(`${env.SUPABASE_URL}/rest/v1/role_accuracy`, {
    method: 'POST', headers: { ...sb(env), 'Prefer': 'return=minimal' }, body: JSON.stringify(rows),
  })
  return ins.ok ? rows.length : 0
}

// ── Inline Poisson engine (mirrors src/lib/poisson.js — no imports in CF Workers) ──

const LEAGUE_AVG   = 1.5
const DEF_MIN      = 0.5
const DEF_MAX      = 1.8
const SCORE_MAX    = 8     // matrix dimension 0..SCORE_MAX

function pmf(k, λ) {
  if (λ <= 0) return k === 0 ? 1 : 0
  let logF = 0
  for (let i = 2; i <= k; i++) logF += Math.log(i)
  return Math.exp(k * Math.log(λ) - λ - logF)
}

function cdf(n, λ) {
  let s = 0
  for (let k = 0; k <= n; k++) s += pmf(k, λ)
  return Math.min(s, 1)
}

function blend(xg, goals) {
  if (xg == null) return goals
  if (xg < 0.3 && goals > 0.8) return goals   // noise guard (MT06)
  return xg * 0.6 + goals * 0.4
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)) }

function calcLambdasV1(hs, as_, vMult) {
  const bothXgF = hs.xgf_per_game != null && as_.xgf_per_game != null
  const bothXgA = hs.xga_per_game != null && as_.xga_per_game != null
  const attH = bothXgF ? blend(hs.xgf_per_game, hs.goals_scored_avg) : hs.goals_scored_avg
  const attA = bothXgF ? blend(as_.xgf_per_game, as_.goals_scored_avg) : as_.goals_scored_avg
  const defHI = bothXgA ? blend(hs.xga_per_game, hs.goals_conceded_avg) : hs.goals_conceded_avg
  const defAI = bothXgA ? blend(as_.xga_per_game, as_.goals_conceded_avg) : as_.goals_conceded_avg
  const dHF = clamp(LEAGUE_AVG / defHI, DEF_MIN, DEF_MAX)
  const dAF = clamp(LEAGUE_AVG / defAI, DEF_MIN, DEF_MAX)
  return {
    lambdaHome: Math.max(attH * dAF * vMult, 0.01),
    lambdaAway: Math.max(attA * dHF, 0.01),
  }
}

function calcLambdasV2(hs, as_, vMult) {
  const v1 = calcLambdasV1(hs, as_, vMult)
  let awayFactor = 1.0
  if (as_.away_goals_avg && as_.goals_scored_avg > 0) {
    const suspicious = as_.home_goals_avg != null && as_.away_goals_avg > as_.home_goals_avg * 1.5
    if (!suspicious) awayFactor = as_.away_goals_avg / as_.goals_scored_avg
  }
  awayFactor = clamp(awayFactor, 0.4, 1.4)
  return { lambdaHome: v1.lambdaHome, lambdaAway: Math.max(v1.lambdaAway * awayFactor, 0.01) }
}

function buildMatrix(lh, la) {
  const N = SCORE_MAX + 1
  const m = Array.from({ length: N }, () => new Array(N).fill(0))
  for (let i = 0; i < N; i++)
    for (let j = 0; j < N; j++)
      m[i][j] = pmf(i, lh) * pmf(j, la)
  return m
}

function calcProbs(matrix) {
  let home = 0, draw = 0, away = 0
  for (let i = 0; i < matrix.length; i++)
    for (let j = 0; j < matrix[i].length; j++) {
      if (i > j) home += matrix[i][j]
      else if (i === j) draw += matrix[i][j]
      else away += matrix[i][j]
    }
  return { home, draw, away }
}

function anchorLine(lt) {
  if (lt < 2.0) return 1.5
  if (lt < 2.8) return 2.5
  if (lt < 3.8) return 3.5
  if (lt < 4.8) return 4.5
  return 5.5
}

function calcTotalGoals(lh, la) {
  const lt = lh + la
  const anchor = anchorLine(lt)
  return [0.5, 1.5, 2.5, 3.5, 4.5, 5.5].map(line => {
    const under = cdf(Math.floor(line), lt)
    return { line, over: 1 - under, under, anchor: line === anchor }
  })
}

function getVenueMult(venue = '', city = '', homeTeam = '') {
  const v = `${venue} ${city}`.toLowerCase()
  const t = homeTeam.toLowerCase().trim()
  if ((v.includes('azteca') || v.includes('mexico city')) && t === 'mexico') return 1.35
  if (/canada|toronto|vancouver/.test(v) && t === 'canada') return 1.05
  if (/usa|united states|new york|dallas|atlanta|houston|miami|seattle|los angeles|kansas|philadelphia|boston|san francisco/.test(v) && t === 'usa') return 1.10
  return 1.0
}

// ── Model prediction tracking ───────────────────────────────────────────────

async function trackModelPredictions(env, matchId, h, a) {
  // Fetch match for team codes + venue
  const matchRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/matches?id=eq.${matchId}&select=home_team,home_team_code,away_team_code,venue,city`,
    { headers: sb(env) }
  )
  if (!matchRes.ok) return 0
  const [match] = await matchRes.json()
  if (!match?.home_team_code || !match?.away_team_code) return 0

  // Fetch team_stats for both sides
  const statsRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/team_stats?match_id=eq.${matchId}&select=*`,
    { headers: sb(env) }
  )
  if (!statsRes.ok) return 0
  const statsRows = await statsRes.json()
  const hs  = statsRows.find(s => s.team_code === match.home_team_code)
  const as_ = statsRows.find(s => s.team_code === match.away_team_code)

  // Need both sides' stats to run Poisson
  if (!hs?.goals_scored_avg || !hs?.goals_conceded_avg ||
      !as_?.goals_scored_avg || !as_?.goals_conceded_avg) return 0

  let v1, v2
  try {
    const vMult = getVenueMult(match.venue, match.city, match.home_team)
    v1 = calcLambdasV1(hs, as_, vMult)
    v2 = calcLambdasV2(hs, as_, vMult)
  } catch { return 0 }

  const now = new Date().toISOString()
  const actualResult = h > a ? 'home_win' : h < a ? 'away_win' : 'draw'
  const actualTotal  = h + a
  const actualScore  = `${h}-${a}`
  const rows = []

  // ── 1X2 prediction (V2 — primary model) ──
  const matV2    = buildMatrix(v2.lambdaHome, v2.lambdaAway)
  const probsV2  = calcProbs(matV2)
  const best1X2  = probsV2.home >= probsV2.draw && probsV2.home >= probsV2.away ? 'home_win'
                 : probsV2.away >= probsV2.draw                                  ? 'away_win'
                 : 'draw'
  const prob1X2  = best1X2 === 'home_win' ? probsV2.home
                 : best1X2 === 'away_win' ? probsV2.away
                 : probsV2.draw
  rows.push({
    match_id: matchId, prediction_type: '1x2',
    predicted: best1X2, predicted_prob: +prob1X2.toFixed(3),
    actual: actualResult, correct: best1X2 === actualResult,
    lambda_home: +v2.lambdaHome.toFixed(3), lambda_away: +v2.lambdaAway.toFixed(3),
    settled_at: now,
  })

  // ── Total goals prediction (V2 anchor line) ──
  const tgV2   = calcTotalGoals(v2.lambdaHome, v2.lambdaAway)
  const anchor = tgV2.find(l => l.anchor)
  if (anchor) {
    const predTG  = anchor.over >= anchor.under ? `over_${anchor.line}` : `under_${anchor.line}`
    const probTG  = Math.max(anchor.over, anchor.under)
    const actTG   = actualTotal > anchor.line ? `over_${anchor.line}` : `under_${anchor.line}`
    rows.push({
      match_id: matchId, prediction_type: 'total_goals',
      predicted: predTG, predicted_prob: +probTG.toFixed(3),
      actual: actTG, correct: predTG === actTG,
      lambda_home: +v2.lambdaHome.toFixed(3), lambda_away: +v2.lambdaAway.toFixed(3),
      settled_at: now,
    })
  }

  // ── Correct score prediction (V1 matrix — most likely scoreline) ──
  const matV1 = buildMatrix(v1.lambdaHome, v1.lambdaAway)
  let bestI = 0, bestJ = 0, bestProb = 0
  for (let i = 0; i <= SCORE_MAX; i++)
    for (let j = 0; j <= SCORE_MAX; j++)
      if (matV1[i][j] > bestProb) { bestProb = matV1[i][j]; bestI = i; bestJ = j }
  rows.push({
    match_id: matchId, prediction_type: 'correct_score',
    predicted: `${bestI}-${bestJ}`, predicted_prob: +bestProb.toFixed(3),
    actual: actualScore, correct: `${bestI}-${bestJ}` === actualScore,
    lambda_home: +v1.lambdaHome.toFixed(3), lambda_away: +v1.lambdaAway.toFixed(3),
    settled_at: now,
  })

  // Idempotent upsert: clear old rows for this match, then insert fresh
  await fetch(`${env.SUPABASE_URL}/rest/v1/model_predictions?match_id=eq.${matchId}`, {
    method: 'DELETE', headers: sb(env),
  })
  const ins = await fetch(`${env.SUPABASE_URL}/rest/v1/model_predictions`, {
    method: 'POST',
    headers: { ...sb(env), 'Prefer': 'return=minimal' },
    body: JSON.stringify(rows),
  })
  return ins.ok ? rows.length : 0
}

// ── Handler ─────────────────────────────────────────────────────────────────

export async function onRequestPost(context) {
  const { request, env } = context
  if (!await verifyAdmin(request, env)) return res({ error: 'Forbidden — admin only' }, 403)

  let body
  try { body = await request.json() } catch { return res({ error: 'Invalid JSON' }, 400) }
  const { match_id, home_score, away_score } = body
  if (!match_id || !Number.isInteger(home_score) || !Number.isInteger(away_score)) {
    return res({ error: 'match_id and integer home_score/away_score required' }, 400)
  }

  // Mark match finished
  const mu = await fetch(`${env.SUPABASE_URL}/rest/v1/matches?id=eq.${match_id}`, {
    method: 'PATCH', headers: { ...sb(env), 'Prefer': 'return=minimal' },
    body: JSON.stringify({ home_score, away_score, status: 'finished' }),
  })
  if (!mu.ok) return res({ error: 'Match update failed', detail: await mu.text() }, 502)

  // Settle bets
  const br = await fetch(`${env.SUPABASE_URL}/rest/v1/bets?match_id=eq.${match_id}&status=eq.pending&select=*`, { headers: sb(env) })
  if (!br.ok) return res({ error: 'Bets fetch failed', detail: await br.text() }, 502)
  const pending = await br.json()

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

  // Score role accuracy (non-blocking)
  let roles_scored = 0
  try { roles_scored = await trackRoleAccuracy(env, match_id, home_score, away_score) } catch { /* never block */ }

  // Score model predictions (non-blocking)
  let model_predictions_scored = 0
  try { model_predictions_scored = await trackModelPredictions(env, match_id, home_score, away_score) } catch { /* never block */ }

  return res({ success: true, match_id, home_score, away_score, pending: pending.length, settled, roles_scored, model_predictions_scored })
}
