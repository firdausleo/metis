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

// ── Strategic Context helpers ─────────────────────────────
function computeGroupStandings(matches) {
  const teams = {}
  const sorted = [...matches].sort((a, b) => new Date(a.match_date || 0) - new Date(b.match_date || 0))
  for (const m of sorted) {
    if (m.home_score == null || m.away_score == null) continue
    for (const t of [m.home_team, m.away_team])
      if (!teams[t]) teams[t] = { team: t, played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, pts: 0, form: [] }
    const h = teams[m.home_team], a = teams[m.away_team]
    h.played++; a.played++
    h.gf += m.home_score; h.ga += m.away_score
    a.gf += m.away_score; a.ga += m.home_score
    if (m.home_score > m.away_score) {
      h.won++; h.pts += 3; a.lost++; h.form.push('W'); a.form.push('L')
    } else if (m.home_score < m.away_score) {
      a.won++; a.pts += 3; h.lost++; h.form.push('L'); a.form.push('W')
    } else {
      h.drawn++; a.drawn++; h.pts++; a.pts++; h.form.push('D'); a.form.push('D')
    }
  }
  return Object.values(teams)
    .map(t => ({ ...t, gd: t.gf - t.ga }))
    .sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf)
}

function computeMotivation(pts, gd, matchday) {
  if (matchday <= 1) return 3
  let s = 3
  if (pts === 0) s += 2
  else if (pts <= 1) s += 1
  if (pts >= 3 && gd >= 3) s -= 2
  else if (pts >= 3) s -= 1
  return Math.max(1, Math.min(5, s))
}

function computeScenarios(pts) {
  const w = pts + 3, d = pts + 1
  return {
    win:  { pts: w, label: w >= 6 ? 'Guaranteed top 2' : w >= 4 ? 'Strong position' : 'Needs MD3 win' },
    draw: { pts: d, label: d >= 4 ? 'Likely safe' : d >= 2 ? 'Needs MD3 result' : 'Dangerous position' },
    lose: { pts,    label: pts >= 3 ? 'Must win MD3' : 'Likely eliminated' },
  }
}

function computeTacticalSignal(homeMot, awayMot, v3Anchor) {
  let text, goalAdj = 0, note
  if (homeMot >= 4 && awayMot <= 2) {
    text = 'Home dominant — Away protecting'; goalAdj = 0.2
    note = 'Home team must attack. Weight portfolio toward home win scorelines.'
  } else if (awayMot >= 4 && homeMot <= 2) {
    text = 'Away dominant — Home protecting'; goalAdj = 0.2
    note = 'Away team more motivated. Consider away win scorelines despite home model edge.'
  } else if (homeMot >= 4 && awayMot >= 4) {
    text = 'Both must win — Open game'; goalAdj = 0.4
    note = 'Both teams need goals. Increase TG insurance allocation. Avoid 0-0, 1-0 bets.'
  } else if (homeMot <= 2 && awayMot <= 2) {
    text = 'Both safe — Conservative game'; goalAdj = -0.3
    note = 'Both teams safe. Expect conservative play. Reduce TG anchor by 1, favour draw.'
  } else {
    text = 'Balanced — Follow model'; goalAdj = 0
    note = 'Follow V3 model — no strategic adjustment needed.'
  }
  const adjAnchor = Math.max(1, Math.round(v3Anchor + goalAdj))
  const adjSign = goalAdj > 0 ? `+${goalAdj}` : goalAdj < 0 ? `${goalAdj}` : '±0'
  return { text, goalAdj, adjSign, adjAnchor, note }
}

function motColor(m) {
  return m >= 5 ? '#ef4444' : m === 4 ? '#BA7517' : m === 3 ? 'var(--color-text-muted)' : m === 2 ? '#C9A84C' : 'var(--color-text-muted)'
}
function motStars(m) { return '★'.repeat(m) + '☆'.repeat(5 - m) }
function riskLabel(m) { return m >= 4 ? 'HIGH' : m === 3 ? 'MEDIUM' : 'LOW' }
function riskColor(m) { return m >= 4 ? '#ef4444' : m === 3 ? '#BA7517' : '#C9A84C' }
function scenColor(label) {
  if (['Guaranteed top 2','Strong position','Likely safe'].includes(label)) return '#2D7A4F'
  if (['Dangerous position','Likely eliminated'].includes(label)) return '#ef4444'
  return '#BA7517'
}
function md3StrColor(s) { return s === 'Strong' ? '#ef4444' : s === 'Medium' ? '#BA7517' : '#2D7A4F' }

