// scripts/v4_backtest.js
// Leave-one-out V4 backtest: predicts each match using ONLY bias from prior matches.
//
// V4 = pure Dixon-Coles with attack-bias correction on the stored V3 lambdas.
// Processes matches chronologically; bias registry grows match-by-match.
//
// Run:  node scripts/v4_backtest.js
// Open: open scripts/v4_backtest.html

import { readFileSync, writeFileSync } from 'fs'
import { createClient } from '@supabase/supabase-js'

// ── Credentials ───────────────────────────────────────────────────────────────
const vars = Object.fromEntries(
  readFileSync('.dev.vars', 'utf8')
    .split('\n')
    .filter(l => l.includes('='))
    .map(l => {
      const idx = l.indexOf('=')
      return [l.slice(0, idx).trim(), l.slice(idx + 1).trim()]
    })
)
const SUPABASE_URL = vars.SUPABASE_URL
const SUPABASE_KEY = vars.SUPABASE_SERVICE_ROLE_KEY || vars.SUPABASE_ANON_KEY
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or key in .dev.vars')
  process.exit(1)
}
console.log(vars.SUPABASE_SERVICE_ROLE_KEY ? 'Auth: service_role (RLS bypassed)' : 'Auth: anon key (may be blocked by RLS)')
const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } })

// ── Constants ─────────────────────────────────────────────────────────────────
const RHO   = -0.0612
const MAX_G = 8
const MAX_K = 7
const V4_COLOR = '#7C3AED'
const V3_COLOR = '#D4AF37'
const HIT_COLOR = '#22c55e'
const MISS_COLOR = '#ef4444'

// ── Poisson PMF (log-space, identical to dcRatings.js) ───────────────────────
function poissonPMF(k, lambda) {
  if (lambda <= 0) return k === 0 ? 1 : 0
  let logP = k * Math.log(lambda) - lambda
  for (let i = 1; i <= k; i++) logP -= Math.log(i)
  return Math.exp(logP)
}

// ── Dixon-Coles tau correction ────────────────────────────────────────────────
function tau(x, y, lh, la) {
  if (x === 0 && y === 0) return Math.max(1 - lh * la * RHO, 0.001)
  if (x === 0 && y === 1) return Math.max(1 + lh * RHO, 0.001)
  if (x === 1 && y === 0) return Math.max(1 + la * RHO, 0.001)
  if (x === 1 && y === 1) return Math.max(1 - RHO, 0.001)
  return 1.0
}

// ── Build pure DC matrix ──────────────────────────────────────────────────────
function buildDCMatrix(lh, la) {
  const M = []
  let total = 0
  for (let x = 0; x <= MAX_G; x++) {
    M[x] = []
    for (let y = 0; y <= MAX_G; y++) {
      const v = Math.max(poissonPMF(x, lh) * poissonPMF(y, la) * tau(x, y, lh, la), 0)
      M[x][y] = v
      total += v
    }
  }
  if (total > 0)
    for (let x = 0; x <= MAX_G; x++)
      for (let y = 0; y <= MAX_G; y++) M[x][y] /= total
  return M
}

// ── Build V3 matrix (65% DC + 35% V1) ────────────────────────────────────────
function buildV3Matrix(lh, la) {
  const DC = buildDCMatrix(lh, la)
  const V1 = []
  let t = 0
  for (let x = 0; x <= MAX_G; x++) {
    V1[x] = []
    for (let y = 0; y <= MAX_G; y++) {
      V1[x][y] = poissonPMF(x, lh) * poissonPMF(y, la)
      t += V1[x][y]
    }
  }
  if (t > 0) for (let x = 0; x <= MAX_G; x++) for (let y = 0; y <= MAX_G; y++) V1[x][y] /= t
  const M = []
  for (let x = 0; x <= MAX_G; x++) {
    M[x] = []
    for (let y = 0; y <= MAX_G; y++) M[x][y] = 0.65 * DC[x][y] + 0.35 * V1[x][y]
  }
  return M
}

// ── Analyse a score matrix ────────────────────────────────────────────────────
function outcome(x, y) { return x > y ? 'H' : x < y ? 'A' : 'D' }

