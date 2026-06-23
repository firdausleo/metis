// src/utils/dcRatings.js
// Dixon-Coles ratings fitted on 15,508 international matches (2010-2026)
// Generated: 2026-06-15 | DO NOT EDIT MANUALLY — regenerate via scripts/fit_dc.py
// mu=0.1158 home_adv=0.2686 rho=-0.0612

export const DC_PARAMS = {
  mu: 0.1158,
  homeAdv: 0.2686,
  rho: -0.0612,
  fittedDate: '2026-06-23',
  matchCount: 15544,
  teams: {
    "Algeria": { att: 0.6067, def: 0.654 },
    "Argentina": { att: 1.3437, def: 1.8908 },
    "Australia": { att: 0.7608, def: 1.7091 },
    "Austria": { att: 0.8962, def: 0.6019 },
    "Belgium": { att: 0.7922, def: 0.6847 },
    "Bosnia-Herzegovina": { att: 0.7003, def: 0.6613 },
    "Brazil": { att: 1.4313, def: 1.9009 },
    "Canada": { att: 1.0616, def: 1.0443 },
    "Cape Verde": { att: 0.3625, def: 1.272 },
    "Colombia": { att: 1.2008, def: 1.0617 },
    "Croatia": { att: 0.8845, def: 0.6872 },
    "Curacao": { att: 0.3277, def: 0.5789 },
    "Czechia": { att: 0.5427, def: 0.2506 },
    "DR Congo": { att: 0.3016, def: 0.7605 },
    "Ecuador": { att: 0.5115, def: 1.2639 },
    "Egypt": { att: 0.4119, def: 0.7754 },
    "England": { att: 1.1712, def: 1.0271 },
    "France": { att: 1.166, def: 0.8609 },
    "Germany": { att: 1.9286, def: 0.6742 },
    "Ghana": { att: 0.29, def: 1.0382 },
    "Haiti": { att: 0.3614, def: 0.4095 },
    "Iran": { att: 0.9649, def: 0.8008 },
    "Iraq": { att: 0.3783, def: 0.6242 },
    "Ivory Coast": { att: 0.7091, def: 1.4404 },
    "Japan": { att: 1.3679, def: 1.3279 },
    "Jordan": { att: 0.3952, def: 0.4861 },
    "Mexico": { att: 0.7577, def: 1.7849 },
    "Morocco": { att: 1.5749, def: 1.5056 },
    "Netherlands": { att: 1.4752, def: 0.9865 },
    "New Zealand": { att: 0.896, def: 0.5715 },
    "Norway": { att: 1.1479, def: 0.5602 },
    "Panama": { att: 0.4782, def: 0.4288 },
    "Paraguay": { att: 0.6071, def: 1.0399 },
    "Portugal": { att: 0.9426, def: 0.8028 },
    "Qatar": { att: 0.3749, def: 0.3486 },
    "Saudi Arabia": { att: 0.4625, def: 0.6408 },
    "Scotland": { att: 0.5001, def: 1.5816 },
    "Senegal": { att: 0.7448, def: 0.772 },
    "South Africa": { att: 0.1655, def: 0.4226 },
    "South Korea": { att: 0.7557, def: 0.7826 },
    "Spain": { att: 0.7968, def: 1.4512 },
    "Sweden": { att: 1.3009, def: 0.4799 },
    "Switzerland": { att: 1.0969, def: 0.6925 },
    "Tunisia": { att: 0.5028, def: 0.3976 },
    "Turkiye": { att: 0.462, def: 0.3554 },
    "USA": { att: 1.723, def: 0.9836 },
    "Uruguay": { att: 0.8344, def: 1.1303 },
    "Uzbekistan": { att: 0.5765, def: 0.8371 },
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
