import { useState, useEffect, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useTeamStats } from '../hooks/useTeamStats'
import { useTranslation } from '../lib/i18n'
import { getFlag } from '../lib/teamFlags'
import { toBeijingTime } from '../lib/dateUtils'
import { supabase } from '../lib/supabase'
import { runModels, capProb, SCORE_MAX, monteCarlo } from '../lib/poisson'
import { formatProb, analyse1X2, calcStake } from '../lib/evEngine'

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

const TABS = ['stats', 'matrix', 'value', 'portfolio', 'ai']

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
      <p style={{ fontSize: 14, color: 'var(--color-text-secondary)', fontWeight: 700, letterSpacing: '0.05em', marginBottom: 4 }}>
        {label}
      </p>
      <p style={{
        fontFamily: 'var(--font-display)',
        fontSize: 23, fontWeight: 600,
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
    <p style={{ fontSize: 15, color: 'var(--color-text-muted)', fontStyle: 'italic' }}>No form data</p>
  )
  const chars = formString.slice(0, 5).split('')
  const colour = { W: 'var(--color-success)', D: 'var(--color-warning)', L: 'var(--color-danger)' }
  const label  = { W: 'Win', D: 'Draw', L: 'Loss' }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 14, color: 'var(--color-text-muted)', letterSpacing: '0.05em', fontWeight: 600 }}>
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
            fontSize: 14, fontWeight: 700,
            color: '#000',
          }}
        >
          {c}
        </span>
      ))}
      <span style={{ fontSize: 15, color: 'var(--color-text-secondary)' }}>(latest → oldest)</span>
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
        <span style={{ fontSize: 14, color: 'var(--color-text-muted)', fontWeight: 600 }}>{label}</span>
        <span style={{ fontSize: 15, color: 'var(--color-text-secondary)' }}>
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
        <span style={{ fontSize: 15, color: 'var(--color-text-secondary)' }}>Home {homePct}%</span>
        <span style={{ fontSize: 15, color: 'var(--color-text-secondary)' }}>Away {100 - homePct}%</span>
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
      <p style={{ fontSize: 14, color: 'var(--color-text-muted)', letterSpacing: '0.05em', marginBottom: 4 }}>
        {label}
      </p>
      <p style={{
        fontFamily: 'var(--font-display)',
        fontSize: 36, fontWeight: 600,
        color: value != null ? 'var(--color-accent)' : 'var(--color-text-muted)',
      }}>
        λ = {value != null ? value : '—'}
      </p>
      {dimLabel && (
        <p style={{ fontSize: 14, color: 'var(--color-text-muted)', marginTop: 2 }}>{dimLabel}</p>
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
      <p style={{ fontSize: 14, color: 'var(--color-text-secondary)', marginBottom: 10, fontWeight: 600 }}>
        {getFlag(teamName)} {teamName} — Manual Input
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
        {fields.map(f => (
          <div key={f.key}>
            <label style={{ display: 'block', fontSize: 15, color: 'var(--color-text-muted)', marginBottom: 4 }}>
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
        <label style={{ display: 'block', fontSize: 15, color: 'var(--color-text-muted)', marginBottom: 4 }}>
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
          fontSize: 16, fontWeight: 500,
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
        <p style={{ fontSize: 15, color: 'var(--color-text-muted)', marginTop: 2 }}>
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
              <p style={{ fontSize: 14, color: 'var(--color-text-secondary)', fontWeight: 700, letterSpacing: '0.05em', marginBottom: 8 }}>
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
          <p style={{ fontSize: 15, color: 'var(--color-text-muted)', marginTop: 8 }}>
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
          <p style={{ fontSize: 15, color: 'var(--color-text-muted)', marginBottom: isAdmin ? 12 : 0 }}>
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
                  fontSize: 15,
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
                  fontSize: 15,
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
            fontSize: 15,
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

// ── Score matrix (live Poisson) ──────────────────────────────────────────

const EDGE_COLOURS = {
  green: 'var(--color-edge-green)',
  amber: 'var(--color-edge-amber)',
  red:   'var(--color-edge-red)',
}

// Single score-matrix cell — colour intensity based on probability
function MatrixCell({ value, isMax }) {
  const intensity = Math.min(value * 12, 0.9)
  // High intensity cells need dark text, low intensity cells need light text
  const textColor = intensity > 0.5
    ? '#000000'
    : intensity > 0.25
      ? '#1a2a1a'
      : 'var(--color-text-secondary)'
  return (
    <div style={{
      height: 44,
      borderRadius: 4,
      background: isMax
        ? `rgba(0,229,160,${intensity + 0.15})`
        : `rgba(0,229,160,${intensity})`,
      border: isMax
        ? '2px solid var(--color-accent)'
        : '0.5px solid rgba(255,255,255,0.08)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 13, 
      color: isMax ? '#000' : textColor,
      fontWeight: isMax ? 800 : intensity > 0.3 ? 600 : 400,
      transition: 'background 0.2s',
    }}>
      {(value * 100).toFixed(1)}
    </div>
  )
}

// Full score matrix grid with axis labels
function ScoreMatrix({ matrix, homeTeam, awayTeam, label, colour }) {
  const size = SCORE_MAX + 1
  const flat = matrix.flat()
  const maxVal = Math.max(...flat)

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{
          fontSize: 14, fontWeight: 700, letterSpacing: '0.06em',
          color: colour, padding: '2px 8px',
          background: 'var(--color-bg)',
          border: `0.5px solid ${colour}`,
          borderRadius: 'var(--radius-full)',
        }}>
          {label}
        </span>
        <span style={{ fontSize: 15, color: 'var(--color-text-secondary)' }}>
          rows = {homeTeam} goals · cols = {awayTeam} goals
        </span>
      </div>

      {/* Column headers (away goals) */}
      <div style={{ display: 'grid', gridTemplateColumns: `28px repeat(${size}, 1fr)`, gap: 3, marginBottom: 3 }}>
        <div />
        {Array.from({ length: size }, (_, j) => (
          <div key={j} style={{ textAlign: 'center', fontSize: 14, color: 'var(--color-text-primary)', fontWeight: 700 }}>
            {j}
          </div>
        ))}
      </div>

      {/* Rows */}
      {matrix.map((row, i) => (
        <div key={i} style={{ display: 'grid', gridTemplateColumns: `28px repeat(${size}, 1fr)`, gap: 3, marginBottom: 3 }}>
          {/* Row header (home goals) */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, color: 'var(--color-text-muted)', fontWeight: 600 }}>
            {i}
          </div>
          {row.map((v, j) => (
            <MatrixCell key={j} value={v} isMax={v === maxVal} />
          ))}
        </div>
      ))}
    </div>
  )
}

// Result probability bar row
function ProbBar({ label, v1, v2, colour }) {
  const pct1 = capProb(v1) * 100
  const pct2 = v2 != null ? capProb(v2) * 100 : null
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
        <span style={{ fontSize: 14, color: 'var(--color-text-primary)', fontWeight: 600 }}>{label}</span>
        <div style={{ display: 'flex', gap: 12 }}>
          <span style={{ fontSize: 14, color: 'var(--color-accent)', fontWeight: 700 }}>V1 {pct1.toFixed(1)}%</span>
          {pct2 != null && (
            <span style={{ fontSize: 14, color: 'var(--color-info)', fontWeight: 700 }}>V2 {pct2.toFixed(1)}%</span>
          )}
        </div>
      </div>
      {/* V1 bar */}
      <div style={{ height: 8, background: 'var(--color-bg)', borderRadius: 'var(--radius-full)', overflow: 'hidden', border: '0.5px solid var(--color-border)', marginBottom: 3 }}>
        <div style={{ width: `${pct1}%`, height: '100%', background: colour || 'var(--color-accent)', borderRadius: 'var(--radius-full)', transition: 'width 0.4s ease' }} />
      </div>
      {/* V2 bar */}
      {pct2 != null && (
        <div style={{ height: 5, background: 'var(--color-bg)', borderRadius: 'var(--radius-full)', overflow: 'hidden', border: '0.5px solid var(--color-border)' }}>
          <div style={{ width: `${pct2}%`, height: '100%', background: 'var(--color-info)', borderRadius: 'var(--radius-full)', opacity: 0.7, transition: 'width 0.4s ease' }} />
        </div>
      )}
    </div>
  )
}

// Total goals lines table
function TotalGoalsTable({ goalsV1, goalsV2 }) {
  return (
    <div style={{
      background: 'var(--color-bg-card)',
      border: '0.5px solid var(--color-border)',
      borderRadius: 'var(--radius-md)',
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        display: 'grid', gridTemplateColumns: '60px 1fr 1fr 1fr 1fr',
        padding: '8px 12px',
        background: 'var(--color-bg-elevated)',
        borderBottom: '0.5px solid var(--color-border)',
      }}>
        {['Line', 'V1 Over', 'V1 Under', 'V2 Over', 'V2 Under'].map(h => (
          <span key={h} style={{ fontSize: 14, color: 'var(--color-text-secondary)', fontWeight: 700, letterSpacing: '0.05em', textAlign: 'center' }}>{h}</span>
        ))}
      </div>
      {/* Rows */}
      {goalsV1.map((row, i) => {
        const v2row = goalsV2?.[i]
        return (
          <div key={row.line} style={{
            display: 'grid', gridTemplateColumns: '60px 1fr 1fr 1fr 1fr',
            padding: '10px 12px',
            borderBottom: '0.5px solid var(--color-border)',
            background: row.anchor ? 'var(--color-accent-dim)' : 'transparent',
            alignItems: 'center',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ fontFamily: 'var(--font-display)', fontSize: 17, fontWeight: 600, color: row.anchor ? 'var(--color-accent)' : 'var(--color-text-primary)' }}>
                {row.line}
              </span>
              {row.anchor && (
                <span style={{ fontSize: 14, color: 'var(--color-accent)', fontWeight: 700, letterSpacing: '0.06em' }}>ANCHOR</span>
              )}
            </div>
            <span style={{ fontSize: 15, color: 'var(--color-accent)', fontWeight: 700, textAlign: 'center' }}>{formatProb(row.over)}</span>
            <span style={{ fontSize: 15, color: 'var(--color-text-secondary)', textAlign: 'center' }}>{formatProb(row.under)}</span>
            <span style={{ fontSize: 15, color: 'var(--color-info)', fontWeight: 700, textAlign: 'center' }}>{v2row ? formatProb(v2row.over) : '—'}</span>
            <span style={{ fontSize: 15, color: 'var(--color-text-secondary)', textAlign: 'center' }}>{v2row ? formatProb(v2row.under) : '—'}</span>
          </div>
        )
      })}
    </div>
  )
}

// Dixon-Coles toggle — MT21 labelled, default OFF
function DixonColesToggle({ enabled, onChange }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <button
        onClick={() => onChange(!enabled)}
        style={{
          minHeight: 28, padding: '0 10px',
          background: enabled ? 'var(--color-info-dim)' : 'transparent',
          border: `0.5px solid ${enabled ? 'var(--color-info)' : 'var(--color-border)'}`,
          borderRadius: 'var(--radius-sm)',
          color: enabled ? 'var(--color-info)' : 'var(--color-text-secondary)',
          fontFamily: 'var(--font-ui)',
          fontSize: 15, fontWeight: enabled ? 700 : 400,
          cursor: 'pointer',
        }}
      >
        {enabled ? '✓ Dixon-Coles ON' : 'Dixon-Coles correction'}
      </button>
      <span style={{ fontSize: 15, color: 'var(--color-text-secondary)' }}>
        (corrects low-score bias · default OFF · MT21)
      </span>
    </div>
  )
}