function analyseMatrix(M) {
  let homeWin = 0, draw = 0, awayWin = 0
  const totals = new Array(MAX_G * 2 + 1).fill(0)
  const allCells = []
  for (let x = 0; x <= MAX_G; x++) {
    for (let y = 0; y <= MAX_G; y++) {
      const p = M[x][y]
      if (x > y) homeWin += p
      else if (x === y) draw += p
      else awayWin += p
      totals[x + y] += p
      allCells.push({ x, y, p, score: `${x}-${y}` })
    }
  }
  const dominant = homeWin >= draw && homeWin >= awayWin ? 'H'
                 : awayWin >= homeWin && awayWin >= draw ? 'A' : 'D'
  const goalsDist = totals.slice(0, MAX_K + 1)
  let anchor = 0, anchorProb = goalsDist[0]
  for (let k = 1; k <= MAX_K; k++) {
    if (goalsDist[k] > anchorProb) { anchorProb = goalsDist[k]; anchor = k }
  }
  const pPrev = anchor > 0    ? goalsDist[anchor - 1] : 0
  const pNext = anchor < MAX_K ? goalsDist[anchor + 1] : 0
  const ads = anchorProb - pPrev - pNext
  const tier = ads > 0.10 ? 'STRONG' : ads >= 0.00 ? 'MODERATE' : ads >= -0.10 ? 'WEAK' : 'FLAT'
  const candidates = allCells
    .filter(c => c.x + c.y === anchor && outcome(c.x, c.y) === dominant)
    .sort((a, b) => b.p - a.p)
  const primary = candidates[0] ? candidates[0].score : null
  const top3 = [...allCells].sort((a, b) => b.p - a.p).slice(0, 3).map(c => c.score)
  return { homeWin, draw, awayWin, dominant, anchor, anchorProb, ads, tier, primary, top3 }
}

// ── Recency weights (oldest → newest, length = N) ─────────────────────────────
function recencyWeights(N) {
  if (N === 0) return []
  if (N === 1) return [1.0]
  if (N === 2) return [0.3, 0.7]
  if (N === 3) return [0.2, 0.3, 0.5]
  // N >= 4: exponential decay, exponent grows with recency
  const raw = Array.from({ length: N }, (_, i) => Math.exp(0.5 * i))
  const sum = raw.reduce((s, v) => s + v, 0)
  return raw.map(v => v / sum)
}

function weightedMean(values) {
  if (!values.length) return 0
  const w = recencyWeights(values.length)
  return values.reduce((s, v, i) => s + v * w[i], 0)
}

function conf(N) { return 1 - Math.exp(-N / 2) }

function clampLambda(v) { return Math.max(0.2, Math.min(5.0, v)) }

// ── Bias registry helpers ─────────────────────────────────────────────────────
function ensureBias(bias, team) {
  if (!bias[team]) bias[team] = { attack_errors: [], defense_errors: [], matches_played: 0 }
}

function getBias(bias, team) {
  if (!bias[team] || !bias[team].matches_played) return { att: 0, N: 0, c: 0 }
  const errors = bias[team].attack_errors
  const N = errors.length
  return { att: weightedMean(errors), N, c: conf(N) }
}

// ── Fetch from Supabase ───────────────────────────────────────────────────────
async function fetchData() {
  const { data: matches, error: mErr } = await sb
    .from('matches')
    .select('id, home_team, away_team, home_score, away_score, match_date, stage, group_name')
    .eq('status', 'finished')
    .order('match_date', { ascending: true })
  if (mErr) throw new Error(`matches: ${mErr.message}`)
  if (!matches?.length) return []

  const ids = matches.map(m => m.id)
  const { data: preds, error: pErr } = await sb
    .from('model_predictions')
    .select('match_id, v3_lambda_home, v3_lambda_away, v3_home_win, v3_draw, v3_away_win, anchor_total, v3_top_score, model_version')
    .in('match_id', ids)
    .not('v3_lambda_home', 'is', null)
    .eq('model_version', 'v3-dc-only')
  if (pErr) throw new Error(`model_predictions: ${pErr.message}`)

  const predMap = {}
  for (const p of preds || []) predMap[p.match_id] = p

  return matches.map(m => ({ match: m, pred: predMap[m.id] || null }))
}

// ── Score V3 from stored fields + V3 matrix top-3 ────────────────────────────
function scoreV3(pred, v3Stats, hs, as_) {
  const hw = Number(pred.v3_home_win)
  const dr = Number(pred.v3_draw)
  const aw = Number(pred.v3_away_win)
  const dom = hw >= dr && hw >= aw ? 'H' : aw >= hw && aw >= dr ? 'A' : 'D'
  const actual_total   = hs + as_
  const actual_score   = `${hs}-${as_}`
  const actual_outcome = hs > as_ ? 'H' : hs < as_ ? 'A' : 'D'
  return {
    dominant:      dom,
    anchor:        pred.anchor_total != null ? Number(pred.anchor_total) : null,
    top1:          pred.v3_top_score || null,
    direction_hit: dom === actual_outcome,
    anchor_hit:    pred.anchor_total != null && Number(pred.anchor_total) === actual_total,
    primary_hit:   pred.v3_top_score === actual_score,
    top3_hit:      v3Stats.top3.includes(actual_score),
    tier:          v3Stats.tier,
  }
}

