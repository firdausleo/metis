// PASP: Anchor → Dominant → Primary → Hedge → Insurance → Kelly → Correlation
// Pure JS — no API calls, no React, no side effects.

// k_star: the most likely total goals count, selected purely by probability.
// When bookmaker odds are provided, score(k) = prob(k) × (1 + max(edge(k), 0)).
// With no odds: score(k) = prob(k).  NEVER use lambda thresholds here.
export function getAnchorGoal(totalGoals, bookOdds = {}) {
  if (!totalGoals?.length) return 2
  let best = totalGoals[0]
  for (const entry of totalGoals) {
    const odds = bookOdds[entry.goals]
    const edge = odds && odds > 1 ? entry.prob * odds - 1 : 0
    const score = entry.prob * (1 + Math.max(edge, 0))
    const bestOdds = bookOdds[best.goals]
    const bestEdge = bestOdds && bestOdds > 1 ? best.prob * bestOdds - 1 : 0
    const bestScore = best.prob * (1 + Math.max(bestEdge, 0))
    if (score > bestScore) best = entry
  }
  return best.goals
}

export function getDominantOutcome(probs) {
  const m = Math.max(probs.home, probs.draw, probs.away)
  return probs.home === m ? 'home' : probs.away === m ? 'away' : 'draw'
}

// Quarter Kelly, capped at 5% of bankroll.
export function quarterKelly(prob, decimalOdds) {
  if (!prob || !decimalOdds || decimalOdds <= 1) return 0
  const b = decimalOdds - 1
  const k = (b * prob - (1 - prob)) / b
  return Math.max(0, Math.min(k * 0.25, 0.05))
}

// Reduce correlated bets on the same match by 1/√n factor.
export function correlatedKelly(fracs) {
  const n = fracs.filter(f => f > 0).length
  if (n <= 1) return fracs
  const adj = 1 / Math.sqrt(n)
  return fracs.map(f => Math.min(f * adj, 0.05))
}

// Compute over/under probabilities for a given anchor line from
// v3.totalGoals array: [{ goals: 0, prob }, { goals: 1, prob }, ...].
export function getAnchorSideProbs(totalGoals, anchorLine) {
  let over = 0, under = 0
  for (const { goals, prob } of (totalGoals || [])) {
    if (goals > anchorLine) over += prob
    else under += prob
  }
  return { over, under }
}

// Build the full PASP plan from sidebarModel + match.
// Returns null if V3 data isn't available.
export function buildPaspPlan(model, match) {
  if (!model?.v3) return null
  const { probs, topScores, lambdaHome, lambdaAway, over25, btts, totalGoals } = model.v3

  // k_star = highest-probability total goals (no lambda thresholds)
  const kStar = getAnchorGoal(totalGoals)
  // Betting line: Over (kStar - 0.5) = "goals ≥ kStar"
  const anchorLine = kStar - 0.5
  // anchorProb = P(goals >= kStar) = sum of entries at kStar and above
  let overProb = 0, underProb = 0
  for (const { goals, prob } of (totalGoals || [])) {
    if (goals >= kStar) overProb += prob
    else underProb += prob
  }
  const anchorSide = 'over'   // Over (kStar-0.5) always includes the peak
  const anchorProb = overProb

  const dominant = getDominantOutcome(probs)
  const homeName = match?.home_team || 'Home'
  const awayName = match?.away_team || 'Away'
  const dominantLabel = dominant === 'home' ? homeName : dominant === 'away' ? awayName : 'Draw'

  return {
    anchorGoal: kStar,   // integer, e.g. 4 — the most likely goals total
    anchorLine,          // kStar - 0.5, e.g. 3.5 — the Over betting line
    anchorSide,
    anchorProb,
    overProb,
    underProb,
    dominant,
    dominantLabel,
    dominantProb: probs[dominant],
    primary: topScores[0] || null,
    hedge: topScores[1] || null,
    insurance: topScores[2] || null,
    drawInsurance: dominant !== 'draw' && probs.draw > 0.25,
    drawProb: probs.draw,
    over25,
    btts,
    probs,
    lambdaHome,
    lambdaAway,
  }
}

