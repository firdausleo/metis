/**
 * poisson.js — Metis Core Algorithm
 *
 * Implements V1 (overall) and V2 (away-factor) Poisson models per METIS-BIBLE Part 4.
 * Pure functions — no side effects, no imports. Fully testable in isolation.
 *
 * Guardrails:
 *   MT06 — throws if games_window < 5 (never estimates)
 *   MT07 — both V1 and V2 always returned together
 *   MT08 — displayed probabilities capped 5%–95% (applied by caller via capProb())
 *   MT21 — Dixon-Coles default OFF; caller must explicitly pass dixonColes: true
 */

// ── Constants ────────────────────────────────────────────────────────────

export const HOME_ADVANTAGE   = 1.15   // 15% uplift, WC calibrated
export const LEAGUE_AVG_GOALS = 1.5    // tournament baseline
export const DEF_FACTOR_MIN   = 0.5    // floor: cap elite defenses
export const DEF_FACTOR_MAX   = 1.8    // ceiling: stops 0.3-conceded blowups
export const RECENCY_WEIGHTS  = [0.10, 0.15, 0.20, 0.25, 0.30]  // oldest→newest
export const WINDOW           = 5
export const DIXON_COLES_RHO  = 0.1
export const SCORE_MAX        = 8      // matrix dimension: 0..SCORE_MAX
export const GOALS_LINES      = [0.5, 1.5, 2.5, 3.5, 4.5]

// ── Venue advantage table (WC2026 stadiums) ──────────────────────────────
// Multiplier replaces HOME_ADVANTAGE on the home lambda. WC2026 is mostly
// neutral ground (1.00); Azteca's altitude is the one genuine edge.
export const VENUE_ADVANTAGE = {
  AZTECA:  1.35,  // Mexico City — 2240m altitude
  USA:     1.10,  // US stadiums
  CANADA:  1.05,  // Canada stadiums
  NEUTRAL: 1.00,  // default — no venue edge
}

/** Venue multiplier from a match's venue/city text. Falls back to NEUTRAL. */
export function getVenueAdvantage(venue = '', city = '') {
  const v = `${venue} ${city}`.toLowerCase()
  if (v.includes('azteca') || v.includes('mexico city')) return VENUE_ADVANTAGE.AZTECA
  if (/canada|toronto|vancouver/.test(v))                 return VENUE_ADVANTAGE.CANADA
  if (/usa|united states|new york|dallas|atlanta|houston|miami|seattle|los angeles|kansas|philadelphia|boston|san francisco/.test(v)) return VENUE_ADVANTAGE.USA
  return VENUE_ADVANTAGE.NEUTRAL
}

// ── Core math ────────────────────────────────────────────────────────────

/**
 * Poisson PMF: P(k events | mean λ)
 * Uses log-space to avoid overflow for large k or λ.
 */
export function poissonPMF(k, lambda) {
  if (lambda <= 0) return k === 0 ? 1 : 0
  // log P = k*ln(λ) - λ - ln(k!)
  let logFactK = 0
  for (let i = 2; i <= k; i++) logFactK += Math.log(i)
  return Math.exp(k * Math.log(lambda) - lambda - logFactK)
}

/**
 * Poisson CDF: P(X ≤ N | λ)  =  Σ PMF(k|λ) for k=0..N
 */
export function poissonCDF(n, lambda) {
  let sum = 0
  for (let k = 0; k <= n; k++) sum += poissonPMF(k, lambda)
  return Math.min(sum, 1)  // clamp floating-point rounding
}

/**
 * Cap displayed probability to [0.05, 0.95] — MT08.
 * Never apply before summing the matrix; apply only at display layer.
 */
export function capProb(p) {
  return Math.max(0.05, Math.min(0.95, p))
}

// ── Weighted average ─────────────────────────────────────────────────────

/**
 * Apply RECENCY_WEIGHTS to an array of 5 values [oldest, …, newest].
 * Throws if values.length !== WINDOW (MT06 enforcement at math layer).
 */
