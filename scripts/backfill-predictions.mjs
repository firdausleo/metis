// Backfill model_predictions for all finished matches missing v3_lambda_home
import { createClient } from '@supabase/supabase-js'
import { dcLambdas, isWC2026Host } from '../src/utils/dcRatings.js'
import { poissonPMF } from '../src/lib/poisson.js'

const SUPABASE_URL = 'https://wmxhcwellqtagpndpyhk.supabase.co'
const SERVICE_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndteGhjd2VsbHF0YWdwbmRweWhrIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MDgzODEzMSwiZXhwIjoyMDk2NDE0MTMxfQ.RvWIwMJ0Bm_2KQbvSeKV_yZQgU1_vTrPYkXHRavYHd4'
const supabase = createClient(SUPABASE_URL, SERVICE_KEY)

// ── Matrix helpers ────────────────────────────────────────────────────────────
const RHO = -0.0612
const MG  = 8

function tau(x, y, lh, la) {
  if (x === 0 && y === 0) return 1 - lh * la * RHO
  if (x === 0 && y === 1) return 1 + lh * RHO
  if (x === 1 && y === 0) return 1 + la * RHO
  if (x === 1 && y === 1) return 1 - RHO
  return 1
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

function blendMat(dc, v1) {
  const M = []; let t = 0
  for (let x = 0; x <= MG; x++) {
    M[x] = []
    for (let y = 0; y <= MG; y++) { M[x][y] = 0.65 * dc[x][y] + 0.35 * v1[x][y]; t += M[x][y] }
  }
  if (t > 0) for (let x = 0; x <= MG; x++) for (let y = 0; y <= MG; y++) M[x][y] /= t
  return M
}

function matStats(M) {
  let homeWin = 0, draw = 0, awayWin = 0
  const totals = new Array(MG * 2 + 1).fill(0)
  let topScore = '0-0', topP = 0
  for (let x = 0; x <= MG; x++) {
    for (let y = 0; y <= MG; y++) {
      const p = M[x][y]
      if (x > y) homeWin += p
      else if (x === y) draw += p
      else awayWin += p
      totals[x + y] += p
      if (p > topP) { topP = p; topScore = `${x}-${y}` }
    }
  }
  let anchor = 0
  for (let k = 1; k <= MG * 2; k++) if (totals[k] > totals[anchor]) anchor = k
  return { homeWin, draw, awayWin, anchor, topScore }
}

function computePayload(home, away, homeScore, awayScore) {
  const homeIsHost = isWC2026Host(home)
  const { lh, la } = dcLambdas(home, away, homeIsHost)

  const dc  = dcMat(lh, la)
  const v1  = v1Mat(lh, la)
  const v3  = blendMat(dc, v1)
  const s   = matStats(v3)

  const dominant = s.homeWin >= s.draw && s.homeWin >= s.awayWin ? 'H'
                 : s.awayWin > s.homeWin && s.awayWin >= s.draw  ? 'A' : 'D'
  const actual_outcome = homeScore > awayScore ? 'H' : homeScore < awayScore ? 'A' : 'D'
  const correct_v3 = dominant === actual_outcome

  return {
    lh: Math.round(lh * 1000) / 1000,
    la: Math.round(la * 1000) / 1000,
    homeIsHost,
    dominant,
    actual_outcome,
    correct_v3,
    payload: {
      v3_lambda_home: Math.round(lh * 1000) / 1000,
      v3_lambda_away: Math.round(la * 1000) / 1000,
      v3_home_win:    Math.round(s.homeWin * 10000) / 10000,
      v3_draw:        Math.round(s.draw    * 10000) / 10000,
      v3_away_win:    Math.round(s.awayWin * 10000) / 10000,
      v1_home_win:    Math.round(s.homeWin * 10000) / 10000,
      v1_draw:        Math.round(s.draw    * 10000) / 10000,
      v1_away_win:    Math.round(s.awayWin * 10000) / 10000,
      anchor_total:   s.anchor,
      v3_top_score:   s.topScore,
      correct_v3,
      actual_outcome,
      model_version:  'v3-dc-only',
    },
  }
}

async function run() {
  // ── Step 1: Fetch all finished matches ────────────────────────────────────
  console.log('Fetching finished matches…')
  const { data: finished, error: matchErr } = await supabase
    .from('matches')
    .select('id, home_team, away_team, home_score, away_score, match_date, group_name')
    .eq('status', 'finished')
    .order('match_date', { ascending: true })

  if (matchErr) { console.error('matches fetch failed:', matchErr.message); process.exit(1) }
  console.log(`Total finished matches: ${finished.length}`)

  // ── Step 2: Find which need work ─────────────────────────────────────────
  const finishedIds = finished.map(m => m.id)

  // Any prediction row for these matches (any model_version)
  const { data: anyRows, error: predErr } = await supabase
    .from('model_predictions')
    .select('match_id, model_version, v3_lambda_home')
    .in('match_id', finishedIds)

  if (predErr) { console.error('predictions fetch failed:', predErr.message); process.exit(1) }

  // match_id → row (keyed; one row per match_id due to unique constraint)
  const rowByMatchId = {}
  for (const r of (anyRows || [])) rowByMatchId[r.match_id] = r

  // Categorise each finished match
  const needsInsert = []  // no row at all
  const needsUpdate = []  // row exists but v3_lambda_home is null

  for (const m of finished) {
    const row = rowByMatchId[m.id]
    if (!row) {
      needsInsert.push(m)
    } else if (row.v3_lambda_home == null) {
      needsUpdate.push(m)
    }
    // else: already has lambdas — skip
  }

  const toProcess = [...needsUpdate, ...needsInsert]

  const hasAnyRow = Object.keys(rowByMatchId).length
  const alreadyDone = finished.length - needsInsert.length - needsUpdate.length
  console.log(`Any prediction row exists:    ${hasAnyRow}`)
  console.log(`Already have lambdas (skip):  ${alreadyDone}`)
  console.log(`Rows needing lambda UPDATE:   ${needsUpdate.length}`)
  console.log(`Rows with no record (INSERT): ${needsInsert.length}`)
  console.log(`Total to process:             ${toProcess.length}\n`)

  if (toProcess.length === 0) {
    console.log('Nothing to do — all finished matches already have lambdas.')
    return
  }

  // ── Step 3: Process each match ────────────────────────────────────────────
  const results = []
  let okCount = 0, failCount = 0, warnCount = 0

  for (const m of toProcess) {
    if (m.home_score == null || m.away_score == null) {
      console.log(`⚠ SKIP  ${m.home_team} vs ${m.away_team} — no score recorded`)
      warnCount++
      continue
    }

    let c
    try {
      c = computePayload(m.home_team, m.away_team, m.home_score, m.away_score)
    } catch (err) {
      console.error(`❌ compute error ${m.home_team} vs ${m.away_team}: ${err.message}`)
      failCount++
      continue
    }

    const tag = `${m.home_team.padEnd(16)} vs ${m.away_team.padEnd(16)}`
    const op  = rowByMatchId[m.id] ? 'UPDATE' : 'INSERT'

    let error
    if (op === 'UPDATE') {
      const { error: e } = await supabase
        .from('model_predictions')
        .update(c.payload)   // payload already includes model_version: 'v3-dc-only'
        .eq('match_id', m.id)
      error = e
    } else {
      const { error: e } = await supabase
        .from('model_predictions')
        .insert({
          match_id:        m.id,
          ...c.payload,
          quality_warning: false,
          predicted_at:    m.match_date || new Date().toISOString(),
        })
      error = e
    }

    const ok = !error
    if (ok) okCount++; else failCount++

    results.push({
      op, match: `${m.home_team} vs ${m.away_team}`,
      date: (m.match_date || '').slice(0, 10),
      lh: c.lh, la: c.la,
      host: c.homeIsHost,
      dominant: c.dominant,
      actual: c.actual_outcome,
      correct: c.correct_v3,
      ok,
      err: error?.message,
    })

    const status = ok ? '✅' : `❌ ${error.message}`
    console.log(`${op} ${tag}  lh=${c.lh} la=${c.la}  dom:${c.dominant} act:${c.actual_outcome} ✓:${c.correct_v3}  ${status}`)
  }

  // ── Step 4: Summary table ─────────────────────────────────────────────────
  console.log('\n' + '─'.repeat(100))
  console.log('RESULTS TABLE')
  console.log('─'.repeat(100))
  console.log('Op     | Date       | Match                                    | lh    | la    | Dom | Act | Correct')
  console.log('─'.repeat(100))
  for (const r of results) {
    const matchPad = r.match.padEnd(40)
    const status   = r.ok ? (r.correct ? ' ✓  ' : ' ✗  ') : ' ERR'
    console.log(`${r.op.padEnd(6)} | ${r.date} | ${matchPad} | ${String(r.lh).padEnd(5)} | ${String(r.la).padEnd(5)} | ${r.dominant}   | ${r.actual}   |${status}${r.err ? ' ' + r.err : ''}`)
  }
  console.log('─'.repeat(100))
  console.log(`Processed: ${toProcess.length} | ✅ ${okCount} | ❌ ${failCount} | ⚠ ${warnCount}\n`)

  // ── Verification ─────────────────────────────────────────────────────────
  const { count } = await supabase
    .from('model_predictions')
    .select('*', { count: 'exact', head: true })
    .not('v3_lambda_home', 'is', null)
    .eq('model_version', 'v3-dc-only')

  console.log(`v3-dc-only rows with v3_lambda_home NOT NULL: ${count}`)

  const { count: totalFinished } = await supabase
    .from('matches')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'finished')

  console.log(`Total finished matches: ${totalFinished}`)
  console.log(count >= totalFinished ? `✅ Full coverage` : `⚠ Gap: ${totalFinished - count} finished matches still missing predictions`)
}

run().catch(e => { console.error(e); process.exit(1) })