// Monte Carlo panel — simulate scorelines, cross-check analytic Poisson
function MonteCarloPanel({ v1, match }) {
  const [sim, setSim] = useState(null)
  const [running, setRunning] = useState(false)

  // Quick 10k run on mount (~50ms) — always available
  useEffect(() => {
    setSim(monteCarlo(v1.lambdaHome, v1.lambdaAway, 10000))
  }, [v1.lambdaHome, v1.lambdaAway])

  const run = (n) => {
    setRunning(true)
    // defer so the button paints disabled before the loop blocks
    setTimeout(() => {
      setSim(monteCarlo(v1.lambdaHome, v1.lambdaAway, n))
      setRunning(false)
    }, 20)
  }

  const rows = sim ? [
    { label: `${match.home_team} Win`, sim: sim.home, model: v1.probs.home },
    { label: 'Draw',                   sim: sim.draw, model: v1.probs.draw },
    { label: `${match.away_team} Win`, sim: sim.away, model: v1.probs.away },
  ] : []

  return (
    <div style={{ background: 'var(--color-bg-card)', border: '0.5px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <p style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-text-muted)', letterSpacing: '0.06em' }}>
          MONTE CARLO{sim ? ` · ${(sim.n / 1000)}K SIMS` : ''}
        </p>
        <button onClick={() => run(100000)} disabled={running} style={{
          minHeight: 44, padding: '0 16px', fontSize: 15, fontWeight: 700,
          borderRadius: 'var(--radius-sm)', cursor: running ? 'default' : 'pointer',
          background: 'var(--color-accent-dim)', color: 'var(--color-accent)',
          border: '0.5px solid var(--color-accent-border)', opacity: running ? 0.7 : 1,
        }}>{running ? 'Simulating…' : 'Deep run · 100K'}</button>
      </div>
      {sim ? (
        <>
          {rows.map(r => (
            <div key={r.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '0.5px solid var(--color-border)' }}>
              <span style={{ fontSize: 15, color: 'var(--color-text-primary)' }}>{r.label}</span>
              <span style={{ fontSize: 14, color: 'var(--color-text-secondary)' }}>
                sim {(r.sim * 100).toFixed(1)}% <span style={{ color: 'var(--color-text-muted)' }}>· model {(r.model * 100).toFixed(1)}%</span>
              </span>
            </div>
          ))}
          <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginTop: 10 }}>
            Most likely: {sim.topScores.map(s => `${s.score} (${(s.prob * 100).toFixed(1)}%)`).join(' · ')}
          </p>
        </>
      ) : (
        <p style={{ fontSize: 14, color: 'var(--color-text-muted)' }}>Cross-check the analytic V1 matrix against 50k random simulations.</p>
      )}
    </div>
  )
}