// ── Component ─────────────────────────────────────────────

// model = sidebarModel from runModels() — has model.v3.probs.{home,draw,away} + lambdaHome/Away
export default function PASPTab({ match, model }) {
  const { user } = useUser()
  const [oddsData, setOddsData] = useState(null)
  const [budget, setBudget] = useState(400)
  const [placing, setPlacing] = useState(false)
  const [placed, setPlaced] = useState(false)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)
  const [stratCtx, setStratCtx] = useState(null)
  const [stratLoading, setStratLoading] = useState(false)

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

  // Strategic context: group standings + remaining fixtures
  useEffect(() => {
    if (!match?.id || !match?.group_name) return
    setStratLoading(true)
    Promise.all([
      supabase.from('matches')
        .select('home_team, away_team, home_score, away_score, match_date')
        .eq('status', 'finished')
        .eq('group_name', match.group_name)
        .order('match_date', { ascending: true }),
      supabase.from('matches')
        .select('id, home_team, away_team, match_date')
        .eq('status', 'upcoming')
        .eq('group_name', match.group_name)
        .neq('id', match.id)
        .order('match_date', { ascending: true }),
    ]).then(([finRes, upRes]) => {
      const finished  = finRes.data  || []
      const upcoming  = (upRes.data  || []).filter(f =>
        f.home_team === match.home_team || f.away_team === match.home_team ||
        f.home_team === match.away_team || f.away_team === match.away_team
      )
      const standings = computeGroupStandings(finished)
      const stat = t => standings.find(s => s.team === t) || { pts: 0, gd: 0, gf: 0, ga: 0, played: 0, form: [] }
      const hStat = stat(match.home_team)
      const aStat = stat(match.away_team)
      const hMD = hStat.played + 1
      const aMD = aStat.played + 1
      const hMot = computeMotivation(hStat.pts, hStat.gd, hMD)
      const aMot = computeMotivation(aStat.pts, aStat.gd, aMD)
      const matchday = Math.max(hMD, aMD)
      const md3Opp = team => {
        const f = upcoming.find(u => u.home_team === team || u.away_team === team)
        return f ? (f.home_team === team ? f.away_team : f.home_team) : null
      }
      const md3Str = opp => {
        if (!opp) return null
        const s = standings.find(t => t.team === opp)
        return (s?.pts || 0) >= 3 ? 'Strong' : (s?.pts || 0) >= 1 ? 'Medium' : 'Weak'
      }
      const hMD3 = md3Opp(match.home_team)
      const aMD3 = md3Opp(match.away_team)
      setStratCtx({
        standings, matchday,
        hStat, aStat, hMot, aMot,
        hScen: computeScenarios(hStat.pts),
        aScen: computeScenarios(aStat.pts),
        hMD3, aMD3,
        hMD3Str: md3Str(hMD3),
        aMD3Str: md3Str(aMD3),
      })
      setStratLoading(false)
    }).catch(() => setStratLoading(false))
  }, [match?.id, match?.group_name, match?.home_team, match?.away_team])

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

  // Tactical signal — derived from stratCtx + current v3 lambdas
  // NOTE: must be declared AFTER v3Normalised to avoid TDZ error
  const stratSignal = useMemo(() => {
    if (!stratCtx || !v3Normalised) return null
    const lh = Number(v3Normalised.lambdaHome || 1.5)
    const la = Number(v3Normalised.lambdaAway || 1.5)
    const v3Anchor = getModelAnchor(lh, la)
    return { ...computeTacticalSignal(stratCtx.hMot, stratCtx.aMot, v3Anchor), v3Anchor }
  }, [stratCtx, v3Normalised])

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

      {/* Strategic Context */}
      {match?.group_name && (stratLoading || stratCtx) && (
        <div style={{ ...panel, marginBottom: 14 }}>
          <div style={ph}>
            <span>Strategic Context · Group {match.group_name} · Matchday {stratCtx?.matchday ?? '…'}</span>
            <span style={{ color: '#C9A84C' }}>Computed</span>
          </div>

          {stratLoading && !stratCtx ? (
            <div style={{ padding: '14px', fontSize: 11, fontFamily: mono, color: 'var(--color-text-muted)', letterSpacing: '0.05em' }}>
              Loading group data…
            </div>
          ) : stratCtx && (
            <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 14 }}>

              {/* Three-column: home | tactical | away */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr minmax(150px,180px) 1fr', gap: 12, alignItems: 'start' }}>

                {/* Home team */}
                {[
                  { teamName: match.home_team, stat: stratCtx.hStat, mot: stratCtx.hMot, scen: stratCtx.hScen, md3: stratCtx.hMD3, md3Str: stratCtx.hMD3Str },
                  { teamName: match.away_team, stat: stratCtx.aStat, mot: stratCtx.aMot, scen: stratCtx.aScen, md3: stratCtx.aMD3, md3Str: stratCtx.aMD3Str },
                ].map((t, idx) => (
                  <div key={idx} style={{ background: 'var(--color-bg-secondary)', border: '0.5px solid var(--color-border)', borderRadius: 8, padding: '12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text-primary)', letterSpacing: '0.02em' }}>{t.teamName}</div>
                    <div style={{ fontSize: 11, fontFamily: mono, color: 'var(--color-text-muted)', lineHeight: 1.6 }}>
                      Pts: <strong style={{ color: 'var(--color-text-primary)' }}>{t.stat.pts}</strong>
                      {' · '}GD: <strong style={{ color: 'var(--color-text-primary)' }}>{t.stat.gd >= 0 ? '+' : ''}{t.stat.gd}</strong>
                      {' · '}P: <strong style={{ color: 'var(--color-text-primary)' }}>{t.stat.played}</strong>
                    </div>

                    {/* Motivation */}
                    <div>
                      <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-text-muted)', marginBottom: 3 }}>Motivation</div>
                      <div style={{ fontSize: 15, color: motColor(t.mot), letterSpacing: 1 }}>{motStars(t.mot)}</div>
                      <div style={{ fontSize: 10, fontWeight: 700, color: riskColor(t.mot), marginTop: 2, fontFamily: mono }}>Risk: {riskLabel(t.mot)}</div>
                    </div>

                    {/* Scenarios */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                      {[
                        { label: 'Win',  data: t.scen.win },
                        { label: 'Draw', data: t.scen.draw },
                        { label: 'Lose', data: t.scen.lose },
                      ].map(({ label, data }) => (
                        <div key={label} style={{ display: 'flex', gap: 6, fontSize: 11, fontFamily: mono }}>
                          <span style={{ color: 'var(--color-text-muted)', minWidth: 28 }}>If {label}:</span>
                          <span style={{ color: scenColor(data.label), fontWeight: 500 }}>{data.label}</span>
                        </div>
                      ))}
                    </div>

                    {/* MD3 */}
                    {t.md3 && (
                      <div style={{ fontSize: 11, fontFamily: mono, borderTop: '0.5px solid var(--color-border)', paddingTop: 6 }}>
                        <span style={{ color: 'var(--color-text-muted)' }}>MD3: vs </span>
                        <strong>{t.md3}</strong>
                        {t.md3Str && (
                          <span style={{ fontSize: 10, color: md3StrColor(t.md3Str), fontWeight: 700, marginLeft: 4 }}>({t.md3Str})</span>
                        )}
                      </div>
                    )}
                  </div>
                ))}

                {/* Tactical signal — middle column, rendered between both by grid order */}
                {stratSignal && (
                  <div style={{ background: 'var(--color-bg-secondary)', border: '0.5px solid var(--color-border)', borderRadius: 8, padding: '12px', display: 'flex', flexDirection: 'column', gap: 8, gridRow: 1, gridColumn: '2 / 3', order: 1 }}>
                    <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.10em', textTransform: 'uppercase', color: 'var(--color-text-muted)', marginBottom: 2 }}>Tactical Signal</div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-primary)', lineHeight: 1.4 }}>{stratSignal.text}</div>
                    <div style={{ borderTop: '0.5px solid var(--color-border)', paddingTop: 8 }}>
                      <div style={{ fontSize: 11, fontFamily: mono, color: 'var(--color-text-primary)' }}>
                        Strategic anchor: <strong>{stratSignal.adjAnchor}g</strong>
                      </div>
                      <div style={{ fontSize: 10, fontFamily: mono, color: 'var(--color-text-muted)', marginTop: 2 }}>
                        (V3 model: {stratSignal.v3Anchor}g{stratSignal.goalAdj !== 0 ? ` + overlay ${stratSignal.adjSign}` : ' · no overlay'})
                      </div>
                    </div>
                    <div style={{ borderTop: '0.5px solid var(--color-border)', paddingTop: 8 }}>
                      <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-text-muted)', marginBottom: 4 }}>PASP note</div>
                      <div style={{ fontSize: 11, color: 'var(--color-text-muted)', lineHeight: 1.6 }}>{stratSignal.note}</div>
                    </div>
                  </div>
                )}
              </div>

              {/* Group standings mini table */}
              <div>
                <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-text-muted)', marginBottom: 6, fontFamily: mono }}>
                  Group {match.group_name} Standings
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                  <thead>
                    <tr style={{ borderBottom: '0.5px solid var(--color-border)' }}>
                      {['Pos','Team','Pts','GD','Form'].map(h => (
                        <th key={h} style={{ padding: '4px 8px', fontSize: 9, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--color-text-muted)', textAlign: h === 'Team' ? 'left' : 'center', fontFamily: mono }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {stratCtx.standings.map((s, i) => {
                      const isPlaying = s.team === match.home_team || s.team === match.away_team
                      return (
                        <tr key={s.team} style={{ background: isPlaying ? 'rgba(26,58,108,0.06)' : 'transparent', borderBottom: '0.5px solid var(--color-border-light)' }}>
                          <td style={{ padding: '5px 8px', textAlign: 'center', fontFamily: mono, color: 'var(--color-text-muted)', fontSize: 11 }}>{i + 1}</td>
                          <td style={{ padding: '5px 8px', fontWeight: isPlaying ? 700 : 400, color: 'var(--color-text-primary)' }}>{s.team}</td>
                          <td style={{ padding: '5px 8px', textAlign: 'center', fontFamily: mono, fontWeight: 700, color: 'var(--color-text-primary)' }}>{s.pts}</td>
                          <td style={{ padding: '5px 8px', textAlign: 'center', fontFamily: mono, color: s.gd > 0 ? '#2D7A4F' : s.gd < 0 ? '#ef4444' : 'var(--color-text-muted)' }}>
                            {s.gd > 0 ? '+' : ''}{s.gd}
                          </td>
                          <td style={{ padding: '5px 8px', textAlign: 'center', fontFamily: mono, letterSpacing: 2 }}>
                            {s.form.map((f, fi) => (
                              <span key={fi} style={{ color: f === 'W' ? '#2D7A4F' : f === 'L' ? '#ef4444' : '#BA7517', fontWeight: 700 }}>{f}</span>
                            ))}
                            {!s.form.length && <span style={{ color: 'var(--color-text-muted)' }}>—</span>}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

            </div>
          )}
        </div>
      )}

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
              <div style={{ textAlign: 'right', fontSize: 13, fontFamily: mono, fontWeight: 500, color: 'var(--color-text-primary)' }}>¥{leg.stake}</div>
              <div style={{ textAlign: 'right', fontSize: 12, fontFamily: mono, color: '#2D7A4F' }}>¥{Math.round(leg.stake * leg.odds)}</div>
            </div>
          ))}

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
