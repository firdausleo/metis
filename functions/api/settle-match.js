// CF Pages Function: POST /api/settle-match
// Admin records final score → marks match finished → settles ALL pending bets
// → scores role_accuracy per role → scores model_predictions (1x2, total_goals, correct_score)
// Service role key bypasses RLS. All operations are idempotent (re-settling safe).

const ADMIN_UUID = '4a6e1f29-e18b-4fd3-9a7e-cec54501db54'

// ── Knockout bracket progression ────────────────────────────────────────────
// All three cross-round maps are hardcoded from the official WC2026 bracket.
// Sequential pairing (floor/mod) is wrong for this tournament's schedule.

const R32_TO_R16 = {
  '2026-06-28T19:00:00Z': { matchId: '9de7fba2-a890-4c02-923d-d38c2a16f9b4', slot: 'home' }, // Mexico/Canada      → R16 Jul08-03BJ home
  '2026-06-28T22:00:00Z': { matchId: '9097b035-327b-47bc-8470-5f83a1cf9174', slot: 'home' }, // Brazil/Australia   → R16 Jul10-03BJ home
  '2026-06-29T01:00:00Z': { matchId: 'e6e6060b-d1c9-4ae9-bfd6-f88b5cc0ec74', slot: 'home' }, // Germany/Japan      → R16 Jul09-03BJ home
  '2026-06-29T19:00:00Z': { matchId: '61ec5bd8-0241-47ca-ba50-c84c41177eba', slot: 'home' }, // Belgium/Cape Verde → R16 Jul11-03BJ home
  '2026-06-29T22:00:00Z': { matchId: 'ecd88202-6b7c-429b-8b4f-baea088f57c1', slot: 'home' }, // France/Austria     → R16 Jul08-06BJ home
  '2026-06-30T01:00:00Z': { matchId: '7eb4b04d-70c9-4e65-aa5f-11a1959f16c5', slot: 'home' }, // Colombia/Croatia   → R16 Jul10-06BJ home
  '2026-06-30T19:00:00Z': { matchId: '53530c34-c46b-4552-a428-49410b404e04', slot: 'home' }, // S.Africa/Swiss     → R16 Jul09-06BJ home
  '2026-06-30T22:00:00Z': { matchId: 'f686b918-9d7d-4e05-afec-30ea621a708d', slot: 'home' }, // Morocco/USA        → R16 Jul11-06BJ home
  '2026-07-01T01:00:00Z': { matchId: '9de7fba2-a890-4c02-923d-d38c2a16f9b4', slot: 'away' }, // Ivory Coast/Neth   → R16 Jul08-03BJ away
  '2026-07-01T19:00:00Z': { matchId: '9097b035-327b-47bc-8470-5f83a1cf9174', slot: 'away' }, // Egypt/Spain        → R16 Jul10-03BJ away
  '2026-07-01T22:00:00Z': { matchId: 'e6e6060b-d1c9-4ae9-bfd6-f88b5cc0ec74', slot: 'away' }, // Norway/Argentina   → R16 Jul09-03BJ away
  '2026-07-02T01:00:00Z': { matchId: '61ec5bd8-0241-47ca-ba50-c84c41177eba', slot: 'away' }, // Portugal/England   → R16 Jul11-03BJ away
  '2026-07-02T19:00:00Z': { matchId: 'ecd88202-6b7c-429b-8b4f-baea088f57c1', slot: 'away' }, // Bosnia/Sweden      → R16 Jul08-06BJ away
  '2026-07-02T22:00:00Z': { matchId: '7eb4b04d-70c9-4e65-aa5f-11a1959f16c5', slot: 'away' }, // Paraguay/Ghana     → R16 Jul10-06BJ away
  '2026-07-03T01:00:00Z': { matchId: '53530c34-c46b-4552-a428-49410b404e04', slot: 'away' }, // Ecuador/Algeria    → R16 Jul09-06BJ away
  '2026-07-03T19:00:00Z': { matchId: 'f686b918-9d7d-4e05-afec-30ea621a708d', slot: 'away' }, // Senegal/DR Congo   → R16 Jul11-06BJ away
}

