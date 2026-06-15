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
    `Primary: ${dominantLabel} win (${(dominantProb * 100).toFixed(1)}%)`,
    `Anchor: ${anchorGoal} goals — Over ${anchorLine} (${(anchorProb * 100).toFixed(1)}%)`,
    primary ? `Top score: ${primary.score} (${(primary.prob * 100).toFixed(1)}%)` : null,
    drawInsurance ? `Draw insurance: ${(drawProb * 100).toFixed(1)}% — small hedge` : null,
  ]
  return lines.filter(Boolean).join(' · ')
}
