import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { useUser } from '../../context/UserContext'

// ── PASP v3 Algorithm (pure JS) ──────────────────────────

function stripVig(odds) {
  const raw = { home: 1/odds.home, draw: 1/odds.draw, away: 1/odds.away }
  const vig = raw.home + raw.draw + raw.away
  return { home: raw.home/vig, draw: raw.draw/vig, away: raw.away/vig, vig }
}

function stripVigTotalGoals(tg) {
  const keys = Object.keys(tg)
  const raws = {}
  let vigSum = 0
  for (const k of keys) { raws[k] = 1/Number(tg[k]); vigSum += raws[k] }
  const implied = {}
  for (const k of keys) implied[k] = raws[k] / vigSum
  return implied
}

function getModelAnchor(lh, la) {
  const sum = lh + la
  if (sum < 2.0) return 1
  if (sum < 2.8) return 2
  if (sum < 3.8) return 3
  if (sum < 4.8) return 4
  return 5
}

function getMarketAnchor(implied) {
  let best = '0', bestP = 0
  for (const [k, p] of Object.entries(implied)) {
    if (k === '7plus') continue
    if (p > bestP) { bestP = p; best = k }
  }
  return parseInt(best)
}

function checkR11(modelDominant, marketDominant) {
  return (marketDominant - modelDominant) > 0.15
}

function isDistributionFlat(implied) {
  const probs = Object.entries(implied)
    .filter(([k]) => k !== '7plus')
    .map(([,p]) => p)
    .sort((a,b) => b-a)
    .slice(0, 3)
  return (probs[0] - probs[2]) < 0.03
}

function getBestScoreline(scores, targetTotal, direction) {
  const candidates = []
  for (const [score, odds] of Object.entries(scores)) {
    if (!score.includes('-')) continue
    const [h, a] = score.split('-').map(Number)
    if (h + a !== targetTotal) continue
    const isHome = h > a, isDraw = h === a, isAway = h < a
    if (direction === 'home' && !isHome) continue
    if (direction === 'away' && !isAway) continue
    if (direction === 'draw' && !isDraw) continue
    candidates.push({ score, odds: Number(odds), h, a })
  }
  if (!candidates.length) return null
  candidates.sort((a,b) => a.odds - b.odds)
  return candidates[0]
}