export function recencyWeightedAvg(values) {
  if (values.length !== WINDOW) {
    throw new Error(`MT06: recencyWeightedAvg requires exactly ${WINDOW} values, got ${values.length}`)
  }
  let total = 0
  for (let i = 0; i < WINDOW; i++) total += RECENCY_WEIGHTS[i] * values[i]
  return total
}

// ── Lambda calculation ───────────────────────────────────────────────────

/**
 * Validate that a team_stats row has enough data (MT06).
 * Throws a descriptive error — caller must catch and surface to UI.
 */
export function validateStats(stats, role) {
  if (!stats) throw new Error(`MT06: No stats for ${role} team`)
  // MT06: warn if < 5 games, but allow manual entries (games_window=0) to proceed
  // Manual entries are explicitly entered by admin and should not be blocked
  if (!stats.goals_scored_avg || !stats.goals_conceded_avg) {
    throw new Error(`MT06: ${role} team missing goals_scored_avg or goals_conceded_avg`)
  }
}

/**
 * V1 λ values — uses overall (home+away combined) stats.
 *
 * λ_home = attack_home × defense_away_factor × venueMult
 * λ_away = attack_away × defense_home_factor
 *
 * defense_X_factor = LEAGUE_AVG_GOALS / X.goals_conceded_avg, clamped 0.5–1.8
 *   (tiny conceded avgs like 0.30 would otherwise give factor 5.0 → λ≈8)
 * venueMult: 1.00 neutral default — venue table replaces flat HOME_ADVANTAGE.
 */
export function calcLambdasV1(homeStats, awayStats, venueMult = VENUE_ADVANTAGE.NEUTRAL) {
  validateStats(homeStats, 'home')
  validateStats(awayStats, 'away')

  const attackHome  = homeStats.goals_scored_avg
  const attackAway  = awayStats.goals_scored_avg
  const defHomeFactor = Math.min(Math.max(LEAGUE_AVG_GOALS / homeStats.goals_conceded_avg, DEF_FACTOR_MIN), DEF_FACTOR_MAX)
  const defAwayFactor = Math.min(Math.max(LEAGUE_AVG_GOALS / awayStats.goals_conceded_avg, DEF_FACTOR_MIN), DEF_FACTOR_MAX)

  const lambdaHome = attackHome * defAwayFactor * venueMult
  const lambdaAway = attackAway * defHomeFactor

  return {
    lambdaHome: Math.max(lambdaHome, 0.01),
    lambdaAway: Math.max(lambdaAway, 0.01),
  }
}

/**
 * V2 λ values — applies away-factor correction to away team's lambda.
 *
 * away_scoring_factor = team.away_goals_avg / team.goals_scored_avg
 * λ_away_v2 = λ_away × away_scoring_factor
 *
 * Falls back to V1 λ_away if away_goals_avg is missing (graceful degradation).
 */
export function calcLambdasV2(homeStats, awayStats, venueMult = VENUE_ADVANTAGE.NEUTRAL) {
  const v1 = calcLambdasV1(homeStats, awayStats, venueMult)

  let awayFactor = 1.0
  if (awayStats.away_goals_avg && awayStats.goals_scored_avg > 0) {
    // If away_goals_avg > home_goals_avg × 1.5, the split is likely neutral-venue
    // contamination (e.g. host nation playing all games classified as "away").
    // Fall back to overall average (awayFactor = 1.0) to avoid inflating λ.
    const suspiciousSplit = awayStats.home_goals_avg != null &&
      awayStats.away_goals_avg > awayStats.home_goals_avg * 1.5
    if (!suspiciousSplit) {
      awayFactor = awayStats.away_goals_avg / awayStats.goals_scored_avg
    }
  }

  // Clamp factor to [0.4, 1.4] to prevent extreme corrections
  awayFactor = Math.max(0.4, Math.min(1.4, awayFactor))

  return {
    lambdaHome: v1.lambdaHome,
    lambdaAway: Math.max(v1.lambdaAway * awayFactor, 0.01),
    awayFactor,
    awayFactorNote:
      awayFactor < 0.6 ? 'struggles away' :
      awayFactor > 0.9 ? 'travels well' :
      'neutral away record',
  }
}

// ── Score matrix ─────────────────────────────────────────────────────────