const R16_TO_QF = {
  '9de7fba2-a890-4c02-923d-d38c2a16f9b4': { matchId: 'a02d5d26-9aa1-4f6d-8c2c-d0ef3c22bab0', slot: 'home' }, // R16 Jul08-03BJ → QF Jul12-05BJ home
  'ecd88202-6b7c-429b-8b4f-baea088f57c1': { matchId: '959f29e2-9265-4fcc-9bdd-6866c56835de', slot: 'home' }, // R16 Jul08-06BJ → QF Jul12-09BJ home
  'e6e6060b-d1c9-4ae9-bfd6-f88b5cc0ec74': { matchId: 'a02d5d26-9aa1-4f6d-8c2c-d0ef3c22bab0', slot: 'away' }, // R16 Jul09-03BJ → QF Jul12-05BJ away
  '53530c34-c46b-4552-a428-49410b404e04': { matchId: '959f29e2-9265-4fcc-9bdd-6866c56835de', slot: 'away' }, // R16 Jul09-06BJ → QF Jul12-09BJ away
  '9097b035-327b-47bc-8470-5f83a1cf9174': { matchId: '72726e9a-a595-4543-aa51-c2d1b2de9d9d', slot: 'home' }, // R16 Jul10-03BJ → QF Jul14-05BJ home
  '7eb4b04d-70c9-4e65-aa5f-11a1959f16c5': { matchId: '87784065-417f-4c95-80c8-9d22e8ac4f39', slot: 'home' }, // R16 Jul10-06BJ → QF Jul14-09BJ home
  '61ec5bd8-0241-47ca-ba50-c84c41177eba': { matchId: '72726e9a-a595-4543-aa51-c2d1b2de9d9d', slot: 'away' }, // R16 Jul11-03BJ → QF Jul14-05BJ away
  'f686b918-9d7d-4e05-afec-30ea621a708d': { matchId: '87784065-417f-4c95-80c8-9d22e8ac4f39', slot: 'away' }, // R16 Jul11-06BJ → QF Jul14-09BJ away
}

const QF_TO_SF = {
  'a02d5d26-9aa1-4f6d-8c2c-d0ef3c22bab0': { matchId: '6bcfd5c2-da63-46e4-a780-9deecaf6ab3f', slot: 'home' }, // QF Jul12-05BJ → SF Jul16-07BJ home
  '959f29e2-9265-4fcc-9bdd-6866c56835de': { matchId: '29169d0c-f1a2-41fb-92da-5aa34121a970', slot: 'home' }, // QF Jul12-09BJ → SF Jul17-07BJ home
  '72726e9a-a595-4543-aa51-c2d1b2de9d9d': { matchId: '6bcfd5c2-da63-46e4-a780-9deecaf6ab3f', slot: 'away' }, // QF Jul14-05BJ → SF Jul16-07BJ away
  '87784065-417f-4c95-80c8-9d22e8ac4f39': { matchId: '29169d0c-f1a2-41fb-92da-5aa34121a970', slot: 'away' }, // QF Jul14-09BJ → SF Jul17-07BJ away
}

const SF_IDS  = ['6bcfd5c2-da63-46e4-a780-9deecaf6ab3f', '29169d0c-f1a2-41fb-92da-5aa34121a970']
const FINAL_ID = '330240de-5cb9-410c-9c9e-6d432ff62bbc'

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

// ── Knockout bracket propagation ────────────────────────────────────────────

async function patchTeamField(env, matchId, field, teamName) {
  await fetch(`${env.SUPABASE_URL}/rest/v1/matches?id=eq.${matchId}`, {
    method: 'PATCH',
    headers: { ...sb(env), 'Prefer': 'return=minimal' },
    body: JSON.stringify({ [field]: teamName }),
  })
}