// Full Matrix tab — live Poisson
function TabMatrix({ stats, match, dixonColes, onToggleDixon }) {
  const [modelError, setModelError] = useState(null)
  const model = useMemo(() => {
    if (!stats?.home || !stats?.away) return null
    try {
      setModelError(null)
      return runModels(stats.home, stats.away, { dixonColes })
    } catch (err) {
      setModelError(err.message)
      return null
    }
  }, [stats, dixonColes])

  const noStats = !stats?.home || !stats?.away

  if (noStats) {
    return (
      <div style={{
        background: 'var(--color-bg-card)',
        border: '0.5px solid var(--color-border)',
        borderRadius: 'var(--radius-md)',
        padding: 24, textAlign: 'center',
      }}>
        <p style={{ fontSize: 15, color: 'var(--color-text-muted)' }}>
          Both teams need stats before the matrix can be calculated.
        </p>
      </div>
    )
  }

  if (!model) {
    return (
      <div style={{
        background: 'var(--color-danger-dim)',
        border: '0.5px solid var(--color-danger)',
        borderRadius: 'var(--radius-md)',
        padding: 16,
      }}>
        <p style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-danger)', marginBottom: 6 }}>
          Model error
        </p>
        <p style={{ fontSize: 15, color: 'var(--color-text-secondary)' }}>
          {modelError || 'Check that both teams have goals_scored_avg and goals_conceded_avg.'}
        </p>
      </div>
    )
  }

  const { v1, v2, divergence } = model

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* Dixon-Coles toggle — MT21 */}
      <DixonColesToggle enabled={dixonColes} onChange={onToggleDixon} />

      {/* Lambda row */}
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr auto 1fr',
        gap: 12, alignItems: 'center',
        background: 'var(--color-bg-card)',
        border: '0.5px solid var(--color-accent-border)',
        borderRadius: 'var(--radius-md)',
        padding: '12px 16px',
      }}>
        <div style={{ textAlign: 'center' }}>
          <p style={{ fontSize: 14, color: 'var(--color-text-muted)', letterSpacing: '0.05em', marginBottom: 2 }}>λ HOME</p>
          <p style={{ fontFamily: 'var(--font-display)', fontSize: 36, fontWeight: 600, color: 'var(--color-accent)' }}>
            {v1.lambdaHome.toFixed(3)}
          </p>
          <p style={{ fontSize: 14, color: 'var(--color-info)' }}>V2: {v2.lambdaHome.toFixed(3)}</p>
        </div>
        <span style={{ fontFamily: 'var(--font-display)', fontSize: 21, color: 'var(--color-text-muted)' }}>vs</span>
        <div style={{ textAlign: 'center' }}>
          <p style={{ fontSize: 14, color: 'var(--color-text-muted)', letterSpacing: '0.05em', marginBottom: 2 }}>λ AWAY</p>
          <p style={{ fontFamily: 'var(--font-display)', fontSize: 36, fontWeight: 600, color: 'var(--color-accent)' }}>
            {v1.lambdaAway.toFixed(3)}
          </p>
          <p style={{ fontSize: 14, color: 'var(--color-info)' }}>V2: {v2.lambdaAway.toFixed(3)} <span style={{ color: 'var(--color-text-muted)' }}>({v2.awayFactorNote})</span></p>
        </div>
      </div>

      {/* Divergence warning — MT07 */}
      {divergence.flagged && (
        <div style={{
          background: 'var(--color-warning-dim)',
          border: '0.5px solid var(--color-warning)',
          borderRadius: 'var(--radius-md)',
          padding: '10px 14px',
        }}>
          <p style={{ fontSize: 14, color: 'var(--color-warning)', fontWeight: 700 }}>
            ⚠ V1/V2 divergence: {divergence.note}
          </p>
          <p style={{ fontSize: 15, color: 'var(--color-text-muted)', marginTop: 2 }}>
            Use V2 as primary when away-factor correction is significant (MT07)
          </p>
        </div>
      )}

      {/* Result probability bars */}
      <div style={{
        background: 'var(--color-bg-card)',
        border: '0.5px solid var(--color-border)',
        borderRadius: 'var(--radius-md)',
        padding: '16px',
      }}>
        <p style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-text-muted)', letterSpacing: '0.06em', marginBottom: 14 }}>
          RESULT PROBABILITIES (MT08: capped 5–95%)
        </p>
        <ProbBar label={`${match.home_team} Win`} v1={v1.probs.home} v2={v2.probs.home} colour="var(--color-accent)" />
        <ProbBar label="Draw"                     v1={v1.probs.draw} v2={v2.probs.draw} colour="var(--color-warning)" />
        <ProbBar label={`${match.away_team} Win`} v1={v1.probs.away} v2={v2.probs.away} colour="var(--color-info)" />
        {(!v1.probsVerified.valid) && (
          <p style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-danger)', marginTop: 8 }}>
            ⚠ V1 sum = {(v1.probsVerified.sum * 100).toFixed(2)}% (should be 100%)
          </p>
        )}
      </div>

      {/* Monte Carlo cross-check */}
      <MonteCarloPanel v1={v1} match={match} />

      {/* Score matrices — V1 */}
      <ScoreMatrix
        matrix={v1.matrix}
        homeTeam={match.home_team_code}
        awayTeam={match.away_team_code}
        label="V1 MATRIX"
        colour="var(--color-accent)"
      />

      {/* Score matrices — V2 */}
      <ScoreMatrix
        matrix={v2.matrix}
        homeTeam={match.home_team_code}
        awayTeam={match.away_team_code}
        label="V2 MATRIX"
        colour="var(--color-info)"
      />

      {/* Total Goals anchor table */}
      <div>
        <p style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-text-muted)', letterSpacing: '0.06em', marginBottom: 10 }}>
          TOTAL GOALS — V1 + V2 (anchor = closest to 50/50)
        </p>
        <TotalGoalsTable goalsV1={v1.totalGoals} goalsV2={v2.totalGoals} />
      </div>

    </div>
  )
}

