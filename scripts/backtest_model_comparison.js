// scripts/backtest_model_comparison.js
// Backtests V1, DC-only, and V3 models against all WC2026 finished matches.
// Generates scripts/backtest_output.html with a summary table and per-match cards.
//
// Run: node scripts/backtest_model_comparison.js
//
// Credentials: reads SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (preferred) or
// SUPABASE_ANON_KEY from .dev.vars.
// Note: model_predictions RLS is "to authenticated" — anon key returns no rows.
// Add SUPABASE_SERVICE_ROLE_KEY=<key> to .dev.vars to bypass RLS.

import { readFileSync, writeFileSync } from 'fs'
import { createClient } from '@supabase/supabase-js'

// ── Credentials ──────────────────────────────────────────────────────────────
const vars = Object.fromEntries(
  readFileSync('.dev.vars', 'utf8')
    .split('\n')
    .filter(l => l.includes('='))
    .map(l => {
      const idx = l.indexOf('=')
      return [l.slice(0, idx).trim(), l.slice(idx + 1).trim()]
    })
)

const SUPABASE_URL  = vars.SUPABASE_URL
const SUPABASE_KEY  = vars.SUPABASE_SERVICE_ROLE_KEY || vars.SUPABASE_ANON_KEY
const usingService  = !!vars.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or key in .dev.vars')
  process.exit(1)
}

if (usingService) {
  console.log('Auth: service_role key (RLS bypassed)')
} else {
  console.warn('Auth: anon key — model_predictions requires authenticated access.')
  console.warn('Add SUPABASE_SERVICE_ROLE_KEY=<key> to .dev.vars for full results.\n')
}

const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false },
})

// ── Constants ────────────────────────────────────────────────────────────────
const RHO   = -0.0612   // DC params from last refit (dcRatings.js)
const MAX_G = 8         // matrix dimension 0..MAX_G
const MAX_K = 7         // max total goals considered for anchor (k=0..7)

// ── Poisson PMF (mirrors src/utils/dcRatings.js exactly) ────────────────────
function poissonPMF(k, lambda) {
  if (lambda <= 0) return k === 0 ? 1 : 0
  let logP = k * Math.log(lambda) - lambda
  for (let i = 1; i <= k; i++) logP -= Math.log(i)
  return Math.exp(logP)
}

// ── Dixon-Coles tau correction ───────────────────────────────────────────────
function tau(x, y, lh, la) {
  if (x === 0 && y === 0) return Math.max(1 - lh * la * RHO, 0.001)
  if (x === 0 && y === 1) return Math.max(1 + lh * RHO, 0.001)
  if (x === 1 && y === 0) return Math.max(1 + la * RHO, 0.001)
  if (x === 1 && y === 1) return Math.max(1 - RHO, 0.001)
  return 1.0
}

// ── Matrix builders ──────────────────────────────────────────────────────────

function buildV1Matrix(lh, la) {
  const M = []
  let total = 0
  for (let x = 0; x <= MAX_G; x++) {
    M[x] = []
    for (let y = 0; y <= MAX_G; y++) {
      const v = poissonPMF(x, lh) * poissonPMF(y, la)
      M[x][y] = v
      total += v
    }
  }
  if (total > 0)
    for (let x = 0; x <= MAX_G; x++)
      for (let y = 0; y <= MAX_G; y++)
        M[x][y] /= total
  return M
}

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
      for (let y = 0; y <= MAX_G; y++)
        M[x][y] /= total
  return M
}

function buildV3Matrix(lh, la) {
  const dc = buildDCMatrix(lh, la)
  const v1 = buildV1Matrix(lh, la)
  const M = []
  for (let x = 0; x <= MAX_G; x++) {
    M[x] = []
    for (let y = 0; y <= MAX_G; y++)
      M[x][y] = 0.65 * dc[x][y] + 0.35 * v1[x][y]
  }
  return M
}

// ── Outcome helper ───────────────────────────────────────────────────────────
function cellMatchesOutcome(x, y, dominant) {
  if (dominant === 'home') return x > y
  if (dominant === 'away') return x < y
  return x === y
}

