/**
 * scripts/fix-correct-flags.mjs
 *
 * Recomputes correct_v1/v2/v3/v4 for all finished matches using
 * direction-only logic (H/D/A argmax vs actual outcome).
 *
 * Usage:
 *   HTTPS_PROXY=http://127.0.0.1:7890 node scripts/fix-correct-flags.mjs
 *   HTTPS_PROXY=http://127.0.0.1:7890 node scripts/fix-correct-flags.mjs --commit
 *
 * Default: dry-run. Pass --commit to apply.
 */

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://wmxhcwellqtagpndpyhk.supabase.co'
const SERVICE_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndteGhjd2VsbHF0YWdwbmRweWhrIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MDgzODEzMSwiZXhwIjoyMDk2NDE0MTMxfQ.RvWIwMJ0Bm_2KQbvSeKV_yZQgU1_vTrPYkXHRavYHd4'

const supabase = createClient(SUPABASE_URL, SERVICE_KEY)
const COMMIT   = process.argv.includes('--commit')

function topOutcome(hw, d, aw) {
  if (hw == null || d == null || aw == null) return null
  if (hw >= d && hw >= aw) return 'H'
  if (aw >= d) return 'A'
  return 'D'
}

function actualOutcome(homeScore, awayScore) {
  if (homeScore == null || awayScore == null) return null
  if (homeScore > awayScore) return 'H'
  if (awayScore > homeScore) return 'A'
  return 'D'
}

