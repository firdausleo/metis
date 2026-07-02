import { useState, useEffect, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useUser } from '../context/UserContext'
import { useTeamStats } from '../hooks/useTeamStats'
import { useTranslation } from '../lib/i18n'
import { getFlag } from '../lib/teamFlags'
import { toBeijingTime } from '../lib/dateUtils'
import { supabase } from '../lib/supabase'
import { runModels, capProb, SCORE_MAX, monteCarlo, getVenueAdvantage, LEAGUE_AVG_GOALS, DEF_FACTOR_MIN, DEF_FACTOR_MAX, blendInput, isXgNoise, XG_BLEND_XG, XG_BLEND_GOAL } from '../lib/poisson'
import { formatProb, analyse1X2, calcStake } from '../lib/evEngine'
import { placeBet } from '../lib/bets'
import { logPageView, track } from '../utils/activityTracker'
import PredictionTab from '../components/match/PredictionTab'
import BetsTab from '../components/match/BetsTab'
import PASPTab from '../components/match/PASPTab'

const ADMIN_UUID = '4a6e1f29-e18b-4fd3-9a7e-cec54501db54'

const STAGE_LABELS = {
  group: 'Group Stage', r32: 'Round of 32', r16: 'Round of 16',
  qf: 'Quarter Final', sf: 'Semi Final', '3rd': 'Third Place', final: 'Final',
}

const CONFIDENCE_CONFIG = {
  low:    { icon: '⚠️', color: 'var(--color-danger)',  desc: '< 5 games data' },
  medium: { icon: '~',  color: 'var(--color-warning)', desc: '2–4 WC games' },
  high:   { icon: '✅', color: 'var(--color-accent)',  desc: '3 WC games' },
  max:    { icon: '🔥', color: 'var(--color-accent)',  desc: '4–5 WC games' },
}

const TABS = ['prediction', 'pasp', 'bets']
// Legacy tab components kept below for reference — not rendered in the 2-tab UI.
// const LEGACY_TABS = ['stats', 'matrix', 'value', 'asian', 'portfolio', 'ai']

// ── Sub-components ────────────────────────────────────────────────────────

function StatCard({ label, value, highlight, naLabel }) {
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
        fontSize: value == null && naLabel ? 14 : 23, fontWeight: 600,
        color: highlight ? 'var(--color-accent)' : (value == null ? 'var(--color-text-muted)' : 'var(--color-text-primary)'),
      }}>
        {value ?? naLabel ?? '—'}
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