// ── Analyse a score matrix ───────────────────────────────────────────────────
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
      allCells.push({ x, y, p })
    }
  }

  const dominant =
    homeWin >= draw && homeWin >= awayWin ? 'home' :
    awayWin >= homeWin && awayWin >= draw  ? 'away' : 'draw'

  // Total goals P(k) for k = 0..MAX_K
  const goalsDist = totals.slice(0, MAX_K + 1)

  // k* = argmax P(k)
  let anchor = 0, anchorProb = goalsDist[0]
  for (let k = 1; k <= MAX_K; k++) {
    if (goalsDist[k] > anchorProb) { anchorProb = goalsDist[k]; anchor = k }
  }

  // ADS = P(k*) - P(k*-1) - P(k*+1)
  const pPrev = anchor > 0      ? goalsDist[anchor - 1] : 0
  const pNext = anchor < MAX_K  ? goalsDist[anchor + 1] : 0
  const ads   = anchorProb - pPrev - pNext

  // PASP tier
  let tier, split
  if      (ads >  0.10) { tier = 'STRONG';   split = '50/25/15/10' }
  else if (ads >= 0.00) { tier = 'MODERATE'; split = '45/25/20/10' }
  else if (ads >= -0.10){ tier = 'WEAK';     split = '40/30/20/10' }
  else                  { tier = 'FLAT';     split = '35/30/25/10' }

  // Scorelines at anchor total matching dominant outcome
  const candidates = allCells
    .filter(c => c.x + c.y === anchor && cellMatchesOutcome(c.x, c.y, dominant))
    .sort((a, b) => b.p - a.p)

  const primary   = candidates[0] || null
  const secondary = candidates[1] || null

  // Top 3 overall scorelines
  const top3 = [...allCells].sort((a, b) => b.p - a.p).slice(0, 3)

  return {
    homeWin, draw, awayWin, dominant,
    goalsDist, anchor, anchorProb, ads,
    tier, split,
    primary, secondary, top3,
  }
}

// ── Score a model against actual result ─────────────────────────────────────
function scoreModel(stats, actualHome, actualAway) {
  const actualTotal  = actualHome + actualAway
  const actualResult = actualHome > actualAway ? 'home' : actualHome < actualAway ? 'away' : 'draw'

  return {
    direction_hit:  stats.dominant === actualResult,
    primary_hit:    !!stats.primary   && stats.primary.x   === actualHome && stats.primary.y   === actualAway,
    secondary_hit:  !!stats.secondary && stats.secondary.x === actualHome && stats.secondary.y === actualAway,
    top3_hit:       stats.top3.some(c => c.x === actualHome && c.y === actualAway),
    anchor_hit:     stats.anchor === actualTotal,
    goals_error:    Math.abs(stats.anchor - actualTotal),
  }
}

// ── Aggregate across all matches ─────────────────────────────────────────────
function aggregate(matchResults) {
  const n = matchResults.length
  if (n === 0) {
    return { n: 0, direction: 0, primary: 0, secondary: 0, top3: 0, anchor: 0, meanError: 0, strong: 0, flat: 0 }
  }
  let direction = 0, primary = 0, secondary = 0, top3 = 0, anchor = 0, errSum = 0, strong = 0, flat = 0
  for (const { stats, score } of matchResults) {
    if (score.direction_hit)  direction++
    if (score.primary_hit)    primary++
    if (score.secondary_hit)  secondary++
    if (score.top3_hit)       top3++
    if (score.anchor_hit)     anchor++
    errSum += score.goals_error
    if (stats.tier === 'STRONG') strong++
    if (stats.tier === 'FLAT')   flat++
  }
  return { n, direction, primary, secondary, top3, anchor, meanError: errSum / n, strong, flat }
}

// ── Fetch from Supabase ──────────────────────────────────────────────────────
async function fetchData() {
  const { data: matches, error: mErr } = await sb
    .from('matches')
    .select('id, home_team, away_team, home_team_code, away_team_code, home_score, away_score, stage, group_name, venue, city, match_date')
    .eq('status', 'finished')
    .order('match_date', { ascending: true })

  if (mErr) throw new Error(`matches fetch: ${mErr.message}`)
  if (!matches?.length) return []

  const ids = matches.map(m => m.id)

  const { data: preds, error: pErr } = await sb
    .from('model_predictions')
    .select('match_id, v3_lambda_home, v3_lambda_away, v3_home_win, v3_draw, v3_away_win')
    .in('match_id', ids)

  if (pErr) throw new Error(`model_predictions fetch: ${pErr.message}`)

  const predMap = {}
  for (const p of preds || []) predMap[p.match_id] = p

  return matches.map(m => ({ match: m, pred: predMap[m.id] || null }))
}

