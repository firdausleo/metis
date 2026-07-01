/**
 * scripts/fix-v3-predictions.mjs
 *
 * Recomputes v3_lambda_home/away, v3_home_win/draw/away_win, v3_top_score
 * for ALL finished matches from scratch using the single correct code path:
 *
 *   V3 matrix = 0.65 × dcMat(lhDC, laDC) + 0.35 × v1Mat(lhV1, laV1)
 *
 * Where:
 *   dcMat  = Poisson(x, lhDC) × Poisson(y, laDC) × tau(x,y,lhDC,laDC), normalised
 *   v1Mat  = Poisson(x, lhV1) × Poisson(y, laV1), normalised
 *   lhDC/laDC = dcLambdas(home, away, homeIsHost)
 *   lhV1/laV1 = predLambdasV1(homeStats, awayStats) from team_stats table
 *               falls back to lhDC/laDC when team stats are missing
 *
 * Probabilities and top_score are both extracted from the SAME blended matrix,
 * so they are always consistent. No temperature scaling applied.
 *
 * Usage:
 *   HTTPS_PROXY=http://127.0.0.1:7890 node scripts/fix-v3-predictions.mjs
 *   HTTPS_PROXY=http://127.0.0.1:7890 node scripts/fix-v3-predictions.mjs --commit
 *
 * Default: dry-run (prints what would be written, touches nothing).
 * Pass --commit to apply UPDATEs to model_predictions.
 *
 * Note: correct_v3 and V4 columns are NOT updated here.
 * Run v4-build.mjs and re-settle each match after committing this fix.
 */

import { createClient }        from '@supabase/supabase-js'
import { dcLambdas, isWC2026Host } from '../src/utils/dcRatings.js'
import { poissonPMF }          from '../src/lib/poisson.js'

// ── Config ────────────────────────────────────────────────────────────────

const SUPABASE_URL = 'https://wmxhcwellqtagpndpyhk.supabase.co'
const SERVICE_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndteGhjd2VsbHF0YWdwbmRweWhrIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MDgzODEzMSwiZXhwIjoyMDk2NDE0MTMxfQ.RvWIwMJ0Bm_2KQbvSeKV_yZQgU1_vTrPYkXHRavYHd4'

const supabase = createClient(SUPABASE_URL, SERVICE_KEY)
const COMMIT   = process.argv.includes('--commit')

// ── Matrix constants ──────────────────────────────────────────────────────

const RHO = -0.0612   // DC_PARAMS.rho — matches dcRatings.js exactly
const MG  = 8

// ── V1 lambda constants ───────────────────────────────────────────────────

const LEAGUE_AVG = 1.5
const DEF_MIN    = 0.5
const DEF_MAX    = 1.8

// ── Matrix builders ───────────────────────────────────────────────────────

function tau(x, y, lh, la) {
  if (x === 0 && y === 0) return 1 - lh * la * RHO
  if (x === 0 && y === 1) return 1 + lh * RHO
  if (x === 1 && y === 0) return 1 + la * RHO
  if (x === 1 && y === 1) return 1 - RHO
  return 1
}

// Dixon-Coles matrix: Poisson × tau, normalised
function dcMat(lh, la) {
  const M = []; let t = 0
  for (let x = 0; x <= MG; x++) {
    M[x] = []
    for (let y = 0; y <= MG; y++) {
      M[x][y] = Math.max(poissonPMF(x, lh) * poissonPMF(y, la) * tau(x, y, lh, la), 0)
      t += M[x][y]
    }
  }
  if (t > 0) for (let x = 0; x <= MG; x++) for (let y = 0; y <= MG; y++) M[x][y] /= t
  return M
}

// Pure Poisson matrix, normalised
function v1Mat(lh, la) {
  const M = []; let t = 0
  for (let x = 0; x <= MG; x++) {
    M[x] = []
    for (let y = 0; y <= MG; y++) { M[x][y] = poissonPMF(x, lh) * poissonPMF(y, la); t += M[x][y] }
  }
  if (t > 0) for (let x = 0; x <= MG; x++) for (let y = 0; y <= MG; y++) M[x][y] /= t
  return M
}