// ── Main backtest ─────────────────────────────────────────────────────────────
async function runBacktest() {
  console.log('Fetching data…')
  const data = await fetchData()
  console.log(`Rows from Supabase: ${data.length}  (with predictions: ${data.filter(d => d.pred).length})`)

  const bias = {}   // cumulative bias registry
  const results = []
  let skipped = 0

  for (const { match: m, pred } of data) {
    if (!pred || m.home_score == null || m.away_score == null) { skipped++; continue }

    const lh_v3 = Number(pred.v3_lambda_home)
    const la_v3 = Number(pred.v3_lambda_away)
    if (!isFinite(lh_v3) || !isFinite(la_v3) || lh_v3 <= 0 || la_v3 <= 0) { skipped++; continue }

    const hs  = Number(m.home_score)
    const as_ = Number(m.away_score)

    // ── Step 2: get prior bias (BEFORE updating) ──────────────────────────
    const hb = getBias(bias, m.home_team)
    const ab = getBias(bias, m.away_team)

    // ── Step 3: compute V4 lambdas ────────────────────────────────────────
    const lh_v4 = clampLambda(lh_v3 + hb.c * hb.att)
    const la_v4 = clampLambda(la_v3 + ab.c * ab.att)

    // ── Build matrices ────────────────────────────────────────────────────
    const v4M = buildDCMatrix(lh_v4, la_v4)
    const v3M = buildV3Matrix(lh_v3, la_v3)
    const v4Stats = analyseMatrix(v4M)
    const v3Stats = analyseMatrix(v3M)

    // ── Score ─────────────────────────────────────────────────────────────
    const actual_score   = `${hs}-${as_}`
    const actual_total   = hs + as_
    const actual_outcome = hs > as_ ? 'H' : hs < as_ ? 'A' : 'D'
    const v3s = scoreV3(pred, v3Stats, hs, as_)
    const v4s = {
      dominant:      v4Stats.dominant,
      anchor:        v4Stats.anchor,
      primary:       v4Stats.primary,
      top3:          v4Stats.top3,
      direction_hit: v4Stats.dominant === actual_outcome,
      anchor_hit:    v4Stats.anchor   === actual_total,
      primary_hit:   v4Stats.primary  === actual_score,
      top3_hit:      v4Stats.top3.includes(actual_score),
      tier:          v4Stats.tier,
    }

    results.push({
      match: m, pred,
      lh_v3, la_v3, lh_v4, la_v4,
      lh_adj: lh_v4 - lh_v3,
      la_adj: la_v4 - la_v3,
      home_n: hb.N, away_n: ab.N,
      home_att: hb.att, away_att: ab.att,
      home_conf: hb.c, away_conf: ab.c,
      v3: v3s, v4: v4s,
      actual_score, actual_total, actual_outcome,
    })

    // ── Step 2: update bias AFTER prediction ──────────────────────────────
    ensureBias(bias, m.home_team)
    bias[m.home_team].attack_errors.push(hs  - lh_v3)
    bias[m.home_team].defense_errors.push(as_ - la_v3)
    bias[m.home_team].matches_played++

    ensureBias(bias, m.away_team)
    bias[m.away_team].attack_errors.push(as_ - la_v3)
    bias[m.away_team].defense_errors.push(hs  - lh_v3)
    bias[m.away_team].matches_played++
  }

  if (skipped) console.log(`  Skipped (no pred or invalid lambda): ${skipped}`)
  console.log(`  Backtesting: ${results.length} matches\n`)
  return { results, bias }
}

// ── Aggregate ─────────────────────────────────────────────────────────────────
function aggregate(results, which) {
  const n = results.length
  if (!n) return { n: 0, direction: 0, anchor: 0, primary: 0, top3: 0, meanGoalsErr: 0, flat: 0 }
  let direction = 0, anchor = 0, primary = 0, top3 = 0, errSum = 0, flat = 0
  for (const r of results) {
    const s = r[which]
    if (s.direction_hit) direction++
    if (s.anchor_hit)    anchor++
    if (s.primary_hit)   primary++
    if (s.top3_hit)      top3++
    errSum += Math.abs((s.anchor ?? 0) - r.actual_total)
    if (s.tier === 'FLAT') flat++
  }
  return { n, direction, anchor, primary, top3, meanGoalsErr: errSum / n, flat }
}

