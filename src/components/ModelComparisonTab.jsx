import { useState, useMemo } from 'react'
import { poissonPMF } from '../lib/poisson'

// ── Constants ────────────────────────────────────────────────────────────────
const RHO    = -0.0612
const MAX_G  = 8
const MONO   = "'IBM Plex Mono', monospace"
const MODEL_V1 = '#6b7280'
const MODEL_DC = '#0F3460'
const MODEL_V3 = '#D4AF37'
const TIER_COLOR = { STRONG: '#22c55e', MODERATE: '#3b82f6', WEAK: '#f59e0b', FLAT: '#ef4444' }
const TIER_SPLIT = { STRONG: '50/25/15/10', MODERATE: '45/25/20/10', WEAK: '40/30/20/10', FLAT: '35/30/25/10' }

// ── Matrix builders ───────────────────────────────────────────────────────────

function tauCorr(x, y, lh, la) {
  if (x === 0 && y === 0) return 1 - lh * la * RHO
  if (x === 0 && y === 1) return 1 + lh * RHO
  if (x === 1 && y === 0) return 1 + la * RHO
  if (x === 1 && y === 1) return 1 - RHO
  return 1
}

function buildV1(lh, la) {
  const M = []; let total = 0
  for (let x = 0; x <= MAX_G; x++) {
    M[x] = []
    for (let y = 0; y <= MAX_G; y++) { M[x][y] = poissonPMF(x, lh) * poissonPMF(y, la); total += M[x][y] }
  }
  if (total > 0) for (let x = 0; x <= MAX_G; x++) for (let y = 0; y <= MAX_G; y++) M[x][y] /= total
  return M
}

function buildDC(lh, la) {
  const M = []; let total = 0
  for (let x = 0; x <= MAX_G; x++) {
    M[x] = []
    for (let y = 0; y <= MAX_G; y++) {
      M[x][y] = Math.max(poissonPMF(x, lh) * poissonPMF(y, la) * tauCorr(x, y, lh, la), 0)
      total += M[x][y]
    }
  }
  if (total > 0) for (let x = 0; x <= MAX_G; x++) for (let y = 0; y <= MAX_G; y++) M[x][y] /= total
  return M
}

function buildV3(lh, la) {
  const v1 = buildV1(lh, la), dc = buildDC(lh, la)
  const M = []
  for (let x = 0; x <= MAX_G; x++) { M[x] = []; for (let y = 0; y <= MAX_G; y++) M[x][y] = 0.65 * dc[x][y] + 0.35 * v1[x][y] }
  return M
}

// ── Matrix analysis ───────────────────────────────────────────────────────────

function cellMatchesDom(x, y, dom) {
  if (dom === 'home') return x > y
  if (dom === 'away') return x < y
  return x === y
}

function matStats(M) {
  let homeWin = 0, draw = 0, awayWin = 0
  const totals = new Array(MAX_G * 2 + 1).fill(0)
  const cells = []
  for (let x = 0; x <= MAX_G; x++) {
    for (let y = 0; y <= MAX_G; y++) {
      const p = M[x][y]
      if (x > y) homeWin += p; else if (x === y) draw += p; else awayWin += p
      totals[x + y] += p
      cells.push({ x, y, p })
    }
  }
  const dominant = homeWin >= draw && homeWin >= awayWin ? 'home' : awayWin >= homeWin && awayWin >= draw ? 'away' : 'draw'
  const goalsDist = totals.slice(0, MAX_G + 1)
  let anchor = 0, anchorProb = goalsDist[0]
  for (let k = 1; k <= MAX_G; k++) if (goalsDist[k] > anchorProb) { anchorProb = goalsDist[k]; anchor = k }
  const pPrev = anchor > 0 ? goalsDist[anchor - 1] : 0
  const pNext = anchor < MAX_G ? goalsDist[anchor + 1] : 0
  const ads = anchorProb - pPrev - pNext
  const tier = ads > 0.10 ? 'STRONG' : ads >= 0 ? 'MODERATE' : ads >= -0.10 ? 'WEAK' : 'FLAT'
  const cands = cells.filter(c => c.x + c.y === anchor && cellMatchesDom(c.x, c.y, dominant)).sort((a, b) => b.p - a.p)
  return {
    homeWin, draw, awayWin, dominant,
    goalsDist, anchor, anchorProb, ads, tier,
    split: TIER_SPLIT[tier],
    primary: cands[0] || null,
    secondary: cands[1] || null,
    top3: [...cells].sort((a, b) => b.p - a.p).slice(0, 3),
  }
}

