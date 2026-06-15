import { useState, useMemo } from 'react'
import { useTranslation } from '../../lib/i18n'
import { getFlag } from '../../lib/teamFlags'
import { analyse1X2, calcStake, formatProb } from '../../lib/evEngine'
import { placeBet } from '../../lib/bets'
import { buildPaspPlan, paspText, quarterKelly, correlatedKelly } from '../../utils/pasp'

// ── Asian Handicap helpers (pure, no deps) ──────────────────────────────

function isQtrLine(line) { return Math.round(Math.abs(line) * 4) % 2 === 1 }

function singleAHResult(h, a, line) {
  const adj = h + line
  if (Math.abs(adj - a) < 0.0001) return 'push'
  return adj > a ? 'home' : 'away'
}

function calcAHLine(matrix, line) {
  const N = matrix.length
  let pHome = 0, pAway = 0, pPush = 0
  for (let i = 0; i < N; i++)
    for (let j = 0; j < N; j++) {
      const r = singleAHResult(i, j, line), p = matrix[i][j]
      if (r === 'home') pHome += p
      else if (r === 'away') pAway += p
      else pPush += p
    }
  return { pHome, pAway, pPush }
}

function calcAHProbs(matrix, line) {
  if (!isQtrLine(line)) return calcAHLine(matrix, line)
  const r1 = calcAHLine(matrix, line - 0.25)
  const r2 = calcAHLine(matrix, line + 0.25)
  return { pHome: (r1.pHome + r2.pHome) / 2, pAway: (r1.pAway + r2.pAway) / 2, pPush: (r1.pPush + r2.pPush) / 2 }
}

function singleTGResult(total, line) {
  if (total === line) return 'push'
  return total > line ? 'over' : 'under'
}

function calcTGLine(matrix, line) {
  const N = matrix.length
  let pOver = 0, pUnder = 0, pPush = 0
  for (let i = 0; i < N; i++)
    for (let j = 0; j < N; j++) {
      const r = singleTGResult(i + j, line), p = matrix[i][j]
      if (r === 'over') pOver += p
      else if (r === 'under') pUnder += p
      else pPush += p
    }
  return { pOver, pUnder, pPush }
}

function calcTGProbs(matrix, line) {
  if (!isQtrLine(line)) return calcTGLine(matrix, line)
  const r1 = calcTGLine(matrix, line - 0.25)
  const r2 = calcTGLine(matrix, line + 0.25)
  return { pOver: (r1.pOver + r2.pOver) / 2, pUnder: (r1.pUnder + r2.pUnder) / 2, pPush: (r1.pPush + r2.pPush) / 2 }
}

const AH_LINES = [
  { val:  2,   label: '+2'     }, { val:  1.75, label: '+1.3/4' },
  { val:  1.5, label: '+1.1/2' }, { val:  1.25, label: '+1.1/4' },
  { val:  1,   label: '+1'     }, { val:  0.75, label: '+3/4'   },
  { val:  0.5, label: '+1/2'   }, { val:  0.25, label: '+1/4'   },
  { val:  0,   label: '0'      }, { val: -0.25, label: '-1/4'   },
  { val: -0.5, label: '-1/2'   }, { val: -0.75, label: '-3/4'   },
  { val: -1,   label: '-1'     }, { val: -1.25, label: '-1.1/4' },
  { val: -1.5, label: '-1.1/2' }, { val: -1.75, label: '-1.3/4' },
  { val: -2,   label: '-2'     },
]

const TG_LINES = [
  { val: 1.5,  label: '1.1/2' }, { val: 1.75, label: '1.3/4' },
  { val: 2,    label: '2'     }, { val: 2.25, label: '2.1/4' },
  { val: 2.5,  label: '2.1/2' }, { val: 2.75, label: '2.3/4' },
  { val: 3,    label: '3'     }, { val: 3.25, label: '3.1/4' },
  { val: 3.5,  label: '3.1/2' }, { val: 3.75, label: '3.3/4' },
  { val: 4,    label: '4'     }, { val: 4.5,  label: '4.1/2' },
]

// ── Shared UI atoms ──────────────────────────────────────────────────────

const EDGE_COLOURS = {
  green: 'var(--color-edge-green)',
  amber: 'var(--color-edge-amber)',
  red:   'var(--color-edge-red)',
}