// ── HTML helpers ───────────────────────────────────────────────────────────────
const FLAGS = {
  'USA':'🇺🇸','Canada':'🇨🇦','Mexico':'🇲🇽','Argentina':'🇦🇷','Brazil':'🇧🇷',
  'France':'🇫🇷','England':'🏴󠁧󠁢󠁥󠁮󠁧󠁿','Spain':'🇪🇸','Germany':'🇩🇪','Portugal':'🇵🇹',
  'Netherlands':'🇳🇱','Belgium':'🇧🇪','Croatia':'🇭🇷','Uruguay':'🇺🇾','Colombia':'🇨🇴',
  'Japan':'🇯🇵','Morocco':'🇲🇦','Senegal':'🇸🇳','South Korea':'🇰🇷','Australia':'🇦🇺',
  'Ecuador':'🇪🇨','Switzerland':'🇨🇭','Ghana':'🇬🇭','Tunisia':'🇹🇳','Iran':'🇮🇷',
  'Qatar':'🇶🇦','Saudi Arabia':'🇸🇦','Norway':'🇳🇴','Sweden':'🇸🇪','Austria':'🇦🇹',
  'Egypt':'🇪🇬','Algeria':'🇩🇿','Panama':'🇵🇦','Haiti':'🇭🇹','New Zealand':'🇳🇿',
  'Uzbekistan':'🇺🇿','DR Congo':'🇨🇩','Iraq':'🇮🇶','Jordan':'🇯🇴','South Africa':'🇿🇦',
  'Paraguay':'🇵🇾','Scotland':'🏴󠁧󠁢󠁳󠁣󠁴󠁿','Bosnia-Herzegovina':'🇧🇦','Cape Verde':'🇨🇻',
  'Curacao':'🇨🇼','Ivory Coast':'🇨🇮','Czechia':'🇨🇿',
}
const flag = t => FLAGS[t] || '🏳️'

function hitBadge(ok) {
  return ok
    ? `<span style="color:${HIT_COLOR};font-weight:700">✓</span>`
    : `<span style="color:${MISS_COLOR}">✗</span>`
}
function pct(v, n) {
  return n ? `${v}/${n} <span style="opacity:.6">(${(v/n*100).toFixed(1)}%)</span>` : '—'
}
function winner(v3v, v4v, higherBetter = true) {
  const v3b = higherBetter ? v3v > v4v : v3v < v4v
  const v4b = higherBetter ? v4v > v3v : v4v < v3v
  if (v3b) return `<span style="color:${V3_COLOR};font-weight:700">V3</span>`
  if (v4b) return `<span style="color:${V4_COLOR};font-weight:700">V4</span>`
  return `<span style="color:#94a3b8">TIE</span>`
}

