import { useState, useMemo, useEffect, useRef } from 'react'
import { useTranslation } from '../../lib/i18n'
import { getFlag } from '../../lib/teamFlags'
import { analyse1X2, calcStake, formatProb } from '../../lib/evEngine'
import { placeBet } from '../../lib/bets'
import { buildPaspPlan, paspText, quarterKelly, correlatedKelly, getRangeProbabilities, getChineseHandicapProbs, collectAllBets, buildPortfolio } from '../../utils/pasp'
import { parseIndonesiaOdds } from '../../utils/indonesiaOddsParser'
import InfoTooltip from '../InfoTooltip'
import { supabase } from '../../lib/supabase'

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

// ── China correct score constants ───────────────────────────────────────

const HOME_WIN_SCORES = ['1-0','2-0','2-1','3-0','3-1','3-2','4-0','4-1','4-2','5-0','5-1','5-2']
const DRAW_SCORES     = ['0-0','1-1','2-2','3-3']
const AWAY_WIN_SCORES = ['0-1','0-2','1-2','0-3','1-3','2-3','0-4','1-4','2-4','0-5','1-5','2-5']

const FRANCE_SENEGAL_CS = {
  '1-0':'6.25','2-0':'6.00','2-1':'6.10','3-0':'9.25','3-1':'9.25','3-2':'24.00',
  '4-0':'20.00','4-1':'22.00','4-2':'43.00','5-0':'45.00','5-1':'48.00','5-2':'90.00','胜其它':'32.00',
  '0-0':'13.00','1-1':'7.50','2-2':'17.00','3-3':'55.00','平其它':'300.00',
  '0-1':'19.00','0-2':'50.00','1-2':'21.00','0-3':'165.00','1-3':'85.00','2-3':'70.00',
  '0-4':'500.00','1-4':'400.00','2-4':'300.00','0-5':'900.00','1-5':'800.00','2-5':'800.00','负其它':'350.00',
}

function getScoreProb(matrix, score) {
  if (!matrix) return null
  const [h, a] = score.split('-').map(Number)
  if (isNaN(h) || isNaN(a)) return null
  return matrix[h]?.[a] ?? 0
}

function getOtherProb(matrix, type) {
  if (!matrix) return null
  const N = matrix.length
  let listed = 0, total = 0
  const listed_scores = type === 'home' ? HOME_WIN_SCORES : type === 'draw' ? DRAW_SCORES : AWAY_WIN_SCORES
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const p = matrix[i]?.[j] || 0
      const isHome = i > j, isDraw = i === j, isAway = j > i
      if ((type === 'home' && isHome) || (type === 'draw' && isDraw) || (type === 'away' && isAway)) {
        total += p
        if (listed_scores.includes(`${i}-${j}`)) listed += p
      }
    }
  }
  return Math.max(0, total - listed)
}

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

