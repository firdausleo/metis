/**
 * evEngine.js — Metis EV + Kelly Calculator
 *
 * Implements Part 4.6 (EV / edge) and Part 4.7 (Kelly) per METIS-BIBLE.
 * Pure functions — no side effects, no imports.
 *
 * Guardrails:
 *   MT22 — vig ALWAYS stripped before edge calculation
 *   MT23 — edge ≥ 5% floor for recommendation
 *   MT24 — max stake capped at 5% of bankroll
 *   MT15 — EV displayed as percentage with sign "+12.4%" / "−3.1%"
 */

// ── Constants ────────────────────────────────────────────────────────────

export const FRACTIONAL_KELLY = 0.25   // stake = full_kelly × 0.25
export const KELLY_MAX_STAKE  = 0.05   // 5% bankroll hard cap (MT24)
export const KELLY_MIN_STAKE  = 0.01   // below this → "marginal — skip or min"
export const EDGE_GREEN       = 0.05   // ≥ 5% → recommend (MT23)
export const EDGE_AMBER_LOW   = 0.00   // 0–4.9% → marginal
// below 0% → do not bet

/**
 * Edge traffic light classification.
 * Returns 'green' | 'amber' | 'red'
 */
export function edgeColour(edge) {
  if (edge >= EDGE_GREEN)    return 'green'
  if (edge >= EDGE_AMBER_LOW) return 'amber'
  return 'red'
}

// ── Step 1-4: Vig stripping (MT22) ──────────────────────────────────────

/**
 * Convert decimal odds to raw implied probability.
 * p_raw = 1 / decimal_odds
 */
export function decimalToImplied(decimalOdds) {
  if (!decimalOdds || decimalOdds <= 1) return null
  return 1 / decimalOdds
}

/**
 * Strip vig from a set of decimal odds for a market.
 *
 * Input:  array of decimal odds  e.g. [2.10, 3.40, 3.20]
 * Output: {
 *   rawImplied:      [p1_raw, p2_raw, p3_raw],
 *   vigTotal:        1.05  (overround, e.g. 105%)
 *   vigPct:          5.0   (vig as percentage)
 *   fairOdds:        [fair1, fair2, fair3],
 *   trueProbs:       [p1, p2, p3],   ← vig-stripped (MT22)
 * }
 */
export function stripVig(decimalOddsArray) {
  const rawImplied = decimalOddsArray.map(decimalToImplied)

  // Any null odds → can't calculate
  if (rawImplied.some(p => p === null)) {
    return null
  }

  const vigTotal = rawImplied.reduce((sum, p) => sum + p, 0)
  const vigPct   = (vigTotal - 1) * 100

  const trueProbs = rawImplied.map(p => p / vigTotal)
  const fairOdds  = trueProbs.map(p => (p > 0 ? 1 / p : null))

  return {
    rawImplied,
    vigTotal,
    vigPct,
    trueProbs,
    fairOdds,
  }
}

// ── Step 5-6: EV + edge ──────────────────────────────────────────────────

/**
 * Calculate EV and edge for a single outcome.
 *
 * MT22: p_market MUST be vig-stripped (trueProbs[i], NOT rawImplied[i]).
 *
 * @param {number} modelProb     — P(outcome) from Poisson matrix
 * @param {number} decimalOdds   — bookmaker decimal odds
 * @param {number} marketProb    — vig-stripped market probability (MT22)
 *
 * Returns {
 *   ev:         number   — raw EV  (e.g. 0.124 = +12.4%)
 *   evPct:      number   — EV as percentage
 *   evDisplay:  string   — "+12.4%" or "−3.1%" (MT15)
 *   edge:       number   — (p_model - p_market) / p_market
 *   edgePct:    number   — edge as percentage
 *   colour:     string   — 'green'|'amber'|'red'
 *   recommend:  boolean  — edge ≥ 5% (MT23)
 * }
 */
export function calcEV(modelProb, decimalOdds, marketProb) {
  if (!modelProb || !decimalOdds || !marketProb) return null

  // Step 5: Raw EV
  const ev    = modelProb * decimalOdds - 1
  const evPct = ev * 100

  // Step 6: Edge
  const edge    = (modelProb - marketProb) / marketProb
  const edgePct = edge * 100

  // MT15: signed display
  const sign      = evPct >= 0 ? '+' : '−'
  const evDisplay = `${sign}${Math.abs(evPct).toFixed(1)}%`

  const edgeSign    = edgePct >= 0 ? '+' : '−'
  const edgeDisplay = `${edgeSign}${Math.abs(edgePct).toFixed(1)}%`

  return {
    ev,
    evPct,
    evDisplay,
    edge,
    edgePct,
    edgeDisplay,
    colour:    edgeColour(edge),
    recommend: edge >= EDGE_GREEN,
  }
}

// ── Kelly criterion (Part 4.7) ───────────────────────────────────────────

/**
 * Full Kelly fraction.
 * f* = (b×p - q) / b
 *
 * where b = decimal_odds - 1, p = model prob, q = 1 - p
 * Returns null if Kelly < 0 (negative EV).
 */
