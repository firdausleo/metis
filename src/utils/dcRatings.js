// src/utils/dcRatings.js
// Dixon-Coles ratings fitted on 15,508 international matches (2010-2026)
// Generated: 2026-06-15 | DO NOT EDIT MANUALLY — regenerate via scripts/fit_dc.py
// mu=0.1158 home_adv=0.2686 rho=-0.0612

export const DC_PARAMS = {
  mu: 0.1158,
  homeAdv: 0.2686,
  rho: -0.0612,
  fittedDate: '2026-06-17',
  matchCount: 15524,
  teams: {
    "Algeria":      { att: 0.7756, def: 0.6335 },
    "Argentina":    { att: 1.2256, def: 1.521  },
    "Australia":    { att: 0.7802, def: 1.0268 },
    "Austria":      { att: 0.6392, def: 0.6171 },
    "Belgium":      { att: 0.8703, def: 0.7109 },
    "Brazil":       { att: 1.2398, def: 1.1681 },
    "Canada":       { att: 0.6898, def: 0.7759 },
    "Colombia":     { att: 1.1652, def: 1.1233 },
    "Costa Rica":   { att: 0.5287, def: 0.3924 },
    "Croatia":      { att: 0.7021, def: 0.6929 },
    "Czechia":      { att: 0.521,  def: 0.3722 },
    "DR Congo":     { att: 0.2374, def: 0.7108 },
    "Denmark":      { att: 0.6898, def: 0.7397 },
    "Ecuador":      { att: 0.7858, def: 1.2509 },
    "Egypt":        { att: 0.3857, def: 0.6973 },
    "England":      { att: 0.9148, def: 1.0847 },
    "France":       { att: 0.9505, def: 0.8609 },
    "Germany":      { att: 1.0652, def: 0.6532 },
    "Ghana":        { att: 0.2862, def: 0.3843 },
    "Haiti":        { att: 0.5357, def: 0.2367 },
    "Honduras":     { att: 0.2302, def: 0.3541 },
    "Iran":         { att: 0.8524, def: 0.831  },
    "Iraq":         { att: 0.3673, def: 0.6146 },
    "Ivory Coast":  { att: 0.5424, def: 0.7478 },
    "Japan":        { att: 1.0057, def: 0.9518 },
    "Mexico":       { att: 0.7681, def: 0.9748 },
    "Morocco":      { att: 0.702,  def: 1.1311 },
    "Netherlands":  { att: 0.9734, def: 0.6831 },
    "New Zealand":  { att: 0.6347, def: 0.5924 },
    "Nigeria":      { att: 0.6635, def: 0.578  },
    "Norway":       { att: 0.8893, def: 0.5712 },
    "Panama":       { att: 0.6042, def: 0.4326 },
    "Portugal":     { att: 0.9923, def: 0.867  },
    "Qatar":        { att: 0.4137, def: 0.1831 },
    "Saudi Arabia": { att: 0.2885, def: 0.5892 },
    "Senegal":      { att: 0.7447, def: 0.7528 },
    "Serbia":       { att: 0.4324, def: 0.4957 },
    "South Africa": { att: 0.2092, def: 0.4092 },
    "South Korea":  { att: 0.8153, def: 0.6949 },
    "Spain":        { att: 1.141,  def: 0.9349 },
    "Sweden":       { att: 0.7614, def: 0.3429 },
    "Switzerland":  { att: 0.7938, def: 0.6516 },
    "Tunisia":      { att: 0.65,   def: 0.55   },
    "Turkey":       { att: 0.7033, def: 0.4377 },
    "USA":          { att: 0.8076, def: 0.6682 },
    "Uruguay":      { att: 0.886,  def: 1.2223 },
    "Uzbekistan":   { att: 0.5149, def: 0.8727 },
    "Bosnia-Herzegovina": { att: 0.55, def: 0.48 },
    "Cape Verde":   { att: 0.45,   def: 0.38   },
    "Curacao":      { att: 0.42,   def: 0.35   },
    "Jordan":       { att: 0.38,   def: 0.42   },
    "Scotland":     { att: 0.62,   def: 0.58   },
    "Paraguay":     { att: 0.58,   def: 0.52   },
  }
}