function runPASPv3(oddsData, v3, sessionBudget) {
  if (!oddsData || !v3) return null
  const spf = oddsData.spf
  const scores = oddsData.scores || {}
  const tg = oddsData.totalGoals || {}
  if (!spf || !tg || !spf.home) return null

  const market1X2 = stripVig({
    home: Number(spf.home), draw: Number(spf.draw), away: Number(spf.away),
  })
  const modelDominant = Math.max(v3.home, v3.away)
  const marketDominant = Math.max(market1X2.home, market1X2.away)
  const direction = v3.home >= v3.away && v3.home >= v3.draw ? 'home'
    : v3.away >= v3.home && v3.away >= v3.draw ? 'away' : 'draw'

  const r11Triggered = checkR11(modelDominant, marketDominant)
  const lh = Number(v3.lambdaHome || 1.5)
  const la = Number(v3.lambdaAway || 1.5)
  const modelAnchor = getModelAnchor(lh, la)

  const tgImplied = stripVigTotalGoals(tg)
  const marketAnchor = getMarketAnchor(tgImplied)

  let anchor = marketAnchor
  if (r11Triggered) {
    const r11Anchor = modelAnchor + 1
    if (r11Anchor === marketAnchor || r11Anchor === marketAnchor + 1) anchor = r11Anchor
  }

  const isFlat = isDistributionFlat(tgImplied)

  const primary = getBestScoreline(scores, anchor, direction)
  const insurance1Odds = Number(tg[anchor.toString()])
  const insurance2Total = anchor - 1
  const insurance2AltTotal = anchor + 1
  const ins2OddsLower = Number(tg[insurance2Total.toString()] || 999)
  const ins2OddsUpper = Number(tg[insurance2AltTotal.toString()] || 999)
  const insurance2Total_final = ins2OddsLower <= ins2OddsUpper ? insurance2Total : insurance2AltTotal
  const insurance2Odds = Math.min(ins2OddsLower, ins2OddsUpper)

  let valueBet = null
  if (r11Triggered) {
    valueBet = getBestScoreline(scores, anchor + 1, direction)
    if (valueBet && valueBet.odds > 12) valueBet = null
  }

  const pct = valueBet
    ? { primary: 0.45, ins1: 0.25, ins2: 0.20, value: 0.10 }
    : { primary: 0.50, ins1: 0.30, ins2: 0.20, value: 0 }

  function roundStake(n) { return Math.round(n / 10) * 10 || 10 }

  const legs = []
  if (primary) {
    legs.push({
      role: 'Primary', rolePct: Math.round(pct.primary * 100),
      bet: primary.score, betType: 'correct_score', odds: primary.odds,
      stake: roundStake(sessionBudget * pct.primary),
      homeGoals: primary.h, awayGoals: primary.a, color: '#1A3A6C',
      reason: `Best scoreline at anchor ${anchor}g`,
    })
  }
  if (insurance1Odds && insurance1Odds < 999) {
    legs.push({
      role: 'Insurance 1', rolePct: Math.round(pct.ins1 * 100),
      bet: `Total Goals ${anchor}`, betType: `total_goals_${anchor}`,
      odds: insurance1Odds, stake: roundStake(sessionBudget * pct.ins1),
      homeGoals: null, awayGoals: null, color: '#2D7A4F',
      reason: `Recover cost if score wrong, total right`,
    })
  }
  if (insurance2Odds && insurance2Odds < 999) {
    legs.push({
      role: 'Insurance 2', rolePct: Math.round(pct.ins2 * 100),
      bet: `Total Goals ${insurance2Total_final}`, betType: `total_goals_${insurance2Total_final}`,
      odds: insurance2Odds, stake: roundStake(sessionBudget * pct.ins2),
      homeGoals: null, awayGoals: null, color: '#BA7517',
      reason: `Adjacent total coverage`,
    })
  }
  if (valueBet) {
    legs.push({
      role: 'Value Play', rolePct: 10, bet: valueBet.score,
      betType: 'correct_score', odds: valueBet.odds,
      stake: roundStake(sessionBudget * pct.value),
      homeGoals: valueBet.h, awayGoals: valueBet.a, color: '#C9A84C',
      reason: `R11 value — anchor+1 scoreline`,
    })
  }

  const ins1Leg = legs.find(l => l.role === 'Insurance 1')
  const ins1Coverage = ins1Leg ? (ins1Leg.stake * ins1Leg.odds) / sessionBudget : 0

  return {
    legs, anchor, r11Triggered,
    r11Anchor: r11Triggered ? modelAnchor + 1 : null,
    isFlat, direction,
    modelDominant: Math.round(modelDominant * 100),
    marketDominant: Math.round(marketDominant * 100),
    divergence: Math.round((marketDominant - modelDominant) * 100),
    ins1Coverage: Math.round(ins1Coverage * 100),
    totalStake: legs.reduce((s,l) => s + l.stake, 0),
  }
}

// ── Component ─────────────────────────────────────────────
// (Strategic context helpers moved to PredictionTab.jsx)