// ── HTML helpers ─────────────────────────────────────────────────────────────
const TIER_COLOR = { STRONG: '#22c55e', MODERATE: '#3b82f6', WEAK: '#f59e0b', FLAT: '#ef4444' }

const FLAGS = {
  'USA': '🇺🇸', 'Canada': '🇨🇦', 'Mexico': '🇲🇽',
  'Argentina': '🇦🇷', 'Brazil': '🇧🇷', 'France': '🇫🇷',
  'England': '🏴󠁧󠁢󠁥󠁮󠁧󠁿', 'Spain': '🇪🇸', 'Germany': '🇩🇪',
  'Portugal': '🇵🇹', 'Netherlands': '🇳🇱', 'Belgium': '🇧🇪',
  'Croatia': '🇭🇷', 'Uruguay': '🇺🇾', 'Colombia': '🇨🇴',
  'Japan': '🇯🇵', 'Morocco': '🇲🇦', 'Senegal': '🇸🇳',
  'South Korea': '🇰🇷', 'Australia': '🇦🇺', 'Ecuador': '🇪🇨',
  'Denmark': '🇩🇰', 'Switzerland': '🇨🇭', 'Serbia': '🇷🇸',
  'Ghana': '🇬🇭', 'Tunisia': '🇹🇳', 'Iran': '🇮🇷',
  'Qatar': '🇶🇦', 'Saudi Arabia': '🇸🇦', 'Nigeria': '🇳🇬',
  'Ivory Coast': '🇨🇮', 'Norway': '🇳🇴', 'Sweden': '🇸🇪',
  'Austria': '🇦🇹', 'Turkey': '🇹🇷', 'Egypt': '🇪🇬',
  'Algeria': '🇩🇿', 'Costa Rica': '🇨🇷', 'Panama': '🇵🇦',
  'Honduras': '🇭🇳', 'Haiti': '🇭🇹', 'New Zealand': '🇳🇿',
  'Uzbekistan': '🇺🇿', 'DR Congo': '🇨🇩', 'Iraq': '🇮🇶',
  'Jordan': '🇯🇴', 'South Africa': '🇿🇦', 'Paraguay': '🇵🇾',
  'Scotland': '🏴󠁧󠁢󠁳󠁣󠁴󠁿', 'Bosnia-Herzegovina': '🇧🇦',
  'Cape Verde': '🇨🇻', 'Curacao': '🇨🇼',
}

function flag(team) { return FLAGS[team] || '🏳️' }

function stageLabel(stage, group) {
  if (stage === 'group') return group ? `Group ${group}` : 'Group Stage'
  return { r32: 'R32', r16: 'R16', qf: 'QF', sf: 'SF', '3rd': '3rd Place', final: 'Final' }[stage] || stage
}

function hit(b) {
  return b
    ? '<span style="color:#22c55e;font-weight:700;font-size:14px">✓</span>'
    : '<span style="color:#ef4444;font-size:14px">✗</span>'
}

function fmtPct(v, n) {
  if (n === 0) return '—'
  return `${v}/${n} <span style="color:#64748b">(${(v / n * 100).toFixed(1)}%)</span>`
}
function fmtErr(e) { return isNaN(e) || !isFinite(e) ? '—' : e.toFixed(2) }
function fmtN(n) { return String(n) }
function p(v) { return (v * 100).toFixed(1) + '%' }

// Best-in-row for summary table
function sumRow(label, v1v, dcv, v3v, fmtFn, higherBetter = true) {
  const vals = [v1v, dcv, v3v]
  const best = higherBetter ? Math.max(...vals) : Math.min(...vals)
  const cells = vals.map(v =>
    `<td style="text-align:center;padding:9px 16px${v === best ? ';background:#dcfce7;font-weight:700' : ''}">${fmtFn(v)}</td>`
  ).join('')
  return `<tr><td style="padding:9px 16px;color:#334155">${label}</td>${cells}</tr>`
}

