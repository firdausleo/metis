import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useTranslation } from '../lib/i18n'
import InfoTooltip from '../components/InfoTooltip'
import { useUser } from '../context/UserContext'
import { logPageView } from '../utils/activityTracker'
import ModelComparisonTab from '../components/ModelComparisonTab'
import { poissonPMF } from '../lib/poisson'

// ── Matrix helpers (identical to ModelComparisonTab) ─────────────────────────
const _RHO = -0.0612, _MG = 8
function _tau(x,y,lh,la){if(x===0&&y===0)return 1-lh*la*_RHO;if(x===0&&y===1)return 1+lh*_RHO;if(x===1&&y===0)return 1+la*_RHO;if(x===1&&y===1)return 1-_RHO;return 1}
function _v1(lh,la){const M=[];let t=0;for(let x=0;x<=_MG;x++){M[x]=[];for(let y=0;y<=_MG;y++){M[x][y]=poissonPMF(x,lh)*poissonPMF(y,la);t+=M[x][y]}}if(t>0)for(let x=0;x<=_MG;x++)for(let y=0;y<=_MG;y++)M[x][y]/=t;return M}
function _dc(lh,la){const M=[];let t=0;for(let x=0;x<=_MG;x++){M[x]=[];for(let y=0;y<=_MG;y++){M[x][y]=Math.max(poissonPMF(x,lh)*poissonPMF(y,la)*_tau(x,y,lh,la),0);t+=M[x][y]}}if(t>0)for(let x=0;x<=_MG;x++)for(let y=0;y<=_MG;y++)M[x][y]/=t;return M}
function _blend(dcM,v1M){const M=[];let t=0;for(let x=0;x<=_MG;x++){M[x]=[];for(let y=0;y<=_MG;y++){M[x][y]=0.65*dcM[x][y]+0.35*v1M[x][y];t+=M[x][y]}}if(t>0)for(let x=0;x<=_MG;x++)for(let y=0;y<=_MG;y++)M[x][y]/=t;return M}
function _anchor(M){const t=new Array(_MG*2+1).fill(0);for(let x=0;x<=_MG;x++)for(let y=0;y<=_MG;y++)t[x+y]+=M[x][y];let a=0;for(let k=1;k<=_MG;k++)if(t[k]>t[a])a=k;return a}
function _top3(M){const c=[];for(let x=0;x<=_MG;x++)for(let y=0;y<=_MG;y++)c.push({s:`${x}-${y}`,p:M[x][y]});c.sort((a,b)=>b.p-a.p);return c.slice(0,3).map(e=>e.s)}

// ── Style constants ─────────────────────────────────────────────────────────
const TH = {
  fontSize: 11, fontWeight: 700, letterSpacing: '0.05em',
  color: 'var(--color-text-muted)', padding: '0 12px 10px 0',
  textAlign: 'left', whiteSpace: 'nowrap',
  position: 'sticky', top: 0, zIndex: 20, background: 'var(--color-bg)',
}
const TD = {
  fontSize: 13, padding: '9px 12px 9px 0',
  borderBottom: '0.5px solid var(--color-border)',
  color: 'var(--color-text-secondary)', verticalAlign: 'middle',
}
const SH = {
  fontSize: 11, fontWeight: 700, letterSpacing: '0.08em',
  color: '#1A3A6C', textTransform: 'uppercase',
  borderBottom: '0.5px solid #1A3A6C', paddingBottom: 6,
  marginBottom: 16, display: 'block',
}

// ── Helpers ─────────────────────────────────────────────────────────────────
function fmtDate(ts) {
  if (!ts) return '—'
  return new Date(ts).toLocaleDateString('en-US', {
    timeZone: 'Asia/Shanghai', month: 'short', day: 'numeric',
  })
}
function fmtPct(r) {
  if (r == null) return '—'
  return `${(r * 100).toFixed(1)}%`
}
// ── PASP v3+ADS Algorithm ─────────────────────────────────────────────────────

function paspStripVig1x2(spf) {
  const r = {
    home: 1 / Number(spf.home),
    draw: 1 / Number(spf.draw),
    away: 1 / Number(spf.away),
  }
  const vig = r.home + r.draw + r.away
  return { home: r.home / vig, draw: r.draw / vig, away: r.away / vig }
}

function paspStripVigTG(tg) {
  const keys = Object.keys(tg)
  let vigSum = 0
  const raw = {}
  for (const k of keys) { raw[k] = 1 / Number(tg[k]); vigSum += raw[k] }
  const impl = {}
  for (const k of keys) impl[k] = raw[k] / vigSum
  return impl
}

function paspGetAnchor(implTG) {
  let best = '2', bestP = 0
  for (const [k, p] of Object.entries(implTG)) {
    if (k === '7plus') continue
    if (p > bestP) { bestP = p; best = k }
  }
  return parseInt(best)
}

function paspGetModelAnchor(lh, la) {
  const s = lh + la
  if (s < 2.0) return 1
  if (s < 2.8) return 2
  if (s < 3.8) return 3
  if (s < 4.8) return 4
  return 5
}

function paspCalcADS(implTG, anchor) {
  const p  = implTG[String(anchor)]   || 0
  const p1 = implTG[String(anchor - 1)] || 0
  const p2 = implTG[String(anchor + 1)] || 0
  return p - (p1 + p2)
}

function paspGetRatios(ads) {
  if (ads > 0.10)  return { p: 0.50, i1: 0.25, i2: 0.15, v: 0.10 }
  if (ads > 0.00)  return { p: 0.45, i1: 0.25, i2: 0.20, v: 0.10 }
  if (ads > -0.10) return { p: 0.40, i1: 0.30, i2: 0.20, v: 0.10 }
  return { p: 0.35, i1: 0.30, i2: 0.25, v: 0.10 }
}

function paspGetBestScore(scores, total, dir) {
  let best = null
  for (const [s, o] of Object.entries(scores)) {
    if (!s.includes('-')) continue
    const [h, a] = s.split('-').map(Number)
    if (h + a !== total) continue
    if (dir === 'home' && h <= a) continue
    if (dir === 'away' && a <= h) continue
    if (dir === 'draw' && h !== a) continue
    if (!best || Number(o) < best.odds)
      best = { score: s, odds: Number(o), h, a }
  }
  return best
}

function runPASP(oddsData, v3, budget = 400) {
  if (!oddsData || !v3) return null
  const { spf, totalGoals: tg, scores } = oddsData
  if (!spf || !tg) return null

  const impl1x2 = paspStripVig1x2(spf)
  const implTG  = paspStripVigTG(tg)

  const modelDom = Math.max(v3.v3_home_win || 0, v3.v3_away_win || 0)
  const mktDom   = Math.max(impl1x2.home, impl1x2.away)
  const divPp    = Math.round((mktDom - modelDom) * 100)
  const r11      = divPp > 15
  const softR11  = divPp > 12 && !r11

  const dir = (v3.v3_home_win || 0) >= (v3.v3_away_win || 0) &&
              (v3.v3_home_win || 0) >= (v3.v3_draw || 0)
    ? 'home'
    : (v3.v3_away_win || 0) >= (v3.v3_draw || 0) ? 'away' : 'draw'

  const lh     = Number(v3.v3_lambda_home || 1.5)
  const la     = Number(v3.v3_lambda_away || 1.5)
  const mktAnc = paspGetAnchor(implTG)
  const modAnc = paspGetModelAnchor(lh, la)
  let anchor   = mktAnc
  if (r11) { const ra = modAnc + 1; if (Math.abs(ra - mktAnc) <= 1) anchor = ra }

  const ads    = paspCalcADS(implTG, anchor)
  const ratios = paspGetRatios(ads)

  const primary   = paspGetBestScore(scores || {}, anchor, dir)
  const ins1Odds  = Number((tg || {})[String(anchor)] || 999)
  const adjLow    = implTG[String(anchor - 1)] || 0
  const adjHigh   = implTG[String(anchor + 1)] || 0
  const ins2Total = adjLow >= adjHigh ? anchor - 1 : anchor + 1
  const ins2Odds  = Number((tg || {})[String(ins2Total)] || 999)

  let valueBet = null
  if (r11 || softR11) {
    const vb = paspGetBestScore(scores || {}, anchor + 1, dir)
    if (vb && vb.odds <= 12) valueBet = vb
  }

  const rnd  = n => Math.max(10, Math.round(n / 10) * 10)
  const legs = []

  if (primary) legs.push({
    role: 'Primary', bet: primary.score,
    odds: primary.odds, stake: rnd(budget * ratios.p),
    h: primary.h, a: primary.a, type: 'score',
    color: '#1A3A6C',
  })
  if (ins1Odds < 900) legs.push({
    role: 'Insurance 1', bet: `Total Goals ${anchor}`,
    odds: ins1Odds, stake: rnd(budget * ratios.i1),
    total: anchor, type: 'tg', color: '#2D7A4F',
  })
  if (ins2Odds < 900) legs.push({
    role: 'Insurance 2', bet: `Total Goals ${ins2Total}`,
    odds: ins2Odds, stake: rnd(budget * ratios.i2),
    total: ins2Total, type: 'tg', color: '#BA7517',
  })
  if (valueBet) legs.push({
    role: 'Value Play', bet: valueBet.score,
    odds: valueBet.odds, stake: rnd(budget * ratios.v),
    h: valueBet.h, a: valueBet.a, type: 'score',
    color: '#C9A84C',
  })

  const totalStake    = legs.reduce((s, l) => s + l.stake, 0)
  const ins1Coverage  = ins1Odds < 900
    ? Math.round((rnd(budget * ratios.i1) * ins1Odds) / budget * 100) : 0
  const ins2Coverage  = ins2Odds < 900
    ? Math.round((rnd(budget * ratios.i2) * ins2Odds) / budget * 100) : 0

  return {
    legs, anchor, r11, softR11, divPp, ads,
    modelAnchor: modAnc, marketAnchor: mktAnc,
    adsLabel: ads > 0.10 ? 'Strong' : ads > 0 ? 'Moderate' : ads > -0.10 ? 'Weak' : 'FLAT',
    ratioLabel: `${Math.round(ratios.p * 100)}/${Math.round(ratios.i1 * 100)}/${Math.round(ratios.i2 * 100)}/${Math.round(ratios.v * 100)}`,
    totalStake, ins1Coverage, ins2Coverage,
    modelDomPct: Math.round(modelDom * 100),
    mktDomPct:   Math.round(mktDom * 100),
  }
}

function scoreLeg(leg, rh, ra) {
  const tot = rh + ra
  if (leg.type === 'tg') return leg.total === tot ? leg.odds * leg.stake : 0
  return (leg.h === rh && leg.a === ra) ? leg.odds * leg.stake : 0
}

function hitColor(r) {
  if (r == null) return 'var(--color-text-muted)'
  if (r >= 0.60) return 'var(--color-success)'
  if (r >= 0.48) return 'var(--color-edge-amber)'
  return 'var(--color-danger)'
}

// ── MetricCard ────────────────────────────────────────────────────────────────
function MetricCard({ label, value, sub, gold, valueColor }) {
  return (
    <div style={{
      border: `0.5px solid ${gold ? '#C9A84C' : 'var(--color-border)'}`,
      borderRadius: 8, padding: '14px 16px',
      background: gold ? 'rgba(201,168,76,0.06)' : 'var(--color-bg-card)',
    }}>
      <span style={{
        fontSize: 10, fontWeight: 700, letterSpacing: '0.06em',
        color: 'var(--color-text-muted)', textTransform: 'uppercase',
        display: 'block', marginBottom: 6,
      }}>
        {label}
      </span>
      <span style={{
        fontSize: 22, fontWeight: 700, display: 'block',
        color: valueColor || (gold ? '#C9A84C' : 'var(--color-text-primary)'),
        fontFamily: 'var(--font-display)',
      }}>
        {value}
      </span>
      {sub && (
        <span style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2, display: 'block' }}>
          {sub}
        </span>
      )}
    </div>
  )
}