// LAST 5 MATCHES table — shows per-fixture breakdown stored in recent_fixtures jsonb
function Last5Table({ fixtures, goalsScoredAvg, goalsConcededAvg, xgfPerGame, xgaPerGame }) {
  const [collapsed, setCollapsed] = useState(false)

  if (!fixtures) {
    return (
      <p style={{ fontSize: 12, color: 'var(--color-text-muted)', fontStyle: 'italic', marginTop: 8 }}>
        Re-fetch stats to see match breakdown
      </p>
    )
  }

  const RESULT_BG = {
    W: 'rgba(45,122,79,0.28)',
    D: 'rgba(204,136,0,0.22)',
    L: 'rgba(185,60,60,0.22)',
  }

  const th = {
    padding: '4px 6px', fontSize: 11, fontWeight: 700, letterSpacing: '0.05em',
    color: 'var(--color-text-muted)', background: 'var(--color-bg-elevated)',
    borderBottom: '0.5px solid var(--color-border)', whiteSpace: 'nowrap', textAlign: 'center',
  }
  const td = {
    padding: '5px 6px', fontSize: 12, color: 'var(--color-text-secondary)',
    borderBottom: '0.5px solid var(--color-border)', whiteSpace: 'nowrap', textAlign: 'center',
  }

  return (
    <div style={{ marginTop: 12 }}>
      <button
        onClick={() => setCollapsed(v => !v)}
        style={{
          background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0',
          display: 'flex', alignItems: 'center', gap: 6,
        }}
      >
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text-muted)', letterSpacing: '0.06em' }}>
          LAST 5 MATCHES
        </span>
        <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{collapsed ? '▼' : '▲'}</span>
      </button>

      {!collapsed && (
        <div style={{ overflowX: 'auto', marginTop: 4, borderRadius: 'var(--radius-sm)', border: '0.5px solid var(--color-border)' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 500 }}>
            <thead>
              <tr>
                <th style={{ ...th, textAlign: 'left' }}>Date</th>
                <th style={{ ...th, textAlign: 'left', maxWidth: 90 }}>vs</th>
                <th style={{ ...th, textAlign: 'left', maxWidth: 80 }}>Comp</th>
                <th style={th}>H/A</th>
                <th style={th}>Score</th>
                <th style={th}>GF</th>
                <th style={th}>GA</th>
                <th style={th}>xGF</th>
                <th style={th}>xGA</th>
                <th style={th}>Wt</th>
              </tr>
            </thead>
            <tbody>
              {fixtures.map((fx, i) => (
                <tr key={i}>
                  <td style={{ ...td, textAlign: 'left' }}>{fx.date}</td>
                  <td style={{ ...td, textAlign: 'left', maxWidth: 90, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {fx.opponent}
                  </td>
                  <td style={{ ...td, textAlign: 'left', maxWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {fx.competition}
                  </td>
                  <td style={td}>{fx.home_away}</td>
                  <td style={{ ...td, background: RESULT_BG[fx.result] || 'transparent', fontWeight: 700 }}>
                    {fx.score_for}–{fx.score_against}
                  </td>
                  <td style={td}>{fx.score_for}</td>
                  <td style={td}>{fx.score_against}</td>
                  <td style={{ ...td, color: fx.xgf == null ? 'var(--color-text-muted)' : 'inherit' }}>
                    {fx.xgf ?? 'N/A'}
                  </td>
                  <td style={{ ...td, color: fx.xga == null ? 'var(--color-text-muted)' : 'inherit' }}>
                    {fx.xga ?? 'N/A'}
                  </td>
                  <td style={{ ...td, fontSize: 11, color: 'var(--color-text-muted)' }}>
                    {fx.weight != null ? fx.weight : '—'}
                  </td>
                </tr>
              ))}

              {/* WEIGHTED AVG summary row */}
              <tr style={{ background: 'var(--color-bg-elevated)' }}>
                <td colSpan={5} style={{ ...td, textAlign: 'left', fontWeight: 700, fontSize: 11, letterSpacing: '0.06em', color: 'var(--color-text-muted)' }}>
                  WEIGHTED AVG
                </td>
                <td style={{ ...td, fontWeight: 700, color: 'var(--color-text-primary)' }}>
                  {goalsScoredAvg ?? '—'}
                </td>
                <td style={{ ...td, fontWeight: 700, color: 'var(--color-text-primary)' }}>
                  {goalsConcededAvg ?? '—'}
                </td>
                <td style={{ ...td, fontWeight: 700, color: xgfPerGame == null ? 'var(--color-text-muted)' : 'var(--color-text-primary)' }}>
                  {xgfPerGame ?? 'N/A'}
                </td>
                <td style={{ ...td, fontWeight: 700, color: xgaPerGame == null ? 'var(--color-text-muted)' : 'var(--color-text-primary)' }}>
                  {xgaPerGame ?? 'N/A'}
                </td>
                <td style={td} />
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// λ CALCULATION box — shows the full formula breakdown beneath the match table
function LambdaCalcBox({ teamStats, opponentStats, isHome, match }) {
  if (!teamStats?.goals_scored_avg || !opponentStats?.goals_conceded_avg) return null

  const scored_avg  = teamStats.goals_scored_avg
  const xgf         = teamStats.xgf_per_game
  const opp_conc    = opponentStats.goals_conceded_avg
  const opp_xga     = opponentStats.xga_per_game

  // Mirror calcLambdasV1: blend only when BOTH teams have xG data
  const bothHaveXgF   = xgf != null && opponentStats.xgf_per_game != null
  const bothHaveXgA   = opp_xga != null && teamStats.xga_per_game != null
  const attack_input  = bothHaveXgF ? blendInput(xgf, scored_avg) : scored_avg
  const def_input     = bothHaveXgA ? blendInput(opp_xga, opp_conc) : opp_conc
  const def_factor    = Math.min(Math.max(LEAGUE_AVG_GOALS / def_input, DEF_FACTOR_MIN), DEF_FACTOR_MAX)
  const venue_factor  = isHome ? getVenueAdvantage(match?.venue, match?.city, match?.home_team) : 1.0
  const venue_name    = isHome ? (match?.venue || match?.city || 'Neutral venue') : 'Away'
  const lambda        = attack_input * def_factor * venue_factor

  const xgNote   = bothHaveXgF
    ? 'xG blend applied (both teams have xG data)'
    : 'Goals only (one or both teams lack xG data)'

  const attackLine = !bothHaveXgF
    ? `${scored_avg} goals/game`
    : isXgNoise(xgf, scored_avg)
    ? `${scored_avg} goals/game (xGF ${xgf} noise — using goals only)`
    : `${xgf} xGF × ${XG_BLEND_XG} + ${scored_avg} goals × ${XG_BLEND_GOAL} = ${attack_input.toFixed(3)}`

  const defLine = !bothHaveXgA
    ? `${def_factor.toFixed(3)} [1.5 ÷ ${opp_conc} conceded, cap 1.8]`
    : isXgNoise(opp_xga, opp_conc)
    ? `${def_factor.toFixed(3)} [1.5 ÷ ${opp_conc} conceded (xGA ${opp_xga} noise — goals only), cap 1.8]`
    : `${def_factor.toFixed(3)} [1.5 ÷ ${def_input.toFixed(3)} (xG blend), cap 1.8]`

  return (
    <div style={{
      marginTop: 8,
      padding: '10px 12px',
      background: 'var(--color-bg)',
      border: '0.5px solid var(--color-border)',
      borderRadius: 'var(--radius-sm)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-muted)', letterSpacing: '0.07em' }}>
          λ CALCULATION
        </p>
        <span style={{ fontSize: 11, color: bothHaveXgF ? 'var(--color-info)' : 'var(--color-text-muted)' }}>
          {xgNote}
        </span>
      </div>
      <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', lineHeight: 1.7 }}>
        Attack: {attackLine}
      </p>
      <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', lineHeight: 1.7 }}>
        Defense factor: {defLine}
      </p>
      <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', lineHeight: 1.7 }}>
        Venue: ×{venue_factor.toFixed(2)} [{venue_name}]
      </p>
      <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-accent)', lineHeight: 1.7, marginTop: 4 }}>
        λ = {attack_input.toFixed(3)} × {def_factor.toFixed(3)} × {venue_factor.toFixed(2)} = {lambda.toFixed(3)}
      </p>
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

function StatsColumn({ match, teamStats, opponentStats, isHome, isAdmin, onRefresh, onSaveManual, refreshing, t }) {
  const [showManual, setShowManual] = useState(false)
  const teamName = isHome ? match.home_team : match.away_team
  const teamCode = isHome ? match.home_team_code : match.away_team_code
  const hasStats = !!teamStats

  // Compute actual V1 lambda (blended attack × clamped def factor × venue)
  // so the display card shows the final model input, not raw xGF.
  const v1AttackInput = teamStats ? blendInput(teamStats.xgf_per_game, teamStats.goals_scored_avg) : null
  const v1DefRaw = opponentStats?.goals_conceded_avg != null
    ? blendInput(opponentStats.xga_per_game, opponentStats.goals_conceded_avg)
    : null
  const v1DefFactor = v1DefRaw != null
    ? Math.min(Math.max(LEAGUE_AVG_GOALS / v1DefRaw, DEF_FACTOR_MIN), DEF_FACTOR_MAX)
    : null
  const v1VenueFactor = isHome ? getVenueAdvantage(match?.venue, match?.city, match?.home_team) : 1.0
  const v1Lambda = v1AttackInput != null && v1DefFactor != null
    ? v1AttackInput * v1DefFactor * v1VenueFactor
    : null

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
          {isHome ? t('analysis.home') : t('analysis.away')} · {teamCode}
        </p>
      </div>

      {/* Data quality badge */}
      {(() => {
        const gw = teamStats?.games_window ?? 0
        const src = teamStats?.data_source
        let bg, color, label
        if (!teamStats || gw === 0) {
          bg = '#FCEBEB'; color = '#791F1F'
          label = src === 'insufficient_data' ? 'Insufficient data' : 'No data'
        } else if (gw >= 5) {
          bg = '#EAF3DE'; color = '#27500A'; label = `${gw} games`
        } else if (gw >= 3) {
          bg = '#FAEEDA'; color = '#633806'; label = `${gw} games`
        } else {
          bg = '#FCEBEB'; color = '#791F1F'; label = `${gw} games (limited)`
        }
        return (
          <span style={{
            display: 'inline-block', fontSize: 11, fontWeight: 700,
            padding: '2px 8px', borderRadius: 99,
            background: bg, color, marginBottom: 10,
          }}>
            {label}
          </span>
        )
      })()}

      {hasStats ? (
        <>
          {/* Core stat cards */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 10 }}>
            <StatCard label={t('analysis.scored')}   value={teamStats.goals_scored_avg}   />
            <StatCard label={t('analysis.conceded')} value={teamStats.goals_conceded_avg} />
            <StatCard label={t('analysis.xgf')}      value={teamStats.xgf_per_game} naLabel={t('analysis.xgNa')} />
            <StatCard label={t('analysis.xga')}      value={teamStats.xga_per_game} naLabel={t('analysis.xgNa')} />
          </div>
          {teamStats.xgf_per_game == null && (
            <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 10, lineHeight: 1.4 }}>
              {t('analysis.xgNote')}
            </p>
          )}

          {/* Lambda V1 — show fully-computed λ (blended attack × defense × venue) */}
          <LambdaBlock
            label={`${t('analysis.lambda')} (V1)`}
            value={v1Lambda != null ? v1Lambda.toFixed(3) : (v1AttackInput != null ? v1AttackInput.toFixed(3) : null)}
            dimLabel={`${teamStats.games_window || 0} games · ${teamStats.xgf_per_game != null ? 'xG blend' : 'goals only'} · ${teamStats.data_source || 'API-Football'}`}
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

          {/* LAST 5 MATCHES + λ CALCULATION */}
          <Last5Table
            fixtures={teamStats.recent_fixtures}
            goalsScoredAvg={teamStats.goals_scored_avg}
            goalsConcededAvg={teamStats.goals_conceded_avg}
            xgfPerGame={teamStats.xgf_per_game}
            xgaPerGame={teamStats.xga_per_game}
          />
          <LambdaCalcBox
            teamStats={teamStats}
            opponentStats={opponentStats}
            isHome={isHome}
            match={match}
          />
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
  // On warm-white: deep cells get light text, faint cells keep dark ink
  const textColor = intensity > 0.45 ? '#FFFFFF' : 'var(--color-text-primary)'
  return (
    <div style={{
      height: 44,
      borderRadius: 4,
      background: isMax
        ? `rgba(45,122,79,${intensity + 0.15})`
        : `rgba(45,122,79,${intensity})`,
      border: isMax
        ? '2px solid var(--color-accent)'
        : '0.5px solid var(--color-border-light)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 13,
      color: isMax ? '#FFFFFF' : textColor,
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
      {/* Badge — top-right */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
        <span style={{
          fontSize: 11, fontWeight: 700, letterSpacing: '0.06em',
          color: colour, padding: '2px 8px',
          background: 'var(--color-bg)',
          border: `0.5px solid ${colour}`,
          borderRadius: 'var(--radius-full)',
        }}>
          {label}
        </span>
      </div>

      {/* Main layout: rotated home-team label + grid */}
      <div style={{ display: 'flex', gap: 4, alignItems: 'stretch' }}>

        {/* Rotated home-team axis label (rows = home goals ↓) */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 18, flexShrink: 0 }}>
          <span style={{
            writingMode: 'vertical-rl',
            transform: 'rotate(180deg)',
            fontSize: 11, fontWeight: 600,
            color: 'var(--color-text-muted)',
            letterSpacing: '0.04em',
            whiteSpace: 'nowrap',
          }}>
            {getFlag(homeTeam)} {homeTeam} goals ↓
          </span>
        </div>

        {/* Grid area */}
        <div style={{ flex: 1 }}>
          {/* Away-team column axis label */}
          <div style={{ textAlign: 'center', fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', letterSpacing: '0.04em', marginBottom: 6 }}>
            {getFlag(awayTeam)} {awayTeam} goals →
          </div>

          {/* Column headers (away goals 0-8) */}
          <div style={{ display: 'grid', gridTemplateColumns: `28px repeat(${size}, 1fr)`, gap: 3, marginBottom: 3 }}>
            <div />
            {Array.from({ length: size }, (_, j) => (
              <div key={j} style={{ textAlign: 'center', fontSize: 14, color: 'var(--color-text-primary)', fontWeight: 700 }}>
                {j}
              </div>
            ))}
          </div>

          {/* Rows (home goals 0-8) */}
          {matrix.map((row, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: `28px repeat(${size}, 1fr)`, gap: 3, marginBottom: 3 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, color: 'var(--color-text-muted)', fontWeight: 600 }}>
                {i}
              </div>
              {row.map((v, j) => (
                <MatrixCell key={j} value={v} isMax={v === maxVal} />
              ))}
            </div>
          ))}
        </div>
      </div>
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
  const { t } = useTranslation()
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
          {t('mc.title').toUpperCase()}{sim ? ` · ${(sim.n / 1000)}K` : ''}
        </p>
        <button onClick={() => run(100000)} disabled={running} style={{
          minHeight: 44, padding: '0 16px', fontSize: 15, fontWeight: 700,
          borderRadius: 'var(--radius-sm)', cursor: running ? 'default' : 'pointer',
          background: 'var(--color-accent-dim)', color: 'var(--color-accent)',
          border: '0.5px solid var(--color-accent-border)', opacity: running ? 0.7 : 1,
        }}>{running ? t('mc.running') : t('mc.deep')}</button>
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
            {t('mc.likely')}: {sim.topScores.map(s => `${s.score} (${(s.prob * 100).toFixed(1)}%)`).join(' · ')}
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
  const { t } = useTranslation()
  const [modelError, setModelError] = useState(null)
  const model = useMemo(() => {
    if (!stats?.home || !stats?.away) return null
    try {
      setModelError(null)
      return runModels(stats.home, stats.away, { dixonColes, venue: match?.venue, city: match?.city, homeTeam: match?.home_team, awayTeam: match?.away_team })
    } catch (err) {
      setModelError(err.message)
      return null
    }
  }, [stats, dixonColes, match])

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

  const { v1, v2, v3, divergence } = model

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
          {v3 && <p style={{ fontSize: 14, color: '#534AB7' }}>V3: {v3.lambdaHome.toFixed(3)}</p>}
        </div>
        <span style={{ fontFamily: 'var(--font-display)', fontSize: 21, color: 'var(--color-text-muted)' }}>vs</span>
        <div style={{ textAlign: 'center' }}>
          <p style={{ fontSize: 14, color: 'var(--color-text-muted)', letterSpacing: '0.05em', marginBottom: 2 }}>λ AWAY</p>
          <p style={{ fontFamily: 'var(--font-display)', fontSize: 36, fontWeight: 600, color: 'var(--color-accent)' }}>
            {v1.lambdaAway.toFixed(3)}
          </p>
          <p style={{ fontSize: 14, color: 'var(--color-info)' }}>V2: {v2.lambdaAway.toFixed(3)} <span style={{ color: 'var(--color-text-muted)' }}>({v2.awayFactorNote})</span></p>
          {v3 && <p style={{ fontSize: 14, color: '#534AB7' }}>V3: {v3.lambdaAway.toFixed(3)}</p>}
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

      {/* V3 Model Comparison Table */}
      {v3 && (() => {
        const v2over25 = v2.totalGoals?.find(l => l.line === 2.5)?.over ?? null
        const v2btts = (() => {
          let b = 0
          const M = v2.matrix
          for (let i = 1; i < M.length; i++) for (let j = 1; j < M[i].length; j++) b += M[i][j]
          return Math.round(b * 1000) / 1000
        })()
        const rows = [
          { label: `${match.home_team} Win`, v2val: v2.probs.home, v3val: v3.probs.home },
          { label: 'Draw',                   v2val: v2.probs.draw, v3val: v3.probs.draw },
          { label: `${match.away_team} Win`, v2val: v2.probs.away, v3val: v3.probs.away },
          { label: 'Over 2.5',              v2val: v2over25,       v3val: v3.over25 },
          { label: 'BTTS',                   v2val: v2btts,         v3val: v3.btts },
        ]
        const v2v3Diff = Math.abs(v2.probs.home - v3.probs.home)
        return (
          <div style={{
            background: 'var(--color-bg-card)',
            border: '0.5px solid #534AB7',
            borderRadius: 'var(--radius-md)',
            overflow: 'hidden',
          }}>
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '10px 14px',
              background: '#EEEDFE',
              borderBottom: '0.5px solid #534AB7',
            }}>
              <p style={{ fontSize: 14, fontWeight: 700, color: '#3C3489', letterSpacing: '0.06em' }}>
                {t('analysis.modelComparison').toUpperCase()}
              </p>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {v2v3Diff > 0.08 && (
                  <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: '#FAEEDA', color: '#633806', border: '0.5px solid #cc8800' }}>
                    ⚠ {t('analysis.modelsDisagree')}
                  </span>
                )}
                <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: '#EEEDFE', color: '#3C3489', border: '0.5px solid #534AB7' }}>
                  {t('analysis.v3badge')}
                </span>
              </div>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 280 }}>
                <thead>
                  <tr>
                    <th style={{ padding: '7px 12px', fontSize: 11, fontWeight: 700, color: 'var(--color-text-muted)', background: 'var(--color-bg-elevated)', borderBottom: '0.5px solid var(--color-border)', textAlign: 'left', letterSpacing: '0.05em' }}>Outcome</th>
                    <th style={{ padding: '7px 12px', fontSize: 11, fontWeight: 700, color: 'var(--color-info)', background: 'var(--color-bg-elevated)', borderBottom: '0.5px solid var(--color-border)', textAlign: 'center' }}>V2</th>
                    <th style={{ padding: '7px 12px', fontSize: 11, fontWeight: 700, color: '#534AB7', background: '#EEEDFE', borderBottom: '0.5px solid var(--color-border)', textAlign: 'center' }}>V3 DC ★</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => {
                    const diff = r.v2val != null && r.v3val != null ? Math.abs(r.v2val - r.v3val) : 0
                    return (
                      <tr key={r.label} style={{ background: diff > 0.08 ? 'rgba(204,136,0,0.05)' : 'transparent' }}>
                        <td style={{ padding: '8px 12px', fontSize: 14, color: 'var(--color-text-primary)', borderBottom: '0.5px solid var(--color-border)' }}>{r.label}</td>
                        <td style={{ padding: '8px 12px', fontSize: 14, fontWeight: 600, color: 'var(--color-info)', textAlign: 'center', borderBottom: '0.5px solid var(--color-border)' }}>
                          {r.v2val != null ? `${(r.v2val * 100).toFixed(1)}%` : '—'}
                        </td>
                        <td style={{ padding: '8px 12px', fontSize: 14, fontWeight: 700, color: '#534AB7', textAlign: 'center', borderBottom: '0.5px solid var(--color-border)', background: '#EEEDFE22' }}>
                          {r.v3val != null ? `${(r.v3val * 100).toFixed(1)}%` : '—'}
                          {diff > 0.08 && <span style={{ marginLeft: 4, fontSize: 10, color: '#cc8800' }}>⚠</span>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <p style={{ fontSize: 12, color: 'var(--color-text-muted)', padding: '8px 12px' }}>
              {t('analysis.v3tooltip')}
            </p>
          </div>
        )
      })()}

      {/* Monte Carlo cross-check */}
      <MonteCarloPanel v1={v1} match={match} />

      {/* Score matrices — V1 */}
      <ScoreMatrix
        matrix={v1.matrix}
        homeTeam={match.home_team_code}
        awayTeam={match.away_team_code}
        label={t('analysis.v1matrix').toUpperCase()}
        colour="var(--color-accent)"
      />

      {/* Score matrices — V2 */}
      <ScoreMatrix
        matrix={v2.matrix}
        homeTeam={match.home_team_code}
        awayTeam={match.away_team_code}
        label={t('analysis.v2matrix').toUpperCase()}
        colour="var(--color-info)"
      />

      {/* V3 top scorelines */}
      {v3?.topScores?.length > 0 && (
        <div style={{
          background: 'var(--color-bg-card)',
          border: '0.5px solid #534AB7',
          borderRadius: 'var(--radius-md)',
          padding: '14px 16px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <p style={{ fontSize: 14, fontWeight: 700, color: '#3C3489', letterSpacing: '0.06em' }}>
              {t('analysis.v3topScores').toUpperCase()}
            </p>
            <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: '#EEEDFE', color: '#3C3489', border: '0.5px solid #534AB7' }}>
              V3 DC ★
            </span>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {v3.topScores.slice(0, 8).map(s => (
              <div key={s.score} style={{
                padding: '6px 12px',
                background: '#EEEDFE',
                border: '0.5px solid #534AB7',
                borderRadius: 'var(--radius-sm)',
                textAlign: 'center',
                minWidth: 64,
              }}>
                <p style={{ fontFamily: 'var(--font-display)', fontSize: 17, fontWeight: 700, color: '#3C3489' }}>{s.score}</p>
                <p style={{ fontSize: 12, color: '#534AB7' }}>{(s.prob * 100).toFixed(1)}%</p>
              </div>
            ))}
          </div>
        </div>
      )}

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

// Task 30 — pre-bet checklist shown before a bet confirms. Surfaces data
// freshness, composite confidence, edge floor (MT23) and odds drift, then a
// single confirm. Non-blocking: warnings inform, confirm always available.
function PreBetChecklist({ t, label, oc, freshHrs, composite, snapshotOdds, currentOdds, onConfirm, onCancel }) {
  const staleH = freshHrs == null ? null : Math.round(freshHrs)
  const checks = [
    freshHrs != null && freshHrs > 24
      ? { ok: false, msg: t('check.stale', { h: staleH }) }
      : { ok: true, msg: t('check.fresh', { h: staleH ?? '—' }) },
    composite != null && composite < 50
      ? { ok: false, msg: t('check.lowConf', { n: composite }) }
      : { ok: true, msg: t('check.confOk', { n: composite ?? '—' }) },
    !oc.ev?.recommend
      ? { ok: false, msg: t('check.lowEdge', { e: oc.ev?.edgeDisplay || '—' }) }
      : { ok: true, msg: t('check.edgeOk', { e: oc.ev?.edgeDisplay }) },
    snapshotOdds != null && currentOdds !== snapshotOdds
      ? { ok: false, msg: t('check.drift', { from: snapshotOdds, to: currentOdds }) }
      : { ok: true, msg: t('check.noDrift', { to: currentOdds }) },
  ]
  const allClear = checks.every(c => c.ok)

  return (
    <div onClick={onCancel} style={{
      position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(0,0,0,0.6)',
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: 'var(--color-bg-card)', border: '0.5px solid var(--color-border)',
        borderRadius: 'var(--radius-lg) var(--radius-lg) 0 0', padding: '18px 16px',
        width: '100%', maxWidth: 720,
      }}>
        <p style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-text-muted)', letterSpacing: '0.06em', marginBottom: 4 }}>
          {t('check.title').toUpperCase()}
        </p>
        <p style={{ fontSize: 16, fontWeight: 700, color: 'var(--color-text-primary)', marginBottom: 12 }}>{label}</p>
        {checks.map((c, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 0', borderBottom: '0.5px solid var(--color-border)' }}>
            <span style={{ fontSize: 15 }}>{c.ok ? '✅' : '⚠️'}</span>
            <span style={{ fontSize: 14, color: c.ok ? 'var(--color-text-secondary)' : 'var(--color-warning)', fontWeight: c.ok ? 400 : 600 }}>{c.msg}</span>
          </div>
        ))}
        {allClear && (
          <p style={{ fontSize: 13, color: 'var(--color-edge-green)', fontWeight: 700, margin: '10px 0 0' }}>{t('check.allClear')}</p>
        )}
        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          <button onClick={onCancel} style={{ flex: 1, minHeight: 48, fontSize: 15, fontWeight: 700, borderRadius: 'var(--radius-sm)', background: 'transparent', color: 'var(--color-text-secondary)', border: '0.5px solid var(--color-border)', cursor: 'pointer' }}>
            {t('check.cancel')}
          </button>
          <button onClick={onConfirm} style={{ flex: 2, minHeight: 48, fontSize: 15, fontWeight: 700, borderRadius: 'var(--radius-sm)', border: 'none', cursor: 'pointer', background: allClear ? 'var(--color-accent)' : 'var(--color-warning)', color: 'var(--color-bg)' }}>
            {t('check.confirm')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Fixed odds tables ────────────────────────────────────────────────────

const TOTAL_GOALS_ODDS = [
  { n: 0, label: '0 goals',  odds: 7.00  },
  { n: 1, label: '1 goal',   odds: 4.10  },
  { n: 2, label: '2 goals',  odds: 3.10  },
  { n: 3, label: '3 goals',  odds: 4.25  },
  { n: 4, label: '4 goals',  odds: 7.35  },
  { n: 5, label: '5 goals',  odds: 15.50 },
  { n: 6, label: '6 goals',  odds: 27.00 },
]

const CS_FIXED_ODDS = {
  '1-0': 6.85,  '0-1': 8.75,
  '2-0': 10.50, '0-2': 17.50,
  '2-1': 8.00,  '1-2': 10.50,
  '1-1': 5.15,
  '3-0': 28.00, '0-3': 60.00,
  '3-1': 20.00, '1-3': 35.00,
  '3-2': 33.00, '2-3': 45.00,
  '2-2': 13.00,
  '4-0': 100.00, '0-4': 250.00,
  '4-1': 70.00,  '1-4': 175.00,
  '5-0': 300.00, '0-5': 500.00,
}

// Display order: home wins, away wins, draws — mirrors the bookmaker coupon layout
const CS_ROWS_DEF = [
  { score: '1-0', h:1, a:0 }, { score: '2-1', h:2, a:1 }, { score: '2-0', h:2, a:0 },
  { score: '3-1', h:3, a:1 }, { score: '3-0', h:3, a:0 }, { score: '3-2', h:3, a:2 },
  { score: '4-0', h:4, a:0 }, { score: '4-1', h:4, a:1 }, { score: '4-2', h:4, a:2 },
  { score: '5-0', h:5, a:0 },
  { score: '0-1', h:0, a:1 }, { score: '1-2', h:1, a:2 }, { score: '0-2', h:0, a:2 },
  { score: '1-3', h:1, a:3 }, { score: '0-3', h:0, a:3 }, { score: '2-3', h:2, a:3 },
  { score: '0-4', h:0, a:4 }, { score: '1-4', h:1, a:4 }, { score: '2-4', h:2, a:4 },
  { score: '0-5', h:0, a:5 },
  { score: '1-1', h:1, a:1 }, { score: '2-2', h:2, a:2 }, { score: '3-3', h:3, a:3 },
]

// Sum matrix cells where home + away = n goals exactly
function exactGoalsProb(n, matrix) {
  let p = 0
  for (let i = 0; i <= n && i < matrix.length; i++) {
    const j = n - i
    if (matrix[i] && j < matrix[i].length) p += matrix[i][j]
  }
  return p
}

// Edge vs fixed odds (no vig strip — single-outcome market)
function fixedEdge(modelProb, odds) {
  if (!odds || !(odds > 1)) return null
  const implied = 1 / odds
  const edge    = (modelProb - implied) / implied
  const edgePct = edge * 100
  return { odds, implied, edgePct, colour: edgePct >= 10 ? 'green' : edgePct >= 5 ? 'amber' : 'red' }
}

// Fixed odds betting — total goals (exact) + correct score
function CorrectScoreSection({ model, match }) {
  const [csFilter, setCsFilter] = useState('all')
  const [csBudget, setCsBudget] = useState('')
  const [placed,   setPlaced]   = useState({})    // { "tg_0": true, "cs_1-0": true }
  const [pending,  setPending]  = useState(null)  // key awaiting inline OK/✕

  const budget    = parseFloat(csBudget)
  const hasBudget = budget > 0

  function kellyAmt(modelProb, odds) {
    if (!hasBudget || !odds) return null
    const st = calcStake(modelProb, odds)
    return st.fraction > 0 ? st.fraction * budget : null
  }

  const tgRows = useMemo(() => {
    if (!model) return []
    return TOTAL_GOALS_ODDS.map(({ n, label, odds }) => ({
      key: `tg_${n}`, label, odds,
      v1p: exactGoalsProb(n, model.v1.matrix),
      v2p: exactGoalsProb(n, model.v2.matrix),
    }))
  }, [model])

  const allCsRows = useMemo(() => {
    if (!model) return []
    return CS_ROWS_DEF.map(({ score, h, a }) => ({
      key: `cs_${score}`, score, h, a,
      odds: CS_FIXED_ODDS[score] ?? null,
      v1p: (h <= SCORE_MAX && a <= SCORE_MAX) ? model.v1.matrix[h][a] : 0,
      v2p: (h <= SCORE_MAX && a <= SCORE_MAX) ? model.v2.matrix[h][a] : 0,
    }))
  }, [model])

  const csRows = useMemo(() => allCsRows.filter(({ h, a }) => {
    if (csFilter === 'home') return h > a
    if (csFilter === 'away') return a > h
    if (csFilter === 'draw') return h === a
    return true
  }), [allCsRows, csFilter])

  const summary = useMemo(() => {
    if (!hasBudget) return null
    let totalStake = 0, totalReturn = 0
    for (const r of [...tgRows, ...allCsRows]) {
      const info = fixedEdge(r.v1p, r.odds)
      if (!info || info.edgePct < 10) continue
      const st = calcStake(r.v1p, r.odds)
      if (!(st.fraction > 0)) continue
      const stake = st.fraction * budget
      totalStake  += stake
      totalReturn += stake * r.v1p * r.odds
    }
    if (totalStake === 0) return null
    return { totalStake, totalReturn, profit: totalReturn - totalStake }
  }, [tgRows, allCsRows, csBudget])

  const doPlace = async (key, betType, selection, modelProb, odds) => {
    const amt = kellyAmt(modelProb, odds)
    if (!amt) return
    setPending(null)
    try {
      await placeBet({ matchId: match.id, betType, selection, odds, stake: Math.round(amt) })
      setPlaced(p => ({ ...p, [key]: true }))
    } catch {
      setPlaced(p => ({ ...p, [key]: 'error' }))
    }
  }

  const th = { padding: '6px 8px', fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', color: 'var(--color-text-muted)', background: 'var(--color-bg-elevated)', borderBottom: '0.5px solid var(--color-border)', whiteSpace: 'nowrap', textAlign: 'center' }
  const td = { padding: '6px 8px', fontSize: 13, textAlign: 'center', borderBottom: '0.5px solid var(--color-border)', whiteSpace: 'nowrap' }
  const ecol = (c) => EDGE_COLOURS[c] || 'var(--color-text-muted)'
  const chip = (active) => ({ minHeight: 28, padding: '0 10px', borderRadius: 'var(--radius-full)', border: active ? '0.5px solid var(--color-accent-border)' : '0.5px solid var(--color-border)', background: active ? 'var(--color-accent-dim)' : 'transparent', color: active ? 'var(--color-accent)' : 'var(--color-text-secondary)', fontSize: 11, fontWeight: active ? 600 : 400, cursor: 'pointer', fontFamily: 'var(--font-ui)' })

  // Called as a function (not a component) — no hooks, safe to call inside render
  function renderRow(r, betType, label) {
    const info  = fixedEdge(r.v1p, r.odds)
    const stake = kellyAmt(r.v1p, r.odds)
    const green = info?.colour === 'green'
    const col   = info ? ecol(info.colour) : 'var(--color-text-muted)'
    const canBet = stake && !placed[r.key]
    return (
      <tr key={r.key} style={{ background: green ? 'rgba(45,122,79,0.06)' : 'transparent' }}>
        <td style={{ ...td, textAlign: 'left', paddingLeft: 10, fontWeight: 700, fontSize: 14, color: 'var(--color-text-primary)' }}>
          {label}{green && <span style={{ marginLeft: 5, fontSize: 10, color: EDGE_COLOURS.green }}>★</span>}
        </td>
        <td style={{ ...td, fontWeight: 600, color: 'var(--color-text-secondary)' }}>
          {r.odds ? r.odds.toFixed(2) : <span style={{ color: 'var(--color-text-muted)' }}>—</span>}
        </td>
        <td style={{ ...td, color: 'var(--color-accent)', fontWeight: 600 }}>{(r.v1p * 100).toFixed(1)}%</td>
        <td style={{ ...td, color: 'var(--color-info)' }}>{(r.v2p * 100).toFixed(1)}%</td>
        <td style={{ ...td, color: 'var(--color-text-secondary)' }}>{info ? `${(info.implied * 100).toFixed(1)}%` : '—'}</td>
        <td style={td}>
          {info ? (
            <span style={{ fontSize: 11, fontWeight: 700, color: col, padding: '2px 6px', borderRadius: 'var(--radius-full)', background: `${col}22`, border: `0.5px solid ${col}` }}>
              {info.edgePct >= 0 ? '+' : ''}{info.edgePct.toFixed(1)}%
            </span>
          ) : '—'}
        </td>
        {hasBudget && (
          <td style={{ ...td, fontWeight: stake ? 600 : 400, color: 'var(--color-text-primary)' }}>
            {stake ? `¥${Math.round(stake).toLocaleString()}` : '—'}
          </td>
        )}
        <td style={td}>
          {placed[r.key] === true ? (
            <span style={{ fontSize: 13, color: EDGE_COLOURS.green, fontWeight: 700 }}>✓</span>
          ) : pending === r.key ? (
            <div style={{ display: 'flex', gap: 3 }}>
              <button onClick={() => doPlace(r.key, betType, label, r.v1p, r.odds)} style={{ minHeight: 26, padding: '0 7px', fontSize: 11, fontWeight: 700, borderRadius: 'var(--radius-sm)', border: 'none', background: EDGE_COLOURS.green, color: '#fff', cursor: 'pointer' }}>OK</button>
              <button onClick={() => setPending(null)} style={{ minHeight: 26, padding: '0 6px', fontSize: 11, borderRadius: 'var(--radius-sm)', border: '0.5px solid var(--color-border)', background: 'transparent', color: 'var(--color-text-muted)', cursor: 'pointer' }}>✕</button>
            </div>
          ) : (
            <button disabled={!canBet} onClick={() => canBet && setPending(r.key)}
              style={{ minHeight: 26, padding: '0 8px', fontSize: 12, fontWeight: 700, borderRadius: 'var(--radius-sm)', border: 'none', cursor: canBet ? 'pointer' : 'not-allowed', background: canBet ? 'var(--color-accent)' : 'transparent', color: canBet ? 'var(--color-bg)' : 'var(--color-text-muted)', opacity: canBet ? 1 : 0.35 }}>
              {placed[r.key] === 'error' ? 'Retry' : 'Bet'}
            </button>
          )}
        </td>
      </tr>
    )
  }

  function tableHead(firstCol) {
    return (
      <thead>
        <tr>
          <th style={{ ...th, textAlign: 'left', paddingLeft: 10 }}>{firstCol}</th>
          <th style={th}>Fixed odds</th>
          <th style={th}>V1%</th>
          <th style={th}>V2%</th>
          <th style={th}>Impl%</th>
          <th style={th}>Edge</th>
          {hasBudget && <th style={th}>Stake ¥</th>}
          <th style={th}>Bet</th>
        </tr>
      </thead>
    )
  }

  return (
    <div style={{ background: 'var(--color-bg-card)', border: '0.5px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '14px 16px' }}>
      {/* Header + budget */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
        <p style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-text-muted)', letterSpacing: '0.06em' }}>FIXED ODDS BETTING</p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <label style={{ fontSize: 12, color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>Budget ¥</label>
          <input type="number" inputMode="decimal" min="0" placeholder="10000" value={csBudget} onChange={e => setCsBudget(e.target.value)}
            style={{ width: 100, fontSize: 13, minHeight: 30, padding: '0 8px', borderRadius: 'var(--radius-sm)', background: 'var(--color-bg)', color: 'var(--color-text-primary)', border: '0.5px solid var(--color-border-active)' }} />
          {hasBudget && <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>¼ Kelly · 5% cap (MT24)</span>}
        </div>
      </div>

      {/* Section 1: Total Goals */}
      <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-muted)', letterSpacing: '0.06em', marginBottom: 8 }}>TOTAL GOALS (EXACTLY)</p>
      <div style={{ overflowX: 'auto', marginBottom: 16 }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 440 }}>
          {tableHead('Total goals')}
          <tbody>{tgRows.map(r => renderRow(r, 'total_goals', r.label))}</tbody>
        </table>
      </div>

      <div style={{ height: 1, background: 'var(--color-border)', margin: '0 0 14px' }} />

      {/* Section 2: Correct Score */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
        <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-muted)', letterSpacing: '0.06em' }}>CORRECT SCORE</p>
        {[{ key: 'all', label: 'All' }, { key: 'home', label: 'Home wins' }, { key: 'away', label: 'Away wins' }, { key: 'draw', label: 'Draws' }].map(f => (
          <button key={f.key} onClick={() => setCsFilter(f.key)} style={chip(csFilter === f.key)}>{f.label}</button>
        ))}
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 440 }}>
          {tableHead('Score')}
          <tbody>{csRows.map(r => renderRow(r, 'correct_score', r.score))}</tbody>
        </table>
      </div>

      {/* Summary */}
      {summary && (
        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', marginTop: 12, padding: '10px 12px', background: 'var(--color-bg-elevated)', borderRadius: 'var(--radius-sm)' }}>
          <span style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>Total staked: <strong style={{ color: 'var(--color-text-primary)' }}>¥{Math.round(summary.totalStake).toLocaleString()}</strong></span>
          <span style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>Exp. return: <strong style={{ color: 'var(--color-text-primary)' }}>¥{Math.round(summary.totalReturn).toLocaleString()}</strong></span>
          <span style={{ fontSize: 13, fontWeight: 700, color: summary.profit >= 0 ? EDGE_COLOURS.green : EDGE_COLOURS.red }}>
            Exp. profit: {summary.profit >= 0 ? '+' : ''}¥{Math.round(summary.profit).toLocaleString()}
          </span>
        </div>
      )}

      {/* Legend */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
        {[{ c: EDGE_COLOURS.green, l: '≥ 10% — Bet' }, { c: EDGE_COLOURS.amber, l: '5–9.9% — Marginal' }, { c: EDGE_COLOURS.red, l: '< 5% — Skip' }].map(({ c, l }) => (
          <span key={l} style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 'var(--radius-full)', background: `${c}22`, color: c, border: `0.5px solid ${c}` }}>{l}</span>
        ))}
      </div>
    </div>
  )
}

// Value tab — model probabilities + bookmaker odds entry → EV/edge per outcome
function TabValue({ stats, match, odds, setOdds }) {
  const { t } = useTranslation()
  const model = useMemo(() => {
    if (!stats?.home || !stats?.away) return null
    try { return runModels(stats.home, stats.away, { venue: match?.venue, city: match?.city, homeTeam: match?.home_team, awayTeam: match?.away_team }) } catch { return null }
  }, [stats, match])

  const [stake, setStake] = useState('')
  const [placed, setPlaced] = useState({})
  const [pending, setPending] = useState(null)   // outcome key awaiting checklist confirm
  const [useV3, setUseV3] = useState(true)   // default to V3 as recommended

  // Composite confidence (Role 10) — null until analysis run; drives Task 30 warning
  const [composite, setComposite] = useState(null)
  // Odds snapshot per outcome, captured when the bet is selected — for drift check
  const [oddsSnap, setOddsSnap] = useState({})
  useEffect(() => {
    if (!match?.id) return
    supabase.from('role_outputs').select('output_json, ai_roles(role_number)').eq('match_id', match.id)
      .then(({ data }) => {
        const r10 = data?.find(o => o.ai_roles?.role_number === 10)
        if (!r10) return
        let json = r10.output_json
        if (typeof json === 'string') { try { json = JSON.parse(json.replace(/```json\n?|\n?```/g, '').trim()) } catch { json = null } }
        if (json?.confidence != null) setComposite(Math.round(json.confidence * 100))
      })
  }, [match?.id])

  // Stale by oldest of the two teams' updated_at; null if unknown
  const freshHrs = useMemo(() => {
    const ts = [stats?.home?.updated_at, stats?.away?.updated_at].filter(Boolean).map(d => new Date(d).getTime())
    if (!ts.length) return null
    return (Date.now() - Math.min(...ts)) / 3_600_000
  }, [stats])

  const requestPlace = (key) => {
    if (!(parseFloat(stake) > 0)) return
    setPending(key)
  }
  const place = async (key) => {
    const amt = parseFloat(stake)
    if (!(amt > 0)) return
    setPending(null)
    try {
      await placeBet({ matchId: match.id, betType: '1X2', selection: key, odds: parseFloat(odds[key]), stake: amt })
      setPlaced(p => ({ ...p, [key]: true }))
    } catch { setPlaced(p => ({ ...p, [key]: 'error' })) }
  }
  const ev1x2 = useMemo(() => {
    if (!model) return null
    const o = { home: parseFloat(odds.home), draw: parseFloat(odds.draw), away: parseFloat(odds.away) }
    if (![o.home, o.draw, o.away].every(v => v > 1)) return null
    const probs = (useV3 && model.v3) ? model.v3.probs : model.v2.probs
    try { return analyse1X2(probs, o) } catch { return null }
  }, [model, odds, useV3])

  // Capture the odds at first valid EV as the drift baseline ("last fetch")
  useEffect(() => {
    if (ev1x2 && !Object.keys(oddsSnap).length) setOddsSnap({ ...odds })
  }, [ev1x2, odds, oddsSnap])

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
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
              <p style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-text-muted)', letterSpacing: '0.06em' }}>
                MODEL PROBABILITIES
              </p>
              {/* V2 / V3 toggle */}
              <div style={{ display: 'flex', gap: 4 }}>
                <button
                  onClick={() => setUseV3(false)}
                  style={{
                    minHeight: 30, padding: '0 10px', fontSize: 12, fontWeight: useV3 ? 400 : 700,
                    borderRadius: 'var(--radius-sm)',
                    background: useV3 ? 'transparent' : 'rgba(56,120,180,0.12)',
                    border: `0.5px solid ${useV3 ? 'var(--color-border)' : 'var(--color-info)'}`,
                    color: useV3 ? 'var(--color-text-muted)' : 'var(--color-info)',
                    cursor: 'pointer', fontFamily: 'var(--font-ui)',
                  }}
                >V2</button>
                <button
                  onClick={() => setUseV3(true)}
                  style={{
                    minHeight: 30, padding: '0 10px', fontSize: 12, fontWeight: useV3 ? 700 : 400,
                    borderRadius: 'var(--radius-sm)',
                    background: useV3 ? '#EEEDFE' : 'transparent',
                    border: `0.5px solid ${useV3 ? '#534AB7' : 'var(--color-border)'}`,
                    color: useV3 ? '#3C3489' : 'var(--color-text-muted)',
                    cursor: model?.v3 ? 'pointer' : 'not-allowed',
                    opacity: model?.v3 ? 1 : 0.4,
                    fontFamily: 'var(--font-ui)',
                  }}
                  disabled={!model?.v3}
                >V3 ★</button>
              </div>
            </div>
            {useV3 && model?.v3 && (
              <p style={{ fontSize: 12, color: '#534AB7', marginBottom: 10, fontStyle: 'italic' }}>
                {t('analysis.usingV3')}
              </p>
            )}
            {!useV3 && (
              <p style={{ fontSize: 12, color: 'var(--color-info)', marginBottom: 10, fontStyle: 'italic' }}>
                {t('analysis.usingV2')}
              </p>
            )}
            {['home', 'draw', 'away'].map(key => {
              const v3p = model?.v3?.probs?.[key]
              const v2p = model?.v2?.probs?.[key]
              const activeProb = (useV3 && v3p != null) ? v3p : v2p
              return (
                <div key={key} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  marginBottom: 10,
                }}>
                  <span style={{ fontSize: 15, color: 'var(--color-text-primary)' }}>
                    {OUTCOME_LABELS[key]}
                  </span>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <span style={{ fontSize: 14, color: 'var(--color-text-muted)' }}>
                      V1 {formatProb(model.v1.probs[key])}
                    </span>
                    <span style={{ fontSize: 14, color: 'var(--color-info)' }}>
                      V2 {formatProb(v2p)}
                    </span>
                    {v3p != null && (
                      <span style={{
                        fontSize: 16, fontWeight: 700, color: '#3C3489',
                        fontFamily: 'var(--font-display)',
                        background: '#EEEDFE', padding: '1px 8px',
                        borderRadius: 'var(--radius-sm)',
                        border: '0.5px solid #534AB7',
                      }}>
                        V3 {formatProb(v3p)}
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
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
          {t('value.odds').toUpperCase()}
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
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10, alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-text-muted)', letterSpacing: '0.06em' }}>
              {t('value.ev').toUpperCase()}
            </span>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {useV3 && model?.v3 && (
                <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: '#EEEDFE', color: '#3C3489', border: '0.5px solid #534AB7' }}>
                  V3 DC ★
                </span>
              )}
              <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>vig {(ev1x2.vig.vigPct).toFixed(1)}%</span>
            </div>
          </div>
          <input type="number" inputMode="decimal" min="0" placeholder={t('value.stake')} value={stake}
            onChange={e => setStake(e.target.value)}
            style={{ width: '100%', fontSize: 16, minHeight: 44, padding: '0 12px', marginBottom: 8, borderRadius: 'var(--radius-sm)', background: 'var(--color-bg)', color: 'var(--color-text-primary)', border: '0.5px solid var(--color-border-active)' }} />
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
                  <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>{t('value.fair')} {oc.fairOdds.toFixed(2)}</span>
                  <span style={{
                    fontSize: 14, fontWeight: 700, color: col,
                    padding: '2px 8px', borderRadius: 'var(--radius-full)', background: `${col}22`,
                  }}>{oc.ev?.edgeDisplay}</span>
                  <button onClick={() => requestPlace(key)} disabled={!(parseFloat(stake) > 0) || placed[key] === true}
                    style={{ minHeight: 36, padding: '0 10px', fontSize: 13, fontWeight: 700, borderRadius: 'var(--radius-sm)', border: 'none', cursor: 'pointer',
                      background: placed[key] === true ? 'var(--color-bg-hover)' : 'var(--color-accent)', color: placed[key] === true ? 'var(--color-text-muted)' : 'var(--color-bg)' }}>
                    {placed[key] === true ? t('value.placed') : placed[key] === 'error' ? t('value.retry') : t('value.place')}
                  </button>
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

      {/* Task 30 — pre-bet checklist before confirm */}
      {pending && ev1x2 && (
        <PreBetChecklist
          t={t}
          label={`${OUTCOME_LABELS[pending]} @ ${odds[pending]} · ¥${stake}`}
          oc={ev1x2.outcomes[pending]}
          freshHrs={freshHrs}
          composite={composite}
          snapshotOdds={oddsSnap[pending]}
          currentOdds={odds[pending]}
          onConfirm={() => place(pending)}
          onCancel={() => setPending(null)}
        />
      )}

    </div>
  )
}

// ── Asian handicap / total-goals helpers ──────────────────────────────────────

const AH_LINES = [
  { val:  4,    label: '+4'     }, { val:  3.75, label: '+3.3/4' },
  { val:  3.5,  label: '+3.1/2' }, { val:  3.25, label: '+3.1/4' },
  { val:  3,    label: '+3'     }, { val:  2.75, label: '+2.3/4' },
  { val:  2.5,  label: '+2.1/2' }, { val:  2.25, label: '+2.1/4' },
  { val:  2,    label: '+2'     }, { val:  1.75, label: '+1.3/4' },
  { val:  1.5,  label: '+1.1/2' }, { val:  1.25, label: '+1.1/4' },
  { val:  1,    label: '+1'     }, { val:  0.75, label: '+3/4'   },
  { val:  0.5,  label: '+1/2'  }, { val:  0.25, label: '+1/4'   },
  { val:  0,    label: '0'     }, { val: -0.25,  label: '-1/4'   },
  { val: -0.5,  label: '-1/2'  }, { val: -0.75,  label: '-3/4'   },
  { val: -1,    label: '-1'    }, { val: -1.25,  label: '-1.1/4' },
  { val: -1.5,  label: '-1.1/2' }, { val: -1.75, label: '-1.3/4' },
  { val: -2,    label: '-2'    }, { val: -2.25,  label: '-2.1/4' },
  { val: -2.5,  label: '-2.1/2' }, { val: -2.75, label: '-2.3/4' },
  { val: -3,    label: '-3'    }, { val: -3.25,  label: '-3.1/4' },
  { val: -3.5,  label: '-3.1/2' }, { val: -3.75, label: '-3.3/4' },
  { val: -4,    label: '-4'    },
]

const TG_LINES = [
  { val: 1,    label: '1'     }, { val: 1.25, label: '1.1/4' },
  { val: 1.5,  label: '1.1/2' }, { val: 1.75, label: '1.3/4' },
  { val: 2,    label: '2'     }, { val: 2.25, label: '2.1/4' },
  { val: 2.5,  label: '2.1/2' }, { val: 2.75, label: '2.3/4' },
  { val: 3,    label: '3'     }, { val: 3.25, label: '3.1/4' },
  { val: 3.5,  label: '3.1/2' }, { val: 3.75, label: '3.3/4' },
  { val: 4,    label: '4'     }, { val: 4.25, label: '4.1/4' },
  { val: 4.5,  label: '4.1/2' }, { val: 4.75, label: '4.3/4' },
  { val: 5,    label: '5'     }, { val: 5.5,  label: '5.1/2' },
]

function isQtrLine(line) { return Math.round(Math.abs(line) * 4) % 2 === 1 }
function ahModToDecimal(mod) { return (100 + mod) / 100 + 1 }
function ahCompanion(mod) { return 200 / (100 + mod) }

function singleAHResult(h, a, line) {
  const adj = h + line
  if (Math.abs(adj - a) < 0.0001) return 'push'
  return adj > a ? 'home' : 'away'
}

function ahCoverResult(h, a, line) {
  if (!isQtrLine(line)) return singleAHResult(h, a, line)
  const r1 = singleAHResult(h, a, line - 0.25)
  const r2 = singleAHResult(h, a, line + 0.25)
  if (r1 === r2) return r1
  if (r1 === 'push' || r2 === 'push') {
    const other = r1 === 'push' ? r2 : r1
    return other === 'home' ? 'home_half' : 'away_half'
  }
  return 'split'
}

function calcAHLine(matrix, line) {
  const N = matrix.length
  let pHome = 0, pAway = 0, pPush = 0
  for (let i = 0; i < N; i++)
    for (let j = 0; j < N; j++) {
      const r = singleAHResult(i, j, line), p = matrix[i][j]
      if (r === 'home') pHome += p
      else if (r === 'away') pAway += p
      else pPush += p
    }
  return { pHome, pAway, pPush }
}

function calcAHProbs(matrix, line) {
  if (!isQtrLine(line)) return calcAHLine(matrix, line)
  const r1 = calcAHLine(matrix, line - 0.25)
  const r2 = calcAHLine(matrix, line + 0.25)
  return { pHome: (r1.pHome + r2.pHome) / 2, pAway: (r1.pAway + r2.pAway) / 2, pPush: (r1.pPush + r2.pPush) / 2 }
}

function singleTGResult(total, line) {
  if (total === line) return 'push'
  return total > line ? 'over' : 'under'
}

function tgCoverResult(total, line) {
  if (!isQtrLine(line)) return singleTGResult(total, line)
  const r1 = singleTGResult(total, line - 0.25)
  const r2 = singleTGResult(total, line + 0.25)
  if (r1 === r2) return r1
  if (r1 === 'push' || r2 === 'push') {
    const other = r1 === 'push' ? r2 : r1
    return other === 'over' ? 'over_half' : 'under_half'
  }
  return 'split'
}

function calcTGLine(matrix, line) {
  const N = matrix.length
  let pOver = 0, pUnder = 0, pPush = 0
  for (let i = 0; i < N; i++)
    for (let j = 0; j < N; j++) {
      const r = singleTGResult(i + j, line), p = matrix[i][j]
      if (r === 'over') pOver += p
      else if (r === 'under') pUnder += p
      else pPush += p
    }
  return { pOver, pUnder, pPush }
}

function calcTGProbs(matrix, line) {
  if (!isQtrLine(line)) return calcTGLine(matrix, line)
  const r1 = calcTGLine(matrix, line - 0.25)
  const r2 = calcTGLine(matrix, line + 0.25)
  return { pOver: (r1.pOver + r2.pOver) / 2, pUnder: (r1.pUnder + r2.pUnder) / 2, pPush: (r1.pPush + r2.pPush) / 2 }
}

function topScorelines(matrix, n = 8) {
  const N = matrix.length, rows = []
  for (let i = 0; i < N; i++)
    for (let j = 0; j < N; j++)
      rows.push({ h: i, a: j, p: matrix[i][j] })
  return rows.sort((a, b) => b.p - a.p).slice(0, n)
}

// ── Chinese Handicap 1X2 (让球胜平负) ──────────────────────────────────────

function ChineseHandicapSection({ model, homeTeam, awayTeam }) {
  const CH_LINES = [-3, -2, -1, 0, 1, 2, 3]
  const [line, setLine] = useState(-1)
  const [oddsH, setOddsH] = useState('')
  const [oddsD, setOddsD] = useState('')
  const [oddsA, setOddsA] = useState('')

  const cardStyle = { background: 'var(--color-bg-card)', border: '0.5px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '14px 16px' }
  const SH = { fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--color-accent)', textTransform: 'uppercase', borderBottom: '1px solid var(--color-accent)', paddingBottom: 6, marginBottom: 14, display: 'block' }
  const inp = { textAlign: 'center', padding: '4px 6px', fontSize: 16, minHeight: 44, border: '0.5px solid var(--color-border)', borderRadius: 4, background: 'var(--color-bg)', color: 'var(--color-text-primary)', fontFamily: "'IBM Plex Mono', monospace" }

  const matrix = model?.v2?.matrix
  let probs = null
  if (matrix) {
    const N = matrix.length
    let pH = 0, pD = 0, pA = 0
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        const diff = i - j
        if (diff > -line) pH += matrix[i][j]
        else if (diff === -line) pD += matrix[i][j]
        else pA += matrix[i][j]
      }
    }
    probs = { pH, pD, pA }
  }

  function edge(p, oddsStr) {
    const o = parseFloat(oddsStr)
    if (!o || !p || o <= 1) return null
    return (p - 1 / o) / (1 / o) * 100
  }

  function EdgeBadge({ e }) {
    if (e == null) return null
    const bg = e >= 5 ? '#EAF3DE' : e >= 0 ? '#FAEEDA' : '#FCEBEB'
    const col = e >= 5 ? '#27500A' : e >= 0 ? '#633806' : '#791F1F'
    return <span style={{ fontSize: 11, fontWeight: 700, padding: '1px 6px', borderRadius: 4, background: bg, color: col }}>{e >= 0 ? '+' : ''}{e.toFixed(1)}%</span>
  }

  const lineLabel = line > 0 ? `主让${line}球` : line < 0 ? `客让${-line}球` : '平手'
  const thS = { padding: '5px 8px', fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--color-text-muted)', background: 'var(--color-bg-elevated)', borderBottom: '0.5px solid var(--color-border)', whiteSpace: 'nowrap' }
  const tdS = { padding: '8px 8px', fontSize: 12, borderBottom: '0.5px solid var(--color-border)' }

  return (
    <div style={cardStyle}>
      <span style={SH}>让球胜平负 · Chinese Handicap 1X2</span>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 16 }}>
        <label style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>让球盘口：</label>
        <select value={line} onChange={e => setLine(Number(e.target.value))}
          style={{ fontSize: 16, minHeight: 44, padding: '0 8px', borderRadius: 'var(--radius-sm)', background: 'var(--color-bg)', color: 'var(--color-text-primary)', border: '0.5px solid var(--color-border-active)', cursor: 'pointer' }}>
          {CH_LINES.map(l => <option key={l} value={l}>{l > 0 ? `主让${l}` : l < 0 ? `客让${-l}` : '平手 (0)'}</option>)}
        </select>
        <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{lineLabel}</span>
      </div>
      {probs ? (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ ...thS, textAlign: 'left' }}>结果</th>
                <th style={{ ...thS, textAlign: 'center' }}>V2概率</th>
                <th style={{ ...thS, textAlign: 'center' }}>您的赔率</th>
                <th style={{ ...thS, textAlign: 'center' }}>边际</th>
              </tr>
            </thead>
            <tbody>
              {[
                { label: `${homeTeam} 让球胜`, p: probs.pH, odds: oddsH, set: setOddsH },
                { label: '让球平', p: probs.pD, odds: oddsD, set: setOddsD },
                { label: `${awayTeam} 让球胜`, p: probs.pA, odds: oddsA, set: setOddsA },
              ].map(row => (
                <tr key={row.label}>
                  <td style={tdS}>{row.label}</td>
                  <td style={{ ...tdS, textAlign: 'center', fontFamily: "'IBM Plex Mono', monospace" }}>{(row.p * 100).toFixed(1)}%</td>
                  <td style={{ ...tdS, textAlign: 'center' }}>
                    <input type="number" step="0.01" min="1" max="99" value={row.odds} onChange={e => row.set(e.target.value)} placeholder="—"
                      style={{ ...inp, width: 70 }} />
                  </td>
                  <td style={{ ...tdS, textAlign: 'center' }}><EdgeBadge e={edge(row.p, row.odds)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>需要球队统计数据才能计算让球概率。</p>
      )}
    </div>
  )
}

// ── Chinese Correct Score (比分固定奖金) ────────────────────────────────────

function ChineseCorrectScoreSection({ model, homeTeam, awayTeam }) {
  const [userOdds, setUserOdds] = useState({})
  const [customH, setCustomH] = useState('')
  const [customA, setCustomA] = useState('')

  const cardStyle = { background: 'var(--color-bg-card)', border: '0.5px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '14px 16px' }
  const SH = { fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--color-accent)', textTransform: 'uppercase', borderBottom: '1px solid var(--color-accent)', paddingBottom: 6, marginBottom: 14, display: 'block' }
  const inp = { textAlign: 'center', padding: '4px 6px', fontSize: 16, minHeight: 44, border: '0.5px solid var(--color-border)', borderRadius: 4, background: 'var(--color-bg)', color: 'var(--color-text-primary)', fontFamily: "'IBM Plex Mono', monospace" }

  const matrix = model?.v2?.matrix
  const top12 = matrix ? topScorelines(matrix, 12) : []

  const cH = parseInt(customH), cA = parseInt(customA)
  const hasCustom = customH !== '' && customA !== '' && !isNaN(cH) && !isNaN(cA)
  const customInTop = top12.some(s => s.h === cH && s.a === cA)
  const customP = hasCustom && matrix && cH < matrix.length && cA < (matrix[cH]?.length || 0) ? matrix[cH][cA] : null
  const allLines = hasCustom && !customInTop ? [...top12, { h: cH, a: cA, p: customP || 0 }] : top12

  function edge(p, oddsStr) {
    const o = parseFloat(oddsStr)
    if (!o || !p || o <= 1) return null
    return (p - 1 / o) / (1 / o) * 100
  }

  function EdgeBadge({ e }) {
    if (e == null) return null
    const bg = e >= 5 ? '#EAF3DE' : e >= 0 ? '#FAEEDA' : '#FCEBEB'
    const col = e >= 5 ? '#27500A' : e >= 0 ? '#633806' : '#791F1F'
    return <span style={{ fontSize: 11, fontWeight: 700, padding: '1px 6px', borderRadius: 4, background: bg, color: col }}>{e >= 0 ? '+' : ''}{e.toFixed(1)}%</span>
  }

  const thS = { padding: '5px 8px', fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--color-text-muted)', background: 'var(--color-bg-elevated)', borderBottom: '0.5px solid var(--color-border)', whiteSpace: 'nowrap' }
  const tdS = { padding: '7px 8px', fontSize: 12, borderBottom: '0.5px solid var(--color-border)' }

  if (allLines.length === 0) return null

  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 }}>
        <span style={SH}>比分固定奖金 · Chinese Correct Score</span>
        <button onClick={() => setUserOdds({})}
          style={{ fontSize: 11, color: 'var(--color-text-muted)', background: 'none', border: '0.5px solid var(--color-border)', borderRadius: 4, padding: '3px 8px', cursor: 'pointer', minHeight: 30, fontFamily: 'var(--font-ui)', marginBottom: 14 }}>
          清空赔率
        </button>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={{ ...thS, textAlign: 'left' }}>比分</th>
              <th style={{ ...thS, textAlign: 'center' }}>V2概率</th>
              <th style={{ ...thS, textAlign: 'center' }}>彩票赔率</th>
              <th style={{ ...thS, textAlign: 'center' }}>边际</th>
            </tr>
          </thead>
          <tbody>
            {allLines.map(s => {
              const key = `${s.h}:${s.a}`
              const odds = userOdds[key] || ''
              const e = edge(s.p, odds)
              return (
                <tr key={key} style={{ background: e != null && e >= 5 ? '#EAF3DE22' : undefined }}>
                  <td style={{ ...tdS, fontFamily: "'IBM Plex Mono', monospace", fontWeight: e != null && e >= 5 ? 700 : 400 }}>
                    {homeTeam.slice(0, 3)} {s.h}:{s.a} {awayTeam.slice(0, 3)}
                  </td>
                  <td style={{ ...tdS, textAlign: 'center', fontFamily: "'IBM Plex Mono', monospace" }}>{(s.p * 100).toFixed(2)}%</td>
                  <td style={{ ...tdS, textAlign: 'center' }}>
                    <input type="number" step="1" min="1" value={odds} onChange={ev => setUserOdds(p => ({ ...p, [key]: ev.target.value }))} placeholder="—"
                      style={{ ...inp, width: 70 }} />
                  </td>
                  <td style={{ ...tdS, textAlign: 'center' }}><EdgeBadge e={e} /></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>自定义比分：</span>
        <input type="number" min="0" max="20" value={customH} onChange={e => setCustomH(e.target.value)} placeholder="主"
          style={{ ...inp, width: 50 }} />
        <span style={{ color: 'var(--color-text-muted)' }}>:</span>
        <input type="number" min="0" max="20" value={customA} onChange={e => setCustomA(e.target.value)} placeholder="客"
          style={{ ...inp, width: 50 }} />
        {customP != null && <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>V2概率: {(customP * 100).toFixed(2)}%</span>}
      </div>
    </div>
  )
}

// ── Asian tab ─────────────────────────────────────────────────────────────────

function TabAsian({ stats, match }) {
  const model = useMemo(() => {
    if (!stats?.home || !stats?.away) return null
    try { return runModels(stats.home, stats.away, { venue: match?.venue, city: match?.city, homeTeam: match?.home_team, awayTeam: match?.away_team }) } catch { return null }
  }, [stats, match])

  const [ahLine,    setAhLine]    = useState(-0.5)
  const [ahMod,     setAhMod]     = useState(0)
  const [ahModSide, setAhModSide] = useState('away')   // 'home' | 'away'
  const [tgLine,    setTgLine]    = useState(2.5)
  const [tgMod,     setTgMod]     = useState(0)
  const [tgModSide, setTgModSide] = useState('over')   // 'over' | 'under'
  const [budget, setBudget] = useState('')

  const bgt    = parseFloat(budget)
  const hasBgt = bgt > 0

  const ah       = useMemo(() => model ? calcAHProbs(model.v2.matrix, ahLine) : null, [model, ahLine])
  const homeDec  = ahModSide === 'home' ? ahModToDecimal(ahMod) : ahCompanion(ahMod)
  const awayDec  = ahModSide === 'away' ? ahModToDecimal(ahMod) : ahCompanion(ahMod)
  const ahHomeStake = (hasBgt && ah) ? calcStake(ah.pHome, homeDec) : null
  const ahAwayStake = (hasBgt && ah) ? calcStake(ah.pAway, awayDec) : null

  const tg       = useMemo(() => model ? calcTGProbs(model.v2.matrix, tgLine) : null, [model, tgLine])
  const overDec  = tgModSide === 'over'  ? ahModToDecimal(tgMod) : ahCompanion(tgMod)
  const underDec = tgModSide === 'under' ? ahModToDecimal(tgMod) : ahCompanion(tgMod)
  const tgOverStake  = (hasBgt && tg) ? calcStake(tg.pOver,  overDec)  : null
  const tgUnderStake = (hasBgt && tg) ? calcStake(tg.pUnder, underDec) : null

  const topLines   = useMemo(() => model ? topScorelines(model.v2.matrix) : [], [model])
  const homeTeam   = match?.home_team || 'Home'
  const awayTeam   = match?.away_team || 'Away'
  const ahLineObj  = AH_LINES.find(l => Math.abs(l.val - ahLine) < 0.001) || { label: String(ahLine) }
  const awayAhObj  = AH_LINES.find(l => Math.abs(l.val - (-ahLine)) < 0.001) || { label: String(-ahLine) }
  const tgLineObj  = TG_LINES.find(l => Math.abs(l.val - tgLine) < 0.001) || { label: String(tgLine) }

  const cardStyle = { background: 'var(--color-bg-card)', border: '0.5px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '14px 16px' }
  const SH  = { fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--color-accent)', textTransform: 'uppercase', borderBottom: '1px solid var(--color-accent)', paddingBottom: 6, marginBottom: 14, display: 'block' }
  const sel = { fontSize: 16, minHeight: 44, padding: '0 8px', borderRadius: 'var(--radius-sm)', background: 'var(--color-bg)', color: 'var(--color-text-primary)', border: '0.5px solid var(--color-border-active)', cursor: 'pointer' }
  const th  = { padding: '5px 8px', fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--color-text-muted)', background: 'var(--color-bg-elevated)', borderBottom: '0.5px solid var(--color-border)', textAlign: 'center', whiteSpace: 'nowrap' }
  const td  = { padding: '6px 8px', fontSize: 12, borderBottom: '0.5px solid var(--color-border)', textAlign: 'center' }

  function edgeBadge(edge) {
    if (edge == null) return null
    const green = edge >= 0.05, amber = edge >= 0 && edge < 0.05
    const col = green ? EDGE_COLOURS.green : amber ? EDGE_COLOURS.amber : EDGE_COLOURS.red
    return (
      <span style={{ fontSize: 11, fontWeight: 700, color: col, padding: '2px 7px', borderRadius: 'var(--radius-full)', background: `${col}22`, border: `0.5px solid ${col}` }}>
        {edge >= 0 ? '+' : ''}{(edge * 100).toFixed(1)}% {green ? '✅ BET' : amber ? '— Marginal' : '❌ SKIP'}
      </span>
    )
  }

  function betCard(label, pWin, pPush, decimal, stakeResult) {
    const implied = decimal > 1 ? 1 / decimal : null
    const edge    = implied != null ? pWin - implied : null
    return (
      <div style={{ flex: 1, minWidth: 0, background: 'var(--color-bg-elevated)', border: '0.5px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 5 }}>
        <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text-primary)' }}>{label}</p>
        <p style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>Pays <strong>{decimal.toFixed(2)}</strong></p>
        <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-accent)' }}>Model: {(pWin * 100).toFixed(1)}%</p>
        {pPush > 0.005 && <p style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Push: {(pPush * 100).toFixed(1)}%</p>}
        {implied != null && <p style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>Implied: {(implied * 100).toFixed(1)}%</p>}
        {edgeBadge(edge)}
        {hasBgt && stakeResult?.fraction > 0 && (
          <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text-primary)' }}>Stake: ¥{Math.round(stakeResult.fraction * bgt).toLocaleString()}</p>
        )}
      </div>
    )
  }

  function ahCell(result, side) {
    const textMap = {
      home:      { home: 'HOME WIN ✅', away: 'AWAY LOSE ❌' },
      away:      { home: 'HOME LOSE ❌', away: 'AWAY WIN ✅' },
      push:      { home: 'PUSH ↔', away: 'PUSH ↔' },
      home_half: { home: 'WIN ½ ✅', away: 'LOSE ½ ❌' },
      away_half: { home: 'LOSE ½ ❌', away: 'WIN ½ ✅' },
    }
    const colMap = {
      home:      side === 'home' ? EDGE_COLOURS.green : EDGE_COLOURS.red,
      away:      side === 'away' ? EDGE_COLOURS.green : EDGE_COLOURS.red,
      push:      EDGE_COLOURS.amber,
      home_half: side === 'home' ? EDGE_COLOURS.green : EDGE_COLOURS.red,
      away_half: side === 'away' ? EDGE_COLOURS.green : EDGE_COLOURS.red,
    }
    return <span style={{ fontSize: 10, fontWeight: 600, color: colMap[result] || 'var(--color-text-muted)' }}>{textMap[result]?.[side] || '—'}</span>
  }

  function tgCell(result, side) {
    const textMap = {
      over:       { over: 'WIN FULL ✅',  under: 'LOSE FULL ❌' },
      under:      { over: 'LOSE FULL ❌', under: 'WIN FULL ✅'  },
      push:       { over: 'PUSH ↔',      under: 'PUSH ↔'       },
      over_half:  { over: 'WIN ½ ✅',   under: 'LOSE ½ ❌'    },
      under_half: { over: 'LOSE ½ ❌',  under: 'WIN ½ ✅'     },
    }
    const colMap = {
      over:       side === 'over'  ? EDGE_COLOURS.green : EDGE_COLOURS.red,
      under:      side === 'under' ? EDGE_COLOURS.green : EDGE_COLOURS.red,
      push:       EDGE_COLOURS.amber,
      over_half:  side === 'over'  ? EDGE_COLOURS.green : EDGE_COLOURS.red,
      under_half: side === 'under' ? EDGE_COLOURS.green : EDGE_COLOURS.red,
    }
    return <span style={{ fontSize: 10, fontWeight: 600, color: colMap[result] || 'var(--color-text-muted)' }}>{textMap[result]?.[side] || '—'}</span>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

      {!model && (
        <div style={{ ...cardStyle, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 14, padding: 20 }}>
          Stats required for Asian handicap calculations (MT06)
        </div>
      )}

      {/* Budget */}
      <div style={{ ...cardStyle, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <label style={{ fontSize: 12, color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>Budget ¥</label>
        <input type="number" inputMode="decimal" min="0" placeholder="10000" value={budget}
          onChange={e => setBudget(e.target.value)}
          style={{ width: 110, fontSize: 16, minHeight: 44, padding: '0 8px', borderRadius: 'var(--radius-sm)', background: 'var(--color-bg)', color: 'var(--color-text-primary)', border: '0.5px solid var(--color-border-active)' }} />
        {hasBgt && <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>¼ Kelly · 5% cap (MT24)</span>}
      </div>

      {/* ── SECTION 1: ASIAN HANDICAP ── */}
      {model && ah && (
        <div style={cardStyle}>
          <span style={SH}>亚让球 · Asian Handicap</span>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14, alignItems: 'flex-end' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>Handicap line</label>
              <select value={ahLine} onChange={e => setAhLine(parseFloat(e.target.value))} style={sel}>
                {AH_LINES.map(l => <option key={l.val} value={l.val}>{l.label}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>Modifier +</label>
              <input type="number" inputMode="numeric" min="-50" max="50" step="1" value={ahMod}
                onChange={e => setAhMod(parseInt(e.target.value, 10) || 0)}
                style={{ width: 80, fontSize: 16, minHeight: 44, padding: '0 8px', borderRadius: 'var(--radius-sm)', background: 'var(--color-bg)', color: 'var(--color-text-primary)', border: '0.5px solid var(--color-border-active)' }} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>Gets +</label>
              <div style={{ display: 'flex', gap: 4 }}>
                {['home', 'away'].map(side => (
                  <button key={side} onClick={() => setAhModSide(side)} style={{
                    minHeight: 44, padding: '0 12px', borderRadius: 'var(--radius-sm)',
                    border: ahModSide === side ? '0.5px solid var(--color-accent-border)' : '0.5px solid var(--color-border)',
                    background: ahModSide === side ? 'var(--color-accent-dim)' : 'transparent',
                    color: ahModSide === side ? 'var(--color-accent)' : 'var(--color-text-secondary)',
                    fontSize: 12, fontWeight: ahModSide === side ? 600 : 400, cursor: 'pointer', fontFamily: 'var(--font-ui)',
                  }}>
                    {side === 'home' ? 'Home gets +' : 'Away gets +'}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Market label */}
          <p style={{ fontSize: 14, fontFamily: 'var(--font-display)', color: 'var(--color-text-secondary)', marginBottom: 4 }}>
            <strong style={{ color: 'var(--color-text-primary)' }}>{homeTeam}</strong>
            {' '}<span style={{ color: 'var(--color-accent)', fontWeight: 700 }}>{ahLineObj.label}</span>
            {ahModSide === 'home' && ahMod !== 0 && <span style={{ color: 'var(--color-accent)', fontWeight: 700 }}>+{ahMod}</span>}
            {' '}
            <strong style={{ color: 'var(--color-text-primary)' }}>{awayTeam}</strong>
            {' '}<span style={{ color: 'var(--color-info)' }}>{awayAhObj.label}</span>
            {ahModSide === 'away' && ahMod !== 0 && <span style={{ color: 'var(--color-info)', fontWeight: 700 }}>+{ahMod}</span>}
          </p>
          <p style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 12, fontStyle: 'italic' }}>
            Your bookmaker shows:{' '}
            {ahModSide === 'home'
              ? `${homeTeam} ${ahLineObj.label}${ahMod !== 0 ? '+'+ahMod : ''} ${awayTeam} ${awayAhObj.label}`
              : `${homeTeam} ${ahLineObj.label} ${awayTeam} ${awayAhObj.label}${ahMod !== 0 ? '+'+ahMod : ''}`}
          </p>

          {/* Bet cards */}
          <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
            {betCard(`Bet HOME · ${homeTeam} ${ahLineObj.label}${ahModSide === 'home' && ahMod !== 0 ? '+'+ahMod : ''}`, ah.pHome, ah.pPush, homeDec, ahHomeStake)}
            {betCard(`Bet AWAY · ${awayTeam} ${awayAhObj.label}${ahModSide === 'away' && ahMod !== 0 ? '+'+ahMod : ''}`, ah.pAway, ah.pPush, awayDec, ahAwayStake)}
          </div>

          {/* Simulator */}
          <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-muted)', letterSpacing: '0.06em', marginBottom: 6 }}>RESULT SIMULATOR · V2 TOP SCORELINES</p>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 340 }}>
              <thead>
                <tr>
                  <th style={th}>Score</th>
                  <th style={th}>%</th>
                  <th style={{ ...th, color: 'var(--color-accent)' }}>HOME {ahLineObj.label}</th>
                  <th style={{ ...th, color: 'var(--color-info)' }}>AWAY {awayAhObj.label}</th>
                </tr>
              </thead>
              <tbody>
                {topLines.map(({ h, a, p }) => {
                  const res = ahCoverResult(h, a, ahLine)
                  return (
                    <tr key={`${h}-${a}`}>
                      <td style={{ ...td, fontWeight: 700, color: 'var(--color-text-primary)' }}>{h}–{a}</td>
                      <td style={{ ...td, color: 'var(--color-text-muted)' }}>{(p * 100).toFixed(1)}%</td>
                      <td style={td}>{ahCell(res, 'home')}</td>
                      <td style={td}>{ahCell(res, 'away')}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── SECTION 2: TOTAL GOALS ── */}
      {model && tg && (
        <div style={cardStyle}>
          <span style={SH}>大/小球 · Total Goals (Besar / Kecil)</span>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14, alignItems: 'flex-end' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>Goals line</label>
              <select value={tgLine} onChange={e => setTgLine(parseFloat(e.target.value))} style={sel}>
                {TG_LINES.map(l => <option key={l.val} value={l.val}>{l.label}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>Modifier +</label>
              <input type="number" inputMode="numeric" min="-50" max="50" step="1" value={tgMod}
                onChange={e => setTgMod(parseInt(e.target.value, 10) || 0)}
                style={{ width: 80, fontSize: 16, minHeight: 44, padding: '0 8px', borderRadius: 'var(--radius-sm)', background: 'var(--color-bg)', color: 'var(--color-text-primary)', border: '0.5px solid var(--color-border-active)' }} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>Gets +</label>
              <div style={{ display: 'flex', gap: 4 }}>
                {['over', 'under'].map(side => (
                  <button key={side} onClick={() => setTgModSide(side)} style={{
                    minHeight: 44, padding: '0 12px', borderRadius: 'var(--radius-sm)',
                    border: tgModSide === side ? '0.5px solid var(--color-accent-border)' : '0.5px solid var(--color-border)',
                    background: tgModSide === side ? 'var(--color-accent-dim)' : 'transparent',
                    color: tgModSide === side ? 'var(--color-accent)' : 'var(--color-text-secondary)',
                    fontSize: 12, fontWeight: tgModSide === side ? 600 : 400, cursor: 'pointer', fontFamily: 'var(--font-ui)',
                  }}>
                    {side === 'over' ? 'Besar gets +' : 'Kecil gets +'}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Market label */}
          <p style={{ fontSize: 14, fontFamily: 'var(--font-display)', color: 'var(--color-text-secondary)', marginBottom: 4 }}>
            <strong>B.{tgLineObj.label}</strong>
            {tgModSide === 'over' && tgMod !== 0 && <span style={{ color: 'var(--color-accent)', fontWeight: 700 }}>+{tgMod}</span>}
            <span style={{ margin: '0 8px', color: 'var(--color-text-muted)' }}>/</span>
            <strong>K.{tgLineObj.label}</strong>
            {tgModSide === 'under' && tgMod !== 0 && <span style={{ color: 'var(--color-info)', fontWeight: 700 }}>+{tgMod}</span>}
          </p>
          <p style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 12, fontStyle: 'italic' }}>
            Your bookmaker shows:{' '}
            {tgModSide === 'over'
              ? `B.${tgLineObj.label}${tgMod !== 0 ? '+'+tgMod : ''} / K.${tgLineObj.label}`
              : `B.${tgLineObj.label} / K.${tgLineObj.label}${tgMod !== 0 ? '+'+tgMod : ''}`}
          </p>

          {/* Bet cards */}
          <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
            {betCard(`Besar · Over ${tgLineObj.label}`, tg.pOver, tg.pPush, overDec, tgOverStake)}
            {betCard(`Kecil · Under ${tgLineObj.label}`, tg.pUnder, tg.pPush, underDec, tgUnderStake)}
          </div>

          {/* Result grid */}
          <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-muted)', letterSpacing: '0.06em', marginBottom: 6 }}>RESULT GRID</p>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 260 }}>
              <thead>
                <tr>
                  <th style={th}>Total Goals</th>
                  <th style={{ ...th, color: 'var(--color-accent)' }}>Besar (Over)</th>
                  <th style={{ ...th, color: 'var(--color-info)' }}>Kecil (Under)</th>
                </tr>
              </thead>
              <tbody>
                {[0, 1, 2, 3, 4, 5, 6].map(n => (
                  <tr key={n}>
                    <td style={{ ...td, fontWeight: 700, color: 'var(--color-text-primary)' }}>{n === 6 ? '6+' : n}</td>
                    <td style={td}>{tgCell(tgCoverResult(n, tgLine), 'over')}</td>
                    <td style={td}>{tgCell(tgCoverResult(n, tgLine), 'under')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── SECTION 3: CORRECT SCORE ── */}
      {model && <CorrectScoreSection model={model} match={match} />}

      {/* ── SECTION 4: 让球胜平负 CHINESE HANDICAP ── */}
      {model && <ChineseHandicapSection model={model} homeTeam={homeTeam} awayTeam={awayTeam} />}

      {/* ── SECTION 5: 比分固定奖金 CHINESE CORRECT SCORE ── */}
      {model && <ChineseCorrectScoreSection model={model} homeTeam={homeTeam} awayTeam={awayTeam} />}
    </div>
  )
}

// Portfolio tab — auto-populated from DB pending bets + Value tab odds
function TabPortfolio({ stats, match, odds1x2 }) {
  const { t } = useTranslation()
  const [bankroll, setBankroll] = useState(1000)
  const [pendingBets, setPendingBets] = useState([])
  const [betsLoading, setBetsLoading] = useState(true)

  const model = useMemo(() => {
    if (!stats?.home || !stats?.away) return null
    try { return runModels(stats.home, stats.away, { venue: match?.venue, city: match?.city, homeTeam: match?.home_team, awayTeam: match?.away_team }) } catch { return null }
  }, [stats, match])

  const anchor = model?.v1.totalGoals.find(l => l.anchor)

  useEffect(() => {
    if (!match?.id) return
    setBetsLoading(true)
    supabase.from('bets').select('*').eq('match_id', match.id).eq('status', 'pending').order('created_at', { ascending: false })
      .then(({ data }) => { setPendingBets(data || []); setBetsLoading(false) })
  }, [match?.id])

  const ev1x2 = useMemo(() => {
    if (!model) return null
    const o = { home: parseFloat(odds1x2?.home), draw: parseFloat(odds1x2?.draw), away: parseFloat(odds1x2?.away) }
    if (![o.home, o.draw, o.away].every(v => v > 1)) return null
    try { return analyse1X2(model.v2.probs, o) } catch { return null }
  }, [model, odds1x2])

  const recommendations = ev1x2 ? ['home', 'draw', 'away'].filter(k => ev1x2.outcomes[k].ev?.recommend) : []

  function betLabel(bet) {
    if (bet.bet_type === '1X2') {
      if (bet.selection === 'home') return `${match?.home_team || 'Home'} Win`
      if (bet.selection === 'draw') return 'Draw'
      if (bet.selection === 'away') return `${match?.away_team || 'Away'} Win`
    }
    if (bet.bet_type === 'correct_score') return `Score ${bet.selection}`
    if (bet.bet_type === 'total_goals') return bet.selection.charAt(0).toUpperCase() + bet.selection.slice(1)
    return bet.selection
  }

  function modelProbForBet(bet) {
    if (!model) return null
    if (bet.bet_type === '1X2') return model.v2.probs[bet.selection] ?? null
    if (bet.bet_type === 'correct_score') {
      const [h, a] = bet.selection.split('-').map(Number)
      return (h >= 0 && h <= SCORE_MAX && a >= 0 && a <= SCORE_MAX) ? model.v2.matrix[h][a] : null
    }
    if (bet.bet_type === 'total_goals') {
      const n = parseInt(bet.selection)
      return !isNaN(n) ? exactGoalsProb(n, model.v2.matrix) : null
    }
    return null
  }

  const totalExposure = pendingBets.reduce((s, b) => s + Number(b.stake), 0)
  const exposurePct = bankroll > 0 ? (totalExposure / bankroll) * 100 : 0
  const stressWin = pendingBets.reduce((s, b) => s + Number(b.stake) * (Number(b.odds) - 1), 0)
  const stressLose = -totalExposure

  const card = { background: 'var(--color-bg-card)', border: '0.5px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '14px 16px' }
  const inp = { fontSize: 16, minHeight: 44, padding: '0 10px', borderRadius: 'var(--radius-sm)', background: 'var(--color-bg)', color: 'var(--color-text-primary)', border: '0.5px solid var(--color-border-active)' }
  const hdr = { fontSize: 14, fontWeight: 700, color: 'var(--color-text-muted)', letterSpacing: '0.06em', marginBottom: 10 }

  const hasOddsEntered = odds1x2?.home || odds1x2?.draw || odds1x2?.away

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* Bankroll */}
      <div style={{ ...card, display: 'flex', alignItems: 'center', gap: 12 }}>
        <label style={{ fontSize: 14, color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>{t('portfolio.bankroll')}</label>
        <input type="number" inputMode="decimal" min="0" value={bankroll}
          onChange={e => setBankroll(Math.max(0, parseFloat(e.target.value) || 0))}
          style={{ ...inp, flex: 1 }} />
      </div>

      {/* Value tab recommendations */}
      <div style={card}>
        <p style={hdr}>VALUE TAB RECOMMENDATIONS</p>
        {!hasOddsEntered ? (
          <p style={{ fontSize: 15, color: 'var(--color-text-secondary)' }}>
            Enter 1×2 bookmaker odds in the Value tab to see edge-filtered recommendations here.
          </p>
        ) : !ev1x2 ? (
          <p style={{ fontSize: 15, color: 'var(--color-text-secondary)' }}>
            Complete all three 1×2 odds in the Value tab to compute edge.
          </p>
        ) : recommendations.length === 0 ? (
          <p style={{ fontSize: 15, color: 'var(--color-text-secondary)' }}>
            No positive edge at current odds (threshold: ≥5%).
          </p>
        ) : recommendations.map(key => {
          const oc = ev1x2.outcomes[key]
          const col = EDGE_COLOURS[oc.ev?.colour] || 'var(--color-text-muted)'
          const label = key === 'home' ? `${match?.home_team || 'Home'} Win`
                      : key === 'away' ? `${match?.away_team || 'Away'} Win` : 'Draw'
          return (
            <div key={key} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              flexWrap: 'wrap', padding: '8px 0', borderBottom: '0.5px solid var(--color-border)', gap: 8,
            }}>
              <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-text-primary)' }}>
                {label} @ {oc.odds.toFixed(2)}
              </span>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 14, fontWeight: 700, padding: '2px 8px', borderRadius: 'var(--radius-full)', background: `${col}22`, color: col }}>
                  {oc.ev?.edgeDisplay}
                </span>
                <span style={{ fontSize: 14, color: 'var(--color-text-secondary)' }}>
                  Kelly {oc.stake.pct.toFixed(1)}%
                </span>
                <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--color-accent)', fontFamily: 'var(--font-display)' }}>
                  ¥{(bankroll * oc.stake.fraction).toFixed(0)}
                </span>
              </div>
            </div>
          )
        })}
      </div>

      {/* Active bets on this match */}
      <div style={card}>
        <p style={hdr}>ACTIVE BETS ON THIS MATCH</p>
        {betsLoading ? (
          <p style={{ fontSize: 15, color: 'var(--color-text-secondary)' }}>Loading…</p>
        ) : pendingBets.length === 0 ? (
          <p style={{ fontSize: 15, color: 'var(--color-text-secondary)' }}>No pending bets on this match.</p>
        ) : (
          <>
            {pendingBets.length >= 2 && (
              <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-warning)', marginBottom: 8 }}>
                ⚠ {pendingBets.length} correlated bets on same match
              </p>
            )}
            {pendingBets.map(bet => {
              const prob = modelProbForBet(bet)
              const kellyAmt = prob != null && bet.odds > 1 ? bankroll * calcStake(prob, bet.odds).fraction : null
              return (
                <div key={bet.id} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  flexWrap: 'wrap', padding: '8px 0', borderBottom: '0.5px solid var(--color-border)', gap: 8,
                }}>
                  <div>
                    <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-text-primary)' }}>
                      {betLabel(bet)} @ {Number(bet.odds).toFixed(2)}
                    </span>
                    <span style={{ fontSize: 13, color: 'var(--color-text-muted)', marginLeft: 8 }}>
                      {bet.bet_type}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                    {prob != null && (
                      <span style={{ fontSize: 14, color: 'var(--color-info)' }}>
                        V2 {formatProb(prob)}
                      </span>
                    )}
                    {kellyAmt != null && (
                      <span style={{ fontSize: 14, color: 'var(--color-text-secondary)' }}>
                        Kelly ¥{kellyAmt.toFixed(0)}
                      </span>
                    )}
                    <span style={{ fontSize: 15, fontWeight: 700, fontFamily: 'var(--font-display)' }}>
                      Placed ¥{Number(bet.stake).toFixed(0)}
                    </span>
                  </div>
                </div>
              )
            })}
            <div style={{ marginTop: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, marginBottom: 6 }}>
                <span style={{ color: 'var(--color-text-muted)' }}>{t('portfolio.exposure')}</span>
                <span style={{ color: exposurePct > 15 ? 'var(--color-warning)' : 'var(--color-text-primary)', fontWeight: 700 }}>
                  ¥{totalExposure.toFixed(0)} · {exposurePct.toFixed(1)}%
                </span>
              </div>
              <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text-muted)', letterSpacing: '0.06em', margin: '10px 0 6px' }}>
                {t('portfolio.stress').toUpperCase()}
              </p>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, color: 'var(--color-edge-green)' }}>
                <span>{t('portfolio.allWin')}</span><span>+¥{stressWin.toFixed(0)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, color: 'var(--color-edge-red)' }}>
                <span>{t('portfolio.allLose')}</span><span>¥{stressLose.toFixed(0)}</span>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Model summary */}
      {model && (
        <div style={card}>
          <p style={hdr}>MODEL SUMMARY</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {[
              { label: 'λ Home (V1)', value: model.v1.lambdaHome.toFixed(2) },
              { label: 'λ Away (V1)', value: model.v1.lambdaAway.toFixed(2) },
              { label: 'λ Away (V2)', value: model.v2.lambdaAway.toFixed(2) },
              { label: 'Anchor line', value: anchor ? `${anchor.line}` : '—' },
            ].map(({ label, value }) => (
              <div key={label} style={{
                flex: '1 0 120px', background: 'var(--color-bg)',
                border: '0.5px solid var(--color-border)', borderRadius: 'var(--radius-sm)',
                padding: '8px 10px', textAlign: 'center',
              }}>
                <p style={{ fontSize: 14, color: 'var(--color-text-muted)', marginBottom: 2 }}>{label}</p>
                <p style={{ fontFamily: 'var(--font-display)', fontSize: 19, fontWeight: 600, color: 'var(--color-accent)' }}>{value}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Kelly rules */}
      <div style={card}>
        <p style={hdr}>KELLY SIZING RULES</p>
        {[
          { label: 'Full Kelly',    formula: 'f* = (b×p − q) / b',          note: 'b = odds−1, q = 1−p' },
          { label: 'Fractional',   formula: 'stake = f* × 0.25 × bankroll', note: 'always fractional' },
          { label: 'Hard cap',     formula: 'max 5% of bankroll',            note: 'MT24', accent: true },
          { label: 'Min threshold',formula: '< 1% → skip or min stake',      note: 'not worth placing' },
        ].map(({ label, formula, note, accent }) => (
          <div key={label} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '8px 0', borderBottom: '0.5px solid var(--color-border)' }}>
            <span style={{ fontSize: 15, color: 'var(--color-text-muted)', minWidth: 90 }}>{label}</span>
            <span style={{ fontFamily: 'var(--font-display)', fontSize: 15, flex: 1, color: accent ? 'var(--color-accent)' : 'var(--color-text-primary)' }}>
              {formula}
            </span>
            <span style={{ fontSize: 15, color: 'var(--color-text-secondary)' }}>{note}</span>
          </div>
        ))}
      </div>
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
        fontSize: 80, fontWeight: 900,
        color: 'var(--color-accent)',
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

function TabAI({ match, isAdmin, onAnalysisComplete }) {
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

      // Refresh user profile to update credit display
      onAnalysisComplete?.()

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

// ── Final Signal ─────────────────────────────────────────────────────────────
// Combines Value tab edge with AI composite — shown at top of right sidebar.

function FinalSignal({ ev1x2, aiComposite, match }) {
  const rawRec  = aiComposite?.recommendation
  const normRec =
    rawRec === 'home_win' || rawRec === 'value_home' ? 'home' :
    rawRec === 'away_win' || rawRec === 'value_away' ? 'away' :
    rawRec === 'draw'                                 ? 'draw' : null
  const aiConf  = aiComposite?.confidence != null ? Math.round(aiComposite.confidence * 100) : null
  const bestBet = ev1x2?.bestBet ?? null

  const signal = !ev1x2                                           ? 'NO_ODDS'
    : bestBet && normRec === bestBet && aiConf >= 65              ? 'STRONG'
    : bestBet && normRec && normRec !== bestBet                   ? 'CAUTION'
    : bestBet                                                      ? 'WEAK'
    : aiConf >= 75 && normRec                                     ? 'AI_ONLY'
    : 'SKIP'

  const LABEL = { home: match?.home_team || 'Home', draw: 'Draw', away: match?.away_team || 'Away' }

  const CFG = {
    NO_ODDS: { label: null,          icon: null,  border: 'var(--color-border)',      col: 'var(--color-text-muted)',    bg: 'transparent' },
    STRONG:  { label: 'STRONG BET', icon: '✅',  border: 'var(--color-accent)',      col: 'var(--color-accent)',        bg: 'var(--color-accent-dim)' },
    CAUTION: { label: 'CAUTION',    icon: '⚠️', border: '#cc8800',                   col: '#cc8800',                   bg: 'rgba(204,136,0,0.08)' },
    WEAK:    { label: 'WEAK SIGNAL',icon: '〰️', border: 'var(--color-border)',        col: 'var(--color-text-secondary)',bg: 'var(--color-bg-elevated)' },
    AI_ONLY: { label: 'AI ONLY',    icon: '🎯',  border: 'var(--color-info)',         col: 'var(--color-info)',          bg: 'rgba(56,120,180,0.07)' },
    SKIP:    { label: 'SKIP',       icon: '❌',  border: 'var(--color-danger)',       col: 'var(--color-danger)',        bg: 'rgba(185,60,60,0.06)' },
  }
  const cfg = CFG[signal]

  const msg =
    signal === 'NO_ODDS'  ? 'Enter odds in Bets tab to see final signal'
    : signal === 'STRONG' ? `Both model and AI agree — bet ${LABEL[bestBet]}`
    : signal === 'CAUTION'? `Math finds edge but AI disagrees — reduce stake 50%`
    : signal === 'WEAK'   ? 'Edge found but low AI confidence — small stake only'
    : signal === 'AI_ONLY'? `No mathematical edge but high AI conviction — consider small bet on ${LABEL[normRec]}`
    :                       'No edge, low confidence — skip this match'

  const bestOc   = bestBet ? ev1x2.outcomes[bestBet] : null
  const edgePct  = bestOc?.ev?.edgePct
  const bestOdds = bestOc?.odds
  const kellyFrac = bestOc?.stake?.fraction  // already fractional × 0.25, capped 5%
  const adjKelly  = kellyFrac && aiConf ? Math.min(kellyFrac * (aiConf / 100), 0.05) : kellyFrac

  return (
    <div style={{ background: cfg.bg, border: `2px solid ${cfg.border}`, borderRadius: 'var(--radius-md)', padding: '14px 14px', marginBottom: 10 }}>
      <p style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.12em', color: cfg.col, textTransform: 'uppercase', marginBottom: 6 }}>FINAL SIGNAL</p>

      {signal === 'NO_ODDS' ? (
        <p style={{ fontSize: 13, color: 'var(--color-text-muted)', fontStyle: 'italic', lineHeight: 1.4 }}>{msg}</p>
      ) : (
        <>
          <p style={{ fontSize: 21, fontWeight: 700, color: cfg.col, fontFamily: 'var(--font-display)', lineHeight: 1.1, marginBottom: 8 }}>
            {cfg.icon} {cfg.label}
          </p>
          <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', lineHeight: 1.4 }}>{msg}</p>

          {signal === 'STRONG' && bestOdds != null && (
            <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 3 }}>
              <p style={{ fontSize: 14, fontWeight: 700, color: cfg.col }}>
                @ {bestOdds.toFixed(2)} · +{edgePct?.toFixed(1)}% edge
              </p>
              {adjKelly > 0 && (
                <p style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                  Kelly stake: {(adjKelly * 100).toFixed(1)}% of bankroll
                </p>
              )}
              {aiConf != null && <p style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>AI confidence: {aiConf}%</p>}
            </div>
          )}
          {signal === 'CAUTION' && (
            <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 6 }}>
              AI recommends: <strong>{normRec ? LABEL[normRec] : '—'}</strong>{aiConf != null ? ` (${aiConf}%)` : ''}
            </p>
          )}
          {signal === 'AI_ONLY' && aiConf != null && (
            <p style={{ fontSize: 12, color: cfg.col, marginTop: 6, fontWeight: 600 }}>AI confidence: {aiConf}%</p>
          )}
          {signal === 'WEAK' && edgePct != null && (
            <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 6 }}>
              Edge: +{edgePct.toFixed(1)}% on {LABEL[bestBet]}{aiConf != null ? ` · AI: ${aiConf}%` : ''}
            </p>
          )}
        </>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────

export default function MatchAnalysis() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { t } = useTranslation()
  const [activeTab, setActiveTab] = useState('prediction')
  const [match, setMatch] = useState(null)
  const [matchLoading, setMatchLoading] = useState(true)
  const [matchError, setMatchError] = useState(null)
  const [refreshing, setRefreshing] = useState(false)
  const [dixonColes, setDixonColes] = useState(false)  // MT21 default OFF
  const [v1x2Odds, setV1x2Odds] = useState({ home: '', draw: '', away: '' })
  const [aiComposite, setAiComposite] = useState(null)
  const [roleOutputs, setRoleOutputs] = useState([])
  const [aiRoles, setAiRoles] = useState([])
  const [aiRunning, setAiRunning] = useState(false)
  const [aiRunError, setAiRunError] = useState(null)
  const [aiRunMsg, setAiRunMsg] = useState('')

  const isAdmin = user?.id === ADMIN_UUID
  const { profile, refreshProfile } = useUser()
  // All approved users can run AI analysis (credit check enforced in worker)
  const canRunAI = profile?.status === 'approved'

  // Load ai_roles + role_outputs; extract Role 10 for Final Signal
  useEffect(() => {
    if (!match?.id) return
    setAiComposite(null)
    setRoleOutputs([])
    async function loadAI() {
      const [rolesRes, outputsRes] = await Promise.all([
        supabase.from('ai_roles').select('*').eq('enabled', true).order('role_number'),
        supabase.from('role_outputs').select('*, ai_roles(role_number)').eq('match_id', match.id),
      ])
      if (rolesRes.data) setAiRoles(rolesRes.data)
      if (outputsRes.data) {
        setRoleOutputs(outputsRes.data)
        const r10 = outputsRes.data.find(o => o.ai_roles?.role_number === 10)
        if (r10) {
          let json = r10.output_json
          if (typeof json === 'string') {
            try { json = JSON.parse(json.replace(/```json\n?|\n?```/g, '').trim()) } catch { json = null }
          }
          if (json) setAiComposite(json)
        }
      }
    }
    loadAI()
  }, [match?.id])

  useEffect(() => {
    let cancelled = false
    logPageView(user?.id, 'match_detail')

    // Synchronous reset — happens before the async fetch so odds clear immediately
    // on every match navigation, regardless of fetch timing.
    setV1x2Odds({ home: '', draw: '', away: '' })

    async function loadMatch() {
      setMatchLoading(true)
      const { data, error } = await supabase
        .from('matches')
        .select('*')
        .eq('id', id)
        .single()
      if (cancelled) return   // stale response — a newer id took over
      setMatchLoading(false)
      if (error) { setMatchError(error.message); return }
      setMatch(data)
      // Restore saved odds only when all 3 columns are present for this match
      if (data.odds_home != null && data.odds_draw != null && data.odds_away != null) {
        setV1x2Odds({
          home: String(data.odds_home),
          draw: String(data.odds_draw),
          away: String(data.odds_away),
        })
      }
    }

    if (id) loadMatch()
    return () => { cancelled = true }
  }, [id])

  // Auto-save odds to matches table (admin only) when all 3 valid
  useEffect(() => {
    if (!isAdmin || !id) return
    const h = parseFloat(v1x2Odds.home), d = parseFloat(v1x2Odds.draw), a = parseFloat(v1x2Odds.away)
    if (![h, d, a].every(v => v > 1)) return
    const t = setTimeout(() => {
      supabase.from('matches').update({ odds_home: h, odds_draw: d, odds_away: a }).eq('id', id)
    }, 600)
    return () => clearTimeout(t)
  }, [v1x2Odds, id, isAdmin])

  const {
    stats, loading: statsLoading, error: statsError,
    confidence, refreshStats, saveManualStats, lastUpdated,
  } = useTeamStats(match)

  // Sidebar model + EV for Final Signal (independent of tab state)
  const sidebarModel = useMemo(() => {
    if (!stats?.home || !stats?.away) return null
    try { return runModels(stats.home, stats.away, { venue: match?.venue, city: match?.city, homeTeam: match?.home_team, awayTeam: match?.away_team }) } catch { return null }
  }, [stats, match])

  const sidebarEv = useMemo(() => {
    if (!sidebarModel) return null
    const o = { home: parseFloat(v1x2Odds.home), draw: parseFloat(v1x2Odds.draw), away: parseFloat(v1x2Odds.away) }
    if (![o.home, o.draw, o.away].every(v => v > 1)) return null
    try { return analyse1X2(sidebarModel.v2.probs, o) } catch { return null }
  }, [sidebarModel, v1x2Odds])

  async function handleRefreshStats() {
    if (!match) return
    setRefreshing(true)
    await refreshStats()
    setRefreshing(false)
  }

  async function handleRunAI() {
    setAiRunning(true)
    setAiRunMsg('')
    setAiRunError(null)
    track.aiAnalysis(user?.id, match?.id, `${match?.home_team} vs ${match?.away_team}`)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) throw new Error('Not authenticated')
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ match_id: match.id }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      setAiRunMsg(`✓ ${data.roles_run} roles complete`)
      track.pasp(user?.id, match?.id)
      const { data: fresh } = await supabase
        .from('role_outputs')
        .select('*, ai_roles(role_number)')
        .eq('match_id', match.id)
      if (fresh) {
        setRoleOutputs(fresh)
        const r10 = fresh.find(o => o.ai_roles?.role_number === 10)
        if (r10) {
          let json = r10.output_json
          if (typeof json === 'string') {
            try { json = JSON.parse(json.replace(/```json\n?|\n?```/g, '').trim()) } catch { json = null }
          }
          if (json) setAiComposite(json)
        }
      }
      refreshProfile()
    } catch (err) {
      setAiRunError(err.message)
    }
    setAiRunning(false)
  }

  if (matchLoading) {
    return (
      <div style={{ padding: '24px 16px', maxWidth: 1040, margin: '0 auto' }}>
        {[1, 2, 3].map(i => (
          <div key={i} className="skeleton" style={{ height: 80, marginBottom: 12 }} />
        ))}
      </div>
    )
  }

  if (matchError || !match) {
    return (
      <div style={{ padding: '24px 16px', maxWidth: 1040, margin: '0 auto' }}>
        <button onClick={() => navigate(-1)} style={backBtnStyle}>← {t('analysis.back')}</button>
        <p style={{ color: 'var(--color-danger)', marginTop: 16 }}>
          {matchError || 'Match not found'}
        </p>
      </div>
    )
  }

  const confCfg = CONFIDENCE_CONFIG[confidence]
  const hasAnyStats = stats.home || stats.away

  const stageLine = `${STAGE_LABELS[match.stage] || match.stage}${match.group_name ? ` · Group ${match.group_name}` : ''}${match.venue ? ` · ${match.venue}` : ''}${match.city ? `, ${match.city}` : ''}`

  return (
    <div className="analysis-page">

      {/* ── Left rail (desktop): match summary + vertical tabs ── */}
      <aside className="analysis-side">
        <button onClick={() => navigate(-1)} style={backBtnStyle}>← {t('analysis.back')}</button>
        <div style={{ background: 'var(--color-bg-card)', border: '0.5px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '16px 14px', marginTop: 8 }}>
          <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 4 }}>{stageLine}</p>
          <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 12 }}>{toBeijingTime(match.match_date, 'full')} 北京</p>
          <MatchTeams match={match} t={t} />
          <div style={{ textAlign: 'center', marginTop: 8 }}><ConfBadge confCfg={confCfg} confidence={confidence} t={t} /></div>
        </div>
        <div style={{ marginTop: 16 }}>
          <TabNav tabs={TABS} activeTab={activeTab} setActiveTab={setActiveTab} vertical t={t} />
        </div>
      </aside>

      {/* ── Center: mobile header + tab content ── */}
      <div>
        {/* Mobile header (hidden ≥1024) */}
        <div className="only-mobile" style={{ padding: '20px 0 0', borderBottom: '0.5px solid var(--color-border)' }}>
          <button onClick={() => navigate(-1)} style={backBtnStyle}>← {t('analysis.back')}</button>
          <p style={{ fontSize: 14, color: 'var(--color-text-muted)', marginTop: 8, marginBottom: 4 }}>{stageLine}</p>
          <p style={{ fontSize: 14, color: 'var(--color-text-secondary)', marginBottom: 16 }}>{toBeijingTime(match.match_date, 'full')} 北京</p>
          <MatchTeams match={match} t={t} />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, paddingBottom: 16, flexWrap: 'wrap' }}>
            <ConfBadge confCfg={confCfg} confidence={confidence} t={t} />
            <span style={{ fontSize: 15, color: 'var(--color-text-secondary)' }}>{confCfg.desc}</span>
          </div>
          <TabNav tabs={TABS} activeTab={activeTab} setActiveTab={setActiveTab} t={t} />
        </div>

        {/* ── Tab Content ── */}
        <div style={{ paddingTop: 20 }}>

        {/* TAB 1: Prediction & Stats */}
        {activeTab === 'prediction' && (
          <PredictionTab
            match={match}
            stats={stats}
            statsLoading={statsLoading}
            statsError={statsError}
            isAdmin={isAdmin}
            refreshing={refreshing}
            onRefresh={handleRefreshStats}
            onSaveManual={saveManualStats}
            lastUpdated={lastUpdated}
            sidebarModel={sidebarModel}
            aiComposite={aiComposite}
            roleOutputs={roleOutputs}
            aiRoles={aiRoles}
            aiRunning={aiRunning}
            aiRunError={aiRunError}
            aiRunMsg={aiRunMsg}
            onRunAI={handleRunAI}
          />
        )}

        {/* TAB 2: Bets */}
        {activeTab === 'bets' && (
          <BetsTab
            match={match}
            sidebarModel={sidebarModel}
            v1x2Odds={v1x2Odds}
            setV1x2Odds={setV1x2Odds}
            isAdmin={isAdmin}
          />
        )}

        {/* TAB 3: PASP v3 Calculator */}
        {activeTab === 'pasp' && (
          <PASPTab
            match={match}
            model={sidebarModel}
          />
        )}

        {/* Legacy stats tab — kept for reference, not rendered in 2-tab UI */}
        {false && activeTab === 'stats' && (
          <div>
            {statsError && (
              <div style={{ background: 'var(--color-danger-dim)', border: '1px solid var(--color-danger)', borderRadius: 'var(--radius-md)', padding: '12px 14px', marginBottom: 12 }}>
                <p style={{ color: 'var(--color-danger)', fontSize: 15, fontWeight: 600 }}>⚠ {statsError}</p>
              </div>
            )}

            <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 12 }}>
              {lastUpdated && (
                <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                  {t('analysis.lastUpdated')} {new Date(lastUpdated).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false, month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </span>
              )}
              {isAdmin && (
                <button
                  onClick={handleRefreshStats}
                  disabled={refreshing}
                  style={{
                    minHeight: 36,
                    padding: '0 14px',
                    display: 'flex', alignItems: 'center', gap: 6,
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
                  <span style={{ display: 'inline-block', transition: 'transform 0.6s linear', transform: refreshing ? 'rotate(360deg)' : 'none' }}>↻</span>
                  {refreshing ? t('common.loading') : t('analysis.fetchLatest')}
                </button>
              )}
            </div>

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
                      <p style={{ fontSize: 14, color: 'var(--color-accent)', fontWeight: 700, letterSpacing: '0.06em', marginBottom: 2 }}>{t('analysis.v1model')}</p>
                      <p style={{ fontSize: 15, color: 'var(--color-text-muted)' }}>{t('analysis.v1note')}</p>
                    </div>
                    <div style={{ flex: 1, minWidth: 120 }}>
                      <p style={{ fontSize: 14, color: 'var(--color-info)', fontWeight: 700, letterSpacing: '0.06em', marginBottom: 2 }}>{t('analysis.v2model')}</p>
                      <p style={{ fontSize: 15, color: 'var(--color-text-muted)' }}>{t('analysis.v2note')}</p>
                    </div>
                    <div style={{ flex: 1, minWidth: 120 }}>
                      <p style={{ fontSize: 14, color: '#3C3489', fontWeight: 700, letterSpacing: '0.06em', marginBottom: 2 }}>{t('analysis.v3model')} ★</p>
                      <p style={{ fontSize: 15, color: 'var(--color-text-muted)' }}>{t('analysis.v3note')}</p>
                    </div>
                  </div>
                )}

                <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                  <StatsColumn
                    match={match}
                    teamStats={stats.home}
                    opponentStats={stats.away}
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
                    opponentStats={stats.home}
                    isHome={false}
                    isAdmin={isAdmin}
                    onRefresh={handleRefreshStats}
                    onSaveManual={saveManualStats}
                    refreshing={refreshing}
                    t={t}
                  />
                </div>

                {/* V3 Model Summary */}
                {sidebarModel?.v3 && (
                  <div style={{
                    marginTop: 16,
                    background: '#EEEDFE',
                    border: '0.5px solid #534AB7',
                    borderRadius: 'var(--radius-md)',
                    padding: '14px 16px',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
                      <p style={{ fontSize: 14, fontWeight: 700, color: '#3C3489', letterSpacing: '0.06em' }}>
                        {t('analysis.v3model')} ★ {t('analysis.recommended')}
                      </p>
                      <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: '#fff', color: '#3C3489', border: '0.5px solid #534AB7' }}>
                        {t('analysis.v3badge')}
                      </span>
                    </div>

                    {/* Lambda comparison row */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 12, alignItems: 'center', marginBottom: 14 }}>
                      <div style={{ textAlign: 'center', background: '#fff', border: '0.5px solid #534AB7', borderRadius: 'var(--radius-md)', padding: '10px' }}>
                        <p style={{ fontSize: 11, color: '#534AB7', fontWeight: 700, letterSpacing: '0.05em', marginBottom: 4 }}>λ HOME (V3)</p>
                        <p style={{ fontFamily: 'var(--font-display)', fontSize: 32, fontWeight: 600, color: '#3C3489' }}>{sidebarModel.v3.lambdaHome.toFixed(3)}</p>
                      </div>
                      <span style={{ fontSize: 16, color: '#534AB7' }}>vs</span>
                      <div style={{ textAlign: 'center', background: '#fff', border: '0.5px solid #534AB7', borderRadius: 'var(--radius-md)', padding: '10px' }}>
                        <p style={{ fontSize: 11, color: '#534AB7', fontWeight: 700, letterSpacing: '0.05em', marginBottom: 4 }}>λ AWAY (V3)</p>
                        <p style={{ fontFamily: 'var(--font-display)', fontSize: 32, fontWeight: 600, color: '#3C3489' }}>{sidebarModel.v3.lambdaAway.toFixed(3)}</p>
                      </div>
                    </div>

                    {/* V3 probabilities */}
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
                      {[
                        { label: `${match.home_team} Win`, val: sidebarModel.v3.probs.home },
                        { label: 'Draw', val: sidebarModel.v3.probs.draw },
                        { label: `${match.away_team} Win`, val: sidebarModel.v3.probs.away },
                        { label: 'Over 2.5', val: sidebarModel.v3.over25 },
                        { label: 'BTTS', val: sidebarModel.v3.btts },
                      ].map(item => (
                        <div key={item.label} style={{ flex: '1 0 80px', textAlign: 'center', background: '#fff', border: '0.5px solid #534AB7', borderRadius: 'var(--radius-sm)', padding: '8px 6px' }}>
                          <p style={{ fontSize: 11, color: '#534AB7', marginBottom: 2 }}>{item.label}</p>
                          <p style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700, color: '#3C3489' }}>{(item.val * 100).toFixed(1)}%</p>
                        </div>
                      ))}
                    </div>

                    <p style={{ fontSize: 12, color: '#534AB7', fontStyle: 'italic', lineHeight: 1.5 }}>
                      {t('analysis.v3tooltip')}
                    </p>
                    <p style={{ fontSize: 11, color: '#534AB7', marginTop: 4 }}>
                      {t('analysis.dcFittedDate')}2026-06-15 · 15,508 {t('analysis.v3badge').split('·')[1]?.trim()}
                    </p>
                  </div>
                )}

                {/* Data source note */}
                {hasAnyStats && (
                  <p style={{ fontSize: 15, color: 'var(--color-text-secondary)', textAlign: 'center', marginTop: 16 }}>
                    Source: API-Football · {stats.home?.games_window || 0}-game window (MT06 requires 5)
                  </p>
                )}
              </>
            )}
          </div>
        )}

        {/* Legacy tabs — kept for reference, not rendered in 2-tab UI */}
        {false && activeTab === 'matrix' && <TabMatrix stats={stats} match={match} dixonColes={dixonColes} onToggleDixon={setDixonColes} />}
        {false && activeTab === 'value' && <TabValue stats={stats} match={match} odds={v1x2Odds} setOdds={setV1x2Odds} />}
        {false && activeTab === 'asian' && <TabAsian stats={stats} match={match} />}
        {false && activeTab === 'portfolio' && <TabPortfolio stats={stats} match={match} odds1x2={v1x2Odds} />}
        {false && activeTab === 'ai' && <TabAI match={match} isAdmin={canRunAI} onAnalysisComplete={refreshProfile} />}

        {isAdmin && <SettlementPanel match={match} onSyncComplete={refreshStats} />}
        </div>
      </div>

      {/* ── Right panel (desktop): live summary ── */}
      <aside className="analysis-right">
        <FinalSignal ev1x2={sidebarEv} aiComposite={aiComposite} match={match} />
        <div style={{ background: 'var(--color-bg-card)', border: '0.5px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '16px 14px' }}>
          <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-blue)', letterSpacing: '0.06em', marginBottom: 12 }}>SUMMARY</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <ConfBadge confCfg={confCfg} confidence={confidence} t={t} />
            <p style={{ fontSize: 14, color: 'var(--color-text-secondary)' }}>{confCfg.desc}</p>
            {lastUpdated && (
              <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
                Updated {new Date(lastUpdated).toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' })}
              </p>
            )}
          </div>
        </div>
      </aside>
    </div>
  )
}

// Team row — flags + names + score/vs. Reused in left rail and mobile head.
function MatchTeams({ match, t }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, marginBottom: 12, flexWrap: 'wrap' }}>
      <div style={{ textAlign: 'center', flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: 36, lineHeight: 1 }}>{getFlag(match.home_team)}</p>
        <p style={{ fontFamily: 'var(--font-display)', fontSize: 19, fontWeight: 600, color: 'var(--color-text-primary)', marginTop: 4 }}>{match.home_team}</p>
        <p style={{ fontSize: 15, color: 'var(--color-text-muted)' }}>{t('analysis.home')}</p>
      </div>
      <div style={{ textAlign: 'center', flexShrink: 0 }}>
        <p style={{ fontFamily: 'var(--font-display)', fontSize: 19, fontWeight: 400, color: 'var(--color-text-muted)' }}>
          {match.home_score !== null ? `${match.home_score} – ${match.away_score}` : 'vs'}
        </p>
      </div>
      <div style={{ textAlign: 'center', flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: 36, lineHeight: 1 }}>{getFlag(match.away_team)}</p>
        <p style={{ fontFamily: 'var(--font-display)', fontSize: 19, fontWeight: 600, color: 'var(--color-text-primary)', marginTop: 4 }}>{match.away_team}</p>
        <p style={{ fontSize: 15, color: 'var(--color-text-muted)' }}>{t('analysis.away')}</p>
      </div>
    </div>
  )
}

