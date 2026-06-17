import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useTranslation } from '../lib/i18n'
import { useMatchesByGroup } from '../hooks/useMatches'
import MatchCard from '../components/MatchCard'
import { getFlag } from '../lib/teamFlags'
import { syncAllStats } from '../lib/statsApi'
import { supabase } from '../lib/supabase'
import Simulator from './Simulator'

const ADMIN_UUID = '4a6e1f29-e18b-4fd3-9a7e-cec54501db54'

const GROUPS = ['A','B','C','D','E','F','G','H','I','J','K','L']

const KNOCKOUT_STAGES = ['r32','r16','qf','sf','3rd','final']
const KNOCKOUT_LABELS = {
  r32: 'ROUND OF 32',
  r16: 'ROUND OF 16',
  qf: 'QUARTER FINAL',
  sf: 'SEMI FINAL',
  '3rd': 'THIRD PLACE',
  final: 'FINAL',
}

// Build a lookup: match_id → { home: statsRow, away: statsRow }
function buildStatsMap(statsRows, matchesArr) {
  const map = {}
  for (const s of statsRows) {
    if (!map[s.match_id]) map[s.match_id] = {}
    // find the match to identify home vs away team_code
    const match = matchesArr.find(m => m.id === s.match_id)
    if (!match) continue
    if (s.team_code === match.home_team_code) map[s.match_id].home = s
    if (s.team_code === match.away_team_code) map[s.match_id].away = s
  }
  return map
}

// Calculate group standings from settled matches.
// Teams with 0 played games are included with all zeros.
function calcStandings(matches) {
  const allTeams = [...new Set(
    matches.flatMap(m => [m.home_team, m.away_team])
  )].filter(n => n !== 'TBD')

  const table = {}
  for (const t of allTeams) table[t] = { mp: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 }

  for (const m of matches) {
    if (m.status !== 'finished' || m.home_score == null || m.away_score == null) continue
    const h = m.home_score, a = m.away_score
    const ht = table[m.home_team], at = table[m.away_team]
    if (!ht || !at) continue

    ht.mp++; ht.gf += h; ht.ga += a
    if (h > a)      { ht.w++; ht.pts += 3 }
    else if (h === a){ ht.d++; ht.pts += 1 }
    else              ht.l++

    at.mp++; at.gf += a; at.ga += h
    if (a > h)      { at.w++; at.pts += 3 }
    else if (a === h){ at.d++; at.pts += 1 }
    else              at.l++
  }

  return Object.entries(table)
    .map(([team, s]) => ({ team, ...s, gd: s.gf - s.ga }))
    .sort((a, b) => b.pts - a.pts || (b.gd - a.gd) || (b.gf - a.gf))
}

function GroupStandings({ matches }) {
  const navigate = useNavigate()
  const rows = calcStandings(matches)
  if (!rows.length) return null

  // Build name → code map so team names become links to /team/:code
  const nameToCode = {}
  for (const m of matches) {
    if (m.home_team && m.home_team_code) nameToCode[m.home_team] = m.home_team_code
    if (m.away_team && m.away_team_code) nameToCode[m.away_team] = m.away_team_code
  }

  const th = {
    padding: '5px 8px', fontSize: 11, fontWeight: 700,
    letterSpacing: '0.05em', color: 'var(--color-text-muted)',
    background: 'var(--color-bg-elevated)',
    borderBottom: '0.5px solid var(--color-border)',
    textAlign: 'center', whiteSpace: 'nowrap',
  }
  const td = {
    padding: '6px 8px', fontSize: 12,
    color: 'var(--color-text-secondary)',
    borderBottom: '0.5px solid var(--color-border)',
    textAlign: 'center', whiteSpace: 'nowrap',
  }

  const rowBg = (i) => {
    if (i < 2)   return 'rgba(45,122,79,0.12)'   // top 2 qualify — green
    if (i === 2) return 'rgba(204,136,0,0.10)'    // 3rd — potential playoff amber
    return 'transparent'
  }

  return (
    <div style={{
      overflowX: 'auto',
      marginBottom: 10,
      border: '0.5px solid var(--color-border)',
      borderRadius: 'var(--radius-sm)',
      background: 'var(--color-bg-card)',
    }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 360 }}>
        <thead>
          <tr>
            <th style={{ ...th, textAlign: 'left', paddingLeft: 10 }}>#</th>
            <th style={{ ...th, textAlign: 'left' }}>Team</th>
            <th style={th}>MP</th>
            <th style={th}>W</th>
            <th style={th}>D</th>
            <th style={th}>L</th>
            <th style={th}>GF</th>
            <th style={th}>GA</th>
            <th style={th}>GD</th>
            <th style={{ ...th, color: 'var(--color-text-primary)' }}>Pts</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.team} style={{ background: rowBg(i) }}>
              <td style={{ ...td, paddingLeft: 10, color: 'var(--color-text-muted)', fontWeight: 600 }}>
                {i + 1}
              </td>
              <td style={{ ...td, textAlign: 'left' }}>
                {nameToCode[r.team] ? (
                  <button onClick={() => navigate(`/team/${nameToCode[r.team]}`, { state: { from: 'group' } })} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'var(--font-ui)', fontSize: 12, color: 'var(--color-text-primary)', fontWeight: i < 2 ? 600 : 400, textAlign: 'left' }}>
                    {getFlag(r.team)} {r.team}
                  </button>
                ) : <span style={{ fontWeight: i < 2 ? 600 : 400 }}>{getFlag(r.team)} {r.team}</span>}
              </td>
              <td style={td}>{r.mp}</td>
              <td style={{ ...td, color: r.w > 0 ? 'var(--color-success)' : 'var(--color-text-muted)' }}>{r.w}</td>
              <td style={td}>{r.d}</td>
              <td style={{ ...td, color: r.l > 0 ? 'var(--color-danger)' : 'var(--color-text-muted)' }}>{r.l}</td>
              <td style={td}>{r.gf}</td>
              <td style={td}>{r.ga}</td>
              <td style={{ ...td, color: r.gd > 0 ? 'var(--color-success)' : r.gd < 0 ? 'var(--color-danger)' : 'var(--color-text-muted)' }}>
                {r.gd > 0 ? `+${r.gd}` : r.gd}
              </td>
              <td style={{ ...td, fontWeight: 700, color: 'var(--color-text-primary)', fontSize: 13 }}>{r.pts}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// Returns YYYY-MM-DD in Beijing time (UTC+8) for grouping by local day