// Per-match column
function modelCol(stats, score, isLast) {
  const domStyle = (o) => o === stats.dominant
    ? 'background:#0F3460;color:#fff;padding:2px 7px;border-radius:4px;font-weight:700'
    : 'background:#f1f5f9;color:#64748b;padding:2px 7px;border-radius:4px'

  const primary   = stats.primary   ? `${stats.primary.x}-${stats.primary.y}`   : '—'
  const secondary = stats.secondary ? `${stats.secondary.x}-${stats.secondary.y}` : '—'
  const primaryP  = stats.primary   ? p(stats.primary.p)   : '—'
  const secondaryP= stats.secondary ? p(stats.secondary.p) : '—'

  return `
  <div style="padding:12px 14px${isLast ? '' : ';border-right:1px solid #e2e8f0'}">
    <div style="display:flex;gap:5px;margin-bottom:10px;font-family:monospace;font-size:11px;flex-wrap:wrap">
      <span style="${domStyle('home')}">Win ${p(stats.homeWin)}</span>
      <span style="${domStyle('draw')}">Draw ${p(stats.draw)}</span>
      <span style="${domStyle('away')}">Away ${p(stats.awayWin)}</span>
    </div>
    <div style="font-family:monospace;font-size:12px;line-height:1.9;color:#1e293b">
      <div><span style="color:#64748b">Primary  </span><b>${primary}</b> <span style="color:#64748b">${primaryP}</span></div>
      <div><span style="color:#64748b">Secondary</span><b>${secondary}</b> <span style="color:#64748b">${secondaryP}</span></div>
      <div><span style="color:#64748b">Anchor   </span><b>${stats.anchor}g</b> <span style="color:#64748b">${p(stats.anchorProb)}</span> · ADS <b>${stats.ads.toFixed(3)}</b></div>
      <div><span style="color:#64748b">Tier     </span>
        <span style="background:${TIER_COLOR[stats.tier]};color:#fff;padding:1px 7px;border-radius:10px;font-size:10px;font-weight:700">${stats.tier}</span>
        <span style="color:#94a3b8;font-size:10px"> ${stats.split}</span>
      </div>
    </div>
    <div style="display:flex;gap:14px;margin-top:10px;font-size:11px;font-family:monospace;border-top:1px solid #f1f5f9;padding-top:8px">
      <span>Dir ${hit(score.direction_hit)}</span>
      <span>Anchor ${hit(score.anchor_hit)}</span>
      <span>Primary ${hit(score.primary_hit)}</span>
      <span>Top-3 ${hit(score.top3_hit)}</span>
    </div>
  </div>`
}

