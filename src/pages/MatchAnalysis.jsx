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
  low:    { label: '⚠️ Low Confidence',   color: 'var(--color-danger)',  desc: '< 5 games data' },
  medium: { label: '~ Medium Confidence', color: 'var(--color-warning)', desc: '2–4 WC games' },
  high:   { label: '✅ High Confidence',  color: 'var(--color-accent)',  desc: '3 WC games' },
  max:    { label: '🔥 Max Confidence',   color: 'var(--color-accent)',  desc: '4–5 WC games' },
}

const TABS = ['stats', 'matrix', 'value', 'portfolio']

// ── Sub-components ────────────────────────────────────────────────────────

function StatCard({ label, value, highlight }) {
  return (
    <div style={{
      background: 'var(--color-bg-card)',
      border: `0.5px solid ${highlight ? 'var(--color-accent-border)' : 'var(--color-border)'}`,
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
        fontSize: 22, fontWeight: 600,
        color: highlight ? 'var(--color-accent)' : (value == null ? 'var(--color-text-muted)' : 'var(--color-text-primary)'),
      }}>
        {value ?? '—'}
      </p>
    </div>
  )
}

// W/D/L form dots
function FormRow({ formString }) {
  if (!formString) return (
    <p style={{ fontSize: 11, color: 'var(--color-text-muted)', fontStyle: 'italic' }}>No form data</p>
  )
  const chars = formString.slice(0, 5).split('')
  const colour = { W: 'var(--color-success)', D: 'var(--color-warning)', L: 'var(--color-danger)' }
  const label  = { W: 'Win', D: 'Draw', L: 'Loss' }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 10, color: 'var(--color-text-muted)', letterSpacing: '0.05em', fontWeight: 600 }}>
        FORM
      </span>
      {chars.map((c, i) => (
        <span
          key={i}
          title={label[c] || c}
          style={{
            width: 22, height: 22,
            borderRadius: '50%',
            background: colour[c] || 'var(--color-text-muted)',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 10, fontWeight: 700,
            color: '#000',
          }}
        >
          {c}
        </span>
      ))}
      <span style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>(latest → oldest)</span>
    </div>
  )
}

// Home / Away split bar for V2 model
function SplitBar({ label, homeVal, awayVal }) {
  if (homeVal == null && awayVal == null) return null
  const h = homeVal ?? 0
  const a = awayVal ?? 0
  const total = h + a || 1
  const homePct = Math.round((h / total) * 100)

  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontSize: 10, color: 'var(--color-text-muted)', fontWeight: 600 }}>{label}</span>
        <span style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>
          H {h?.toFixed(2)} / A {a?.toFixed(2)}
        </span>
      </div>
      <div style={{
        height: 6,
        background: 'var(--color-bg)',
        borderRadius: 'var(--radius-full)',
        overflow: 'hidden',
        border: '0.5px solid var(--color-border)',
      }}>
        <div style={{
          width: `${homePct}%`,
          height: '100%',
          background: 'var(--color-accent)',
          borderRadius: 'var(--radius-full)',
          transition: 'width 0.4s ease',
        }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 2 }}>
        <span style={{ fontSize: 9, color: 'var(--color-text-muted)' }}>Home {homePct}%</span>
        <span style={{ fontSize: 9, color: 'var(--color-text-muted)' }}>Away {100 - homePct}%</span>
      </div>
    </div>
  )
}

// Lambda display block
function LambdaBlock({ label, value, dimLabel }) {
  return (
    <div style={{
      background: 'var(--color-bg-card)',
      border: '0.5px solid var(--color-accent-border)',
      borderRadius: 'var(--radius-md)',
      padding: '12px',
      textAlign: 'center',
    }}>
      <p style={{ fontSize: 10, color: 'var(--color-text-muted)', letterSpacing: '0.05em', marginBottom: 4 }}>
        {label}
      </p>
      <p style={{
        fontFamily: 'var(--font-display)',
        fontSize: 28, fontWeight: 600,
        color: value != null ? 'var(--color-accent)' : 'var(--color-text-muted)',
      }}>
        λ = {value != null ? value : '—'}
      </p>
      {dimLabel && (
        <p style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 2 }}>{dimLabel}</p>
      )}
    </div>
  )
}