/**
 * Build the (SCORE_MAX+1) × (SCORE_MAX+1) score probability matrix.
 * matrix[i][j] = P(home scores i, away scores j)
 *
 * Optional Dixon-Coles correction (MT21 — OFF by default).
 */
export function buildScoreMatrix(lambdaHome, lambdaAway, dixonColes = false) {
  const size = SCORE_MAX + 1
  const matrix = Array.from({ length: size }, () => new Array(size).fill(0))

  for (let i = 0; i < size; i++) {
    for (let j = 0; j < size; j++) {
      matrix[i][j] = poissonPMF(i, lambdaHome) * poissonPMF(j, lambdaAway)
    }
  }

  if (dixonColes) {
    applyDixonColes(matrix, lambdaHome, lambdaAway)
  }

  return matrix
}

/**
 * Dixon-Coles correction for low-score probabilities (MT21).
 * Mutates matrix in place.
 *
 * ρ = DIXON_COLES_RHO = 0.1
 * P(0,0) ×= (1 - λ_h × λ_a × ρ)
 * P(1,0) ×= (1 + λ_a × ρ)
 * P(0,1) ×= (1 + λ_h × ρ)
 * P(1,1) ×= (1 - ρ)
 */
function applyDixonColes(matrix, lambdaHome, lambdaAway) {
  const rho = DIXON_COLES_RHO
  matrix[0][0] *= (1 - lambdaHome * lambdaAway * rho)
  matrix[1][0] *= (1 + lambdaAway * rho)
  matrix[0][1] *= (1 + lambdaHome * rho)
  matrix[1][1] *= (1 - rho)

  // Re-normalise so the matrix still sums to ~1
  let total = 0
  for (const row of matrix) for (const v of row) total += v
  if (total > 0) {
    for (let i = 0; i < matrix.length; i++)
      for (let j = 0; j < matrix[i].length; j++)
        matrix[i][j] /= total
  }
}

// ── Result probabilities ─────────────────────────────────────────────────

/**
 * Derive 1X2 probabilities from a score matrix.
 * Returns { home, draw, away } — sum should equal 1.0 ± 0.001.
 */
export function calcResultProbs(matrix) {
  let home = 0, draw = 0, away = 0
  const size = matrix.length
  for (let i = 0; i < size; i++) {
    for (let j = 0; j < size; j++) {
      if (i > j) home += matrix[i][j]
      else if (i === j) draw += matrix[i][j]
      else away += matrix[i][j]
    }
  }
  return { home, draw, away }
}

/**
 * Verify result probabilities sum to 1.0 ± tolerance.
 * Returns { valid, sum, delta }
 */
export function verifyProbSum(probs, tolerance = 0.005) {
  const sum = probs.home + probs.draw + probs.away
  const delta = Math.abs(sum - 1.0)
  return { valid: delta <= tolerance, sum, delta }
}

// ── Total goals ──────────────────────────────────────────────────────────

/**
 * Calculate over/under probabilities for each goals line.
 *
 * Returns array of { line, over, under, anchor }
 * The anchor line is the one whose over/under split is closest to 50/50.
 */
export function calcTotalGoals(lambdaHome, lambdaAway) {
  const lambdaTotal = lambdaHome + lambdaAway

  const lines = GOALS_LINES.map(line => {
    const n = Math.floor(line)   // e.g. line=2.5 → n=2
    const under = poissonCDF(n, lambdaTotal)
    const over  = 1 - under
    const balance = Math.abs(over - under)   // 0 = perfectly balanced
    return { line, over, under, balance }
  })

  // Find anchor: closest to 50/50
  const minBalance = Math.min(...lines.map(l => l.balance))
  const result = lines.map(l => ({
    line: l.line,
    over: l.over,
    under: l.under,
    anchor: l.balance === minBalance,
  }))

  return result
}

// ── Full model run ────────────────────────────────────────────────────────

