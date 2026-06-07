import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useTeamStats } from '../hooks/useTeamStats'
import { useTranslation } from '../lib/i18n'
import { getFlag } from '../lib/teamFlags'
import { toBeijingTime } from '../lib/dateUtils'
import { supabase } from '../lib/supabase'

const ADMIN_UUID = '4a6e1f29-e18b-4fd3-9a7e-cec54501db54'

const STAGE_LABELS = {
  group: 'Group Stage', r32: 'Round of 32', r16: 'Round of 16',
  qf: 'Quarter Final', sf: 'Semi Final', '3rd': 'Third Place', final: 'Final',
}

const CONFIDENCE_CONFIG = {
  low:    { label: '⚠️ Low Confidence',    color: 'var(--color-danger)' },
  medium: { label: 'Medium Confidence',    color: 'var(--color-warning)' },
  high:   { label: '✅ High Confidence',   color: 'var(--color-accent)' },
  max:    { label: '✅✅ Max Confidence',  color: 'var(--color-accent)' },
}

const TABS = ['stats', 'matrix', 'value', 'portfolio']

function StatCard({ label, value, dim }) {
  return (
    <div style={{
      background: 'var(--color-bg-card)',
      border: '0.5px solid var(--color-border)',
      borderRadius: 'var(--radius-md)',
      padding: '12px',
      flex: 1,
      minWidth: 0,
    }}>
      <p style={{ fontSize: 10, color: 'var(--color-text-muted)', fontWeight: 600, letterSpacing: '0.05em', marginBottom: 4 }}>
        {label}
      </p>
      <p style={{
        fontFamily: 'var(--font-display)',
        fontSize: 22,
        fontWeight: 600,
        color: dim ? 'var(--color-text-muted)' : 'var(--color-text-primary)',
      }}>
        {value ?? '—'}
      </p>
    </div>
  )
}

function ManualInputForm({ teamCode, teamName, onSave, t }) {
  const [form, setForm] = useState({ xgf_per_game: '', xga_per_game: '', goals_scored_avg: '', goals_conceded_avg: '', wc_games_in_window: '' })
  const [saving, setSaving] = useState(false)

  const inputStyle = {
    width: '100%',
    padding: '10px 12px',
    background: 'var(--color-bg)',
    border: '0.5px solid var(--color-border)',
    borderRadius: 'var(--radius-sm)',
    color: 'var(--color-text-primary)',
    fontFamily: 'var(--font-ui)',
    fontSize: 16,
    outline: 'none',
    boxSizing: 'border-box',
  }

  async function handleSave() {
    setSaving(true)
    const statsObj = {}
    if (form.xgf_per_game !== '') statsObj.xgf_per_game = parseFloat(form.xgf_per_game)
    if (form.xga_per_game !== '') statsObj.xga_per_game = parseFloat(form.xga_per_game)
    if (form.goals_scored_avg !== '') statsObj.goals_scored_avg = parseFloat(form.goals_scored_avg)
    if (form.goals_conceded_avg !== '') statsObj.goals_conceded_avg = parseFloat(form.goals_conceded_avg)
    if (form.wc_games_in_window !== '') statsObj.wc_games_in_window = parseInt(form.wc_games_in_window)
    await onSave(teamCode, statsObj)
    setSaving(false)
  }

  const fields = [
    { key: 'xgf_per_game', label: t('analysis.xgf') },
    { key: 'xga_per_game', label: t('analysis.xga') },
    { key: 'goals_scored_avg', label: t('analysis.scored') },
    { key: 'goals_conceded_avg', label: t('analysis.conceded') },
    { key: 'wc_games_in_window', label: 'WC Games in Window' },
  ]

  return (
    <div style={{ marginTop: 12, padding: 12, background: 'var(--color-bg)', borderRadius: 'var(--radius-md)', border: '0.5px solid var(--color-border)' }}>
      <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 10 }}>
        {getFlag(teamName)} {teamName}
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
        {fields.map(f => (
          <div key={f.key}>
            <label style={{ display: 'block', fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 4 }}>
              {f.label}
            </label>
            <input
              type="number"
              step="0.001"
              min="0"
              value={form[f.key]}
              onChange={e => setForm(prev => ({ ...prev, [f.key]: e.target.value }))}
              style={inputStyle}
            />
          </div>
        ))}
      </div>
      <button
        onClick={handleSave}
        disabled={saving}
        style={{
          minHeight: 'var(--touch-target)',
          padding: '0 16px',
          width: '100%',
          background: 'var(--color-accent-dim)',
          border: '0.5px solid var(--color-accent-border)',
          borderRadius: 'var(--radius-sm)',
          color: 'var(--color-accent)',
          fontFamily: 'var(--font-ui)',
          fontSize: 14,
          fontWeight: 500,
          cursor: saving ? 'not-allowed' : 'pointer',
          opacity: saving ? 0.7 : 1,
        }}
      >
        {saving ? t('common.loading') : t('analysis.saveStats')}
      </button>
    </div>
  )
}

