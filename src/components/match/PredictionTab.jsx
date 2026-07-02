import { useState, useEffect, useMemo } from 'react'
import { useTranslation } from '../../lib/i18n'
import { useUser } from '../../context/UserContext'
import { getFlag } from '../../lib/teamFlags'
import { SCORE_MAX, poissonPMF } from '../../lib/poisson'
import { getRangeProbabilities } from '../../utils/pasp'
import InfoTooltip from '../InfoTooltip'
import { supabase } from '../../lib/supabase'

// ── Rank → color mapping (gold #1 / navy #2 / green #3 / gray #4+) ────────
const RANK_COLORS = { 1: '#C9A84C', 2: '#1A3A6C', 3: '#2D7A4F' }
function getRankColor(rank) {
  return RANK_COLORS[rank] || (rank <= 5 ? '#6B7280' : '#9CA3AF')
}

// ── Compact matrix cell ───────────────────────────────────────────────────

function MatrixCell({ value, isMax }) {
  const intensity = Math.min(value * 12, 0.9)
  const textColor = intensity > 0.45 ? '#FFFFFF' : 'var(--color-text-primary)'
  return (
    <div style={{
      height: 38, borderRadius: 4,
      background: isMax ? `rgba(45,122,79,${intensity + 0.15})` : `rgba(45,122,79,${intensity})`,
      border: isMax ? '2px solid var(--color-accent)' : '0.5px solid var(--color-border-light)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 12, color: isMax ? '#FFFFFF' : textColor,
      fontWeight: isMax ? 800 : intensity > 0.3 ? 600 : 400,
    }}>
      {(value * 100).toFixed(1)}
    </div>
  )
}

// ── Compact score matrix with axis labels ────────────────────────────────

function MiniMatrix({ matrix, homeTeam, awayTeam }) {
  const size = SCORE_MAX + 1
  const flat = matrix.flat()
  const maxVal = Math.max(...flat)
  return (
    <div style={{ overflowX: 'auto' }}>
      <div style={{ display: 'flex', gap: 4, alignItems: 'stretch', minWidth: 360 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 16, flexShrink: 0 }}>
          <span style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', fontSize: 10, fontWeight: 600, color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>
            {getFlag(homeTeam)} {homeTeam} ↓
          </span>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ textAlign: 'center', fontSize: 10, fontWeight: 600, color: 'var(--color-text-muted)', marginBottom: 4 }}>
            {getFlag(awayTeam)} {awayTeam} →
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: `24px repeat(${size}, 1fr)`, gap: 2, marginBottom: 2 }}>
            <div />
            {Array.from({ length: size }, (_, j) => (
              <div key={j} style={{ textAlign: 'center', fontSize: 12, color: 'var(--color-text-primary)', fontWeight: 700 }}>{j}</div>
            ))}
          </div>
          {matrix.map((row, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: `24px repeat(${size}, 1fr)`, gap: 2, marginBottom: 2 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: 'var(--color-text-muted)', fontWeight: 600 }}>{i}</div>
              {row.map((v, j) => <MatrixCell key={j} value={v} isMax={v === maxVal} />)}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Compact stats card ───────────────────────────────────────────────────

function CompactTeamStats({ teamStats, teamName, isHome, t }) {
  if (!teamStats) return (
    <div style={{ flex: 1, minWidth: 0, background: 'var(--color-bg-elevated)', border: '0.5px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '12px 14px' }}>
      <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: 6 }}>{getFlag(teamName)} {teamName}</p>
      <p style={{ fontSize: 13, color: 'var(--color-text-muted)', fontStyle: 'italic' }}>{t('analysis.noStats')}</p>
    </div>
  )

  const form = teamStats.form_string?.slice(0, 5).split('') || []
  const formColour = { W: 'var(--color-success)', D: 'var(--color-warning)', L: 'var(--color-danger)' }
  const gw = teamStats.games_window ?? 0
  const qualBg = gw >= 5 ? '#EAF3DE' : gw >= 3 ? '#FAEEDA' : '#FCEBEB'
  const qualCol = gw >= 5 ? '#27500A' : gw >= 3 ? '#633806' : '#791F1F'

  return (
    <div style={{ flex: 1, minWidth: 0, background: 'var(--color-bg-elevated)', border: '0.5px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '12px 14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, flexWrap: 'wrap', gap: 4 }}>
        <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text-primary)' }}>{getFlag(teamName)} {teamName}</p>
        <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 99, background: qualBg, color: qualCol }}>{gw} games</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 8 }}>
        {[
          { label: 'Scored/G', val: teamStats.goals_scored_avg?.toFixed(2) },
          { label: 'Conceded/G', val: teamStats.goals_conceded_avg?.toFixed(2) },
        ].map(({ label, val }) => (
          <div key={label} style={{ background: 'var(--color-bg-card)', border: '0.5px solid var(--color-border)', borderRadius: 4, padding: '6px 8px' }}>
            <p style={{ fontSize: 10, color: 'var(--color-text-muted)', marginBottom: 2 }}>{label}</p>
            <p style={{ fontFamily: 'var(--font-display)', fontSize: 19, fontWeight: 600, color: 'var(--color-text-primary)' }}>{val ?? '—'}</p>
          </div>
        ))}
      </div>
      {form.length > 0 && (
        <div style={{ display: 'flex', gap: 4 }}>
          <span style={{ fontSize: 11, color: 'var(--color-text-muted)', fontWeight: 600 }}>FORM</span>
          {form.map((c, i) => (
            <span key={i} style={{ width: 18, height: 18, borderRadius: '50%', background: formColour[c] || 'var(--color-text-muted)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#000' }}>{c}</span>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Collapsible wrapper ──────────────────────────────────────────────────

function Collapsible({ label, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div style={{ border: '0.5px solid var(--color-border)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '12px 14px', background: 'var(--color-bg-card)', border: 'none', cursor: 'pointer',
          fontFamily: 'var(--font-ui)', fontSize: 13, fontWeight: 600, color: 'var(--color-text-primary)',
          minHeight: 44,
        }}
      >
        {label}
        <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{open ? '▲' : '▼'}</span>
      </button>
      {open && <div style={{ padding: '12px 14px', background: 'var(--color-bg-card)', borderTop: '0.5px solid var(--color-border)' }}>{children}</div>}
    </div>
  )
}

// ── Edge colour helper ───────────────────────────────────────────────────

function edgeColour(prob) {
  if (prob >= 0.55) return 'var(--color-success)'
  if (prob >= 0.40) return 'var(--color-accent)'
  if (prob >= 0.28) return 'var(--color-warning)'
  return 'var(--color-text-muted)'
}

// ── AI role helpers ──────────────────────────────────────────────────────

const ROLE_META = {
  1:  { name: 'Statistical Validator', icon: '📊' },
  2:  { name: 'Form Intelligence',     icon: '📈' },
  3:  { name: 'Deep Analysis',         icon: '🧠' },
  4:  { name: 'Tournament Context',    icon: '🏆' },
  5:  { name: 'Market Intelligence',   icon: '💹' },
  6:  { name: 'Risk Manager',          icon: '🛡️' },
  7:  { name: 'Tactical Analyst',      icon: '⚽' },
  8:  { name: 'Head-to-Head Historian',icon: '📜' },
  9:  { name: 'Motivation Analyst',    icon: '🔥' },
  10: { name: 'Composite Scorer',      icon: '🎯' },
}

const REC_COLOURS = {
  home_win: 'var(--color-accent)', away_win: 'var(--color-info)', draw: 'var(--color-warning)',
  over: 'var(--color-success)', under: 'var(--color-text-secondary)',
  value_home: 'var(--color-accent)', value_away: 'var(--color-info)',
}

function normaliseOutput(raw) {
  if (!raw) return null
  if (typeof raw === 'object') return raw
  try { return JSON.parse(String(raw).replace(/```json\n?|\n?```/g, '').trim()) }
  catch { return { summary: String(raw).slice(0, 300), confidence: null, recommendation: null, signals: [], flags: ['parse_error'] } }
}

function RoleConfBar({ value }) {
  if (value == null) return <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>—</span>
  const pct = Math.round(value * 100)
  const color = pct >= 70 ? 'var(--color-success)' : pct >= 45 ? 'var(--color-warning)' : 'var(--color-danger)'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 3 }}>
      <div style={{ flex: 1, height: 4, background: 'var(--color-bg)', border: '0.5px solid var(--color-border)', borderRadius: 99, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 99 }} />
      </div>
      <span style={{ fontSize: 12, fontWeight: 700, color, minWidth: 30 }}>{pct}%</span>
    </div>
  )
}

function AiRoleCard({ output_json, isComposite }) {
  const [expanded, setExpanded] = useState(false)
  const out = normaliseOutput(output_json)
  const roleNum = out?.role
  const meta = ROLE_META[roleNum] || { name: `Role ${roleNum || '?'}`, icon: '🔹' }
  const rec = out?.recommendation
  const recColor = REC_COLOURS[rec] || 'var(--color-text-muted)'

  return (
    <div style={{
      background: 'var(--color-bg-card)',
      border: isComposite ? '1.5px solid var(--color-accent)' : '0.5px solid var(--color-border)',
      borderRadius: 'var(--radius-md)', overflow: 'hidden',
    }}>
      <button
        onClick={() => setExpanded(v => !v)}
        style={{
          width: '100%', padding: '12px 14px',
          background: isComposite ? 'var(--color-accent-dim)' : 'none',
          border: 'none', cursor: 'pointer', textAlign: 'left',
          display: 'flex', alignItems: 'center', gap: 10, minHeight: 44,
        }}
      >
        <span style={{ fontSize: 18, flexShrink: 0 }}>{meta.icon}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: 14, fontWeight: isComposite ? 700 : 600, color: isComposite ? 'var(--color-accent)' : 'var(--color-text-primary)' }}>
            {isComposite ? '★ ' : ''}{meta.name}
          </span>
          {out && <RoleConfBar value={out.confidence} />}
        </div>
        {rec && rec !== 'null' && (
          <span style={{
            fontSize: 12, fontWeight: 700, color: recColor,
            padding: '2px 7px', background: `${recColor}22`,
            border: `0.5px solid ${recColor}`, borderRadius: 99, flexShrink: 0,
          }}>
            {rec.replace(/_/g, ' ').toUpperCase()}
          </span>
        )}
        <span style={{ color: 'var(--color-text-muted)', fontSize: 12, flexShrink: 0 }}>{expanded ? '▲' : '▼'}</span>
      </button>
      {expanded && out && (
        <div style={{ padding: '10px 14px 14px', borderTop: '0.5px solid var(--color-border)' }}>
          {out.summary && (
            <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', lineHeight: 1.6, marginBottom: 8 }}>{out.summary}</p>
          )}
          {out.signals?.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {out.signals.slice(0, 5).map((sig, i) => {
                const isPos = !sig.toLowerCase().includes('⚠') &&
                  !sig.toLowerCase().includes('risk') &&
                  !sig.toLowerCase().includes('weak') &&
                  !sig.toLowerCase().includes('concern')
                return (
                  <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                    <span style={{ color: isPos ? 'var(--color-success)' : 'var(--color-warning)', flexShrink: 0 }}>{isPos ? '✓' : '⚠'}</span>
                    <span style={{ fontSize: 13, color: 'var(--color-text-secondary)', lineHeight: 1.4 }}>{sig}</span>
                  </div>
                )
              })}
            </div>
          )}
          {out.flags?.includes('parse_error') && (
            <p style={{ fontSize: 12, color: 'var(--color-danger)', marginTop: 6 }}>⚠ Output parse error</p>
          )}
        </div>
      )}
    </div>
  )
}

