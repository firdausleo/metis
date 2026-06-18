import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useTranslation } from '../lib/i18n'
import InfoTooltip from '../components/InfoTooltip'
import { useUser } from '../context/UserContext'
import { logPageView } from '../utils/activityTracker'

// ── Style constants ─────────────────────────────────────────────────────────
const TH = {
  fontSize: 11, fontWeight: 700, letterSpacing: '0.05em',
  color: 'var(--color-text-muted)', padding: '0 12px 10px 0',
  textAlign: 'left', whiteSpace: 'nowrap',
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

// ── CalibrationChart (SVG) ────────────────────────────────────────────────────
function CalibrationChart({ rows }) {
  const BUCKETS = [[0, 0.2], [0.2, 0.4], [0.4, 0.6], [0.6, 0.8], [0.8, 1.0]]
  const points = BUCKETS.map(([min, max]) => {
    const br = rows.filter(r => {
      const p = Number(r.v3_home_win)
      return !isNaN(p) && p >= min && p < max && r.actual_outcome != null
    })
    if (!br.length) return null
    const actual = br.filter(r => r.actual_outcome === 'H').length / br.length
    return { midpoint: (min + max) / 2, actual, n: br.length, label: `${Math.round(min * 100)}–${Math.round(max * 100)}%` }
  }).filter(Boolean)

  const W = 260, H = 180, PAD = 30
  const innerW = W - PAD * 2, innerH = H - PAD * 2
  const px = v => PAD + v * innerW
  const py = v => H - PAD - v * innerH

  if (points.length < 2) return null

  return (
    <div style={{ overflowX: 'auto' }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', maxWidth: 280, display: 'block' }}>
        <line x1={PAD} y1={PAD} x2={PAD} y2={H - PAD} stroke="#ccc" strokeWidth={0.5} />
        <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke="#ccc" strokeWidth={0.5} />
        {[0.25, 0.5, 0.75].map(v => (
          <line key={v} x1={PAD} y1={py(v)} x2={W - PAD} y2={py(v)} stroke="#eee" strokeWidth={0.5} />
        ))}
        <line x1={px(0)} y1={py(0)} x2={px(1)} y2={py(1)} stroke="#bbb" strokeWidth={1} strokeDasharray="4,3" />
        {points.map(({ midpoint, actual, n, label }) => (
          <g key={label}>
            <circle cx={px(midpoint)} cy={py(actual)} r={Math.min(10, Math.max(4, n * 1.5))} fill="#C9A84C" opacity={0.85} />
            <text x={px(midpoint)} y={py(actual) - 12} textAnchor="middle" fontSize={8} fill="#888">{label}</text>
          </g>
        ))}
        <text x={W / 2} y={H - 6} textAnchor="middle" fontSize={8} fill="#aaa">Predicted P(home win)</text>
        <text x={10} y={H / 2} textAnchor="middle" fontSize={8} fill="#aaa" transform={`rotate(-90,10,${H / 2})`}>Actual rate</text>
      </svg>
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

  useEffect(() => {
    logPageView(user?.id, 'model_performance')
    async function load() {
      const [predsRes, accRes, rolesRes, refitRes, betsRes, oddsRes] = await Promise.all([
        supabase
          .from('model_predictions')
          .select('*, match:matches(home_team,away_team,home_score,away_score,match_date)')
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
      setRows(predsRes.data || [])
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

      {loading ? (
        <div>{[...Array(5)].map((_, i) => (
          <div key={i} className="skeleton" style={{ height: 44, borderRadius: 6, marginBottom: 10 }} />
        ))}</div>
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
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
                <MetricCard
                  label={<>V1 Accuracy <InfoTooltip title="1X2 Accuracy" explanation="Correct prediction of match result (H/D/A). Random guesser: 33%. Bookmaker average: ~54%." explanationZh="预测比赛结果（主胜/平/客胜）准确率。随机猜测约33%，庄家均值约54%。" lang={lang} /></>}
                  value={fmtPct(v1Rate)}
                  sub={`${v1c}/${n} ${lang === 'zh' ? '命中' : 'correct'}`}
                  valueColor={hitColor(v1Rate)}
                />
                <MetricCard
                  label={<>V2 Accuracy <InfoTooltip title="1X2 Accuracy" explanation="Correct prediction of match result (H/D/A). Random guesser: 33%. Bookmaker average: ~54%." explanationZh="预测比赛结果（主胜/平/客胜）准确率。随机猜测约33%，庄家均值约54%。" lang={lang} /></>}
                  value={fmtPct(v2Rate)}
                  sub={`${v2c}/${n} ${lang === 'zh' ? '命中' : 'correct'}`}
                  valueColor={hitColor(v2Rate)}
                />
                <MetricCard
                  label={<>{lang === 'zh' ? 'V3准确率 ★' : 'V3 Accuracy ★'} <InfoTooltip title="1X2 Accuracy" explanation="Correct prediction of match result (H/D/A). Random guesser: 33%. Bookmaker average: ~54%." explanationZh="预测比赛结果（主胜/平/客胜）准确率。随机猜测约33%，庄家均值约54%。" lang={lang} /></>}
                  value={fmtPct(v3Rate)}
                  sub={`${v3c}/${n} ${lang === 'zh' ? '命中' : 'correct'}`}
                  gold
                  valueColor={hitColor(v3Rate)}
                />
                <MetricCard
                  label={<>{lang === 'zh' ? 'V3 Brier分' : 'V3 Brier Score'} <InfoTooltip title="Brier Score" explanation="Probability scoring rule: lower is better, 0 is perfect. Penalises confident wrong predictions more than uncertain ones." explanationZh="概率评分规则：越低越好，0分为完美。对自信预测错误的惩罚更重。" lang={lang} /></>}
                  value={avgBrier != null ? avgBrier.toFixed(3) : '—'}
                  sub={lang === 'zh' ? '越低越好 (完美=0)' : 'lower = better (perfect = 0)'}
                  valueColor={avgBrier != null
                    ? (avgBrier < 0.5 ? 'var(--color-success)' : avgBrier < 0.65 ? 'var(--color-edge-amber)' : 'var(--color-danger)')
                    : undefined}
                />
                <MetricCard
                  label={<>{lang === 'zh' ? 'V3 RPS分' : 'V3 RPS Score'} <InfoTooltip title="RPS" explanation="Ranked Probability Score: like Brier but accounts for outcome ordering (H/D/A). Lower = better. Rewards well-ordered confidence." explanationZh="排名概率分：类似Brier分，但考虑结果排序（主胜/平/客胜）。越低越好。" lang={lang} /></>}
                  value={avgRps != null ? avgRps.toFixed(3) : '—'}
                  sub={lang === 'zh' ? '越低越好 (完美=0)' : 'lower = better (perfect = 0)'}
                  valueColor={avgRps != null
                    ? (avgRps < 0.25 ? 'var(--color-success)' : avgRps < 0.35 ? 'var(--color-edge-amber)' : 'var(--color-danger)')
                    : undefined}
                />
                <MetricCard
                  label={<>{lang === 'zh' ? '总进球准确率' : 'TG Accuracy'} <InfoTooltip title="TG Accuracy" explanation="Percentage of matches where the model's top-probability total goals count matched the actual total." explanationZh="模型最高概率总进球数与实际总进球数一致的比例。" lang={lang} /></>}
                  value="—"
                  sub={lang === 'zh' ? '即将推出' : 'coming soon'}
                />
              </div>
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
                  <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
                    <thead>
                      <tr>
                        <th style={TH}>Date</th>
                        <th style={TH}>Match</th>
                        <th style={TH}>Result</th>
                        <th style={{ ...TH, textAlign: 'center' }}>V1</th>
                        <th style={{ ...TH, textAlign: 'center' }}>V2</th>
                        <th style={{ ...TH, textAlign: 'center' }}>V3 ★</th>
                        <th style={{ ...TH, textAlign: 'right' }}>Brier <InfoTooltip title="Brier Score" explanation="Probability scoring rule: lower is better, 0 is perfect. Penalises confident wrong predictions more." explanationZh="概率评分规则：越低越好，0分为完美。对自信预测错误惩罚更重。" lang={lang} /></th>
                        <th style={TH}>Top Score</th>
                        <th style={{ ...TH, textAlign: 'center' }}>Anchor</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tableRows.map(row => {
                        const m = row.match
                        const hs = m?.home_score, as_ = m?.away_score
                        const scoreStr = hs != null ? `${hs}–${as_}` : null
                        const outcomeLabel = row.actual_outcome === 'H' ? 'H' : row.actual_outcome === 'A' ? 'A' : 'D'
                        const topScore = row.v3_top_score || null
                        const topMatched = topScore && hs != null && topScore === `${hs}-${as_}`
                        const anchorLine = row.anchor_line != null ? Number(row.anchor_line) : null
                        const totalGoals = hs != null ? Number(hs) + Number(as_) : null
                        const anchorHit = anchorLine != null && totalGoals != null ? totalGoals > anchorLine : null
                        return (
                          <tr key={row.id}>
                            <td style={{ ...TD, whiteSpace: 'nowrap', fontSize: 11, fontFamily: "'IBM Plex Mono', monospace", color: 'var(--color-text-muted)' }}>
                              {fmtDate(row.settled_at || m?.match_date)}
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
                            <td style={{ ...TD, textAlign: 'right', fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, color: 'var(--color-text-muted)' }}>
                              {row.brier_score != null ? Number(row.brier_score).toFixed(3) : '—'}
                            </td>
                            <td style={{ ...TD, fontFamily: "'IBM Plex Mono', monospace", fontSize: 12 }}>
                              {topScore
                                ? <span style={{ color: topMatched ? '#C9A84C' : 'var(--color-text-muted)', fontWeight: topMatched ? 700 : 400 }}>{topScore}</span>
                                : '—'}
                            </td>
                            <td style={{ ...TD, textAlign: 'center', fontSize: 13 }}>
                              {anchorHit == null
                                ? <span style={{ color: 'var(--color-text-muted)' }}>—</span>
                                : <span style={{ color: anchorHit ? 'var(--color-success)' : 'var(--color-danger)' }}>{anchorHit ? '✓' : '✗'}</span>}
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
            const hasPoints = BUCKETS.some(([min, max]) =>
              rows.some(r => {
                const p = Number(r.v3_home_win)
                return !isNaN(p) && p >= min && p < max && r.actual_outcome != null
              })
            )
            if (!hasPoints) return null
            return (
              <div style={{ marginBottom: 28 }}>
                <span style={SH}>{t('perf.calibration')} <InfoTooltip title="Calibration" explanation="A well-calibrated model predicts 60% when the true frequency is 60%. Dots near the diagonal line = good calibration." explanationZh="校准良好的模型预测60%时，实际发生率也约60%。散点靠近对角线=校准良好。" lang={lang} /></span>
                <CalibrationChart rows={rows} />
                <p style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 8, lineHeight: 1.6 }}>
                  {lang === 'zh'
                    ? '散点靠近对角线 = 模型校准良好 · 圆圈大小 = 样本量 · 仅显示V3主队获胜概率'
                    : 'Points near diagonal = well-calibrated · Circle size = sample count · V3 home win probability shown'}
                </p>
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
