// Indonesian odds format parser
// +N  → decimal = 1 + N/100  (profit N% per 100 staked)
// -N  → decimal = 1 + 100/N  (stake N to profit 100)
// B.L+N  → Over  line L at odds +N
// K.L+N  → Under line L at odds +N
// Fractions: 2.1/2 = 2.5, 1.3/4 = 1.75, 3.1/4 = 3.25, 3.3/4 = 3.75

export function indoToDecimal(n) {
  if (n >= 0) return 1 + n / 100
  return 1 + 100 / Math.abs(n)
}

function parseFraction(str) {
  const m = str.match(/^(\d+)\.(\d+)\/(\d+)$/)
  if (m) return parseInt(m[1]) + parseInt(m[2]) / parseInt(m[3])
  const m2 = str.match(/^(\d+)\/(\d+)$/)
  if (m2) return parseInt(m2[1]) / parseInt(m2[2])
  return parseFloat(str)
}

export function parseIndonesiaOdds(rawText, homeTeam, awayTeam) {
  const lines = rawText.trim().split('\n').filter(l => l.trim())
  const result = { handicap: null, totalGoals: null, raw: rawText }

  const homeKey = homeTeam ? homeTeam.split(' ')[0].toLowerCase() : null
  const awayKey = awayTeam ? awayTeam.split(' ')[0].toLowerCase() : null

  for (const line of lines) {
    const clean = line.trim()

    // ── Total goals: B.2.1/2+20 or K.3+20 ──
    if (/^[BK]\./i.test(clean)) {
      const isBesar = /^B\./i.test(clean)
      // capture: line value (may include fraction) + odds sign+number
      const m = clean.match(/^[BK]\.(\d+(?:\.\d+\/\d+)?)\s*([+-]\d+)/i)
      if (m) {
        result.totalGoals = {
          line: parseFraction(m[1]),
          side: isBesar ? 'over' : 'under',
          odds: indoToDecimal(parseInt(m[2])),
          raw: clean,
        }
      }
      continue
    }

    // ── Handicap / team line ──
    const lc = clean.toLowerCase()
    const hasHome = homeKey && lc.includes(homeKey)
    const hasAway = awayKey && lc.includes(awayKey)

    if (hasHome || hasAway) {
      // Leading odds: "+20 " at start
      const oddsM = clean.match(/^([+-]\d+(?:\.\d+)?)\s+/)
      const rawOdds = oddsM ? parseInt(oddsM[1]) : null

      // Handicap fraction in line: -1.3/4 or -1.1/2
      const hcapFrac = clean.match(/\s([+-])(\d+)\.(\d+)\/(\d+)(?:\s|$)/)
      // Simple handicap: -1 or +0.5 (not the leading odds)
      const hcapSimple = clean.replace(/^[+-]\d+\s+/, '').match(/([+-])(\d+(?:\.\d+)?)(?:\s|$)/)

      let handicapLine = 0
      if (hcapFrac) {
        const sign = hcapFrac[1] === '+' ? 1 : -1
        handicapLine = sign * (parseInt(hcapFrac[2]) + parseInt(hcapFrac[3]) / parseInt(hcapFrac[4]))
      } else if (hcapSimple) {
        const sign = hcapSimple[1] === '+' ? 1 : -1
        const val = parseFloat(hcapSimple[2])
        if (val < 5) handicapLine = sign * val  // avoid matching noise like +20 odds
      }

      const decOdds = rawOdds !== null ? indoToDecimal(rawOdds) : null

      result.handicap = {
        line: handicapLine,
        homeOdds: (hasHome && !hasAway) ? decOdds : null,
        awayOdds: (hasAway && !hasHome) ? decOdds : null,
        raw: clean,
      }
    }
  }

  return result
}