function EdgeBadge({ edge }) {
  if (edge == null) return null
  const green = edge >= 0.05, amber = edge >= 0 && edge < 0.05
  const col = green ? EDGE_COLOURS.green : amber ? EDGE_COLOURS.amber : EDGE_COLOURS.red
  return (
    <span style={{ fontSize: 11, fontWeight: 700, color: col, padding: '2px 7px', borderRadius: 'var(--radius-full)', background: `${col}22`, border: `0.5px solid ${col}` }}>
      {edge >= 0 ? '+' : ''}{(edge * 100).toFixed(1)}% {green ? '✅ BET' : amber ? '〰 Marginal' : '❌ SKIP'}
    </span>
  )
}

function OddsInput({ value, onChange, placeholder = '—' }) {
  return (
    <input
      type="number" step="0.01" min="1" max="99"
      inputMode="decimal"
      value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
      style={{ width: 70, fontSize: 16, minHeight: 44, textAlign: 'center', padding: '0 6px', borderRadius: 'var(--radius-sm)', background: 'var(--color-bg)', color: 'var(--color-text-primary)', border: '0.5px solid var(--color-border-active)', fontFamily: 'monospace' }}
    />
  )
}

// ── Section header ────────────────────────────────────────────────────────

function SH({ children }) {
  return (
    <span style={{ display: 'block', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--color-accent)', textTransform: 'uppercase', borderBottom: '1px solid var(--color-accent)', paddingBottom: 6, marginBottom: 14 }}>
      {children}
    </span>
  )
}

// ── PASP plan display ─────────────────────────────────────────────────────

function PaspPlanSection({ plan, match, bankroll, odds1x2, lang }) {
  if (!plan) return (
    <p style={{ fontSize: 13, color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
      Stats required for PASP algorithm (MT06)
    </p>
  )

  const bkrl = parseFloat(bankroll)
  const hasBkrl = bkrl > 0

  const homeOdds = parseFloat(odds1x2.home)
  const drawOdds = parseFloat(odds1x2.draw)
  const awayOdds = parseFloat(odds1x2.away)

  const domOdds = plan.dominant === 'home' ? homeOdds : plan.dominant === 'away' ? awayOdds : drawOdds
  const domKelly = domOdds > 1 ? quarterKelly(plan.dominantProb, domOdds) : null

  const anchorBetLabel = `${plan.anchorSide === 'over' ? 'Over' : 'Under'} ${plan.anchorLine}`

  const fracs = [domKelly || 0].filter(f => f > 0)
  const adjFracs = correlatedKelly(fracs)

  const steps = [
    { step: '1', label: 'Anchor Total', value: `${plan.anchorSide === 'over' ? 'Over' : 'Under'} ${plan.anchorLine}`, prob: plan.anchorProb, colour: 'var(--color-accent)' },
    { step: '2', label: 'Dominant Outcome', value: plan.dominantLabel, prob: plan.dominantProb, colour: 'var(--color-info)' },
    { step: '3', label: 'Primary Scoreline', value: plan.primary?.score || '—', prob: plan.primary?.prob || null, colour: '#534AB7' },
    { step: '4', label: 'Hedge Scoreline', value: plan.hedge?.score || '—', prob: plan.hedge?.prob || null, colour: 'var(--color-text-secondary)' },
    { step: '5', label: 'Insurance', value: plan.drawInsurance ? `Draw (${(plan.drawProb * 100).toFixed(1)}% — hedge)` : 'Skip — low draw probability', prob: null, colour: plan.drawInsurance ? 'var(--color-warning)' : 'var(--color-text-muted)' },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {/* Strategy text */}
      <div style={{ background: '#EEEDFE', border: '0.5px solid #534AB7', borderRadius: 'var(--radius-md)', padding: '12px 14px' }}>
        <p style={{ fontSize: 12, color: '#534AB7', lineHeight: 1.6 }}>{paspText(plan, lang)}</p>
      </div>

      {/* Step cards */}
      {steps.map(s => (
        <div key={s.step} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: 'var(--color-bg-card)', border: '0.5px solid var(--color-border)', borderRadius: 'var(--radius-md)' }}>
          <span style={{ fontSize: 11, fontWeight: 800, width: 20, height: 20, borderRadius: '50%', background: s.colour, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{s.step}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 2 }}>{s.label}</p>
            <p style={{ fontSize: 15, fontWeight: 600, color: s.colour }}>{s.value}</p>
          </div>
          {s.prob != null && (
            <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-text-secondary)', flexShrink: 0 }}>
              {(s.prob * 100).toFixed(1)}%
            </span>
          )}
        </div>
      ))}

      {/* Quarter Kelly summary */}
      {hasBkrl && domOdds > 1 && domKelly > 0 && (
        <div style={{ padding: '10px 14px', background: 'var(--color-accent-dim)', border: '0.5px solid var(--color-accent-border)', borderRadius: 'var(--radius-md)' }}>
          <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-accent)', marginBottom: 4 }}>¼ KELLY SIZING</p>
          <p style={{ fontSize: 14, color: 'var(--color-text-primary)' }}>
            {plan.dominantLabel}: ¥{Math.round(domKelly * bkrl).toLocaleString()}
            <span style={{ fontSize: 12, color: 'var(--color-text-muted)', marginLeft: 8 }}>({(domKelly * 100).toFixed(1)}% of ¥{bkrl.toLocaleString()})</span>
          </p>
        </div>
      )}
    </div>
  )
}