// Call after any knockout match settles. winnerTeam = name of the advancing team.
async function propagateWinner(env, settledMatchId, settledMatchDate, winnerTeam) {
  // Normalise to 'YYYY-MM-DDTHH:MM:SSZ' to match R32_TO_R16 keys
  const utc = new Date(settledMatchDate).toISOString().replace('.000Z', 'Z')

  const r32 = R32_TO_R16[utc]
  if (r32) {
    await patchTeamField(env, r32.matchId, r32.slot + '_team', winnerTeam)
    return
  }

  const r16 = R16_TO_QF[settledMatchId]
  if (r16) {
    await patchTeamField(env, r16.matchId, r16.slot + '_team', winnerTeam)
    return
  }

  const qf = QF_TO_SF[settledMatchId]
  if (qf) {
    await patchTeamField(env, qf.matchId, qf.slot + '_team', winnerTeam)
    return
  }

  const sfIdx = SF_IDS.indexOf(settledMatchId)
  if (sfIdx >= 0) {
    await patchTeamField(env, FINAL_ID, sfIdx === 0 ? 'home_team' : 'away_team', winnerTeam)
  }
}

// ── Model prediction tracking ───────────────────────────────────────────────

function topOutcome(hw, d, aw) {
  if (hw == null || d == null || aw == null) return null
  if (hw >= d && hw >= aw) return 'H'
  if (aw >= d) return 'A'
  return 'D'
}

function topScore(mat) {
  let bi = 0, bj = 0, bp = 0
  for (let i = 0; i <= SCORE_MAX; i++)
    for (let j = 0; j <= SCORE_MAX; j++)
      if (mat[i][j] > bp) { bp = mat[i][j]; bi = i; bj = j }
  return `${bi}-${bj}`
}