// 65% DC + 35% V1, renormalised
function blendMat(dc, v1) {
  const M = []; let t = 0
  for (let x = 0; x <= MG; x++) {
    M[x] = []
    for (let y = 0; y <= MG; y++) { M[x][y] = 0.65 * dc[x][y] + 0.35 * v1[x][y]; t += M[x][y] }
  }
  if (t > 0) for (let x = 0; x <= MG; x++) for (let y = 0; y <= MG; y++) M[x][y] /= t
  return M
}

// Extract 1X2 probs + top score from a matrix (no temperature scaling)
function matStats(M) {
  let home = 0, draw = 0, away = 0, topP = 0, topScore = '0-0'
  for (let x = 0; x <= MG; x++) {
    for (let y = 0; y <= MG; y++) {
      const p = M[x][y]
      if (x > y) home += p
      else if (x === y) draw += p
      else away += p
      if (p > topP) { topP = p; topScore = `${x}-${y}` }
    }
  }
  return { home, draw, away, topScore }
}

// ── V1 lambda computation from team_stats ─────────────────────────────────

function blendInput(xg, goals) {
  if (xg == null) return goals
  if (xg < 0.3 && goals > 0.8) return goals
  return xg * 0.6 + goals * 0.4
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)) }

function predLambdasV1(hs, as_, vMult) {
  const bothXgF = hs.xgf_per_game != null && as_.xgf_per_game != null
  const bothXgA = hs.xga_per_game != null && as_.xga_per_game != null
  const attH  = bothXgF ? blendInput(hs.xgf_per_game,  hs.goals_scored_avg)  : hs.goals_scored_avg
  const attA  = bothXgF ? blendInput(as_.xgf_per_game, as_.goals_scored_avg) : as_.goals_scored_avg
  const defHI = bothXgA ? blendInput(hs.xga_per_game,  hs.goals_conceded_avg) : hs.goals_conceded_avg
  const defAI = bothXgA ? blendInput(as_.xga_per_game, as_.goals_conceded_avg) : as_.goals_conceded_avg
  const dHF = clamp(LEAGUE_AVG / defHI, DEF_MIN, DEF_MAX)
  const dAF = clamp(LEAGUE_AVG / defAI, DEF_MIN, DEF_MAX)
  return {
    lambdaHome: Math.max(attH * dAF * vMult, 0.01),
    lambdaAway: Math.max(attA * dHF, 0.01),
  }
}

function venueMult(homeTeam) {
  const t = (homeTeam || '').toLowerCase().trim()
  if (t === 'mexico') return 1.35
  if (t === 'canada') return 1.05
  if (t === 'usa')    return 1.10
  return 1.0
}

// ── Formatters ────────────────────────────────────────────────────────────

const r3 = x => Math.round(x * 1000) / 1000
const r4 = x => Math.round(x * 10000) / 10000

// ── Main ──────────────────────────────────────────────────────────────────

