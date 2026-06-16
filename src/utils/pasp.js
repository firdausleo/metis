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