async function trackModelPredictions(env, matchId, h, a) {
  const actualOutcome = h > a ? 'H' : h < a ? 'A' : 'D'
  const now = new Date().toISOString()

  // ── Try to read existing prediction row (logged at stats-fetch time) ──
  const existRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/model_predictions?match_id=eq.${matchId}&select=*&limit=1`,
    { headers: sb(env) }
  )
  const existRows = existRes.ok ? await existRes.json() : []
  const existing = existRows[0] || null

  if (existing?.v3_home_win != null) {
    // Score the pre-logged predictions
    const v3hw = Number(existing.v3_home_win)
    const v3d  = Number(existing.v3_draw)
    const v3aw = Number(existing.v3_away_win)
    const Ih = actualOutcome === 'H' ? 1 : 0
    const Id = actualOutcome === 'D' ? 1 : 0
    const Ia = actualOutcome === 'A' ? 1 : 0
    const brier = +((v3hw - Ih)**2 + (v3d - Id)**2 + (v3aw - Ia)**2).toFixed(4)
    const rps   = +(0.5 * ((v3hw - Ih)**2 + (v3hw + v3d - Ih - Id)**2)).toFixed(4)

    const patchRes = await fetch(
      `${env.SUPABASE_URL}/rest/v1/model_predictions?match_id=eq.${matchId}`,
      {
        method: 'PATCH',
        headers: { ...sb(env), 'Prefer': 'return=minimal' },
        body: JSON.stringify({
          actual_outcome: actualOutcome,
          correct_v1: topOutcome(existing.v1_home_win, existing.v1_draw, existing.v1_away_win) === actualOutcome,
          correct_v2: topOutcome(existing.v2_home_win, existing.v2_draw, existing.v2_away_win) === actualOutcome,
          correct_v3: topOutcome(v3hw, v3d, v3aw) === actualOutcome,
          brier_score: brier,
          rps_score: rps,
          settled_at: now,
        }),
      }
    )
    return patchRes.ok ? 1 : 0
  }

  // ── Fallback: compute predictions inline (sync-stats wasn't run pre-kickoff) ──
  const matchRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/matches?id=eq.${matchId}&select=home_team,home_team_code,away_team_code,venue,city`,
    { headers: sb(env) }
  )
  if (!matchRes.ok) return 0
  const [match] = await matchRes.json()
  if (!match?.home_team_code || !match?.away_team_code) return 0

  const statsRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/team_stats?match_id=eq.${matchId}&select=*`,
    { headers: sb(env) }
  )
  if (!statsRes.ok) return 0
  const statsRows = await statsRes.json()
  const hs  = statsRows.find(s => s.team_code === match.home_team_code)
  const as_ = statsRows.find(s => s.team_code === match.away_team_code)
  if (!hs?.goals_scored_avg || !as_?.goals_scored_avg) return 0

  let v1, v2
  try {
    const vMult = getVenueMult(match.venue, match.city, match.home_team)
    v1 = calcLambdasV1(hs, as_, vMult)
    v2 = calcLambdasV2(hs, as_, vMult)
  } catch { return 0 }

  // Compute each model's matrix ONCE — λ values are consistent across all prediction types
  const matV1 = buildMatrix(v1.lambdaHome, v1.lambdaAway)
  const matV2 = buildMatrix(v2.lambdaHome, v2.lambdaAway)
  const pV1 = calcProbs(matV1)
  const pV2 = calcProbs(matV2)

  const actualOutcomeV = h > a ? 'H' : h < a ? 'A' : 'D'
  const Ih = actualOutcomeV === 'H' ? 1 : 0
  const Id = actualOutcomeV === 'D' ? 1 : 0
  const Ia = actualOutcomeV === 'A' ? 1 : 0

  // Use V2 as V3 proxy when DC data isn't available in fallback
  const brier = +((pV2.home - Ih)**2 + (pV2.draw - Id)**2 + (pV2.away - Ia)**2).toFixed(4)
  const rps   = +(0.5 * ((pV2.home - Ih)**2 + (pV2.home + pV2.draw - Ih - Id)**2)).toFixed(4)

  const row = {
    match_id: matchId,
    predicted_at: now,
    settled_at: now,
    actual_outcome: actualOutcomeV,
    v1_home_win:    +pV1.home.toFixed(3), v1_draw: +pV1.draw.toFixed(3), v1_away_win: +pV1.away.toFixed(3),
    v1_lambda_home: +v1.lambdaHome.toFixed(3), v1_lambda_away: +v1.lambdaAway.toFixed(3),
    v1_top_score:   topScore(matV1),
    v2_home_win:    +pV2.home.toFixed(3), v2_draw: +pV2.draw.toFixed(3), v2_away_win: +pV2.away.toFixed(3),
    v2_lambda_home: +v2.lambdaHome.toFixed(3), v2_lambda_away: +v2.lambdaAway.toFixed(3),
    v2_top_score:   topScore(matV2),
    correct_v1: topOutcome(pV1.home, pV1.draw, pV1.away) === actualOutcomeV,
    correct_v2: topOutcome(pV2.home, pV2.draw, pV2.away) === actualOutcomeV,
    brier_score: brier, rps_score: rps,
  }

  // Upsert: idempotent even if a partial row exists
  const ins = await fetch(
    `${env.SUPABASE_URL}/rest/v1/model_predictions?on_conflict=match_id`,
    {
      method: 'POST',
      headers: { ...sb(env), 'Content-Type': 'application/json', 'Prefer': 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(row),
    }
  )
  return ins.ok ? 1 : 0
}

// ── Handler ─────────────────────────────────────────────────────────────────

export async function onRequestPost(context) {
  const { request, env } = context
  if (!await verifyAdmin(request, env)) return res({ error: 'Forbidden — admin only' }, 403)

  let body
  try { body = await request.json() } catch { return res({ error: 'Invalid JSON' }, 400) }
  const { match_id, home_score, away_score, penalties_winner } = body
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

  // Propagate winner to next knockout round (non-blocking)
  let propagated = null
  try {
    const mRes = await fetch(
      `${env.SUPABASE_URL}/rest/v1/matches?id=eq.${match_id}&select=home_team,away_team,group_name,match_date`,
      { headers: sb(env) }
    )
    if (mRes.ok) {
      const [m] = await mRes.json()
      if (m?.group_name === null) {
        const winner = home_score > away_score ? m.home_team
                     : away_score > home_score ? m.away_team
                     : (penalties_winner ?? null)
        if (winner) {
          await propagateWinner(env, match_id, m.match_date, winner)
          propagated = winner
        }
      }
    }
  } catch { /* never block settle */ }

  return res({ success: true, match_id, home_score, away_score, pending: pending.length, settled, roles_scored, model_predictions_scored, propagated })
}