// ── Strategic context helpers ────────────────────────────────────────────

function computeGroupStandings(matches) {
  const teams = {}
  const sorted = [...matches].sort((a, b) => new Date(a.match_date || 0) - new Date(b.match_date || 0))
  for (const m of sorted) {
    if (m.home_score == null || m.away_score == null) continue
    for (const tm of [m.home_team, m.away_team])
      if (!teams[tm]) teams[tm] = { team: tm, played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, pts: 0, form: [] }
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
    .map(tm => ({ ...tm, gd: tm.gf - tm.ga }))
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

function _getModelAnchor(lh, la) {
  const sum = lh + la
  if (sum < 2.0) return 1
  if (sum < 2.8) return 2
  if (sum < 3.8) return 3
  if (sum < 4.8) return 4
  return 5
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

const R32_BRACKET = {
  A: { win: '3rd C/E/F/H/I', lose: '2nd G' },
  B: { win: '3rd A/B/C/D/F', lose: '2nd H' },
  C: { win: '3rd A/B/D/E/J', lose: '2nd F' },
  D: { win: '3rd B/C/F/G/I', lose: '2nd E' },
  E: { win: '3rd A/C/D/G/H', lose: '2nd D' },
  F: { win: '3rd B/D/E/G/J', lose: '2nd C' },
  G: { win: '3rd A/B/C/H/I', lose: '2nd F' },
  H: { win: '3rd D/E/F/I/J', lose: '2nd G' },
  I: { win: '3rd A/B/C/D/E', lose: '2nd J' },
  J: { win: '3rd F/G/H/I/K', lose: '2nd I' },
  K: { win: '3rd G/H/I/J/L', lose: '2nd L' },
  L: { win: '3rd H/I/J/K/L', lose: '2nd K' },
}
const R16_HALF = {
  A: 'Top', B: 'Top', C: 'Top', D: 'Top',
  E: 'Top', F: 'Top', G: 'Top', H: 'Top',
  I: 'Bottom', J: 'Bottom', K: 'Bottom', L: 'Bottom',
}

function parseSlot(slot) {
  const m = slot.match(/(\d+)(?:st|nd|rd|th)\s+(.+)/)
  if (!m) return { pos: 1, groups: [] }
  return { pos: parseInt(m[1]), groups: m[2].split('/').map(s => s.trim()) }
}
function teamAtPos(ags, group, pos) {
  const st = ags[group]
  return (st && st[pos - 1]) ? st[pos - 1].team : null
}
function computeR32(group, ags) {
  const br = R32_BRACKET[group]
  if (!br) return null
  const { pos: wp, groups: wg } = parseSlot(br.win)
  const { pos: lp, groups: lg } = parseSlot(br.lose)
  return {
    ifFirst:  { slot: br.win,  opponents: wg.map(g => teamAtPos(ags, g, wp)).filter(Boolean) },
    ifSecond: { slot: br.lose, opponent: lg.length === 1 ? teamAtPos(ags, lg[0], lp) : null },
  }
}
function diffLabel(pts) {
  if (pts === 0) return { label: 'Easy',   color: '#2D7A4F' }
  if (pts <= 2)  return { label: 'Medium', color: '#BA7517' }
  return              { label: 'Hard',   color: '#ef4444' }
}
function r32Diff(r32, ags, ifFirst) {
  if (!r32) return null
  if (ifFirst) {
    const ptsList = r32.ifFirst.opponents.map(opp => {
      for (const g of Object.keys(ags)) { const tm = ags[g].find(s => s.team === opp); if (tm) return tm.pts }
      return 0
    })
    return diffLabel(ptsList.length ? Math.max(0, ...ptsList) : 0)
  }
  const opp = r32.ifSecond.opponent
  if (!opp) return { label: 'Medium', color: '#BA7517' }
  for (const g of Object.keys(ags)) { const tm = ags[g].find(s => s.team === opp); if (tm) return diffLabel(tm.pts) }
  return { label: 'Medium', color: '#BA7517' }
}
function dangerTeams(group, ags) {
  const half = R16_HALF[group]
  if (!half) return []
  return Object.keys(R16_HALF)
    .filter(g => R16_HALF[g] === half && g !== group)
    .map(g => ags[g]?.[0])
    .filter(Boolean)
    .sort((a, b) => b.pts - a.pts || b.gd - a.gd)
    .slice(0, 2)
    .map(tm => tm.team)
}
function md3Impl(winToday, md3Opp, md3Str) {
  if (!md3Opp) return null
  if (winToday && md3Str === 'Weak')    return `Can rotate squad vs ${md3Opp}. Top 2 virtually secured.`
  if (winToday && md3Str === 'Strong')  return `Still needs MD3 focus vs ${md3Opp}. Win today = good but not safe.`
  if (!winToday && md3Str === 'Weak')   return `Must beat ${md3Opp} in MD3 to qualify. Doable — they're likely eliminated.`
  if (!winToday && md3Str === 'Strong') return `Dangerous — must beat strong ${md3Opp} in MD3. Draw today is risky.`
  return null
}
function qualStatus(pts) {
  if (pts >= 4) return { label: 'Safe ✓',        color: '#2D7A4F' }
  if (pts >= 2) return { label: 'In contention',  color: '#BA7517' }
  if (pts >= 1) return { label: 'At risk',         color: '#C9A84C' }
  return              { label: 'Eliminated ✗',   color: '#ef4444' }
}
function chessLine(name, mot, scen, md3Opp, md3Str) {
  if (mot >= 4) {
    const sfx = md3Opp ? ` and forces full-strength MD3 vs ${md3Opp}.` : '.'
    return scen.win.label === 'Guaranteed top 2'
      ? `${name} must WIN today — draw leaves R32 at risk${sfx}`
      : `${name} must WIN — anything less creates critical MD3 pressure.`
  }
  if (mot <= 2) return `${name} is already safe — expect rotation and conservative play.`
  if (md3Str === 'Strong') return `WIN preferred for ${name} to avoid a dangerous MD3 vs ${md3Opp}.`
  return `${name} comfortable — WIN locks top-2 spot, draw still workable.`
}

// ── PredictionTab ────────────────────────────────────────────────────────

export default function PredictionTab({
  match, stats, statsLoading, statsError,
  isAdmin, refreshing, onRefresh, onSaveManual, lastUpdated,
  sidebarModel, aiComposite,
  roleOutputs, aiRoles, aiRunning, aiRunError, aiRunMsg, onRunAI,
}) {
  const { t, lang } = useTranslation()
  const { tier, credits } = useUser()
  const v3 = sidebarModel?.v3
  const v1 = sidebarModel?.v1
  const hasModel = !!v3
  const mono = "'IBM Plex Mono', monospace"

  const [stratCtx, setStratCtx] = useState(null)
  const [stratLoading, setStratLoading] = useState(false)
  const [v4Pred, setV4Pred] = useState(null)
  const [storedPred, setStoredPred] = useState(null)
  const [scoresModel, setScoresModel] = useState('v3')

  // Stored predictions from DB (V4 + V3 frozen pre-match data)
  useEffect(() => {
    if (!match?.id) return
    supabase.from('model_predictions')
      .select('v4_home_win, v4_draw, v4_away_win, v4_lambda_home, v4_lambda_away, v3_home_win, v3_draw, v3_away_win, v3_lambda_home, v3_lambda_away, v3_top_score, v3_top_score_2, v3_top_score_3, predicted_at')
      .eq('match_id', match.id)
      .maybeSingle()
      .then(({ data }) => {
        if (data?.v4_home_win != null) setV4Pred(data)
        else setV4Pred(null)
        setStoredPred(data || null)
      })
      .catch(() => {})
  }, [match?.id])

  // Strategic context: group standings + remaining fixtures + all-group standings
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
      supabase.from('matches')
        .select('home_team, away_team, home_score, away_score, group_name')
        .eq('status', 'finished')
        .not('group_name', 'is', null),
    ]).then(([finRes, upRes, allRes]) => {
      const finished = finRes.data || []
      const upcoming = (upRes.data || []).filter(f =>
        f.home_team === match.home_team || f.away_team === match.home_team ||
        f.home_team === match.away_team || f.away_team === match.away_team
      )
      const byGroup = {}
      for (const row of (allRes.data || [])) {
        if (!row.group_name) continue
        if (!byGroup[row.group_name]) byGroup[row.group_name] = []
        byGroup[row.group_name].push(row)
      }
      const ags = {}
      for (const g of Object.keys(byGroup)) ags[g] = computeGroupStandings(byGroup[g])

      const standings = computeGroupStandings(finished)
      const getStat = team => standings.find(s => s.team === team) || { pts: 0, gd: 0, gf: 0, ga: 0, played: 0, form: [] }
      const hStat = getStat(match.home_team)
      const aStat = getStat(match.away_team)
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
        const s = standings.find(tm => tm.team === opp)
        return (s?.pts || 0) >= 3 ? 'Strong' : (s?.pts || 0) >= 1 ? 'Medium' : 'Weak'
      }
      const hMD3 = md3Opp(match.home_team)
      const aMD3 = md3Opp(match.away_team)
      const grp = match.group_name
      setStratCtx({
        standings, matchday, ags,
        hStat, aStat, hMot, aMot,
        hScen: computeScenarios(hStat.pts),
        aScen: computeScenarios(aStat.pts),
        hMD3, aMD3,
        hMD3Str: md3Str(hMD3),
        aMD3Str: md3Str(aMD3),
        r32: computeR32(grp, ags),
        r16Half: R16_HALF[grp] || '?',
        danger: dangerTeams(grp, ags),
      })
      setStratLoading(false)
    }).catch(() => setStratLoading(false))
  }, [match?.id, match?.group_name, match?.home_team, match?.away_team])

  // Tactical signal — derived from stratCtx + v3 lambdas
  const stratSignal = useMemo(() => {
    if (!stratCtx || !v3) return null
    const lh = Number(v3.lambdaHome || 1.5)
    const la = Number(v3.lambdaAway || 1.5)
    const v3Anchor = _getModelAnchor(lh, la)
    return { ...computeTacticalSignal(stratCtx.hMot, stratCtx.aMot, v3Anchor), v3Anchor }
  }, [stratCtx, v3])

  // ── V4 top scorelines (pure DC, computed client-side from v4 lambdas) ────
  const v4TopScores = useMemo(() => {
    if (!v4Pred?.v4_lambda_home || !v4Pred?.v4_lambda_away) return null
    const lh = Number(v4Pred.v4_lambda_home), la = Number(v4Pred.v4_lambda_away)
    const RHO = -0.0612, MG = SCORE_MAX
    const raw = Array.from({ length: MG + 1 }, () => new Array(MG + 1).fill(0))
    let total = 0
    for (let x = 0; x <= MG; x++) {
      for (let y = 0; y <= MG; y++) {
        let tau = 1
        if (x === 0 && y === 0) tau = 1 - lh * la * RHO
        else if (x === 0 && y === 1) tau = 1 + lh * RHO
        else if (x === 1 && y === 0) tau = 1 + la * RHO
        else if (x === 1 && y === 1) tau = 1 - RHO
        raw[x][y] = Math.max(poissonPMF(x, lh) * poissonPMF(y, la) * tau, 0)
        total += raw[x][y]
      }
    }
    const cells = []
    for (let x = 0; x <= MG; x++)
      for (let y = 0; y <= MG; y++)
        cells.push({ score: `${x}-${y}`, prob: total > 0 ? raw[x][y] / total : 0 })
    cells.sort((a, b) => b.prob - a.prob)
    return cells.slice(0, 6)
  }, [v4Pred])

  const isFinished = match?.status === 'finished'

  // Frozen pre-match scorelines for finished matches — computed from stored lambdas
  const frozenTopScores = useMemo(() => {
    if (!isFinished || !storedPred?.v3_top_score) return null
    const scores = [storedPred.v3_top_score, storedPred.v3_top_score_2, storedPred.v3_top_score_3].filter(Boolean)
    const lh = storedPred.v3_lambda_home != null ? Number(storedPred.v3_lambda_home) : null
    const la = storedPred.v3_lambda_away != null ? Number(storedPred.v3_lambda_away) : null
    if (lh == null || la == null) return scores.map(s => ({ score: s, prob: 0 }))
    const RHO = -0.0612, MG = SCORE_MAX
    const dcM = [], v1M = []; let dcT = 0, v1T = 0
    for (let x = 0; x <= MG; x++) {
      dcM[x] = []; v1M[x] = []
      for (let y = 0; y <= MG; y++) {
        let tau = 1
        if (x === 0 && y === 0) tau = 1 - lh * la * RHO
        else if (x === 0 && y === 1) tau = 1 + lh * RHO
        else if (x === 1 && y === 0) tau = 1 + la * RHO
        else if (x === 1 && y === 1) tau = 1 - RHO
        dcM[x][y] = Math.max(poissonPMF(x, lh) * poissonPMF(y, la) * tau, 0)
        v1M[x][y] = poissonPMF(x, lh) * poissonPMF(y, la)
        dcT += dcM[x][y]; v1T += v1M[x][y]
      }
    }
    if (dcT > 0) for (let x = 0; x <= MG; x++) for (let y = 0; y <= MG; y++) dcM[x][y] /= dcT
    if (v1T > 0) for (let x = 0; x <= MG; x++) for (let y = 0; y <= MG; y++) v1M[x][y] /= v1T
    const blendM = []; let bT = 0
    for (let x = 0; x <= MG; x++) {
      blendM[x] = []
      for (let y = 0; y <= MG; y++) { blendM[x][y] = 0.65 * dcM[x][y] + 0.35 * v1M[x][y]; bT += blendM[x][y] }
    }
    if (bT > 0) for (let x = 0; x <= MG; x++) for (let y = 0; y <= MG; y++) blendM[x][y] /= bT
    return scores.map(s => {
      const [gx, gy] = s.split('-').map(Number)
      return { score: s, prob: blendM[gx]?.[gy] ?? 0 }
    })
  }, [isFinished, storedPred])

  // ── AI Verdict section ──────────────────────────────────────────────────
  const rawRec = aiComposite?.recommendation
  const normRec =
    rawRec === 'home_win' || rawRec === 'value_home' ? 'home' :
    rawRec === 'away_win' || rawRec === 'value_away' ? 'away' :
    rawRec === 'draw' ? 'draw' : null
  const aiConf = aiComposite?.confidence != null ? Math.round(aiComposite.confidence * 100) : null
  const recLabel = { home: match?.home_team, draw: 'Draw', away: match?.away_team }

  const lastAiRun = roleOutputs?.length
    ? new Date(Math.max(...roleOutputs.map(o => new Date(o.created_at)))).toLocaleString('zh-CN', {
        timeZone: 'Asia/Shanghai', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: false,
      })
    : null

  // ── Total goals table ────────────────────────────────────────────────────
  const goalsSorted = v3?.totalGoals
    ? [...v3.totalGoals].sort((a, b) => b.prob - a.prob).slice(0, 8)
    : []

  const kStarEntry = goalsSorted[0] ?? null
  const kStar = kStarEntry?.goals ?? null

  // rank map: goal count → rank by probability across full distribution (1 = highest)
  const rankMap = {}
  ;[...(v3?.totalGoals || [])].sort((a, b) => b.prob - a.prob)
    .forEach((item, idx) => { rankMap[item.goals] = idx + 1 })
  const goalProbMap = {}
  ;(v3?.totalGoals || []).forEach(item => { goalProbMap[item.goals] = item.prob })
  const getGoalP = g => goalProbMap[g] || 0

  const anchorEntry = v1?.totalGoals?.find(g => g.anchor)

  // hasAiResult: true only when role 10 output is present
  const role10ForCheck = roleOutputs?.find(r => r.ai_roles?.role_number === 10)
  const hasAiResult = Array.isArray(roleOutputs) && roleOutputs.length > 0 && !!role10ForCheck

  const frozenProbs = (isFinished && storedPred?.v3_home_win != null)
    ? { home: Number(storedPred.v3_home_win), draw: Number(storedPred.v3_draw), away: Number(storedPred.v3_away_win) }
    : null
  const activeProbs = frozenProbs ?? v3?.probs
  const activeLambdaHome = (isFinished && storedPred?.v3_lambda_home != null) ? Number(storedPred.v3_lambda_home) : v3?.lambdaHome
  const activeLambdaAway = (isFinished && storedPred?.v3_lambda_away != null) ? Number(storedPred.v3_lambda_away) : v3?.lambdaAway
  const dominant = activeProbs
    ? activeProbs.home >= activeProbs.away && activeProbs.home >= activeProbs.draw ? 'home'
    : activeProbs.away > activeProbs.home && activeProbs.away >= activeProbs.draw ? 'away'
    : 'draw'
    : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

      {/* ── AI Analysis section ── */}
      {!hasAiResult && !aiRunning && (
        <div style={{ textAlign: 'center', padding: '1.5rem 1rem' }}>
          <p style={{ fontSize: '13px', color: 'var(--color-text-secondary)', marginBottom: '12px' }}>
            {lang === 'zh'
              ? '运行AI分析以获取专项见解和综合置信评分'
              : 'Run AI analysis to get specialist insights and a composite confidence score'}
          </p>
          <button
            onClick={onRunAI}
            disabled={!onRunAI}
            style={{
              background: '#1A3A6C',
              color: 'white',
              border: 'none',
              borderRadius: 'var(--radius-md)',
              padding: '10px 24px',
              fontSize: '14px',
              fontWeight: 500,
              cursor: onRunAI ? 'pointer' : 'not-allowed',
              opacity: onRunAI ? 1 : 0.6,
              minHeight: '44px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <i className="ti ti-brain" aria-hidden="true" />
            {lang === 'zh' ? '运行AI分析' : 'Run AI Analysis'}
          </button>
          {(tier === 'standard' || tier === 'power') && (
            <p style={{ fontSize: '11px', color: 'var(--color-text-muted)', marginTop: '8px' }}>
              ⚡ {credits} {lang === 'zh' ? '积分剩余 · 消耗5积分' : 'credits remaining · costs 5 credits'}
            </p>
          )}
        </div>
      )}

      {aiRunning && (
        <div style={{ textAlign: 'center', padding: '1.5rem' }}>
          <i className="ti ti-loader-2" style={{
            fontSize: '24px',
            color: 'var(--color-text-muted)',
            animation: 'spin 1s linear infinite',
          }} aria-hidden="true" />
          <p style={{ fontSize: '12px', color: 'var(--color-text-secondary)', marginTop: '8px' }}>
            {lang === 'zh' ? '正在分析11个专项角色...' : 'Analyzing 11 specialist roles...'}
          </p>
        </div>
      )}

      {aiRunError && (
        <p style={{ fontSize: '12px', color: 'var(--color-danger)', marginTop: '8px', textAlign: 'center' }}>
          {aiRunError}
        </p>
      )}

      {hasAiResult && aiComposite && normRec && (
        <div style={{
          background: '#EEEDFE', border: '0.5px solid #534AB7',
          borderRadius: 'var(--radius-md)', padding: '14px 16px',
        }}>
          <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: '#534AB7', marginBottom: 8 }}>
            AI VERDICT (ROLE 10)
          </p>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
            <p style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 700, color: '#3C3489', lineHeight: 1 }}>
              {recLabel[normRec]}
            </p>
            {aiConf != null && (
              <span style={{ fontSize: 14, fontWeight: 600, color: '#534AB7' }}>{aiConf}% confidence</span>
            )}
          </div>
          {aiComposite.key_risks?.length > 0 && (
            <p style={{ fontSize: 12, color: '#534AB7', marginTop: 6, fontStyle: 'italic' }}>
              Risk: {aiComposite.key_risks.slice(0, 2).join(' · ')}
            </p>
          )}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 10, flexWrap: 'wrap', gap: 8 }}>
            {lastAiRun && (
              <span style={{ fontSize: 11, color: '#534AB7' }}>
                {lang === 'zh' ? '上次运行：' : 'Last run: '}{lastAiRun} 北京
              </span>
            )}
            {onRunAI && (
              <button
                onClick={onRunAI}
                disabled={aiRunning}
                style={{
                  minHeight: 32, padding: '0 12px', background: 'transparent',
                  border: '0.5px solid #534AB7', borderRadius: 'var(--radius-sm)',
                  color: '#534AB7', fontFamily: 'var(--font-ui)', fontSize: 12, fontWeight: 500,
                  cursor: aiRunning ? 'not-allowed' : 'pointer', opacity: aiRunning ? 0.6 : 1,
                }}
              >
                {aiRunning ? '⏳…' : (lang === 'zh' ? '↺ 重新分析' : '↺ Re-run Analysis')}
              </button>
            )}
          </div>
          {aiRunMsg && <p style={{ fontSize: 12, color: 'var(--color-success)', marginTop: 6 }}>{aiRunMsg}</p>}
        </div>
      )}

      {/* ── V3 Probability boxes ── */}
      {hasModel ? (
        <>
          <div>
            <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--color-text-muted)', marginBottom: 8 }}>
              V3 MODEL (DC BLEND) · WIN / DRAW / LOSS
              <InfoTooltip title="V3 Model" explanation="Dixon-Coles blend: 65% DC attack/defence matrix + 35% recent form. Temperature-calibrated (T=1.11) to correct overconfidence." explanationZh="Dixon-Coles融合模型：65% DC攻防矩阵+35%近期表现。温度校准(T=1.11)纠正过度自信。" lang={lang} />
            </p>
            {dominant && match && (
              <div style={{ padding: '8px 12px', background: 'var(--color-bg-elevated)', border: '0.5px solid var(--color-border)', borderRadius: 6, marginBottom: 10 }}>
                <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
                  {lang === 'zh' ? '模型预测：' : 'Model predicts: '}
                </span>
                <strong style={{ fontSize: 14, color: edgeColour(activeProbs?.[dominant] ?? 0) }}>
                  {dominant === 'home'
                    ? `${getFlag(match.home_team)} ${match.home_team}`
                    : dominant === 'away'
                    ? `${getFlag(match.away_team)} ${match.away_team}`
                    : (lang === 'zh' ? '⚖️ 平局' : '⚖️ Draw')}
                </strong>
                {dominant !== 'draw' && (
                  <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
                    {lang === 'zh' ? ' 获胜' : ' win'}
                  </span>
                )}
                <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
                  {' '}({((activeProbs?.[dominant] ?? 0) * 100).toFixed(1)}%)
                </span>
              </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
              {[
                { key: 'home', label: match.home_team, flag: getFlag(match.home_team) },
                { key: 'draw', label: 'Draw', flag: '—' },
                { key: 'away', label: match.away_team, flag: getFlag(match.away_team) },
              ].map(({ key, label, flag }) => {
                const p = activeProbs?.[key] ?? 0
                const col = edgeColour(p)
                return (
                  <div key={key} style={{
                    background: 'var(--color-bg-card)', border: `0.5px solid ${col}`,
                    borderRadius: 'var(--radius-md)', padding: '14px 10px', textAlign: 'center',
                  }}>
                    <p style={{ fontSize: 20, marginBottom: 4 }}>{key !== 'draw' ? flag : '⚖️'}</p>
                    <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 6, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</p>
                    <p style={{ fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 700, color: col, lineHeight: 1 }}>
                      {(p * 100).toFixed(1)}%
                    </p>
                    {v1?.probs?.[key] != null && (
                      <p style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4 }}>
                        V1 {(v1.probs[key] * 100).toFixed(1)}%
                      </p>
                    )}
                    {v4Pred && (
                      <p style={{ fontSize: 11, fontFamily: mono, color: '#7C3AED', marginTop: 3 }}>
                        V4 {(Number(v4Pred[key === 'home' ? 'v4_home_win' : key === 'away' ? 'v4_away_win' : 'v4_draw']) * 100).toFixed(1)}%
                      </p>
                    )}
                    {key !== 'draw' && v3 && (
                      <p style={{ fontSize: 12, fontFamily: mono, color: 'var(--color-text-muted)', marginTop: 2 }}>
                        λ = {key === 'home' ? (activeLambdaHome ?? 0).toFixed(2) : (activeLambdaAway ?? 0).toFixed(2)}
                      </p>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {/* ── Support stats: over25 + btts ── */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {[
              { label: 'Over 2.5', val: v3.over25 },
              { label: 'Under 2.5', val: 1 - v3.over25 },
              { label: 'BTTS', val: v3.btts },
            ].map(({ label, val }) => (
              <div key={label} style={{
                flex: '1 0 90px', textAlign: 'center',
                background: 'var(--color-bg-card)', border: '0.5px solid var(--color-border)',
                borderRadius: 'var(--radius-md)', padding: '10px 8px',
              }}>
                <p style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 4 }}>{label}</p>
                <p style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 700, color: edgeColour(val) }}>
                  {(val * 100).toFixed(1)}%
                </p>
              </div>
            ))}
          </div>

          {/* ── Total Goals & Range Analysis ── */}
          {v3.totalGoals?.length > 0 && (() => {
            const ranges = getRangeProbabilities(v3.totalGoals)
            const maxRP = Math.max(...ranges.map(r => Number(r.prob)))
            const maxGoalProb = goalsSorted.length > 0 ? Math.max(...goalsSorted.map(g => g.prob)) : 1

            return (
              <div style={{ background: 'var(--color-bg-card)', border: '0.5px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '12px 14px' }}>
                <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--color-text-muted)', marginBottom: 10, display: 'flex', alignItems: 'center' }}>
                  {lang === 'zh' ? '总进球与区间分析 · V3' : 'TOTAL GOALS & RANGE ANALYSIS · V3'}
                  <InfoTooltip
                    title={lang === 'zh' ? '进球分析' : 'Goals Analysis'}
                    explanation="Left: 3-goal windows sorted by combined probability. Right: individual totals by rank. Top bar = 100%."
                    explanationZh="左：按组合概率排序的3球窗口。右：按排名的单个总数。最高条=100%。"
                    lang={lang}
                  />
                </p>

                <div className="goals-analysis-grid">

                  {/* ── LEFT: BY RANGE ── */}
                  <div>
                    <p style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', color: 'var(--color-text-muted)', marginBottom: 8 }}>
                      {lang === 'zh' ? '按区间' : 'BY RANGE'}
                    </p>
                    {ranges.map((r, i) => {
                      const isTop = i === 0
                      const goalsInRange = [r.min, r.min + 1, r.max]
                      const probsInRange = goalsInRange.map(g => getGoalP(g))
                      const fillPct = (Number(r.prob) / maxRP) * 100
                      const rowRankColor = getRankColor(i + 1)

                      return (
                        <div key={r.range} style={{ marginBottom: '10px' }}>
                          {/* LINE 1 */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '3px' }}>
                            <span style={{ fontSize: '11px', fontWeight: isTop ? 600 : 400, color: rowRankColor, width: '28px', flexShrink: 0 }}>{r.range}</span>
                            <span style={{ fontSize: '10px', color: rowRankColor, width: '36px', flexShrink: 0 }}>{(Number(r.prob) * 100).toFixed(1)}%</span>
                            <span style={{ fontSize: '10px', color: '#C9A84C', width: '10px', flexShrink: 0, visibility: isTop ? 'visible' : 'hidden' }}>★</span>
                            <div style={{ flex: 1, minWidth: 0, height: '8px', background: 'var(--color-bg)', borderRadius: '4px', position: 'relative', overflow: 'hidden' }}>
                              <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: `${fillPct}%`, display: 'flex', gap: '1px' }}>
                                {goalsInRange.map((g, idx) => (
                                  <div key={g} style={{ flex: probsInRange[idx] || 0.001, height: '100%', background: getRankColor(rankMap[g] ?? 99), minWidth: 0 }} />
                                ))}
                              </div>
                            </div>
                          </div>
                          {/* LINE 2: paddingLeft = 28+6+36+6+10+6 = 92px */}
                          <div style={{ paddingLeft: '92px', display: 'flex' }}>
                            {goalsInRange.map((g, idx) => {
                              const gRank = rankMap[g] ?? 99
                              const gColor = getRankColor(gRank)
                              return (
                                <div key={g} style={{ flex: probsInRange[idx] || 1, display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 0 }}>
                                  <span style={{ fontSize: '10px', fontWeight: 500, color: gColor }}>{g}{gRank === 1 ? '★' : ''}</span>
                                  <span style={{ fontSize: '9px', padding: '0 3px', borderRadius: '99px', background: `${gColor}20`, color: gColor, fontWeight: 500 }}>#{gRank}</span>
                                  <span style={{ fontSize: '9px', color: gColor, opacity: 0.85 }}>{(probsInRange[idx] * 100).toFixed(1)}%</span>
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )
                    })}
                  </div>

                  {/* ── RIGHT: BY TOTAL ── */}
                  <div>
                    <p style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', color: 'var(--color-text-muted)', marginBottom: 8 }}>
                      {lang === 'zh' ? '按总数' : 'BY TOTAL'}
                    </p>
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      {goalsSorted.map(({ goals, prob }) => {
                        const isAnchor = kStar != null && goals === kStar
                        const rank = rankMap[goals] ?? 99
                        const rankColor = getRankColor(rank)
                        const barPct = maxGoalProb > 0 ? (prob / maxGoalProb) * 100 : 0
                        return (
                          <div key={goals} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 0', borderBottom: '0.5px solid var(--color-border-light)', background: isAnchor ? 'rgba(201,168,76,0.06)' : 'transparent' }}>
                            <div style={{ width: '88px', flexShrink: 0, display: 'flex', alignItems: 'center', gap: '4px' }}>
                              <span style={{ width: '14px', textAlign: 'right', fontSize: '12px', fontWeight: rank <= 3 ? 500 : 400, color: rankColor, flexShrink: 0 }}>{goals}</span>
                              <span style={{ fontSize: '11px', color: rankColor, fontWeight: rank <= 3 ? 500 : 400, minWidth: '34px', flexShrink: 0 }}>{(prob * 100).toFixed(1)}%</span>
                              <span style={{ fontSize: '8px', fontWeight: 500, padding: '0 3px', borderRadius: '99px', background: `${rankColor}20`, color: rankColor, width: '22px', textAlign: 'center', flexShrink: 0 }}>#{rank}</span>
                              {isAnchor && (
                                <InfoTooltip
                                  title="Anchor Total"
                                  explanation="The most likely number of goals — foundation of PASP strategy."
                                  explanationZh="最可能的总进球数——PASP策略基础。"
                                  lang={lang}
                                />
                              )}
                            </div>
                            <div style={{ flex: 1, minWidth: 0, height: '5px', background: 'var(--color-bg)', borderRadius: '3px', position: 'relative' }}>
                              <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', borderRadius: '3px', width: `${barPct}%`, background: rankColor, transition: 'width 0.4s ease' }} />
                            </div>
                          </div>
                        )
                      })}
                    </div>
                    {kStar != null && (() => {
                      let kOver = 0, kUnder = 0
                      for (const { goals, prob } of (v3.totalGoals || [])) {
                        if (goals >= kStar) kOver += prob
                        else kUnder += prob
                      }
                      const betLine = kStar - 0.5
                      return (
                        <div style={{ marginTop: 8, paddingTop: 8, borderTop: '0.5px solid var(--color-border)', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>
                            Over {betLine}: <strong style={{ color: 'var(--color-accent)' }}>{(kOver * 100).toFixed(1)}%</strong>
                          </span>
                          <span style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>
                            Under {kStar + 0.5}: <strong style={{ color: 'var(--color-text-primary)' }}>{(kUnder * 100).toFixed(1)}%</strong>
                          </span>
                        </div>
                      )
                    })()}
                  </div>

                </div>

                {/* Insight line */}
                {kStar != null && (
                  <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '0.5px solid var(--color-border-light)', fontSize: 11, color: 'var(--color-text-secondary)' }}>
                    {lang === 'zh'
                      ? `最佳区间：${ranges[0]?.range}球 (${(Number(ranges[0]?.prob) * 100).toFixed(1)}%) · 锚定：${kStar}球`
                      : `Sweet spot: ${ranges[0]?.range} goals (${(Number(ranges[0]?.prob) * 100).toFixed(1)}%) · Anchor: ${kStar} goals`}
                  </div>
                )}

                {/* Legend */}
                <div style={{ display: 'flex', gap: '12px', marginTop: '8px', flexWrap: 'wrap' }}>
                  {[
                    { color: '#C9A84C', label: lang === 'zh' ? '#1 最高' : '#1 Most likely' },
                    { color: '#1A3A6C', label: '#2' },
                    { color: '#2D7A4F', label: '#3' },
                    { color: '#6B7280', label: lang === 'zh' ? '其他' : 'Others' },
                  ].map(item => (
                    <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '10px', color: 'var(--color-text-muted)' }}>
                      <div style={{ width: '10px', height: '10px', borderRadius: '2px', background: item.color, flexShrink: 0 }} />
                      {item.label}
                    </div>
                  ))}
                </div>
              </div>
            )
          })()}

          {/* ── Top Scorelines grid ── */}
          {(v3 || (isFinished && storedPred?.v3_top_score)) && (
            <div style={{
              padding: '7px 12px',
              background: isFinished ? 'rgba(180,120,0,0.10)' : 'rgba(59,130,246,0.08)',
              border: `0.5px solid ${isFinished ? '#D97706' : '#3B82F6'}`,
              borderRadius: 'var(--radius-sm)',
              fontSize: 11, fontWeight: 600, letterSpacing: '0.04em',
              color: isFinished ? '#92400E' : '#1D4ED8',
            }}>
              {isFinished
                ? `📋 Pre-match prediction · Locked at ${storedPred?.predicted_at ? new Date(storedPred.predicted_at).toLocaleString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }) + ' UTC' : '—'}`
                : '🔄 Live model · Updates with latest data'}
            </div>
          )}
          {((v3?.topScores?.length > 0) || (isFinished && frozenTopScores?.length > 0)) && (
            <div style={{ background: 'var(--color-bg-card)', border: `0.5px solid ${scoresModel === 'v4' ? '#7C3AED' : 'var(--color-border)'}`, borderRadius: 'var(--radius-md)', padding: '12px 14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: scoresModel === 'v4' ? '#7C3AED' : 'var(--color-text-muted)', margin: 0 }}>
                  {lang === 'zh' ? `最可能比分 · ${scoresModel.toUpperCase()}` : `TOP SCORELINES · ${scoresModel.toUpperCase()}`}
                </p>
                {v4TopScores && (
                  <div style={{ display: 'flex', gap: 4 }}>
                    {['v3', 'v4'].map(m => (
                      <button key={m} onClick={() => setScoresModel(m)} style={{
                        background: scoresModel === m ? (m === 'v4' ? '#7C3AED' : 'var(--color-accent)') : 'none',
                        border: `0.5px solid ${m === 'v4' ? '#7C3AED' : 'var(--color-accent-border)'}`,
                        color: scoresModel === m ? '#fff' : m === 'v4' ? '#7C3AED' : 'var(--color-accent)',
                        borderRadius: 4, padding: '3px 10px', cursor: 'pointer',
                        fontSize: 11, fontWeight: 700, fontFamily: "'IBM Plex Mono', monospace",
                        minHeight: 26,
                      }}>
                        {m.toUpperCase()}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
                {(scoresModel === 'v4' ? v4TopScores : (isFinished && frozenTopScores ? frozenTopScores : v3?.topScores) ?? []).slice(0, 6).map(({ score, prob }, i) => {
                  const isTop = i === 0
                  const isV4 = scoresModel === 'v4'
                  const topColor = isV4 ? '#7C3AED' : 'var(--color-accent)'
                  const topBg    = isV4 ? 'rgba(124,58,237,0.08)' : 'var(--color-accent-dim)'
                  const topBorder = isV4 ? 'rgba(124,58,237,0.35)' : 'var(--color-accent-border)'
                  const [homeG, awayG] = score.split('-').map(Number)
                  const totalG = homeG + awayG
                  const totalProb = getGoalP(totalG)
                  const totalRank = rankMap[totalG] ?? 99
                  const rankColor = getRankColor(totalRank)
                  const outcome = homeG > awayG ? 'home' : awayG > homeG ? 'away' : 'draw'
                  const probs = isV4 && v4Pred
                    ? { home: Number(v4Pred.v4_home_win), draw: Number(v4Pred.v4_draw), away: Number(v4Pred.v4_away_win) }
                    : (activeProbs ?? v3?.probs)
                  const outcomePct = outcome === 'home' ? probs?.home
                    : outcome === 'away' ? probs?.away
                    : probs?.draw
                  const outcomeBg = outcome === 'home' ? '#E6F1FB'
                    : outcome === 'away' ? '#FCEBEB'
                    : 'var(--color-bg-elevated)'
                  const outcomeColor = outcome === 'home' ? '#0C447C'
                    : outcome === 'away' ? '#791F1F'
                    : 'var(--color-text-secondary)'
                  const outcomeLabel = outcome === 'home'
                    ? (lang === 'zh' ? `${match.home_team}胜` : `${match.home_team} win`)
                    : outcome === 'away'
                    ? (lang === 'zh' ? `${match.away_team}胜` : `${match.away_team} win`)
                    : (lang === 'zh' ? '平局' : 'Draw')
                  const outcomeBadge = outcome === 'home' ? 'HW' : outcome === 'away' ? 'AW' : 'D'

                  return (
                    <div key={score} style={{
                      padding: '10px 10px',
                      background: isTop ? topBg : 'var(--color-bg-elevated)',
                      border: isTop ? `0.5px solid ${topBorder}` : '0.5px solid var(--color-border)',
                      borderRadius: 'var(--radius-sm)',
                      display: 'flex', flexDirection: 'column', gap: '4px',
                    }}>
                      {/* Row 1: Score + outcome badge */}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: isTop ? 800 : 600, color: isTop ? topColor : 'var(--color-text-primary)' }}>
                          {score}
                        </span>
                        <span style={{ fontSize: '10px', fontWeight: 500, padding: '2px 5px', borderRadius: '99px', background: outcomeBg, color: outcomeColor }}>
                          {outcomeBadge}
                        </span>
                      </div>
                      {/* Row 2: Scoreline probability */}
                      <div style={{ fontSize: 12, color: isTop ? topColor : 'var(--color-text-muted)', fontWeight: isTop ? 500 : 400 }}>
                        {(prob * 100).toFixed(1)}%
                      </div>
                      {/* Divider */}
                      <div style={{ height: '0.5px', background: 'var(--color-border-light)', margin: '2px 0' }} />
                      {/* Row 3: Total goals context */}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 11 }}>
                        <span style={{ color: rankColor, fontWeight: 500, display: 'flex', alignItems: 'center', gap: '3px' }}>
                          <span style={{ fontSize: '9px', padding: '0 3px', borderRadius: '99px', background: `${rankColor}20`, color: rankColor }}>#{totalRank}</span>
                          {totalG}{lang === 'zh' ? '球' : 'g'}
                        </span>
                        <span style={{ color: rankColor, fontSize: 11 }}>{(totalProb * 100).toFixed(1)}%</span>
                      </div>
                      {/* Row 4: Outcome probability */}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 11 }}>
                        <span style={{ color: 'var(--color-text-secondary)', maxWidth: '65%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {outcomeLabel}
                        </span>
                        <span style={{ color: 'var(--color-text-secondary)', fontWeight: 500 }}>
                          {outcomePct != null ? (outcomePct * 100).toFixed(1) + '%' : '—'}
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* ── Score Matrix (collapsible) ── */}
          <Collapsible label={`Score Matrix · V3 (DC blend) · λ ${v3.lambdaHome.toFixed(2)} vs ${v3.lambdaAway.toFixed(2)}`}>
            <MiniMatrix matrix={v3.matrix} homeTeam={match.home_team} awayTeam={match.away_team} />
          </Collapsible>
        </>
      ) : (
        <div style={{ background: 'var(--color-bg-card)', border: '0.5px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 20, textAlign: 'center' }}>
          <p style={{ fontSize: 15, color: 'var(--color-text-muted)' }}>
            Both teams need stats before the model can run (MT06)
          </p>
          {isAdmin && !statsLoading && (
            <button
              onClick={onRefresh}
              disabled={refreshing}
              style={{ marginTop: 12, minHeight: 44, padding: '0 16px', background: 'var(--color-accent-dim)', border: '0.5px solid var(--color-accent-border)', borderRadius: 'var(--radius-sm)', color: 'var(--color-accent)', fontFamily: 'var(--font-ui)', fontSize: 15, cursor: 'pointer' }}
            >
              {refreshing ? t('common.loading') : t('analysis.fetchStats')}
            </button>
          )}
        </div>
      )}

      {/* ── Supporting Stats (collapsible) ── */}
      <Collapsible label={`Supporting Stats · ${match.home_team} vs ${match.away_team}`}>
        {statsLoading ? (
          <div style={{ display: 'flex', gap: 10 }}>
            <div className="skeleton" style={{ flex: 1, height: 140 }} />
            <div className="skeleton" style={{ flex: 1, height: 140 }} />
          </div>
        ) : (
          <>
            {statsError && (
              <p style={{ fontSize: 13, color: 'var(--color-danger)', marginBottom: 10 }}>⚠ {statsError}</p>
            )}
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <CompactTeamStats teamStats={stats.home} teamName={match.home_team} isHome t={t} />
              <CompactTeamStats teamStats={stats.away} teamName={match.away_team} isHome={false} t={t} />
            </div>
            {isAdmin && (
              <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                {lastUpdated && (
                  <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                    {t('analysis.lastUpdated')} {new Date(lastUpdated).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false, month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </span>
                )}
                <button
                  onClick={onRefresh}
                  disabled={refreshing}
                  style={{ minHeight: 36, padding: '0 12px', background: 'var(--color-accent-dim)', border: '0.5px solid var(--color-accent-border)', borderRadius: 'var(--radius-sm)', color: 'var(--color-accent)', fontFamily: 'var(--font-ui)', fontSize: 12, cursor: refreshing ? 'not-allowed' : 'pointer', opacity: refreshing ? 0.7 : 1 }}
                >
                  {refreshing ? t('common.loading') : t('analysis.fetchLatest')}
                </button>
              </div>
            )}
          </>
        )}
      </Collapsible>

      {/* ── Strategic Context (collapsible) ── */}
      {match?.group_name && (stratLoading || stratCtx) && (
        <Collapsible
          label={`Strategic Context · Group ${match.group_name} · ${stratCtx ? `MD${stratCtx.matchday}` : '…'}`}
          defaultOpen={true}
        >
          {stratLoading && !stratCtx ? (
            <div style={{ fontSize: 11, color: 'var(--color-text-muted)', fontFamily: mono }}>
              Loading group data…
            </div>
          ) : stratCtx && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

              {/* Three-column: home | tactical | away */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr minmax(150px,180px) 1fr', gap: 12, alignItems: 'start' }}>

                {[
                  { teamName: match.home_team, stat: stratCtx.hStat, mot: stratCtx.hMot, scen: stratCtx.hScen, md3: stratCtx.hMD3, md3Str: stratCtx.hMD3Str },
                  { teamName: match.away_team, stat: stratCtx.aStat, mot: stratCtx.aMot, scen: stratCtx.aScen, md3: stratCtx.aMD3, md3Str: stratCtx.aMD3Str },
                ].map((tm, idx) => {
                  const r32 = stratCtx.r32
                  const ags = stratCtx.ags || {}
                  const danger = stratCtx.danger || []
                  const half = stratCtx.r16Half
                  const d1 = r32 ? r32Diff(r32, ags, true) : null
                  const d2 = r32 ? r32Diff(r32, ags, false) : null
                  return (
                    <div key={idx} style={{ background: 'var(--color-bg-secondary)', border: '0.5px solid var(--color-border)', borderRadius: 8, padding: '12px', display: 'flex', flexDirection: 'column' }}>
                      {/* Name + stats */}
                      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text-primary)', letterSpacing: '0.02em', marginBottom: 3 }}>{tm.teamName}</div>
                      <div style={{ fontSize: 11, fontFamily: mono, color: 'var(--color-text-muted)', marginBottom: 8 }}>
                        Pts: <strong style={{ color: 'var(--color-text-primary)' }}>{tm.stat.pts}</strong>
                        {' · '}GD: <strong style={{ color: 'var(--color-text-primary)' }}>{tm.stat.gd >= 0 ? '+' : ''}{tm.stat.gd}</strong>
                        {' · '}P: <strong style={{ color: 'var(--color-text-primary)' }}>{tm.stat.played}</strong>
                      </div>

                      {/* Motivation */}
                      <div style={{ marginBottom: 8 }}>
                        <div style={{ fontSize: 15, color: motColor(tm.mot), letterSpacing: 1 }}>{motStars(tm.mot)}</div>
                        <div style={{ fontSize: 10, fontWeight: 700, color: riskColor(tm.mot), fontFamily: mono, marginTop: 2 }}>Risk: {riskLabel(tm.mot)}</div>
                      </div>

                      {/* Today */}
                      <div style={{ borderTop: '0.5px solid var(--color-border)', paddingTop: 8, marginBottom: 8 }}>
                        <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-text-muted)', marginBottom: 4 }}>Today (MD{tm.stat.played + 1})</div>
                        {[
                          { label: 'Win',  data: tm.scen.win },
                          { label: 'Draw', data: tm.scen.draw },
                          { label: 'Lose', data: tm.scen.lose },
                        ].map(({ label, data }) => (
                          <div key={label} style={{ display: 'flex', gap: 4, fontSize: 10, fontFamily: mono, marginBottom: 2 }}>
                            <span style={{ color: 'var(--color-text-muted)', minWidth: 36 }}>If {label}:</span>
                            <span style={{ color: scenColor(data.label), fontWeight: 600 }}>{data.label}</span>
                            <span style={{ color: 'var(--color-text-muted)' }}>({data.pts}pt)</span>
                          </div>
                        ))}
                      </div>

                      {/* MD3 */}
                      {tm.md3 && (
                        <div style={{ borderTop: '0.5px solid var(--color-border)', paddingTop: 8, marginBottom: 8 }}>
                          <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-text-muted)', marginBottom: 4 }}>MD3</div>
                          <div style={{ fontSize: 11, fontFamily: mono, marginBottom: 4 }}>
                            vs <strong>{tm.md3}</strong>
                            {tm.md3Str && <span style={{ fontSize: 10, color: md3StrColor(tm.md3Str), fontWeight: 700, marginLeft: 4 }}>({tm.md3Str})</span>}
                          </div>
                          {md3Impl(true, tm.md3, tm.md3Str) && (
                            <div style={{ fontSize: 10, color: '#2D7A4F', fontFamily: mono, lineHeight: 1.5, marginBottom: 2 }}>▸ Win: {md3Impl(true, tm.md3, tm.md3Str)}</div>
                          )}
                          {md3Impl(false, tm.md3, tm.md3Str) && (
                            <div style={{ fontSize: 10, color: '#BA7517', fontFamily: mono, lineHeight: 1.5 }}>▸ Draw: {md3Impl(false, tm.md3, tm.md3Str)}</div>
                          )}
                        </div>
                      )}

                      {/* R32 Projection */}
                      {r32 && (
                        <div style={{ borderTop: '0.5px solid var(--color-border)', paddingTop: 8, marginBottom: 8 }}>
                          <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-text-muted)', marginBottom: 6 }}>R32 Projection</div>
                          <div style={{ paddingLeft: 8, marginBottom: 4 }}>
                            <div style={{ fontSize: 9, color: 'var(--color-text-muted)', marginBottom: 1 }}>If 1st:</div>
                            <div style={{ fontSize: 10, fontFamily: mono, color: 'var(--color-text-primary)' }}>
                              {r32.ifFirst.opponents.length > 0 ? r32.ifFirst.opponents.join(' / ') : r32.ifFirst.slot}
                            </div>
                            {d1 && <span style={{ fontSize: 9, fontWeight: 700, color: d1.color, fontFamily: mono }}>Difficulty: {d1.label}</span>}
                          </div>
                          <div style={{ paddingLeft: 8 }}>
                            <div style={{ fontSize: 9, color: 'var(--color-text-muted)', marginBottom: 1 }}>If 2nd:</div>
                            <div style={{ fontSize: 10, fontFamily: mono, color: 'var(--color-text-primary)' }}>
                              {r32.ifSecond.opponent || r32.ifSecond.slot}
                            </div>
                            {d2 && <span style={{ fontSize: 9, fontWeight: 700, color: d2.color, fontFamily: mono }}>Difficulty: {d2.label}</span>}
                          </div>
                        </div>
                      )}

                      {/* R16 Bracket */}
                      <div style={{ borderTop: '0.5px solid var(--color-border)', paddingTop: 8 }}>
                        <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-text-muted)', marginBottom: 4 }}>R16 Bracket</div>
                        <div style={{ fontSize: 10, fontFamily: mono, color: 'var(--color-text-primary)', marginBottom: danger.length ? 4 : 0 }}>{half} half</div>
                        {danger.length > 0 && (
                          <div>
                            <div style={{ fontSize: 9, color: 'var(--color-text-muted)', marginBottom: 2 }}>Danger teams:</div>
                            {danger.map(d => (
                              <div key={d} style={{ fontSize: 10, fontFamily: mono, color: '#C9A84C', fontWeight: 600 }}>{d}</div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}

                {/* Tactical signal — middle column */}
                {stratSignal && (
                  <div style={{ background: 'var(--color-bg-secondary)', border: '0.5px solid var(--color-border)', borderRadius: 8, padding: '12px', display: 'flex', flexDirection: 'column', gap: 8, gridRow: 1, gridColumn: '2 / 3' }}>
                    <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.10em', textTransform: 'uppercase', color: 'var(--color-text-muted)' }}>Tactical Signal</div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-primary)', lineHeight: 1.4 }}>{stratSignal.text}</div>
                    <div style={{ borderTop: '0.5px solid var(--color-border)', paddingTop: 8 }}>
                      <div style={{ fontSize: 11, fontFamily: mono, color: 'var(--color-text-primary)' }}>
                        Strategic anchor: <strong>{stratSignal.adjAnchor}g</strong>
                      </div>
                      <div style={{ fontSize: 10, fontFamily: mono, color: 'var(--color-text-muted)', marginTop: 2 }}>
                        (V3: {stratSignal.v3Anchor}g{stratSignal.goalAdj !== 0 ? ` + ${stratSignal.adjSign}` : ' · no adj'})
                      </div>
                    </div>
                    <div style={{ borderTop: '0.5px solid var(--color-border)', paddingTop: 8 }}>
                      <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-text-muted)', marginBottom: 4 }}>PASP note</div>
                      <div style={{ fontSize: 11, color: 'var(--color-text-muted)', lineHeight: 1.6 }}>{stratSignal.note}</div>
                    </div>
                    <div style={{ borderTop: '0.5px solid var(--color-border)', paddingTop: 8 }}>
                      <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-text-muted)', marginBottom: 6 }}>Chess summary</div>
                      {[
                        { name: match.home_team, mot: stratCtx.hMot, scen: stratCtx.hScen, md3: stratCtx.hMD3, md3Str: stratCtx.hMD3Str },
                        { name: match.away_team, mot: stratCtx.aMot, scen: stratCtx.aScen, md3: stratCtx.aMD3, md3Str: stratCtx.aMD3Str },
                      ].map(tm => (
                        <div key={tm.name} style={{ fontSize: 11, fontStyle: 'italic', color: 'var(--color-text-primary)', lineHeight: 1.6, marginBottom: 6 }}>
                          {chessLine(tm.name, tm.mot, tm.scen, tm.md3, tm.md3Str)}
                        </div>
                      ))}
                      <div style={{ borderTop: '0.5px solid var(--color-border)', paddingTop: 6, fontSize: 10, color: 'var(--color-text-muted)', fontStyle: 'italic', lineHeight: 1.6 }}>
                        {stratSignal.goalAdj > 0 && 'Both teams pressing — expect open play and set pieces.'}
                        {stratSignal.goalAdj < 0 && 'Conservative game expected — low-scoring likely.'}
                        {stratSignal.goalAdj === 0 && 'Follow V3 model — no strategic distortion expected.'}
                      </div>
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
                      {['Pos','Team','Pts','GD','Form','Status'].map(h => (
                        <th key={h} style={{ padding: '4px 8px', fontSize: 9, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--color-text-muted)', textAlign: h === 'Team' ? 'left' : 'center', fontFamily: mono }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {stratCtx.standings.map((s, i) => {
                      const isPlaying = s.team === match.home_team || s.team === match.away_team
                      const qs = qualStatus(s.pts)
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
                          <td style={{ padding: '5px 8px', textAlign: 'center', fontSize: 9, fontWeight: 700, fontFamily: mono, color: qs.color, whiteSpace: 'nowrap' }}>{qs.label}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

            </div>
          )}
        </Collapsible>
      )}

      {/* ── AI Role Analysis (collapsible) ── */}
      {(() => {
        const outputByRoleId = {}
        for (const o of (roleOutputs || [])) outputByRoleId[o.role_id] = o

        const role10 = (aiRoles || []).find(r => r.role_number === 10)
        const role10Out = role10 ? outputByRoleId[role10.id] : null
        const otherRoles = (aiRoles || []).filter(r => r.role_number !== 10)
        const hasOutputs = (roleOutputs?.length ?? 0) > 0

        const collapsePreview = aiConf != null
          ? (lang === 'zh'
              ? `综合：${aiConf}/100 · 上次运行：${lastAiRun || '—'}`
              : `Composite: ${aiConf}/100 · Last run: ${lastAiRun || '—'}`)
          : (lang === 'zh' ? '尚未运行AI分析' : 'No AI analysis run yet')

        return (
          <Collapsible label={`🤖 ${lang === 'zh' ? 'AI角色分析' : 'AI Role Analysis'} · ${collapsePreview}`}>
            {!hasOutputs ? (
              <div style={{ textAlign: 'center', padding: '8px 0 4px' }}>
                <p style={{ fontSize: 14, color: 'var(--color-text-muted)', marginBottom: 12 }}>
                  {lang === 'zh'
                    ? '此场比赛尚未运行AI分析。运行AI分析以查看11个专项角色输出。'
                    : 'No AI analysis run yet for this match. Run AI Analysis to see 11 specialist role outputs.'}
                </p>
                <button
                  onClick={onRunAI}
                  disabled={aiRunning || !onRunAI}
                  style={{
                    minHeight: 44, padding: '0 24px',
                    background: 'var(--color-accent-dim)',
                    border: '0.5px solid var(--color-accent-border)',
                    borderRadius: 'var(--radius-sm)',
                    color: 'var(--color-accent)', fontFamily: 'var(--font-ui)',
                    fontSize: 15, fontWeight: 600,
                    cursor: (aiRunning || !onRunAI) ? 'not-allowed' : 'pointer',
                    opacity: (aiRunning || !onRunAI) ? 0.6 : 1,
                  }}
                >
                  {aiRunning ? '⏳ Analysing…' : (lang === 'zh' ? '▶ 运行AI分析' : '▶ Run AI Analysis')}
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {role10Out && (
                  <AiRoleCard output_json={role10Out.output_json} isComposite />
                )}
                {otherRoles.map(r => {
                  const out = outputByRoleId[r.id]
                  if (!out) return null
                  return <AiRoleCard key={r.id} output_json={out.output_json} isComposite={false} />
                })}
                {onRunAI && (
                  <button
                    onClick={onRunAI}
                    disabled={aiRunning}
                    style={{
                      minHeight: 44, padding: '0 16px', marginTop: 4,
                      background: 'transparent',
                      border: '0.5px solid var(--color-border)',
                      borderRadius: 'var(--radius-sm)',
                      color: 'var(--color-text-secondary)', fontFamily: 'var(--font-ui)',
                      fontSize: 14, fontWeight: 500,
                      cursor: aiRunning ? 'not-allowed' : 'pointer', opacity: aiRunning ? 0.6 : 1,
                    }}
                  >
                    {aiRunning ? '⏳ Analysing…' : (lang === 'zh' ? '↺ 重新分析' : '↺ Re-run Analysis')}
                  </button>
                )}
              </div>
            )}
          </Collapsible>
        )
      })()}

    </div>
  )
}