// model = sidebarModel from runModels() — has model.v3.probs.{home,draw,away} + lambdaHome/Away
export default function PASPTab({ match, model }) {
  const { user } = useUser()
  const [oddsData, setOddsData] = useState(null)
  const [budget, setBudget] = useState(400)
  const [placing, setPlacing] = useState(false)
  const [placed, setPlaced] = useState(false)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)
  const [aiConf, setAiConf] = useState(null)
  const [calibData, setCalibData] = useState(null)

  useEffect(() => {
    if (!match?.id) return
    supabase
      .from('match_odds')
      .select('odds_data')
      .eq('match_id', match.id)
      .maybeSingle()
      .then(({ data }) => {
        setOddsData(data?.odds_data || null)
        setLoading(false)
      })
  }, [match?.id])

  // AI Role 10 confidence — role_id is the composite role
  useEffect(() => {
    if (!match?.id) return
    supabase.from('role_outputs')
      .select('output_json')
      .eq('match_id', match.id)
      .eq('role_id', '1a064ca4-0fa3-43ec-ba86-264a5665f70e')
      .maybeSingle()
      .then(({ data }) => {
        if (!data?.output_json) { setAiConf(null); return }
        let json = data.output_json
        if (typeof json === 'string') try { json = JSON.parse(json) } catch {}
        setAiConf({ confidence: json?.confidence ?? null, recommendation: json?.recommendation ?? null })
      })
      .catch(() => {})
  }, [match?.id])

  // Direction calibration — all finished predictions with correct_v3 populated
  useEffect(() => {
    supabase.from('model_predictions')
      .select('v3_home_win, v3_draw, v3_away_win, correct_v3')
      .not('v3_lambda_home', 'is', null)
      .not('correct_v3', 'is', null)
      .then(({ data }) => {
        if (!data?.length) { setCalibData(null); return }
        const BUCKETS = [
          { min: 0.30, max: 0.40, label: 'Near even (30–40%)' },
          { min: 0.40, max: 0.50, label: 'Slight edge (40–50%)' },
          { min: 0.50, max: 0.60, label: 'Moderate (50–60%)' },
          { min: 0.60, max: 0.70, label: 'Strong (60–70%)' },
          { min: 0.70, max: 1.01, label: 'Dominant (70%+)' },
        ]
        const buckets = BUCKETS.map(b => {
          const rows = data.filter(r => {
            const dom = Math.max(Number(r.v3_home_win) || 0, Number(r.v3_draw) || 0, Number(r.v3_away_win) || 0)
            return dom >= b.min && dom < b.max
          })
          const n = rows.length
          if (!n) return { ...b, n: 0, actual_rate: null, predicted_rate: null, ci_lower: null, ci_upper: null }
          const actual_rate = rows.filter(r => r.correct_v3).length / n
          const predicted_rate = rows.reduce((s, r) => s + Math.max(Number(r.v3_home_win) || 0, Number(r.v3_draw) || 0, Number(r.v3_away_win) || 0), 0) / n
          const moe = 1.96 * Math.sqrt(actual_rate * (1 - actual_rate) / Math.max(n, 1))
          return { ...b, n, actual_rate, predicted_rate, ci_lower: Math.max(0, actual_rate - moe), ci_upper: Math.min(1, actual_rate + moe) }
        })
        setCalibData(buckets)
      })
      .catch(() => {})
  }, [])

  // Normalise sidebarModel.v3 into the shape runPASPv3 expects
  const v3Normalised = useMemo(() => {
    if (!model?.v3) return null
    return {
      home: model.v3.probs.home,
      draw: model.v3.probs.draw,
      away: model.v3.probs.away,
      lambdaHome: model.v3.lambdaHome,
      lambdaAway: model.v3.lambdaAway,
    }
  }, [model])

  // AI confidence tier — depends on aiConf (async) only
  const aiTier = useMemo(() => {
    if (aiConf?.confidence == null) return null
    const c = aiConf.confidence
    if (c >= 0.75) return { tier: 'HIGH',   label: 'AI HIGH',   sub: 'Full Kelly sizing',               kelly: 1.00, bg: '#2D7A4F', tx: '#fff' }
    if (c >= 0.50) return { tier: 'MEDIUM', label: 'AI MEDIUM', sub: '75% Kelly sizing',                kelly: 0.75, bg: '#BA7517', tx: '#fff' }
    if (c >= 0.30) return { tier: 'LOW',    label: 'AI LOW',    sub: '50% Kelly sizing — caution',      kelly: 0.50, bg: '#C0392B', tx: '#fff' }
    return              { tier: 'SKIP',   label: 'AI SKIP',  sub: 'Insufficient data — do not bet', kelly: 0.00, bg: '#6b7280', tx: '#fff' }
  }, [aiConf])

  const portfolio = useMemo(() => {
    if (!oddsData || !v3Normalised) return null
    return runPASPv3(oddsData, v3Normalised, budget)
  }, [oddsData, v3Normalised, budget])

  async function placeAllBets() {
    if (!portfolio?.legs?.length || !user?.id) return
    setPlacing(true)
    setError(null)
    try {
      const rows = portfolio.legs.map(leg => ({
        user_id: user.id,
        match_id: match.id,
        home_goals: leg.homeGoals,
        away_goals: leg.awayGoals,
        odds: leg.odds,
        stake: leg.stake,
        bet_type: leg.betType,
        status: 'pending',
        selection: leg.bet,
        notes: `PASP v3 ${leg.role} | anchor ${portfolio.anchor}g${portfolio.r11Triggered ? ' R11' : ''} | ${leg.reason}`,
        placed_at: new Date().toISOString(),
      }))
      const { error: err } = await supabase.from('user_bets').insert(rows)
      if (err) throw err
      setPlaced(true)
    } catch (e) {
      setError(e.message)
    } finally {
      setPlacing(false)
    }
  }

  const mono = "'IBM Plex Mono', monospace"
  const panel = {
    background: 'var(--color-bg-card)',
    border: '0.5px solid var(--color-border)',
    borderRadius: 'var(--radius-lg)',
    overflow: 'hidden',
    marginBottom: 12,
  }
  const ph = {
    padding: '9px 14px',
    borderBottom: '0.5px solid var(--color-border)',
    fontSize: 9, fontWeight: 500,
    letterSpacing: '0.10em', textTransform: 'uppercase',
    fontFamily: mono, color: 'var(--color-text-muted)',
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  }

  if (loading) return (
    <div style={{ padding: 24, fontSize: 12, fontFamily: mono, color: 'var(--color-text-muted)' }}>
      Loading odds...
    </div>
  )

  if (!oddsData) return (
    <div style={{ padding: 24 }}>
      <div style={{ fontSize: 13, color: 'var(--color-text-primary)', marginBottom: 8 }}>
        No odds entered for this match
      </div>
      <div style={{ fontSize: 12, color: 'var(--color-text-muted)', lineHeight: 1.6 }}>
        Go to the Bets tab to enter China lottery odds first.
        PASP v3 needs both model predictions and market odds to calculate the portfolio.
      </div>
    </div>
  )

  if (!v3Normalised) return (
    <div style={{ padding: 24, fontSize: 12, color: 'var(--color-text-muted)' }}>
      No V3 predictions yet — fetch stats first to generate predictions.
    </div>
  )

  return (
    <div style={{ padding: '0 0 32px' }}>

      {/* AI Confidence Badge */}
      {aiTier && (() => {
        const rec = aiConf?.recommendation
        const v3Dir = v3Normalised
          ? (v3Normalised.home >= v3Normalised.away && v3Normalised.home >= v3Normalised.draw ? 'home_win'
            : v3Normalised.away >= v3Normalised.draw ? 'away_win' : 'draw')
          : null
        const agrees = rec && v3Dir && (rec === v3Dir)
        const dirLabel = { home_win: 'Home Win', away_win: 'Away Win', draw: 'Draw', over: 'Over', skip: 'Skip' }[rec] || rec
        return (
          <div style={{ ...panel, marginBottom: 14 }}>
            <div style={ph}><span>AI Confidence</span><span style={{ color: '#C9A84C' }}>Role 10</span></div>
            <div style={{ padding: '10px 14px', display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-start', background: aiTier.bg, borderRadius: 6, padding: '6px 12px', minWidth: 100 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: aiTier.tx }}>{aiTier.label}</span>
                <span style={{ fontSize: 11, color: `${aiTier.tx}cc`, marginTop: 2 }}>{aiTier.sub}</span>
              </div>
              {rec && rec !== 'skip' && (
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderRadius: 6, background: 'var(--color-bg-secondary)', border: '0.5px solid var(--color-border)' }}>
                  <span style={{ fontSize: 10, color: 'var(--color-text-muted)', fontFamily: mono }}>Recommends:</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: agrees ? '#2D7A4F' : '#BA7517', fontFamily: mono }}>{dirLabel}</span>
                  {v3Dir && <span style={{ fontSize: 9, color: agrees ? '#2D7A4F' : '#BA7517', fontFamily: mono }}>{agrees ? '✓ agrees V3' : '⚠ differs V3'}</span>}
                </div>
              )}
            </div>
          </div>
        )
      })()}

      {/* Direction Calibration */}
      {calibData && v3Normalised && (() => {
        const dom = Math.max(v3Normalised.home, v3Normalised.draw, v3Normalised.away)
        const bucket = calibData.find(b => dom >= b.min && dom < b.max)
        if (!bucket || bucket.n === 0) return null
        const { actual_rate, predicted_rate, ci_lower, ci_upper, n, label } = bucket
        const diff = actual_rate - predicted_rate
        const arrow = diff > 0.05 ? { ch: '↑', color: '#2D7A4F' } : diff < -0.05 ? { ch: '↓', color: '#C0392B' } : { ch: '=', color: '#BA7517' }
        let signal, stakeNote
        if (actual_rate < 0.5) {
          signal = { label: 'Caution — model and history diverge', color: '#C0392B', bg: 'rgba(192,57,43,0.08)', border: 'rgba(192,57,43,0.25)' }
          stakeNote = 'Review before betting — model and history diverge'
        } else if (ci_lower < 0.5) {
          signal = { label: `Wide uncertainty — small sample (n=${n})`, color: '#BA7517', bg: 'rgba(186,119,23,0.08)', border: 'rgba(186,119,23,0.25)' }
          stakeNote = 'Reduce primary stake 15% — wide CI'
        } else {
          signal = { label: 'Calibration confirms V3 direction', color: '#2D7A4F', bg: 'rgba(45,122,79,0.08)', border: 'rgba(45,122,79,0.25)' }
          stakeNote = 'No calibration adjustment needed'
        }
        return (
          <div style={{ ...panel, marginBottom: 14 }}>
            <div style={ph}><span>Direction Calibration</span><span style={{ color: '#C9A84C' }}>Historical</span></div>
            <div style={{ padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ fontSize: 11, fontFamily: mono, color: 'var(--color-text-primary)' }}>
                  V3 dominant: <strong>{(dom * 100).toFixed(1)}%</strong> · bucket: {label}
                </div>
                <div style={{ fontSize: 11, fontFamily: mono, color: 'var(--color-text-muted)' }}>
                  Calibrated: <strong style={{ color: 'var(--color-text-primary)' }}>{(actual_rate * 100).toFixed(1)}%</strong>
                  <span style={{ color: arrow.color, marginLeft: 4 }}>{arrow.ch}</span>
                  {'  '}CI [{(ci_lower * 100).toFixed(0)}%–{(ci_upper * 100).toFixed(0)}%]
                  {'  '}n={n} matches
                </div>
              </div>
              <div style={{ padding: '6px 10px', borderRadius: 6, background: signal.bg, border: `0.5px solid ${signal.border}`, fontSize: 11, fontWeight: 600, color: signal.color, fontFamily: mono }}>
                {signal.label}
              </div>
              <div style={{ fontSize: 10, color: 'var(--color-text-muted)', fontFamily: mono }}>
                → {stakeNote}
                {n < 5 && <span style={{ color: '#BA7517', marginLeft: 6 }}>(limited data — treat as indicative)</span>}
              </div>
            </div>
          </div>
        )
      })()}

      {/* Budget input */}
      <div style={panel}>
        <div style={ph}>
          <span>Session Budget</span>
          <span style={{ color: '#C9A84C' }}>PASP v3</span>
        </div>
        <div style={{ padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: 'var(--color-text-muted)', fontFamily: mono }}>¥</span>
          {[200, 300, 400, 500, 1000].map(b => (
            <button key={b} onClick={() => { setBudget(b); setPlaced(false) }} style={{
              background: budget === b ? '#1A3A6C' : 'var(--color-bg-secondary)',
              border: `0.5px solid ${budget === b ? '#1A3A6C' : 'var(--color-border)'}`,
              borderRadius: 6, padding: '6px 14px',
              cursor: 'pointer', fontSize: 12, fontFamily: mono, minHeight: 44,
              color: budget === b ? '#fff' : 'var(--color-text-primary)',
            }}>
              {b}
            </button>
          ))}
          <input
            type="number" value={budget}
            onChange={e => { setBudget(Number(e.target.value)); setPlaced(false) }}
            style={{
              width: 80, padding: '6px 10px',
              border: '0.5px solid var(--color-border)',
              borderRadius: 6, fontSize: 13, fontFamily: mono, minHeight: 44,
              background: 'var(--color-bg-secondary)', color: 'var(--color-text-primary)',
            }}
          />
        </div>
      </div>

      {/* Model analysis context */}
      {portfolio && (
        <div style={panel}>
          <div style={ph}><span>Model Analysis</span></div>
          <div style={{ padding: '10px 14px', display: 'flex', flexWrap: 'wrap', gap: 16 }}>
            {[
              { label: 'V3 dominant',    value: `${portfolio.modelDominant}%` },
              { label: 'Market dominant', value: `${portfolio.marketDominant}%` },
              { label: 'Divergence',     value: `${portfolio.divergence}pp`, color: portfolio.r11Triggered ? '#C9A84C' : 'var(--color-text-primary)' },
              { label: 'Anchor',         value: `${portfolio.anchor} goals` },
              { label: 'R11',            value: portfolio.r11Triggered ? 'TRIGGERED ⚡' : 'off', color: portfolio.r11Triggered ? '#C9A84C' : 'var(--color-text-muted)' },
              { label: 'Ins. coverage',  value: `${portfolio.ins1Coverage}%`, color: portfolio.ins1Coverage >= 70 ? '#2D7A4F' : '#BA7517' },
            ].map((item, i) => (
              <div key={i}>
                <div style={{ fontSize: 9, fontFamily: mono, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--color-text-muted)', marginBottom: 3 }}>
                  {item.label}
                </div>
                <div style={{ fontSize: 13, fontFamily: mono, fontWeight: 500, color: item.color || 'var(--color-text-primary)' }}>
                  {item.value}
                </div>
              </div>
            ))}
          </div>
          {portfolio.r11Triggered && (
            <div style={{ margin: '0 14px 10px', padding: '8px 12px', background: 'rgba(201,168,76,0.08)', border: '0.5px solid rgba(201,168,76,0.3)', borderRadius: 6, fontSize: 11, fontFamily: mono, color: '#C9A84C', lineHeight: 1.5 }}>
              ⚡ R11 triggered — market sees dominant team as {portfolio.marketDominant}% vs model {portfolio.modelDominant}%. Anchor shifted up to {portfolio.anchor}g. Value play added at {portfolio.anchor + 1}g.
            </div>
          )}
        </div>
      )}

      {/* Portfolio legs */}
      {portfolio?.legs?.length > 0 && (
        <div style={panel}>
          <div style={ph}>
            <span>PASP v3 Portfolio</span>
            <span style={{ fontFamily: mono, color: '#C9A84C' }}>Total ¥{portfolio.totalStake}</span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr 60px 70px 70px', padding: '7px 14px', fontSize: 9, fontFamily: mono, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--color-text-muted)', borderBottom: '0.5px solid var(--color-border)', background: 'var(--color-bg-secondary)' }}>
            <span>Role</span><span>Bet</span>
            <span style={{ textAlign: 'right' }}>Odds</span>
            <span style={{ textAlign: 'right' }}>Stake</span>
            <span style={{ textAlign: 'right' }}>If wins</span>
          </div>

          {portfolio.legs.map((leg, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '90px 1fr 60px 70px 70px', padding: '10px 14px', alignItems: 'center', borderBottom: i < portfolio.legs.length - 1 ? '0.5px solid var(--color-border)' : 'none' }}>
              <div>
                <span style={{ fontSize: 10, fontWeight: 600, fontFamily: mono, color: leg.color }}>{leg.role}</span>
                <div style={{ fontSize: 9, color: 'var(--color-text-muted)', fontFamily: mono, marginTop: 1 }}>{leg.rolePct}%</div>
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text-primary)' }}>{leg.bet}</div>
                <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 1, lineHeight: 1.3 }}>{leg.reason}</div>
              </div>
              <div style={{ textAlign: 'right', fontSize: 13, fontFamily: mono, fontWeight: 500, color: 'var(--color-text-primary)' }}>{leg.odds}</div>
              <div style={{ textAlign: 'right', fontFamily: mono }}>
                {aiTier && aiTier.kelly !== 1.0 ? (
                  aiTier.kelly === 0 ? (
                    <span style={{ fontSize: 13, color: '#6b7280' }}>—</span>
                  ) : (() => {
                    const adj = Math.round(leg.stake * aiTier.kelly / 10) * 10 || 10
                    return (
                      <>
                        <div style={{ fontSize: 11, color: 'var(--color-text-muted)', textDecoration: 'line-through' }}>¥{leg.stake}</div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text-primary)' }}>¥{adj}</div>
                      </>
                    )
                  })()
                ) : (
                  <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text-primary)' }}>¥{leg.stake}</span>
                )}
              </div>
              <div style={{ textAlign: 'right', fontSize: 12, fontFamily: mono, color: '#2D7A4F' }}>
                {aiTier && aiTier.kelly === 0 ? '—' : (() => {
                  const s = aiTier ? Math.round(leg.stake * aiTier.kelly / 10) * 10 || 10 : leg.stake
                  return `¥${Math.round(s * leg.odds)}`
                })()}
              </div>
            </div>
          ))}

          {/* Kelly modifier note */}
          {aiTier && aiTier.kelly !== 1.0 && (
            <div style={{ padding: '8px 14px', borderTop: '0.5px solid var(--color-border)', fontSize: 10, fontFamily: mono, color: 'var(--color-text-muted)', background: 'var(--color-bg-secondary)' }}>
              Stakes adjusted for AI confidence ({aiTier.label} — ×{aiTier.kelly})
            </div>
          )}

          {/* Payout scenarios */}
          <div style={{ padding: '10px 14px', borderTop: '0.5px solid var(--color-border)', background: 'var(--color-bg-secondary)' }}>
            <div style={{ fontSize: 10, fontFamily: mono, color: 'var(--color-text-muted)', letterSpacing: '0.05em', marginBottom: 6, textTransform: 'uppercase' }}>
              Payout scenarios
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
              {(() => {
                const pr  = portfolio.legs.find(l => l.role === 'Primary')
                const i1  = portfolio.legs.find(l => l.role === 'Insurance 1')
                const i2  = portfolio.legs.find(l => l.role === 'Insurance 2')
                const tot = portfolio.totalStake
                return [
                  { label: 'Primary hits',          desc: 'Score correct',            value: pr && i1 ? Math.round(pr.stake*pr.odds + i1.stake*i1.odds) : pr ? Math.round(pr.stake*pr.odds) : 0 },
                  { label: 'Score wrong, total right', desc: 'Insurance 1 recovers', value: i1 ? Math.round(i1.stake*i1.odds) : 0 },
                  { label: 'Adjacent total',         desc: 'Insurance 2 partial',     value: i2 ? Math.round(i2.stake*i2.odds) : 0 },
                ].map((s, i) => (
                  <div key={i} style={{ background: 'var(--color-bg-card)', border: '0.5px solid var(--color-border)', borderRadius: 6, padding: '8px 10px' }}>
                    <div style={{ fontSize: 9, fontFamily: mono, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>{s.label}</div>
                    <div style={{ fontSize: 14, fontFamily: mono, fontWeight: 600, color: s.value > tot ? '#2D7A4F' : '#BA7517' }}>
                      {s.value > tot ? '+' : ''}¥{s.value - tot}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 2 }}>{s.desc}</div>
                  </div>
                ))
              })()}
            </div>
          </div>
        </div>
      )}

      {/* Place bets button */}
      {portfolio?.legs?.length > 0 && !placed && (
        <button onClick={placeAllBets} disabled={placing} style={{
          width: '100%', padding: '0 16px', minHeight: 52,
          borderRadius: 'var(--radius-lg)', border: 'none',
          cursor: placing ? 'not-allowed' : 'pointer',
          background: placing ? 'var(--color-bg-secondary)' : '#1A3A6C',
          color: placing ? 'var(--color-text-muted)' : '#fff',
          fontSize: 14, fontWeight: 500, fontFamily: mono, letterSpacing: '0.05em',
        }}>
          {placing ? 'Placing bets…' : `Place all ${portfolio.legs.length} bets — ¥${portfolio.totalStake}`}
        </button>
      )}

      {placed && (
        <div style={{ padding: '14px 16px', background: 'rgba(45,122,79,0.08)', border: '0.5px solid rgba(45,122,79,0.3)', borderRadius: 'var(--radius-lg)', fontSize: 13, color: '#2D7A4F', fontFamily: mono, textAlign: 'center' }}>
          ✓ {portfolio.legs.length} bets placed — ¥{portfolio.totalStake} total. View in My Tracker.
        </div>
      )}

      {error && (
        <div style={{ padding: '14px 16px', marginTop: 8, background: 'rgba(121,31,31,0.08)', border: '0.5px solid rgba(121,31,31,0.3)', borderRadius: 'var(--radius-lg)', fontSize: 12, color: '#791F1F', fontFamily: mono }}>
          Error: {error}
        </div>
      )}
    </div>
  )
}