function dateKey(dateStr) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date(dateStr))
}

function dayLabel(key) {
  const [y, m, d] = key.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  const weekday = date.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }).toUpperCase()
  const day = String(d).padStart(2, '0')
  const month = date.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }).toUpperCase()
  return `${weekday} ${day} ${month} ${y}`
}

function FlatMatchList({ matches, onAnalyze, statsMap, predMap = {}, hideHeaders = false, lang = 'en' }) {
  const byDay = {}
  for (const m of matches) {
    const k = dateKey(m.match_date)
    if (!byDay[k]) byDay[k] = []
    byDay[k].push(m)
  }
  const days = Object.keys(byDay).sort()

  if (!days.length) {
    return (
      <div style={{ background: 'var(--color-bg-card)', border: '0.5px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '16px', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13 }}>
        No matches
      </div>
    )
  }

  function fullDayLabel(key) {
    const [y, m, d] = key.split('-').map(Number)
    const date = new Date(Date.UTC(y, m - 1, d))
    if (lang === 'zh') {
      const weekday = date.toLocaleDateString('zh-CN', { weekday: 'long', timeZone: 'UTC' })
      return `${y}年${m}月${d}日 ${weekday}`
    }
    return date.toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
  }

  return (
    <div>
      {days.map(day => (
        <div key={day} style={{ marginBottom: 20 }}>
          {!hideHeaders && (
            <div style={{
              fontSize: 11, fontWeight: 500, color: 'var(--color-text-muted)',
              textTransform: 'uppercase', letterSpacing: '0.06em',
              padding: '12px 0 6px',
              borderBottom: '0.5px solid var(--color-border)',
              marginBottom: 8,
            }}>
              {fullDayLabel(day)}
            </div>
          )}
          {byDay[day].map(m => {
            const s = statsMap[m.id] || {}
            return (
              <MatchCard key={m.id} match={m} onAnalyze={onAnalyze} homeStats={s.home || null} awayStats={s.away || null} prediction={predMap[m.id] || null} />
            )
          })}
        </div>
      ))}
    </div>
  )
}

// Compact standings card for the Groups grid view
function GroupCard({ group, matches }) {
  const navigate = useNavigate()
  const rows = calcStandings(matches)

  const nameToCode = {}
  for (const m of matches) {
    if (m.home_team && m.home_team_code) nameToCode[m.home_team] = m.home_team_code
    if (m.away_team && m.away_team_code) nameToCode[m.away_team] = m.away_team_code
  }

  const leftBorder = (i) => {
    if (i < 2) return '2px solid #2D7A4F'
    if (i === 2) return '2px solid #BA7517'
    return '2px solid transparent'
  }

  const thS = {
    padding: '4px 6px', fontSize: 10, fontWeight: 600,
    letterSpacing: '0.05em', color: 'var(--color-text-muted)',
    background: 'var(--color-bg-elevated)', textAlign: 'center',
    whiteSpace: 'nowrap', textTransform: 'uppercase',
  }
  const tdS = {
    padding: '6px 6px', fontSize: 12,
    borderTop: '0.5px solid var(--color-border)',
    color: 'var(--color-text-secondary)',
    textAlign: 'center', whiteSpace: 'nowrap',
  }

  return (
    <div style={{
      border: '0.5px solid var(--color-border)',
      borderRadius: 'var(--radius-lg)',
      background: 'var(--color-bg-card)',
      overflow: 'hidden',
    }}>
      <div style={{ background: '#1A3A6C', padding: '8px 12px' }}>
        <span style={{ fontSize: 11, fontWeight: 500, letterSpacing: '0.06em', color: '#fff', textTransform: 'uppercase' }}>
          Group {group}
        </span>
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={{ ...thS, width: 24, textAlign: 'left', paddingLeft: 10 }}>#</th>
            <th style={{ ...thS, textAlign: 'left' }}>Team</th>
            <th style={thS}>P</th>
            <th style={thS}>W</th>
            <th style={thS}>D</th>
            <th style={thS}>L</th>
            <th style={thS}>GD</th>
            <th style={{ ...thS, color: 'var(--color-text-primary)' }}>Pts</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.team}>
              <td style={{ ...tdS, paddingLeft: 10, fontWeight: 600, color: 'var(--color-text-muted)', textAlign: 'left', borderLeft: leftBorder(i) }}>
                {i + 1}
              </td>
              <td style={{ ...tdS, textAlign: 'left', maxWidth: 110 }}>
                {nameToCode[r.team] ? (
                  <button
                    onClick={() => navigate(`/team/${nameToCode[r.team]}`, { state: { from: 'group' } })}
                    style={{
                      background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                      fontFamily: 'var(--font-ui)', fontSize: 12, color: 'var(--color-text-primary)',
                      fontWeight: i < 2 ? 600 : 400, textAlign: 'left',
                      width: '100%', maxWidth: 110,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block',
                    }}
                  >
                    {getFlag(r.team)} {r.team}
                  </button>
                ) : (
                  <span style={{ fontWeight: i < 2 ? 600 : 400, fontSize: 12, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 110 }}>
                    {getFlag(r.team)} {r.team}
                  </span>
                )}
              </td>
              <td style={tdS}>{r.mp}</td>
              <td style={{ ...tdS, color: r.w > 0 ? 'var(--color-success)' : 'var(--color-text-muted)' }}>{r.w}</td>
              <td style={tdS}>{r.d}</td>
              <td style={{ ...tdS, color: r.l > 0 ? 'var(--color-danger)' : 'var(--color-text-muted)' }}>{r.l}</td>
              <td style={{ ...tdS, color: r.gd > 0 ? 'var(--color-success)' : r.gd < 0 ? 'var(--color-danger)' : 'var(--color-text-muted)' }}>
                {r.gd > 0 ? `+${r.gd}` : r.gd}
              </td>
              <td style={{ ...tdS, fontWeight: 500, color: 'var(--color-text-primary)' }}>{r.pts}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function GroupSection({ group, matches, onAnalyze, statsMap, predMap = {}, showStandings = true, showMatches = true }) {
  const teamNames = [...new Set(
    matches.flatMap(m => [m.home_team, m.away_team])
  )].filter(n => n !== 'TBD')

  return (
    <section id={`group-${group}`} style={{ marginBottom: 28 }}>
      <div style={{
        background: 'var(--color-bg-card)',
        borderLeft: '3px solid var(--color-accent)',
        padding: '10px 16px',
        marginBottom: 8,
        borderRadius: 'var(--radius-sm)',
      }}>
        <span style={{
          fontFamily: 'var(--font-display)',
          fontSize: 14, fontWeight: 600,
          color: 'var(--color-accent)',
          letterSpacing: '0.06em',
        }}>
          GROUP {group}
        </span>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 5 }}>
          {teamNames.map(name => (
            <span key={name} style={{
              fontFamily: 'var(--font-ui)',
              fontSize: 11,
              color: 'var(--color-text-secondary)',
            }}>
              {getFlag(name)} {name}
            </span>
          ))}
        </div>
      </div>
      {showStandings && <GroupStandings matches={matches} />}

      {showMatches && matches.map(match => {
        const s = statsMap[match.id] || {}
        return (
          <MatchCard
            key={match.id}
            match={match}
            onAnalyze={onAnalyze}
            homeStats={s.home || null}
            awayStats={s.away || null}
            prediction={predMap[match.id] || null}
          />
        )
      })}
    </section>
  )
}

function KnockoutSection({ matches, onAnalyze, statsMap, predMap = {} }) {
  return (
    <section id="knockout" style={{ marginBottom: 28 }}>
      {KNOCKOUT_STAGES.map(stage => {
        const stageMatches = matches.filter(m => m.stage === stage)
        if (!stageMatches.length) return null
        return (
          <div key={stage} style={{ marginBottom: 20 }}>
            <div style={{
              background: 'var(--color-bg-card)',
              borderLeft: '3px solid var(--color-warning)',
              padding: '10px 16px',
              marginBottom: 8,
              borderRadius: 'var(--radius-sm)',
            }}>
              <span style={{
                fontFamily: 'var(--font-display)',
                fontSize: 14, fontWeight: 600,
                color: 'var(--color-warning)',
                letterSpacing: '0.06em',
              }}>
                {KNOCKOUT_LABELS[stage] || stage.toUpperCase()}
              </span>
            </div>
            {stageMatches.map(match => {
              const s = statsMap[match.id] || {}
              return (
                <MatchCard
                  key={match.id}
                  match={match}
                  onAnalyze={onAnalyze}
                  homeStats={s.home || null}
                  awayStats={s.away || null}
                  prediction={predMap[match.id] || null}
                />
              )
            })}
          </div>
        )
      })}
    </section>
  )
}

function SidebarNav({ filter, setFilter }) {
  const scrollTo = (id) => {
    const el = document.getElementById(id)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const jumpToGroup = (g) => {
    setFilter('group')
    setTimeout(() => scrollTo(`group-${g}`), 80)
  }

  const linkStyle = (active) => ({
    display: 'block',
    padding: '6px 10px',
    borderRadius: 'var(--radius-sm)',
    fontFamily: 'var(--font-ui)',
    fontSize: 12,
    fontWeight: active ? 600 : 400,
    color: active ? 'var(--color-accent)' : 'var(--color-text-secondary)',
    background: active ? 'var(--color-accent-dim)' : 'transparent',
    cursor: 'pointer',
    border: 'none',
    textAlign: 'left',
    width: '100%',
  })

  return (
    <nav style={{
      background: 'var(--color-bg-card)',
      border: '0.5px solid var(--color-border)',
      borderRadius: 'var(--radius-md)',
      padding: '12px 8px',
    }}>
      <p style={{ fontSize: 10, fontWeight: 600, color: 'var(--color-text-muted)', letterSpacing: '0.06em', padding: '0 10px', marginBottom: 4 }}>
        GROUPS
      </p>
      {GROUPS.map(g => (
        <button key={g} onClick={() => jumpToGroup(g)} style={linkStyle(filter === 'group')}>
          Group {g}
        </button>
      ))}
      <p style={{ fontSize: 10, fontWeight: 600, color: 'var(--color-text-muted)', letterSpacing: '0.06em', padding: '4px 10px 4px', marginTop: 8, marginBottom: 4 }}>
        KNOCKOUT
      </p>
      <button onClick={() => { setFilter('knockout'); setTimeout(() => scrollTo('knockout'), 80) }} style={linkStyle(filter === 'knockout')}>
        Knockout Stage
      </button>
    </nav>
  )
}

export default function Matches() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user } = useAuth()
  const { t, lang } = useTranslation()
  const { matchesByGroup, matches, loading, error, refetch } = useMatchesByGroup()
  // Restore tab when navigating back from TeamProfile (state.from === 'group')
  const [filter, setFilter] = useState(location.state?.from === 'group' ? 'group' : 'overview')
  const [refreshingAll, setRefreshingAll] = useState(false)
  const [refreshMsg, setRefreshMsg] = useState('')
  const [statsMap, setStatsMap] = useState({})
  const [selectedDate, setSelectedDate] = useState(null) // null = "All dates"
  const stripRef = useRef(null)

  const isAdmin = user?.id === ADMIN_UUID
  const [predMap, setPredMap] = useState({})

  // Load model_predictions for all matches
  useEffect(() => {
    if (!matches.length) return
    const matchIds = matches.map(m => m.id)
    supabase
      .from('model_predictions')
      .select('match_id, v3_home_win, v3_draw, v3_away_win, v1_home_win, v1_draw, v1_away_win, anchor_total, v3_top_score, correct_v1, correct_v2, correct_v3, actual_outcome, brier_score, quality_warning')
      .in('match_id', matchIds)
      .then(({ data }) => {
        if (data) {
          const map = {}
          data.forEach(p => { map[p.match_id] = p })
          setPredMap(map)
        }
      })
  }, [matches])

  // Load all team_stats for rendering badges / form dots
  useEffect(() => {
    if (!matches.length) return
    const matchIds = matches.map(m => m.id)
    supabase
      .from('team_stats')
      .select('match_id, team_code, goals_scored_avg, goals_conceded_avg, form_string, xgf_per_game, xga_per_game, home_goals_avg, away_goals_avg, games_window, updated_at')
      .in('match_id', matchIds)
      .then(({ data }) => {
        if (data) setStatsMap(buildStatsMap(data, matches))
      })
  }, [matches])

  function onAnalyze(matchId) {
    navigate(`/matches/${matchId}`)
  }

  async function handleRefreshAll() {
    setRefreshingAll(true)
    setRefreshMsg('')

    const SIX_HOURS  = 6  * 60 * 60 * 1000
    const DAY_MS     = 24 * 60 * 60 * 1000
    const now        = Date.now()

    // Determine which matches need syncing
    const needsSync = matches.filter(m => {
      if (m.home_team === 'TBD' || m.away_team === 'TBD') return false

      // Finished matches: skip if stats updated within last 24h
      if (m.status === 'finished') {
        const s = statsMap[m.id]
        const oldestUpdate = Math.min(
          s?.home?.updated_at ? new Date(s.home.updated_at).getTime() : 0,
          s?.away?.updated_at ? new Date(s.away.updated_at).getTime() : 0,
        )
        return oldestUpdate === 0 || (now - oldestUpdate) > DAY_MS
      }

      // Upcoming/live: skip if BOTH teams have stats updated within 6h
      const s = statsMap[m.id]
      if (s?.home?.updated_at && s?.away?.updated_at) {
        const oldest = Math.min(
          new Date(s.home.updated_at).getTime(),
          new Date(s.away.updated_at).getTime(),
        )
        if ((now - oldest) < SIX_HOURS) return false
      }
      return true
    })

    if (!needsSync.length) {
      setRefreshMsg('All stats are fresh — nothing to sync')
      setRefreshingAll(false)
      return
    }

    // Batch into groups of 3
    const BATCH = 3
    const batches = []
    for (let i = 0; i < needsSync.length; i += BATCH) {
      batches.push(needsSync.slice(i, i + BATCH).map(m => m.id))
    }

    const total      = needsSync.length
    let synced       = 0
    let failed       = 0
    let failReasons  = []

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i]
      const done  = i * BATCH
      setRefreshMsg(`Syncing ${Math.min(done + BATCH, total)}/${total} matches…`)

      try {
        const result = await syncAllStats(batch)
        if (result.ok === false) {
          failed += batch.length
          failReasons.push(result.error || 'unknown error')
        } else {
          synced += result.synced || 0
        }
      } catch (err) {
        failed += batch.length
        failReasons.push(err.message)
      }

      // Rate-limit pause between batches (skip after last)
      if (i < batches.length - 1) {
        await new Promise(r => setTimeout(r, 2000))
      }
    }

    // Summary
    let msg = `Synced ${synced} stat rows across ${total - failed}/${total} matches`
    if (failed > 0) {
      const reason = failReasons[0] || 'rate limit'
      msg += ` · ${failed} failed (${reason})`
    }
    setRefreshMsg(msg)
    refetch()
    setRefreshingAll(false)
  }

  // All non-finished (non-TBD) matches for the Upcoming tab and its badge count
  const upcomingMatches = matches.filter(m => m.status !== 'finished' && m.home_team !== 'TBD' && m.away_team !== 'TBD')

  // Today's date key in Beijing time
  const todayKey = useMemo(() => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date()), [])

  // Matches for the active stage filter — only needed for date pills (all/upcoming only)
  const stageMatches = useMemo(() => {
    if (filter === 'upcoming') return upcomingMatches
    if (filter === 'all') return matches
    return [] // no date pills for group/knockout tabs
  }, [filter, matches, upcomingMatches])

  // Date pills derived from stage matches
  const datePills = useMemo(() => {
    const grouped = {}
    for (const m of stageMatches) {
      const key = dateKey(m.match_date)
      if (!grouped[key]) grouped[key] = []
      grouped[key].push(m)
    }
    return Object.keys(grouped).sort().map(date => ({
      date,
      count: grouped[date].length,
      hasUpcoming: grouped[date].some(m => m.status !== 'finished'),
    }))
  }, [stageMatches])

  // Reset date selection when filter changes
  const handleSetFilter = useCallback((f) => {
    setFilter(f)
    setSelectedDate(null)
  }, [])

  // Auto-select today or next upcoming date when pills load
  useEffect(() => {
    if (!datePills.length) return
    const todayPill = datePills.find(p => p.date === todayKey)
    if (todayPill) {
      setSelectedDate(todayKey)
    } else {
      const next = datePills.find(p => p.date > todayKey && p.hasUpcoming)
      setSelectedDate(next?.date ?? null)
    }
  }, [datePills.length, todayKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-scroll to the selected pill
  useEffect(() => {
    if (!selectedDate) return
    const el = document.getElementById(`date-pill-${selectedDate}`)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
  }, [selectedDate])

  // Matches visible after both stage + date filter
  const displayMatches = useMemo(() => {
    if (!selectedDate) return stageMatches
    return stageMatches.filter(m => dateKey(m.match_date) === selectedDate)
  }, [stageMatches, selectedDate])

  if (loading) {
    return (
      <div style={{ padding: '24px 16px', maxWidth: 720, margin: '0 auto' }}>
        <div style={{ height: 36, width: 120, marginBottom: 20 }} className="skeleton" />
        {[1, 2, 3].map(i => (
          <div key={i} className="skeleton" style={{ height: 100, marginBottom: 12 }} />
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <div style={{ padding: '24px 16px', maxWidth: 720, margin: '0 auto' }}>
        <div style={{
          background: 'var(--color-danger-dim)',
          border: '0.5px solid var(--color-danger)',
          borderRadius: 'var(--radius-md)',
          padding: '16px',
          marginBottom: 16,
        }}>
          <p style={{ color: 'var(--color-danger)', fontSize: 14, marginBottom: 8 }}>
            {t('common.error')}
          </p>
          <p style={{ color: 'var(--color-text-secondary)', fontSize: 12 }}>{error}</p>
        </div>
        <button
          onClick={refetch}
          style={{
            minHeight: 'var(--touch-target)',
            padding: '0 20px',
            background: 'var(--color-accent-dim)',
            border: '0.5px solid var(--color-accent-border)',
            borderRadius: 'var(--radius-sm)',
            color: 'var(--color-accent)',
            fontFamily: 'var(--font-ui)',
            fontSize: 14,
            cursor: 'pointer',
          }}
        >
          Retry
        </button>
      </div>
    )
  }

  const filterButtons = [
    { key: 'overview',  label: lang === 'zh' ? '总览' : 'Overview' },
    { key: 'all',       label: t('matches.filter.all') },
    { key: 'upcoming',  label: t('matches.filter.upcoming') },
    { key: 'group',     label: t('matches.filter.group') },
    { key: 'knockout',  label: t('matches.filter.knockout') },
    { key: 'simulator', label: lang === 'zh' ? '🎮 模拟器' : '🎮 Simulator' },
  ]

  return (
    <div className="matches-page">
      {/* Desktop sidebar */}
      <div className="matches-sidebar">
        <SidebarNav filter={filter} setFilter={handleSetFilter} />
      </div>

      {/* Main content */}
      <div>
        {/* Sticky header */}
        <div className="matches-sticky-header">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <h1 style={{
              fontFamily: 'var(--font-display)',
              fontSize: 24, fontWeight: 600,
              color: 'var(--color-text-primary)',
            }}>
              {t('matches.title')}
            </h1>
            {isAdmin && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {refreshMsg && (
                  <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{refreshMsg}</span>
                )}
                <button
                  onClick={handleRefreshAll}
                  disabled={refreshingAll}
                  style={{
                    minHeight: 32,
                    padding: '0 12px',
                    background: refreshingAll ? 'transparent' : 'var(--color-accent-dim)',
                    border: '0.5px solid var(--color-accent-border)',
                    borderRadius: 'var(--radius-sm)',
                    color: 'var(--color-accent)',
                    fontFamily: 'var(--font-ui)',
                    fontSize: 12,
                    cursor: refreshingAll ? 'not-allowed' : 'pointer',
                    opacity: refreshingAll ? 0.6 : 1,
                  }}
                >
                  {refreshingAll ? t('common.loading') : `↻ ${t('analysis.refreshAll')}`}
                </button>
              </div>
            )}
          </div>

          {/* Filter chips */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {filterButtons.map(f => (
              <button
                key={f.key}
                onClick={() => handleSetFilter(f.key)}
                style={{
                  minHeight: 32,
                  padding: '0 14px',
                  borderRadius: 'var(--radius-full)',
                  border: filter === f.key
                    ? '0.5px solid var(--color-accent-border)'
                    : '0.5px solid var(--color-border)',
                  background: filter === f.key ? 'var(--color-accent-dim)' : 'transparent',
                  color: filter === f.key ? 'var(--color-accent)' : 'var(--color-text-secondary)',
                  fontFamily: 'var(--font-ui)',
                  fontSize: 13,
                  fontWeight: filter === f.key ? 600 : 400,
                  cursor: 'pointer',
                }}
              >
                {f.label}
                {f.key === 'upcoming' && (
                  <span style={{
                    marginLeft: 5,
                    fontSize: 10,
                    background: 'var(--color-info-dim)',
                    color: 'var(--color-info)',
                    borderRadius: 'var(--radius-full)',
                    padding: '1px 5px',
                  }}>
                    {upcomingMatches.length}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* ── Date pill strip (All / Upcoming tabs only) ── */}
          {(filter === 'all' || filter === 'upcoming') && datePills.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', marginTop: 10, marginBottom: 4 }}>
              {/* Left arrow (desktop only) */}
              <button
                className="date-strip-arrow"
                onClick={() => stripRef.current?.scrollBy({ left: -(3 * 58), behavior: 'smooth' })}
                aria-label="Scroll left"
                style={{
                  flexShrink: 0, width: 28, height: 28, borderRadius: '50%',
                  background: 'var(--color-bg-card)', border: '0.5px solid var(--color-border)',
                  cursor: 'pointer', fontSize: 14, color: 'var(--color-text-muted)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >‹</button>

              {/* Scrollable strip — flex:'1 1 0'+width:0 forces it to start at zero
                  width and grow only into the remaining space after the two arrows */}
              <div
                ref={stripRef}
                className="date-strip-inner"
                style={{
                  flex: '1 1 0', width: 0, display: 'flex', gap: 6,
                  overflowX: 'auto', scrollSnapType: 'x mandatory',
                  WebkitOverflowScrolling: 'touch', padding: '4px 2px',
                  scrollbarWidth: 'none', msOverflowStyle: 'none',
                }}
              >
                {/* "All dates" pill */}
                <button
                  id="date-pill-all"
                  onClick={() => setSelectedDate(null)}
                  style={{
                    scrollSnapAlign: 'start', flexShrink: 0,
                    width: 56, minHeight: 56, padding: '6px 0',
                    borderRadius: 'var(--radius-md)', cursor: 'pointer',
                    border: selectedDate === null ? '0.5px solid #1A3A6C' : '0.5px solid var(--color-border)',
                    background: selectedDate === null ? '#1A3A6C' : 'var(--color-bg-card)',
                    color: selectedDate === null ? '#fff' : 'var(--color-text-muted)',
                    fontSize: 11, fontWeight: 600, fontFamily: 'var(--font-ui)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    lineHeight: 1.2,
                  }}
                >
                  {lang === 'zh' ? '全部' : 'All'}
                </button>

                {/* Date pills */}
                {datePills.map(({ date, count, hasUpcoming }) => {
                  const [y, mo, d] = date.split('-').map(Number)
                  const jsDate = new Date(Date.UTC(y, mo - 1, d))
                  const dayName = jsDate.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })
                  const monthName = jsDate.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' })
                  const isToday = date === todayKey
                  const isSelected = date === selectedDate

                  return (
                    <button
                      key={date}
                      id={`date-pill-${date}`}
                      onClick={() => setSelectedDate(date)}
                      style={{
                        scrollSnapAlign: 'start', flexShrink: 0, position: 'relative',
                        width: 56, minHeight: 56, padding: '6px 0 10px',
                        borderRadius: 'var(--radius-md)', cursor: 'pointer', textAlign: 'center',
                        border: `0.5px solid ${isSelected ? '#1A3A6C' : isToday ? 'var(--color-accent-border)' : 'var(--color-border)'}`,
                        background: isSelected ? '#1A3A6C' : 'var(--color-bg-card)',
                        color: isSelected ? '#fff' : hasUpcoming ? 'var(--color-text-secondary)' : 'var(--color-text-muted)',
                        fontFamily: 'var(--font-ui)',
                        opacity: hasUpcoming ? 1 : 0.65,
                      }}
                    >
                      {/* Count badge */}
                      <span style={{
                        position: 'absolute', top: 2, right: 2,
                        fontSize: 9, lineHeight: 1,
                        background: hasUpcoming ? (isSelected ? 'rgba(201,168,76,0.25)' : '#EAF3DE') : (isSelected ? 'rgba(255,255,255,0.2)' : 'var(--color-bg-elevated)'),
                        color: hasUpcoming ? (isSelected ? '#C9A84C' : '#27500A') : (isSelected ? 'rgba(255,255,255,0.7)' : 'var(--color-text-muted)'),
                        borderRadius: 99, padding: '1px 4px',
                      }}>
                        {count}
                      </span>
                      {/* Day name */}
                      <p style={{ fontSize: 10, margin: 0 }}>{dayName}</p>
                      {/* Day number */}
                      <p style={{
                        fontSize: 18, fontWeight: 500, margin: '1px 0',
                        fontFamily: "'IBM Plex Mono', monospace",
                        lineHeight: 1,
                      }}>{d}</p>
                      {/* Month */}
                      <p style={{ fontSize: 10, margin: 0 }}>{monthName}</p>
                      {/* Gold dot for today (always, regardless of selected state) */}
                      {isToday && (
                        <div style={{
                          width: 4, height: 4, borderRadius: '50%',
                          background: '#C9A84C', margin: '3px auto 0',
                        }} />
                      )}
                    </button>
                  )
                })}
              </div>

              {/* Right arrow (desktop only) */}
              <button
                className="date-strip-arrow"
                onClick={() => stripRef.current?.scrollBy({ left: 3 * 58, behavior: 'smooth' })}
                aria-label="Scroll right"
                style={{
                  flexShrink: 0, width: 28, height: 28, borderRadius: '50%',
                  background: 'var(--color-bg-card)', border: '0.5px solid var(--color-border)',
                  cursor: 'pointer', fontSize: 14, color: 'var(--color-text-muted)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >›</button>
            </div>
          )}
        </div>

        {/* ── OVERVIEW: today's matches + recent results ── */}
        {filter === 'overview' && (
          <div style={{ padding: '8px 0' }}>
            <div style={{
              fontSize: 10, fontFamily: "'IBM Plex Mono', monospace",
              letterSpacing: '0.08em', color: 'var(--color-text-muted)',
              textTransform: 'uppercase', marginBottom: 10,
            }}>
              {lang === 'zh' ? '今日赛事' : "Today's Matches"}
            </div>
            {(() => {
              const beijingNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }))
              const todayMatches = matches
                .filter(m => {
                  const bj = new Date(new Date(m.match_date).toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }))
                  return bj.toDateString() === beijingNow.toDateString()
                })
                .slice(0, 6)
              const upcoming6 = todayMatches.length > 0 ? todayMatches : matches
                .filter(m => m.status === 'upcoming' && m.home_team !== 'TBD')
                .sort((a, b) => new Date(a.match_date) - new Date(b.match_date))
                .slice(0, 6)
              return upcoming6.length === 0
                ? <div style={{ fontSize: 13, color: 'var(--color-text-muted)', padding: '8px 0' }}>
                    {lang === 'zh' ? '今日无赛事' : 'No matches today'}
                  </div>
                : upcoming6.map(m => (
                  <div key={m.id} style={{
                    display: 'flex', alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '10px 14px',
                    border: '0.5px solid var(--color-border)',
                    borderRadius: 'var(--radius-md)',
                    marginBottom: 8,
                    background: 'var(--color-bg-card)',
                  }}>
                    <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text-primary)' }}>
                      {m.home_team} vs {m.away_team}
                    </span>
                    <span style={{
                      fontSize: 11, fontFamily: "'IBM Plex Mono', monospace",
                      color: 'var(--color-text-muted)',
                    }}>
                      {m.status === 'finished'
                        ? `${m.home_score}-${m.away_score}`
                        : new Date(m.match_date).toLocaleString('zh-CN', {
                            timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit',
                          })
                      }
                    </span>
                  </div>
                ))
            })()}

            <div style={{
              fontSize: 10, fontFamily: "'IBM Plex Mono', monospace",
              letterSpacing: '0.08em', color: 'var(--color-text-muted)',
              textTransform: 'uppercase', marginBottom: 10, marginTop: 20,
            }}>
              {lang === 'zh' ? '最近结果' : 'Recent Results'}
            </div>
            {matches
              .filter(m => m.status === 'finished')
              .slice(-5)
              .reverse()
              .map(m => (
                <div key={m.id} style={{
                  display: 'flex', alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '8px 14px',
                  borderBottom: '0.5px solid var(--color-border-light)',
                }}>
                  <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
                    {m.home_team} vs {m.away_team}
                  </span>
                  <span style={{
                    fontSize: 13, fontWeight: 500,
                    fontFamily: "'IBM Plex Mono', monospace",
                    color: 'var(--color-text-primary)',
                  }}>
                    {m.home_score} - {m.away_score}
                  </span>
                </div>
              ))
            }
          </div>
        )}

        {/* ── ALL: flat list sorted date ASC ── */}
        {filter === 'all' && (
          <FlatMatchList
            matches={displayMatches}
            onAnalyze={onAnalyze}
            statsMap={statsMap}
            predMap={predMap}
            hideHeaders={!!selectedDate}
            lang={lang}
          />
        )}

        {/* ── UPCOMING: flat list of non-finished matches ── */}
        {filter === 'upcoming' && (
          <FlatMatchList
            matches={displayMatches}
            onAnalyze={onAnalyze}
            statsMap={statsMap}
            predMap={predMap}
            hideHeaders={!!selectedDate}
            lang={lang}
          />
        )}

        {/* ── GROUPS: 12 compact standings cards in responsive grid ── */}
        {filter === 'group' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14 }}>
            {GROUPS.map(g => (
              <GroupCard key={g} group={g} matches={matchesByGroup[g] || []} />
            ))}
          </div>
        )}

        {/* ── KNOCKOUT: stage sections ── */}
        {filter === 'knockout' && (
          <div>
            <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-muted)', letterSpacing: '0.06em', marginBottom: 12 }}>
              {t('matches.knockout').toUpperCase()}
            </p>
            <KnockoutSection
              matches={matchesByGroup['knockout'] || []}
              onAnalyze={onAnalyze}
              statsMap={statsMap}
              predMap={predMap}
            />
          </div>
        )}

        {/* ── SIMULATOR ── */}
        {filter === 'simulator' && (
          <div style={{ marginTop: 8 }}>
            <Simulator />
          </div>
        )}
      </div>
    </div>
  )
}