// ── 1X2 market section ────────────────────────────────────────────────────

function Market1X2({ model, match, odds, setOdds, bankroll }) {
  const [placed, setPlaced] = useState({})
  const [pending, setPending] = useState(null)
  const { t } = useTranslation()

  const bkrl = parseFloat(bankroll)
  const hasBkrl = bkrl > 0

  const ev1x2 = useMemo(() => {
    if (!model) return null
    const o = { home: parseFloat(odds.home), draw: parseFloat(odds.draw), away: parseFloat(odds.away) }
    if (![o.home, o.draw, o.away].every(v => v > 1)) return null
    const probs = model.v3?.probs || model.v2?.probs
    if (!probs) return null
    try { return analyse1X2(probs, o) } catch { return null }
  }, [model, odds])

  const LABELS = { home: match?.home_team || 'Home', draw: 'Draw', away: match?.away_team || 'Away' }

  const place = async (key) => {
    const amt = bkrl * (ev1x2?.outcomes?.[key]?.stake?.fraction || 0.02)
    if (!(amt > 0)) return
    setPending(null)
    try {
      await placeBet({ matchId: match.id, betType: '1X2', selection: key, odds: parseFloat(odds[key]), stake: amt })
      setPlaced(p => ({ ...p, [key]: true }))
    } catch { setPlaced(p => ({ ...p, [key]: 'error' })) }
  }

  const inp = { width: 80, fontSize: 16, minHeight: 44, textAlign: 'center', padding: '0 6px', borderRadius: 'var(--radius-sm)', background: 'var(--color-bg)', color: 'var(--color-text-primary)', border: '0.5px solid var(--color-border-active)', fontFamily: 'monospace' }

  return (
    <div>
      <SH>1X2 · Match Result</SH>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {['home', 'draw', 'away'].map(key => {
          const probs = model?.v3?.probs || model?.v2?.probs
          const modelP = probs?.[key]
          const oc = ev1x2?.outcomes?.[key]
          const decOdds = parseFloat(odds[key])
          const implied = decOdds > 1 ? 1 / decOdds : null
          const edge = modelP != null && implied != null ? modelP - implied : null
          const stakeAmt = hasBkrl && oc?.stake?.fraction > 0 ? Math.round(oc.stake.fraction * bkrl) : null

          return (
            <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: 'var(--color-bg-card)', border: '0.5px solid var(--color-border)', borderRadius: 'var(--radius-md)', flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text-primary)' }}>{LABELS[key]}</p>
                {modelP != null && (
                  <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
                    V3 {(modelP * 100).toFixed(1)}%
                    {implied != null && ` · Implied ${(implied * 100).toFixed(1)}%`}
                  </p>
                )}
              </div>
              <input
                type="number" step="0.01" min="1" inputMode="decimal"
                value={odds[key]} onChange={e => setOdds(prev => ({ ...prev, [key]: e.target.value }))}
                placeholder="Odds" style={inp}
              />
              {edge != null && <EdgeBadge edge={edge} />}
              {stakeAmt != null && <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text-primary)' }}>¥{stakeAmt.toLocaleString()}</span>}
              {hasBkrl && modelP != null && parseFloat(odds[key]) > 1 && (
                <button
                  onClick={() => placed[key] ? null : place(key)}
                  style={{ minHeight: 36, padding: '0 10px', background: placed[key] === true ? 'var(--color-success)' : placed[key] === 'error' ? 'var(--color-danger)' : 'var(--color-accent)', border: 'none', borderRadius: 'var(--radius-sm)', color: '#fff', fontFamily: 'var(--font-ui)', fontSize: 13, fontWeight: 700, cursor: placed[key] ? 'default' : 'pointer' }}
                >
                  {placed[key] === true ? '✓' : placed[key] === 'error' ? '✗' : t('value.place')}
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Total Goals section ───────────────────────────────────────────────────

function MarketTotalGoals({ model, anchorLine, bankroll }) {
  const [tgLine, setTgLine] = useState(anchorLine || 2.5)
  const [overOdds, setOverOdds] = useState('')
  const [underOdds, setUnderOdds] = useState('')

  const bkrl = parseFloat(bankroll)
  const hasBkrl = bkrl > 0
  const matrix = model?.v3?.matrix || model?.v2?.matrix

  const tg = useMemo(() => matrix ? calcTGProbs(matrix, tgLine) : null, [matrix, tgLine])

  function edgeFor(prob, oddsStr) {
    const o = parseFloat(oddsStr)
    if (!o || !prob || o <= 1) return null
    return prob - 1 / o
  }

  function stakeFor(prob, oddsStr) {
    const o = parseFloat(oddsStr)
    if (!hasBkrl || !prob || !o || o <= 1) return null
    const k = quarterKelly(prob, o)
    return k > 0 ? Math.round(k * bkrl) : null
  }

  const tgLineObj = TG_LINES.find(l => Math.abs(l.val - tgLine) < 0.001) || { label: String(tgLine) }

  return (
    <div>
      <SH>总进球数 · Total Goals</SH>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 14 }}>
        <div>
          <label style={{ fontSize: 11, color: 'var(--color-text-muted)', display: 'block', marginBottom: 4 }}>Goals line</label>
          <select value={tgLine} onChange={e => setTgLine(parseFloat(e.target.value))}
            style={{ fontSize: 16, minHeight: 44, padding: '0 8px', borderRadius: 'var(--radius-sm)', background: 'var(--color-bg)', color: 'var(--color-text-primary)', border: '0.5px solid var(--color-border-active)' }}>
            {TG_LINES.map(l => <option key={l.val} value={l.val}>{l.label}</option>)}
          </select>
        </div>
      </div>

      {tg && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {[
            { label: `Over ${tgLineObj.label}`, prob: tg.pOver, odds: overOdds, setOdds: setOverOdds },
            { label: `Under ${tgLineObj.label}`, prob: tg.pUnder, odds: underOdds, setOdds: setUnderOdds },
          ].map(({ label, prob, odds, setOdds }) => {
            const edge = edgeFor(prob, odds)
            const stake = stakeFor(prob, odds)
            return (
              <div key={label} style={{ flex: 1, minWidth: 140, background: 'var(--color-bg-elevated)', border: '0.5px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text-primary)' }}>{label}</p>
                <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-accent)' }}>Model: {(prob * 100).toFixed(1)}%</p>
                <OddsInput value={odds} onChange={setOdds} />
                {edge != null && <EdgeBadge edge={edge} />}
                {stake != null && <p style={{ fontSize: 13, fontWeight: 700 }}>¥{stake.toLocaleString()}</p>}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Asian Handicap section ────────────────────────────────────────────────

function MarketAsian({ model, match, bankroll }) {
  const [ahLine, setAhLine] = useState(-0.5)
  const [homeOdds, setHomeOdds] = useState('')
  const [awayOdds, setAwayOdds] = useState('')

  const bkrl = parseFloat(bankroll)
  const hasBkrl = bkrl > 0
  const matrix = model?.v3?.matrix || model?.v2?.matrix

  const ah = useMemo(() => matrix ? calcAHProbs(matrix, ahLine) : null, [matrix, ahLine])
  const ahLineObj = AH_LINES.find(l => Math.abs(l.val - ahLine) < 0.001) || { label: String(ahLine) }
  const awayAhObj = AH_LINES.find(l => Math.abs(l.val - (-ahLine)) < 0.001) || { label: String(-ahLine) }

  function edgeFor(prob, oddsStr) {
    const o = parseFloat(oddsStr)
    if (!o || !prob || o <= 1) return null
    return prob - 1 / o
  }

  function stakeFor(prob, oddsStr) {
    const o = parseFloat(oddsStr)
    if (!hasBkrl || !prob || !o || o <= 1) return null
    const k = quarterKelly(prob, o)
    return k > 0 ? Math.round(k * bkrl) : null
  }

  return (
    <div>
      <SH>亚让球 · Asian Handicap</SH>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 14 }}>
        <div>
          <label style={{ fontSize: 11, color: 'var(--color-text-muted)', display: 'block', marginBottom: 4 }}>Handicap line</label>
          <select value={ahLine} onChange={e => setAhLine(parseFloat(e.target.value))}
            style={{ fontSize: 16, minHeight: 44, padding: '0 8px', borderRadius: 'var(--radius-sm)', background: 'var(--color-bg)', color: 'var(--color-text-primary)', border: '0.5px solid var(--color-border-active)' }}>
            {AH_LINES.map(l => <option key={l.val} value={l.val}>{l.label}</option>)}
          </select>
        </div>
      </div>

      {ah && (
        <>
          <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 10 }}>
            <strong>{match?.home_team}</strong> {ahLineObj.label} vs <strong>{match?.away_team}</strong> {awayAhObj.label}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {[
              { label: `${match?.home_team} ${ahLineObj.label}`, prob: ah.pHome, odds: homeOdds, setOdds: setHomeOdds },
              { label: `${match?.away_team} ${awayAhObj.label}`, prob: ah.pAway, odds: awayOdds, setOdds: setAwayOdds },
            ].map(({ label, prob, odds, setOdds }) => {
              const edge = edgeFor(prob, odds)
              const stake = stakeFor(prob, odds)
              return (
                <div key={label} style={{ flex: 1, minWidth: 140, background: 'var(--color-bg-elevated)', border: '0.5px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text-primary)' }}>{label}</p>
                  <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-accent)' }}>Model: {(prob * 100).toFixed(1)}%</p>
                  {ah.pPush > 0.005 && <p style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>Push: {(ah.pPush * 100).toFixed(1)}%</p>}
                  <OddsInput value={odds} onChange={setOdds} />
                  {edge != null && <EdgeBadge edge={edge} />}
                  {stake != null && <p style={{ fontSize: 13, fontWeight: 700 }}>¥{stake.toLocaleString()}</p>}
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

// ── Chinese Handicap 1X2 section (让球胜平负) ──────────────────────────────

function MarketChineseHandicap({ model, match }) {
  const CH_LINES = [-3, -2, -1, 0, 1, 2, 3]
  const [line, setLine] = useState(-1)
  const [oddsH, setOddsH] = useState('')
  const [oddsD, setOddsD] = useState('')
  const [oddsA, setOddsA] = useState('')

  const matrix = model?.v2?.matrix
  let probs = null
  if (matrix) {
    const N = matrix.length
    let pH = 0, pD = 0, pA = 0
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        const diff = i - j
        if (diff > -line) pH += matrix[i][j]
        else if (diff === -line) pD += matrix[i][j]
        else pA += matrix[i][j]
      }
    }
    probs = { pH, pD, pA }
  }

  function edgeFor(p, oddsStr) {
    const o = parseFloat(oddsStr)
    if (!o || !p || o <= 1) return null
    return p - 1 / o
  }

  const lineLabel = line > 0 ? `主让${line}球` : line < 0 ? `客让${-line}球` : '平手'
  const thS = { padding: '5px 8px', fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--color-text-muted)', background: 'var(--color-bg-elevated)', borderBottom: '0.5px solid var(--color-border)', whiteSpace: 'nowrap', textAlign: 'center' }
  const tdS = { padding: '8px 8px', fontSize: 12, borderBottom: '0.5px solid var(--color-border)', textAlign: 'center' }

  return (
    <div>
      <SH>让球胜平负 · Chinese Handicap (彩票)</SH>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
        <label style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>让球盘口：</label>
        <select value={line} onChange={e => setLine(Number(e.target.value))}
          style={{ fontSize: 16, minHeight: 44, padding: '0 8px', borderRadius: 'var(--radius-sm)', background: 'var(--color-bg)', color: 'var(--color-text-primary)', border: '0.5px solid var(--color-border-active)', cursor: 'pointer' }}>
          {CH_LINES.map(l => <option key={l} value={l}>{l > 0 ? `主让${l}` : l < 0 ? `客让${-l}` : '平手 (0)'}</option>)}
        </select>
        <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{lineLabel}</span>
      </div>

      {probs ? (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ ...thS, textAlign: 'left' }}>结果</th>
                <th style={thS}>V2概率</th>
                <th style={thS}>您的赔率</th>
                <th style={thS}>边际</th>
              </tr>
            </thead>
            <tbody>
              {[
                { label: `${match?.home_team} 让球胜`, p: probs.pH, odds: oddsH, set: setOddsH },
                { label: '让球平', p: probs.pD, odds: oddsD, set: setOddsD },
                { label: `${match?.away_team} 让球胜`, p: probs.pA, odds: oddsA, set: setOddsA },
              ].map(row => {
                const edge = edgeFor(row.p, row.odds)
                return (
                  <tr key={row.label}>
                    <td style={{ ...tdS, textAlign: 'left' }}>{row.label}</td>
                    <td style={{ ...tdS, fontFamily: 'monospace' }}>{(row.p * 100).toFixed(1)}%</td>
                    <td style={tdS}>
                      <input type="number" step="0.01" min="1" max="99" value={row.odds} onChange={e => row.set(e.target.value)} placeholder="—"
                        style={{ width: 70, fontSize: 16, minHeight: 44, textAlign: 'center', padding: '0 4px', borderRadius: 4, background: 'var(--color-bg)', color: 'var(--color-text-primary)', border: '0.5px solid var(--color-border)', fontFamily: 'monospace' }} />
                    </td>
                    <td style={tdS}>
                      {edge != null && <EdgeBadge edge={edge} />}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>需要球队统计数据才能计算让球概率。</p>
      )}
    </div>
  )
}

// ── BetsTab ───────────────────────────────────────────────────────────────

export default function BetsTab({ match, sidebarModel, v1x2Odds, setV1x2Odds, isAdmin }) {
  const { t, lang } = useTranslation()
  const [bankroll, setBankroll] = useState('')

  const plan = useMemo(() => buildPaspPlan(sidebarModel, match), [sidebarModel, match])

  // Anchor line from v1 totalGoals (has anchor boolean)
  const anchorLine = sidebarModel?.v1?.totalGoals?.find(g => g.anchor)?.line || 2.5

  const cardStyle = { background: 'var(--color-bg-card)', border: '0.5px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '14px 16px' }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

      {/* ── Bankroll ── */}
      <div style={{ ...cardStyle, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-secondary)', whiteSpace: 'nowrap' }}>
          {t('portfolio.bankroll')} ¥
        </label>
        <input
          type="number" inputMode="decimal" min="0" placeholder="10000" value={bankroll}
          onChange={e => setBankroll(e.target.value)}
          style={{ width: 120, fontSize: 16, minHeight: 44, padding: '0 10px', borderRadius: 'var(--radius-sm)', background: 'var(--color-bg)', color: 'var(--color-text-primary)', border: '0.5px solid var(--color-border-active)' }}
        />
        {parseFloat(bankroll) > 0 && (
          <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>¼ Kelly · 5% cap (MT24)</span>
        )}
      </div>

      {/* ── PASP Strategy ── */}
      <div style={cardStyle}>
        <SH>PASP · Betting Strategy Recommendation</SH>
        <PaspPlanSection plan={plan} match={match} bankroll={bankroll} odds1x2={v1x2Odds} lang={lang} />
      </div>

      {/* ── 1X2 Market ── */}
      <div style={cardStyle}>
        <Market1X2 model={sidebarModel} match={match} odds={v1x2Odds} setOdds={setV1x2Odds} bankroll={bankroll} />
      </div>

      {/* ── Total Goals ── */}
      {sidebarModel && (
        <div style={cardStyle}>
          <MarketTotalGoals model={sidebarModel} anchorLine={anchorLine} bankroll={bankroll} />
        </div>
      )}

      {/* ── Asian Handicap (亚盘) ── */}
      {sidebarModel && (
        <div style={cardStyle}>
          <MarketAsian model={sidebarModel} match={match} bankroll={bankroll} />
        </div>
      )}

      {/* ── Chinese Handicap 彩票 ── */}
      {sidebarModel && (
        <div style={cardStyle}>
          <MarketChineseHandicap model={sidebarModel} match={match} />
        </div>
      )}

      {/* ── Correlation note ── */}
      <p style={{ fontSize: 12, color: 'var(--color-text-muted)', fontStyle: 'italic', textAlign: 'center', padding: '0 8px' }}>
        {t('portfolio.correlated')}
      </p>
    </div>
  )
}