// Value tab — model probabilities + bookmaker odds entry → EV/edge per outcome
function TabValue({ stats, match }) {
  const model = useMemo(() => {
    if (!stats?.home || !stats?.away) return null
    try { return runModels(stats.home, stats.away) } catch { return null }
  }, [stats])

  // Decimal odds entry (MT09). Empty until analyst inputs bookmaker prices.
  const [odds, setOdds] = useState({ home: '', draw: '', away: '' })
  const ev1x2 = useMemo(() => {
    if (!model) return null
    const o = { home: parseFloat(odds.home), draw: parseFloat(odds.draw), away: parseFloat(odds.away) }
    if (![o.home, o.draw, o.away].every(v => v > 1)) return null
    try { return analyse1X2(model.v2.probs, o) } catch { return null }
  }, [model, odds])

  const OUTCOME_LABELS = {
    home: `${match?.home_team || 'Home'} Win`,
    draw: 'Draw',
    away: `${match?.away_team || 'Away'} Win`,
  }
  const OUTCOME_COLOURS = {
    home: 'var(--color-accent)',
    draw: 'var(--color-warning)',
    away: 'var(--color-info)',
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

      {/* Model probabilities (no odds yet) */}
      {model ? (
        <>
          <div style={{
            background: 'var(--color-bg-card)',
            border: '0.5px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            padding: '14px 16px',
          }}>
            <p style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-text-muted)', letterSpacing: '0.06em', marginBottom: 12 }}>
              MODEL PROBABILITIES (V1 · V2)
            </p>
            {['home', 'draw', 'away'].map(key => (
              <div key={key} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                marginBottom: 10,
              }}>
                <span style={{ fontSize: 15, color: 'var(--color-text-primary)' }}>
                  {OUTCOME_LABELS[key]}
                </span>
                <div style={{ display: 'flex', gap: 10 }}>
                  <span style={{ fontSize: 16, fontWeight: 700, color: OUTCOME_COLOURS[key], fontFamily: 'var(--font-display)' }}>
                    {formatProb(model.v1.probs[key])}
                  </span>
                  <span style={{ fontSize: 14, color: 'var(--color-info)' }}>
                    {formatProb(model.v2.probs[key])}
                  </span>
                </div>
              </div>
            ))}
          </div>

          {/* Anchor total goals line */}
          {(() => {
            const anchor = model.v1.totalGoals.find(l => l.anchor)
            if (!anchor) return null
            return (
              <div style={{
                background: 'var(--color-accent-dim)',
                border: '0.5px solid var(--color-accent-border)',
                borderRadius: 'var(--radius-md)',
                padding: '12px 16px',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              }}>
                <div>
                  <p style={{ fontSize: 14, color: 'var(--color-accent)', fontWeight: 700, letterSpacing: '0.06em' }}>ANCHOR LINE</p>
                  <p style={{ fontFamily: 'var(--font-display)', fontSize: 23, fontWeight: 600, color: 'var(--color-text-primary)' }}>
                    {anchor.line} Goals
                  </p>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <p style={{ fontSize: 14, color: 'var(--color-accent)' }}>Over {formatProb(anchor.over)}</p>
                  <p style={{ fontSize: 14, color: 'var(--color-text-secondary)' }}>Under {formatProb(anchor.under)}</p>
                </div>
              </div>
            )
          })()}
        </>
      ) : (
        <div style={{
          background: 'var(--color-bg-card)',
          border: '0.5px solid var(--color-border)',
          borderRadius: 'var(--radius-md)',
          padding: 16, textAlign: 'center',
          color: 'var(--color-text-muted)', fontSize: 15,
        }}>
          Stats required to calculate model probabilities (MT06)
        </div>
      )}

      {/* Odds entry — decimal (MT09) */}
      <div style={{
        background: 'var(--color-bg-card)',
        border: '0.5px solid var(--color-border)',
        borderRadius: 'var(--radius-md)',
        padding: '14px 16px',
      }}>
        <p style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-text-muted)', letterSpacing: '0.06em', marginBottom: 10 }}>
          BOOKMAKER ODDS (DECIMAL) · 1X2
        </p>
        <div style={{ display: 'flex', gap: 8 }}>
          {['home', 'draw', 'away'].map(key => (
            <div key={key} style={{ flex: 1 }}>
              <label style={{ fontSize: 13, color: 'var(--color-text-muted)', display: 'block', marginBottom: 4 }}>
                {OUTCOME_LABELS[key]}
              </label>
              <input
                type="number" inputMode="decimal" step="0.01" min="1" placeholder="2.10"
                value={odds[key]}
                onChange={e => setOdds(o => ({ ...o, [key]: e.target.value }))}
                style={{
                  width: '100%', fontSize: 16, minHeight: 44,
                  padding: '0 12px', borderRadius: 'var(--radius-sm)',
                  background: 'var(--color-bg)', color: 'var(--color-text-primary)',
                  border: '0.5px solid var(--color-border-active)',
                }}
              />
            </div>
          ))}
        </div>
        <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginTop: 8 }}>
          Vig stripped automatically (MT22) · Edge vs V2 model · ≥ 5% = recommend (MT23)
        </p>
      </div>

      {/* EV results — appears once all three odds entered */}
      {ev1x2 && (
        <div style={{
          background: 'var(--color-bg-card)',
          border: '0.5px solid var(--color-border)',
          borderRadius: 'var(--radius-md)',
          padding: '14px 16px',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-text-muted)', letterSpacing: '0.06em' }}>
              EXPECTED VALUE
            </span>
            <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>vig {(ev1x2.vig.vigPct).toFixed(1)}%</span>
          </div>
          {['home', 'draw', 'away'].map(key => {
            const oc = ev1x2.outcomes[key]
            const col = EDGE_COLOURS[oc.ev?.colour] || 'var(--color-text-muted)'
            const best = ev1x2.bestBet === key
            return (
              <div key={key} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '8px 0', borderBottom: '0.5px solid var(--color-border)',
              }}>
                <span style={{ fontSize: 15, color: 'var(--color-text-primary)', fontWeight: best ? 700 : 400 }}>
                  {best ? '★ ' : ''}{OUTCOME_LABELS[key]}
                </span>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                  <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>fair {oc.fairOdds.toFixed(2)}</span>
                  <span style={{
                    fontSize: 14, fontWeight: 700, color: col,
                    padding: '2px 8px', borderRadius: 'var(--radius-full)', background: `${col}22`,
                  }}>{oc.ev?.edgeDisplay}</span>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Edge legend */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {[
          { colour: EDGE_COLOURS.green, label: '≥ 5% — Bet', token: 'green' },
          { colour: EDGE_COLOURS.amber, label: '0–4.9% — Marginal', token: 'amber' },
          { colour: EDGE_COLOURS.red,   label: '< 0% — Skip', token: 'red' },
        ].map(({ colour, label }) => (
          <span key={label} style={{
            fontSize: 15, fontWeight: 700,
            padding: '3px 10px',
            borderRadius: 'var(--radius-full)',
            background: `${colour}22`,
            color: colour,
            border: `0.5px solid ${colour}`,
          }}>
            {label}
          </span>
        ))}
      </div>
    </div>
  )
}

// Portfolio tab — Kelly formula reference + placeholder
function TabPortfolio({ stats }) {
  const model = useMemo(() => {
    if (!stats?.home || !stats?.away) return null
    try { return runModels(stats.home, stats.away) } catch { return null }
  }, [stats])

  const anchor = model?.v1.totalGoals.find(l => l.anchor)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* Model summary card */}
      {model && (
        <div style={{
          background: 'var(--color-bg-card)',
          border: '0.5px solid var(--color-border)',
          borderRadius: 'var(--radius-md)',
          padding: '14px 16px',
        }}>
          <p style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-text-muted)', letterSpacing: '0.06em', marginBottom: 10 }}>
            MODEL SUMMARY
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {[
              { label: 'λ Home (V1)', value: model.v1.lambdaHome.toFixed(2) },
              { label: 'λ Away (V1)', value: model.v1.lambdaAway.toFixed(2) },
              { label: 'λ Away (V2)', value: model.v2.lambdaAway.toFixed(2) },
              { label: 'Anchor line', value: anchor ? `${anchor.line}` : '—' },
            ].map(({ label, value }) => (
              <div key={label} style={{
                flex: '1 0 120px',
                background: 'var(--color-bg)',
                border: '0.5px solid var(--color-border)',
                borderRadius: 'var(--radius-sm)',
                padding: '8px 10px',
                textAlign: 'center',
              }}>
                <p style={{ fontSize: 14, color: 'var(--color-text-muted)', marginBottom: 2 }}>{label}</p>
                <p style={{ fontFamily: 'var(--font-display)', fontSize: 19, fontWeight: 600, color: 'var(--color-accent)' }}>{value}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Kelly formula reference */}
      <div style={{
        background: 'var(--color-bg-card)',
        border: '0.5px solid var(--color-border)',
        borderRadius: 'var(--radius-md)',
        padding: '14px 16px',
      }}>
        <p style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-text-muted)', letterSpacing: '0.06em', marginBottom: 10 }}>
          KELLY SIZING RULES
        </p>
        {[
          { label: 'Full Kelly',    formula: 'f* = (b×p − q) / b',          note: 'b = odds−1, q = 1−p' },
          { label: 'Fractional',   formula: 'stake = f* × 0.25 × bankroll', note: 'always fractional' },
          { label: 'Hard cap',     formula: 'max 5% of bankroll',            note: 'MT24', accent: true },
          { label: 'Min threshold',formula: '< 1% → skip or min stake',      note: 'not worth placing' },
        ].map(({ label, formula, note, accent }) => (
          <div key={label} style={{
            display: 'flex', alignItems: 'flex-start', gap: 12,
            padding: '8px 0',
            borderBottom: '0.5px solid var(--color-border)',
          }}>
            <span style={{ fontSize: 15, color: 'var(--color-text-muted)', minWidth: 90 }}>{label}</span>
            <span style={{
              fontFamily: 'var(--font-display)',
              fontSize: 15, flex: 1,
              color: accent ? 'var(--color-accent)' : 'var(--color-text-primary)',
            }}>
              {formula}
            </span>
            <span style={{ fontSize: 15, color: 'var(--color-text-secondary)' }}>{note}</span>
          </div>
        ))}
      </div>

      {/* Kelly portfolio builder + stress test */}
      <PortfolioBuilder />
    </div>
  )
}

// Portfolio builder — add legs (odds + model prob), Kelly stake, stress test
function PortfolioBuilder() {
  const [bankroll, setBankroll] = useState(1000)
  const [legs, setLegs] = useState([])
  const [draft, setDraft] = useState({ label: '', odds: '', prob: '' })

  const addLeg = () => {
    const odds = parseFloat(draft.odds), prob = parseFloat(draft.prob) / 100
    if (!(odds > 1) || !(prob > 0 && prob < 1) || !draft.label.trim()) return
    setLegs(l => [...l, { label: draft.label.trim(), odds, prob, stake: calcStake(prob, odds) }])
    setDraft({ label: '', odds: '', prob: '' })
  }
  const removeLeg = i => setLegs(l => l.filter((_, idx) => idx !== i))

  const sized = legs.map(leg => ({ ...leg, amount: bankroll * leg.stake.fraction }))
  const totalStake = sized.reduce((s, l) => s + l.amount, 0)
  const exposurePct = bankroll ? (totalStake / bankroll) * 100 : 0
  // Stress test: all win, all lose, and each-only-wins
  const allWin = sized.reduce((s, l) => s + l.amount * (l.odds - 1), 0)
  const allLose = -totalStake

  const inp = { fontSize: 16, minHeight: 44, padding: '0 10px', borderRadius: 'var(--radius-sm)', background: 'var(--color-bg)', color: 'var(--color-text-primary)', border: '0.5px solid var(--color-border-active)' }

  return (
    <div style={{ background: 'var(--color-bg-card)', border: '0.5px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '14px 16px' }}>
      <p style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-text-muted)', letterSpacing: '0.06em', marginBottom: 10 }}>PORTFOLIO BUILDER</p>

      <label style={{ fontSize: 13, color: 'var(--color-text-muted)', display: 'block', marginBottom: 4 }}>Bankroll</label>
      <input type="number" inputMode="decimal" min="0" value={bankroll} onChange={e => setBankroll(Math.max(0, parseFloat(e.target.value) || 0))} style={{ ...inp, width: '100%', marginBottom: 12 }} />

      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        <input placeholder="Bet" value={draft.label} onChange={e => setDraft(d => ({ ...d, label: e.target.value }))} style={{ ...inp, flex: 2 }} />
        <input placeholder="Odds" type="number" step="0.01" value={draft.odds} onChange={e => setDraft(d => ({ ...d, odds: e.target.value }))} style={{ ...inp, flex: 1, minWidth: 0 }} />
        <input placeholder="Prob%" type="number" value={draft.prob} onChange={e => setDraft(d => ({ ...d, prob: e.target.value }))} style={{ ...inp, flex: 1, minWidth: 0 }} />
        <button onClick={addLeg} style={{ minHeight: 44, padding: '0 14px', fontWeight: 700, background: 'var(--color-accent)', color: 'var(--color-bg)', border: 'none', borderRadius: 'var(--radius-sm)' }}>+</button>
      </div>

      {sized.map((l, i) => (
        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '0.5px solid var(--color-border)' }}>
          <span style={{ fontSize: 14, color: 'var(--color-text-primary)' }}>{l.label} @ {l.odds.toFixed(2)}</span>
          <span style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <span style={{ fontSize: 14, color: l.stake.pct >= 5 ? 'var(--color-warning)' : 'var(--color-text-secondary)' }}>{l.stake.pct.toFixed(1)}% · {l.amount.toFixed(0)}</span>
            <button onClick={() => removeLeg(i)} style={{ background: 'none', border: 'none', color: 'var(--color-danger)', fontSize: 18, cursor: 'pointer' }}>×</button>
          </span>
        </div>
      ))}

      {sized.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, marginBottom: 6 }}>
            <span style={{ color: 'var(--color-text-muted)' }}>Total exposure</span>
            <span style={{ color: exposurePct > 15 ? 'var(--color-warning)' : 'var(--color-text-primary)', fontWeight: 700 }}>{totalStake.toFixed(0)} · {exposurePct.toFixed(1)}%</span>
          </div>
          <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text-muted)', letterSpacing: '0.06em', margin: '10px 0 6px' }}>STRESS TEST (P&L)</p>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, color: 'var(--color-edge-green)' }}><span>All win</span><span>+{allWin.toFixed(0)}</span></div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, color: 'var(--color-edge-red)' }}><span>All lose</span><span>{allLose.toFixed(0)}</span></div>
          {sized.map((l, i) => {
            const pnl = l.amount * (l.odds - 1) - (totalStake - l.amount)
            return <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: 'var(--color-text-secondary)' }}><span>Only {l.label} wins</span><span>{pnl >= 0 ? '+' : ''}{pnl.toFixed(0)}</span></div>
          })}
        </div>
      )}
    </div>
  )
}