function ManualInputForm({ teamCode, teamName, onSave, t }) {
  const [form, setForm] = useState({
    xgf_per_game: '',
    xga_per_game: '',
    goals_scored_avg: '',
    goals_conceded_avg: '',
    home_goals_avg: '',
    away_goals_avg: '',
    form_string: '',
    wc_games_in_window: '',
  })
  const [saving, setSaving] = useState(false)

  const inputStyle = {
    width: '100%',
    padding: '10px 12px',
    background: 'var(--color-bg)',
    border: '0.5px solid var(--color-border)',
    borderRadius: 'var(--radius-sm)',
    color: 'var(--color-text-primary)',
    fontFamily: 'var(--font-ui)',
    fontSize: 16, // MT11
    outline: 'none',
    boxSizing: 'border-box',
  }

  async function handleSave() {
    setSaving(true)
    const statsObj = {}
    if (form.xgf_per_game !== '')       statsObj.xgf_per_game       = parseFloat(form.xgf_per_game)
    if (form.xga_per_game !== '')       statsObj.xga_per_game       = parseFloat(form.xga_per_game)
    if (form.goals_scored_avg !== '')   statsObj.goals_scored_avg   = parseFloat(form.goals_scored_avg)
    if (form.goals_conceded_avg !== '') statsObj.goals_conceded_avg = parseFloat(form.goals_conceded_avg)
    if (form.home_goals_avg !== '')     statsObj.home_goals_avg     = parseFloat(form.home_goals_avg)
    if (form.away_goals_avg !== '')     statsObj.away_goals_avg     = parseFloat(form.away_goals_avg)
    if (form.form_string !== '')        statsObj.form_string        = form.form_string.toUpperCase().slice(0, 5)
    if (form.wc_games_in_window !== '') statsObj.wc_games_in_window = parseInt(form.wc_games_in_window)
    await onSave(teamCode, statsObj)
    setSaving(false)
  }

  const fields = [
    { key: 'goals_scored_avg',   label: t('analysis.scored') },
    { key: 'goals_conceded_avg', label: t('analysis.conceded') },
    { key: 'xgf_per_game',       label: t('analysis.xgf') },
    { key: 'xga_per_game',       label: t('analysis.xga') },
    { key: 'home_goals_avg',     label: 'Home Goals / Match' },
    { key: 'away_goals_avg',     label: 'Away Goals / Match' },
    { key: 'wc_games_in_window', label: 'WC Games in Window', type: 'number', step: '1', min: '0', max: '5' },
  ]

  return (
    <div style={{
      marginTop: 12, padding: 12,
      background: 'var(--color-bg)',
      borderRadius: 'var(--radius-md)',
      border: '0.5px solid var(--color-border)',
    }}>
      <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 10, fontWeight: 600 }}>
        {getFlag(teamName)} {teamName} — Manual Input
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
        {fields.map(f => (
          <div key={f.key}>
            <label style={{ display: 'block', fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 4 }}>
              {f.label}
            </label>
            <input
              type={f.type || 'number'}
              step={f.step || '0.001'}
              min={f.min || '0'}
              max={f.max}
              value={form[f.key]}
              onChange={e => setForm(prev => ({ ...prev, [f.key]: e.target.value }))}
              style={inputStyle}
            />
          </div>
        ))}
      </div>

      {/* Form string input */}
      <div style={{ marginBottom: 12 }}>
        <label style={{ display: 'block', fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 4 }}>
          Form String (e.g. WWDLL — latest first)
        </label>
        <input
          type="text"
          maxLength={5}
          placeholder="WWDLL"
          value={form.form_string}
          onChange={e => setForm(prev => ({ ...prev, form_string: e.target.value }))}
          style={{ ...inputStyle, textTransform: 'uppercase', fontFamily: 'var(--font-display)', letterSpacing: '0.2em' }}
        />
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
          fontSize: 14, fontWeight: 500,
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
          {/* Core stat cards */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 10 }}>
            <StatCard label={t('analysis.scored')}   value={teamStats.goals_scored_avg}   />
            <StatCard label={t('analysis.conceded')} value={teamStats.goals_conceded_avg} />
            <StatCard label={t('analysis.xgf')}      value={teamStats.xgf_per_game}       />
            <StatCard label={t('analysis.xga')}      value={teamStats.xga_per_game}       />
          </div>

          {/* Lambda V1 */}
          <LambdaBlock
            label={`${t('analysis.lambda')} (V1)`}
            value={teamStats.xgf_per_game ?? teamStats.goals_scored_avg}
            dimLabel={`${teamStats.games_window || 0} games · ${teamStats.data_source || 'footystats'}`}
          />

          {/* Home / Away split — feeds V2 model */}
          {(teamStats.home_goals_avg != null || teamStats.away_goals_avg != null) && (
            <div style={{ marginTop: 10 }}>
              <p style={{ fontSize: 10, color: 'var(--color-text-muted)', fontWeight: 600, letterSpacing: '0.05em', marginBottom: 8 }}>
                HOME / AWAY SPLIT (V2)
              </p>
              <SplitBar
                label="Goals Scored"
                homeVal={teamStats.home_goals_avg}
                awayVal={teamStats.away_goals_avg}
              />
            </div>
          )}

          {/* Form dots */}
          <div style={{ marginTop: 10 }}>
            <FormRow formString={teamStats.form_string} />
          </div>

          {/* WC window */}
          <p style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 8 }}>
            {teamStats.wc_games_in_window || 0} WC game{teamStats.wc_games_in_window !== 1 ? 's' : ''} in window
            {(teamStats.games_window || 0) < 5 && (
              <span style={{ color: 'var(--color-warning)', marginLeft: 6 }}>
                ⚠ {teamStats.games_window}/5 games
              </span>
            )}
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

      {/* Manual input toggle for admin */}
      {isAdmin && hasStats && (
        <button
          onClick={() => setShowManual(v => !v)}
          style={{
            marginTop: 8,
            minHeight: 32,
            padding: '0 10px',
            background: 'transparent',
            border: '0.5px solid var(--color-border)',
            borderRadius: 'var(--radius-sm)',
            color: 'var(--color-text-muted)',
            fontFamily: 'var(--font-ui)',
            fontSize: 11,
            cursor: 'pointer',
            width: '100%',
          }}
        >
          {showManual ? 'Hide manual input' : '✎ Override stats'}
        </button>
      )}

      {isAdmin && showManual && (
        <ManualInputForm
          teamCode={teamCode}
          teamName={teamName}
          matchId={match.id}
          onSave={onSaveManual}
          t={t}
        />
      )}
    </div>
  )
}