function StatsColumn({ match, teamStats, isHome, isAdmin, onRefresh, onSaveManual, refreshing, t }) {
  const [showManual, setShowManual] = useState(false)
  const teamName = isHome ? match.home_team : match.away_team
  const teamCode = isHome ? match.home_team_code : match.away_team_code
  const hasStats = !!teamStats

  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      {/* Team header */}
      <div style={{ marginBottom: 12 }}>
        <p style={{
          fontFamily: 'var(--font-display)',
          fontSize: 16, fontWeight: 600,
          color: 'var(--color-text-primary)',
        }}>
          {getFlag(teamName)} {teamName}
        </p>
        <p style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>
          {isHome ? 'Home' : 'Away'} · {teamCode}
        </p>
      </div>

      {hasStats ? (
        <>
          {/* Stat cards */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 12 }}>
            <StatCard label={t('analysis.xgf')} value={teamStats.xgf_per_game} />
            <StatCard label={t('analysis.xga')} value={teamStats.xga_per_game} />
            <StatCard label={t('analysis.scored')} value={teamStats.goals_scored_avg} />
            <StatCard label={t('analysis.conceded')} value={teamStats.goals_conceded_avg} />
          </div>

          {/* Lambda display */}
          <div style={{
            background: 'var(--color-bg-card)',
            border: '0.5px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            padding: '12px',
            marginBottom: 8,
            textAlign: 'center',
          }}>
            <p style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 4 }}>
              {t('analysis.lambda')} (V1)
            </p>
            <p style={{
              fontFamily: 'var(--font-display)',
              fontSize: 28, fontWeight: 600,
              color: 'var(--color-accent)',
            }}>
              λ = {teamStats.xgf_per_game ?? '—'}
            </p>
          </div>

          {/* WC window */}
          <p style={{ fontSize: 11, color: 'var(--color-text-muted)', textAlign: 'center' }}>
            {teamStats.wc_games_in_window || 0} WC game{teamStats.wc_games_in_window !== 1 ? 's' : ''} in window
          </p>
        </>
      ) : (
        /* No stats state */
        <div style={{
          background: 'var(--color-bg-card)',
          border: '0.5px solid var(--color-border)',
          borderRadius: 'var(--radius-md)',
          padding: 16,
          textAlign: 'center',
          marginBottom: 8,
        }}>
          <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: isAdmin ? 12 : 0 }}>
            {t('analysis.noStats')}
          </p>
          {isAdmin && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button
                onClick={onRefresh}
                disabled={refreshing}
                style={{
                  minHeight: 'var(--touch-target)',
                  padding: '0 12px',
                  background: 'var(--color-accent-dim)',
                  border: '0.5px solid var(--color-accent-border)',
                  borderRadius: 'var(--radius-sm)',
                  color: 'var(--color-accent)',
                  fontFamily: 'var(--font-ui)',
                  fontSize: 13,
                  cursor: refreshing ? 'not-allowed' : 'pointer',
                  opacity: refreshing ? 0.7 : 1,
                }}
              >
                {refreshing ? t('common.loading') : t('analysis.fetchStats')}
              </button>
              <button
                onClick={() => setShowManual(v => !v)}
                style={{
                  minHeight: 'var(--touch-target)',
                  padding: '0 12px',
                  background: 'transparent',
                  border: '0.5px solid var(--color-border)',
                  borderRadius: 'var(--radius-sm)',
                  color: 'var(--color-text-secondary)',
                  fontFamily: 'var(--font-ui)',
                  fontSize: 13,
                  cursor: 'pointer',
                }}
              >
                {t('analysis.inputManual')}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Manual input form */}
      {isAdmin && showManual && (
        <ManualInputForm
          teamCode={teamCode}
          teamName={teamName}
          onSave={onSaveManual}
          t={t}
        />
      )}
    </div>
  )
}

