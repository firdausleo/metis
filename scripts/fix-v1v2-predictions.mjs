/**
 * scripts/fix-v1v2-predictions.mjs
 *
 * Recomputes v1_* and v2_* columns for ALL finished matches using
 * the canonical simplified Poisson formula (no home advantage, no xG blend):
 *
 *   V1: λ_h = home_scored_avg × away_conceded_avg
 *       λ_a = away_scored_avg × home_conceded_avg
 *       matrix = pure Poisson (no DC tau)
 *
 *   V2: λ_h unchanged
 *       λ_a_v2 = λ_a_v1 × 0.85  (away penalty)
 *
 * Logs V1 vs V3 lambda divergence for every match.
 *
 * Usage:
 *   HTTPS_PROXY=http://127.0.0.1:7890 node scripts/fix-v1v2-predictions.mjs
 *   HTTPS_PROXY=http://127.0.0.1:7890 node scripts/fix-v1v2-predictions.mjs --commit
 *
 * Default: dry-run. Pass --commit to apply UPDATEs.
 */

import { createClient } from '@supabase/supabase-js'
import { poissonPMF }   from '../src/lib/poisson.js'

// ── Config ────────────────────────────────────────────────────────────────

const SUPABASE_URL = 'https://wmxhcwellqtagpndpyhk.supabase.co'
const SERVICE_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndteGhjd2VsbHF0YWdwbmRweWhrIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MDgzODEzMSwiZXhwIjoyMDk2NDE0MTMxfQ.RvWIwMJ0Bm_2KQbvSeKV_yZQgU1_vTrPYkXHRavYHd4'

const supabase = createClient(SUPABASE_URL, SERVICE_KEY)
const COMMIT   = process.argv.includes('--commit')
const MG       = 8

// ── Pure Poisson matrix (no DC tau) ──────────────────────────────────────

function poissonMat(lh, la) {
  const M = []; let t = 0
  for (let x = 0; x <= MG; x++) {
    M[x] = []
    for (let y = 0; y <= MG; y++) {
      M[x][y] = poissonPMF(x, lh) * poissonPMF(y, la)
      t += M[x][y]
    }
  }
  if (t > 0) for (let x = 0; x <= MG; x++) for (let y = 0; y <= MG; y++) M[x][y] /= t
  return M
}

// 1X2 probs + argmax top score from any matrix
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

// ── Formatters ────────────────────────────────────────────────────────────

const r3 = x => Math.round(x * 1000) / 1000
const r4 = x => Math.round(x * 10000) / 10000
const f  = (x, w) => String(r3(x)).padEnd(w)

// ── Main ──────────────────────────────────────────────────────────────────