// ── Full HTML document ───────────────────────────────────────────────────────
function generateHTML(rows, agg) {
  const runDate = new Date().toISOString().slice(0, 19).replace('T', ' ') + ' UTC'
  const n = rows.length

  const summaryBlock = `
  <div style="padding:20px 24px 8px">
    <table style="width:100%;border-collapse:collapse;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1);font-size:13px">
      <thead>
        <tr style="background:#0F3460;color:#fff;text-align:left">
          <th style="padding:11px 16px">Metric</th>
          <th style="padding:11px 16px;text-align:center">V1</th>
          <th style="padding:11px 16px;text-align:center">DC-only</th>
          <th style="padding:11px 16px;text-align:center">V3</th>
        </tr>
      </thead>
      <tbody>
        <tr style="background:#f8fafc">
          <td style="padding:9px 16px;color:#64748b">Matches analysed</td>
          <td style="text-align:center;padding:9px 16px">${agg.v1.n}</td>
          <td style="text-align:center;padding:9px 16px">${agg.dc.n}</td>
          <td style="text-align:center;padding:9px 16px">${agg.v3.n}</td>
        </tr>
        ${sumRow('Direction accuracy', agg.v1.direction, agg.dc.direction, agg.v3.direction, v => fmtPct(v, n))}
        ${sumRow('Primary score hit',  agg.v1.primary,   agg.dc.primary,   agg.v3.primary,   v => fmtPct(v, n))}
        ${sumRow('Secondary score hit',agg.v1.secondary, agg.dc.secondary, agg.v3.secondary, v => fmtPct(v, n))}
        ${sumRow('Top-3 hit',          agg.v1.top3,      agg.dc.top3,      agg.v3.top3,      v => fmtPct(v, n))}
        ${sumRow('Anchor hit',         agg.v1.anchor,    agg.dc.anchor,    agg.v3.anchor,    v => fmtPct(v, n))}
        ${sumRow('Mean goals error',   agg.v1.meanError, agg.dc.meanError, agg.v3.meanError, fmtErr, false)}
        ${sumRow('STRONG anchors',     agg.v1.strong,    agg.dc.strong,    agg.v3.strong,    fmtN)}
        ${sumRow('FLAT anchors',       agg.v1.flat,      agg.dc.flat,      agg.v3.flat,      fmtN, false)}
      </tbody>
    </table>
  </div>`

  const noDataBanner = n === 0 ? `
  <div style="margin:24px;padding:32px;background:#fff;border-radius:8px;text-align:center;color:#64748b;box-shadow:0 1px 3px rgba(0,0,0,.1)">
    <div style="font-size:36px;margin-bottom:12px">📭</div>
    <div style="font-size:15px;font-weight:600;color:#1e293b;margin-bottom:6px">No data to backtest</div>
    <div style="font-size:13px;line-height:1.7;max-width:480px;margin:0 auto">
      Either no WC2026 matches have <code>status='finished'</code> yet, or
      <code>model_predictions</code> is empty (RLS blocks the anon key).<br><br>
      To fix: add <code>SUPABASE_SERVICE_ROLE_KEY=&lt;key&gt;</code> to <code>.dev.vars</code>
      and re-run.
    </div>
  </div>` : ''

  const cardsHTML = rows.map(r => {
    const { match, v1Stats, dcStats, v3Stats, v1Score, dcScore, v3Score } = r
    const actual  = `${match.home_score}–${match.away_score}`
    const dateStr = new Date(match.match_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
    const venue   = [match.city, match.venue].filter(Boolean).join(' · ')

    return `
  <div style="margin:0 24px 14px;background:#fff;border-radius:8px;box-shadow:0 1px 3px rgba(0,0,0,.1);overflow:hidden">
    <div style="background:#1A1A2E;color:#fff;padding:10px 16px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
      <div style="font-size:14px;font-weight:600;font-family:monospace;display:flex;align-items:center;gap:8px">
        <span>${flag(match.home_team)} ${match.home_team}</span>
        <span style="background:#0F3460;padding:3px 12px;border-radius:4px;font-size:15px">${actual}</span>
        <span>${match.away_team} ${flag(match.away_team)}</span>
      </div>
      <div style="font-size:10px;color:#94a3b8;font-family:monospace;text-align:right">
        ${stageLabel(match.stage, match.group_name)} · ${venue} · ${dateStr}
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr">
      <div style="padding:7px 14px 0;grid-column:1/-1;display:grid;grid-template-columns:1fr 1fr 1fr;border-bottom:1px solid #e2e8f0">
        ${['V1','DC-only','V3'].map((l, i) =>
          `<div style="padding:5px 0 5px${i < 2 ? ';border-right:1px solid #e2e8f0' : ''};font-size:9px;font-weight:700;letter-spacing:.12em;color:#fff;text-align:center">
            <span style="background:#0F3460;padding:3px 12px;border-radius:3px">${l}</span>
          </div>`
        ).join('')}
      </div>
      ${modelCol(v1Stats, v1Score, false)}
      ${modelCol(dcStats, dcScore, false)}
      ${modelCol(v3Stats, v3Score, true)}
    </div>
  </div>`
  }).join('')

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Metis Backtest — WC2026</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding-bottom:56px}
    code{font-family:monospace;background:#f1f5f9;padding:1px 4px;border-radius:3px;font-size:12px}
    tbody tr:nth-child(even){background:#f8fafc}
  </style>
</head>
<body>
  <div style="position:sticky;top:0;z-index:20;background:#1A1A2E;padding:12px 24px 10px;border-bottom:1px solid #0F3460">
    <div style="font-size:16px;font-weight:700;color:#fff;letter-spacing:.06em">METIS BACKTEST — WC2026</div>
    <div style="font-size:11px;color:#94a3b8;margin-top:3px">
      ${n} matches · V1 vs DC-only vs V3 · ${runDate}
    </div>
  </div>

  ${summaryBlock}
  ${noDataBanner}

  ${n > 0 ? `<div style="padding:8px 24px 4px">
    <div style="font-size:10px;font-weight:700;letter-spacing:.12em;color:#64748b;text-transform:uppercase">Per-Match Detail</div>
  </div>` : ''}
  ${cardsHTML}
</body>
</html>`
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('Fetching finished WC2026 matches…')
  const data = await fetchData()
  console.log(`Matches returned: ${data.length}`)

  const rows    = []
  let skipped   = 0
  let noPred    = 0

  for (const { match, pred } of data) {
    if (match.home_score == null || match.away_score == null) { skipped++; continue }

    if (!pred || pred.v3_lambda_home == null || pred.v3_lambda_away == null) {
      noPred++
      continue
    }

    const lh = Number(pred.v3_lambda_home)
    const la = Number(pred.v3_lambda_away)

    if (!isFinite(lh) || !isFinite(la) || lh <= 0 || la <= 0) { skipped++; continue }

    const v1M = buildV1Matrix(lh, la)
    const dcM = buildDCMatrix(lh, la)
    const v3M = buildV3Matrix(lh, la)

    const v1Stats = analyseMatrix(v1M)
    const dcStats = analyseMatrix(dcM)
    const v3Stats = analyseMatrix(v3M)

    const v1Score = scoreModel(v1Stats, match.home_score, match.away_score)
    const dcScore = scoreModel(dcStats, match.home_score, match.away_score)
    const v3Score = scoreModel(v3Stats, match.home_score, match.away_score)

    rows.push({ match, v1Stats, dcStats, v3Stats, v1Score, dcScore, v3Score })
  }

  if (noPred   > 0) console.log(`  No predictions: ${noPred} matches (RLS or missing lambdas)`)
  if (skipped  > 0) console.log(`  Skipped: ${skipped} matches (no score or invalid lambdas)`)
  console.log(`  Backtesting: ${rows.length} matches\n`)

  const agg = {
    v1: aggregate(rows.map(r => ({ stats: r.v1Stats, score: r.v1Score }))),
    dc: aggregate(rows.map(r => ({ stats: r.dcStats, score: r.dcScore }))),
    v3: aggregate(rows.map(r => ({ stats: r.v3Stats, score: r.v3Score }))),
  }

  const n = rows.length
  if (n > 0) {
    console.log('=== SUMMARY ===')
    const pct = (h) => `${(h / n * 100).toFixed(1)}%`
    console.log(`Direction accuracy  V1 ${pct(agg.v1.direction)} | DC ${pct(agg.dc.direction)} | V3 ${pct(agg.v3.direction)}`)
    console.log(`Primary score hit   V1 ${pct(agg.v1.primary)}  | DC ${pct(agg.dc.primary)}  | V3 ${pct(agg.v3.primary)}`)
    console.log(`Top-3 hit           V1 ${pct(agg.v1.top3)}     | DC ${pct(agg.dc.top3)}     | V3 ${pct(agg.v3.top3)}`)
    console.log(`Anchor hit          V1 ${pct(agg.v1.anchor)}   | DC ${pct(agg.dc.anchor)}   | V3 ${pct(agg.v3.anchor)}`)
    console.log(`Mean goals error    V1 ${agg.v1.meanError.toFixed(2)}     | DC ${agg.dc.meanError.toFixed(2)}    | V3 ${agg.v3.meanError.toFixed(2)}`)
  }

  const html = generateHTML(rows, agg)
  writeFileSync('scripts/backtest_output.html', html)

  console.log('\nOutput → scripts/backtest_output.html')
  console.log('Open:    open scripts/backtest_output.html')
}

main().catch(err => {
  console.error('Fatal:', err.message)
  process.exit(1)
})
