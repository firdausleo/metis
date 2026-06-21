import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { useUser } from '../../context/UserContext'
import { poissonPMF, SCORE_MAX } from '../../lib/poisson'

// ── Follow Model: matrix-based portfolio selection ────────────────────────
// Uses V3 matrix (65% DC-corrected Poisson + 35% pure Poisson, rho=-0.0612)
// to select scorelines from model probability, NOT market odds rankings.

function computeFollowModelPortfolio(lh, la, oddsData, budget) {
  const N = SCORE_MAX + 1           // 9×9 matrix
  const rho = -0.0612
  function roundStake(n) { return Math.round(n / 10) * 10 || 10 }

  // V1: pure Poisson
  const v1 = Array.from({ length: N }, (_, i) =>
    Array.from({ length: N }, (_, j) => poissonPMF(i, lh) * poissonPMF(j, la))
  )

  // DC: V1 × tau, then normalise
  const dc = v1.map((row, i) => row.map((v, j) => {
    let tau = 1
    if      (i === 0 && j === 0) tau = 1 - lh * la * rho
    else if (i === 1 && j === 0) tau = 1 + la * rho
    else if (i === 0 && j === 1) tau = 1 + lh * rho
    else if (i === 1 && j === 1) tau = 1 - rho
    return v * tau
  }))
  const dcSum = dc.flat().reduce((s, v) => s + v, 0)
  const dcN   = dc.map(row => row.map(v => v / dcSum))

  // V3: 0.65*DC + 0.35*V1, then normalise
  const v3 = v1.map((row, i) => row.map((v, j) => 0.65 * dcN[i][j] + 0.35 * v))
  const v3Sum = v3.flat().reduce((s, v) => s + v, 0)
  const v3N   = v3.map(row => row.map(v => v / v3Sum))

  // Total goals P(k) for k=0..8 (cap beyond 8 into bucket 8)
  const pg = new Array(9).fill(0)
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    pg[Math.min(i + j, 8)] += v3N[i][j]
  }

  // Anchor = argmax P(k)
  let anchor = 0
  for (let k = 1; k <= 8; k++) if (pg[k] > pg[anchor]) anchor = k

  // Direction from matrix
  let homeWin = 0, draw = 0, awayWin = 0
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    if (i > j) homeWin += v3N[i][j]
    else if (i === j) draw += v3N[i][j]
    else awayWin += v3N[i][j]
  }
  const dominant = homeWin >= awayWin && homeWin >= draw ? 'home'
    : awayWin >= homeWin && awayWin >= draw ? 'away' : 'draw'

  // Primary: highest V3[x][y] at anchor total in dominant direction
  let pX = -1, pY = -1, pProb = 0
  for (let x = 0; x < N; x++) for (let y = 0; y < N; y++) {
    if (x + y !== anchor) continue
    const dir = x > y ? 'home' : x < y ? 'away' : 'draw'
    if (dir !== dominant) continue
    if (v3N[x][y] > pProb) { pProb = v3N[x][y]; pX = x; pY = y }
  }
  // Fallback: best in any direction at anchor total
  if (pX === -1) {
    for (let x = 0; x < N; x++) for (let y = 0; y < N; y++) {
      if (x + y !== anchor) continue
      if (v3N[x][y] > pProb) { pProb = v3N[x][y]; pX = x; pY = y }
    }
  }

  // Insurance 2 total: whichever adjacent is more likely
  const pMinus = anchor > 0 ? pg[anchor - 1] : 0
  const pPlus  = anchor < 8 ? pg[anchor + 1] : 0
  const ins2Total = pMinus > pPlus ? anchor - 1 : anchor + 1

  const tg     = oddsData?.totalGoals || {}
  const scores = oddsData?.scores     || {}

  const legs = []

  // Primary leg — pick scoreline from matrix, use market odds for edge only
  if (pX >= 0) {
    const scoreKey = `${pX}-${pY}`
    const mktOdds  = Number(scores[scoreKey]) || null
    const edge     = mktOdds ? (pProb * mktOdds) - 1 : null
    legs.push({
      role: 'Primary', rolePct: 50,
      bet: scoreKey, betType: 'correct_score',
      odds: mktOdds, stake: roundStake(budget * 0.50),
      homeGoals: pX, awayGoals: pY, color: '#1A3A6C',
      reason: `Matrix peak ${(pProb * 100).toFixed(1)}% at ${anchor}g anchor · ${dominant} win`,
      edge,
    })
  }

  // Insurance 1: Total Goals = anchor
  const i1Odds = Number(tg[String(anchor)]) || null
  if (i1Odds && i1Odds > 1) {
    legs.push({
      role: 'Insurance 1', rolePct: 30,
      bet: `Total Goals ${anchor}`, betType: `total_goals_${anchor}`,
      odds: i1Odds, stake: roundStake(budget * 0.30),
      homeGoals: null, awayGoals: null, color: '#2D7A4F',
      reason: `Recover cost if score wrong, total ${anchor}g right`,
      edge: null,
    })
  }

  // Insurance 2: adjacent total
  const i2Odds = Number(tg[String(ins2Total)]) || null
  if (i2Odds && i2Odds > 1) {
    legs.push({
      role: 'Insurance 2', rolePct: 20,
      bet: `Total Goals ${ins2Total}`, betType: `total_goals_${ins2Total}`,
      odds: i2Odds, stake: roundStake(budget * 0.20),
      homeGoals: null, awayGoals: null, color: '#BA7517',
      reason: `Adjacent total coverage`,
      edge: null,
    })
  }

  const ins1Leg      = legs.find(l => l.role === 'Insurance 1')
  const totalStake   = legs.reduce((s, l) => s + l.stake, 0)
  const ins1Coverage = ins1Leg && totalStake > 0
    ? Math.round((ins1Leg.stake * ins1Leg.odds) / totalStake * 100)
    : 0

  return {
    legs, anchor, dominant,
    homeWin: Math.round(homeWin * 100),
    drawPct: Math.round(draw * 100),
    awayWin: Math.round(awayWin * 100),
    primaryProb: pX >= 0 ? +(pProb * 100).toFixed(1) : null,
    ins2Total, totalStake,
    ins1Coverage,
    r11Triggered: false,
  }
}

