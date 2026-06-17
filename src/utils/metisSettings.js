const DEFAULTS = {
  dcWeight: 0.65,
  kellyFraction: 0.25,
  minEdge: 0.05,
  maxStakePct: 0.05,
  minProb: 0.03,
  temperature: 1.11,
  tone: 'analyst',
  defaultLang: 'auto',
  responseLength: 'concise',
  showDisclaimer: true,
  includeBetHistory: true,
  includePnl: true,
  matchesInContext: 10,
  flagStakePct: 0.20,
  showRiskWarnings: true,
}

export function getMetisSettings() {
  try {
    const s = localStorage.getItem('metis_settings')
    return s ? { ...DEFAULTS, ...JSON.parse(s) } : { ...DEFAULTS }
  } catch { return { ...DEFAULTS } }
}

export function saveMetisSettings(settings) {
  localStorage.setItem('metis_settings', JSON.stringify(settings))
}

export { DEFAULTS as METIS_DEFAULTS }
