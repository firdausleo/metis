/**
 * scripts/fix-top3-scores.mjs
 *
 * Backfills v3_top_score, v3_top_score_2, v3_top_score_3 for all finished
 * matches in model_predictions. Uses the same DC-blended matrix as
 * fix-v3-predictions.mjs so all three fields are internally consistent.
 *
 * Usage:
 *   HTTPS_PROXY=http://127.0.0.1:7890 node scripts/fix-top3-scores.mjs
 *   HTTPS_PROXY=http://127.0.0.1:7890 node scripts/fix-top3-scores.mjs --commit
 *
 * Default: dry-run (shows first 10 rows, no DB writes).
 * Pass --commit to apply UPDATEs to model_predictions.
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

const RHO = -0.0612
const MG  = 8

// ── V1 lambda constants ───────────────────────────────────────────────────

const LEAGUE_AVG = 1.5
const DEF_MIN    = 0.5
const DEF_MAX    = 1.8

// ── Matrix builders (identical to fix-v3-predictions.mjs) ─────────────────

function tau(x, y, lh, la) {
  if (x === 0 && y === 0) return 1 - lh * la * RHO
  if (x === 0 && y === 1) return 1 + lh * RHO
  if (x === 1 && y === 0) return 1 + la * RHO
  if (x === 1 && y === 1) return 1 - RHO
  return 1
}

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

function v1Mat(lh, la) {
  const M = []; let t = 0
  for (let x = 0; x <= MG; x++) {
    M[x] = []
    for (let y = 0; y <= MG; y++) { M[x][y] = poissonPMF(x, lh) * poissonPMF(y, la); t += M[x][y] }
  }
  if (t > 0) for (let x = 0; x <= MG; x++) for (let y = 0; y <= MG; y++) M[x][y] /= t
  return M
}

function blendMat(dc, v1) {
  const M = []; let t = 0
  for (let x = 0; x <= MG; x++) {
    M[x] = []
    for (let y = 0; y <= MG; y++) { M[x][y] = 0.65 * dc[x][y] + 0.35 * v1[x][y]; t += M[x][y] }
  }
  if (t > 0) for (let x = 0; x <= MG; x++) for (let y = 0; y <= MG; y++) M[x][y] /= t
  return M
}

// Returns [top1, top2, top3] scorelines from a matrix
function matTop3(M) {
  const cells = []
  for (let x = 0; x <= MG; x++)
    for (let y = 0; y <= MG; y++)
      cells.push({ s: `${x}-${y}`, p: M[x][y] })
  cells.sort((a, b) => b.p - a.p)
  return cells.slice(0, 3).map(c => c.s)
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

// ── Main ──────────────────────────────────────────────────────────────────

async function run() {
  console.log(`Mode: ${COMMIT ? '✅  COMMIT' : '🔍  DRY RUN (first 10 shown) — pass --commit to apply'}`)
  console.log(`Proxy: set HTTPS_PROXY=http://127.0.0.1:7890 in your shell if needed\n`)

  // 1. Fetch all finished matches
  const { data: matches, error: mErr } = await supabase
    .from('matches')
    .select('id, home_team, away_team, home_team_code, away_team_code, match_date')
    .eq('status', 'finished')
    .order('match_date', { ascending: true })

  if (mErr) { console.error('❌ matches fetch failed:', mErr.message); process.exit(1) }
  if (!matches.length) { console.log('No finished matches found.'); return }
  console.log(`Finished matches: ${matches.length}`)

  // 2. Fetch model_predictions to filter to rows that have V3 lambdas
  const allIds = matches.map(m => m.id)
  const { data: preds, error: pErr } = await supabase
    .from('model_predictions')
    .select('match_id, v3_lambda_home, v3_lambda_away')
    .in('match_id', allIds)
    .not('v3_lambda_home', 'is', null)

  if (pErr) { console.error('❌ predictions fetch failed:', pErr.message); process.exit(1) }
  const predSet = new Set((preds || []).map(p => p.match_id))
  console.log(`Predictions with V3 lambdas: ${predSet.size}`)

  // 3. Bulk-fetch team_stats
  const { data: statsRows, error: sErr } = await supabase
    .from('team_stats')
    .select('match_id, team_code, goals_scored_avg, goals_conceded_avg, xgf_per_game, xga_per_game')
    .in('match_id', allIds)

  if (sErr) { console.error('❌ team_stats fetch failed:', sErr.message); process.exit(1) }

  const statsIdx = {}
  for (const r of (statsRows || [])) {
    if (!statsIdx[r.match_id]) statsIdx[r.match_id] = {}
    statsIdx[r.match_id][r.team_code] = r
  }
  console.log(`Team stats rows: ${(statsRows || []).length}\n`)

  // 4. Compute top3 for each match that has a V3 prediction
  const updates = []
  let fullCount = 0, dcOnlyCount = 0

  console.log(
    'Home'.padEnd(22) + 'Away'.padEnd(22) +
    '  #1      #2      #3      src'
  )
  console.log('─'.repeat(97))

  for (const m of matches) {
    if (!predSet.has(m.id)) continue

    const homeIsHost            = isWC2026Host(m.home_team)
    const { lh: dcH, la: dcA } = dcLambdas(m.home_team, m.away_team, homeIsHost)

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
      } catch {
        src = 'dc-only(err)'
        dcOnlyCount++
      }
    } else {
      dcOnlyCount++
    }

    const dc = dcMat(dcH, dcA)
    const v1 = v1Mat(lhV1, laV1)
    const v3 = blendMat(dc, v1)
    const [s1, s2, s3] = matTop3(v3)

    if (updates.length < 10) {
      console.log(
        `${m.home_team.padEnd(22)}${m.away_team.padEnd(22)}` +
        `  ${s1.padEnd(6)} ${s2.padEnd(6)} ${s3.padEnd(6)} ${src}`
      )
    }

    updates.push({ matchId: m.id, s1, s2, s3 })
  }

  if (updates.length > 10) {
    console.log(`  … and ${updates.length - 10} more`)
  }
  console.log('─'.repeat(97))
  console.log(`\n${fullCount} dc+stats  |  ${dcOnlyCount} dc-only  |  ${updates.length} total`)

  if (!COMMIT) {
    console.log(`\n[DRY RUN] ${updates.length} rows would be updated — no changes made.`)
    console.log('Rerun with --commit to apply.')
    return
  }

  // 5. Apply UPDATEs
  console.log(`\nApplying ${updates.length} UPDATEs to model_predictions…`)
  let ok = 0, fail = 0

  for (const { matchId, s1, s2, s3 } of updates) {
    const { error } = await supabase
      .from('model_predictions')
      .update({ v3_top_score: s1, v3_top_score_2: s2, v3_top_score_3: s3 })
      .eq('match_id', matchId)
    if (error) { console.error(`  ❌ ${matchId}: ${error.message}`); fail++ }
    else ok++
  }

  console.log(`\n✅ ${ok} updated  |  ❌ ${fail} failed`)
}

run().catch(e => { console.error(e); process.exit(1) })
