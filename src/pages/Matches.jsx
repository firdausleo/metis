import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useTranslation } from '../lib/i18n'
import { useMatchesByGroup } from '../hooks/useMatches'
import MatchCard from '../components/MatchCard'
import { getFlag } from '../lib/teamFlags'
import { syncAllStats } from '../lib/statsApi'
import { supabase } from '../lib/supabase'

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
  const rows = calcStandings(matches)
  if (!rows.length) return null

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
              <td style={{ ...td, textAlign: 'left', color: 'var(--color-text-primary)', fontWeight: i < 2 ? 600 : 400 }}>
                {getFlag(r.team)} {r.team}
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

// Returns YYYY-MM-DD (UTC) for grouping by day
function dateKey(dateStr) {
  return new Date(dateStr).toISOString().slice(0, 10)
}

function dayLabel(key) {
  const [y, m, d] = key.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  return date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
}

function FlatMatchList({ matches, onAnalyze, statsMap }) {
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

  return (
    <div>
      {days.map(day => (
        <div key={day} style={{ marginBottom: 20 }}>
          <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-muted)', letterSpacing: '0.06em', marginBottom: 8 }}>
            {dayLabel(day).toUpperCase()}
          </p>
          {byDay[day].map(m => {
            const s = statsMap[m.id] || {}
            return (
              <MatchCard key={m.id} match={m} onAnalyze={onAnalyze} homeStats={s.home || null} awayStats={s.away || null} />
            )
          })}
        </div>
      ))}
    </div>
  )
}

function GroupSection({ group, matches, onAnalyze, statsMap, showStandings = true }) {
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

      {matches.map(match => {
        const s = statsMap[match.id] || {}
        return (
          <MatchCard
            key={match.id}
            match={match}
            onAnalyze={onAnalyze}
            homeStats={s.home || null}
            awayStats={s.away || null}
          />
        )
      })}
    </section>
  )
}

function KnockoutSection({ matches, onAnalyze, statsMap }) {
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
  const { user } = useAuth()
  const { t } = useTranslation()
  const { matchesByGroup, matches, loading, error, refetch } = useMatchesByGroup()
  const [filter, setFilter] = useState('all')
  const [refreshingAll, setRefreshingAll] = useState(false)
  const [refreshMsg, setRefreshMsg] = useState('')
  const [statsMap, setStatsMap] = useState({})

  const isAdmin = user?.id === ADMIN_UUID

  // Load all team_stats for rendering badges / form dots
  useEffect(() => {
    if (!matches.length) return
    const matchIds = matches.map(m => m.id)
    supabase
      .from('team_stats')
      .select('match_id, team_code, goals_scored_avg, goals_conceded_avg, form_string, xgf_per_game, xga_per_game, home_goals_avg, away_goals_avg, games_window')
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
    try {
      // Use CF Worker sync-stats endpoint (MT03 — bulk scrape + Supabase write stays server-side)
      const result = await syncAllStats()
      const teams = result.teams_found || 0
      const partial = result.partial_data?.length || 0
      let msg = `Synced ${result.synced || 0} rows (${teams} teams)`
      if (partial > 0) msg += ` · ${partial} partial`
      if (result.scrape_error) msg += ` · ⚠ ${result.scrape_error}`
      setRefreshMsg(msg)
      refetch()
    } catch (err) {
      setRefreshMsg('Refresh failed: ' + err.message)
    }
    setRefreshingAll(false)
  }

  // All non-finished (non-TBD) matches for the Upcoming tab and its badge count
  const upcomingMatches = matches.filter(m => m.status !== 'finished' && m.home_team !== 'TBD' && m.away_team !== 'TBD')

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
    { key: 'all',      label: t('matches.filter.all') },
    { key: 'upcoming', label: t('matches.filter.upcoming') },
    { key: 'group',    label: t('matches.filter.group') },
    { key: 'knockout', label: t('matches.filter.knockout') },
  ]

  return (
    <div className="matches-page">
      {/* Desktop sidebar */}
      <div className="matches-sidebar">
        <SidebarNav filter={filter} setFilter={setFilter} />
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
                onClick={() => setFilter(f.key)}
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
        </div>

        {/* ── ALL: flat list sorted date ASC, no standings ── */}
        {filter === 'all' && (
          <FlatMatchList matches={matches} onAnalyze={onAnalyze} statsMap={statsMap} />
        )}

        {/* ── UPCOMING: flat list of non-finished matches, no standings ── */}
        {filter === 'upcoming' && (
          <FlatMatchList matches={upcomingMatches} onAnalyze={onAnalyze} statsMap={statsMap} />
        )}

        {/* ── GROUPS: standings + match cards per group ── */}
        {filter === 'group' && (
          <div>
            {GROUPS.map(g => (
              <GroupSection
                key={g}
                group={g}
                matches={matchesByGroup[g] || []}
                onAnalyze={onAnalyze}
                statsMap={statsMap}
                showStandings={true}
              />
            ))}
          </div>
        )}

        {/* ── KNOCKOUT ── */}
        {filter === 'knockout' && (
          <div>
            <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-muted)', letterSpacing: '0.06em', marginBottom: 12 }}>
              {t('matches.knockout').toUpperCase()}
            </p>
            <KnockoutSection
              matches={matchesByGroup['knockout'] || []}
              onAnalyze={onAnalyze}
              statsMap={statsMap}
            />
          </div>
        )}
      </div>
    </div>
  )
}