async function run() {
  console.log(`Mode: ${COMMIT ? '✅  COMMIT' : '🔍  DRY RUN — pass --commit to apply'}\n`)

  // Fetch finished matches joined with their predictions
  const { data: matches, error: mErr } = await supabase
    .from('matches')
    .select('id, home_team, away_team, home_score, away_score')
    .eq('status', 'finished')
    .not('home_score', 'is', null)
    .not('away_score', 'is', null)

  if (mErr) { console.error('❌ matches fetch failed:', mErr.message); process.exit(1) }
  if (!matches.length) { console.log('No finished matches.'); return }

  const allIds = matches.map(m => m.id)

  const { data: preds, error: pErr } = await supabase
    .from('model_predictions')
    .select([
      'match_id',
      'v1_home_win', 'v1_draw', 'v1_away_win',
      'v2_home_win', 'v2_draw', 'v2_away_win',
      'v3_home_win', 'v3_draw', 'v3_away_win',
      'v4_home_win', 'v4_draw', 'v4_away_win',
      'v3_top_score', 'v3_top_score_2', 'v3_top_score_3',
      'correct_v1', 'correct_v2', 'correct_v3', 'correct_v4',
    ].join(','))
    .in('match_id', allIds)

  if (pErr) { console.error('❌ predictions fetch failed:', pErr.message); process.exit(1) }

  const predsIdx = {}
  for (const p of (preds || [])) predsIdx[p.match_id] = p

  const matchIdx = {}
  for (const m of matches) matchIdx[m.id] = m

  const updates = []
  let changesV3 = 0

  console.log('Changes to correct_v3:')
  console.log('─'.repeat(90))

  for (const m of matches) {
    const p = predsIdx[m.id]
    if (!p) continue

    const actual = actualOutcome(Number(m.home_score), Number(m.away_score))

    const newV1 = v1Flag(p, actual)
    const newV2 = v2Flag(p, actual)
    const newV3 = v3Flag(p, actual)
    const newV4 = v4Flag(p, actual)
    const actualScore = `${Number(m.home_score)}-${Number(m.away_score)}`
    const newV3Top3 = top3Flag(p.v3_top_score, p.v3_top_score_2, p.v3_top_score_3, actualScore)

    // Report every match where correct_v3 changes
    const oldV3 = p.correct_v3
    if (newV3 !== oldV3) {
      changesV3++
      const hw = p.v3_home_win != null ? Number(p.v3_home_win).toFixed(3) : 'null'
      const d  = p.v3_draw     != null ? Number(p.v3_draw).toFixed(3)     : 'null'
      const aw = p.v3_away_win != null ? Number(p.v3_away_win).toFixed(3) : 'null'
      const pred = topOutcome(p.v3_home_win, p.v3_draw, p.v3_away_win)
      console.log(
        `${m.home_team} vs ${m.away_team}: correct_v3 ${String(oldV3).padEnd(5)} → ${String(newV3).padEnd(5)}` +
        `  (hw=${hw} d=${d} aw=${aw} pred=${pred ?? 'null'} actual=${actual})`
      )
    }

    updates.push({
      matchId: m.id,
      payload: { correct_v1: newV1, correct_v2: newV2, correct_v3: newV3, correct_v4: newV4, correct_v3_top3: newV3Top3 },
    })
  }

  console.log('─'.repeat(90))
  console.log(`\ncorrect_v3 changes: ${changesV3} / ${updates.length} matches`)

  // Tally per-model counts for dry-run summary
  let v1t = 0, v2t = 0, v3t = 0, v4t = 0, v3top3t = 0, v1n = 0, v3n = 0, v3t3n = 0
  for (const { payload } of updates) {
    if (payload.correct_v1       === true) v1t++
    if (payload.correct_v2       === true) v2t++
    if (payload.correct_v3       === true) v3t++
    if (payload.correct_v4       === true) v4t++
    if (payload.correct_v3_top3  === true) v3top3t++
    if (payload.correct_v1       == null)  v1n++
    if (payload.correct_v3       == null)  v3n++
    if (payload.correct_v3_top3  == null)  v3t3n++
  }
  const total = updates.length
  console.log(`\nProjected accuracy after commit (${total} finished matches):`)
  console.log(`  V1 direction:  ${v1t}/${total - v1n} = ${pct(v1t, total - v1n)}%  (${v1n} null)`)
  console.log(`  V2 direction:  ${v2t}/${total - v1n} = ${pct(v2t, total - v1n)}%`)
  console.log(`  V3 direction:  ${v3t}/${total - v3n} = ${pct(v3t, total - v3n)}%  (${v3n} null)`)
  console.log(`  V4 direction:  ${v4t}/${total - v3n} = ${pct(v4t, total - v3n)}%`)
  console.log(`  V3 top-3 score: ${v3top3t}/${total - v3t3n} = ${pct(v3top3t, total - v3t3n)}%  (${v3t3n} null)`)

  if (!COMMIT) {
    console.log(`\n[DRY RUN] No changes made. Rerun with --commit to apply.`)
    return
  }

  console.log(`\nApplying ${updates.length} UPDATEs…`)
  let ok = 0, fail = 0
  for (const { matchId, payload } of updates) {
    const m = matchIdx[matchId]
    const { error } = await supabase
      .from('model_predictions')
      .update(payload)
      .eq('match_id', matchId)
    if (error) { console.error(`  ❌ ${m.home_team} vs ${m.away_team}: ${error.message}`); fail++ }
    else ok++
  }
  console.log(`\n✅ ${ok} updated  |  ❌ ${fail} failed`)
}

function top3Flag(s1, s2, s3, actual) {
  if (!s1 && !s2 && !s3) return null
  return s1 === actual || s2 === actual || s3 === actual
}

function v1Flag(p, actual) {
  const pred = topOutcome(p.v1_home_win, p.v1_draw, p.v1_away_win)
  return pred == null ? null : pred === actual
}
function v2Flag(p, actual) {
  const pred = topOutcome(p.v2_home_win, p.v2_draw, p.v2_away_win)
  return pred == null ? null : pred === actual
}
function v3Flag(p, actual) {
  const pred = topOutcome(p.v3_home_win, p.v3_draw, p.v3_away_win)
  return pred == null ? null : pred === actual
}
function v4Flag(p, actual) {
  const pred = topOutcome(p.v4_home_win, p.v4_draw, p.v4_away_win)
  return pred == null ? null : pred === actual
}

function pct(n, d) { return d > 0 ? (100 * n / d).toFixed(1) : 'N/A' }

run().catch(e => { console.error(e); process.exit(1) })