function scoreM(stats, hs, as_) {
  const tot = hs + as_
  const res = hs > as_ ? 'home' : hs < as_ ? 'away' : 'draw'
  return {
    dirHit:   stats.dominant === res,
    primHit:  !!stats.primary   && stats.primary.x   === hs && stats.primary.y   === as_,
    secHit:   !!stats.secondary && stats.secondary.x === hs && stats.secondary.y === as_,
    top3Hit:  stats.top3.some(c => c.x === hs && c.y === as_),
    ancHit:   stats.anchor === tot,
    goalsErr: Math.abs(stats.anchor - tot),
  }
}

// ── Formatting helpers ────────────────────────────────────────────────────────
function pct(n, d)  { return d ? `${n}/${d} (${(n / d * 100).toFixed(1)}%)` : '—' }
function p2(v)      { return (v * 100).toFixed(1) + '%' }
function mkVal(hits, n) { return { raw: n ? hits / n : -1, label: pct(hits, n) } }
function mkErr(sum, n)  { return { raw: n ? sum / n : Infinity, label: n ? (sum / n).toFixed(2) : '—' } }
function mkN(v)         { return { raw: v, label: String(v) } }

// ── Sub-components ────────────────────────────────────────────────────────────

function SectionHead({ children }) {
  return (
    <div style={{
      fontSize: 11, fontWeight: 700, letterSpacing: '0.08em',
      color: '#1A3A6C', textTransform: 'uppercase',
      borderBottom: '0.5px solid #1A3A6C', paddingBottom: 6, marginBottom: 16,
    }}>{children}</div>
  )
}

function TierPill({ tier }) {
  return (
    <span style={{
      background: TIER_COLOR[tier], color: '#fff',
      padding: '1px 7px', borderRadius: 10,
      fontSize: 10, fontWeight: 700, fontFamily: MONO,
    }}>{tier}</span>
  )
}

function HitIcon({ hit }) {
  return hit
    ? <span style={{ color: 'var(--color-success)', fontWeight: 700 }}>✓</span>
    : <span style={{ color: 'var(--color-danger)' }}>✗</span>
}

// Summary table row — highlights winner (green bg)
function SumRow({ metric, v1, dc, v3, higher = true }) {
  const items = [v1, dc, v3]
  const vals  = items.map(it => it.raw)
  const allEq = vals.every(v => v === vals[0])
  const best  = higher ? Math.max(...vals) : Math.min(...vals)
  return (
    <tr>
      <td style={{ padding: '8px 12px', fontSize: 12, color: 'var(--color-text-secondary)', borderBottom: '0.5px solid var(--color-border)' }}>
        {metric}
      </td>
      {items.map((it, i) => {
        const isBest = !allEq && isFinite(it.raw) && it.raw === best
        return (
          <td key={i} style={{
            padding: '8px 12px', textAlign: 'center', fontFamily: MONO, fontSize: 12,
            fontWeight: isBest ? 700 : 500,
            borderBottom: '0.5px solid var(--color-border)',
            background: isBest ? '#dcfce7' : 'transparent',
            color: isBest ? '#15803d' : 'var(--color-text-primary)',
          }}>
            {it.label}
          </td>
        )
      })}
    </tr>
  )
}