export default function MatchAnalysis() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { t } = useTranslation()
  const [activeTab, setActiveTab] = useState('stats')
  const [match, setMatch] = useState(null)
  const [matchLoading, setMatchLoading] = useState(true)
  const [matchError, setMatchError] = useState(null)
  const [refreshing, setRefreshing] = useState(false)

  const isAdmin = user?.id === ADMIN_UUID

  useEffect(() => {
    async function loadMatch() {
      setMatchLoading(true)
      const { data, error } = await supabase
        .from('matches')
        .select('*')
        .eq('id', id)
        .single()
      setMatchLoading(false)
      if (error) { setMatchError(error.message); return }
      setMatch(data)
    }
    if (id) loadMatch()
  }, [id])

  const {
    stats, loading: statsLoading, error: statsError,
    confidence, refreshStats, saveManualStats, lastUpdated,
  } = useTeamStats(match)

  async function handleRefreshStats() {
    if (!match) return
    setRefreshing(true)
    await refreshStats(match.home_team, match.away_team)
    setRefreshing(false)
  }

  if (matchLoading) {
    return (
      <div style={{ padding: '24px 16px', maxWidth: 720, margin: '0 auto' }}>
        {[1, 2, 3].map(i => (
          <div key={i} className="skeleton" style={{ height: 80, marginBottom: 12 }} />
        ))}
      </div>
    )
  }

  if (matchError || !match) {
    return (
      <div style={{ padding: '24px 16px', maxWidth: 720, margin: '0 auto' }}>
        <button onClick={() => navigate(-1)} style={backBtnStyle}>← Back</button>
        <p style={{ color: 'var(--color-danger)', marginTop: 16 }}>
          {matchError || 'Match not found'}
        </p>
      </div>
    )
  }

  const confCfg = CONFIDENCE_CONFIG[confidence]

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '0 16px' }}>

      {/* ── Header ── */}
      <div style={{
        padding: '20px 0 0',
        marginBottom: 0,
        borderBottom: '0.5px solid var(--color-border)',
      }}>
        <button onClick={() => navigate(-1)} style={backBtnStyle}>
          ← Back
        </button>

        {/* Stage + venue */}
        <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 8, marginBottom: 4 }}>
          {STAGE_LABELS[match.stage] || match.stage}
          {match.group_name ? ` · Group ${match.group_name}` : ''}
          {match.venue ? ` · ${match.venue}` : ''}
          {match.city ? `, ${match.city}` : ''}
        </p>

        {/* Time */}
        <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 16 }}>
          {toBeijingTime(match.match_date, 'full')} 北京
        </p>

        {/* Teams */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 16,
          marginBottom: 12,
          flexWrap: 'wrap',
        }}>
          <div style={{ textAlign: 'center' }}>
            <p style={{ fontSize: 36, lineHeight: 1 }}>{getFlag(match.home_team)}</p>
            <p style={{
              fontFamily: 'var(--font-display)',
              fontSize: 20, fontWeight: 600,
              color: 'var(--color-text-primary)',
              marginTop: 4,
            }}>
              {match.home_team}
            </p>
          </div>

          <p style={{
            fontFamily: 'var(--font-display)',
            fontSize: 16, fontWeight: 400,
            color: 'var(--color-text-muted)',
          }}>
            {match.home_score !== null ? `${match.home_score} – ${match.away_score}` : 'vs'}
          </p>

          <div style={{ textAlign: 'center' }}>
            <p style={{ fontSize: 36, lineHeight: 1 }}>{getFlag(match.away_team)}</p>
            <p style={{
              fontFamily: 'var(--font-display)',
              fontSize: 20, fontWeight: 600,
              color: 'var(--color-text-primary)',
              marginTop: 4,
            }}>
              {match.away_team}
            </p>
          </div>
        </div>

        {/* Confidence badge */}
        <div style={{ textAlign: 'center', paddingBottom: 16 }}>
          <span style={{
            fontSize: 12, fontWeight: 600,
            color: confCfg.color,
            background: 'var(--color-bg-card)',
            border: `0.5px solid ${confCfg.color}`,
            borderRadius: 'var(--radius-full)',
            padding: '4px 12px',
          }}>
            {confCfg.label}
          </span>
          {lastUpdated && (
            <p style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 6 }}>
              Updated {new Date(lastUpdated).toLocaleDateString()}
            </p>
          )}
        </div>

        {/* Tab bar */}
        <div style={{ display: 'flex', gap: 0, marginBottom: -1 }}>
          {TABS.map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                flex: 1,
                minHeight: 40,
                background: 'none',
                border: 'none',
                borderBottom: activeTab === tab
                  ? '2px solid var(--color-accent)'
                  : '2px solid transparent',
                color: activeTab === tab
                  ? 'var(--color-accent)'
                  : 'var(--color-text-muted)',
                fontFamily: 'var(--font-ui)',
                fontSize: 13,
                fontWeight: activeTab === tab ? 600 : 400,
                cursor: 'pointer',
                padding: '8px 4px',
              }}
            >
              {t(`analysis.${tab}`)}
            </button>
          ))}
        </div>
      </div>

      {/* ── Tab Content ── */}
      <div style={{ paddingTop: 20 }}>

        {/* TAB 1: Stats */}
        {activeTab === 'stats' && (
          <div>
            {statsError && (
              <p style={{ color: 'var(--color-danger)', fontSize: 13, marginBottom: 12 }}>
                {statsError}
              </p>
            )}

            {isAdmin && (
              <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  onClick={handleRefreshStats}
                  disabled={refreshing}
                  style={{
                    minHeight: 36,
                    padding: '0 14px',
                    background: 'var(--color-accent-dim)',
                    border: '0.5px solid var(--color-accent-border)',
                    borderRadius: 'var(--radius-sm)',
                    color: 'var(--color-accent)',
                    fontFamily: 'var(--font-ui)',
                    fontSize: 12,
                    cursor: refreshing ? 'not-allowed' : 'pointer',
                    opacity: refreshing ? 0.7 : 1,
                  }}
                >
                  {refreshing ? t('common.loading') : `↻ ${t('analysis.fetchStats')}`}
                </button>
              </div>
            )}

            {statsLoading ? (
              <div style={{ display: 'flex', gap: 12 }}>
                <div className="skeleton" style={{ flex: 1, height: 200 }} />
                <div className="skeleton" style={{ flex: 1, height: 200 }} />
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <StatsColumn
                  match={match}
                  teamStats={stats.home}
                  isHome={true}
                  isAdmin={isAdmin}
                  onRefresh={handleRefreshStats}
                  onSaveManual={saveManualStats}
                  refreshing={refreshing}
                  t={t}
                />
                <StatsColumn
                  match={match}
                  teamStats={stats.away}
                  isHome={false}
                  isAdmin={isAdmin}
                  onRefresh={handleRefreshStats}
                  onSaveManual={saveManualStats}
                  refreshing={refreshing}
                  t={t}
                />
              </div>
            )}
          </div>
        )}

        {/* TAB 2: Matrix placeholder */}
        {activeTab === 'matrix' && (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--color-text-muted)' }}>
            <p style={{ fontSize: 13 }}>Probability matrix — coming in Stage 3</p>
          </div>
        )}

        {/* TAB 3: Value placeholder */}
        {activeTab === 'value' && (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--color-text-muted)' }}>
            <p style={{ fontSize: 13 }}>Value analysis — available after odds entry</p>
          </div>
        )}

        {/* TAB 4: Portfolio placeholder */}
        {activeTab === 'portfolio' && (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--color-text-muted)' }}>
            <p style={{ fontSize: 13 }}>Portfolio builder — coming in Stage 3</p>
          </div>
        )}
      </div>
    </div>
  )
}

const backBtnStyle = {
  background: 'none',
  border: 'none',
  color: 'var(--color-text-secondary)',
  fontFamily: 'var(--font-ui)',
  fontSize: 14,
  cursor: 'pointer',
  padding: '0',
  minHeight: 'var(--touch-target)',
  display: 'flex',
  alignItems: 'center',
}