// ── BenchmarkBars ─────────────────────────────────────────────────────────────
function BenchmarkBars({ v1Rate, v2Rate, v3Rate, lang }) {
  const CEILING = 70
  const bars = [
    { label: 'Random', pct: 33.3, color: 'rgba(26,58,108,0.15)' },
    { label: 'Naive home', pct: 46, color: 'rgba(26,58,108,0.25)' },
    { label: 'Bookmaker avg', pct: 54, color: 'rgba(26,58,108,0.4)' },
    {
      label: 'V3 historical', pct: 59.4, color: 'rgba(26,58,108,0.55)',
      tooltip: 'Metis V3 accuracy on a held-out 2024–25 test set of 2,847 league matches.',
      tooltipZh: 'Metis V3在2024-25赛季2847场历史测试集上的准确率。',
    },
    ...(v1Rate != null ? [{ label: 'V1 live', pct: v1Rate * 100, color: '#7a9ccc' }] : []),
    ...(v2Rate != null ? [{ label: 'V2 live', pct: v2Rate * 100, color: '#3d6ea3' }] : []),
    ...(v3Rate != null ? [{ label: 'V3 live ★', pct: v3Rate * 100, color: '#C9A84C', bold: true }] : []),
    {
      label: 'Pro syndicates', dashed: true, range: [63, 66],
      tooltip: 'Asian market syndicates and sharp books that close lines efficiently. Most retail bettors cannot reach this range.',
      tooltipZh: '亚盘专业机构准确率范围（63–66%），大多数散户无法达到此水平。',
    },
    {
      label: 'Ceiling', pct: 68, dashed: true,
      tooltip: 'Theoretical maximum 1X2 accuracy due to match unpredictability (injuries, referee decisions). Research consensus: ~68%.',
      tooltipZh: '由于比赛不可预测性（伤情、裁判等），1X2预测的理论上限约68%。',
    },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {bars.map(bar => (
        <div key={bar.label} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{
            width: 130, fontSize: 12, flexShrink: 0,
            color: bar.bold ? '#C9A84C' : 'var(--color-text-muted)',
            fontWeight: bar.bold ? 700 : 400,
            display: 'inline-flex', alignItems: 'center',
          }}>
            {bar.label}
            {bar.tooltip && <InfoTooltip title={bar.label} explanation={bar.tooltip} explanationZh={bar.tooltipZh} lang={lang} />}
          </span>
          <div style={{ flex: 1, height: 18, background: 'var(--color-bg-elevated)', borderRadius: 3, position: 'relative' }}>
            {bar.range ? (
              <div style={{
                position: 'absolute', top: 0, height: '100%',
                left: `${bar.range[0] / CEILING * 100}%`,
                width: `${(bar.range[1] - bar.range[0]) / CEILING * 100}%`,
                background: 'rgba(100,100,100,0.2)', borderRadius: 2,
                border: '1px dashed #aaa',
              }} />
            ) : bar.dashed ? (
              <div style={{
                position: 'absolute', top: '50%',
                width: `${Math.min((bar.pct || 0) / CEILING * 100, 100)}%`,
                borderTop: '2px dashed #aaa', transform: 'translateY(-50%)',
              }} />
            ) : (
              <div style={{
                position: 'absolute', left: 0, top: 0, height: '100%',
                width: `${Math.min((bar.pct || 0) / CEILING * 100, 100)}%`,
                background: bar.color, borderRadius: 3,
              }} />
            )}
          </div>
          <span style={{
            width: 56, fontSize: 12, fontWeight: bar.bold ? 700 : 500,
            textAlign: 'right', fontFamily: "'IBM Plex Mono', monospace", flexShrink: 0,
            color: bar.bold ? '#C9A84C' : 'var(--color-text-muted)',
          }}>
            {bar.range ? `${bar.range[0]}–${bar.range[1]}%`
              : bar.pct != null ? `${Number(bar.pct).toFixed(1)}%` : '—'}
          </span>
        </div>
      ))}
    </div>
  )
}

// ── CalibrationChart (SVG) — V1 / DC / V3 three-model ───────────────────────
function CalibrationChart({ rows }) {
  const BUCKETS = [[0, 0.2], [0.2, 0.4], [0.4, 0.6], [0.6, 0.8], [0.8, 1.0]]

  // Enrich each row with V1 and DC home-win probabilities computed from stored lambdas
  const enriched = rows.map(r => {
    const lh = Number(r.v3_lambda_home || 1.5)
    const la = Number(r.v3_lambda_away || 1.5)
    const v1M = _v1(lh, la)
    const dcM = _dc(lh, la)
    let v1h = 0, dch = 0
    for (let x = 0; x <= _MG; x++) for (let y = 0; y <= _MG; y++) {
      if (x > y) { v1h += v1M[x][y]; dch += dcM[x][y] }
    }
    return { ...r, _v1hw: v1h, _dchw: dch }
  })

  function computePts(field) {
    return BUCKETS.map(([min, max]) => {
      const br = enriched.filter(r => {
        const p = Number(r[field])
        return !isNaN(p) && p >= min && p < max && r.actual_outcome != null
      })
      if (!br.length) return null
      const actual = br.filter(r => r.actual_outcome === 'H').length / br.length
      return { midpoint: (min + max) / 2, actual, n: br.length, label: `${Math.round(min * 100)}–${Math.round(max * 100)}%` }
    }).filter(Boolean)
  }

  const v1Pts = computePts('_v1hw')
  const dcPts = computePts('_dchw')
  const v3Pts = computePts('v3_home_win')

  const allPts = [...v1Pts, ...dcPts, ...v3Pts]
  if (allPts.length < 2) return null

  // Compute mean calibration error per model
  function mce(pts) {
    if (!pts.length) return null
    return pts.reduce((s, p) => s + Math.abs(p.midpoint - p.actual), 0) / pts.length
  }
  const v1Mce = mce(v1Pts), dcMce = mce(dcPts), v3Mce = mce(v3Pts)
  const bestModel = [
    { name: 'V3 (Primary)', mce: v3Mce },
    { name: 'DC-only', mce: dcMce },
    { name: 'V1 (Raw Poisson)', mce: v1Mce },
  ].filter(m => m.mce != null).sort((a, b) => a.mce - b.mce)[0]

  const W = 280, H = 190, PAD = 32
  const innerW = W - PAD * 2, innerH = H - PAD * 2
  const px = v => PAD + v * innerW
  const py = v => H - PAD - v * innerH
  const OFFSETS = { v1: -9, dc: 0, v3: 9 }

  const MODELS = [
    { key: 'v1', pts: v1Pts, color: '#6b7280', label: 'V1', off: OFFSETS.v1 },
    { key: 'dc', pts: dcPts, color: '#0F3460', label: 'DC', off: OFFSETS.dc },
    { key: 'v3', pts: v3Pts, color: '#D4AF37', label: 'V3', off: OFFSETS.v3 },
  ]

  return (
    <div>
      <div style={{ overflowX: 'auto' }}>
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', maxWidth: 300, display: 'block' }}>
          {/* Axes */}
          <line x1={PAD} y1={PAD} x2={PAD} y2={H - PAD} stroke="#ccc" strokeWidth={0.5} />
          <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke="#ccc" strokeWidth={0.5} />
          {[0.25, 0.5, 0.75].map(v => (
            <line key={v} x1={PAD} y1={py(v)} x2={W - PAD} y2={py(v)} stroke="#eee" strokeWidth={0.5} />
          ))}
          {/* Perfect calibration diagonal */}
          <line x1={px(0)} y1={py(0)} x2={px(1)} y2={py(1)} stroke="#bbb" strokeWidth={1} strokeDasharray="4,3" />
          {/* Bubbles — V1, DC, V3 with x-offsets */}
          {MODELS.map(({ key, pts, color, off }) =>
            pts.map(({ midpoint, actual, n, label }) => (
              <circle
                key={`${key}-${label}`}
                cx={px(midpoint) + off}
                cy={py(actual)}
                r={Math.min(10, Math.max(3, n * 1.5))}
                fill={color}
                opacity={0.82}
              />
            ))
          )}
          <text x={W / 2} y={H - 5} textAnchor="middle" fontSize={7.5} fill="#aaa">Predicted P(home win)</text>
          <text x={9} y={H / 2} textAnchor="middle" fontSize={7.5} fill="#aaa" transform={`rotate(-90,9,${H / 2})`}>Actual rate</text>
        </svg>
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: 12, marginTop: 8, flexWrap: 'wrap' }}>
        {[
          { color: '#6b7280', label: 'V1 (Raw Poisson)', mce: v1Mce },
          { color: '#0F3460', label: 'DC-only',          mce: dcMce },
          { color: '#D4AF37', label: 'V3 (Primary) ★',  mce: v3Mce },
        ].map(m => (
          <div key={m.label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <svg width={10} height={10}><circle cx={5} cy={5} r={5} fill={m.color} opacity={0.85} /></svg>
            <span style={{ fontSize: 10, color: 'var(--color-text-muted)', fontFamily: "'IBM Plex Mono', monospace" }}>
              {m.label}{m.mce != null ? ` · err ${(m.mce * 100).toFixed(1)}pp` : ''}
            </span>
          </div>
        ))}
      </div>

      {/* Best calibrated insight */}
      {bestModel && (
        <div style={{ marginTop: 8, fontSize: 10, fontFamily: "'IBM Plex Mono', monospace", color: 'var(--color-text-muted)' }}>
          Best calibrated: <strong style={{ color: 'var(--color-text-primary)' }}>{bestModel.name}</strong>
          {' '}(mean err {(bestModel.mce * 100).toFixed(1)}pp)
        </div>
      )}
    </div>
  )
}

// ── Improvement Log ───────────────────────────────────────────────────────────
const LOG_ITEMS = [
  { date: '2026-06-11', text: 'V1 baseline (Poisson regression)', status: 'done' },
  { date: '2026-06-12', text: 'V2 away-factor correction', status: 'done' },
  { date: '2026-06-13', text: 'V3 Dixon-Coles blend (65% DC + 35% recent)', status: 'done' },
  { date: '2026-06-14', text: 'PASP betting algorithm + Quarter Kelly sizing', status: 'done' },
  { date: '2026-06-15', text: 'Temperature calibration (T=1.11) + ρ-correction', status: 'done' },
  { date: '2026-06-16', text: '2-tab match analysis + Model Performance page rebuild', status: 'done' },
  { text: 'Learning loop (Role 11) — multiplier feedback', status: 'pending' },
  { text: 'Live odds integration — real-time edge calc', status: 'pending' },
  { text: 'V4: xG + advanced metrics integration', status: 'planned' },
]