export const TEMP_T = 1.11

export function applyTemperature(probs, T = TEMP_T) {
  const scaled = probs.map(p => Math.pow(Math.max(p, 1e-10), 1 / T))
  const sum = scaled.reduce((a, b) => a + b, 0)
  return scaled.map(p => p / sum)
}

const WC2026_HOSTS = new Set(['USA', 'Canada', 'Mexico'])
export function isWC2026Host(teamName) {
  return WC2026_HOSTS.has(teamName)
}

export function dcLambdas(home, away, homeIsHost = false) {
  const { mu, homeAdv, teams } = DC_PARAMS
  const h = teams[home] || { att: 0, def: 0 }
  const a = teams[away] || { att: 0, def: 0 }
  const ha = homeIsHost ? homeAdv : 0
  const lh = Math.exp(mu + ha + h.att - a.def)
  const la = Math.exp(mu + a.att - h.def)
  return { lh, la }
}

export function dcCorrection(lh, la, x, y) {
  const rho = DC_PARAMS.rho
  if (x === 0 && y === 0) return Math.max(1 - lh * la * rho, 0.001)
  if (x === 1 && y === 0) return Math.max(1 + la * rho, 0.001)
  if (x === 0 && y === 1) return Math.max(1 + lh * rho, 0.001)
  if (x === 1 && y === 1) return Math.max(1 - rho, 0.001)
  return 1.0
}

export function poissonPMF(k, lambda) {
  if (lambda <= 0) return k === 0 ? 1 : 0
  let logP = k * Math.log(lambda) - lambda
  for (let i = 1; i <= k; i++) logP -= Math.log(i)
  return Math.exp(logP)
}

export function dcScoreMatrix(lh, la, maxG = 8) {
  const M = []
  let total = 0
  for (let x = 0; x <= maxG; x++) {
    M[x] = []
    for (let y = 0; y <= maxG; y++) {
      const v = poissonPMF(x, lh) * poissonPMF(y, la)
                * dcCorrection(lh, la, x, y)
      M[x][y] = Math.max(v, 0)
      total += v
    }
  }
  for (let x = 0; x <= maxG; x++)
    for (let y = 0; y <= maxG; y++)
      M[x][y] /= total
  return M
}

export function blendedLambdas(home, away, m7Home, m7Away,
                                homeIsHost = false, wDC = 0.65) {
  const { lh: dcH, la: dcA } = dcLambdas(home, away, homeIsHost)
  const wM7 = 1 - wDC
  return {
    lh: wDC * dcH + wM7 * (m7Home || dcH),
    la: wDC * dcA + wM7 * (m7Away || dcA)
  }
}

export function matrixStats(M, maxG = 8) {
  let homeWin = 0, draw = 0, awayWin = 0, over25 = 0, btts = 0
  const totals = Array(maxG * 2 + 1).fill(0)
  const scores = []
  for (let x = 0; x <= maxG; x++) {
    for (let y = 0; y <= maxG; y++) {
      const p = M[x][y]
      if (x > y) homeWin += p
      else if (x === y) draw += p
      else awayWin += p
      if (x + y >= 3) over25 += p
      if (x >= 1 && y >= 1) btts += p
      totals[x + y] += p
      scores.push({ score: `${x}-${y}`, prob: p })
    }
  }
  scores.sort((a, b) => b.prob - a.prob)
  const [pw, pd, pl] = applyTemperature([homeWin, draw, awayWin])
  return {
    homeWin: Math.round(pw * 1000) / 1000,
    draw: Math.round(pd * 1000) / 1000,
    awayWin: Math.round(pl * 1000) / 1000,
    over25: Math.round(over25 * 1000) / 1000,
    under25: Math.round((1 - over25) * 1000) / 1000,
    btts: Math.round(btts * 1000) / 1000,
    topScores: scores.slice(0, 12),
    totalGoals: totals
      .map((p, g) => ({ goals: g, prob: Math.round(p * 1000) / 1000 }))
      .filter(g => g.prob > 0.005)
  }
}