// ── AI Roles tab ─────────────────────────────────────────────────────────

const ROLE_META = {
  1:  { name: 'Statistical Validator', icon: '📊', phase: 1 },
  2:  { name: 'Form Intelligence',     icon: '📈', phase: 1 },
  3:  { name: 'Deep Analysis',         icon: '🧠', phase: 2, sonnet: true },
  4:  { name: 'Tournament Context',    icon: '🏆', phase: 1 },
  5:  { name: 'Market Intelligence',   icon: '💹', phase: 1 },
  6:  { name: 'Risk Manager',          icon: '🛡️', phase: 1 },
  7:  { name: 'Tactical Analyst',      icon: '⚽', phase: 1 },
  8:  { name: 'Head-to-Head Historian',icon: '📜', phase: 1 },
  9:  { name: 'Motivation Analyst',    icon: '🔥', phase: 1 },
  10: { name: 'Composite Scorer',      icon: '🎯', phase: 3 },
}

const REC_COLOURS = {
  home_win:   'var(--color-accent)',
  away_win:   'var(--color-info)',
  draw:       'var(--color-warning)',
  over:       'var(--color-success)',
  under:      'var(--color-text-secondary)',
  value_home: 'var(--color-accent)',
  value_away: 'var(--color-info)',
  null:       'var(--color-text-muted)',
}