function mkRow(label, v3val, v4val, fmt, higherBetter = true) {
  const v3b = higherBetter ? v3val > v4val : v3val < v4val
  const v4b = higherBetter ? v4val > v3val : v4val < v3val
  return `<tr>
    <td style="padding:9px 14px;color:#334155">${label}</td>
    <td style="text-align:center;padding:9px 14px${v3b ? `;background:#fefce8;font-weight:700` : ''}">${fmt(v3val)}</td>
    <td style="text-align:center;padding:9px 14px${v4b ? `;background:#f0fdf4;font-weight:700` : ''}">${fmt(v4val)}</td>
    <td style="text-align:center;padding:9px 14px">${winner(v3val, v4val, higherBetter)}</td>
  </tr>`
}

// ── HTML generation ───────────────────────────────────────────────────────────
function generateHTML(results, bias) {
  const n   = results.length
  const v3a = aggregate(results, 'v3')
  const v4a = aggregate(results, 'v4')
  const runDate = new Date().toISOString().slice(0, 19).replace('T', ' ') + ' UTC'

  // ── Banner ────────────────────────────────────────────────────────────────
  const v4Wins = [
    v4a.direction > v3a.direction,
    v4a.anchor    > v3a.anchor,
    v4a.primary   > v3a.primary,
    v4a.top3      > v3a.top3,
    v4a.meanGoalsErr < v3a.meanGoalsErr,
  ].filter(Boolean).length
  const v3Wins = [
    v3a.direction > v4a.direction,
    v3a.anchor    > v4a.anchor,
    v3a.primary   > v4a.primary,
    v3a.top3      > v4a.top3,
    v3a.meanGoalsErr < v4a.meanGoalsErr,
  ].filter(Boolean).length
  const bannerColor = v4Wins > v3Wins ? '#22c55e' : '#f59e0b'
  const bannerText  = v4Wins > v3Wins
    ? '🚀 V4 OUTPERFORMS V3 — ready to build'
    : v3Wins > v4Wins
    ? '⚠️ V3 still stronger — collect more data'
    : '🔵 TIED — more matches needed for signal'

  // ── Section 1: Summary ───────────────────────────────────────────────────
  const section1 = `
<section style="margin:20px 0">
  <div style="padding:14px 20px;background:${bannerColor};color:#fff;border-radius:8px;font-size:15px;font-weight:700;letter-spacing:.04em;margin-bottom:18px;text-align:center">
    ${bannerText}
    <span style="font-size:11px;font-weight:400;margin-left:16px;opacity:.85">V4 wins ${v4Wins}/5 metrics · V3 wins ${v3Wins}/5</span>
  </div>
  <table style="width:100%;border-collapse:collapse;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1);font-size:13px">
    <thead>
      <tr style="background:#1A1A2E;color:#fff;text-align:left">
        <th style="padding:11px 14px">Metric</th>
        <th style="padding:11px 14px;text-align:center;color:${V3_COLOR}">V3 (stored)</th>
        <th style="padding:11px 14px;text-align:center;color:#c4b5fd">V4 (bias-adjusted)</th>
        <th style="padding:11px 14px;text-align:center">Winner</th>
      </tr>
    </thead>
    <tbody>
      <tr style="background:#f8fafc">
        <td style="padding:9px 14px;color:#64748b">Matches analysed</td>
        <td style="text-align:center;padding:9px 14px">${n}</td>
        <td style="text-align:center;padding:9px 14px">${n}</td>
        <td></td>
      </tr>
      ${mkRow('Direction accuracy',  v3a.direction,      v4a.direction,      v => pct(v, n))}
      ${mkRow('Anchor hit',          v3a.anchor,         v4a.anchor,         v => pct(v, n))}
      ${mkRow('Primary score hit',   v3a.primary,        v4a.primary,        v => pct(v, n))}
      ${mkRow('Top-3 hit',           v3a.top3,           v4a.top3,           v => pct(v, n))}
      ${mkRow('Mean goals error',    v3a.meanGoalsErr,   v4a.meanGoalsErr,   v => isFinite(v) ? v.toFixed(2) : '—', false)}
      ${mkRow('FLAT anchors',        v3a.flat,           v4a.flat,           v => String(v), false)}
    </tbody>
  </table>
</section>`

  // ── Section 2: Per-match detail ───────────────────────────────────────────
  const matchRows = results.map(r => {
    const m = r.match
    const date = new Date(m.match_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
    const v4Better = (r.v4.direction_hit + r.v4.anchor_hit + r.v4.primary_hit)
                   > (r.v3.direction_hit + r.v3.anchor_hit + r.v3.primary_hit)
    const v3Better = (r.v3.direction_hit + r.v3.anchor_hit + r.v3.primary_hit)
                   > (r.v4.direction_hit + r.v4.anchor_hit + r.v4.primary_hit)
    const rowBg = v4Better ? '#f0fdf4' : v3Better ? '#fff7ed' : '#fff'

    const domBadge = d =>
      `<span style="background:${d==='H'?'#1e3a5f':d==='A'?'#7c3aed':'#64748b'};color:#fff;padding:1px 6px;border-radius:3px;font-size:10px;font-weight:700">${d==='H'?'HOME':d==='A'?'AWAY':'DRAW'}</span>`

    const biasStr = (r.home_n === 0 && r.away_n === 0)
      ? '<span style="opacity:.4">no prior data</span>'
      : `<span title="home attack bias">H:${r.home_att >= 0 ? '+' : ''}${r.home_att.toFixed(2)}</span> · <span title="away attack bias">A:${r.away_att >= 0 ? '+' : ''}${r.away_att.toFixed(2)}</span>`

    return `<tr style="border-top:1px solid #e2e8f0;background:${rowBg}">
      <td style="padding:8px 10px;white-space:nowrap;color:#64748b;font-family:monospace;font-size:11px">${date}</td>
      <td style="padding:8px 10px;white-space:nowrap">
        ${flag(m.home_team)} ${m.home_team} vs ${m.away_team} ${flag(m.away_team)}
      </td>
      <td style="padding:8px 10px;font-family:monospace;font-weight:700;white-space:nowrap">
        <span style="background:#1A1A2E;color:#fff;padding:2px 8px;border-radius:4px">${r.actual_score.replace('-','–')}</span>
        <span style="font-size:10px;color:#64748b;margin-left:4px">${r.actual_outcome==='H'?'H win':r.actual_outcome==='A'?'A win':'Draw'}</span>
      </td>
      <td style="padding:8px 10px;text-align:center">${domBadge(r.v3.dominant)}</td>
      <td style="padding:8px 10px;text-align:center">${hitBadge(r.v3.direction_hit)}</td>
      <td style="padding:8px 10px;text-align:center;font-family:monospace;font-size:11px">${r.v3.anchor ?? '—'}g ${hitBadge(r.v3.anchor_hit)}</td>
      <td style="padding:8px 10px;text-align:center;font-family:monospace;font-size:11px">${r.v3.top1 ?? '—'} ${hitBadge(r.v3.primary_hit)}</td>
      <td style="padding:8px 10px;text-align:center">${domBadge(r.v4.dominant)}</td>
      <td style="padding:8px 10px;text-align:center">${hitBadge(r.v4.direction_hit)}</td>
      <td style="padding:8px 10px;text-align:center;font-family:monospace;font-size:11px">${r.v4.anchor}g ${hitBadge(r.v4.anchor_hit)}</td>
      <td style="padding:8px 10px;text-align:center;font-family:monospace;font-size:11px">${r.v4.primary ?? '—'} ${hitBadge(r.v4.primary_hit)}</td>
      <td style="padding:8px 10px;font-family:monospace;font-size:11px;color:#6b7280">${biasStr}</td>
      <td style="padding:8px 10px;text-align:center;font-family:monospace;font-size:11px;color:#94a3b8">
        ${r.home_n}/${r.away_n}
      </td>
    </tr>`
  }).join('')

  const section2 = `
<section style="margin:28px 0">
  <h2 style="font-size:13px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#64748b;margin-bottom:12px">
    Match-by-Match Detail
    <span style="font-weight:400;font-size:11px;margin-left:10px">
      <span style="background:#f0fdf4;padding:2px 8px;border-radius:3px">green = V4 better</span>
      <span style="background:#fff7ed;padding:2px 8px;border-radius:3px;margin-left:4px">amber = V3 better</span>
    </span>
  </h2>
  <div style="overflow-x:auto">
    <table style="width:100%;border-collapse:collapse;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1);font-size:12px">
      <thead>
        <tr style="background:#1A1A2E;color:#fff;text-align:left">
          <th style="padding:9px 10px">Date</th>
          <th style="padding:9px 10px">Match</th>
          <th style="padding:9px 10px">Actual</th>
          <th style="padding:9px 10px;text-align:center;background:#2a1a0e;color:${V3_COLOR}" colspan="4">← V3 (stored) →</th>
          <th style="padding:9px 10px;text-align:center;background:#1a0a2e;color:#c4b5fd" colspan="4">← V4 (bias-adj) →</th>
          <th style="padding:9px 10px;font-size:10px;opacity:.8">Bias used</th>
          <th style="padding:9px 10px;text-align:center;font-size:10px;opacity:.8">N H/A</th>
        </tr>
        <tr style="background:#2d3748;color:#cbd5e1;font-size:10px;text-transform:uppercase;letter-spacing:.06em">
          <th style="padding:6px 10px" colspan="3"></th>
          <th style="padding:6px 10px;text-align:center">Dir</th>
          <th style="padding:6px 10px;text-align:center">Dir✓</th>
          <th style="padding:6px 10px;text-align:center">Anchor</th>
          <th style="padding:6px 10px;text-align:center">Primary</th>
          <th style="padding:6px 10px;text-align:center">Dir</th>
          <th style="padding:6px 10px;text-align:center">Dir✓</th>
          <th style="padding:6px 10px;text-align:center">Anchor</th>
          <th style="padding:6px 10px;text-align:center">Primary</th>
          <th style="padding:6px 10px" colspan="2"></th>
        </tr>
      </thead>
      <tbody>${matchRows}</tbody>
    </table>
  </div>
</section>`

  // ── Section 3: Bias evolution ─────────────────────────────────────────────
  const teamsWithGames = Object.entries(bias)
    .filter(([, b]) => b.matches_played >= 2)
    .sort((a, b) => b[1].matches_played - a[1].matches_played)

  const biasRows = teamsWithGames.map(([team, b]) => {
    const errors = b.attack_errors
    const errCells = errors.map((e, i) => {
      const c = e > 0 ? HIT_COLOR : e < 0 ? MISS_COLOR : '#64748b'
      const sign = e > 0 ? '+' : ''
      return `<td style="padding:6px 10px;font-family:monospace;font-size:11px;text-align:center;color:${c}">${sign}${e.toFixed(2)}</td>`
    }).join('')

    const lastAbs  = Math.abs(errors[errors.length - 1])
    const firstAbs = Math.abs(errors[0])
    const trend = lastAbs < firstAbs - 0.05 ? '↓ converging'
                : lastAbs > firstAbs + 0.05 ? '↑ diverging' : '→ stable'
    const trendColor = trend.startsWith('↓') ? HIT_COLOR : trend.startsWith('↑') ? MISS_COLOR : '#64748b'

    const finalBias = weightedMean(errors)
    const confN = conf(errors.length)

    return `<tr style="border-top:1px solid #e2e8f0">
      <td style="padding:6px 10px;font-weight:600">${flag(team)} ${team}</td>
      <td style="padding:6px 10px;text-align:center;color:#64748b">${b.matches_played}</td>
      ${errCells}
      <td style="padding:6px 10px;text-align:center;color:${trendColor};font-size:11px;font-weight:600">${trend}</td>
      <td style="padding:6px 10px;font-family:monospace;font-size:11px;text-align:center;color:${Math.abs(finalBias)>0.3?'#ef4444':'#22c55e'}">${finalBias>=0?'+':''}${finalBias.toFixed(3)}</td>
      <td style="padding:6px 10px;font-family:monospace;font-size:11px;text-align:center;color:#64748b">${(confN*100).toFixed(0)}%</td>
    </tr>`
  }).join('')

  const maxGames = teamsWithGames.length ? Math.max(...teamsWithGames.map(([, b]) => b.matches_played)) : 0
  const gameHeaders = Array.from({ length: maxGames }, (_, i) =>
    `<th style="padding:6px 10px;text-align:center;font-size:10px;opacity:.7">G${i+1}</th>`
  ).join('')

  const section3 = teamsWithGames.length === 0 ? '' : `
<section style="margin:28px 0">
  <h2 style="font-size:13px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#64748b;margin-bottom:12px">Bias Evolution (attack error per game)</h2>
  <div style="overflow-x:auto">
    <table style="width:100%;border-collapse:collapse;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1);font-size:12px">
      <thead>
        <tr style="background:#1A1A2E;color:#fff">
          <th style="padding:8px 10px;text-align:left">Team</th>
          <th style="padding:8px 10px;text-align:center">Games</th>
          ${gameHeaders}
          <th style="padding:8px 10px;text-align:center;font-size:10px">Trend</th>
          <th style="padding:8px 10px;text-align:center;font-size:10px">Final att bias</th>
          <th style="padding:8px 10px;text-align:center;font-size:10px">V4 conf</th>
        </tr>
      </thead>
      <tbody>${biasRows}</tbody>
    </table>
  </div>
  <p style="font-size:11px;color:#94a3b8;margin-top:8px">
    Error = actual_goals_scored − λ_v3. Positive = over-performed; negative = under-performed.
    V4 confidence = 1 − exp(−N/2).
  </p>
</section>`

  // ── Section 4: Key findings ───────────────────────────────────────────────
  // Matches where V4 corrected V3's direction error
  const corrected  = results.filter(r => !r.v3.direction_hit && r.v4.direction_hit)
  const newErrors  = results.filter(r =>  r.v3.direction_hit && !r.v4.direction_hit)
  const net = corrected.length - newErrors.length

  // Per-team contribution to V4 improvement
  const teamNet = {}
  for (const r of corrected) {
    const teams = [r.match.home_team, r.match.away_team]
    for (const t of teams) { teamNet[t] = (teamNet[t] || 0) + 1 }
  }
  for (const r of newErrors) {
    const teams = [r.match.home_team, r.match.away_team]
    for (const t of teams) { teamNet[t] = (teamNet[t] || 0) - 1 }
  }
  const teamsSorted = Object.entries(teamNet).sort((a, b) => b[1] - a[1])
  const topHelped  = teamsSorted.filter(([, v]) => v > 0).slice(0, 3)
  const topHurt    = teamsSorted.filter(([, v]) => v < 0).reverse().slice(0, 3)

  const rec = v4Wins > v3Wins ? '✅ BUILD V4 — bias correction shows consistent lift'
            : v3Wins > v4Wins ? '⏳ WAIT — collect more matches before committing to V4'
            : '🔄 INCONCLUSIVE — too close to call; continue monitoring'

  const corList = corrected.slice(0, 5).map(r =>
    `${flag(r.match.home_team)} ${r.match.home_team} vs ${r.match.away_team} (actual ${r.actual_score}, V4 predicted ${r.v4.dominant})`
  ).join('<br>')

  const errList = newErrors.slice(0, 5).map(r =>
    `${flag(r.match.home_team)} ${r.match.home_team} vs ${r.match.away_team} (actual ${r.actual_score}, V4 mispredicted ${r.v4.dominant})`
  ).join('<br>')

  const section4 = `
<section style="margin:28px 0">
  <h2 style="font-size:13px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#64748b;margin-bottom:14px">Key Findings</h2>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
    <div style="background:#fff;border-radius:8px;padding:18px 20px;box-shadow:0 1px 3px rgba(0,0,0,.1)">
      <div style="font-size:10px;font-weight:700;letter-spacing:.1em;color:#64748b;text-transform:uppercase;margin-bottom:10px">Correction Stats (direction)</div>
      <div style="font-size:28px;font-weight:800;color:${net>=0?HIT_COLOR:MISS_COLOR};font-family:monospace">${net>=0?'+':''}${net}</div>
      <div style="font-size:12px;color:#64748b;margin-top:4px;line-height:1.7">
        V4 corrected <strong>${corrected.length}</strong> V3 misses<br>
        V4 introduced <strong>${newErrors.length}</strong> new errors<br>
        Net: ${net >= 0 ? `+${net} improvement` : `${net} regression`}
      </div>
    </div>
    <div style="background:#fff;border-radius:8px;padding:18px 20px;box-shadow:0 1px 3px rgba(0,0,0,.1)">
      <div style="font-size:10px;font-weight:700;letter-spacing:.1em;color:#64748b;text-transform:uppercase;margin-bottom:10px">Team Impact</div>
      ${topHelped.length ? `<div style="font-size:12px;margin-bottom:8px"><span style="color:${HIT_COLOR};font-weight:700">Helped:</span> ${topHelped.map(([t,v])=>`${flag(t)} ${t} (+${v})`).join(', ')}</div>` : ''}
      ${topHurt.length  ? `<div style="font-size:12px"><span style="color:${MISS_COLOR};font-weight:700">Hurt:</span> ${topHurt.map(([t,v])=>`${flag(t)} ${t} (${v})`).join(', ')}</div>` : '<div style="font-size:12px;color:#94a3b8">No teams negatively affected</div>'}
    </div>
  </div>
  <div style="margin-top:16px;background:#fff;border-radius:8px;padding:18px 20px;box-shadow:0 1px 3px rgba(0,0,0,.1)">
    <div style="font-size:10px;font-weight:700;letter-spacing:.1em;color:#64748b;text-transform:uppercase;margin-bottom:12px">Recommendation</div>
    <div style="font-size:15px;font-weight:700;color:#1e293b;margin-bottom:14px">${rec}</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;font-size:12px">
      ${corrected.length ? `<div><div style="font-weight:600;color:${HIT_COLOR};margin-bottom:6px">V4 corrections (sample):</div><div style="line-height:1.9;color:#334155">${corList || '—'}</div></div>` : ''}
      ${newErrors.length ? `<div><div style="font-weight:600;color:${MISS_COLOR};margin-bottom:6px">V4 new errors (sample):</div><div style="line-height:1.9;color:#334155">${errList || '—'}</div></div>` : ''}
    </div>
  </div>
</section>`

  // ── Full HTML ─────────────────────────────────────────────────────────────
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Metis V4 Backtest — WC2026</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding-bottom:56px}
    h2{margin:0}
    section{padding:0 20px}
  </style>
</head>
<body>
  <div style="position:sticky;top:0;z-index:20;background:#1A1A2E;padding:12px 20px 10px;border-bottom:1px solid #0F3460">
    <div style="font-size:16px;font-weight:700;color:#fff;letter-spacing:.06em">METIS V4 BACKTEST — WC2026</div>
    <div style="font-size:11px;color:#94a3b8;margin-top:3px">
      ${n} matches · Leave-one-out bias correction · <span style="color:${V3_COLOR}">V3</span> vs <span style="color:#c4b5fd">V4</span> · ${runDate}
    </div>
  </div>
  <div style="padding:20px 0 0">
    <div style="padding:0 20px">
      <div style="font-size:11px;color:#64748b;line-height:1.7;margin-bottom:16px;background:#fff;padding:12px 16px;border-radius:6px;border-left:3px solid ${V4_COLOR}">
        <strong>V4 methodology:</strong> For each match, V4 takes the stored V3 λ values and applies a weighted attack-bias correction
        derived exclusively from that team's <em>prior</em> matches. Confidence = 1−e<sup>−N/2</sup>.
        V4 uses a pure Dixon-Coles matrix (no V1 blend). This is a leave-one-out test — V4 never sees future data.
      </div>
    </div>
    ${n === 0 ? `<div style="padding:40px 20px;text-align:center;color:#64748b">No matches with v3-dc-only predictions found. Check model_version filter and RLS credentials.</div>` : section1 + section2 + section3 + section4}
  </div>
</body>
</html>`
}

