/**
 * V4 Self-Correcting DC Model — build script
 *
 * Step A: Compute per-team bias corrections from WC2026 finished matches
 *         → UPSERT into team_wc_corrections
 *
 * Step B: Compute V4 lambdas for ALL matches with v3 predictions
 *         → UPDATE model_predictions with v4_* columns
 *
 * Run AFTER applying supabase/migrations/20260627_v4_model.sql
 *
 * Usage:
 *   node scripts/v4-build.mjs
 */

import { createClient } from '@supabase/supabase-js'
import { dcLambdas, isWC2026Host } from '../src/utils/dcRatings.js'
import { poissonPMF } from '../src/lib/poisson.js'

const SUPABASE_URL = 'https://wmxhcwellqtagpndpyhk.supabase.co'
const SERVICE_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndteGhjd2VsbHF0YWdwbmRweWhrIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MDgzODEzMSwiZXhwIjoyMDk2NDE0MTMxfQ.RvWIwMJ0Bm_2KQbvSeKV_yZQgU1_vTrPYkXHRavYHd4'
const supabase = createClient(SUPABASE_URL, SERVICE_KEY)

// ── Matrix helpers ─────────────────────────────────────────────────────────
const RHO = -0.0612
const MG  = 8

function tau(x, y, lh, la) {
  if (x === 0 && y === 0) return 1 - lh * la * RHO
  if (x === 0 && y === 1) return 1 + lh * RHO
  if (x === 1 && y === 0) return 1 + la * RHO
  if (x === 1 && y === 1) return 1 - RHO
  return 1
}