function ConfidenceBar({ value }) {
  if (value == null) return <span style={{ fontSize: 15, color: 'var(--color-text-muted)' }}>—</span>
  const pct   = Math.round(value * 100)
  const color = pct >= 70 ? 'var(--color-success)' : pct >= 45 ? 'var(--color-warning)' : 'var(--color-danger)'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{
        flex: 1, height: 5, background: 'var(--color-bg)',
        border: '0.5px solid var(--color-border)',
        borderRadius: 'var(--radius-full)', overflow: 'hidden',
      }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 'var(--radius-full)', transition: 'width 0.4s ease' }} />
      </div>
      <span style={{ fontSize: 14, fontWeight: 700, color, minWidth: 34 }}>{pct}%</span>
    </div>
  )
}

function RoleCard({ roleOutput }) {
  const [expanded, setExpanded] = useState(false)
  const roleNum  = roleOutput?.role
  const meta     = ROLE_META[roleNum] || { name: `Role ${roleNum}`, icon: '🔹', phase: 1 }
  // roleId available for future role-specific overrides
  const rec      = roleOutput?.recommendation
  const recColor = REC_COLOURS[rec] || 'var(--color-text-muted)'
  const hasError = roleOutput?.flags?.includes('call_error') || roleOutput?.flags?.includes('parse_error')

  return (
    <div style={{
      background: 'var(--color-bg-card)',
      border: meta.sonnet
        ? '0.5px solid var(--color-info)'
        : '0.5px solid var(--color-border)',
      borderRadius: 'var(--radius-md)',
      overflow: 'hidden',
    }}>
      {/* Card header */}
      <button
        onClick={() => setExpanded(v => !v)}
        style={{
          width: '100%', padding: '12px 14px',
          background: 'none', border: 'none',
          cursor: 'pointer', textAlign: 'left',
          display: 'flex', alignItems: 'center', gap: 10,
        }}
      >
        <span style={{ fontSize: 21, flexShrink: 0 }}>{meta.icon}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-text-primary)' }}>
              {meta.name}
            </span>
            {meta.sonnet && (
              <span style={{
                fontSize: 14, fontWeight: 700, letterSpacing: '0.06em',
                color: 'var(--color-info)', padding: '1px 5px',
                border: '0.5px solid var(--color-info)',
                borderRadius: 'var(--radius-full)',
              }}>
                SONNET
              </span>
            )}
            {hasError && (
              <span style={{
                fontSize: 14, fontWeight: 700, color: 'var(--color-danger)',
                padding: '1px 5px', border: '0.5px solid var(--color-danger)',
                borderRadius: 'var(--radius-full)',
              }}>ERROR</span>
            )}
          </div>
          <ConfidenceBar value={roleOutput?.confidence} />
        </div>
        {rec && rec !== 'null' && (
          <span style={{
            fontSize: 15, fontWeight: 700, letterSpacing: '0.04em',
            color: recColor, padding: '3px 8px',
            background: `${recColor}22`,
            border: `0.5px solid ${recColor}`,
            borderRadius: 'var(--radius-full)',
            flexShrink: 0,
          }}>
            {rec?.replace(/_/g, ' ').toUpperCase()}
          </span>
        )}
        <span style={{ color: 'var(--color-text-muted)', fontSize: 14, flexShrink: 0 }}>
          {expanded ? '▲' : '▼'}
        </span>
      </button>

      {/* Expanded body */}
      {expanded && roleOutput && (
        <div style={{
          padding: '0 14px 14px',
          borderTop: '0.5px solid var(--color-border)',
        }}>
          {/* Summary */}
          <p style={{
            fontSize: 15, color: 'var(--color-text-secondary)',
            lineHeight: 1.6, marginTop: 12, marginBottom: 10,
          }}>
            {roleOutput.summary}
          </p>

          {/* Signals */}
          {roleOutput.signals?.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              {roleOutput.signals.map((sig, i) => {
                const isPositive = !sig.toLowerCase().startsWith('⚠') &&
                  !sig.toLowerCase().includes('concern') &&
                  !sig.toLowerCase().includes('risk') &&
                  !sig.toLowerCase().includes('weak') &&
                  !sig.toLowerCase().includes('miss')
                return (
                  <div key={i} style={{
                    display: 'flex', alignItems: 'flex-start', gap: 6,
                    marginBottom: 4,
                  }}>
                    <span style={{
                      fontSize: 15,
                      color: isPositive ? 'var(--color-success)' : 'var(--color-warning)',
                      flexShrink: 0, marginTop: 1,
                    }}>
                      {isPositive ? '✓' : '⚠'}
                    </span>
                    <span style={{ fontSize: 14, color: 'var(--color-text-secondary)' }}>
                      {sig}
                    </span>
                  </div>
                )
              })}
            </div>
          )}

          {/* Flags */}
          {roleOutput.flags?.length > 0 && (
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
              {roleOutput.flags.map(flag => (
                <span key={flag} style={{
                  fontSize: 14, fontWeight: 700,
                  padding: '2px 6px',
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--color-warning-dim)',
                  color: 'var(--color-warning)',
                  letterSpacing: '0.04em',
                }}>
                  {flag}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// Composite score display (Role 10)
function CompositeScore({ output }) {
  if (!output) return null
  const score = output.confidence != null ? Math.round(output.confidence * 100) : null
  const rec   = output.recommendation
  const color =
    score == null ? 'var(--color-text-muted)' :
    score >= 70   ? 'var(--color-success)' :
    score >= 50   ? 'var(--color-warning)' :
                    'var(--color-danger)'

  return (
    <div style={{
      background: 'var(--color-bg-card)',
      border: `1px solid ${color}`,
      borderRadius: 'var(--radius-lg)',
      padding: '20px 16px',
      textAlign: 'center',
      marginBottom: 20,
    }}>
      <p style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-text-muted)', letterSpacing: '0.08em', marginBottom: 8 }}>
        🎯 COMPOSITE CONFIDENCE
      </p>
      <p style={{
        fontFamily: 'var(--font-display)',
        fontSize: 72, fontWeight: 700,
        color,
        lineHeight: 1,
        marginBottom: 6,
      }}>
        {score ?? '—'}
      </p>
      <p style={{ fontSize: 14, color: 'var(--color-text-muted)', marginBottom: 12 }}>out of 100</p>

      {rec && rec !== 'null' && (
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '6px 16px',
          background: `${REC_COLOURS[rec] || 'var(--color-text-muted)'}22`,
          border: `0.5px solid ${REC_COLOURS[rec] || 'var(--color-text-muted)'}`,
          borderRadius: 'var(--radius-full)',
          marginBottom: 12,
        }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: REC_COLOURS[rec] || 'var(--color-text-muted)' }}>
            {rec.replace(/_/g, ' ').toUpperCase()}
          </span>
        </div>
      )}

      {/* Structured breakdown — verdict, drivers, calc, flags */}
      {(output.verdict || output.drivers?.length || output.summary) && (
        <div style={{ textAlign: 'left', maxWidth: 460, margin: '0 auto', padding: '0 4px' }}>
          {output.verdict && (
            <p style={{ fontSize: 16, fontWeight: 700, color: 'var(--color-text-primary)', lineHeight: 1.5, marginBottom: 12 }}>
              {output.verdict}
            </p>
          )}

          {Array.isArray(output.drivers) && output.drivers.length > 0 && (
            <ol style={{ margin: '0 0 12px', paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {output.drivers.slice(0, 3).map((d, i) => (
                <li key={i} style={{ fontSize: 14, color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>{d}</li>
              ))}
            </ol>
          )}

          {output.calc_note && (
            <p style={{
              fontSize: 13, color: 'var(--color-text-muted)', fontFamily: 'var(--font-display)',
              background: 'var(--color-bg)', border: '0.5px solid var(--color-border)',
              borderRadius: 'var(--radius-sm)', padding: '8px 10px', marginBottom: 10,
            }}>
              {output.calc_note}
            </p>
          )}

          {Array.isArray(output.risk_flags) && output.risk_flags.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {output.risk_flags.map((f, i) => (
                <p key={i} style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-warning)' }}>⚠ {f}</p>
              ))}
            </div>
          )}

          {/* Fallback: only show paragraph when no structured fields present */}
          {!output.verdict && !output.drivers?.length && output.summary && (
            <p style={{ fontSize: 14, color: 'var(--color-text-secondary)', lineHeight: 1.6 }}>
              {output.summary}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function TabAI({ match, isAdmin }) {
  const [roleOutputs, setRoleOutputs]   = useState([])   // { role_id, output_json, confidence }[]
  const [aiRoles, setAiRoles]           = useState([])   // ai_roles rows
  const [loading, setLoading]           = useState(true)
  const [running, setRunning]           = useState(false)
  const [error, setError]               = useState(null)
  const [runMsg, setRunMsg]             = useState('')

  // Load ai_roles + existing role_outputs on mount
  useEffect(() => {
    if (!match?.id) return

    async function load() {
      setLoading(true)
      try {
        const [rolesRes, outputsRes] = await Promise.all([
          supabase.from('ai_roles').select('*').eq('enabled', true).order('role_number'),
          supabase.from('role_outputs').select('*').eq('match_id', match.id),
        ])
        if (rolesRes.data) setAiRoles(rolesRes.data)
        if (outputsRes.data) setRoleOutputs(outputsRes.data)
      } catch (err) {
        setError(err.message)
      }
      setLoading(false)
    }
    load()
  }, [match?.id])

  async function handleRunAnalysis() {
    setRunning(true)
    setRunMsg('')
    setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) throw new Error('Not authenticated')

      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type':  'application/json',
        },
        body: JSON.stringify({ match_id: match.id }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)

      setRunMsg(`✓ ${data.roles_run} roles complete · confidence ${data.confidence != null ? Math.round(data.confidence * 100) : '—'}`)

      // Reload outputs from Supabase
      const { data: fresh } = await supabase
        .from('role_outputs')
        .select('*')
        .eq('match_id', match.id)
      if (fresh) setRoleOutputs(fresh)

    } catch (err) {
      setError(err.message)
    }
    setRunning(false)
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {[1,2,3,4].map(i => (
          <div key={i} className="skeleton" style={{ height: 60 }} />
        ))}
      </div>
    )
  }

  // Build lookup: role_id → normalised output_json
  function normaliseOutput(raw) {
    if (!raw) return null
    if (typeof raw === 'object') return raw
    try {
      const clean = String(raw).replace(/```json\n?|\n?```/g, '').trim()
      return JSON.parse(clean)
    } catch {
      return { summary: String(raw).slice(0, 300), confidence: null, recommendation: null, signals: [], flags: ['parse_error'] }
    }
  }
  const outputByRoleId = {}
  for (const o of roleOutputs) outputByRoleId[o.role_id] = { ...o, output_json: normaliseOutput(o.output_json) }

  // Find composite (Role 10)
  const role10Row    = aiRoles.find(r => r.role_number === 10)
  // output_json may be a parsed object or a raw JSON string — normalise it
  const rawComposite = role10Row ? outputByRoleId[role10Row.id]?.output_json : null
  const composite = (() => {
    if (!rawComposite) return null
    if (typeof rawComposite === 'object') return rawComposite
    try {
      const clean = String(rawComposite).replace(/```json\n?|\n?```/g, '').trim()
      return JSON.parse(clean)
    } catch {
      return { summary: String(rawComposite).slice(0, 300), confidence: null, recommendation: null }
    }
  })()
  const hasAnyOutput = roleOutputs.length > 0
  const lastRun      = roleOutputs.length
    ? new Date(Math.max(...roleOutputs.map(o => new Date(o.created_at)))).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
    : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

      {/* Admin: run button */}
      {isAdmin && (
        <div style={{
          background: 'var(--color-bg-card)',
          border: '0.5px solid var(--color-border)',
          borderRadius: 'var(--radius-md)',
          padding: '12px 14px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap',
        }}>
          <div>
            <p style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: 2 }}>
              {hasAnyOutput ? 'Re-run AI Analysis' : 'Run AI Analysis'}
            </p>
            {lastRun && (
              <p style={{ fontSize: 15, color: 'var(--color-text-muted)' }}>Last run: {lastRun} 北京</p>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {runMsg && <span style={{ fontSize: 15, color: 'var(--color-success)' }}>{runMsg}</span>}
            <button
              onClick={handleRunAnalysis}
              disabled={running}
              style={{
                minHeight: 'var(--touch-target)',
                padding: '0 16px',
                background: running ? 'transparent' : 'var(--color-accent-dim)',
                border: '0.5px solid var(--color-accent-border)',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--color-accent)',
                fontFamily: 'var(--font-ui)',
                fontSize: 15, fontWeight: 500,
                cursor: running ? 'not-allowed' : 'pointer',
                opacity: running ? 0.6 : 1,
                whiteSpace: 'nowrap',
              }}
            >
              {running ? '⏳ Analysing…' : '▶ Run 11 Roles'}
            </button>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div style={{
          background: 'var(--color-danger-dim)',
          border: '0.5px solid var(--color-danger)',
          borderRadius: 'var(--radius-md)',
          padding: '10px 14px',
        }}>
          <p style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-danger)' }}>{error}</p>
        </div>
      )}

      {/* No outputs yet */}
      {!hasAnyOutput && !isAdmin && (
        <div style={{
          background: 'var(--color-bg-card)',
          border: '0.5px solid var(--color-border)',
          borderRadius: 'var(--radius-md)',
          padding: 24, textAlign: 'center',
          color: 'var(--color-text-muted)', fontSize: 15,
        }}>
          AI analysis not yet run for this match
        </div>
      )}

      {/* Composite score — prominently first */}
      {composite && <CompositeScore output={composite} />}

      {/* Role 3 (Deep Analysis) first among cards if present */}
      {aiRoles
        .filter(r => r.role_number === 3)
        .map(r => {
          const out = outputByRoleId[r.id]
          if (!out) return null
          return (
            <RoleCard key={r.id} roleOutput={out.output_json} />
          )
        })
      }

      {/* Phase 1 roles (1,2,4,5,6,7,8,9) */}
      <div>
        <p style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-text-muted)', letterSpacing: '0.06em', marginBottom: 8 }}>
          SPECIALIST ROLES
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {aiRoles
            .filter(r => [1,2,4,5,6,7,8,9].includes(r.role_number))
            .map(r => {
              const out = outputByRoleId[r.id]
              return (
                <RoleCard key={r.id} roleOutput={out?.output_json || null} />
              )
            })
          }
        </div>
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
  const [dixonColes, setDixonColes] = useState(false)  // MT21 default OFF

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
    await refreshStats()
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
        <p style={{ fontSize: 14, color: 'var(--color-text-muted)', marginTop: 8, marginBottom: 4 }}>
          {STAGE_LABELS[match.stage] || match.stage}
          {match.group_name ? ` · Group ${match.group_name}` : ''}
          {match.venue ? ` · ${match.venue}` : ''}
          {match.city ? `, ${match.city}` : ''}
        </p>

        {/* Time (MT14 — Beijing always) */}
        <p style={{ fontSize: 14, color: 'var(--color-text-secondary)', marginBottom: 16 }}>
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
              fontSize: 19, fontWeight: 600,
              color: 'var(--color-text-primary)',
              marginTop: 4,
            }}>
              {match.home_team}
            </p>
            <p style={{ fontSize: 15, color: 'var(--color-text-muted)' }}>Home</p>
          </div>

          <div style={{ textAlign: 'center', flexShrink: 0 }}>
            <p style={{
              fontFamily: 'var(--font-display)',
              fontSize: 19, fontWeight: 400,
              color: 'var(--color-text-muted)',
            }}>
              {match.home_score !== null ? `${match.home_score} – ${match.away_score}` : 'vs'}
            </p>
          </div>

          <div style={{ textAlign: 'center', flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: 36, lineHeight: 1 }}>{getFlag(match.away_team)}</p>
            <p style={{
              fontFamily: 'var(--font-display)',
              fontSize: 19, fontWeight: 600,
              color: 'var(--color-text-primary)',
              marginTop: 4,
            }}>
              {match.away_team}
            </p>
            <p style={{ fontSize: 15, color: 'var(--color-text-muted)' }}>Away</p>
          </div>
        </div>

        {/* Confidence badge + last updated */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, paddingBottom: 16, flexWrap: 'wrap' }}>
          <span style={{
            fontSize: 14, fontWeight: 600,
            color: confCfg.color,
            background: 'var(--color-bg-card)',
            border: `0.5px solid ${confCfg.color}`,
            borderRadius: 'var(--radius-full)',
            padding: '4px 12px',
          }}>
            {confCfg.label}
          </span>
          <span style={{ fontSize: 15, color: 'var(--color-text-secondary)' }}>
            {confCfg.desc}
          </span>
          {lastUpdated && (
            <span style={{ fontSize: 15, color: 'var(--color-text-secondary)' }}>
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
                fontSize: 15, fontWeight: activeTab === tab ? 600 : 400,
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
              <p style={{ color: 'var(--color-danger)', fontSize: 15, marginBottom: 12 }}>
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
                    fontSize: 14,
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
                      <p style={{ fontSize: 14, color: 'var(--color-accent)', fontWeight: 700, letterSpacing: '0.06em', marginBottom: 2 }}>V1 MODEL</p>
                      <p style={{ fontSize: 15, color: 'var(--color-text-muted)' }}>Overall stats — home + away combined</p>
                    </div>
                    <div style={{ flex: 1, minWidth: 120 }}>
                      <p style={{ fontSize: 14, color: 'var(--color-info)', fontWeight: 700, letterSpacing: '0.06em', marginBottom: 2 }}>V2 MODEL</p>
                      <p style={{ fontSize: 15, color: 'var(--color-text-muted)' }}>Away-factor correction applied</p>
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
                  <p style={{ fontSize: 15, color: 'var(--color-text-secondary)', textAlign: 'center', marginTop: 16 }}>
                    Source: footystats.org · {stats.home?.games_window || 0}-game window (MT06 requires 5)
                  </p>
                )}
              </>
            )}
          </div>
        )}

        {/* TAB 2: Matrix */}
        {activeTab === 'matrix' && <TabMatrix stats={stats} match={match} dixonColes={dixonColes} onToggleDixon={setDixonColes} />}

        {/* TAB 3: Value */}
        {activeTab === 'value' && <TabValue stats={stats} match={match} />}

        {/* TAB 4: Portfolio */}
        {activeTab === 'portfolio' && <TabPortfolio stats={stats} />}

        {/* TAB 5: AI Roles */}
        {activeTab === 'ai' && <TabAI match={match} isAdmin={isAdmin} />}

      </div>
    </div>
  )
}

const backBtnStyle = {
  background: 'none',
  border: 'none',
  color: 'var(--color-text-secondary)',
  fontFamily: 'var(--font-ui)',
  fontSize: 16,
  cursor: 'pointer',
  padding: '0',
  minHeight: 'var(--touch-target)',
  display: 'flex',
  alignItems: 'center',
}