// ── Placeholder tabs ──────────────────────────────────────────────────────

// Static preview intensities for matrix placeholder (avoids impure Math.random in render)
const MATRIX_PREVIEW = [
  0.14,0.09,0.03,0.01,0.00,0.00,
  0.11,0.12,0.05,0.02,0.00,0.00,
  0.05,0.07,0.08,0.03,0.01,0.00,
  0.02,0.03,0.04,0.04,0.01,0.00,
  0.00,0.01,0.01,0.02,0.01,0.00,
  0.00,0.00,0.00,0.00,0.00,0.00,
]

function TabMatrix() {
  return (
    <div style={{
      background: 'var(--color-bg-card)',
      border: '0.5px solid var(--color-border)',
      borderRadius: 'var(--radius-md)',
      padding: 24,
      textAlign: 'center',
    }}>
      <p style={{ fontFamily: 'var(--font-display)', fontSize: 18, color: 'var(--color-text-muted)', marginBottom: 8 }}>
        Score Matrix
      </p>
      <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 16 }}>
        Poisson V1 + V2 probability heatmap — Stage 3
      </p>
      <div style={{ marginBottom: 8, display: 'flex', justifyContent: 'space-between', maxWidth: 300, margin: '0 auto 6px' }}>
        <span style={{ fontSize: 9, color: 'var(--color-text-muted)' }}>← Away goals 0–5</span>
        <span style={{ fontSize: 9, color: 'var(--color-text-muted)' }}>Home 0–5 ↓</span>
      </div>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(6, 1fr)',
        gap: 4,
        maxWidth: 300,
        margin: '0 auto',
      }}>
        {MATRIX_PREVIEW.map((v, i) => (
          <div key={i} style={{
            height: 36,
            borderRadius: 4,
            background: `rgba(0,229,160,${v * 4})`,
            border: '0.5px solid var(--color-border)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 9, color: 'var(--color-text-muted)',
          }}>
            {v.toFixed(2)}
          </div>
        ))}
      </div>
      <p style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 12 }}>
        Preview only — real matrix requires team stats (5-game window · MT06)
      </p>
    </div>
  )
}

function TabValue() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {['Home Win', 'Draw', 'Away Win'].map(outcome => (
        <div key={outcome} style={{
          background: 'var(--color-bg-card)',
          border: '0.5px solid var(--color-border)',
          borderRadius: 'var(--radius-md)',
          padding: '14px 16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <span style={{ fontFamily: 'var(--font-ui)', fontSize: 14, color: 'var(--color-text-primary)' }}>
            {outcome}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
              Odds — · Edge —
            </span>
            <span style={{
              fontSize: 11, fontWeight: 700,
              padding: '3px 8px',
              borderRadius: 'var(--radius-full)',
              background: 'var(--color-bg-elevated)',
              color: 'var(--color-text-muted)',
            }}>
              No odds
            </span>
          </div>
        </div>
      ))}
      <p style={{ fontSize: 12, color: 'var(--color-text-muted)', textAlign: 'center', marginTop: 8 }}>
        Enter odds via the Odds tab to see EV analysis (MT22 — vig stripped before edge calculation)
      </p>
    </div>
  )
}