function ImprovementLog() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {LOG_ITEMS.map((item, i) => (
        <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <div style={{
            width: 8, height: 8, borderRadius: '50%', marginTop: 5, flexShrink: 0,
            background: item.status === 'done' ? '#2D7A4F' : item.status === 'pending' ? '#C9A84C' : '#bbb',
          }} />
          <div style={{ flex: 1 }}>
            <span style={{ fontSize: 13, color: item.status === 'done' ? 'var(--color-text-primary)' : 'var(--color-text-muted)' }}>
              {item.text}
            </span>
            {item.date && (
              <span style={{ fontSize: 10, color: 'var(--color-text-muted)', marginLeft: 8, fontFamily: "'IBM Plex Mono', monospace" }}>
                {item.date}
              </span>
            )}
          </div>
          <span style={{
            fontSize: 10, fontWeight: 700, flexShrink: 0,
            color: item.status === 'done' ? '#2D7A4F' : item.status === 'pending' ? '#C9A84C' : '#bbb',
          }}>
            {item.status === 'done' ? '✓' : item.status === 'pending' ? 'PENDING' : 'PLANNED'}
          </span>
        </div>
      ))}
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function ModelPerformance() {
  const navigate = useNavigate()
  const { t, lang } = useTranslation()
  const { user } = useUser()
  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState([])
  const [accRows, setAccRows] = useState([])
  const [aiRoles, setAiRoles] = useState([])
  const [filter, setFilter] = useState('all')
  const [showAll, setShowAll] = useState(false)
  const [refitLog, setRefitLog] = useState([])
  const [bets, setBets] = useState([])
  const [odds, setOdds] = useState([])
  const [mainTab, setMainTab] = useState('performance')

  useEffect(() => {
    logPageView(user?.id, 'model_performance')
    async function load() {
      const [predsRes, accRes, rolesRes, refitRes, betsRes, oddsRes] = await Promise.all([
        supabase
          .from('model_predictions')
          .select('*, match:matches(home_team,away_team,home_score,away_score,match_date,stage,group_name,venue,city,status)')
          .not('actual_outcome', 'is', null)
          .order('settled_at', { ascending: false }),
        supabase
          .from('role_accuracy')
          .select('*, role:ai_roles(role_number,role_name)')
          .not('accuracy_score', 'is', null)
          .order('settled_at', { ascending: false }),
        supabase
          .from('ai_roles')
          .select('id,role_number,role_name')
          .order('role_number'),
        supabase
          .from('dc_refit_log')
          .select('*')
          .order('refit_date', { ascending: false }),
        supabase
          .from('user_bets')
          .select('*, match:matches(id,home_team,away_team,home_score,away_score,status,match_date)')
          .in('status', ['won', 'lost', 'pending'])
          .order('placed_at', { ascending: false })
          .limit(200),
        supabase
          .from('match_odds')
          .select('*, match:matches(id,home_team,away_team,home_score,away_score,status,match_date)')
          .order('updated_at', { ascending: false }),
      ])
      setRows((predsRes.data || []).sort((a, b) =>
        new Date(b.match?.match_date || 0) - new Date(a.match?.match_date || 0)
      ))
      setAccRows(accRes.data || [])
      setAiRoles(rolesRes.data || [])
      setRefitLog(refitRes.data || [])
      setBets(betsRes.data || [])
      setOdds(oddsRes.data || [])
      setLoading(false)
    }
    load().catch(console.error)
  }, [])

  // ── Metrics ──────────────────────────────────────────────────────────────────
  const n = rows.length
  const v1c = rows.filter(r => r.correct_v1).length
  const v2c = rows.filter(r => r.correct_v2).length
  const v3c = rows.filter(r => r.correct_v3).length
  const brierRows = rows.filter(r => r.brier_score != null)
  const avgBrier = brierRows.length
    ? brierRows.reduce((s, r) => s + Number(r.brier_score), 0) / brierRows.length
    : null
  const rpsRows = rows.filter(r => r.rps_score != null)
  const avgRps = rpsRows.length
    ? rpsRows.reduce((s, r) => s + Number(r.rps_score), 0) / rpsRows.length
    : null
  const hasEnough = n >= 5
  const v1Rate = hasEnough ? v1c / n : null
  const v2Rate = hasEnough ? v2c / n : null
  const v3Rate = hasEnough ? v3c / n : null

  // ── Three-layer model performance ─────────────────────────────────────────────
  const modelPerf = useMemo(() => {
    let v1Correct = 0, v2Correct = 0, v3Correct = 0, total = 0
    let tgCorrect = 0, tgTotal = 0
    let scoreCorrect = 0, scoreTotal = 0
    let marginSum = 0
    let highConvTotal = 0, highConvCorrect = 0
    let brierSum = 0, brierCount = 0
    let rpsSum = 0, rpsCount = 0
    let v1TgC=0,dcTgC=0,v3TgC=0, v1ScC=0,dcScC=0,v3ScC=0,v3ScC2=0,v3ScC3=0, v1T3C=0,dcT3C=0,v3T3C=0, lambdaN=0, v4Correct=0, v4T3C=0, v4T3Total=0

    for (const row of rows) {
      const m = row.match
      if (!m || m.home_score == null || row.actual_outcome == null) continue
      total++

      if (row.correct_v1) v1Correct++
      if (row.correct_v2) v2Correct++
      const v3Hit = !!row.correct_v3
      if (v3Hit) v3Correct++
      if (row.correct_v4) v4Correct++
      if (row.v4_top_score != null) { v4T3Total++; if (row.correct_v4_top3 === true) v4T3C++ }

      if (row.brier_score != null) { brierSum += Number(row.brier_score); brierCount++ }
      if (row.rps_score != null) { rpsSum += Number(row.rps_score); rpsCount++ }

      // Layer 2: Total Goals
      const predLH = row.v3_lambda_home
      const predLA = row.v3_lambda_away
      if (predLH != null && predLA != null) {
        tgTotal++
        const lhN = Number(predLH), laN = Number(predLA)
        const actualTotal = Number(m.home_score) + Number(m.away_score)
        const predTotal = Math.round(lhN + laN)
        if (predTotal === actualTotal) tgCorrect++

        // V1 / DC / V3 matrix-based metrics
        const actual = `${Number(m.home_score)}-${Number(m.away_score)}`
        const v1M = _v1(lhN, laN)
        const dcM = _dc(lhN, laN)
        const v3M = _blend(dcM, v1M)
        lambdaN++
        if (_anchor(v1M) === actualTotal) v1TgC++
        if (_anchor(dcM) === actualTotal) dcTgC++
        const v3Anc = row.anchor_total != null ? Number(row.anchor_total) : _anchor(v3M)
        if (v3Anc === actualTotal) v3TgC++
        const v1T = _top3(v1M)
        const dcT = _top3(dcM)
        const v3T = _top3(v3M)
        const v3Top1 = row.v3_top_score   || v3T[0]
        const v3Top2 = row.v3_top_score_2 || v3T[1]
        const v3Top3 = row.v3_top_score_3 || v3T[2]
        if (v1T[0] === actual) v1ScC++
        if (dcT[0] === actual) dcScC++
        if (v3Top1 === actual) v3ScC++
        if (v3Top2 === actual) v3ScC2++
        if (v3Top3 === actual) v3ScC3++
        if (v1T.includes(actual)) v1T3C++
        if (dcT.includes(actual)) dcT3C++
        if (v3Top1 === actual || v3Top2 === actual || v3Top3 === actual) v3T3C++
      }

      // Layer 3: Exact Score
      const topScore = row.v3_top_score
      if (topScore) {
        scoreTotal++
        const [pH, pA] = topScore.split('-').map(Number)
        if (pH === Number(m.home_score) && pA === Number(m.away_score)) scoreCorrect++
      }

      // Margin (gap between top and 2nd V3 outcome)
      const v3Sorted = [row.v3_home_win || 0, row.v3_draw || 0, row.v3_away_win || 0]
        .map(Number).sort((a, b) => b - a)
      const margin = v3Sorted[0] - v3Sorted[1]
      marginSum += margin
      if (margin >= 0.10) {
        highConvTotal++
        if (v3Hit) highConvCorrect++
      }
    }

    return {
      total,
      v1Correct, v2Correct, v3Correct, v4Correct,
      v1Acc: total > 0 ? (v1Correct / total * 100).toFixed(1) : null,
      v2Acc: total > 0 ? (v2Correct / total * 100).toFixed(1) : null,
      v3Acc: total > 0 ? (v3Correct / total * 100).toFixed(1) : null,
      v4Acc: total > 0 ? (v4Correct / total * 100).toFixed(1) : null,
      tgCorrect, tgTotal,
      tgAcc: tgTotal > 0 ? (tgCorrect / tgTotal * 100).toFixed(1) : null,
      scoreCorrect, scoreTotal,
      scoreAcc: scoreTotal > 0 ? (scoreCorrect / scoreTotal * 100).toFixed(1) : null,
      highConvTotal, highConvCorrect,
      highConvAcc: highConvTotal > 0 ? (highConvCorrect / highConvTotal * 100).toFixed(1) : null,
      avgMargin: total > 0 ? (marginSum / total * 100).toFixed(1) : null,
      avgBrier: brierCount > 0 ? (brierSum / brierCount).toFixed(3) : null,
      avgRps: rpsCount > 0 ? (rpsSum / rpsCount).toFixed(3) : null,
      lambdaN,
      v1TgC, dcTgC, v3TgC,
      v1TgAcc: lambdaN ? (v1TgC/lambdaN*100).toFixed(1) : null,
      dcTgAcc: lambdaN ? (dcTgC/lambdaN*100).toFixed(1) : null,
      v3TgAcc: lambdaN ? (v3TgC/lambdaN*100).toFixed(1) : null,
      v1ScC, dcScC, v3ScC, v3ScC2, v3ScC3,
      v1ScAcc: lambdaN ? (v1ScC/lambdaN*100).toFixed(1) : null,
      dcScAcc: lambdaN ? (dcScC/lambdaN*100).toFixed(1) : null,
      v3ScAcc: lambdaN ? (v3ScC/lambdaN*100).toFixed(1) : null,
      v1T3C, dcT3C, v3T3C, v4T3C,
      v1T3Acc: lambdaN ? (v1T3C/lambdaN*100).toFixed(1) : null,
      dcT3Acc: lambdaN ? (dcT3C/lambdaN*100).toFixed(1) : null,
      v3T3Acc: lambdaN ? (v3T3C/lambdaN*100).toFixed(1) : null,
      v4T3Acc: v4T3Total > 0 ? (v4T3C/v4T3Total*100).toFixed(1) : null,
      v4T3Total,
    }
  }, [rows])

  // ── Role aggregation ─────────────────────────────────────────────────────────
  const byRole = {}
  for (const r of accRows) {
    const rn = r.role?.role_number
    if (rn == null) continue
    if (!byRole[rn]) byRole[rn] = { roleNumber: rn, roleName: r.role?.role_name, total: 0, correct: 0 }
    byRole[rn].total++
    if (Number(r.accuracy_score) >= 1) byRole[rn].correct++
  }
  const allRoleRows = aiRoles
    .filter(r => r.role_number !== 11)
    .map(r => byRole[r.role_number] || { roleNumber: r.role_number, roleName: r.role_name, total: 0, correct: 0 })
    .map(r => ({ ...r, hitRate: r.total ? r.correct / r.total : null }))
    .sort((a, b) => (b.hitRate ?? -1) - (a.hitRate ?? -1))

  // ── Filter & table ────────────────────────────────────────────────────────────
  const filteredRows = rows.filter(r => {
    if (r.match?.status !== 'finished') return false
    if (filter === 'correct') return r.correct_v3 === true
    if (filter === 'wrong') return r.correct_v3 === false
    if (filter === 'warn') return !!r.quality_warning
    return true
  })
  const tableRows = showAll ? filteredRows : filteredRows.slice(0, 10)

  // ── Betting Performance (PASP v3+ADS vs actual) ───────────────────────────
  const bettingPerf = useMemo(() => {
    if (!odds.length) return null

    const betsByMatch = {}
    for (const b of bets) {
      const mid = b.match?.id || b.match_id
      if (!mid) continue
      if (!betsByMatch[mid]) betsByMatch[mid] = []
      betsByMatch[mid].push(b)
    }

    const results = []
    let totPASPStake = 0, totPASPRet = 0
    let totYourStake = 0, totYourRet = 0
    let insuranceSaved = 0

    for (const oddsRow of odds) {
      const m = oddsRow.match
      if (!m || m.status !== 'finished' || m.home_score == null) continue

      const pred = rows.find(r =>
        r.match?.home_team === m.home_team &&
        r.match?.away_team === m.away_team)
      if (!pred?.v3_home_win) continue

      const rh = Number(m.home_score)
      const ra = Number(m.away_score)

      const portfolio = runPASP(oddsRow.odds_data, pred, 400)
      if (!portfolio?.legs?.length) continue

      const paspLegs = portfolio.legs.map(l => ({
        ...l,
        return: Math.round(scoreLeg(l, rh, ra)),
        hit: scoreLeg(l, rh, ra) > 0,
      }))
      const paspRet    = paspLegs.reduce((s, l) => s + l.return, 0)
      const paspProfit = paspRet - portfolio.totalStake

      const matchBets = betsByMatch[m.id] || []
      const yourStake = matchBets.reduce((s, b) => s + (Number(b.stake) || 0), 0)
      const yourRet   = matchBets.reduce((s, b) => {
        const rr = Number(b.payout || b.actual_return || 0)
        if (rr > 0) return s + rr
        if (b.home_goals != null && b.away_goals != null) {
          return s + (b.home_goals === rh && b.away_goals === ra
            ? (Number(b.odds) || 0) * (Number(b.stake) || 0) : 0)
        }
        return s
      }, 0)
      const yourProfit = yourStake > 0 ? yourRet - yourStake : null
      const yourROI    = yourStake > 0
        ? Math.round(yourProfit / yourStake * 100) : null

      const ins1Leg = paspLegs.find(l => l.role === 'Insurance 1')
      if (ins1Leg?.hit && paspProfit > -30 &&
          yourProfit !== null && yourProfit < -50) {
        insuranceSaved += ins1Leg.return
      }

      results.push({
        matchName: `${m.home_team} vs ${m.away_team}`,
        result: `${rh}-${ra}`,
        actualTotal: rh + ra,
        anchor: portfolio.anchor,
        ads: portfolio.ads,
        adsLabel: portfolio.adsLabel,
        r11: portfolio.r11,
        softR11: portfolio.softR11,
        divPp: portfolio.divPp,
        ratioLabel: portfolio.ratioLabel,
        ins1Coverage: portfolio.ins1Coverage,
        paspStake: portfolio.totalStake,
        paspReturn: paspRet,
        paspProfit,
        paspROI: Math.round(paspProfit / portfolio.totalStake * 100),
        paspLegs,
        yourStake, yourReturn: Math.round(yourRet),
        yourProfit, yourROI,
        hasBets: matchBets.length > 0,
        betCount: matchBets.length,
      })

      totPASPStake += portfolio.totalStake
      totPASPRet   += paspRet
      if (yourStake > 0) {
        totYourStake += yourStake
        totYourRet   += yourRet
      }
    }

    const paspTotalProfit = totPASPRet - totPASPStake
    const yourTotalProfit = totYourRet - totYourStake

    return {
      results,
      matchCount: results.length,
      paspStake:  totPASPStake,
      paspReturn: Math.round(totPASPRet),
      paspProfit: Math.round(paspTotalProfit),
      paspROI: totPASPStake > 0
        ? Math.round(paspTotalProfit / totPASPStake * 100) : 0,
      yourStake:  totYourStake,
      yourReturn: Math.round(totYourRet),
      yourProfit: Math.round(yourTotalProfit),
      yourROI: totYourStake > 0
        ? Math.round(yourTotalProfit / totYourStake * 100) : 0,
      insuranceSaved: Math.round(insuranceSaved),
    }
  }, [odds, bets, rows])

  return (
    <div style={{ padding: '16px', maxWidth: 1100, margin: '0 auto' }}>
      {/* Back */}
      <button
        onClick={() => navigate(-1)}
        style={{
          background: 'none', border: 'none', cursor: 'pointer',
          color: 'var(--color-text-muted)', fontSize: 12, padding: '0 0 0 0',
          marginBottom: 16, fontFamily: 'inherit', minHeight: 44,
          display: 'inline-flex', alignItems: 'center',
        }}
      >
        ← {t('analysis.back')}
      </button>

      {/* Section A: Header */}
      <div style={{ background: '#1A3A6C', padding: '20px 24px', borderRadius: 10, marginBottom: 24 }}>
        <h1 style={{
          fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 700,
          color: '#fff', letterSpacing: '0.03em', marginBottom: 4,
        }}>
          {t('perf.title')}
        </h1>
        <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.72)', margin: 0 }}>
          {t('perf.subtitle')}{n > 0 ? ` · ${n} ${t('perf.settled')}` : ''}
        </p>
      </div>

      {/* Top-level tab switcher */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '0.5px solid var(--color-border)', marginBottom: 24, flexWrap: 'wrap' }}>
        {[
          { key: 'performance', label: 'Performance' },
          { key: 'comparison',  label: 'Model Comparison' },
        ].map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setMainTab(key)}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              padding: '10px 16px', fontFamily: 'inherit', minHeight: 44,
              fontSize: 13, fontWeight: mainTab === key ? 700 : 500,
              color: mainTab === key ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
              borderBottom: mainTab === key ? '2px solid #1A3A6C' : '2px solid transparent',
              marginBottom: -1,
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <div>{[...Array(5)].map((_, i) => (
          <div key={i} className="skeleton" style={{ height: 44, borderRadius: 6, marginBottom: 10 }} />
        ))}</div>
      ) : mainTab === 'comparison' ? (
        <ModelComparisonTab rows={rows} />
      ) : (
        <>
          {/* Section B: Summary Metrics */}
          <div style={{ marginBottom: 28 }}>
            <span style={SH}>{t('perf.metrics')}</span>
            {!hasEnough ? (
              <p style={{ fontSize: 13, color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
                {t('perf.waiting')}
              </p>
            ) : (
              <>
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr 1fr',
                  gap: 16, marginBottom: 16,
                }}>
                  {/* Layer 1: Direction */}
                  <div>
                    <div style={{
                      fontSize: 10, fontWeight: 700,
                      letterSpacing: '0.08em', textTransform: 'uppercase',
                      fontFamily: "'IBM Plex Mono', monospace",
                      color: '#1A3A6C', marginBottom: 8,
                      paddingBottom: 6,
                      borderBottom: '2px solid #1A3A6C',
                    }}>
                      {lang === 'zh' ? '第一层 — 方向 (1X2)' : 'Layer 1 — Direction (1X2)'}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <MetricCard
                        label="V1 Direction"
                        value={modelPerf.v1Acc ? `${modelPerf.v1Acc}%` : '—'}
                        sub={`${modelPerf.v1Correct}/${modelPerf.total} correct`}
                        valueColor={hitColor(modelPerf.v1Acc ? parseFloat(modelPerf.v1Acc) / 100 : null)}
                      />
                      <MetricCard
                        label="V2 Direction"
                        value={modelPerf.v2Acc ? `${modelPerf.v2Acc}%` : '—'}
                        sub={`${modelPerf.v2Correct}/${modelPerf.total} correct`}
                        valueColor={hitColor(modelPerf.v2Acc ? parseFloat(modelPerf.v2Acc) / 100 : null)}
                      />
                      <MetricCard
                        label="V3 Direction ★"
                        value={modelPerf.v3Acc ? `${modelPerf.v3Acc}%` : '—'}
                        sub={`${modelPerf.v3Correct}/${modelPerf.total} correct`}
                        gold
                        valueColor={hitColor(modelPerf.v3Acc ? parseFloat(modelPerf.v3Acc) / 100 : null)}
                      />
                      <MetricCard
                        label="V4 Direction"
                        value={modelPerf.v4Acc ? `${modelPerf.v4Acc}%` : '—'}
                        sub={`${modelPerf.v4Correct}/${modelPerf.total} correct`}
                        valueColor={hitColor(modelPerf.v4Acc ? parseFloat(modelPerf.v4Acc) / 100 : null)}
                      />
                      <MetricCard
                        label={lang === 'zh' ? '高确信度' : 'High Conviction'}
                        value={modelPerf.highConvAcc ? `${modelPerf.highConvAcc}%` : '—'}
                        sub={`${modelPerf.highConvCorrect}/${modelPerf.highConvTotal} ${lang === 'zh' ? '≥10pp优势' : 'calls ≥10pp margin'}`}
                        valueColor={hitColor(modelPerf.highConvAcc ? parseFloat(modelPerf.highConvAcc) / 100 : null)}
                      />
                    </div>
                  </div>

                  {/* Layer 2: Total Goals */}
                  <div>
                    <div style={{
                      fontSize: 10, fontWeight: 700,
                      letterSpacing: '0.08em', textTransform: 'uppercase',
                      fontFamily: "'IBM Plex Mono', monospace",
                      color: '#BA7517', marginBottom: 8,
                      paddingBottom: 6,
                      borderBottom: '2px solid #BA7517',
                    }}>
                      {lang === 'zh' ? '第二层 — 总进球数' : 'Layer 2 — Total Goals'}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {[
                        { label: 'V1 Total Goals Acc',    acc: modelPerf.v1TgAcc, n: modelPerf.v1TgC, gold: false, vc: null },
                        { label: 'DC Total Goals Acc',    acc: modelPerf.dcTgAcc, n: modelPerf.dcTgC, gold: false, vc: '#0F3460' },
                        { label: 'V3 Total Goals Acc ★', acc: modelPerf.v3TgAcc, n: modelPerf.v3TgC, gold: true,  vc: null },
                      ].map(({ label, acc, n: nc, gold, vc }) => (
                        <MetricCard key={label} label={label}
                          value={acc ? `${acc}%` : '—'}
                          sub={`${nc ?? 0}/${modelPerf.lambdaN ?? 0} exact total`}
                          gold={gold}
                          valueColor={vc || (acc ? parseFloat(acc) >= 30 ? 'var(--color-success)' : parseFloat(acc) >= 22 ? '#BA7517' : 'var(--color-danger)' : undefined)}
                        />
                      ))}
                      <MetricCard
                        label={lang === 'zh' ? 'V3 Brier分' : 'V3 Brier Score'}
                        value={modelPerf.avgBrier ?? '—'}
                        sub={lang === 'zh' ? '越低越好 · 随机≈0.667' : 'lower = better · random ≈ 0.667'}
                        valueColor={
                          modelPerf.avgBrier != null
                            ? parseFloat(modelPerf.avgBrier) < 0.5
                              ? 'var(--color-success)' : '#BA7517'
                            : undefined
                        }
                      />
                      <MetricCard
                        label={lang === 'zh' ? 'V3 RPS分' : 'V3 RPS'}
                        value={modelPerf.avgRps ?? '—'}
                        sub={lang === 'zh' ? '越低越好 · 随机≈0.227' : 'lower = better · random ≈ 0.227'}
                        valueColor={
                          modelPerf.avgRps != null
                            ? parseFloat(modelPerf.avgRps) < 0.25
                              ? 'var(--color-success)' : '#BA7517'
                            : undefined
                        }
                      />
                      <MetricCard
                        label={lang === 'zh' ? 'V3平均优势' : 'Avg V3 Margin'}
                        value={modelPerf.avgMargin ? `${modelPerf.avgMargin}pp` : '—'}
                        sub={lang === 'zh' ? '第1与第2预测间平均差距' : 'avg gap 1st vs 2nd prediction'}
                        valueColor={
                          modelPerf.avgMargin && parseFloat(modelPerf.avgMargin) > 15
                            ? 'var(--color-success)' : '#BA7517'
                        }
                      />
                    </div>
                  </div>

                  {/* Layer 3: Exact Score */}
                  <div>
                    <div style={{
                      fontSize: 10, fontWeight: 700,
                      letterSpacing: '0.08em', textTransform: 'uppercase',
                      fontFamily: "'IBM Plex Mono', monospace",
                      color: '#C9A84C', marginBottom: 8,
                      paddingBottom: 6,
                      borderBottom: '2px solid #C9A84C',
                    }}>
                      {lang === 'zh' ? '第三层 — 精确比分' : 'Layer 3 — Exact Score'}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {[
                        { label: 'V1 Top Score Acc',    acc: modelPerf.v1ScAcc, n: modelPerf.v1ScC, gold: false, vc: null, sub: null },
                        { label: 'DC Top Score Acc',    acc: modelPerf.dcScAcc, n: modelPerf.dcScC, gold: false, vc: '#0F3460', sub: null },
                        { label: 'V3 Top Score Acc ★', acc: modelPerf.v3ScAcc, n: modelPerf.v3ScC, gold: true,  vc: null,
                          sub: (() => { const r1=modelPerf.v3ScC??0,r2=modelPerf.v3ScC2??0,r3=modelPerf.v3ScC3??0,N=modelPerf.lambdaN??0; return (r1+r2+r3)>0?`${r1+r2+r3}/${N} in top 3  (★×${r1}  #2×${r2}  #3×${r3})`:`${r1}/${N} exact` })() },
                      ].map(({ label, acc, n: nc, gold, vc, sub: customSub }) => (
                        <MetricCard key={label} label={label}
                          value={acc ? `${acc}%` : '—'}
                          sub={customSub ?? `${nc ?? 0}/${modelPerf.lambdaN ?? 0} exact`}
                          gold={gold}
                          valueColor={vc || (acc ? parseFloat(acc) >= 10 ? 'var(--color-success)' : parseFloat(acc) >= 5 ? '#BA7517' : 'var(--color-danger)' : undefined)}
                        />
                      ))}
                      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', fontFamily: "'IBM Plex Mono', monospace", color: 'var(--color-text-muted)', marginTop: 4, marginBottom: 4 }}>
                        {lang === 'zh' ? '前三比分准确率' : 'Top-3 Accuracy'}
                      </div>
                      {[
                        { label: 'V1 Top-3 Acc',    acc: modelPerf.v1T3Acc, n: modelPerf.v1T3C, gold: false, vc: null },
                        { label: 'DC Top-3 Acc',    acc: modelPerf.dcT3Acc, n: modelPerf.dcT3C, gold: false, vc: '#0F3460' },
                        { label: 'V3 Top-3 Acc ★', acc: modelPerf.v3T3Acc, n: modelPerf.v3T3C, gold: true,  vc: null },
                        { label: 'V4 Top-3 Acc',   acc: modelPerf.v4T3Acc, n: modelPerf.v4T3C, gold: false, vc: '#7C3AED', tot: modelPerf.v4T3Total },
                      ].map(({ label, acc, n: nc, gold, vc, tot }) => (
                        <MetricCard key={label} label={label}
                          value={acc ? `${acc}%` : '—'}
                          sub={`${nc ?? 0}/${tot ?? modelPerf.lambdaN ?? 0} in top 3`}
                          gold={gold}
                          valueColor={vc || (acc ? parseFloat(acc) >= 20 ? 'var(--color-success)' : parseFloat(acc) >= 12 ? '#BA7517' : 'var(--color-danger)' : undefined)}
                        />
                      ))}
                      <div style={{
                        border: '0.5px solid var(--color-border)',
                        borderRadius: 8, padding: '12px 14px',
                        background: 'var(--color-bg-card)',
                      }}>
                        <div style={{
                          fontSize: 10, fontWeight: 700,
                          letterSpacing: '0.06em', textTransform: 'uppercase',
                          fontFamily: "'IBM Plex Mono', monospace",
                          color: 'var(--color-text-muted)', marginBottom: 8,
                        }}>
                          {lang === 'zh' ? '基准参考' : 'Benchmarks'}
                        </div>
                        {[
                          { label: lang === 'zh' ? '随机猜测' : 'Random guess',   value: '~2%',    color: 'var(--color-text-muted)' },
                          { label: lang === 'zh' ? '优秀模型' : 'Good model',     value: '8-12%',  color: '#BA7517' },
                          { label: lang === 'zh' ? '专业机构' : 'Pro syndicates', value: '12-15%', color: '#2D7A4F' },
                        ].map((b, i) => (
                          <div key={i} style={{
                            display: 'flex', justifyContent: 'space-between',
                            fontSize: 11, marginBottom: 4,
                            fontFamily: "'IBM Plex Mono', monospace",
                          }}>
                            <span style={{ color: 'var(--color-text-muted)' }}>{b.label}</span>
                            <span style={{ color: b.color, fontWeight: 600 }}>{b.value}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Explanation note */}
                <div style={{
                  padding: '10px 14px', marginBottom: 4,
                  background: 'var(--color-background-secondary)',
                  borderRadius: 8,
                  borderLeft: '3px solid #C9A84C',
                  fontSize: 11, color: 'var(--color-text-muted)',
                  lineHeight: 1.6,
                }}>
                  <strong style={{ color: '#C9A84C' }}>
                    {lang === 'zh' ? '三层准确率：' : 'Three-layer accuracy:'}
                  </strong>{' '}
                  {lang === 'zh'
                    ? '第一层（方向）判断模型是否选对胜者——基准为庄家约54%。第二层（总进球）判断预测进球总数是否正确——即PASP锚点，目标≥25%。第三层（精确比分）判断最高概率比分是否命中——即使8%也很出色，专业机构达12-15%。模型可能在方向上错误但总进球正确——三层同时评估才能全面了解模型质量。'
                    : 'Layer 1 (Direction) shows if the model picked the right winner — benchmark is bookmakers at ~54%. Layer 2 (Total Goals) shows if the predicted goal total was right — this is the PASP anchor, target ≥25%. Layer 3 (Exact Score) shows if the top predicted scoreline hit — even 8% is good, pro syndicates reach 12-15%. A model can be wrong on direction but right on total goals — all three layers tell a fuller story.'}
                </div>
              </>
            )}
          </div>

          {/* Section C: Benchmarks */}
          <div style={{ marginBottom: 28 }}>
            <span style={SH}>{t('perf.benchmarks')}</span>
            <BenchmarkBars v1Rate={v1Rate} v2Rate={v2Rate} v3Rate={v3Rate} lang={lang} />
            <p style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 10, lineHeight: 1.6 }}>
              {lang === 'zh'
                ? '金色 = V3实时 · 虚线区间 = 专业机构 (63–66%) / 理论上限 (68%) · 灰色 = 参考基准'
                : 'Gold = V3 live · Dashed = pro syndicate range (63–66%) / ceiling (68%) · Grey = reference baselines'}
            </p>
          </div>

          {/* Section D: Match by match table */}
          <div style={{ marginBottom: 28 }}>
            <span style={SH}>{t('perf.matches')}</span>

            {/* Filter tabs */}
            <div style={{ display: 'flex', gap: 2, marginBottom: 16, borderBottom: '0.5px solid var(--color-border)', flexWrap: 'wrap' }}>
              {[
                { key: 'all',     label: t('perf.filterAll') },
                { key: 'correct', label: t('perf.filterCorrect') },
                { key: 'wrong',   label: t('perf.filterWrong') },
                { key: 'warn',    label: t('perf.filterWarn') },
              ].map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => { setFilter(key); setShowAll(false) }}
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    padding: '8px 14px', fontFamily: 'inherit', minHeight: 44,
                    fontSize: 13, fontWeight: filter === key ? 700 : 500,
                    color: filter === key ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
                    borderBottom: filter === key ? '2px solid #1A3A6C' : '2px solid transparent',
                    marginBottom: -1,
                  }}
                >
                  {label}
                </button>
              ))}
            </div>

            {n === 0 ? (
              <p style={{ fontSize: 13, color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
                {lang === 'zh' ? '暂无已结算比赛数据。' : 'No settled matches yet.'}
              </p>
            ) : filteredRows.length === 0 ? (
              <p style={{ fontSize: 13, color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
                {lang === 'zh' ? '当前筛选无结果。' : 'No matches match this filter.'}
              </p>
            ) : (
              <>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 980 }}>
                    <thead>
                      <tr>
                        <th style={TH}>Date</th>
                        <th style={TH}>Match</th>
                        <th style={TH}>Result</th>
                        <th style={{ ...TH, textAlign: 'center' }}>V1</th>
                        <th style={{ ...TH, textAlign: 'center' }}>V2</th>
                        <th style={{ ...TH, textAlign: 'center' }}>V3 ★</th>
                        <th style={{ ...TH, textAlign: 'center', color: '#7C3AED' }}>V4</th>
                        <th style={{ ...TH, textAlign: 'center' }}>Margin</th>
                        <th style={{ ...TH, textAlign: 'center' }}>TG Pred</th>
                        <th style={{ ...TH, textAlign: 'center' }}>TG✓</th>
                        <th style={{ ...TH, textAlign: 'center' }}>Top Scores</th>
                        <th style={{ ...TH, textAlign: 'center' }}>Score✓</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tableRows.map(row => {
                        const m = row.match
                        const hs = m?.home_score, as_ = m?.away_score
                        const scoreStr = hs != null ? `${hs}–${as_}` : null
                        const outcomeLabel = hs != null && as_ != null
                          ? (hs > as_ ? 'H' : hs < as_ ? 'A' : 'D')
                          : (row.actual_outcome ?? '?')
                        const topScore = row.v3_top_score || null

                        // Layer 2: Total Goals
                        const predLH = row.v3_lambda_home
                        const predLA = row.v3_lambda_away
                        const tgPred = predLH != null && predLA != null
                          ? Math.round(Number(predLH) + Number(predLA)) : null
                        const tgActual = hs != null ? Number(hs) + Number(as_) : null
                        const tgHit = tgPred != null && tgActual != null ? tgPred === tgActual : null

                        // Layer 3: Exact Score rank (1/2/3 = hit, 0 = miss, null = no data)
                        let scoreRank = null
                        let top3Scores = null
                        if (predLH != null && predLA != null && hs != null) {
                          const lhN = Number(predLH), laN = Number(predLA)
                          top3Scores = _top3(_blend(_dc(lhN, laN), _v1(lhN, laN)))
                          const actual = `${Number(hs)}-${Number(as_)}`
                          const t1 = row.v3_top_score   || top3Scores[0]
                          const t2 = row.v3_top_score_2 || top3Scores[1]
                          const t3 = row.v3_top_score_3 || top3Scores[2]
                          scoreRank = t1 === actual ? 1 : t2 === actual ? 2 : t3 === actual ? 3 : 0
                        } else if (hs != null && row.v3_top_score != null) {
                          const actual = `${Number(hs)}-${Number(as_)}`
                          scoreRank = row.v3_top_score   === actual ? 1
                            : row.v3_top_score_2 === actual ? 2
                            : row.v3_top_score_3 === actual ? 3 : 0
                        }

                        // Margin
                        const v3Sorted = [row.v3_home_win || 0, row.v3_draw || 0, row.v3_away_win || 0]
                          .map(Number).sort((a, b) => b - a)
                        const margin = v3Sorted[0] > 0
                          ? Math.round((v3Sorted[0] - v3Sorted[1]) * 100) : null

                        return (
                          <tr key={row.id}>
                            <td style={{ ...TD, whiteSpace: 'nowrap', fontSize: 11, fontFamily: "'IBM Plex Mono', monospace", color: 'var(--color-text-muted)' }}>
                              {fmtDate(m?.match_date)}
                            </td>
                            <td style={{ ...TD, maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {m ? `${m.home_team} vs ${m.away_team}` : '—'}
                            </td>
                            <td style={{ ...TD, fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, whiteSpace: 'nowrap' }}>
                              <span style={{ fontWeight: 700 }}>{outcomeLabel}</span>
                              {scoreStr && <span style={{ color: 'var(--color-text-muted)', fontSize: 11, marginLeft: 4 }}>({scoreStr})</span>}
                            </td>
                            {[row.correct_v1, row.correct_v2, row.correct_v3].map((c, i) => (
                              <td key={i} style={{ ...TD, textAlign: 'center', fontSize: 14, fontWeight: 700 }}>
                                {c == null
                                  ? <span style={{ color: 'var(--color-text-muted)' }}>—</span>
                                  : <span style={{ color: c ? 'var(--color-success)' : 'var(--color-danger)' }}>{c ? '✓' : '✗'}</span>}
                              </td>
                            ))}
                            <td style={{ ...TD, textAlign: 'center', fontSize: 14, fontWeight: 700 }}>
                              {row.correct_v4 == null
                                ? <span style={{ color: 'var(--color-text-muted)' }}>—</span>
                                : <span style={{ color: row.correct_v4 ? '#7C3AED' : 'var(--color-danger)' }}>{row.correct_v4 ? '✓' : '✗'}</span>}
                            </td>
                            {/* Margin */}
                            <td style={{ ...TD, textAlign: 'center', fontSize: 10, fontFamily: "'IBM Plex Mono', monospace",
                              color: margin == null ? 'var(--color-text-muted)'
                                : margin >= 15 ? '#2D7A4F'
                                : margin >= 10 ? '#BA7517' : '#791F1F',
                            }}>
                              {margin != null ? `${margin}pp` : '—'}
                            </td>
                            {/* TG Predicted */}
                            <td style={{ ...TD, textAlign: 'center', fontSize: 11, fontFamily: "'IBM Plex Mono', monospace", color: 'var(--color-text-muted)' }}>
                              {tgPred != null ? `${tgPred}g` : '—'}
                            </td>
                            {/* TG Hit */}
                            <td style={{ ...TD, textAlign: 'center', fontSize: 13, fontWeight: 700 }}>
                              {tgHit === true
                                ? <span style={{ color: '#2D7A4F' }}>✓</span>
                                : tgHit === false
                                  ? <span style={{ color: '#791F1F' }}>✗</span>
                                  : <span style={{ color: 'var(--color-text-muted)' }}>—</span>}
                            </td>
                            {/* Top Scores — all 3 stored, hit highlighted */}
                            <td style={{ ...TD, textAlign: 'center', fontFamily: "'IBM Plex Mono', monospace" }}>
                              {(() => {
                                const actual = hs != null && as_ != null ? `${Number(hs)}-${Number(as_)}` : null
                                const scores = [row.v3_top_score, row.v3_top_score_2, row.v3_top_score_3].filter(Boolean)
                                if (!scores.length) return <span style={{ color: 'var(--color-text-muted)', fontSize: 11 }}>—</span>
                                return scores.map((s, i) => {
                                  const isHit = actual != null && s === actual
                                  return (
                                    <span key={i} style={{
                                      display: 'inline-block',
                                      fontSize: 11,
                                      marginRight: i < scores.length - 1 ? 6 : 0,
                                      color: isHit ? '#D4AF37' : 'var(--color-text-muted)',
                                      fontWeight: isHit ? 700 : 400,
                                    }}>
                                      {isHit && i === 0 ? '★ ' : ''}{s}
                                    </span>
                                  )
                                })
                              })()}
                            </td>
                            {/* Score Rank */}
                            <td style={{ ...TD, textAlign: 'center', fontSize: 11, fontFamily: "'IBM Plex Mono', monospace", fontWeight: 700 }}>
                              {scoreRank === 1
                                ? <span style={{ color: '#D4AF37' }}>★ #1</span>
                                : scoreRank === 2
                                  ? <span style={{ color: '#9CA3AF' }}>#2</span>
                                  : scoreRank === 3
                                    ? <span style={{ color: '#CD7F32' }}>#3</span>
                                    : scoreRank === 0
                                      ? <span style={{ color: 'var(--accent-red, var(--color-danger))' }}>✗</span>
                                      : <span style={{ color: 'var(--color-text-muted)' }}>—</span>}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                {filteredRows.length > 10 && (
                  <button
                    onClick={() => setShowAll(v => !v)}
                    style={{
                      marginTop: 12, background: 'none', border: '0.5px solid var(--color-border)',
                      borderRadius: 6, padding: '0 16px', cursor: 'pointer', fontSize: 13,
                      color: 'var(--color-text-muted)', fontFamily: 'inherit', minHeight: 44,
                    }}
                  >
                    {showAll
                      ? (lang === 'zh' ? '收起' : 'Show less')
                      : t('perf.showAll').replace('{n}', filteredRows.length)}
                  </button>
                )}
              </>
            )}
          </div>

          {/* Section E: V3 Calibration chart (10+ matches only) */}
          {n >= 10 && (() => {
            const BUCKETS = [[0, 0.2], [0.2, 0.4], [0.4, 0.6], [0.6, 0.8], [0.8, 1.0]]
            const calibPts = BUCKETS.map(([min, max]) => {
              const br = rows.filter(r => {
                const p = Number(r.v3_home_win)
                return !isNaN(p) && p >= min && p < max && r.actual_outcome != null
              })
              if (!br.length) return null
              const actual = br.filter(r => r.actual_outcome === 'H').length / br.length
              return { min, max, midpoint: (min + max) / 2, actual, n: br.length, label: `${Math.round(min * 100)}–${Math.round(max * 100)}%` }
            }).filter(Boolean)
            if (calibPts.length < 2) return null

            const totalN = calibPts.reduce((s, b) => s + b.n, 0)
            const ece = calibPts.reduce((s, b) => s + (b.n / totalN) * Math.abs(b.midpoint - b.actual), 0)
            const largestErr = calibPts.reduce((m, b) => {
              const err = Math.abs(b.midpoint - b.actual)
              return err > m.err ? { ...b, err } : m
            }, { err: -1 })

            const eceColor = ece < 0.05 ? 'var(--color-success)' : ece < 0.10 ? '#C9A84C' : ece < 0.15 ? '#BA7517' : 'var(--color-danger)'
            const eceLabel = ece < 0.05 ? 'Excellent ✓' : ece < 0.10 ? 'Good' : ece < 0.15 ? 'Acceptable' : 'Needs refit'
            const paspText = ece < 0.05
              ? 'Model probabilities are reliable inputs for Kelly sizing. Edge calculations are trustworthy across all probability ranges.'
              : ece < 0.10
              ? 'Minor calibration drift detected. Kelly stakes are broadly reliable but consider reducing stake 10–15% on high-conviction calls (>65% predicted).'
              : 'Meaningful calibration error. Reduce all Kelly stakes by 20–25% until more match data stabilises the model.'
            const largestDir = largestErr.actual > largestErr.midpoint ? 'underestimates' : 'overestimates'
            const largestPP = Math.round(Math.abs(largestErr.actual - largestErr.midpoint) * 100)

            const PANEL_TITLE = { fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-text-muted)', fontFamily: 'var(--font-display)', marginBottom: 8 }
            const MONO = { fontFamily: "'IBM Plex Mono', monospace" }

            return (
              <div style={{ marginBottom: 28 }}>
                <span style={SH}>{t('perf.calibration')} <InfoTooltip title="Calibration" explanation="A well-calibrated model predicts 60% when the true frequency is 60%. Dots near the diagonal line = good calibration." explanationZh="校准良好的模型预测60%时，实际发生率也约60%。散点靠近对角线=校准良好。" lang={lang} /></span>
                <div style={{ display: 'grid', gridTemplateColumns: '55fr 40fr', gap: 24, alignItems: 'start' }}>
                  {/* Left: chart */}
                  <div>
                    <CalibrationChart rows={rows} />
                    <p style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 8, lineHeight: 1.6 }}>
                      {lang === 'zh'
                        ? '散点靠近对角线 = 模型校准良好 · 圆圈大小 = 样本量 · 仅显示V3主队获胜概率'
                        : 'Points near diagonal = well-calibrated · Circle size = sample count · V1 grey / DC navy / V3 gold'}
                    </p>
                  </div>

                  {/* Right: interpretation panel */}
                  <div style={{ background: 'var(--color-bg-secondary)', border: '0.5px solid var(--color-border)', borderRadius: 8, padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>

                    {/* 1 — How to read */}
                    <div>
                      <div style={PANEL_TITLE}>How to Read This</div>
                      <p style={{ fontSize: 13, color: 'var(--color-text-muted)', lineHeight: 1.6, margin: 0 }}>
                        Each bubble = a group of matches bucketed by predicted home win probability. Bubbles <strong>on the diagonal</strong> = perfect calibration. <strong>Above</strong> = model underestimates (reality beats prediction). <strong>Below</strong> = model overestimates.
                      </p>
                    </div>

                    {/* 2 — ECE */}
                    <div>
                      <div style={PANEL_TITLE}>Calibration Error (ECE)</div>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                        <span style={{ fontSize: 22, fontWeight: 700, ...MONO, color: eceColor }}>{ece.toFixed(3)}</span>
                        <span style={{ fontSize: 12, fontWeight: 700, color: eceColor }}>{eceLabel}</span>
                      </div>
                      <p style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4, margin: 0 }}>
                        ECE &lt; 0.05 Excellent · 0.05–0.10 Good · 0.10–0.15 Acceptable · &gt;0.15 Needs refit
                      </p>
                    </div>

                    {/* 3 — Bucket table */}
                    <div>
                      <div style={PANEL_TITLE}>Bucket Breakdown</div>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                        <thead>
                          <tr>
                            {['Range','Pred','Actual','N','Signal'].map(h => (
                              <th key={h} style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-muted)', padding: '0 4px 6px', textAlign: h === 'Signal' ? 'center' : 'left' }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {calibPts.map(b => {
                            const diff = b.actual - b.midpoint
                            const signal = diff > 0.05 ? { ch: '↑', color: 'var(--color-success)' } : diff < -0.05 ? { ch: '↓', color: 'var(--color-danger)' } : { ch: '=', color: '#C9A84C' }
                            return (
                              <tr key={b.label} style={{ borderTop: '0.5px solid var(--color-border-light)' }}>
                                <td style={{ padding: '5px 4px', color: 'var(--color-text-muted)', ...MONO }}>{b.label}</td>
                                <td style={{ padding: '5px 4px', ...MONO }}>{Math.round(b.midpoint * 100)}%</td>
                                <td style={{ padding: '5px 4px', ...MONO }}>{Math.round(b.actual * 100)}%</td>
                                <td style={{ padding: '5px 4px', ...MONO }}>{b.n}</td>
                                <td style={{ padding: '5px 4px', textAlign: 'center', fontWeight: 700, color: signal.color }}>{signal.ch}</td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>

                    {/* 4 — PASP implication */}
                    <div>
                      <div style={PANEL_TITLE}>PASP Impact</div>
                      <p style={{ fontSize: 13, color: 'var(--color-text-muted)', lineHeight: 1.6, margin: 0, marginBottom: 8 }}>{paspText}</p>
                      {largestErr.label && (
                        <p style={{ fontSize: 12, color: 'var(--color-text-muted)', margin: 0, ...MONO }}>
                          Largest gap: <strong style={{ color: 'var(--color-text-primary)' }}>{largestErr.label}</strong> — model {largestDir} by <strong style={{ color: 'var(--color-text-primary)' }}>{largestPP}pp</strong>
                        </p>
                      )}
                    </div>

                  </div>
                </div>
              </div>
            )
          })()}

          {/* Section F: AI Role Accuracy */}
          <div style={{ marginBottom: 28 }}>
            <span style={SH}>{t('perf.roles')}</span>
            {allRoleRows.length === 0 ? (
              <p style={{ fontSize: 13, color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
                {lang === 'zh' ? '暂无AI角色数据，比赛结算后自动更新。' : 'No role accuracy data yet — updates after match settlement.'}
              </p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', maxWidth: 560 }}>
                  <thead>
                    <tr>
                      <th style={{ ...TH, width: 28 }}>#</th>
                      <th style={TH}>Role</th>
                      <th style={{ ...TH, textAlign: 'right' }}>{lang === 'zh' ? '预测数' : 'Preds'}</th>
                      <th style={{ ...TH, textAlign: 'right' }}>{lang === 'zh' ? '命中率' : 'Hit Rate'} <InfoTooltip title="Hit Rate" explanation="Percentage of settled matches where the role's recommended outcome matched the actual result." explanationZh="该AI角色推荐结果与实际比赛结果吻合的比例。" lang={lang} /></th>
                    </tr>
                  </thead>
                  <tbody>
                    {allRoleRows.map(rs => {
                      const isRole10 = rs.roleNumber === 10
                      return (
                        <tr key={rs.roleNumber}>
                          <td style={{ ...TD, color: 'var(--color-text-muted)', fontSize: 11, fontWeight: 600 }}>
                            {rs.roleNumber}
                          </td>
                          <td style={TD}>
                            <span style={{ fontWeight: 600, color: isRole10 ? '#C9A84C' : 'var(--color-text-primary)' }}>
                              {rs.roleName}
                            </span>
                            {isRole10 && (
                              <span style={{ fontSize: 10, color: '#C9A84C', marginLeft: 6, fontWeight: 700 }}>
                                ★ {lang === 'zh' ? '主要AI' : 'Primary AI'}
                              </span>
                            )}
                          </td>
                          <td style={{ ...TD, textAlign: 'right', fontFamily: "'IBM Plex Mono', monospace" }}>
                            {rs.total || '—'}
                          </td>
                          <td style={{ ...TD, textAlign: 'right', fontWeight: 700, color: hitColor(rs.hitRate) }}>
                            {rs.hitRate != null ? fmtPct(rs.hitRate) : '—'}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Section G: Improvement Log */}
          <div style={{ marginBottom: 16 }}>
            <span style={SH}>{t('perf.log')}</span>
            <ImprovementLog />
            <p style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 12, lineHeight: 1.6 }}>
              {lang === 'zh'
                ? '绿色 ✓ = 已完成 · 金色 PENDING = 进行中 · 灰色 PLANNED = 路线图'
                : 'Green ✓ = shipped · Gold PENDING = in progress · Grey PLANNED = roadmap'}
            </p>
          </div>

          {/* Section H: DC Refit Log */}
          <div style={{ marginBottom: 28 }}>
            <span style={SH}>
              {lang === 'zh' ? 'DC模型重新拟合日志' : 'DC Model Refit Log'}
            </span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {/* Hardcoded initial entry always shown first */}
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <div style={{
                  width: 8, height: 8, borderRadius: '50%',
                  marginTop: 5, flexShrink: 0, background: '#2D7A4F',
                }} />
                <div style={{ flex: 1 }}>
                  <span style={{ fontSize: 13, color: 'var(--color-text-primary)' }}>
                    Initial fit — 15,508 international matches (pre-WC2026)
                  </span>
                  <span style={{
                    fontSize: 10, color: 'var(--color-text-muted)',
                    marginLeft: 8, fontFamily: "'IBM Plex Mono', monospace",
                  }}>2026-06-15</span>
                  <div style={{
                    fontSize: 11, color: 'var(--color-text-muted)',
                    marginTop: 3, fontFamily: "'IBM Plex Mono', monospace",
                  }}>
                    ρ=−0.0612 · T=1.11 · homeAdv=0.2686
                  </div>
                </div>
                <span style={{ fontSize: 10, fontWeight: 700, flexShrink: 0, color: '#2D7A4F' }}>✓</span>
              </div>
              {/* Dynamic entries from DB */}
              {refitLog.map((r, i) => (
                <div key={r.id} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                  <div style={{
                    width: 8, height: 8, borderRadius: '50%',
                    marginTop: 5, flexShrink: 0, background: '#C9A84C',
                  }} />
                  <div style={{ flex: 1 }}>
                    <span style={{ fontSize: 13, color: 'var(--color-text-primary)' }}>
                      Refit #{refitLog.length - i} — {r.match_count.toLocaleString()} matches
                      {r.wc_matches > 0 && ` (${r.wc_matches} WC2026)`}
                    </span>
                    <span style={{
                      fontSize: 10, color: 'var(--color-text-muted)',
                      marginLeft: 8, fontFamily: "'IBM Plex Mono', monospace",
                    }}>
                      {new Date(r.refit_date).toLocaleDateString('en-US', {
                        timeZone: 'Asia/Shanghai', month: 'short', day: 'numeric',
                      })}
                    </span>
                    <div style={{
                      fontSize: 11, color: 'var(--color-text-muted)',
                      marginTop: 3, fontFamily: "'IBM Plex Mono', monospace",
                    }}>
                      ρ={r.rho} · T={r.temperature}
                      {r.notes && ` · ${r.notes}`}
                    </div>
                    {r.key_changes && (
                      <div style={{
                        fontSize: 10, color: 'var(--color-text-muted)',
                        marginTop: 2, fontFamily: "'IBM Plex Mono', monospace",
                      }}>
                        {Object.entries(r.key_changes)
                          .slice(0, 4)
                          .map(([team, change]) => `${team}: ${change}`)
                          .join(' · ')}
                      </div>
                    )}
                  </div>
                  <span style={{ fontSize: 10, fontWeight: 700, flexShrink: 0, color: '#C9A84C' }}>✓</span>
                </div>
              ))}
            </div>
            <p style={{
              fontSize: 11, color: 'var(--color-text-muted)',
              marginTop: 12, lineHeight: 1.6,
            }}>
              {lang === 'zh'
                ? 'DC模型每次有新的比赛结果时都会重新拟合。金色 = WC2026期间重新拟合。'
                : 'DC model is refit each time new match results are available. Gold = refit during WC2026.'}
            </p>
          </div>

          {/* ── Section I: Betting Performance ── */}
          <div style={{ marginBottom: 28 }}>
            <span style={SH}>
              {lang === 'zh' ? 'PASP v3+ADS 投注表现' : 'Betting Performance — PASP v3+ADS vs Actual'}
            </span>

            {!bettingPerf || bettingPerf.matchCount === 0 ? (
              <p style={{ fontSize: 13, color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
                {lang === 'zh'
                  ? '需要有赔率数据的已完成比赛。在比赛分析页面提取赔率后显示。'
                  : 'Needs finished matches with odds entered. Extract odds on the match analysis page first.'}
              </p>
            ) : (
              <>
                {/* KPI cards */}
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))',
                  gap: 10, marginBottom: 16,
                }}>
                  {[
                    {
                      label: lang === 'zh' ? 'PASP+ADS 利润' : 'PASP+ADS Profit',
                      value: `${bettingPerf.paspProfit >= 0 ? '+' : ''}¥${bettingPerf.paspProfit}`,
                      sub: `¥${bettingPerf.paspStake} · ${bettingPerf.paspROI}% ROI`,
                      gold: true,
                      valueColor: bettingPerf.paspProfit >= 0 ? 'var(--color-success)' : 'var(--color-danger)',
                    },
                    {
                      label: lang === 'zh' ? '实际利润' : 'Your Profit',
                      value: bettingPerf.yourStake > 0
                        ? `${bettingPerf.yourProfit >= 0 ? '+' : ''}¥${bettingPerf.yourProfit}` : '—',
                      sub: bettingPerf.yourStake > 0
                        ? `¥${bettingPerf.yourStake} · ${bettingPerf.yourROI}% ROI`
                        : 'No bets recorded',
                      valueColor: bettingPerf.yourProfit >= 0 ? 'var(--color-success)' : 'var(--color-danger)',
                    },
                    {
                      label: lang === 'zh' ? '保险节省' : 'Insurance Saved',
                      value: `+¥${bettingPerf.insuranceSaved}`,
                      sub: lang === 'zh' ? '在失败场次中回收' : 'recovered on losing matches',
                      valueColor: '#C9A84C',
                    },
                    {
                      label: lang === 'zh' ? '场次分析' : 'Matches',
                      value: bettingPerf.matchCount,
                      sub: lang === 'zh' ? '含赔率已完成' : 'finished with odds',
                    },
                  ].map((c, i) => (
                    <MetricCard key={i}
                      label={c.label} value={c.value}
                      sub={c.sub} gold={c.gold}
                      valueColor={c.valueColor}
                    />
                  ))}
                </div>

                {/* Comparison table */}
                <div style={{ overflowX: 'auto', marginBottom: 16 }}>
                  <table style={{
                    width: '100%', borderCollapse: 'collapse',
                    minWidth: 680, fontSize: 11,
                  }}>
                    <thead>
                      <tr style={{
                        fontSize: 9, fontWeight: 500,
                        letterSpacing: '0.06em', textTransform: 'uppercase',
                        fontFamily: "'IBM Plex Mono',monospace",
                        color: 'var(--color-text-muted)',
                      }}>
                        {['Match', 'Score', 'Anc', 'ADS', 'R11',
                          'Ratio', 'Ins%',
                          'PASP P&L', 'PASP ROI',
                          'Your P&L', 'Your ROI'].map((h, i) => (
                          <th key={i} style={{
                            padding: '0 8px 8px 0',
                            textAlign: i >= 7 ? 'right' : 'left',
                            whiteSpace: 'nowrap',
                          }}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {bettingPerf.results.map((r, i) => (
                        <tr key={i}>
                          <td style={{
                            padding: '8px 8px 8px 0',
                            borderBottom: '0.5px solid var(--color-border)',
                            color: 'var(--color-text-primary)',
                            fontSize: 11, whiteSpace: 'nowrap',
                          }}>{r.matchName}</td>
                          <td style={{
                            padding: '8px 8px 8px 0',
                            borderBottom: '0.5px solid var(--color-border)',
                            fontFamily: "'IBM Plex Mono',monospace",
                            fontWeight: 500,
                          }}>{r.result}</td>
                          <td style={{
                            padding: '8px 8px 8px 0',
                            borderBottom: '0.5px solid var(--color-border)',
                            fontFamily: "'IBM Plex Mono',monospace",
                            color: 'var(--color-text-muted)',
                          }}>{r.anchor}g</td>
                          <td style={{
                            padding: '8px 8px 8px 0',
                            borderBottom: '0.5px solid var(--color-border)',
                            fontFamily: "'IBM Plex Mono',monospace",
                            fontSize: 10,
                            color: r.ads < -0.10 ? '#BA7517' : r.ads > 0.10 ? '#2D7A4F' : 'var(--color-text-muted)',
                          }}>{Math.round(r.ads * 100)}%</td>
                          <td style={{
                            padding: '8px 8px 8px 0',
                            borderBottom: '0.5px solid var(--color-border)',
                            fontFamily: "'IBM Plex Mono',monospace",
                            fontSize: 10,
                            color: r.r11 ? '#C9A84C' : r.softR11 ? '#BA7517' : 'var(--color-text-muted)',
                          }}>
                            {r.r11 ? '⚡' : r.softR11 ? '~' : '—'}
                            {(r.r11 || r.softR11) ? ` ${r.divPp}pp` : ''}
                          </td>
                          <td style={{
                            padding: '8px 8px 8px 0',
                            borderBottom: '0.5px solid var(--color-border)',
                            fontFamily: "'IBM Plex Mono',monospace",
                            fontSize: 10,
                            color: 'var(--color-text-muted)',
                          }}>{r.ratioLabel}</td>
                          <td style={{
                            padding: '8px 8px 8px 0',
                            borderBottom: '0.5px solid var(--color-border)',
                            fontFamily: "'IBM Plex Mono',monospace",
                            fontSize: 10,
                            color: r.ins1Coverage >= 90 ? '#2D7A4F' : '#BA7517',
                          }}>{r.ins1Coverage}%</td>
                          {[
                            {
                              v: `${r.paspProfit >= 0 ? '+' : ''}¥${Math.abs(r.paspProfit)}`,
                              c: r.paspProfit >= 0 ? 'var(--color-success)' : 'var(--color-danger)',
                            },
                            {
                              v: `${r.paspROI >= 0 ? '+' : ''}${r.paspROI}%`,
                              c: r.paspROI >= 0 ? 'var(--color-success)' : 'var(--color-danger)',
                            },
                            {
                              v: r.hasBets
                                ? `${r.yourProfit >= 0 ? '+' : ''}¥${Math.abs(r.yourProfit || 0)}` : '—',
                              c: r.hasBets
                                ? (r.yourProfit >= 0 ? 'var(--color-success)' : 'var(--color-danger)')
                                : 'var(--color-text-muted)',
                            },
                            {
                              v: r.hasBets && r.yourROI != null
                                ? `${r.yourROI >= 0 ? '+' : ''}${r.yourROI}%` : '—',
                              c: r.hasBets && r.yourROI != null
                                ? (r.yourROI >= 0 ? 'var(--color-success)' : 'var(--color-danger)')
                                : 'var(--color-text-muted)',
                            },
                          ].map((c, ci) => (
                            <td key={ci} style={{
                              padding: '8px 8px 8px 0',
                              borderBottom: '0.5px solid var(--color-border)',
                              fontFamily: "'IBM Plex Mono',monospace",
                              textAlign: 'right', whiteSpace: 'nowrap',
                              color: c.c,
                            }}>{c.v}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td colSpan={7} style={{
                          padding: '10px 8px 0 0',
                          fontSize: 10, fontWeight: 700,
                          fontFamily: "'IBM Plex Mono',monospace",
                          color: 'var(--color-text-muted)',
                          letterSpacing: '0.06em', textTransform: 'uppercase',
                        }}>TOTAL</td>
                        {[
                          {
                            v: `${bettingPerf.paspProfit >= 0 ? '+' : ''}¥${Math.abs(bettingPerf.paspProfit)}`,
                            c: bettingPerf.paspProfit >= 0 ? 'var(--color-success)' : 'var(--color-danger)',
                          },
                          {
                            v: `${bettingPerf.paspROI >= 0 ? '+' : ''}${bettingPerf.paspROI}%`,
                            c: bettingPerf.paspROI >= 0 ? 'var(--color-success)' : 'var(--color-danger)',
                          },
                          {
                            v: bettingPerf.yourStake > 0
                              ? `${bettingPerf.yourProfit >= 0 ? '+' : ''}¥${Math.abs(bettingPerf.yourProfit)}` : '—',
                            c: bettingPerf.yourProfit >= 0 ? 'var(--color-success)' : 'var(--color-danger)',
                          },
                          {
                            v: bettingPerf.yourStake > 0
                              ? `${bettingPerf.yourROI >= 0 ? '+' : ''}${bettingPerf.yourROI}%` : '—',
                            c: bettingPerf.yourROI >= 0 ? 'var(--color-success)' : 'var(--color-danger)',
                          },
                        ].map((c, ci) => (
                          <td key={ci} style={{
                            padding: '10px 8px 0 0',
                            fontSize: 12, fontWeight: 700,
                            fontFamily: "'IBM Plex Mono',monospace",
                            textAlign: 'right', whiteSpace: 'nowrap',
                            color: c.c,
                          }}>{c.v}</td>
                        ))}
                      </tr>
                    </tfoot>
                  </table>
                </div>
                <p style={{ fontSize: 11, color: 'var(--color-text-muted)', lineHeight: 1.6 }}>
                  {lang === 'zh'
                    ? 'PASP+ADS使用¥400固定预算。⚡=R11触发(>15pp) · ~=软R11(12-15pp) · ADS负值=平坦分布需要更多保险 · Ins%=Insurance 1回报占预算比例'
                    : 'PASP+ADS uses ¥400 fixed budget. ⚡=R11 triggered (>15pp) · ~=soft R11 (12-15pp) · ADS negative=flat distribution needing more insurance · Ins%=Insurance 1 return as % of budget'}
                </p>
              </>
            )}
          </div>

          {/* ── Section J: PASP Algorithm Reference ── */}
          <div style={{ marginBottom: 28 }}>
            <span style={SH}>
              {lang === 'zh' ? 'PASP v3+ADS 算法参考' : 'PASP v3+ADS Algorithm Reference'}
            </span>

            {/* ADS Reference Table */}
            <div style={{
              marginBottom: 16,
              border: '0.5px solid var(--color-border)',
              borderRadius: 8, overflow: 'hidden',
            }}>
              <div style={{
                padding: '8px 14px',
                background: 'var(--color-bg-elevated)',
                fontSize: 9, fontWeight: 700,
                letterSpacing: '0.08em', textTransform: 'uppercase',
                fontFamily: "'IBM Plex Mono',monospace",
                color: 'var(--color-text-muted)',
                borderBottom: '0.5px solid var(--color-border)',
              }}>
                ADS → Stake Ratios
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    {['ADS Range', 'Anchor Strength', 'Primary', 'Ins 1', 'Ins 2', 'Value'].map(h => (
                      <th key={h} style={{
                        fontSize: 9, fontWeight: 500,
                        letterSpacing: '0.06em', textTransform: 'uppercase',
                        fontFamily: "'IBM Plex Mono',monospace",
                        color: 'var(--color-text-muted)',
                        padding: '6px 12px', textAlign: 'left',
                        borderBottom: '0.5px solid var(--color-border)',
                      }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[
                    ['> +10%', 'Strong', '50%', '25%', '15%', '10%', '#2D7A4F'],
                    ['0% to +10%', 'Moderate', '45%', '25%', '20%', '10%', '#2D7A4F'],
                    ['−10% to 0%', 'Weak', '40%', '30%', '20%', '10%', '#BA7517'],
                    ['< −10%', 'FLAT (max ins.)', '35%', '30%', '25%', '10%', '#791F1F'],
                  ].map(([range, label, ...pcts], ri) => (
                    <tr key={ri}>
                      <td style={{
                        padding: '8px 12px',
                        borderBottom: '0.5px solid var(--color-border)',
                        fontFamily: "'IBM Plex Mono',monospace",
                        fontSize: 11, color: pcts[4], fontWeight: 500,
                      }}>{range}</td>
                      <td style={{
                        padding: '8px 12px',
                        borderBottom: '0.5px solid var(--color-border)',
                        fontSize: 11, color: 'var(--color-text-primary)',
                      }}>{label}</td>
                      {pcts.slice(0, 4).map((p, pi) => (
                        <td key={pi} style={{
                          padding: '8px 12px',
                          borderBottom: '0.5px solid var(--color-border)',
                          fontFamily: "'IBM Plex Mono',monospace",
                          fontSize: 11, fontWeight: 600, color: pcts[4],
                        }}>{p}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* R11 & Insurance cards */}
            <div style={{
              display: 'grid', gridTemplateColumns: '1fr 1fr',
              gap: 10, marginBottom: 16,
            }}>
              {[
                {
                  title: 'R11 — Market Divergence',
                  color: '#C9A84C',
                  items: [
                    '> 15pp → R11 triggered → anchor +1',
                    '12-15pp → Soft R11 → value play only',
                    '≤ 12pp → R11 off → no adjustment',
                    'Conflict: market anchor always wins',
                  ],
                },
                {
                  title: 'Insurance Coverage Targets',
                  color: '#2D7A4F',
                  items: [
                    'Ins 1: return ≥ 90% of budget',
                    'Ins 2: return ≥ 75% of budget',
                    'If fails: +10% Ins1, −10% Primary',
                    'ADS flat → auto-increases insurance',
                  ],
                },
              ].map((card, ci) => (
                <div key={ci} style={{
                  border: `0.5px solid ${card.color}33`,
                  borderRadius: 8, padding: '12px 14px',
                  background: `${card.color}08`,
                }}>
                  <div style={{
                    fontSize: 10, fontWeight: 700,
                    letterSpacing: '0.06em', textTransform: 'uppercase',
                    fontFamily: "'IBM Plex Mono',monospace",
                    color: card.color, marginBottom: 8,
                  }}>{card.title}</div>
                  {card.items.map((item, ii) => (
                    <div key={ii} style={{
                      fontSize: 11, color: 'var(--color-text-secondary)',
                      marginBottom: 4, lineHeight: 1.4,
                      paddingLeft: 8, borderLeft: `2px solid ${card.color}44`,
                    }}>{item}</div>
                  ))}
                </div>
              ))}
            </div>

            {/* Decision rules table */}
            <div style={{ overflowX: 'auto' }}>
              <table style={{
                width: '100%', borderCollapse: 'collapse', minWidth: 480,
              }}>
                <thead>
                  <tr>
                    {['Rule', 'Condition', 'Action'].map(h => (
                      <th key={h} style={{
                        fontSize: 9, fontWeight: 500,
                        letterSpacing: '0.06em', textTransform: 'uppercase',
                        fontFamily: "'IBM Plex Mono',monospace",
                        color: 'var(--color-text-muted)',
                        padding: '0 12px 8px 0', textAlign: 'left',
                      }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[
                    ['R3',   'Market implied > model × 1.25',        'AVOID scoreline'],
                    ['R4',   'Value play odds > 12.00',               'Skip value play'],
                    ['R5',   'Insurance coverage < 90%',              'Increase Ins1 stake'],
                    ['R9',   'Single leg > 5% bankroll',              'Hard cap at 5%'],
                    ['R11',  'Market dom > Model dom by >15pp',       'Shift anchor +1, add value play'],
                    ['R11s', '12pp < divergence ≤ 15pp',             'Add value play only'],
                    ['R12',  'Model dominant < 50%',                  'Reduce budget 25% or skip'],
                    ['ADS',  'ADS < −10%',                           'Use 35/30/25/10 max insurance ratios'],
                  ].map(([rule, cond, action], ri) => (
                    <tr key={ri}>
                      <td style={{
                        padding: '7px 12px 7px 0',
                        borderBottom: '0.5px solid var(--color-border)',
                        fontFamily: "'IBM Plex Mono',monospace",
                        fontSize: 11, fontWeight: 700,
                        color: ['R11', 'R11s', 'R12', 'ADS'].includes(rule)
                          ? '#C9A84C' : 'var(--color-text-primary)',
                        whiteSpace: 'nowrap',
                      }}>{rule}</td>
                      <td style={{
                        padding: '7px 12px 7px 0',
                        borderBottom: '0.5px solid var(--color-border)',
                        fontSize: 11, color: 'var(--color-text-secondary)',
                      }}>{cond}</td>
                      <td style={{
                        padding: '7px 0',
                        borderBottom: '0.5px solid var(--color-border)',
                        fontSize: 11, fontWeight: 500,
                        color: 'var(--color-text-primary)',
                      }}>{action}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 12, lineHeight: 1.6 }}>
              {lang === 'zh'
                ? 'PASP v3+ADS基于WC2026第一轮4场有赔率比赛验证。样本需≥20场才有统计意义。'
                : 'PASP v3+ADS validated against 4 WC2026 matchday 1 results with odds. Sample needs ≥20 matches for statistical significance.'}
            </p>
          </div>
        </>
      )}
    </div>
  )
}
