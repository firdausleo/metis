import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useTranslation } from '../lib/i18n'
import { useMatchesByGroup, getTodaysMatches } from '../hooks/useMatches'
import MatchCard from '../components/MatchCard'
import { getFlag } from '../lib/teamFlags'
import { fetchTeamStats } from '../lib/statsApi'
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

function GroupSection({ group, matches, onAnalyze }) {
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
      {matches.map(match => (
        <MatchCard key={match.id} match={match} onAnalyze={onAnalyze} />
      ))}
    </section>
  )
}

function KnockoutSection({ matches, onAnalyze }) {
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
            {stageMatches.map(match => (
              <MatchCard key={match.id} match={match} onAnalyze={onAnalyze} />
            ))}
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
      {(filter === 'all' || filter === 'group') && (
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

  const isAdmin = user?.id === ADMIN_UUID

  function onAnalyze(matchId) {
    navigate(`/matches/${matchId}`)
  }

  async function handleRefreshAll() {
    setRefreshingAll(true)
    setRefreshMsg('')
    try {
      const upcoming = matches.filter(m => m.status === 'upcoming' && m.home_team !== 'TBD' && m.away_team !== 'TBD')
      const teams = [...new Set(upcoming.flatMap(m => [
        { name: m.home_team, code: m.home_team_code },
        { name: m.away_team, code: m.away_team_code },
      ]).map(t => JSON.stringify(t))).values()].map(s => JSON.parse(s))

      const statsCache = {}
      await Promise.allSettled(teams.map(async ({ name, code }) => {
        try {
          const data = await fetchTeamStats(name)
          statsCache[code] = data
        } catch { /* skip failed teams */ }
      }))

      const rows = upcoming.flatMap(m => {
        const result = []
        const buildRow = (code, data, matchId) => ({
          team_code: code, match_id: matchId,
          xgf_per_game: data.xgf && data.matches_played ? Number((data.xgf / data.matches_played).toFixed(3)) : null,
          xga_per_game: data.xga && data.matches_played ? Number((data.xga / data.matches_played).toFixed(3)) : null,
          goals_scored_avg: data.scored && data.matches_played ? Number((data.scored / data.matches_played).toFixed(3)) : null,
          goals_conceded_avg: data.conceded && data.matches_played ? Number((data.conceded / data.matches_played).toFixed(3)) : null,
          games_window: data.matches_played || 0,
          wc_games_in_window: 0,
          updated_at: new Date().toISOString(),
        })
        if (statsCache[m.home_team_code]) result.push(buildRow(m.home_team_code, statsCache[m.home_team_code], m.id))
        if (statsCache[m.away_team_code]) result.push(buildRow(m.away_team_code, statsCache[m.away_team_code], m.id))
        return result
      })

      if (rows.length) {
        await supabase.from('team_stats').upsert(rows, { onConflict: 'team_code,match_id' })
      }
      setRefreshMsg(`Updated ${Object.keys(statsCache).length} teams`)
    } catch (err) {
      setRefreshMsg('Refresh failed: ' + err.message)
    }
    setRefreshingAll(false)
  }

  const today = getTodaysMatches(matches)

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

  const filterButtons = ['all', 'group', 'knockout']

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
          <div style={{ display: 'flex', gap: 8 }}>
            {filterButtons.map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                style={{
                  minHeight: 32,
                  padding: '0 14px',
                  borderRadius: 'var(--radius-full)',
                  border: filter === f
                    ? '0.5px solid var(--color-accent-border)'
                    : '0.5px solid var(--color-border)',
                  background: filter === f ? 'var(--color-accent-dim)' : 'transparent',
                  color: filter === f ? 'var(--color-accent)' : 'var(--color-text-secondary)',
                  fontFamily: 'var(--font-ui)',
                  fontSize: 13,
                  fontWeight: filter === f ? 600 : 400,
                  cursor: 'pointer',
                }}
              >
                {t(`matches.filter.${f}`)}
              </button>
            ))}
          </div>
        </div>

        {/* Today's matches */}
        {today.length > 0 && (filter === 'all') && (
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
                matches={matchesByGroup[g] || []}
                onAnalyze={onAnalyze}
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
              matches={matchesByGroup['knockout'] || []}
              onAnalyze={onAnalyze}
            />
          </div>
        )}
      </div>
    </div>
  )
}