function buildMat(lh, la, useTau = false) {
  const M = []; let t = 0
  for (let x = 0; x <= MG; x++) {
    M[x] = []
    for (let y = 0; y <= MG; y++) {
      const v = poissonPMF(x, lh) * poissonPMF(y, la) * (useTau ? tau(x, y, lh, la) : 1)
      M[x][y] = Math.max(v, 0)
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

function matProbs(M) {
  let home = 0, draw = 0, away = 0
  for (let x = 0; x <= MG; x++)
    for (let y = 0; y <= MG; y++) {
      if (x > y) home += M[x][y]
      else if (x === y) draw += M[x][y]
      else away += M[x][y]
    }
  return { home, draw, away }
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)) }

// ── Step A: Compute team bias corrections ──────────────────────────────────
async function buildCorrections() {
  console.log('\n── Step A: Computing team bias corrections ──────────────────────')

  // Check if v4 columns exist yet
  const testRes = await supabase
    .from('model_predictions')
    .select('v4_lambda_home')
    .limit(1)
  if (testRes.error?.message?.includes('does not exist')) {
    console.error('❌ v4_lambda_home column missing.')
    console.error('   Run this SQL in Supabase SQL editor first:')
    console.error('   supabase/migrations/20260627_v4_model.sql')
    process.exit(1)
  }

  // Fetch all finished matches
  const { data: matches, error: mErr } = await supabase
    .from('matches')
    .select('id, home_team, away_team, home_score, away_score')
    .eq('status', 'finished')
    .not('home_score', 'is', null)
    .not('away_score', 'is', null)

  if (mErr) { console.error('matches fetch error:', mErr.message); process.exit(1) }
  console.log(`Finished matches with scores: ${matches.length}`)

  // Accumulate per-team observations
  const teamData = {}  // team_name → { actualGoals[], predictedLambdas[], opponentActual[], opponentLambdas[] }

  for (const m of matches) {
    const homeIsHost = isWC2026Host(m.home_team)
    const { lh, la } = dcLambdas(m.home_team, m.away_team, homeIsHost)
    const hGoals = Number(m.home_score)
    const aGoals = Number(m.away_score)

    if (!teamData[m.home_team]) teamData[m.home_team] = { actual: [], predicted: [], oppActual: [], oppPred: [] }
    if (!teamData[m.away_team]) teamData[m.away_team] = { actual: [], predicted: [], oppActual: [], oppPred: [] }

    teamData[m.home_team].actual.push(hGoals)
    teamData[m.home_team].predicted.push(lh)
    teamData[m.home_team].oppActual.push(aGoals)
    teamData[m.home_team].oppPred.push(la)

    teamData[m.away_team].actual.push(aGoals)
    teamData[m.away_team].predicted.push(la)
    teamData[m.away_team].oppActual.push(hGoals)
    teamData[m.away_team].oppPred.push(lh)
  }

  const corrRows = []
  const history = {}  // for match_history JSONB

  for (const [team, d] of Object.entries(teamData)) {
    const N = d.actual.length
    if (N === 0) continue

    const meanActual    = d.actual.reduce((s, v) => s + v, 0) / N
    const meanPredicted = d.predicted.reduce((s, v) => s + v, 0) / N
    const meanOppActual = d.oppActual.reduce((s, v) => s + v, 0) / N
    const meanOppPred   = d.oppPred.reduce((s, v) => s + v, 0) / N

    const attack_bias    = meanActual - meanPredicted
    const defense_bias   = meanOppActual - meanOppPred
    const confidence     = 1 - Math.exp(-N / 2)
    const lambda_mult_raw = meanPredicted > 0 ? meanActual / meanPredicted : 1.0
    const lambda_multiplier = clamp(lambda_mult_raw, 0.1, 3.0)

    const match_history = d.actual.map((goals, i) => ({
      actual: goals,
      predicted: Math.round(d.predicted[i] * 1000) / 1000,
      bias: Math.round((goals - d.predicted[i]) * 1000) / 1000,
    }))

    corrRows.push({
      team_name: team,
      tournament: 'WC2026',
      matches_played: N,
      attack_bias:    Math.round(attack_bias    * 10000) / 10000,
      defense_bias:   Math.round(defense_bias   * 10000) / 10000,
      confidence:     Math.round(confidence     * 10000) / 10000,
      lambda_multiplier: Math.round(lambda_multiplier * 10000) / 10000,
      last_updated:   new Date().toISOString(),
      match_history,
    })

    history[team] = { N, attack_bias: Math.round(attack_bias * 1000) / 1000, confidence: Math.round(confidence * 100) / 100 }
  }

  console.log(`Teams with corrections: ${corrRows.length}`)
  console.table(Object.entries(history).map(([t, d]) => ({
    team: t.padEnd(20), N: d.N, attack_bias: d.attack_bias, confidence: d.confidence
  })))

  // UPSERT into team_wc_corrections
  const { error: uErr } = await supabase
    .from('team_wc_corrections')
    .upsert(corrRows, { onConflict: 'team_name' })

  if (uErr) { console.error('upsert error:', uErr.message); process.exit(1) }
  console.log(`✅ Upserted ${corrRows.length} team corrections`)

  return corrRows
}

// ── Step B: Compute V4 lambdas for all prediction rows ────────────────────
async function applyV4(corrRows) {
  console.log('\n── Step B: Computing V4 lambdas for all predictions ──────────────')

  const corrByTeam = {}
  for (const c of corrRows) corrByTeam[c.team_name] = c

  // Fetch all matches with v3 predictions
  const { data: preds, error: pErr } = await supabase
    .from('model_predictions')
    .select('match_id, v3_lambda_home, v3_lambda_away')
    .not('v3_lambda_home', 'is', null)

  if (pErr) { console.error('predictions fetch error:', pErr.message); process.exit(1) }
  console.log(`Prediction rows to process: ${preds.length}`)

  // Fetch match team names for all these matches
  const matchIds = preds.map(p => p.match_id)
  const { data: matchRows, error: mErr2 } = await supabase
    .from('matches')
    .select('id, home_team, away_team, home_score, away_score, status')
    .in('id', matchIds)

  if (mErr2) { console.error('matches fetch error:', mErr2.message); process.exit(1) }
  const matchById = {}
  for (const m of matchRows) matchById[m.id] = m

  let ok = 0, fail = 0
  const updates = []

  for (const pred of preds) {
    const m = matchById[pred.match_id]
    if (!m) { fail++; continue }

    const lhV3 = Number(pred.v3_lambda_home)
    const laV3 = Number(pred.v3_lambda_away)

    const hCorr = corrByTeam[m.home_team]
    const aCorr = corrByTeam[m.away_team]

    const hBias = (hCorr?.confidence ?? 0) * (hCorr?.attack_bias ?? 0)
    const aBias = (aCorr?.confidence ?? 0) * (aCorr?.attack_bias ?? 0)

    const lhV4 = clamp(lhV3 + hBias, 0.20, 5.0)
    const laV4 = clamp(laV3 + aBias, 0.20, 5.0)

    // Build V4 DC matrix and compute probs
    const dcV4 = buildMat(lhV4, laV4, true)
    const v1V4 = buildMat(lhV4, laV4, false)
    const blV4 = blendMat(dcV4, v1V4)
    const pV4  = matProbs(blV4)

    const dominant = pV4.home >= pV4.draw && pV4.home >= pV4.away ? 'H'
                   : pV4.away > pV4.home  && pV4.away >= pV4.draw  ? 'A' : 'D'
    const actual  = m.home_score != null && m.away_score != null
      ? (Number(m.home_score) > Number(m.away_score) ? 'H' : Number(m.home_score) < Number(m.away_score) ? 'A' : 'D')
      : null
    const correct_v4 = actual != null ? dominant === actual : null

    updates.push({
      match_id:       pred.match_id,
      v4_lambda_home: Math.round(lhV4 * 1000) / 1000,
      v4_lambda_away: Math.round(laV4 * 1000) / 1000,
      v4_home_win:    Math.round(pV4.home * 10000) / 10000,
      v4_draw:        Math.round(pV4.draw * 10000) / 10000,
      v4_away_win:    Math.round(pV4.away * 10000) / 10000,
      correct_v4,
    })
  }

  // Batch update in chunks of 50
  const CHUNK = 50
  for (let i = 0; i < updates.length; i += CHUNK) {
    const chunk = updates.slice(i, i + CHUNK)
    for (const u of chunk) {
      const { error } = await supabase
        .from('model_predictions')
        .update({
          v4_lambda_home: u.v4_lambda_home,
          v4_lambda_away: u.v4_lambda_away,
          v4_home_win:    u.v4_home_win,
          v4_draw:        u.v4_draw,
          v4_away_win:    u.v4_away_win,
          correct_v4:     u.correct_v4,
        })
        .eq('match_id', u.match_id)
      if (error) { console.error(`  ❌ ${u.match_id}: ${error.message}`); fail++ }
      else ok++
    }
    process.stdout.write(`\r  Updated ${Math.min(i + CHUNK, updates.length)}/${updates.length}…`)
  }
  console.log(`\n✅ ${ok} updated | ❌ ${fail} failed`)

  // Sample output
  const sample = updates.slice(0, 5)
  for (const u of sample) {
    const m = matchById[u.match_id]
    const pred = preds.find(p => p.match_id === u.match_id)
    if (m && pred) {
      const dLh = (u.v4_lambda_home - Number(pred.v3_lambda_home)).toFixed(3)
      const dLa = (u.v4_lambda_away - Number(pred.v3_lambda_away)).toFixed(3)
      console.log(`  ${m.home_team} vs ${m.away_team}: λh ${Number(pred.v3_lambda_home).toFixed(3)}→${u.v4_lambda_home.toFixed(3)} (${dLh>0?'+':''}${dLh})  λa ${Number(pred.v3_lambda_away).toFixed(3)}→${u.v4_lambda_away.toFixed(3)} (${dLa>0?'+':''}${dLa})`)
    }
  }
}

async function run() {
  const corrRows = await buildCorrections()
  await applyV4(corrRows)
  console.log('\n✅ V4 build complete')
}

run().catch(e => { console.error(e); process.exit(1) })
