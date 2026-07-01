// Upsert model_predictions for England vs Ghana and Portugal vs Uzbekistan
import { createClient } from '@supabase/supabase-js'
import { dcLambdas, isWC2026Host } from '../src/utils/dcRatings.js'
import { poissonPMF } from '../src/lib/poisson.js'

const SUPABASE_URL = 'https://wmxhcwellqtagpndpyhk.supabase.co'
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndteGhjd2VsbHF0YWdwbmRweWhrIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MDgzODEzMSwiZXhwIjoyMDk2NDE0MTMxfQ.RvWIwMJ0Bm_2KQbvSeKV_yZQgU1_vTrPYkXHRavYHd4'
const supabase = createClient(SUPABASE_URL, SERVICE_KEY)

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
  for (let x = 0; x <= MG; x++) { M[x] = []; for (let y = 0; y <= MG; y++) { M[x][y] = poissonPMF(x, lh) * poissonPMF(y, la); t += M[x][y] } }
  if (t > 0) for (let x = 0; x <= MG; x++) for (let y = 0; y <= MG; y++) M[x][y] /= t
  return M
}

function dcMat(lh, la) {
  const M = []; let t = 0
  for (let x = 0; x <= MG; x++) { M[x] = []; for (let y = 0; y <= MG; y++) { M[x][y] = Math.max(poissonPMF(x, lh) * poissonPMF(y, la) * tau(x, y, lh, la), 0); t += M[x][y] } }
  if (t > 0) for (let x = 0; x <= MG; x++) for (let y = 0; y <= MG; y++) M[x][y] /= t
  return M
}

function blendMat(dc, v1) {
  const M = []; let t = 0
  for (let x = 0; x <= MG; x++) { M[x] = []; for (let y = 0; y <= MG; y++) { M[x][y] = 0.65 * dc[x][y] + 0.35 * v1[x][y]; t += M[x][y] } }
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

const MATCHES = [
  { match_id: 'badefd42-10ed-42f5-8882-306215fe82b6', home: 'England',  away: 'Ghana',      actual: 'D' },
  { match_id: '03125eda-5167-4c54-8c8e-338be41d3abf', home: 'Portugal', away: 'Uzbekistan', actual: 'H' },
]

async function run() {
  // Check existing rows
  const ids = MATCHES.map(m => m.match_id)
  const { data: existing } = await supabase
    .from('model_predictions')
    .select('match_id, model_version')
    .in('match_id', ids)

  const existingIds = new Set((existing || []).map(r => r.match_id))
  console.log('Existing rows found:', existingIds.size, [...existingIds])

  for (const m of MATCHES) {
    const homeIsHost = isWC2026Host(m.home)
    const { lh, la } = dcLambdas(m.home, m.away, homeIsHost)

    const v1 = v1Mat(lh, la)
    const dc = dcMat(lh, la)
    const v3 = blendMat(dc, v1)
    const s  = matStats(v3)

    const dominant = s.homeWin >= s.draw && s.homeWin >= s.awayWin ? 'H'
                   : s.awayWin > s.homeWin && s.awayWin >= s.draw ? 'A' : 'D'
    const correct_v3 = dominant === m.actual

    const lhR = Math.round(lh * 1000) / 1000
    const laR = Math.round(la * 1000) / 1000

    console.log(`\n${m.home} vs ${m.away}`)
    console.log(`  host=${homeIsHost}  lh=${lhR}  la=${laR}`)
    console.log(`  H:${(s.homeWin*100).toFixed(1)}%  D:${(s.draw*100).toFixed(1)}%  A:${(s.awayWin*100).toFixed(1)}%`)
    console.log(`  anchor:${s.anchor}  top:${s.topScore}  dominant:${dominant}  actual:${m.actual}  correct:${correct_v3}`)

    const payload = {
      v3_lambda_home: lhR,
      v3_lambda_away: laR,
      v3_home_win:    Math.round(s.homeWin * 10000) / 10000,
      v3_draw:        Math.round(s.draw    * 10000) / 10000,
      v3_away_win:    Math.round(s.awayWin * 10000) / 10000,
      v1_home_win:    Math.round(s.homeWin * 10000) / 10000,
      v1_draw:        Math.round(s.draw    * 10000) / 10000,
      v1_away_win:    Math.round(s.awayWin * 10000) / 10000,
      anchor_total:   s.anchor,
      v3_top_score:   s.topScore,
      correct_v3,
      actual_outcome: m.actual,
      model_version:  'v3-dc-only',
    }

    let error
    if (existingIds.has(m.match_id)) {
      console.log('  → UPDATE existing row')
      const { error: e } = await supabase
        .from('model_predictions')
        .update(payload)
        .eq('match_id', m.match_id)
      error = e
    } else {
      console.log('  → INSERT new row')
      const { error: e } = await supabase
        .from('model_predictions')
        .insert({ match_id: m.match_id, ...payload, quality_warning: false,
                  predicted_at: new Date().toISOString() })
      error = e
    }

    if (error) console.error('  ❌', error.message)
    else console.log('  ✅')
  }

  const { count } = await supabase
    .from('model_predictions')
    .select('*', { count: 'exact', head: true })
    .not('v3_lambda_home', 'is', null)
    .eq('model_version', 'v3-dc-only')
  console.log(`\nv3-dc-only rows with lambdas: ${count}`)
}

run().catch(e => { console.error(e); process.exit(1) })