// Per-match model column (V1, DC-only, V3)
function ModelCol({ label, color, stats, score, v1M, dcM, isLast }) {
  return (
    <div style={{ padding: '10px 12px', borderRight: isLast ? 'none' : '0.5px solid var(--color-border)', flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.12em', color, marginBottom: 8, textTransform: 'uppercase', fontFamily: MONO }}>
        {label}
      </div>
      {/* 1X2 */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 8, flexWrap: 'wrap' }}>
        {[{ k: 'home', v: stats.homeWin, l: 'Win' }, { k: 'draw', v: stats.draw, l: 'Draw' }, { k: 'away', v: stats.awayWin, l: 'Away' }].map(({ k, v, l }) => (
          <span key={k} style={{
            fontFamily: MONO, fontSize: 10, padding: '2px 5px', borderRadius: 3,
            background: stats.dominant === k ? color : 'var(--color-bg-secondary)',
            color: stats.dominant === k ? '#fff' : 'var(--color-text-muted)',
            fontWeight: stats.dominant === k ? 700 : 400,
          }}>{l} {p2(v)}</span>
        ))}
      </div>
      {/* Score lines */}
      <div style={{ fontFamily: MONO, fontSize: 11, lineHeight: 1.9, color: 'var(--color-text-secondary)' }}>
        <div><span style={{ color: 'var(--color-text-muted)' }}>Primary   </span><b style={{ color: 'var(--color-text-primary)' }}>{stats.primary ? `${stats.primary.x}-${stats.primary.y}` : '—'}</b>{stats.primary && <span style={{ color: 'var(--color-text-muted)' }}> {p2(stats.primary.p)}</span>}</div>
        <div><span style={{ color: 'var(--color-text-muted)' }}>Secondary </span><b style={{ color: 'var(--color-text-primary)' }}>{stats.secondary ? `${stats.secondary.x}-${stats.secondary.y}` : '—'}</b>{stats.secondary && <span style={{ color: 'var(--color-text-muted)' }}> {p2(stats.secondary.p)}</span>}</div>
        <div><span style={{ color: 'var(--color-text-muted)' }}>Anchor    </span><b style={{ color: 'var(--color-text-primary)' }}>{stats.anchor}g</b> <span style={{ color: 'var(--color-text-muted)' }}>{p2(stats.anchorProb)}</span></div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
          <span style={{ color: 'var(--color-text-muted)' }}>ADS </span>
          <b style={{ color: 'var(--color-text-primary)' }}>{stats.ads.toFixed(3)}</b>
          <TierPill tier={stats.tier} />
          <span style={{ color: 'var(--color-text-muted)', fontSize: 10 }}>{stats.split}</span>
        </div>
        {/* ρ impact — DC column only */}
        {label === 'DC-only' && v1M && dcM && (
          <div style={{
            marginTop: 6, padding: '4px 7px',
            background: 'rgba(15,52,96,0.06)', borderLeft: '2px solid #0F3460',
            borderRadius: '0 3px 3px 0', fontSize: 10, lineHeight: 1.7,
            color: 'var(--color-text-muted)',
          }}>
            <div>0-0: {p2(v1M[0][0])} → {p2(dcM[0][0])} <span style={{ color: dcM[0][0] > v1M[0][0] ? '#22c55e' : '#ef4444' }}>{dcM[0][0] > v1M[0][0] ? '↑' : '↓'}</span></div>
            <div>1-1: {p2(v1M[1][1])} → {p2(dcM[1][1])} <span style={{ color: dcM[1][1] > v1M[1][1] ? '#22c55e' : '#ef4444' }}>{dcM[1][1] > v1M[1][1] ? '↑' : '↓'}</span></div>
          </div>
        )}
      </div>
      {/* Hit badges */}
      <div style={{ display: 'flex', gap: 10, marginTop: 9, fontSize: 11, fontFamily: MONO, borderTop: '0.5px solid var(--color-border)', paddingTop: 7 }}>
        <span>Dir <HitIcon hit={score.dirHit} /></span>
        <span>Anc <HitIcon hit={score.ancHit} /></span>
        <span>Prim <HitIcon hit={score.primHit} /></span>
      </div>
    </div>
  )
}

// Pure CSS bar chart for Section 4
function TrendChart({ groups }) {
  if (!groups.length) return null
  const CHART_H = 120
  return (
    <div style={{ overflowX: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', minWidth: groups.length * 80, gap: 0 }}>
        {/* Y-axis */}
        <div style={{ width: 30, flexShrink: 0, height: CHART_H, position: 'relative', marginBottom: 40 }}>
          {[100, 75, 50, 25, 0].map(v => (
            <div key={v} style={{ position: 'absolute', bottom: `${v}%`, transform: 'translateY(50%)', fontSize: 8, fontFamily: MONO, color: 'var(--color-text-muted)', right: 3, textAlign: 'right' }}>{v}%</div>
          ))}
        </div>
        {groups.map((g, i) => (
          <div key={i} style={{ flex: 1, minWidth: 60, textAlign: 'center' }}>
            <div style={{ height: CHART_H, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', gap: 3, position: 'relative', borderBottom: '0.5px solid var(--color-border)' }}>
              {[25, 50, 75].map(v => (
                <div key={v} style={{ position: 'absolute', left: 0, right: 0, bottom: `${v}%`, borderTop: '0.5px solid var(--color-border-light)', pointerEvents: 'none' }} />
              ))}
              {[{ val: g.v1, color: MODEL_V1, lbl: 'V1' }, { val: g.dc, color: MODEL_DC, lbl: 'DC' }, { val: g.v3, color: MODEL_V3, lbl: 'V3' }].map(({ val, color, lbl }) => (
                <div key={lbl} title={`${lbl}: ${val.toFixed(1)}%`} style={{ width: 14, height: Math.max(val / 100 * CHART_H, 2), background: color, borderRadius: '2px 2px 0 0', position: 'relative' }}>
                  <span style={{ position: 'absolute', top: -14, left: '50%', transform: 'translateX(-50%)', fontSize: 8, fontFamily: MONO, color, whiteSpace: 'nowrap', fontWeight: 700 }}>
                    {val.toFixed(0)}%
                  </span>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 4, fontSize: 9, fontFamily: MONO, color: 'var(--color-text-muted)', lineHeight: 1.4 }}>
              <div style={{ fontWeight: 700 }}>MD {i + 1}</div>
              <div>{g.label}</div>
              <div style={{ opacity: 0.7 }}>{g.n}g</div>
            </div>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 16, marginTop: 12 }}>
        {[['V1', MODEL_V1], ['DC-only', MODEL_DC], ['V3', MODEL_V3]].map(([l, c]) => (
          <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, fontFamily: MONO }}>
            <div style={{ width: 10, height: 10, background: c, borderRadius: 2 }} />
            <span style={{ color: 'var(--color-text-muted)' }}>{l}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function ModelComparisonTab({ rows }) {
  const [openCards, setOpenCards] = useState({})

  // Build per-match computation
  const matchData = useMemo(() => {
    return rows
      .filter(r => r.match && r.match.home_score != null && r.match.away_score != null
        && r.v3_lambda_home != null && r.v3_lambda_away != null)
      .map(r => {
        const lh  = Number(r.v3_lambda_home)
        const la  = Number(r.v3_lambda_away)
        const hs  = Number(r.match.home_score)
        const as_ = Number(r.match.away_score)
        if (!isFinite(lh) || !isFinite(la) || lh <= 0 || la <= 0) return null
        const v1M = buildV1(lh, la)
        const dcM = buildDC(lh, la)
        const v3M = buildV3(lh, la)
        const v1S = matStats(v1M)
        const dcS = matStats(dcM)
        const v3S = matStats(v3M)
        return {
          id: r.id, row: r, match: r.match,
          lh, la, hs, as_,
          v1M, dcM, v3M,
          v1S, dcS, v3S,
          v1Sc: scoreM(v1S, hs, as_),
          dcSc: scoreM(dcS, hs, as_),
          v3Sc: scoreM(v3S, hs, as_),
          isLow: hs + as_ <= 2,
        }
      })
      .filter(Boolean)
  }, [rows])

  // Summary aggregation
  const summary = useMemo(() => {
    const n = matchData.length
    if (!n) return null
    let v1d=0,dcd=0,v3d=0, v1p=0,dcp=0,v3p=0, v1s=0,dcs=0,v3s=0
    let v1t=0,dct=0,v3t=0, v1a=0,dca=0,v3a=0, v1e=0,dce=0,v3e=0
    let v1str=0,dcstr=0,v3str=0, v1fl=0,dcfl=0,v3fl=0
    let nLow=0,nHigh=0, v1dL=0,dcdL=0,v3dL=0, v1dH=0,dcdH=0,v3dH=0
    for (const d of matchData) {
      if (d.v1Sc.dirHit)  v1d++;  if (d.dcSc.dirHit)  dcd++;  if (d.v3Sc.dirHit)  v3d++
      if (d.v1Sc.primHit) v1p++;  if (d.dcSc.primHit) dcp++;  if (d.v3Sc.primHit) v3p++
      if (d.v1Sc.secHit)  v1s++;  if (d.dcSc.secHit)  dcs++;  if (d.v3Sc.secHit)  v3s++
      if (d.v1Sc.top3Hit) v1t++;  if (d.dcSc.top3Hit) dct++;  if (d.v3Sc.top3Hit) v3t++
      if (d.v1Sc.ancHit)  v1a++;  if (d.dcSc.ancHit)  dca++;  if (d.v3Sc.ancHit)  v3a++
      v1e += d.v1Sc.goalsErr; dce += d.dcSc.goalsErr; v3e += d.v3Sc.goalsErr
      if (d.v1S.tier === 'STRONG') v1str++; if (d.dcS.tier === 'STRONG') dcstr++; if (d.v3S.tier === 'STRONG') v3str++
      if (d.v1S.tier === 'FLAT')   v1fl++;  if (d.dcS.tier === 'FLAT')   dcfl++;  if (d.v3S.tier === 'FLAT')   v3fl++
      if (d.isLow) {
        nLow++
        if (d.v1Sc.dirHit) v1dL++; if (d.dcSc.dirHit) dcdL++; if (d.v3Sc.dirHit) v3dL++
      } else {
        nHigh++
        if (d.v1Sc.dirHit) v1dH++; if (d.dcSc.dirHit) dcdH++; if (d.v3Sc.dirHit) v3dH++
      }
    }
    return {
      n,
      dir:  [mkVal(v1d,n),  mkVal(dcd,n),  mkVal(v3d,n)],
      prim: [mkVal(v1p,n),  mkVal(dcp,n),  mkVal(v3p,n)],
      sec:  [mkVal(v1s,n),  mkVal(dcs,n),  mkVal(v3s,n)],
      top3: [mkVal(v1t,n),  mkVal(dct,n),  mkVal(v3t,n)],
      anc:  [mkVal(v1a,n),  mkVal(dca,n),  mkVal(v3a,n)],
      err:  [mkErr(v1e,n),  mkErr(dce,n),  mkErr(v3e,n)],
      str:  [mkN(v1str),    mkN(dcstr),    mkN(v3str)],
      flat: [mkN(v1fl),     mkN(dcfl),     mkN(v3fl)],
      low:  [mkVal(v1dL,nLow),  mkVal(dcdL,nLow),  mkVal(v3dL,nLow)],
      high: [mkVal(v1dH,nHigh), mkVal(dcdH,nHigh), mkVal(v3dH,nHigh)],
      nLow, nHigh,
    }
  }, [matchData])

  // ρ impact analysis
  const rhoData = useMemo(() => {
    if (!matchData.length) return null
    return [['0-0',0,0],['1-0',1,0],['0-1',0,1],['1-1',1,1]].map(([sc, x, y]) => {
      let v1Sum=0, dcSum=0, actualN=0
      for (const d of matchData) {
        v1Sum += d.v1M[x][y]; dcSum += d.dcM[x][y]
        if (d.hs === x && d.as_ === y) actualN++
      }
      const n = matchData.length
      const avgV1 = v1Sum / n, avgDC = dcSum / n, freq = actualN / n
      return { sc, avgV1, avgDC, freq, actualN, n, dcHelped: Math.abs(avgDC - freq) < Math.abs(avgV1 - freq) }
    })
  }, [matchData])

  // Trend by calendar date
  const trend = useMemo(() => {
    const byDay = {}
    for (const d of matchData) {
      const day = d.match.match_date?.slice(0, 10) || 'unknown'
      if (!byDay[day]) byDay[day] = []
      byDay[day].push(d)
    }
    return Object.entries(byDay)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, ds]) => {
        const n = ds.length
        return {
          label: day.slice(5),
          n,
          v1: ds.filter(d => d.v1Sc.dirHit).length / n * 100,
          dc: ds.filter(d => d.dcSc.dirHit).length / n * 100,
          v3: ds.filter(d => d.v3Sc.dirHit).length / n * 100,
        }
      })
  }, [matchData])

  if (!matchData.length) {
    return (
      <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13 }}>
        No settled matches with V3 lambdas stored yet. Run stats fetch on upcoming matches to populate predictions.
      </div>
    )
  }

  const CARD = {
    border: '0.5px solid var(--color-border)', borderRadius: 8,
    background: 'var(--color-bg-card)', marginBottom: 10, overflow: 'hidden',
  }

  const n = matchData.length

  return (
    <div style={{ paddingBottom: 40 }}>

      {/* ── SECTION 1: Summary Scorecard ─────────────────────────────────────── */}
      <div style={{ marginBottom: 24 }}>
        <SectionHead>Summary Scorecard — {n} Matches</SectionHead>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 520 }}>
            <thead>
              <tr style={{ background: 'var(--color-bg-secondary)' }}>
                <th style={{ padding: '8px 12px', fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', fontFamily: MONO, color: 'var(--color-text-muted)', textAlign: 'left', borderBottom: '0.5px solid var(--color-border)' }}>
                  Metric
                </th>
                {[['V1', MODEL_V1], ['DC-only', MODEL_DC], ['V3', MODEL_V3]].map(([l, c]) => (
                  <th key={l} style={{ padding: '8px 12px', fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', fontFamily: MONO, color: c, textAlign: 'center', borderBottom: '0.5px solid var(--color-border)' }}>
                    {l}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={{ padding: '8px 12px', fontSize: 12, color: 'var(--color-text-muted)', borderBottom: '0.5px solid var(--color-border)' }}>Matches analysed</td>
                {[MODEL_V1, MODEL_DC, MODEL_V3].map((c, i) => (
                  <td key={i} style={{ padding: '8px 12px', textAlign: 'center', fontFamily: MONO, fontSize: 12, borderBottom: '0.5px solid var(--color-border)', color: c, fontWeight: 600 }}>
                    {n}
                  </td>
                ))}
              </tr>
              {summary && <>
                <SumRow metric="Direction accuracy"   v1={summary.dir[0]}  dc={summary.dir[1]}  v3={summary.dir[2]} />
                <SumRow metric="Primary score hit"    v1={summary.prim[0]} dc={summary.prim[1]} v3={summary.prim[2]} />
                <SumRow metric="Secondary score hit"  v1={summary.sec[0]}  dc={summary.sec[1]}  v3={summary.sec[2]} />
                <SumRow metric="Top-3 hit"            v1={summary.top3[0]} dc={summary.top3[1]} v3={summary.top3[2]} />
                <SumRow metric="Anchor hit"           v1={summary.anc[0]}  dc={summary.anc[1]}  v3={summary.anc[2]} />
                <SumRow metric="Mean goals error"     v1={summary.err[0]}  dc={summary.err[1]}  v3={summary.err[2]} higher={false} />
                <SumRow metric="STRONG anchors"       v1={summary.str[0]}  dc={summary.str[1]}  v3={summary.str[2]} />
                <SumRow metric="FLAT anchors"         v1={summary.flat[0]} dc={summary.flat[1]} v3={summary.flat[2]} higher={false} />
                <SumRow metric={`Low-score dir accuracy (x+y ≤ 2, n=${summary.nLow})`}  v1={summary.low[0]}  dc={summary.low[1]}  v3={summary.low[2]} />
                <SumRow metric={`High-score dir accuracy (x+y ≥ 3, n=${summary.nHigh})`} v1={summary.high[0]} dc={summary.high[1]} v3={summary.high[2]} />
              </>}
            </tbody>
          </table>
        </div>
        <div style={{ marginTop: 10, padding: '8px 12px', background: 'var(--color-bg-secondary)', borderRadius: 6, borderLeft: '3px solid #0F3460', fontSize: 11, color: 'var(--color-text-muted)', lineHeight: 1.6 }}>
          DC-only and V1 produce identical predictions for matches with 3+ goals. The difference is entirely
          in low-scoring outcomes (0-0, 1-0, 0-1, 1-1) where DC applies the ρ=−0.0612 correlation correction.
        </div>
      </div>

      {/* ── SECTION 2: ρ Impact Analysis ─────────────────────────────────────── */}
      <div style={{ marginBottom: 24 }}>
        <SectionHead>ρ Impact Analysis — How DC Shifts Low-Score Probabilities</SectionHead>
        {rhoData && (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 480, fontSize: 12 }}>
                <thead>
                  <tr>
                    {['Scoreline', 'V1 avg prob', 'DC avg prob', 'Actual freq', 'DC helped?'].map((h, i) => (
                      <th key={h} style={{ padding: '6px 12px', textAlign: i > 0 ? 'center' : 'left', fontSize: 9, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', fontFamily: MONO, color: 'var(--color-text-muted)', borderBottom: '0.5px solid var(--color-border)' }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rhoData.map(({ sc, avgV1, avgDC, freq, actualN, n: rn, dcHelped }) => (
                    <tr key={sc}>
                      <td style={{ padding: '9px 12px', fontFamily: MONO, fontWeight: 700, fontSize: 14, color: 'var(--color-text-primary)', borderBottom: '0.5px solid var(--color-border)' }}>{sc}</td>
                      <td style={{ padding: '9px 12px', fontFamily: MONO, fontSize: 12, textAlign: 'center', color: 'var(--color-text-secondary)', borderBottom: '0.5px solid var(--color-border)' }}>{p2(avgV1)}</td>
                      <td style={{ padding: '9px 12px', fontFamily: MONO, fontSize: 12, textAlign: 'center', borderBottom: '0.5px solid var(--color-border)' }}>
                        <span style={{ color: MODEL_DC, fontWeight: 600 }}>{p2(avgDC)}</span>
                        <span style={{ fontSize: 10, marginLeft: 4, color: avgDC > avgV1 ? '#22c55e' : '#ef4444' }}>{avgDC > avgV1 ? '↑' : '↓'}</span>
                      </td>
                      <td style={{ padding: '9px 12px', fontFamily: MONO, fontSize: 12, textAlign: 'center', fontWeight: 600, color: 'var(--color-text-primary)', borderBottom: '0.5px solid var(--color-border)' }}>
                        {p2(freq)} <span style={{ fontSize: 10, color: 'var(--color-text-muted)', fontWeight: 400 }}>({actualN}/{rn})</span>
                      </td>
                      <td style={{ padding: '9px 12px', textAlign: 'center', borderBottom: '0.5px solid var(--color-border)' }}>
                        <span style={{ fontSize: 11, fontWeight: 700, fontFamily: MONO, color: dcHelped ? '#22c55e' : '#ef4444' }}>
                          {dcHelped ? '✓ YES' : '✗ NO'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ marginTop: 10, padding: '8px 12px', background: 'rgba(15,52,96,0.04)', borderRadius: 6, borderLeft: '3px solid #0F3460', fontSize: 11, color: 'var(--color-text-muted)', lineHeight: 1.6 }}>
              Current ρ = −0.0612. Negative ρ means draws and 0-0 are more likely than independence assumes.
              If DC consistently overestimates 0-0 and 1-1, consider refitting ρ on WC2026 data alone.
            </div>
          </>
        )}
      </div>

      {/* ── SECTION 3: Match by Match ─────────────────────────────────────────── */}
      <div style={{ marginBottom: 24 }}>
        <SectionHead>Match by Match — {n} matches, newest first</SectionHead>
        {matchData.map(d => {
          const m = d.match
          const isOpen = !!openCards[d.id]
          const dateStr = m.match_date
            ? new Date(m.match_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Asia/Shanghai' })
            : '—'
          const stageStr = m.stage === 'group'
            ? `Group ${m.group_name || ''}`
            : m.stage ? m.stage.toUpperCase() : ''

          return (
            <div key={d.id} style={CARD}>
              <button
                onClick={() => setOpenCards(p => ({ ...p, [d.id]: !p[d.id] }))}
                style={{
                  width: '100%', background: 'none', border: 'none', cursor: 'pointer',
                  padding: '10px 14px', textAlign: 'left',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  gap: 8, flexWrap: 'wrap', minHeight: 44,
                  borderBottom: isOpen ? '0.5px solid var(--color-border)' : 'none',
                }}
              >
                {/* Left: match name + stage */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', flex: 1, minWidth: 0 }}>
                  <span style={{ fontFamily: MONO, fontSize: 13, fontWeight: 600, color: 'var(--color-text-primary)', whiteSpace: 'nowrap' }}>
                    {m.home_team} <span style={{ color: '#1A3A6C' }}>{d.hs}–{d.as_}</span> {m.away_team}
                  </span>
                  <span style={{ fontSize: 10, color: 'var(--color-text-muted)', fontFamily: MONO, whiteSpace: 'nowrap' }}>
                    {[stageStr, dateStr].filter(Boolean).join(' · ')}
                  </span>
                </div>
                {/* Right: hit badges + toggle */}
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 9, fontFamily: MONO, color: 'var(--color-text-muted)' }}>Dir:</span>
                  {[d.v1Sc, d.dcSc, d.v3Sc].map((sc, i) => (
                    <span key={i} style={{ fontSize: 10, fontFamily: MONO, fontWeight: 700, color: sc.dirHit ? '#22c55e' : '#ef4444' }}>
                      {['V1','DC','V3'][i]}{sc.dirHit ? '✓' : '✗'}
                    </span>
                  ))}
                  <span style={{ fontSize: 9, fontFamily: MONO, color: 'var(--color-text-muted)', marginLeft: 4 }}>Prim:</span>
                  {[d.v1Sc, d.dcSc, d.v3Sc].map((sc, i) => (
                    <span key={i} style={{ fontSize: 10, fontFamily: MONO, fontWeight: 700, color: sc.primHit ? '#22c55e' : '#ef4444' }}>
                      {['V1','DC','V3'][i]}{sc.primHit ? '✓' : '✗'}
                    </span>
                  ))}
                  <span style={{ fontSize: 11, color: 'var(--color-text-muted)', marginLeft: 4 }}>
                    {isOpen ? '▲' : '▼'}
                  </span>
                </div>
              </button>
              {isOpen && (
                <div style={{ display: 'flex' }}>
                  <ModelCol label="V1" color={MODEL_V1} stats={d.v1S} score={d.v1Sc} v1M={null} dcM={null} isLast={false} />
                  <ModelCol label="DC-only" color={MODEL_DC} stats={d.dcS} score={d.dcSc} v1M={d.v1M} dcM={d.dcM} isLast={false} />
                  <ModelCol label="V3" color={MODEL_V3} stats={d.v3S} score={d.v3Sc} v1M={null} dcM={null} isLast={true} />
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* ── SECTION 4: Trend by Matchday ──────────────────────────────────────── */}
      <div style={{ marginBottom: 8 }}>
        <SectionHead>Direction Accuracy by Matchday</SectionHead>
        <TrendChart groups={trend} />
        <p style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 10, lineHeight: 1.6 }}>
          Each group = one calendar day of WC2026 matches. Shows whether V3's DC blend
          improves as tournament data accumulates. Small samples per day produce noise.
        </p>
      </div>

    </div>
  )
}