// Confidence pill — reused in header and right panel.
function ConfBadge({ confCfg, confidence, t }) {
  return (
    <span style={{ fontSize: 14, fontWeight: 600, color: confCfg.color, background: 'var(--color-bg-card)', border: `0.5px solid ${confCfg.color}`, borderRadius: 'var(--radius-full)', padding: '4px 12px' }}>
      {confCfg.icon} {t(`confidence.${confidence}`)}
    </span>
  )
}

// Tab nav — horizontal (mobile) or vertical (desktop rail).
function TabNav({ tabs, activeTab, setActiveTab, vertical, t }) {
  return (
    <div style={{ display: 'flex', flexDirection: vertical ? 'column' : 'row', gap: vertical ? 4 : 0, marginBottom: vertical ? 0 : -1 }}>
      {tabs.map(tab => {
        const active = activeTab === tab
        return (
          <button key={tab} onClick={() => setActiveTab(tab)} style={{
            flex: vertical ? undefined : 1, textAlign: vertical ? 'left' : 'center', minHeight: 40,
            background: vertical && active ? 'var(--color-accent-dim)' : 'none', border: 'none',
            borderBottom: vertical ? 'none' : active ? '2px solid var(--color-accent)' : '2px solid transparent',
            borderLeft: vertical ? (active ? '3px solid var(--color-accent)' : '3px solid transparent') : 'none',
            borderRadius: vertical ? 'var(--radius-sm)' : 0,
            color: active ? 'var(--color-accent)' : 'var(--color-text-muted)',
            fontFamily: 'var(--font-ui)', fontSize: 15, fontWeight: active ? 600 : 400, cursor: 'pointer', padding: vertical ? '10px 12px' : '8px 4px',
          }}>{t(`analysis.${tab}`)}</button>
        )
      })}
    </div>
  )
}