// 3-goal sliding window probabilities, sorted by probability descending.
export function getRangeProbabilities(totalGoalsDist) {
  const p = {}
  ;(totalGoalsDist || []).forEach(item => { p[Number(item.goals)] = item.prob })
  const get = g => p[g] || 0

  const ranges = [
    { range: '0–2', min: 0, max: 2, prob: get(0) + get(1) + get(2) },
    { range: '1–3', min: 1, max: 3, prob: get(1) + get(2) + get(3) },
    { range: '2–4', min: 2, max: 4, prob: get(2) + get(3) + get(4) },
    { range: '3–5', min: 3, max: 5, prob: get(3) + get(4) + get(5) },
    { range: '4–6', min: 4, max: 6, prob: get(4) + get(5) + get(6) },
    { range: '5–7', min: 5, max: 7, prob: get(5) + get(6) + get(7) },
    { range: '6–8', min: 6, max: 8, prob: get(6) + get(7) + get(8) },
  ]
  ranges.sort((a, b) => b.prob - a.prob)
  return ranges
}

// One-line strategy text for the recommendation banner.
export function paspText(plan, lang = 'en') {
  if (!plan) return ''
  const { dominantLabel, dominantProb, anchorGoal, anchorLine, anchorProb, primary, drawInsurance, drawProb } = plan

  if (lang === 'zh') {
    const lines = [
      `主要结果：${dominantLabel}（${(dominantProb * 100).toFixed(1)}%）`,
      `锚定总进球：${anchorGoal}球 — 大${anchorLine}（${(anchorProb * 100).toFixed(1)}%）`,
      primary ? `首选比分：${primary.score}（${(primary.prob * 100).toFixed(1)}%）` : null,
      drawInsurance ? `平局保险：平局${(drawProb * 100).toFixed(1)}%，建议小注对冲` : null,
    ]
    return lines.filter(Boolean).join(' · ')
  }

  const lines = [
    `Primary: ${dominantLabel === 'Draw' ? `Draw (${(dominantProb * 100).toFixed(1)}%)` : `${dominantLabel} win (${(dominantProb * 100).toFixed(1)}%)`}`,
    `Anchor: ${anchorGoal} goals — Over ${anchorLine} (${(anchorProb * 100).toFixed(1)}%)`,
    primary ? `Top score: ${primary.score} (${(primary.prob * 100).toFixed(1)}%)` : null,
    drawInsurance ? `Draw insurance: ${(drawProb * 100).toFixed(1)}% — small hedge` : null,
  ]
  return lines.filter(Boolean).join(' · ')
}