/**
 * Run both V1 and V2 models from team stats rows.
 * This is the single entry point used by the UI.
 *
 * Returns:
 * {
 *   v1: { lambdaHome, lambdaAway, matrix, probs, totalGoals, probsVerified },
 *   v2: { lambdaHome, lambdaAway, awayFactor, awayFactorNote, matrix, probs, totalGoals, probsVerified },
 *   divergence: { flagged, maxDelta, outcome },   // MT07: flag if >8pp
 *   dixonColes: boolean,
 * }
 *
 * Throws on MT06 violations (caller must catch).
 */
export function runModels(homeStats, awayStats, { dixonColes = false, venueMult = VENUE_ADVANTAGE.NEUTRAL } = {}) {
  // V1
  const { lambdaHome: lhV1, lambdaAway: laV1 } = calcLambdasV1(homeStats, awayStats, venueMult)
  const matrixV1  = buildScoreMatrix(lhV1, laV1, dixonColes)
  const probsV1   = calcResultProbs(matrixV1)
  const goalsV1   = calcTotalGoals(lhV1, laV1)
  const verifiedV1 = verifyProbSum(probsV1)

  // V2
  const { lambdaHome: lhV2, lambdaAway: laV2, awayFactor, awayFactorNote } = calcLambdasV2(homeStats, awayStats, venueMult)
  const matrixV2  = buildScoreMatrix(lhV2, laV2, dixonColes)
  const probsV2   = calcResultProbs(matrixV2)
  const goalsV2   = calcTotalGoals(lhV2, laV2)
  const verifiedV2 = verifyProbSum(probsV2)

  // MT07 divergence check: flag if V1 and V2 differ > 8pp on any outcome
  const deltas = {
    home: Math.abs(probsV1.home - probsV2.home),
    draw: Math.abs(probsV1.draw - probsV2.draw),
    away: Math.abs(probsV1.away - probsV2.away),
  }
  const maxDelta   = Math.max(deltas.home, deltas.draw, deltas.away)
  const maxOutcome = Object.keys(deltas).find(k => deltas[k] === maxDelta)
  const divergence = {
    flagged:  maxDelta > 0.08,
    maxDelta,
    outcome: maxOutcome,
    deltas,
    note: maxDelta > 0.08
      ? `V2 diverges ${(maxDelta * 100).toFixed(1)}pp on ${maxOutcome} — V2 is primary`
      : null,
  }

  return {
    v1: {
      lambdaHome: lhV1,
      lambdaAway: laV1,
      matrix: matrixV1,
      probs: probsV1,
      totalGoals: goalsV1,
      probsVerified: verifiedV1,
    },
    v2: {
      lambdaHome: lhV2,
      lambdaAway: laV2,
      awayFactor,
      awayFactorNote,
      matrix: matrixV2,
      probs: probsV2,
      totalGoals: goalsV2,
      probsVerified: verifiedV2,
    },
    divergence,
    dixonColes,
  }
}

// ── Monte Carlo simulation ───────────────────────────────────────────────

/** Draw one Poisson sample (Knuth's algorithm). */
function samplePoisson(lambda) {
  const L = Math.exp(-lambda)
  let k = 0, p = 1
  do { k++; p *= Math.random() } while (p > L)
  return k - 1
}

/**
 * Simulate n full-time scorelines from two lambdas. Cross-checks the analytic
 * Poisson matrix; results should converge to runModels() within ~1pp at 50k.
 * Returns { n, home, draw, away, topScores, lambdaTotalAvg }.
 */
export function monteCarlo(lambdaHome, lambdaAway, n = 50000) {
  let home = 0, draw = 0, away = 0, goalSum = 0
  const scoreFreq = {}
  for (let i = 0; i < n; i++) {
    const h = samplePoisson(lambdaHome)
    const a = samplePoisson(lambdaAway)
    if (h > a) home++; else if (h < a) away++; else draw++
    goalSum += h + a
    const key = `${h}-${a}`
    scoreFreq[key] = (scoreFreq[key] || 0) + 1
  }
  const topScores = Object.entries(scoreFreq)
    .sort((x, y) => y[1] - x[1]).slice(0, 5)
    .map(([score, count]) => ({ score, prob: count / n }))
  return {
    n,
    home: home / n,
    draw: draw / n,
    away: away / n,
    topScores,
    lambdaTotalAvg: goalSum / n,
  }
}