async function run() {
  console.log(`Mode: ${COMMIT ? '✅  COMMIT' : '🔍  DRY RUN — pass --commit to apply'}`)
  console.log(`Proxy: set HTTPS_PROXY=http://127.0.0.1:7890 in your shell if needed\n`)

  // 1. Fetch all finished matches
  const { data: matches, error: mErr } = await supabase
    .from('matches')
    .select('id, home_team, away_team, home_team_code, away_team_code, match_date')
    .eq('status', 'finished')
    .not('home_score', 'is', null)
    .order('match_date', { ascending: true })

  if (mErr) { console.error('❌ matches fetch failed:', mErr.message); process.exit(1) }
  if (!matches.length) { console.log('No finished matches found.'); return }

  const allIds = matches.map(m => m.id)

  // 2. Fetch team_stats and existing V3 lambdas in parallel
  const [statsRes, predsRes] = await Promise.all([
    supabase
      .from('team_stats')
      .select('match_id, team_code, goals_scored_avg, goals_conceded_avg')
      .in('match_id', allIds),
    supabase
      .from('model_predictions')
      .select('match_id, v3_lambda_home, v3_lambda_away')
      .in('match_id', allIds),
  ])

  if (statsRes.error)  { console.error('❌ team_stats fetch failed:', statsRes.error.message); process.exit(1) }
  if (predsRes.error)  { console.error('❌ model_predictions fetch failed:', predsRes.error.message); process.exit(1) }

  // Build lookup indexes
  const statsIdx = {}
  for (const r of (statsRes.data || [])) {
    if (!statsIdx[r.match_id]) statsIdx[r.match_id] = {}
    statsIdx[r.match_id][r.team_code] = r
  }
  const predsIdx = {}
  for (const r of (predsRes.data || [])) predsIdx[r.match_id] = r

  console.log(`Matches: ${matches.length}  |  Stats rows: ${(statsRes.data || []).length}\n`)

  // Table header
  console.log(
    'Home'.padEnd(22) + 'Away'.padEnd(22) +
    '  lhV1   laV1   lhV3   laV3   ΔlhV1-V3  top_v1 top_v2  hwV1   d_v1   awV1'
  )
  console.log('─'.repeat(122))

  const updates = []
  let skipped = 0

  for (const m of matches) {
    const ms  = statsIdx[m.id] || {}
    const hs  = ms[m.home_team_code]
    const as_ = ms[m.away_team_code]

    if (!hs?.goals_scored_avg || !hs?.goals_conceded_avg ||
        !as_?.goals_scored_avg || !as_?.goals_conceded_avg) {
      console.log(`  [SKIP no-stats] ${m.home_team} vs ${m.away_team}`)
      skipped++
      continue
    }

    // V1: raw product of attack average × opponent defence average, capped at 4.0
    const lhV1 = Math.min(Math.max(hs.goals_scored_avg  * as_.goals_conceded_avg, 0.01), 4.0)
    const laV1 = Math.min(Math.max(as_.goals_scored_avg  * hs.goals_conceded_avg,  0.01), 4.0)

    // V2: same λ_h, away team gets 0.85 penalty, cap retained
    const lhV2 = lhV1
    const laV2 = Math.min(Math.max(laV1 * 0.85, 0.01), 4.0)

    const matV1 = poissonMat(lhV1, laV1)
    const matV2 = poissonMat(lhV2, laV2)
    const sV1   = matStats(matV1)
    const sV2   = matStats(matV2)

    // Compare with existing V3 lambdas (divergence diagnostic)
    const existing = predsIdx[m.id]
    const lhV3_db  = existing?.v3_lambda_home != null ? Number(existing.v3_lambda_home) : null
    const laV3_db  = existing?.v3_lambda_away != null ? Number(existing.v3_lambda_away) : null
    const dLh = lhV3_db != null ? r3(lhV1 - lhV3_db) : null
    const dLa = laV3_db != null ? r3(laV1 - laV3_db) : null

    console.log(
      `${m.home_team.padEnd(22)}${m.away_team.padEnd(22)}` +
      `  ${f(lhV1, 6)} ${f(laV1, 6)}` +
      `  ${lhV3_db != null ? f(lhV3_db, 6) : 'N/A   '}` +
      `  ${laV3_db != null ? f(laV3_db, 6) : 'N/A   '}` +
      `  ${dLh != null ? String(dLh >= 0 ? '+' + dLh : dLh).padEnd(9) : 'N/A      '}` +
      `  ${sV1.topScore.padEnd(5)}  ${sV2.topScore.padEnd(5)}` +
      `  ${f(sV1.home, 6)} ${f(sV1.draw, 6)} ${f(sV1.away, 6)}`
    )

    updates.push({
      matchId: m.id,
      label:   `${m.home_team} vs ${m.away_team}`,
      payload: {
        v1_lambda_home: r3(lhV1),
        v1_lambda_away: r3(laV1),
        v1_home_win:    r4(sV1.home),
        v1_draw:        r4(sV1.draw),
        v1_away_win:    r4(sV1.away),
        v1_top_score:   sV1.topScore,
        v2_lambda_home: r3(lhV2),
        v2_lambda_away: r3(laV2),
        v2_home_win:    r4(sV2.home),
        v2_draw:        r4(sV2.draw),
        v2_away_win:    r4(sV2.away),
        v2_top_score:   sV2.topScore,
      },
    })
  }

  console.log('─'.repeat(122))
  console.log(`\n${updates.length} to update  |  ${skipped} skipped (no team stats)`)

  if (!COMMIT) {
    console.log(`\n[DRY RUN] ${updates.length} rows would be updated — no changes made.`)
    console.log('Rerun with --commit to apply.')
    return
  }

  // Apply UPDATEs
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
}

run().catch(e => { console.error(e); process.exit(1) })