// ── Entry point ───────────────────────────────────────────────────────────────
async function main() {
  const { results, bias } = await runBacktest()
  const html = generateHTML(results, bias)
  writeFileSync('scripts/v4_backtest.html', html)
  console.log(`Output → scripts/v4_backtest.html`)
  console.log('Open:    open scripts/v4_backtest.html')

  if (results.length > 0) {
    const n  = results.length
    const v3 = aggregate(results, 'v3')
    const v4 = aggregate(results, 'v4')
    const pct = (v, t) => `${v}/${t} (${(v/t*100).toFixed(1)}%)`
    console.log('\n=== SUMMARY ===')
    console.log(`                  V3           V4`)
    console.log(`Direction:  ${pct(v3.direction, n).padEnd(14)} ${pct(v4.direction, n)}`)
    console.log(`Anchor:     ${pct(v3.anchor, n).padEnd(14)} ${pct(v4.anchor, n)}`)
    console.log(`Primary:    ${pct(v3.primary, n).padEnd(14)} ${pct(v4.primary, n)}`)
    console.log(`Top-3:      ${pct(v3.top3, n).padEnd(14)} ${pct(v4.top3, n)}`)
    console.log(`Goals err:  ${v3.meanGoalsErr.toFixed(2).padEnd(14)} ${v4.meanGoalsErr.toFixed(2)}`)
  }
}

main().catch(err => {
  console.error('Fatal:', err.message)
  process.exit(1)
})