// Chinese handicap (让球胜平负) probability calculator.
// matrix[homeGoals][awayGoals] = probability
// line = handicap integer applied to home team (e.g. -1 = home gives 1, +1 = home receives 1)
export function getChineseHandicapProbs(matrix, line) {
  const H = parseInt(line) || 0
  let homeWin = 0, draw = 0, awayWin = 0

  for (let x = 0; x <= 8; x++) {
    for (let y = 0; y <= 8; y++) {
      const p = matrix?.[x]?.[y] || 0
      const adjustedDiff = (x - y) + H   // positive = home covers after handicap
      if (adjustedDiff > 0) homeWin += p
      else if (adjustedDiff === 0) draw += p
      else awayWin += p
    }
  }

  return {
    homeWin: Math.round(homeWin * 1000) / 1000,
    draw:    Math.round(draw    * 1000) / 1000,
    awayWin: Math.round(awayWin * 1000) / 1000,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PORTFOLIO ENGINE
// ─────────────────────────────────────────────────────────────────────────────

// China lottery listed correct-score cells (mirrors BetsTab constants)
const CS_HOME = ['1-0','2-0','2-1','3-0','3-1','3-2','4-0','4-1','4-2','5-0','5-1','5-2']
const CS_DRAW = ['0-0','1-1','2-2','3-3']
const CS_AWAY = ['0-1','0-2','1-2','0-3','1-3','2-3','0-4','1-4','2-4','0-5','1-5','2-5']

function listedProb(scores, matrix) {
  return scores.reduce((sum, s) => {
    const [h, a] = s.split('-').map(Number)
    return sum + (matrix?.[h]?.[a] || 0)
  }, 0)
}

function kellyStake(edge, odds, bankroll, fraction = 0.25) {
  if (edge <= 0) return 0
  const k = edge / (odds - 1)
  const raw = k * bankroll * fraction
  const capped = Math.min(raw, bankroll * 0.05)
  return Math.max(Math.round(capped / 10) * 10, 10)
}

// Classify a bet ID or score key as home / draw / away direction
function betDirection(id, scoreKey) {
  if (id === 'spf-home' || id === 'rspf-home') return 'home'
  if (id === 'spf-away' || id === 'rspf-away') return 'away'
  if (id === 'spf-draw' || id === 'rspf-draw') return 'draw'
  if (id.startsWith('tg-')) return 'neutral'
  if (id.startsWith('cs-')) {
    const parts = scoreKey.split('-')
    const h = parseInt(parts[0]), a = parseInt(parts[1])
    if (!isNaN(h) && !isNaN(a)) {
      return h > a ? 'home' : a > h ? 'away' : 'draw'
    }
    if (scoreKey === '胜其它') return 'home'
    if (scoreKey === '平其它') return 'draw'
    if (scoreKey === '负其它') return 'away'
  }
  return 'neutral'
}

export function collectAllBets({ v1x2Odds, rspfH, rspfD, rspfA, rspfLine, csOdds, chinaGoalsOdds, model, match }) {
  if (!model || !match) return []

  const probs = model?.v3?.probs || model?.v2?.probs
  const matrix = model?.v3?.matrix || model?.v2?.matrix
  const totalGoalsDist = model?.v3?.totalGoals || []

  if (!probs) return []

  const bets = []

  const addBet = (id, label, marketType, oddsStr, modelProb, scoreKey = '', isCatchAll = false) => {
    if (!oddsStr) return
    const o = parseFloat(oddsStr)
    if (!o || isNaN(o) || o <= 1) return
    if (!modelProb || modelProb < 0.001) return
    const edge = modelProb - (1 / o)
    bets.push({ id, label, marketType, odds: o, modelProb, edge, scoreKey, isCatchAll })
  }

  // 胜平负 1X2
  addBet('spf-home', `${match.home_team} win · 胜平负`, '胜平负', v1x2Odds?.home, probs.homeWin)
  addBet('spf-draw', `Draw · 胜平负`, '胜平负', v1x2Odds?.draw, probs.draw)
  addBet('spf-away', `${match.away_team} win · 胜平负`, '胜平负', v1x2Odds?.away, probs.awayWin)

  // 比分 correct scores — residual probabilities for catch-all cells
  const homeOtherProb = Math.max((probs.homeWin || 0) - listedProb(CS_HOME, matrix), 0)
  const drawOtherProb = Math.max((probs.draw    || 0) - listedProb(CS_DRAW, matrix), 0)
  const awayOtherProb = Math.max((probs.awayWin || 0) - listedProb(CS_AWAY, matrix), 0)

  Object.entries(csOdds || {}).forEach(([score, oddsStr]) => {
    if (!oddsStr) return
    if (score === '胜其它') {
      addBet('cs-胜其它', `胜其它 ${match.home_team} wins (other) · 比分`, '比分', oddsStr, homeOtherProb, '胜其它', true)
      return
    }
    if (score === '平其它') {
      addBet('cs-平其它', `平其它 Draw (other score) · 比分`, '比分', oddsStr, drawOtherProb, '平其它', true)
      return
    }
    if (score === '负其它') {
      addBet('cs-负其它', `负其它 ${match.away_team} wins (other) · 比分`, '比分', oddsStr, awayOtherProb, '负其它', true)
      return
    }
    const parts = score.split('-')
    const h = parseInt(parts[0]), a = parseInt(parts[1])
    if (isNaN(h) || isNaN(a)) return
    const modelProb = matrix?.[h]?.[a] || 0
    if (modelProb < 0.005) return
    const winner = h > a ? match.home_team : a > h ? match.away_team : 'Draw'
    addBet(`cs-${score}`, `${score} ${winner} · 比分`, '比分', oddsStr, modelProb, score)
  })

  // 总进球数
  Object.entries(chinaGoalsOdds || {}).forEach(([key, oddsStr]) => {
    if (!oddsStr) return
    let modelProb = 0
    if (key === '7plus') {
      modelProb = totalGoalsDist.filter(t => t.goals >= 7).reduce((s, t) => s + t.prob, 0)
    } else {
      const goals = parseInt(key)
      modelProb = totalGoalsDist.find(t => t.goals === goals)?.prob || 0
    }
    if (modelProb < 0.005) return
    addBet(`tg-${key}`, `${key === '7plus' ? '7+' : key} goals · 总进球`, '总进球', oddsStr, modelProb, key)
  })

  // 让球胜平负 RSPF
  if ((rspfH || rspfD || rspfA) && matrix) {
    const rspfProbs = getChineseHandicapProbs(matrix, rspfLine)
    const absLine = Math.abs(parseInt(rspfLine) || 0)
    if (rspfH) addBet('rspf-home', `${match.home_team} 让${absLine}球胜 · 让球`, '让球', rspfH, rspfProbs.homeWin)
    if (rspfD) addBet('rspf-draw', `让球平 · 让球`, '让球', rspfD, rspfProbs.draw)
    if (rspfA) addBet('rspf-away', `${match.away_team} 让球胜 · 让球`, '让球', rspfA, rspfProbs.awayWin)
  }

  // Tag model direction
  const dominant = probs.homeWin >= probs.awayWin && probs.homeWin >= probs.draw ? 'home'
    : probs.awayWin >= probs.homeWin && probs.awayWin >= probs.draw ? 'away'
    : 'draw'

  bets.forEach(bet => {
    const dir = betDirection(bet.id, bet.scoreKey)
    bet.isModelDirection = dir === 'neutral' || dir === dominant
  })

  return bets.sort((a, b) => b.edge - a.edge)
}

const MIN_MODEL_PROB = 0.03
const MIN_CATCHALL_PROB = 0.05
const MIN_CATCHALL_EDGE = 0.05
const MIN_STAKE = 10

export function buildPortfolio(allBets, bankroll, mode) {
  const b = parseFloat(bankroll) || 10000

  // Eligibility: filter low-probability and marginal catch-all bets
  const eligible = allBets.filter(bet => {
    if (bet.modelProb < MIN_MODEL_PROB) return false
    if (bet.isCatchAll && bet.modelProb < MIN_CATCHALL_PROB) return false
    if (bet.isCatchAll && bet.edge < MIN_CATCHALL_EDGE) return false
    return true
  }).filter(bet => kellyStake(bet.edge, bet.odds, b) >= MIN_STAKE)

  if (mode === 'edge') {
    const selected = []
    const typeCounts = {}
    for (const bet of eligible) {
      if (bet.edge <= 0.02) continue
      if (selected.length >= 5) break
      const count = typeCounts[bet.marketType] || 0
      if (count >= 2) continue
      typeCounts[bet.marketType] = count + 1
      const roles = ['primary', 'secondary', 'insurance']
      selected.push({ ...bet, role: roles[selected.length] || 'insurance', suggestedStake: kellyStake(bet.edge, bet.odds, b) })
    }
    return selected
  }

  if (mode === 'model') {
    const modelBets = eligible.filter(bet => bet.isModelDirection && bet.edge > -0.10)
    const selected = []
    const typeCounts = {}
    for (const bet of modelBets) {
      if (selected.length >= 4) break
      const count = typeCounts[bet.marketType] || 0
      if (count >= 2) continue
      typeCounts[bet.marketType] = count + 1
      const roles = ['primary', 'secondary', 'insurance']
      selected.push({ ...bet, role: roles[selected.length] || 'insurance', suggestedStake: kellyStake(Math.max(bet.edge, 0.01), bet.odds, b) })
    }
    return selected
  }

  if (mode === 'balanced') {
    const modelBets = eligible.filter(bet => bet.isModelDirection)
    const primary = modelBets.find(bet => bet.edge > -0.10)
    const secondary = eligible.find(bet => bet.id !== primary?.id && bet.marketType !== primary?.marketType && bet.edge > 0.02)
    const insurance = eligible.find(bet => bet.id !== primary?.id && bet.id !== secondary?.id && bet.edge > 0.01)
    const result = []
    if (primary) result.push({ ...primary, role: 'primary', suggestedStake: kellyStake(Math.max(primary.edge, 0.01), primary.odds, b) })
    if (secondary) result.push({ ...secondary, role: 'secondary', suggestedStake: kellyStake(secondary.edge, secondary.odds, b, 0.15) })
    if (insurance) result.push({ ...insurance, role: 'insurance', suggestedStake: kellyStake(insurance.edge, insurance.odds, b, 0.10) })
    return result
  }

  return []
}