function TabPortfolio() {
  return (
    <div style={{
      background: 'var(--color-bg-card)',
      border: '0.5px solid var(--color-border)',
      borderRadius: 'var(--radius-md)',
      padding: 24,
      textAlign: 'center',
    }}>
      <p style={{ fontFamily: 'var(--font-display)', fontSize: 18, color: 'var(--color-text-muted)', marginBottom: 8 }}>
        Portfolio Builder
      </p>
      <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 16 }}>
        Fractional Kelly sizing · bankroll exposure · correlated-bet guard — Stage 5
      </p>
      <div style={{
        background: 'var(--color-bg)',
        borderRadius: 'var(--radius-sm)',
        padding: '12px 16px',
        fontSize: 12,
        color: 'var(--color-text-muted)',
        textAlign: 'left',
        border: '0.5px solid var(--color-border)',
      }}>
        <p>f* = (b×p − q) / b  <span style={{ color: 'var(--color-text-muted)', fontSize: 11 }}>(Full Kelly)</span></p>
        <p>stake = f* × 0.25 × bankroll  <span style={{ color: 'var(--color-text-muted)', fontSize: 11 }}>(Fractional ×0.25)</span></p>
        <p>hard cap = 5% bankroll  <span style={{ color: 'var(--color-accent)', fontSize: 11 }}>(MT24)</span></p>
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────

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
  const hasAnyStats = stats.home || stats.away

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '0 16px' }}>

      {/* ── Header ── */}
      <div style={{
        padding: '20px 0 0',
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

        {/* Time (MT14 — Beijing always) */}
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
          <div style={{ textAlign: 'center', flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: 36, lineHeight: 1 }}>{getFlag(match.home_team)}</p>
            <p style={{
              fontFamily: 'var(--font-display)',
              fontSize: 18, fontWeight: 600,
              color: 'var(--color-text-primary)',
              marginTop: 4,
            }}>
              {match.home_team}
            </p>
            <p style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>Home</p>
          </div>

          <div style={{ textAlign: 'center', flexShrink: 0 }}>
            <p style={{
              fontFamily: 'var(--font-display)',
              fontSize: 18, fontWeight: 400,
              color: 'var(--color-text-muted)',
            }}>
              {match.home_score !== null ? `${match.home_score} – ${match.away_score}` : 'vs'}
            </p>
          </div>

          <div style={{ textAlign: 'center', flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: 36, lineHeight: 1 }}>{getFlag(match.away_team)}</p>
            <p style={{
              fontFamily: 'var(--font-display)',
              fontSize: 18, fontWeight: 600,
              color: 'var(--color-text-primary)',
              marginTop: 4,
            }}>
              {match.away_team}
            </p>
            <p style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>Away</p>
          </div>
        </div>

        {/* Confidence badge + last updated */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, paddingBottom: 16, flexWrap: 'wrap' }}>
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
          <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
            {confCfg.desc}
          </span>
          {lastUpdated && (
            <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
              · Updated {new Date(lastUpdated).toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' })}
            </span>
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
                fontSize: 13, fontWeight: activeTab === tab ? 600 : 400,
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
              <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
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
                <div className="skeleton" style={{ flex: 1, height: 280 }} />
                <div className="skeleton" style={{ flex: 1, height: 280 }} />
              </div>
            ) : (
              <>
                {/* V1 vs V2 explanation banner when both stats exist */}
                {hasAnyStats && (
                  <div style={{
                    background: 'var(--color-bg-card)',
                    border: '0.5px solid var(--color-border)',
                    borderRadius: 'var(--radius-md)',
                    padding: '10px 14px',
                    marginBottom: 16,
                    display: 'flex',
                    gap: 16,
                    flexWrap: 'wrap',
                  }}>
                    <div style={{ flex: 1, minWidth: 120 }}>
                      <p style={{ fontSize: 10, color: 'var(--color-accent)', fontWeight: 700, letterSpacing: '0.06em', marginBottom: 2 }}>V1 MODEL</p>
                      <p style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>Overall stats — home + away combined</p>
                    </div>
                    <div style={{ flex: 1, minWidth: 120 }}>
                      <p style={{ fontSize: 10, color: 'var(--color-info)', fontWeight: 700, letterSpacing: '0.06em', marginBottom: 2 }}>V2 MODEL</p>
                      <p style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>Away-factor correction applied</p>
                    </div>
                  </div>
                )}

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

                {/* Data source note */}
                {hasAnyStats && (
                  <p style={{ fontSize: 11, color: 'var(--color-text-muted)', textAlign: 'center', marginTop: 16 }}>
                    Source: footystats.org · {stats.home?.games_window || 0}-game window (MT06 requires 5)
                  </p>
                )}
              </>
            )}
          </div>
        )}

        {/* TAB 2: Matrix */}
        {activeTab === 'matrix' && <TabMatrix />}

        {/* TAB 3: Value */}
        {activeTab === 'value' && <TabValue />}

        {/* TAB 4: Portfolio */}
        {activeTab === 'portfolio' && <TabPortfolio />}

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