function OddsInput({ value, onChange, placeholder = '—', style }) {
  const [local, setLocal] = useState(value || '')

  useEffect(() => { setLocal(value || '') }, [value])

  return (
    <input
      type="number"
      inputMode="decimal"
      value={local}
      onChange={e => { setLocal(e.target.value); onChange(e.target.value) }}
      onKeyDown={e => { if (e.key === 'Enter') e.target.blur() }}
      placeholder={placeholder}
      style={{
        width: 70, fontSize: 16, minHeight: 44, textAlign: 'center',
        padding: '0 6px', borderRadius: 'var(--radius-sm)',
        background: 'var(--color-bg)', color: 'var(--color-text-primary)',
        border: '0.5px solid var(--color-border-active)', fontFamily: 'monospace',
        ...style,
      }}
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

function PaspPlanSection({ plan, match, bankroll, odds1x2, lang, topRange }) {
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
    { step: '1', label: 'Anchor Total', value: `${plan.anchorGoal} goals — Over ${plan.anchorLine}`, prob: plan.anchorProb, colour: 'var(--color-accent)' },
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
        {topRange && (
          <p style={{ fontSize: 12, color: '#534AB7', lineHeight: 1.6, marginTop: 4 }}>
            {lang === 'zh'
              ? `进球区间 ${topRange.range} 概率最高，达 ${(topRange.prob * 100).toFixed(1)}%。`
              : `Goal range ${topRange.range} leads at ${(topRange.prob * 100).toFixed(1)}% — consider covering this window.`}
          </p>
        )}
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
              <OddsInput
                value={odds[key] || ''}
                onChange={val => setOdds(prev => ({ ...prev, [key]: val }))}
                placeholder="Odds"
                style={inp}
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

function MarketTotalGoals({ model, tgLine, setTgLine, overOdds, setOverOdds, underOdds, setUnderOdds, bankroll }) {
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

function MarketAsian({ model, match, ahLine, setAhLine, homeOdds, setHomeOdds, awayOdds, setAwayOdds, bankroll }) {
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

function MarketChineseHandicap({ model, match, lang, line, setLine, oddsH, setOddsH, oddsD, setOddsD, oddsA, setOddsA }) {
  const CH_LINES = [-3, -2, -1, 0, 1, 2, 3]
  const H = parseInt(line) || 0
  const home = match?.home_team || '主队'
  const away = match?.away_team || '客队'

  // v3 matrix preferred, fall back to v2
  const matrix = model?.v3?.matrix || model?.v2?.matrix
  const probs = matrix ? getChineseHandicapProbs(matrix, H) : null

  function edgeFor(p, oddsStr) {
    const o = parseFloat(oddsStr)
    if (!o || !p || o <= 1) return null
    return p * o - 1
  }

  // Dynamic labels based on handicap direction
  function rowLabels(H) {
    if (H < 0) {
      const n = Math.abs(H)
      return [`${home}让${n}球胜`, `${home}让${n}球平`, `${home}让${n}球负`]
    }
    if (H > 0) {
      return [`${home}受${H}球胜`, `${home}受${H}球平`, `${home}受${H}球负`]
    }
    return [`${home}平手胜`, '平局', `${away}胜`]
  }

  const [labelH, labelD, labelA] = rowLabels(H)

  // Select option labels: negative line = home is favorite (gives goals)
  function optLabel(l) {
    if (l < 0) return `主让${-l}球 (${l})`
    if (l > 0) return `主受${l}球 (+${l})`
    return '平手 (0)'
  }

  const thS = { padding: '5px 8px', fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--color-text-muted)', background: 'var(--color-bg-elevated)', borderBottom: '0.5px solid var(--color-border)', whiteSpace: 'nowrap', textAlign: 'center' }
  const tdS = { padding: '8px 8px', fontSize: 12, borderBottom: '0.5px solid var(--color-border)', textAlign: 'center' }

  return (
    <div>
      <SH>让球胜平负 · Chinese Handicap (彩票)</SH>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
        <label style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>让球盘口：</label>
        <select value={line} onChange={e => setLine(Number(e.target.value))}
          style={{ fontSize: 16, minHeight: 44, padding: '0 8px', borderRadius: 'var(--radius-sm)', background: 'var(--color-bg)', color: 'var(--color-text-primary)', border: '0.5px solid var(--color-border-active)', cursor: 'pointer' }}>
          {CH_LINES.map(l => <option key={l} value={l}>{optLabel(l)}</option>)}
        </select>
      </div>

      {probs ? (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ ...thS, textAlign: 'left' }}>结果</th>
                <th style={thS}>模型概率</th>
                <th style={thS}>您的赔率</th>
                <th style={thS}>边际 <InfoTooltip title="Edge %" explanation="modelProb × odds − 1. >5% = BET, 0–5% = Marginal, <0 = SKIP." explanationZh="模型概率×赔率−1。>5%=下注，0-5%=边缘，<0=跳过。" lang={lang} /></th>
              </tr>
            </thead>
            <tbody>
              {[
                { label: labelH, p: probs.homeWin, odds: oddsH, set: setOddsH },
                { label: labelD, p: probs.draw,    odds: oddsD, set: setOddsD },
                { label: labelA, p: probs.awayWin, odds: oddsA, set: setOddsA },
              ].map(row => {
                const edge = edgeFor(row.p, row.odds)
                return (
                  <tr key={row.label}>
                    <td style={{ ...tdS, textAlign: 'left' }}>{row.label}</td>
                    <td style={{ ...tdS, fontFamily: 'monospace' }}>{(row.p * 100).toFixed(1)}%</td>
                    <td style={tdS}>
                      <OddsInput value={row.odds} onChange={row.set} />
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

// ── Indonesia paste-and-parse section ────────────────────────────────────

function MarketIndonesia({ model, match, lang, onParsed }) {
  const [rawText, setRawText] = useState('')
  const [parsed, setParsed] = useState(null)

  const matrix = model?.v3?.matrix || model?.v2?.matrix

  function handleParse() {
    const result = parseIndonesiaOdds(rawText, match?.home_team, match?.away_team)
    setParsed(result)
    onParsed?.(result)
  }

  const ahProbs = parsed?.handicap && matrix ? calcAHProbs(matrix, parsed.handicap.line) : null
  const tgProbs = parsed?.totalGoals && matrix ? calcTGProbs(matrix, parsed.totalGoals.line) : null

  const placeholder = `Paste Indonesia odds here...\n\nExample:\n+20 ${match?.home_team || 'Prancis'} -${match?.away_team || 'Senegal'}\nB.2.1/2+20`

  return (
    <div>
      <SH>🇮🇩 {lang === 'zh' ? '印尼赔率（粘贴）' : 'Indonesia Odds (Paste)'}</SH>
      <textarea
        value={rawText}
        onChange={e => setRawText(e.target.value)}
        rows={5}
        placeholder={placeholder}
        style={{ width: '100%', fontSize: 13, fontFamily: 'monospace', borderRadius: 'var(--radius-md)', padding: '10px 12px', background: 'var(--color-bg)', color: 'var(--color-text-primary)', border: '0.5px solid var(--color-border)', resize: 'vertical', boxSizing: 'border-box', display: 'block', lineHeight: 1.5 }}
      />
      <button
        onClick={handleParse}
        disabled={!rawText.trim()}
        style={{ marginTop: 8, width: '100%', minHeight: 44, background: rawText.trim() ? '#1A3A6C' : 'var(--color-bg-elevated)', color: rawText.trim() ? '#fff' : 'var(--color-text-muted)', border: 'none', borderRadius: 'var(--radius-sm)', fontSize: 14, fontWeight: 600, cursor: rawText.trim() ? 'pointer' : 'not-allowed', fontFamily: 'var(--font-ui)' }}
      >
        {lang === 'zh' ? '解析赔率' : 'Parse odds'}
      </button>

      {parsed && (
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>

          {parsed.handicap && ahProbs && (
            <div style={{ background: 'var(--color-bg-elevated)', border: '0.5px solid var(--color-border)', borderRadius: 'var(--radius-sm)', padding: '10px 12px' }}>
              <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--color-text-muted)', marginBottom: 6 }}>ASIAN HANDICAP</p>
              <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 6 }}>
                {lang === 'zh' ? '盘口' : 'Line'}: {parsed.handicap.line || '0 (flat)'}
              </p>
              {parsed.handicap.homeOdds != null && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{match?.home_team} @{parsed.handicap.homeOdds.toFixed(2)}</span>
                  <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Model: {(ahProbs.pHome * 100).toFixed(1)}%</span>
                  <EdgeBadge edge={ahProbs.pHome - 1 / parsed.handicap.homeOdds} />
                </div>
              )}
              {parsed.handicap.awayOdds != null && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{match?.away_team} @{parsed.handicap.awayOdds.toFixed(2)}</span>
                  <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Model: {(ahProbs.pAway * 100).toFixed(1)}%</span>
                  <EdgeBadge edge={ahProbs.pAway - 1 / parsed.handicap.awayOdds} />
                </div>
              )}
            </div>
          )}

          {parsed.totalGoals && tgProbs && (
            <div style={{ background: 'var(--color-bg-elevated)', border: '0.5px solid var(--color-border)', borderRadius: 'var(--radius-sm)', padding: '10px 12px' }}>
              <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--color-text-muted)', marginBottom: 6 }}>TOTAL GOALS</p>
              {(() => {
                const { side, line, odds } = parsed.totalGoals
                const prob = side === 'over' ? tgProbs.pOver : tgProbs.pUnder
                return (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>
                      {side === 'over' ? 'Over' : 'Under'} {line} @{odds.toFixed(2)}
                    </span>
                    <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Model: {(prob * 100).toFixed(1)}%</span>
                    <EdgeBadge edge={prob - 1 / odds} />
                  </div>
                )
              })()}
            </div>
          )}

          {!parsed.handicap && !parsed.totalGoals && (
            <p style={{ fontSize: 12, color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
              {lang === 'zh' ? '未识别到赔率，请检查球队名称是否匹配。' : 'No odds recognised — check that team names appear in the pasted text.'}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

// ── China total goals grid (总进球数) ────────────────────────────────────

const CHINA_GOAL_CELLS = [
  { key: '0', label: '0', goals: 0 },
  { key: '1', label: '1', goals: 1 },
  { key: '2', label: '2', goals: 2 },
  { key: '3', label: '3', goals: 3 },
  { key: '4', label: '4', goals: 4 },
  { key: '5', label: '5', goals: 5 },
  { key: '6', label: '6', goals: 6 },
  { key: '7plus', label: '7+', goals: 7 },
]

function MarketChinaTotalGoals({ model, odds, setOdds, lang }) {
  const totalGoalsDist = model?.v3?.totalGoals || []

  function cellProb(cell) {
    if (!totalGoalsDist.length) return null
    if (cell.key === '7plus') {
      return totalGoalsDist.filter(t => t.goals >= 7).reduce((s, t) => s + t.prob, 0)
    }
    return totalGoalsDist.find(t => t.goals === cell.goals)?.prob ?? 0
  }

  return (
    <div>
      <SH>总进球数 · {lang === 'zh' ? '总进球数（中国彩票）' : 'Total Goals (China Lottery)'}</SH>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4 }}>
        {CHINA_GOAL_CELLS.map(cell => {
          const p = cellProb(cell)
          const o = parseFloat(odds[cell.key])
          const edge = p != null && o > 1 ? p * o - 1 : null
          const borderCol = edge == null ? 'var(--color-border)'
            : edge > 0.05 ? '#2D7A4F' : edge > 0 ? '#D4860A' : '#C0392B'
          const bgCol = edge == null ? 'var(--color-bg-elevated)'
            : edge > 0.05 ? 'rgba(45,122,79,0.08)' : edge > 0 ? 'rgba(212,134,10,0.08)' : 'transparent'
          return (
            <div key={cell.key} style={{ border: `0.5px solid ${borderCol}`, borderRadius: 'var(--radius-sm)', background: bgCol, padding: '6px 4px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
              <span style={{ fontSize: 15, fontWeight: 700, fontFamily: 'var(--font-display)' }}>{cell.label}</span>
              {p != null && <span style={{ fontSize: 9, color: 'var(--color-text-muted)' }}>{(p * 100).toFixed(1)}%</span>}
              <OddsInput
                value={odds[cell.key] || ''}
                onChange={val => setOdds(prev => ({ ...prev, [cell.key]: val }))}
                style={{ width: '100%', maxWidth: 60, fontSize: 12, minHeight: 28, padding: '0 2px', borderRadius: 3, border: '0.5px solid var(--color-border)' }}
              />
              {edge != null && (
                <span style={{ fontSize: 9, fontWeight: 700, color: borderCol }}>
                  {edge >= 0 ? '+' : ''}{(edge * 100).toFixed(1)}%
                </span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── China correct score grid (比分) ──────────────────────────────────────

function MarketChinaCorrectScore({ model, match, odds, setOdds, lang }) {
  const matrix = model?.v3?.matrix || model?.v2?.matrix

  function scoreProb(score) {
    if (!matrix) return null
    if (score === '胜其它') return getOtherProb(matrix, 'home')
    if (score === '平其它') return getOtherProb(matrix, 'draw')
    if (score === '负其它') return getOtherProb(matrix, 'away')
    return getScoreProb(matrix, score)
  }

  function ScoreCell({ score }) {
    const p = scoreProb(score)
    const o = parseFloat(odds[score])
    const edge = p != null && o > 1 ? p - 1 / o : null
    const display = score.includes('-') ? score.replace('-', ':') : score
    const borderCol = edge == null ? 'var(--color-border)'
      : edge > 0.05 ? '#2D7A4F' : edge > 0 ? '#D4860A' : '#C0392B'
    const bgCol = edge == null ? 'var(--color-bg-elevated)'
      : edge > 0.05 ? 'rgba(45,122,79,0.08)' : edge > 0 ? 'rgba(212,134,10,0.08)' : 'transparent'

    return (
      <div style={{ border: `0.5px solid ${borderCol}`, borderRadius: 'var(--radius-sm)', background: bgCol, padding: '5px 3px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, minWidth: 0 }}>
        <span style={{ fontSize: 12, fontWeight: 700, fontFamily: 'var(--font-display)' }}>{display}</span>
        {p != null && <span style={{ fontSize: 9, color: 'var(--color-text-muted)' }}>{(p * 100).toFixed(1)}%</span>}
        <OddsInput
          value={odds[score] || ''}
          onChange={val => setOdds(prev => ({ ...prev, [score]: val }))}
          style={{ width: '100%', maxWidth: 56, fontSize: 12, minHeight: 30, padding: '0 2px', borderRadius: 3, border: '0.5px solid var(--color-border)' }}
        />
        {edge != null && (
          <span style={{ fontSize: 9, fontWeight: 700, color: borderCol }}>
            {edge >= 0 ? '+' : ''}{(edge * 100).toFixed(1)}%
          </span>
        )}
      </div>
    )
  }

  const gridRow6 = { display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 3 }
  const gridRow5 = { display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 3 }

  return (
    <div>
      <SH>比分 · {lang === 'zh' ? '正确比分（中国彩票）' : 'Correct Score (China Lottery)'}</SH>

      <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.05em', color: '#1A3A6C', marginBottom: 4 }}>胜 HOME WINS</p>
      <div style={{ ...gridRow6, marginBottom: 3 }}>
        {HOME_WIN_SCORES.slice(0, 6).map(s => <ScoreCell key={s} score={s} />)}
      </div>
      <div style={{ ...gridRow6, marginBottom: 4 }}>
        {HOME_WIN_SCORES.slice(6).map(s => <ScoreCell key={s} score={s} />)}
      </div>
      <div style={{ marginBottom: 10 }}><ScoreCell score="胜其它" /></div>

      <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.05em', color: 'var(--color-text-muted)', marginBottom: 4 }}>平 DRAWS</p>
      <div style={{ ...gridRow5, marginBottom: 10 }}>
        {[...DRAW_SCORES, '平其它'].map(s => <ScoreCell key={s} score={s} />)}
      </div>

      <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.05em', color: '#C0392B', marginBottom: 4 }}>负 AWAY WINS</p>
      <div style={{ ...gridRow6, marginBottom: 3 }}>
        {AWAY_WIN_SCORES.slice(0, 6).map(s => <ScoreCell key={s} score={s} />)}
      </div>
      <div style={{ ...gridRow6, marginBottom: 4 }}>
        {AWAY_WIN_SCORES.slice(6).map(s => <ScoreCell key={s} score={s} />)}
      </div>
      <div><ScoreCell score="负其它" /></div>

      <p style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 8, fontStyle: 'italic' }}>
        {lang === 'zh' ? '绿色边框 = 正期望值。按照中国彩票APP的顺序输入赔率。' : 'Green border = positive edge. Enter odds matching your China lottery app layout.'}
      </p>
    </div>
  )
}

// ── Best bets summary ─────────────────────────────────────────────────────

function marketBadgeStyle(market) {
  if (market.includes('🇨🇳')) return { background: '#FEE2E2', color: '#C0392B' }
  if (market.includes('🇮🇩')) return { background: '#DBEAFE', color: '#1A3A6C' }
  return { background: 'var(--color-bg-secondary)', color: 'var(--color-text-muted)' }
}

function BestBetsSummary({ bets, bankroll, lang }) {
  if (!bets || !bets.length) return null
  const bkrl = parseFloat(bankroll)
  const hasBkrl = bkrl > 0

  return (
    <div style={{ background: 'var(--color-bg-card)', border: '0.5px solid var(--color-accent-border)', borderRadius: 'var(--radius-md)', padding: '14px 16px' }}>
      <SH>{lang === 'zh' ? '最佳投注推荐' : 'BEST BETS FOR THIS MATCH'}</SH>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {bets.slice(0, 6).map((b, i) => {
          const stakeAmt = hasBkrl && b.edge > 0 ? Math.round(quarterKelly(b.prob, b.odds) * bkrl) : null
          const isGood = b.edge >= 0.05, isFair = b.edge >= 0
          const col = isGood ? 'var(--color-success)' : isFair ? 'var(--color-warning)' : 'var(--color-danger)'
          return (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px', background: isGood ? 'rgba(45,122,79,0.06)' : 'transparent', borderRadius: 'var(--radius-sm)', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 11 }}>{isGood ? '✅' : isFair ? '〰' : '❌'}</span>
              <span style={{ flex: 1, minWidth: 100, fontSize: 12, fontWeight: 500 }}>{b.label}</span>
              {(() => { const bs = marketBadgeStyle(b.market); return <span style={{ fontSize: 10, padding: '1px 5px', borderRadius: 99, background: bs.background, color: bs.color, flexShrink: 0 }}>{b.market}</span> })()}
              <span style={{ fontSize: 11, fontFamily: 'monospace', flexShrink: 0 }}>@{b.odds.toFixed(2)}</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: col, flexShrink: 0 }}>{b.edge >= 0 ? '+' : ''}{(b.edge * 100).toFixed(1)}%</span>
              {stakeAmt != null && stakeAmt > 0 && (
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-accent)', flexShrink: 0 }}>¥{stakeAmt.toLocaleString()}</span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── BetsTab ───────────────────────────────────────────────────────────────

function toBeijingTime(date) {
  return date.toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit' })
}

export default function BetsTab({ match, sidebarModel, v1x2Odds: initialV1x2Odds, setV1x2Odds: setParentV1x2Odds, isAdmin }) {
  const { t, lang } = useTranslation()
  const [bankroll, setBankroll] = useState(() => {
    try { return localStorage.getItem('metis_bankroll') || '10000' } catch { return '10000' }
  })
  const [indoParsed, setIndoParsed] = useState(null)
  const [csOdds, setCsOdds] = useState({})
  const [chinaGoalsOdds, setChinaGoalsOdds] = useState({ '0': '', '1': '', '2': '', '3': '', '4': '', '5': '', '6': '', '7plus': '' })

  // Lifted RSPF state (shared with upload handler)
  const [rspfLine, setRspfLine] = useState(-1)
  const [rspfH, setRspfH] = useState('')
  const [rspfD, setRspfD] = useState('')
  const [rspfA, setRspfA] = useState('')

  // Lifted Indonesia AH state
  const [ahLine, setAhLine] = useState(-0.5)
  const [homeAhOdds, setHomeAhOdds] = useState('')
  const [awayAhOdds, setAwayAhOdds] = useState('')

  // Lifted Indonesia TG state
  const [tgLine, setTgLine] = useState(2.5)
  const [overOdds, setOverOdds] = useState('')
  const [underOdds, setUnderOdds] = useState('')

  // Indonesia paste state
  const [indoPasteText, setIndoPasteText] = useState('')

  // Screenshot upload state
  const [uploadLoading, setUploadLoading] = useState(false)
  const [uploadError, setUploadError] = useState(null)
  const [uploadSuccess, setUploadSuccess] = useState(null)
  const [lastSaved, setLastSaved] = useState(null)
  const [portfolioMode, setPortfolioMode] = useState('balanced')
  const [portfolioOverrides, setPortfolioOverrides] = useState({})
  const [recordingBets, setRecordingBets] = useState(false)
  const [recordSuccess, setRecordSuccess] = useState(null)
  const fileInputRef = useRef(null)
  const isNavigating = useRef(false)

  // Local state for 1X2 odds — avoids desktop timing bug where save effect fires
  // before parent re-render propagates updated prop back to BetsTab.
  const [v1x2Odds, setV1x2Odds] = useState(initialV1x2Odds || { home: '', draw: '', away: '' })

  // Keep parent in sync (for admin Supabase save + sidebar EV display).
  useEffect(() => { setParentV1x2Odds(v1x2Odds) }, [v1x2Odds])

  // Sync non-empty prop changes into local state (e.g. parent DB load).
  // Defined BEFORE restore effect so restore always wins in the same commit phase.
  // Empty-guard skips the navigation reset so localStorage restore isn't overwritten.
  useEffect(() => {
    if (!initialV1x2Odds) return
    if (!initialV1x2Odds.home && !initialV1x2Odds.draw && !initialV1x2Odds.away) return
    setV1x2Odds(initialV1x2Odds)
  }, [initialV1x2Odds])

  // Reset local China state + restore from localStorage when match changes.
  // France/Senegal prefill happens first (as the default), then localStorage overwrites if present.
  useEffect(() => {
    if (!match?.id) return
    isNavigating.current = true

    // Reset all local China odds state to avoid carrying over from previous match
    setRspfLine(-1)
    setRspfH('')
    setRspfD('')
    setRspfA('')
    setCsOdds({})
    setChinaGoalsOdds({ '0': '', '1': '', '2': '', '3': '', '4': '', '5': '', '6': '', '7plus': '' })

    // France vs Senegal hardcoded default (overridden below if localStorage has data)
    if (match.home_team === 'France' && match.away_team === 'Senegal') {
      setCsOdds(FRANCE_SENEGAL_CS)
    }

    try {
      const saved = localStorage.getItem(`metis_odds_${match.id}`)
      if (saved) {
        const parsed = JSON.parse(saved)
        if (Date.now() - parsed.savedAt < 24 * 60 * 60 * 1000) {
          if (parsed.spf) setV1x2Odds(parsed.spf)
          if (parsed.rspf) {
            setRspfLine(parsed.rspf.line ?? -1)
            if (parsed.rspf.home != null) setRspfH(String(parsed.rspf.home))
            if (parsed.rspf.draw != null) setRspfD(String(parsed.rspf.draw))
            if (parsed.rspf.away != null) setRspfA(String(parsed.rspf.away))
          }
          if (parsed.scores) setCsOdds(parsed.scores)
          if (parsed.totalGoals) setChinaGoalsOdds(parsed.totalGoals)
        }
      }
    } catch (err) {
      console.warn('Could not restore odds:', err)
    }

    // Clear flag after React processes all setState calls above
    setTimeout(() => { isNavigating.current = false }, 0)
  }, [match?.id])

  // Auto-save China odds to localStorage only when odds state changes (NOT on match.id change,
  // to avoid writing stale previous-match values under the new match's key).
  useEffect(() => {
    if (!match?.id) return
    if (isNavigating.current) return
    try {
      localStorage.setItem(`metis_odds_${match.id}`, JSON.stringify({
        spf: v1x2Odds,
        rspf: { line: rspfLine, home: rspfH, draw: rspfD, away: rspfA },
        scores: csOdds,
        totalGoals: chinaGoalsOdds,
        savedAt: Date.now(),
      }))
      setLastSaved(new Date())
    } catch (err) {
      console.warn('Could not save odds:', err)
    }
  }, [v1x2Odds, rspfH, rspfD, rspfA, rspfLine, csOdds, chinaGoalsOdds]) // intentionally excludes match?.id

  // Clear stored odds when match is finished
  useEffect(() => {
    if (match?.status === 'finished' && match?.id) {
      localStorage.removeItem(`metis_odds_${match.id}`)
    }
  }, [match?.status])

  // Persist bankroll setting
  useEffect(() => {
    try { localStorage.setItem('metis_bankroll', bankroll) } catch {}
  }, [bankroll])

  const plan = useMemo(() => buildPaspPlan(sidebarModel, match), [sidebarModel, match])

  // Anchor line from v1 totalGoals (has anchor boolean)
  // k_star from v3 distribution (highest prob goals total), betting line = k_star - 0.5
  const v3Goals = sidebarModel?.v3?.totalGoals
  const kStar = v3Goals?.length ? [...v3Goals].sort((a, b) => b.prob - a.prob)[0]?.goals ?? 2 : 2
  const anchorLine = kStar - 0.5
  const topRange = v3Goals?.length ? getRangeProbabilities(v3Goals)[0] : null

  // Score key mapping: Claude returns "1:0" colon format, csOdds uses "1-0" dash format
  function handleParseIndo() {
    const result = parseIndonesiaOdds(indoPasteText, match?.home_team, match?.away_team)
    setIndoParsed(result)
    if (result.handicap) {
      setAhLine(result.handicap.line)
      if (result.handicap.homeOdds) setHomeAhOdds(result.handicap.homeOdds.toFixed(2))
      if (result.handicap.awayOdds) setAwayAhOdds(result.handicap.awayOdds.toFixed(2))
    }
    if (result.totalGoals) {
      setTgLine(result.totalGoals.line)
      if (result.totalGoals.side === 'over') { setOverOdds(result.totalGoals.odds.toFixed(2)); setUnderOdds('') }
      else { setUnderOdds(result.totalGoals.odds.toFixed(2)); setOverOdds('') }
    }
  }

  const COLON_TO_DASH = { '1:0':'1-0','2:0':'2-0','2:1':'2-1','3:0':'3-0','3:1':'3-1','3:2':'3-2','4:0':'4-0','4:1':'4-1','4:2':'4-2','5:0':'5-0','5:1':'5-1','5:2':'5-2','homeOther':'胜其它','0:0':'0-0','1:1':'1-1','2:2':'2-2','3:3':'3-3','drawOther':'平其它','0:1':'0-1','0:2':'0-2','1:2':'1-2','0:3':'0-3','1:3':'1-3','2:3':'2-3','0:4':'0-4','1:4':'1-4','2:4':'2-4','0:5':'0-5','1:5':'1-5','2:5':'2-5','awayOther':'负其它' }

  async function handleImageUpload(e) {
    const file = e.target.files?.[0]
    if (!file) return

    setUploadLoading(true)
    setUploadError(null)
    setUploadSuccess(null)

    try {
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result.split(',')[1])
        reader.onerror = reject
        reader.readAsDataURL(file)
      })

      const mediaType = file.type || 'image/jpeg'
      const { data: { session } } = await supabase.auth.getSession()

      const response = await fetch('/api/extract-odds', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({ image: base64, mediaType, homeTeam: match?.home_team, awayTeam: match?.away_team }),
      })

      if (!response.ok) {
        const err = await response.json()
        throw new Error(err.error || 'Failed to extract odds')
      }

      const parsed = await response.json()
      let filled = 0

      if (parsed.spf) {
        const spf = {}
        if (parsed.spf.home != null) { spf.home = String(parsed.spf.home); filled++ }
        if (parsed.spf.draw != null) { spf.draw = String(parsed.spf.draw); filled++ }
        if (parsed.spf.away != null) { spf.away = String(parsed.spf.away); filled++ }
        if (Object.keys(spf).length) setV1x2Odds(prev => ({ ...prev, ...spf }))
      }

      if (parsed.rspf) {
        if (parsed.rspf.line != null) setRspfLine(parsed.rspf.line)
        if (parsed.rspf.home != null) { setRspfH(String(parsed.rspf.home)); filled++ }
        if (parsed.rspf.draw != null) { setRspfD(String(parsed.rspf.draw)); filled++ }
        if (parsed.rspf.away != null) { setRspfA(String(parsed.rspf.away)); filled++ }
      }

      if (parsed.scores) {
        const newScores = { ...csOdds }
        Object.entries(parsed.scores).forEach(([key, val]) => {
          if (val != null) {
            const dashKey = COLON_TO_DASH[key] ?? key
            newScores[dashKey] = String(val)
            filled++
          }
        })
        setCsOdds(newScores)
      }

      if (parsed.totalGoals) {
        const newGoalsOdds = {}
        Object.entries(parsed.totalGoals).forEach(([k, v]) => {
          if (v != null) { newGoalsOdds[k] = String(v); filled++ }
        })
        if (Object.keys(newGoalsOdds).length) setChinaGoalsOdds(prev => ({ ...prev, ...newGoalsOdds }))
      }

      setUploadSuccess(lang === 'zh' ? `已从截图填入 ${filled} 个赔率` : `Filled ${filled} odds from screenshot`)
      e.target.value = ''
    } catch (err) {
      setUploadError(lang === 'zh' ? `读取失败：${err.message}` : `Failed to read screenshot: ${err.message}`)
    } finally {
      setUploadLoading(false)
    }
  }

  const bestBets = useMemo(() => {
    const bets = []
    const matrix = sidebarModel?.v3?.matrix || sidebarModel?.v2?.matrix
    const v3probs = sidebarModel?.v3?.probs

    // 1X2
    if (v3probs) {
      ['home', 'draw', 'away'].forEach(key => {
        const o = parseFloat(v1x2Odds?.[key])
        const p = v3probs[key]
        if (o > 1 && p) {
          const teamLabel = key === 'home' ? `${match?.home_team || 'Home'} win` : key === 'away' ? `${match?.away_team || 'Away'} win` : 'Draw'
          bets.push({ label: `${teamLabel} · 1X2`, edge: p - 1 / o, odds: o, prob: p, market: '1X2' })
        }
      })
    }

    // Indonesia AH (from lifted state)
    if (matrix) {
      const ah = calcAHProbs(matrix, ahLine)
      const pHomeAh = parseFloat(homeAhOdds)
      const pAwayAh = parseFloat(awayAhOdds)
      const hL = ahLine, aL = -ahLine
      if (pHomeAh > 1) bets.push({ label: `${match?.home_team} ${hL > 0 ? '+' : ''}${hL} · 亚盘`, edge: ah.pHome - 1 / pHomeAh, odds: pHomeAh, prob: ah.pHome, market: '🇮🇩 亚盘' })
      if (pAwayAh > 1) bets.push({ label: `${match?.away_team} ${aL > 0 ? '+' : ''}${aL} · 亚盘`, edge: ah.pAway - 1 / pAwayAh, odds: pAwayAh, prob: ah.pAway, market: '🇮🇩 亚盘' })
      // Indonesia TG
      const tg = calcTGProbs(matrix, tgLine)
      const pOver = parseFloat(overOdds), pUnder = parseFloat(underOdds)
      if (pOver > 1) bets.push({ label: `Over ${tgLine} · 大球`, edge: tg.pOver - 1 / pOver, odds: pOver, prob: tg.pOver, market: '🇮🇩 大球' })
      if (pUnder > 1) bets.push({ label: `Under ${tgLine} · 小球`, edge: tg.pUnder - 1 / pUnder, odds: pUnder, prob: tg.pUnder, market: '🇮🇩 小球' })
    }

    // China correct score
    if (matrix && Object.keys(csOdds).length) {
      Object.entries(csOdds).forEach(([score, oddsStr]) => {
        const o = parseFloat(oddsStr)
        if (!(o > 1)) return
        let prob
        if (score === '胜其它') prob = getOtherProb(matrix, 'home')
        else if (score === '平其它') prob = getOtherProb(matrix, 'draw')
        else if (score === '负其它') prob = getOtherProb(matrix, 'away')
        else prob = getScoreProb(matrix, score)
        if (prob != null) {
          let csLabel
          if (score === '胜其它') csLabel = `${match?.home_team || 'Home'} wins (other) · 比分`
          else if (score === '平其它') csLabel = `Draw (other score) · 比分`
          else if (score === '负其它') csLabel = `${match?.away_team || 'Away'} wins (other) · 比分`
          else {
            const [h, a] = score.split('-').map(Number)
            if (h === a) csLabel = `${h}-${a} Draw · 比分`
            else if (h > a) csLabel = `${h}-${a} ${match?.home_team || 'Home'} · 比分`
            else csLabel = `${h}-${a} ${match?.away_team || 'Away'} · 比分`
          }
          bets.push({ label: csLabel, edge: prob - 1 / o, odds: o, prob, market: '🇨🇳比分' })
        }
      })
    }

    return bets.filter(b => b.edge > -0.5).sort((a, b) => b.edge - a.edge)
  }, [sidebarModel, v1x2Odds, csOdds, chinaGoalsOdds, ahLine, homeAhOdds, awayAhOdds, tgLine, overOdds, underOdds, match, lang])

  const allBets = useMemo(() => collectAllBets({
    v1x2Odds, rspfH, rspfD, rspfA, rspfLine,
    csOdds, chinaGoalsOdds, model: sidebarModel, match,
  }), [v1x2Odds, rspfH, rspfD, rspfA, rspfLine, csOdds, chinaGoalsOdds, sidebarModel, match])

  const basePortfolio = useMemo(() =>
    buildPortfolio(allBets, bankroll, portfolioMode),
    [allBets, bankroll, portfolioMode]
  )

  const portfolio = basePortfolio.map(bet => ({
    ...bet,
    suggestedStake: portfolioOverrides[bet.id] ?? bet.suggestedStake,
  }))

  async function handleRecordPortfolio(bets) {
    setRecordingBets(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.user) throw new Error('Not logged in')
      const rows = bets.map(bet => ({
        user_id: session.user.id,
        match_id: match.id,
        bet_type: bet.marketType,
        selection: bet.label,
        odds: bet.odds,
        stake: portfolioOverrides[bet.id] ?? bet.suggestedStake,
        platform: 'china',
        bet_mode: 'single',
        edge_pct: Math.round(bet.edge * 10000) / 10000,
        model_prob: Math.round(bet.modelProb * 10000) / 10000,
        kelly_stake: bet.suggestedStake,
        status: 'pending',
      }))
      const { error } = await supabase.from('user_bets').insert(rows)
      if (error) throw error
      setRecordSuccess(lang === 'zh' ? `✓ 已记录 ${rows.length} 笔投注` : `✓ ${rows.length} bets recorded`)
      setTimeout(() => setRecordSuccess(null), 3000)
      setPortfolioOverrides({})
    } catch (err) {
      alert(err.message)
    } finally {
      setRecordingBets(false)
    }
  }

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
          <span style={{ fontSize: 11, color: 'var(--color-text-muted)', display: 'inline-flex', alignItems: 'center' }}>
            ¼ Kelly · 5% cap (MT24)
            <InfoTooltip title="Quarter Kelly" explanation="Kelly Criterion stake ÷ 4. Full Kelly maximises log-growth but has high variance; quarter Kelly reduces risk 4×. Hard cap: 5% of bankroll (MT24)." explanationZh="凯利公式投注额÷4。完整凯利最大化对数增长但波动大；四分之一凯利风险降低4倍。硬上限：5%本金(MT24)。" lang={lang} />
          </span>
        )}
      </div>

      {/* ── Best Bets Summary ── */}
      <BestBetsSummary bets={bestBets} bankroll={bankroll} lang={lang} />

      {/* ── PASP Strategy ── */}
      <div style={cardStyle}>
        <SH>PASP · Betting Strategy Recommendation</SH>
        <PaspPlanSection plan={plan} match={match} bankroll={bankroll} odds1x2={v1x2Odds} lang={lang} topRange={topRange} />
      </div>

      {/* ════════════════════════════════════════════════
           🎯  PORTFOLIO SUGGESTION
           ════════════════════════════════════════════════ */}
      {portfolio.length > 0 && (
        <div style={{ border: '0.5px solid var(--color-border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
          {/* Header + mode tabs */}
          <div style={{ background: 'var(--color-bg-secondary)', padding: '10px 14px', borderBottom: '0.5px solid var(--color-border)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-primary)' }}>
                {lang === 'zh' ? '🎯 投注组合建议' : '🎯 PORTFOLIO SUGGESTION'}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {[
                { key: 'balanced',    en: '⚖️ Balanced',     zh: '⚖️ 均衡' },
                { key: 'model',       en: '🏆 Follow Model', zh: '🏆 跟随模型' },
                { key: 'edge',        en: '🎯 Best Edge',    zh: '🎯 最优赔率' },
              ].map(m => (
                <button key={m.key} onClick={() => setPortfolioMode(m.key)} style={{
                  padding: '4px 10px', borderRadius: 99, border: '0.5px solid', fontSize: 11,
                  fontWeight: portfolioMode === m.key ? 600 : 400, cursor: 'pointer',
                  borderColor: portfolioMode === m.key ? '#1A3A6C' : 'var(--color-border)',
                  background: portfolioMode === m.key ? '#1A3A6C' : 'transparent',
                  color: portfolioMode === m.key ? '#fff' : 'var(--color-text-secondary)',
                }}>
                  {lang === 'zh' ? m.zh : m.en}
                </button>
              ))}
            </div>
            <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 6 }}>
              {portfolioMode === 'balanced' && (lang === 'zh' ? '主注跟随模型方向，副注和保险注选最优赔率' : 'Primary follows model direction · secondary & insurance pick best edge')}
              {portfolioMode === 'model'    && (lang === 'zh' ? '只投模型预测方向的结果' : 'Only bet outcomes in the model\'s predicted direction')}
              {portfolioMode === 'edge'     && (lang === 'zh' ? '⚠ 纯数学套利 — 可能与模型方向相反' : '⚠ Pure math arbitrage — may bet against model direction')}
            </div>
          </div>

          {/* Bet rows */}
          {portfolio.map((bet, i) => {
            const roleColour = bet.role === 'primary' ? '#C9A84C' : bet.role === 'secondary' ? '#1A3A6C' : '#2D7A4F'
            const roleLabel = { primary: lang === 'zh' ? '主注' : 'Primary', secondary: lang === 'zh' ? '副注' : 'Secondary', insurance: lang === 'zh' ? '保险' : 'Insurance' }[bet.role] || `#${i+1}`
            const stake = portfolioOverrides[bet.id] ?? bet.suggestedStake
            const potReturn = Math.round(stake * bet.odds)
            const conflictsWithModel = !bet.isModelDirection && portfolioMode !== 'model'
            return (
              <div key={bet.id} style={{ padding: '10px 14px', borderBottom: '0.5px solid var(--color-border)', background: conflictsWithModel ? 'rgba(201,168,76,0.04)' : 'transparent' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 10, fontWeight: 600, padding: '1px 7px', borderRadius: 99, background: roleColour + '20', color: roleColour, flexShrink: 0, minWidth: 42, textAlign: 'center' }}>
                    {roleLabel}
                  </span>
                  <span style={{ flex: 1, fontSize: 12, color: 'var(--color-text-primary)' }}>{bet.label}</span>
                  <span style={{ fontSize: 12, fontFamily: 'monospace', color: 'var(--color-text-secondary)', flexShrink: 0 }}>@{bet.odds.toFixed(2)}</span>
                  <span style={{ fontSize: 11, fontWeight: 600, color: bet.edge > 0.05 ? 'var(--color-edge-green)' : bet.edge > 0 ? 'var(--color-edge-amber)' : 'var(--color-edge-red)', flexShrink: 0, minWidth: 48, textAlign: 'right' }}>
                    {bet.edge > 0 ? '+' : ''}{(bet.edge * 100).toFixed(1)}%
                  </span>
                </div>
                {conflictsWithModel && (
                  <div style={{ fontSize: 10, color: 'var(--color-edge-amber)', marginTop: 4, marginLeft: 50 }}>
                    ⚠ {lang === 'zh' ? '与模型预测方向相反 — 纯赔率机会' : 'Opposite to model direction — pure edge play'}
                  </div>
                )}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, marginLeft: 50 }}>
                  <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{lang === 'zh' ? '投注：' : 'Stake:'}</span>
                  <span style={{ fontSize: 12 }}>¥</span>
                  <input
                    type="number" inputMode="decimal" value={stake}
                    onChange={e => setPortfolioOverrides(prev => ({ ...prev, [bet.id]: parseFloat(e.target.value) || 0 }))}
                    style={{ width: 70, fontSize: 15, fontWeight: 600, textAlign: 'right', border: '0.5px solid var(--color-border)', borderRadius: 'var(--radius-sm)', padding: '4px 8px', background: 'var(--color-bg)', minHeight: 36, color: 'var(--color-text-primary)' }}
                  />
                  <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{lang === 'zh' ? '→ 赢' : '→ win'}</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-edge-green)' }}>¥{potReturn}</span>
                </div>
              </div>
            )
          })}

          {/* Summary + Record button */}
          {(() => {
            const totalStake = portfolio.reduce((s, b) => s + (portfolioOverrides[b.id] ?? b.suggestedStake), 0)
            const bestCase   = portfolio.reduce((s, b) => s + (portfolioOverrides[b.id] ?? b.suggestedStake) * b.odds, 0)
            const ev         = portfolio.reduce((s, b) => s + b.modelProb * (portfolioOverrides[b.id] ?? b.suggestedStake) * b.odds - (portfolioOverrides[b.id] ?? b.suggestedStake), 0)
            return (
              <div style={{ padding: '10px 14px', background: 'var(--color-bg-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  <span>{lang === 'zh' ? '总投注' : 'Total'} <strong>¥{totalStake}</strong></span>
                  <span>{lang === 'zh' ? '最佳回报' : 'Best case'} <strong style={{ color: 'var(--color-edge-green)' }}>¥{Math.round(bestCase)}</strong></span>
                  <span>{lang === 'zh' ? '期望值' : 'EV'} <strong style={{ color: ev > 0 ? 'var(--color-edge-green)' : 'var(--color-edge-red)' }}>{ev > 0 ? '+' : ''}¥{Math.round(ev)}</strong></span>
                </div>
                <button
                  onClick={() => handleRecordPortfolio(portfolio)}
                  disabled={recordingBets}
                  style={{ padding: '8px 16px', background: '#1A3A6C', color: '#fff', border: 'none', borderRadius: 'var(--radius-sm)', fontSize: 12, fontWeight: 600, cursor: recordingBets ? 'not-allowed' : 'pointer', minHeight: 36, opacity: recordingBets ? 0.6 : 1 }}
                >
                  {recordingBets ? (lang === 'zh' ? '记录中...' : 'Recording...') : (lang === 'zh' ? `记录全部 ${portfolio.length} 笔` : `Record all ${portfolio.length} bets`)}
                </button>
              </div>
            )
          })()}

          {recordSuccess && (
            <div style={{ padding: '8px 14px', background: 'var(--color-success-bg, #EAF3DE)', color: 'var(--color-edge-green)', fontSize: 12, fontWeight: 600, textAlign: 'center' }}>
              {recordSuccess}
            </div>
          )}
        </div>
      )}

      {/* ════════════════════════════════════════════════
           🇨🇳  CHINA LOTTERY BLOCK
           ════════════════════════════════════════════════ */}
      <div style={{ border: '0.5px solid var(--color-border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>

        {/* Block header */}
        <div style={{ background: 'var(--color-bg-secondary)', padding: '10px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '0.5px solid var(--color-border)' }}>
          <div>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-primary)' }}>
              🇨🇳 {lang === 'zh' ? '中国彩票' : 'China Lottery'}
            </span>
            {lastSaved && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 3 }}>
                <i className="ti ti-check" aria-hidden="true" style={{ color: 'var(--color-success)', fontSize: 11 }} />
                <span style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>
                  {lang === 'zh' ? `赔率已保存 · ${toBeijingTime(lastSaved)}` : `Odds saved · ${toBeijingTime(lastSaved)}`}
                </span>
              </div>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {uploadSuccess && <span style={{ fontSize: 11, color: 'var(--color-success)' }}><i className="ti ti-check" /> {uploadSuccess}</span>}
            {uploadError && <span style={{ fontSize: 11, color: 'var(--color-danger)' }}>{uploadError}</span>}
            <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleImageUpload} />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadLoading}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px', fontSize: 11, fontWeight: 600, background: '#1A3A6C', color: '#fff', border: 'none', borderRadius: 'var(--radius-sm)', cursor: uploadLoading ? 'not-allowed' : 'pointer', minHeight: 30, opacity: uploadLoading ? 0.6 : 1 }}
            >
              {uploadLoading
                ? <><i className="ti ti-loader-2" style={{ animation: 'spin 1s linear infinite' }} /> {lang === 'zh' ? '读取中...' : 'Reading...'}</>
                : <><i className="ti ti-camera" /> {lang === 'zh' ? '上传截图' : 'Upload photo'}</>}
            </button>
          </div>
        </div>

        {/* 1. 胜平负 */}
        <div style={{ padding: 14, borderBottom: '0.5px solid var(--color-border-light)' }}>
          <Market1X2 model={sidebarModel} match={match} odds={v1x2Odds} setOdds={setV1x2Odds} bankroll={bankroll} />
        </div>

        {/* 2. 让球胜平负 */}
        {sidebarModel && (
          <div style={{ padding: 14, borderBottom: '0.5px solid var(--color-border-light)' }}>
            <MarketChineseHandicap
              model={sidebarModel} match={match} lang={lang}
              line={rspfLine} setLine={setRspfLine}
              oddsH={rspfH} setOddsH={setRspfH}
              oddsD={rspfD} setOddsD={setRspfD}
              oddsA={rspfA} setOddsA={setRspfA}
            />
          </div>
        )}

        {/* 3. 比分 */}
        {sidebarModel && (
          <div style={{ padding: 14, borderBottom: '0.5px solid var(--color-border-light)' }}>
            <MarketChinaCorrectScore model={sidebarModel} match={match} odds={csOdds} setOdds={setCsOdds} lang={lang} />
          </div>
        )}

        {/* 4. 总进球数 */}
        {sidebarModel && (
          <div style={{ padding: 14 }}>
            <MarketChinaTotalGoals model={sidebarModel} odds={chinaGoalsOdds} setOdds={setChinaGoalsOdds} lang={lang} />
          </div>
        )}
      </div>

      {/* ════════════════════════════════════════════════
           🇮🇩  INDONESIA BLOCK
           ════════════════════════════════════════════════ */}
      <div style={{ border: '0.5px solid var(--color-border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>

        {/* Block header */}
        <div style={{ background: 'var(--color-bg-secondary)', padding: '10px 14px', borderBottom: '0.5px solid var(--color-border)' }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-primary)' }}>
            🇮🇩 {lang === 'zh' ? '印尼盘' : 'Indonesia'}
          </span>
        </div>

        {/* Paste textarea */}
        <div style={{ padding: '12px 14px', borderBottom: '0.5px solid var(--color-border-light)' }}>
          <textarea
            value={indoPasteText}
            onChange={e => setIndoPasteText(e.target.value)}
            rows={4}
            placeholder={lang === 'zh'
              ? `粘贴印尼盘赔率...\n\n示例：\n+20 ${match?.home_team || 'Prancis'} -${match?.away_team || 'Senegal'}\nB.2.1/2+20`
              : `Paste Indonesia odds here...\n\nExample:\n+20 ${match?.home_team || 'Prancis'} -${match?.away_team || 'Senegal'}\nB.2.1/2+20`}
            style={{ width: '100%', fontSize: 13, fontFamily: 'monospace', borderRadius: 'var(--radius-md)', padding: '8px 10px', background: 'var(--color-bg)', color: 'var(--color-text-primary)', border: '0.5px solid var(--color-border)', resize: 'vertical', boxSizing: 'border-box', display: 'block', lineHeight: 1.5, marginBottom: 8 }}
          />
          <button
            onClick={handleParseIndo}
            disabled={!indoPasteText.trim()}
            style={{ minHeight: 36, padding: '0 14px', background: indoPasteText.trim() ? '#1A3A6C' : 'var(--color-bg-elevated)', color: indoPasteText.trim() ? '#fff' : 'var(--color-text-muted)', border: 'none', borderRadius: 'var(--radius-sm)', fontSize: 13, fontWeight: 600, cursor: indoPasteText.trim() ? 'pointer' : 'not-allowed', fontFamily: 'var(--font-ui)' }}
          >
            <i className="ti ti-clipboard-check" /> {lang === 'zh' ? '解析赔率' : 'Parse odds'}
          </button>
        </div>

        {/* 1. 亚让球 */}
        {sidebarModel && (
          <div style={{ padding: 14, borderBottom: '0.5px solid var(--color-border-light)' }}>
            <MarketAsian
              model={sidebarModel} match={match} bankroll={bankroll}
              ahLine={ahLine} setAhLine={setAhLine}
              homeOdds={homeAhOdds} setHomeOdds={setHomeAhOdds}
              awayOdds={awayAhOdds} setAwayOdds={setAwayAhOdds}
            />
          </div>
        )}

        {/* 2. 大小球 */}
        {sidebarModel && (
          <div style={{ padding: 14 }}>
            <MarketTotalGoals
              model={sidebarModel} bankroll={bankroll}
              tgLine={tgLine} setTgLine={setTgLine}
              overOdds={overOdds} setOverOdds={setOverOdds}
              underOdds={underOdds} setUnderOdds={setUnderOdds}
            />
          </div>
        )}
      </div>

      {/* ── Correlation note ── */}
      <p style={{ fontSize: 12, color: 'var(--color-text-muted)', fontStyle: 'italic', textAlign: 'center', padding: '0 8px' }}>
        {t('portfolio.correlated')}
      </p>
    </div>
  )
}