// Admin: record final score → status finished. Bets settle on owner's My Bets view.
function SettlementPanel({ match, onSyncComplete }) {
  const { t } = useTranslation()
  const [h, setH] = useState(match.home_score ?? '')
  const [a, setA] = useState(match.away_score ?? '')
  const [penaltiesWinner, setPenaltiesWinner] = useState('')
  const [msg, setMsg] = useState('')
  const save = async () => {
    const hs = parseInt(h, 10), as = parseInt(a, 10)
    if (Number.isNaN(hs) || Number.isNaN(as)) return
    const isKnockout = ['r32', 'r16', 'qf', 'sf', 'final'].includes(match.stage)
    const isDraw = hs === as
    if (isKnockout && isDraw && !penaltiesWinner) {
      alert('Please select the penalty shootout winner for this knockout draw.')
      return
    }
    setMsg(t('settle.settling'))
    const { data: { session } } = await supabase.auth.getSession()
    try {
      const r = await fetch('/api/settle-match', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session?.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          match_id: match.id,
          home_score: hs,
          away_score: as,
          penalties_winner: (isKnockout && isDraw && penaltiesWinner) ? penaltiesWinner : null,
        }),
      })
      const d = await r.json()
      if (!r.ok) { setMsg(`Failed: ${d.error}${d.detail ? ' — ' + d.detail : ''}`); return }
      setMsg(`✓ Settled: ${match.home_team} ${hs} – ${as} ${match.away_team} · ${d.settled}/${d.pending} bets settled`)
      setPenaltiesWinner('')
      onSyncComplete?.()
    } catch { setMsg('Save failed') }
  }
  const inp = { width: 56, fontSize: 18, fontWeight: 700, minHeight: 44, textAlign: 'center', borderRadius: 'var(--radius-sm)', background: 'var(--color-bg)', color: 'var(--color-text-primary)', border: '0.5px solid var(--color-border-active)' }
  const teamLabel = { fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', marginBottom: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 100 }
  const showPenalties = !Number.isNaN(parseInt(h, 10)) && !Number.isNaN(parseInt(a, 10))
    && parseInt(h, 10) === parseInt(a, 10)
    && ['r32', 'r16', 'qf', 'sf', 'final'].includes(match.stage)
  return (
    <div style={{ marginTop: 20, background: 'var(--color-bg-card)', border: '0.5px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '14px 16px' }}>
      <p style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-text-muted)', letterSpacing: '0.06em', marginBottom: 12 }}>{t('settle.title').toUpperCase()}</p>
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <p style={teamLabel}>{getFlag(match.home_team)} {match.home_team}</p>
          <input type="number" min="0" value={h} onChange={e => setH(e.target.value)} style={inp} />
        </div>
        <span style={{ color: 'var(--color-text-muted)', fontSize: 18, paddingBottom: 10 }}>–</span>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <p style={teamLabel}>{getFlag(match.away_team)} {match.away_team}</p>
          <input type="number" min="0" value={a} onChange={e => setA(e.target.value)} style={inp} />
        </div>
        <button onClick={save} style={{ minHeight: 44, padding: '0 16px', fontWeight: 700, background: 'var(--color-accent)', color: 'var(--color-bg)', border: 'none', borderRadius: 'var(--radius-sm)', alignSelf: 'flex-end' }}>{t('settle.save')}</button>
      </div>
      {showPenalties && (
        <div style={{ marginTop: 12 }}>
          <label style={{ fontSize: 11, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 }}>
            Penalty Shootout Winner
          </label>
          <select
            value={penaltiesWinner}
            onChange={e => setPenaltiesWinner(e.target.value)}
            style={{ width: '100%', padding: '8px 10px', background: 'var(--color-bg)', border: '0.5px solid var(--color-border-active)', borderRadius: 'var(--radius-sm)', color: 'var(--color-text-primary)', fontSize: 13 }}
          >
            <option value=''>— Select winner —</option>
            <option value={match.home_team}>{match.home_team}</option>
            <option value={match.away_team}>{match.away_team}</option>
          </select>
        </div>
      )}
      {msg && <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 8 }}>{msg}</p>}
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