export function fullKelly(modelProb, decimalOdds) {
  if (!modelProb || !decimalOdds || decimalOdds <= 1) return null
  const b = decimalOdds - 1
  const p = modelProb
  const q = 1 - p
  const f = (b * p - q) / b
  return f > 0 ? f : null
}

/**
 * Recommended stake as a fraction of bankroll.
 * Applies fractional Kelly (×0.25) and hard cap (5% — MT24).
 *
 * Returns {
 *   fraction:     number   — stake as fraction of bankroll (0..0.05)
 *   pct:          number   — as percentage
 *   display:      string   — "2.1% of bankroll"
 *   label:        string   — "recommended" | "marginal — skip or min" | "negative EV"
 *   kelly:        number   — full Kelly fraction (before fractional/cap)
 * }
 */
export function calcStake(modelProb, decimalOdds) {
  const kelly = fullKelly(modelProb, decimalOdds)

  if (kelly === null) {
    return {
      fraction: 0,
      pct: 0,
      display: '0%',
      label: 'negative EV — do not bet',
      kelly: null,
    }
  }

  const fractional = kelly * FRACTIONAL_KELLY
  const capped     = Math.min(fractional, KELLY_MAX_STAKE)      // MT24
  const pct        = capped * 100

  let label
  if (capped < KELLY_MIN_STAKE) {
    label = 'marginal — skip or min stake'
  } else {
    label = `${pct.toFixed(1)}% of bankroll`
  }

  return {
    fraction: capped,
    pct,
    display: `${pct.toFixed(1)}% of bankroll`,
    label,
    kelly,
    kellyPct: kelly * 100,
  }
}

// ── Full market analysis ─────────────────────────────────────────────────

/**
 * Analyse a full 1X2 market.
 * Strips vig, calculates EV + edge + Kelly for each outcome.
 *
 * @param {object} modelProbs   — { home, draw, away } from Poisson
 * @param {object} odds         — { home: 2.10, draw: 3.40, away: 3.20 }
 * @param {number} bankroll     — optional, for stake amount display
 *
 * Returns {
 *   vig:          stripVig result
 *   outcomes: {
 *     home: { modelProb, odds, ev, edge, stake, ... },
 *     draw: { ... },
 *     away: { ... },
 *   },
 *   bestBet:      'home'|'draw'|'away'|null  — highest edge ≥ 5%
 * }
 */
export function analyse1X2(modelProbs, odds, bankroll = null) {
  const oddsArray = [odds.home, odds.draw, odds.away]
  const vig = stripVig(oddsArray)

  if (!vig) return { vig: null, outcomes: null, bestBet: null, error: 'Missing odds' }

  const keys = ['home', 'draw', 'away']
  const outcomes = {}

  keys.forEach((key, i) => {
    const modelProb  = modelProbs[key]
    const decOdds    = odds[key]
    const marketProb = vig.trueProbs[i]

    const ev    = calcEV(modelProb, decOdds, marketProb)
    const stake = calcStake(modelProb, decOdds)

    outcomes[key] = {
      modelProb,
      modelProbPct: (modelProb * 100).toFixed(1),
      odds: decOdds,
      fairOdds: vig.fairOdds[i],
      marketProb,
      marketProbPct: (marketProb * 100).toFixed(1),
      ev,
      stake,
      stakeAmount: bankroll && stake.fraction ? (bankroll * stake.fraction).toFixed(2) : null,
    }
  })

  // Best bet: highest edge among recommended outcomes
  const recommended = keys.filter(k => outcomes[k].ev?.recommend)
  const bestBet = recommended.length
    ? recommended.reduce((best, k) =>
        outcomes[k].ev.edge > outcomes[best].ev.edge ? k : best
      )
    : null

  return { vig, outcomes, bestBet }
}

/**
 * Analyse total goals market.
 * @param {array}  totalGoals    — from poisson.calcTotalGoals()
 * @param {object} oddsOverUnder — { over: 1.90, under: 1.90 } for a given line
 * @param {number} line          — e.g. 2.5
 */
export function analyseTotalGoals(totalGoals, oddsOverUnder, line) {
  const lineData = totalGoals.find(l => l.line === line)
  if (!lineData) return null

  const vig = stripVig([oddsOverUnder.over, oddsOverUnder.under])
  if (!vig) return null

  const evOver  = calcEV(lineData.over,  oddsOverUnder.over,  vig.trueProbs[0])
  const evUnder = calcEV(lineData.under, oddsOverUnder.under, vig.trueProbs[1])

  return {
    line,
    anchor: lineData.anchor,
    modelOver:  lineData.over,
    modelUnder: lineData.under,
    vig,
    over:  { odds: oddsOverUnder.over,  ev: evOver,  stake: calcStake(lineData.over,  oddsOverUnder.over)  },
    under: { odds: oddsOverUnder.under, ev: evUnder, stake: calcStake(lineData.under, oddsOverUnder.under) },
  }
}

/**
 * Format a probability for display, applying MT08 cap.
 * Returns string e.g. "43.2%"
 */
export function formatProb(p, { cap = true } = {}) {
  const capped = cap ? Math.max(0.05, Math.min(0.95, p)) : p
  return `${(capped * 100).toFixed(1)}%`
}