// ── Component ─────────────────────────────────────────────────────────────

export default function PASPTab({ match, model }) {
  const { user } = useUser()
  const [oddsData,  setOddsData]  = useState(null)
  const [budget,    setBudget]    = useState(400)
  const [placing,   setPlacing]   = useState(false)
  const [placed,    setPlaced]    = useState(false)
  const [error,     setError]     = useState(null)
  const [loading,   setLoading]   = useState(true)
  const [aiConf,    setAiConf]    = useState(null)
  const [calibData, setCalibData] = useState(null)
  const [modelPred, setModelPred] = useState(null)
  const [predLoading, setPredLoading] = useState(true)

  // Market odds
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

  // V3 lambdas from model_predictions
  useEffect(() => {
    if (!match?.id) return
    supabase.from('model_predictions')
      .select('v3_lambda_home, v3_lambda_away')
      .eq('match_id', match.id)
      .maybeSingle()
      .then(({ data }) => {
        setModelPred(data || null)
        setPredLoading(false)
      })
      .catch(() => setPredLoading(false))
  }, [match?.id])

  // AI Role 10 confidence
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

  // Direction calibration — historical model_predictions
  useEffect(() => {
    supabase.from('model_predictions')
      .select('v3_home_win, v3_draw, v3_away_win, correct_v3')
      .not('v3_lambda_home', 'is', null)
      .not('correct_v3', 'is', null)
      .eq('model_version', 'v3-dc-only')
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

  // V3 normalised from sidebarModel — used for AI badge direction comparison
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

  // AI confidence tier
  const aiTier = useMemo(() => {
    if (aiConf?.confidence == null) return null
    const c = aiConf.confidence
    if (c >= 0.75) return { tier: 'HIGH',   label: 'AI HIGH ↑',   sub: 'Full Kelly — strong signal',    kelly: 1.00, bg: '#166534', tx: '#fff' }
    if (c >= 0.50) return { tier: 'MEDIUM', label: 'AI MEDIUM ~', sub: '75% Kelly — moderate signal',  kelly: 0.75, bg: '#92400E', tx: '#fff' }
    if (c >= 0.30) return { tier: 'LOW',    label: 'AI LOW ↓',    sub: '50% Kelly — weak signal',      kelly: 0.50, bg: '#991B1B', tx: '#fff' }
    return              { tier: 'SKIP',   label: 'AI SKIP —',  sub: 'No bet — insufficient data',  kelly: 0.00, bg: '#374151', tx: '#fff' }
  }, [aiConf])

  // Follow Model portfolio — matrix-based, uses DB lambdas
  const followPortfolio = useMemo(() => {
    if (!oddsData || !modelPred?.v3_lambda_home || !modelPred?.v3_lambda_away) return null
    const lh = Number(modelPred.v3_lambda_home)
    const la = Number(modelPred.v3_lambda_away)
    if (!lh || !la) return null
    return computeFollowModelPortfolio(lh, la, oddsData, budget)
  }, [oddsData, modelPred, budget])

  async function placeAllBets() {
    if (!followPortfolio?.legs?.length || !user?.id) return
    setPlacing(true)
    setError(null)
    try {
      const rows = followPortfolio.legs
        .filter(leg => leg.odds && leg.odds > 1)
        .map(leg => ({
          user_id: user.id,
          match_id: match.id,
          home_goals: leg.homeGoals,
          away_goals: leg.awayGoals,
          odds: leg.odds,
          stake: leg.stake,
          bet_type: leg.betType,
          status: 'pending',
          selection: leg.bet,
          notes: `PASP v3 ${leg.role} | anchor ${followPortfolio.anchor}g | ${leg.reason}`,
          placed_at: new Date().toISOString(),
        }))
      if (!rows.length) throw new Error('No legs with market odds to place')
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

  if (loading || predLoading) return (
    <div style={{ padding: 24, fontSize: 12, fontFamily: mono, color: 'var(--color-text-muted)' }}>
      Loading…
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

  if (!modelPred?.v3_lambda_home || !modelPred?.v3_lambda_away) return (
    <div style={{ padding: 24, fontSize: 12, color: 'var(--color-text-muted)', fontFamily: mono }}>
      Sync stats first to use Follow Model — no V3 lambdas available
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
        const showDir = rec && !['skip', 'over'].includes(rec)
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
            <div style={{ padding: '4px 10px', borderRadius: 4, background: aiTier.bg, fontFamily: 'DM Sans, sans-serif', fontSize: 12, fontWeight: 600, color: aiTier.tx, whiteSpace: 'nowrap' }}>
              {aiTier.label}
            </div>
            <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{aiTier.sub}</span>
            {showDir && (
              <div style={{ padding: '4px 8px', borderRadius: 4, border: '0.5px solid var(--color-border)', fontFamily: mono, fontSize: 11, fontWeight: 600, color: agrees ? '#2D7A4F' : '#BA7517', whiteSpace: 'nowrap' }}>
                AI: {rec}{' '}
                <span style={{ fontWeight: 400, fontSize: 10 }}>{agrees ? '✓ V3' : '⚠ ≠V3'}</span>
              </div>
            )}
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

      {/* Model Analysis */}
      {followPortfolio && (
        <div style={panel}>
          <div style={ph}><span>Model Analysis</span><span style={{ color: '#C9A84C' }}>V3 Matrix</span></div>
          <div style={{ padding: '10px 14px', display: 'flex', flexWrap: 'wrap', gap: 16 }}>
            {[
              { label: 'λ Home',      value: Number(modelPred.v3_lambda_home).toFixed(2) },
              { label: 'λ Away',      value: Number(modelPred.v3_lambda_away).toFixed(2) },
              { label: 'Anchor',      value: `${followPortfolio.anchor} goals` },
              { label: 'Direction',   value: followPortfolio.dominant, color: followPortfolio.dominant === 'home' ? '#1A3A6C' : followPortfolio.dominant === 'away' ? '#C0392B' : '#BA7517' },
              { label: 'Primary prob', value: followPortfolio.primaryProb != null ? `${followPortfolio.primaryProb}%` : '—' },
              { label: 'Ins. coverage', value: `${followPortfolio.ins1Coverage}%`, color: followPortfolio.ins1Coverage >= 70 ? '#2D7A4F' : '#BA7517' },
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
          <div style={{ padding: '6px 14px 10px', fontSize: 10, fontFamily: mono, color: 'var(--color-text-muted)' }}>
            H {followPortfolio.homeWin}% · D {followPortfolio.drawPct}% · A {followPortfolio.awayWin}%
            {' · '}Scoreline selected from matrix probability — not market odds ranking
          </div>
        </div>
      )}

      {/* Portfolio legs */}
      {followPortfolio?.legs?.length > 0 && (
        <div style={panel}>
          <div style={ph}>
            <span>PASP v3 Portfolio</span>
            <span style={{ fontFamily: mono, color: '#C9A84C' }}>Total ¥{followPortfolio.totalStake}</span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr 60px 70px 70px', padding: '7px 14px', fontSize: 9, fontFamily: mono, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--color-text-muted)', borderBottom: '0.5px solid var(--color-border)', background: 'var(--color-bg-secondary)' }}>
            <span>Role</span><span>Bet</span>
            <span style={{ textAlign: 'right' }}>Odds</span>
            <span style={{ textAlign: 'right' }}>Stake</span>
            <span style={{ textAlign: 'right' }}>If wins</span>
          </div>

          {followPortfolio.legs.map((leg, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '90px 1fr 60px 70px 70px', padding: '10px 14px', alignItems: 'center', borderBottom: i < followPortfolio.legs.length - 1 ? '0.5px solid var(--color-border)' : 'none' }}>
              <div>
                <span style={{ fontSize: 10, fontWeight: 600, fontFamily: mono, color: leg.color }}>{leg.role}</span>
                <div style={{ fontSize: 9, color: 'var(--color-text-muted)', fontFamily: mono, marginTop: 1 }}>{leg.rolePct}%</div>
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text-primary)' }}>{leg.bet}</div>
                <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 1, lineHeight: 1.3 }}>{leg.reason}</div>
                {leg.edge != null && (
                  <div style={{ fontSize: 9, fontFamily: mono, marginTop: 2, color: leg.edge >= 0.05 ? '#2D7A4F' : leg.edge >= 0 ? '#BA7517' : '#C0392B' }}>
                    edge {leg.edge >= 0 ? '+' : ''}{(leg.edge * 100).toFixed(1)}%
                  </div>
                )}
              </div>
              <div style={{ textAlign: 'right', fontSize: 13, fontFamily: mono, fontWeight: 500, color: leg.odds ? 'var(--color-text-primary)' : 'var(--color-text-muted)' }}>
                {leg.odds ? leg.odds : '—'}
              </div>
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
              <div style={{ textAlign: 'right', fontSize: 12, fontFamily: mono, color: leg.odds ? '#2D7A4F' : 'var(--color-text-muted)' }}>
                {!leg.odds ? '—' : aiTier && aiTier.kelly === 0 ? '—' : (() => {
                  const s = aiTier ? Math.round(leg.stake * aiTier.kelly / 10) * 10 || 10 : leg.stake
                  return `¥${Math.round(s * leg.odds)}`
                })()}
              </div>
            </div>
          ))}

          {/* Kelly modifier note */}
          {aiTier && aiTier.kelly !== 1.0 && (
            <div style={{ padding: '8px 14px', borderTop: '0.5px solid var(--color-border)', fontSize: 10, fontFamily: mono, color: 'var(--color-text-muted)', background: 'var(--color-bg-secondary)' }}>
              AI confidence: {aiTier.tier} · Stakes × {aiTier.kelly}
            </div>
          )}

          {/* Payout scenarios */}
          <div style={{ padding: '10px 14px', borderTop: '0.5px solid var(--color-border)', background: 'var(--color-bg-secondary)' }}>
            <div style={{ fontSize: 10, fontFamily: mono, color: 'var(--color-text-muted)', letterSpacing: '0.05em', marginBottom: 6, textTransform: 'uppercase' }}>
              Payout scenarios
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
              {(() => {
                const pr  = followPortfolio.legs.find(l => l.role === 'Primary')
                const i1  = followPortfolio.legs.find(l => l.role === 'Insurance 1')
                const i2  = followPortfolio.legs.find(l => l.role === 'Insurance 2')
                const tot = followPortfolio.totalStake
                return [
                  { label: 'Primary hits',             desc: 'Score correct',            value: pr?.odds && i1?.odds ? Math.round(pr.stake * pr.odds + i1.stake * i1.odds) : pr?.odds ? Math.round(pr.stake * pr.odds) : 0 },
                  { label: 'Score wrong, total right',  desc: 'Insurance 1 recovers',     value: i1?.odds ? Math.round(i1.stake * i1.odds) : 0 },
                  { label: 'Adjacent total',            desc: 'Insurance 2 partial',      value: i2?.odds ? Math.round(i2.stake * i2.odds) : 0 },
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
      {followPortfolio?.legs?.length > 0 && !placed && (
        <button onClick={placeAllBets} disabled={placing} style={{
          width: '100%', padding: '0 16px', minHeight: 52,
          borderRadius: 'var(--radius-lg)', border: 'none',
          cursor: placing ? 'not-allowed' : 'pointer',
          background: placing ? 'var(--color-bg-secondary)' : '#1A3A6C',
          color: placing ? 'var(--color-text-muted)' : '#fff',
          fontSize: 14, fontWeight: 500, fontFamily: mono, letterSpacing: '0.05em',
        }}>
          {placing ? 'Placing bets…' : `Place all ${followPortfolio.legs.length} bets — ¥${followPortfolio.totalStake}`}
        </button>
      )}

      {placed && (
        <div style={{ padding: '14px 16px', background: 'rgba(45,122,79,0.08)', border: '0.5px solid rgba(45,122,79,0.3)', borderRadius: 'var(--radius-lg)', fontSize: 13, color: '#2D7A4F', fontFamily: mono, textAlign: 'center' }}>
          ✓ {followPortfolio.legs.length} bets placed — ¥{followPortfolio.totalStake} total. View in My Tracker.
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