async function run() {
  console.log(`Mode: ${COMMIT ? '✅  COMMIT' : '🔍  DRY RUN — pass --commit to apply'}`)
  console.log(`Proxy: set HTTPS_PROXY=http://127.0.0.1:7890 in your shell if needed\n`)

  // 1. Fetch all finished matches with scores
  const { data: matches, error: mErr } = await supabase
    .from('matches')
    .select('id, home_team, away_team, home_team_code, away_team_code, home_score, away_score, match_date, venue, city')
    .eq('status', 'finished')
    .not('home_score', 'is', null)
    .not('away_score', 'is', null)
    .order('match_date', { ascending: true })

  if (mErr) { console.error('❌ matches fetch failed:', mErr.message); process.exit(1) }
  if (!matches.length) { console.log('No finished matches found.'); return }
  console.log(`Finished matches: ${matches.length}`)

  // 2. Bulk-fetch team_stats for all these matches
  const allIds = matches.map(m => m.id)
  const { data: statsRows, error: sErr } = await supabase
    .from('team_stats')
    .select('match_id, team_code, goals_scored_avg, goals_conceded_avg, xgf_per_game, xga_per_game')
    .in('match_id', allIds)

  if (sErr) { console.error('❌ team_stats fetch failed:', sErr.message); process.exit(1) }

  // Index: matchId → teamCode → row
  const statsIdx = {}
  for (const r of (statsRows || [])) {
    if (!statsIdx[r.match_id]) statsIdx[r.match_id] = {}
    statsIdx[r.match_id][r.team_code] = r
  }
  console.log(`Team stats rows: ${(statsRows || []).length}\n`)

  // 3. Compute V3 for each match
  const updates = []
  let fullCount = 0, dcOnlyCount = 0

  console.log(
    'Home'.padEnd(22) + 'Away'.padEnd(22) +
    '  lhV3   laV3   top    hw      d       aw      src'
  )
  console.log('─'.repeat(105))

  for (const m of matches) {
    const homeIsHost           = isWC2026Host(m.home_team)
    const { lh: dcH, la: dcA } = dcLambdas(m.home_team, m.away_team, homeIsHost)

    // Team stats for this match
    const ms  = statsIdx[m.id] || {}
    const hs  = ms[m.home_team_code]
    const as_ = ms[m.away_team_code]

    const hasStats = !!(hs?.goals_scored_avg && hs?.goals_conceded_avg &&
                        as_?.goals_scored_avg && as_?.goals_conceded_avg)

    let lhV1 = dcH, laV1 = dcA, src = 'dc-only'
    if (hasStats) {
      try {
        const v1L = predLambdasV1(hs, as_, venueMult(m.home_team))
        lhV1 = v1L.lambdaHome
        laV1 = v1L.lambdaAway
        src  = 'dc+stats'
        fullCount++
      } catch (e) {
        src = 'dc-only(err)'
        dcOnlyCount++
      }
    } else {
      dcOnlyCount++
    }

    // Build matrices
    const dc = dcMat(dcH, dcA)
    const v1 = v1Mat(lhV1, laV1)
    const v3 = blendMat(dc, v1)

    // Probs + top score from the same blended matrix
    const { home, draw, away, topScore } = matStats(v3)

    // Stored lambdas: weighted average of the two sets
    const lhV3 = 0.65 * dcH + 0.35 * lhV1
    const laV3 = 0.65 * dcA + 0.35 * laV1

    const payload = {
      v3_lambda_home: r3(lhV3),
      v3_lambda_away: r3(laV3),
      v3_home_win:    r4(home),
      v3_draw:        r4(draw),
      v3_away_win:    r4(away),
      v3_top_score:   topScore,
    }

    updates.push({ matchId: m.id, label: `${m.home_team} vs ${m.away_team}`, payload })

    console.log(
      `${m.home_team.padEnd(22)}${m.away_team.padEnd(22)}` +
      `  ${String(r3(lhV3)).padEnd(6)} ${String(r3(laV3)).padEnd(6)}` +
      `  ${topScore.padEnd(5)}` +
      `  ${String(r3(home)).padEnd(6)}  ${String(r3(draw)).padEnd(6)}  ${String(r3(away)).padEnd(6)}` +
      `  ${src}`
    )
  }

  console.log('─'.repeat(105))
  console.log(`\n${fullCount} dc+stats  |  ${dcOnlyCount} dc-only`)

  if (!COMMIT) {
    console.log(`\n[DRY RUN] ${updates.length} rows would be updated — no changes made.`)
    console.log('Rerun with --commit to apply.')
    return
  }

  // 4. Apply UPDATEs
  console.log(`\nApplying ${updates.length} UPDATEs to model_predictions…`)
  let ok = 0, fail = 0

  for (const { matchId, label, payload } of updates) {
    const { error } = await supabase
      .from('model_predictions')
      .update(payload)
      .eq('match_id', matchId)
    if (error) { console.error(`  ❌ ${label}: ${error.message}`); fail++ }
    else ok++
  }

  console.log(`\n✅ ${ok} updated  |  ❌ ${fail} failed`)

  if (ok > 0) {
    console.log('\nNext steps:')
    console.log('  1. node scripts/v4-build.mjs        — regenerate V4 corrections from updated lambdas')
    console.log('  2. Re-settle each match via /api/settle-match to recompute correct_v3')
  }
}

run().catch(e => { console.error(e); process.exit(1) })
