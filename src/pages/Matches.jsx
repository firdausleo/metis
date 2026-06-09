import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useTranslation } from '../lib/i18n'
import { useMatchesByGroup, getTodaysMatches } from '../hooks/useMatches'
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

function GroupSection({ group, matches, onAnalyze, statsMap }) {
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

function SidebarNav({ filter }) {
  const scrollTo = (id) => {
    const el = document.getElementById(id)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
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
      {(filter === 'all' || filter === 'group' || filter === 'upcoming') && (
        <>
          <p style={{ fontSize: 10, fontWeight: 600, color: 'var(--color-text-muted)', letterSpacing: '0.06em', padding: '0 10px', marginBottom: 4 }}>
            GROUPS
          </p>
          {GROUPS.map(g => (
            <button key={g} onClick={() => scrollTo(`group-${g}`)} style={linkStyle(false)}>
              Group {g}
            </button>
          ))}
        </>
      )}
      {(filter === 'all' || filter === 'knockout') && (
        <>
          <p style={{ fontSize: 10, fontWeight: 600, color: 'var(--color-text-muted)', letterSpacing: '0.06em', padding: '4px 10px 4px', marginTop: 8, marginBottom: 4 }}>
            KNOCKOUT
          </p>
          <button onClick={() => scrollTo('knockout')} style={linkStyle(false)}>
            Knockout Stage
          </button>
        </>
      )}
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

  const today = getTodaysMatches(matches)

  // Upcoming-only filter: status = 'upcoming', non-TBD
  const upcomingMatches = matches.filter(m => m.status === 'upcoming' && m.home_team !== 'TBD' && m.away_team !== 'TBD')
  const upcomingByGroup = {}
  for (const m of upcomingMatches) {
    const key = m.stage === 'group' ? m.group_name : 'knockout'
    if (!upcomingByGroup[key]) upcomingByGroup[key] = []
    upcomingByGroup[key].push(m)
  }

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

  // Which matchesByGroup to display
  const displayGroups = filter === 'upcoming' ? upcomingByGroup : matchesByGroup

  return (
    <div className="matches-page">
      {/* Desktop sidebar */}
      <div className="matches-sidebar">
        <SidebarNav filter={filter} />
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

        {/* ── UPCOMING filter view ── */}
        {filter === 'upcoming' && (
          <div>
            {upcomingMatches.length === 0 ? (
              <div style={{
                background: 'var(--color-bg-card)',
                border: '0.5px solid var(--color-border)',
                borderRadius: 'var(--radius-md)',
                padding: '16px',
                textAlign: 'center',
                color: 'var(--color-text-muted)',
                fontSize: 13,
              }}>
                No upcoming matches
              </div>
            ) : (
              <>
                {/* Group upcoming */}
                {GROUPS.map(g => {
                  const gMatches = upcomingByGroup[g] || []
                  if (!gMatches.length) return null
                  return (
                    <GroupSection
                      key={g}
                      group={g}
                      matches={gMatches}
                      onAnalyze={onAnalyze}
                      statsMap={statsMap}
                    />
                  )
                })}
                {/* Knockout upcoming */}
                {upcomingByGroup['knockout']?.length > 0 && (
                  <KnockoutSection
                    matches={upcomingByGroup['knockout']}
                    onAnalyze={onAnalyze}
                    statsMap={statsMap}
                  />
                )}
              </>
            )}
          </div>
        )}

        {/* ── ALL / GROUP / KNOCKOUT views ── */}
        {filter !== 'upcoming' && (
          <>
            {/* Today's matches */}
            {today.length > 0 && filter === 'all' && (
              <div style={{ marginBottom: 28 }}>
                <p style={{
                  fontSize: 11, fontWeight: 700,
                  color: 'var(--color-text-muted)',
                  letterSpacing: '0.06em',
                  marginBottom: 10,
                }}>
                  {t('matches.today').toUpperCase()}
                </p>
                <div style={{
                  display: 'flex',
                  gap: 10,
                  overflowX: 'auto',
                  paddingBottom: 8,
                  scrollbarWidth: 'none',
                }}>
                  {today.map(m => (
                    <MatchCard key={m.id} match={m} onAnalyze={onAnalyze} compact />
                  ))}
                </div>
              </div>
            )}

            {today.length === 0 && filter === 'all' && (
              <div style={{
                background: 'var(--color-bg-card)',
                border: '0.5px solid var(--color-border)',
                borderRadius: 'var(--radius-md)',
                padding: '12px 16px',
                marginBottom: 20,
              }}>
                <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
                  {t('matches.noToday')}
                </p>
              </div>
            )}

            {/* Group sections */}
            {(filter === 'all' || filter === 'group') && (
              <div>
                <p style={{
                  fontSize: 11, fontWeight: 700,
                  color: 'var(--color-text-muted)',
                  letterSpacing: '0.06em',
                  marginBottom: 12,
                }}>
                  {t('matches.groupStage').toUpperCase()}
                </p>
                {GROUPS.map(g => (
                  <GroupSection
                    key={g}
                    group={g}
                    matches={displayGroups[g] || []}
                    onAnalyze={onAnalyze}
                    statsMap={statsMap}
                  />
                ))}
              </div>
            )}

            {/* Knockout section */}
            {(filter === 'all' || filter === 'knockout') && (
              <div>
                <p style={{
                  fontSize: 11, fontWeight: 700,
                  color: 'var(--color-text-muted)',
                  letterSpacing: '0.06em',
                  marginBottom: 12,
                }}>
                  {t('matches.knockout').toUpperCase()}
                </p>
                <KnockoutSection
                  matches={displayGroups['knockout'] || []}
                  onAnalyze={onAnalyze}
                  statsMap={statsMap}
                />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
