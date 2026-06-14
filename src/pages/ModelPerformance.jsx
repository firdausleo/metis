import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { toBeijingTime } from '../lib/dateUtils'

// ── Constants ─────────────────────────────────────────────────────────────

const SH = {
  fontSize: 11, fontWeight: 700, letterSpacing: '0.08em',
  color: 'var(--color-accent)', textTransform: 'uppercase',
  borderBottom: '1px solid var(--color-accent)',
  paddingBottom: 6, marginBottom: 12, display: 'block',
}

const TH = {
  fontSize: 11, fontWeight: 700, letterSpacing: '0.05em',
  color: 'var(--color-text-muted)', padding: '0 12px 10px 0',
  textAlign: 'left', whiteSpace: 'nowrap',
}

const TD = {
  fontSize: 13, padding: '9px 12px 9px 0',
  borderBottom: '1px solid var(--color-border-light)',
  color: 'var(--color-text-secondary)', verticalAlign: 'middle',
}

// ── Pure helpers ───────────────────────────────────────────────────────────

function predLabel(rec) {
  switch (rec) {
    case 'home_win':   case 'value_home': return 'HOME WIN'
    case 'away_win':   case 'value_away': return 'AWAY WIN'
    case 'draw':                          return 'DRAW'
    case 'over':                          return 'OVER 2.5'
    case 'under':                         return 'UNDER 2.5'
    default: return rec ? rec.toUpperCase().replace(/_/g, ' ') : '—'
  }
}

function actualOutcome(actual_json) {
  if (!actual_json) return null
  const h = actual_json.home_score, a = actual_json.away_score
  if (h == null || a == null) return null
  if (h > a) return { label: 'HOME WIN', score: `${h}–${a}` }
  if (a > h) return { label: 'AWAY WIN', score: `${h}–${a}` }
  return { label: 'DRAW', score: `${h}–${a}` }
}

function hitRateColor(rate) {
  if (rate == null) return 'var(--color-text-muted)'
  if (rate >= 0.70) return 'var(--color-success)'
  if (rate >= 0.50) return 'var(--color-edge-amber)'
  return 'var(--color-danger)'
}

function trendArrow(rows) {
  if (rows.length < 3) return null
  const recent = rows.slice(0, 5)
  const recentRate = recent.filter(r => Number(r.accuracy_score) >= 1).length / recent.length
  const overall = rows.filter(r => Number(r.accuracy_score) >= 1).length / rows.length
  if (recentRate > overall + 0.1) return { char: '↑', color: 'var(--color-success)' }
  if (recentRate < overall - 0.1) return { char: '↓', color: 'var(--color-danger)' }
  return { char: '→', color: 'var(--color-text-muted)' }
}

function fmtDate(ts) {
  if (!ts) return '—'
  try {
    return toBeijingTime(ts, 'date')
  } catch {
    return ts.slice(0, 10)
  }
}

function fmtDateTime(ts) {
  if (!ts) return '—'
  try {
    const date = new Date(ts)
    return date.toLocaleDateString('en-US', {
      timeZone: 'Asia/Shanghai', month: 'short', day: 'numeric',
    })
  } catch {
    return ts.slice(5, 10)
  }
}

// ── Sub-components ─────────────────────────────────────────────────────────

function SummaryPill({ label, value, valueColor }) {
  return (
    <div style={{
      flex: 1, background: 'var(--color-bg-card)',
      border: '1px solid var(--color-border)', borderRadius: 8,
      padding: '12px 24px',
    }}>
      <span style={{
        fontSize: 10, fontWeight: 700, letterSpacing: '0.06em',
        color: 'var(--color-text-muted)', textTransform: 'uppercase',
        display: 'block', marginBottom: 5,
      }}>
        {label}
      </span>
      <span style={{
        fontSize: 22, fontWeight: 700, display: 'block',
        color: valueColor || 'var(--color-text-primary)',
      }}>
        {value}
      </span>
    </div>
  )
}

function SkeletonRow({ height = 40 }) {
  return <div className="skeleton" style={{ height, borderRadius: 4, marginBottom: 8 }} />
}

function CalibrationBadge({ multiplier }) {
  if (multiplier == null) return <span style={{ color: 'var(--color-text-muted)' }}>—</span>
  const m = Number(multiplier)
  const color = m > 1.0 ? 'var(--color-success)' : m < 1.0 ? 'var(--color-danger)' : 'var(--color-text-muted)'
  return (
    <span style={{ fontFamily: 'monospace', fontWeight: 700, color, fontSize: 13 }}>
      ×{m.toFixed(2)}
      {m > 1.0 && <span style={{ fontSize: 10, marginLeft: 4, opacity: 0.8 }}>↑</span>}
      {m < 1.0 && <span style={{ fontSize: 10, marginLeft: 4, opacity: 0.8 }}>↓</span>}
    </span>
  )
}

// ── Main component ─────────────────────────────────────────────────────────

export default function ModelPerformance() {
  const navigate = useNavigate()
  const [wide, setWide] = useState(() => window.innerWidth >= 1024)
  const [loading, setLoading] = useState(true)
  const [accuracyRows, setAccuracyRows] = useState([])
  const [aiRoles, setAiRoles] = useState([])
  const [calibration, setCalibration] = useState([])

  useEffect(() => {
    const handler = () => setWide(window.innerWidth >= 1024)
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [])

  useEffect(() => {
    async function load() {
      const [accRes, rolesRes, calRes] = await Promise.all([
        supabase
          .from('role_accuracy')
          .select('*, role:ai_roles(role_number,role_name), match:matches(home_team,away_team,home_score,away_score,match_date)')
          .not('accuracy_score', 'is', null)
          .order('settled_at', { ascending: false }),
        supabase
          .from('ai_roles')
          .select('id,role_number,role_name,model')
          .order('role_number'),
        supabase
          .from('role_calibration')
          .select('*, role:ai_roles(role_number,role_name)')
          .order('role_id'),
      ])
      setAccuracyRows(accRes.data || [])
      setAiRoles(rolesRes.data || [])
      setCalibration(calRes.data || [])
      setLoading(false)
    }
    load().catch(console.error)
  }, [])

  // ── Aggregates ─────────────────────────────────────────────────────────

  const totalPredictions = accuracyRows.length
  const totalCorrect = accuracyRows.filter(r => Number(r.accuracy_score) >= 1).length
  const totalWrong = accuracyRows.filter(r => Number(r.accuracy_score) === 0).length
  const overallHitRate = totalPredictions ? Math.round((totalCorrect / totalPredictions) * 100) : null

  // Per-role stats (group rows by role_number)
  const byRole = {}
  for (const r of accuracyRows) {
    const rn = r.role?.role_number
    const name = r.role?.role_name
    if (rn == null) continue
    if (!byRole[rn]) byRole[rn] = { roleNumber: rn, roleName: name, total: 0, correct: 0, rows: [] }
    byRole[rn].total++
    if (Number(r.accuracy_score) >= 1) byRole[rn].correct++
    byRole[rn].rows.push(r)
  }

  const roleStats = Object.values(byRole)
    .map(r => ({
      ...r,
      hitRate: r.total ? r.correct / r.total : null,
      trend: trendArrow(r.rows),
    }))
    .sort((a, b) => (b.hitRate ?? -1) - (a.hitRate ?? -1))

  const bestRoleNumber  = roleStats.length ? roleStats[0].roleNumber  : null
  const worstRoleNumber = roleStats.length ? roleStats[roleStats.length - 1].roleNumber : null

  // Also include roles from ai_roles that have no accuracy rows yet
  const roleStatsByNumber = {}
  for (const rs of roleStats) roleStatsByNumber[rs.roleNumber] = rs

  const allRoleRows = aiRoles
    .filter(r => r.role_number !== 11) // exclude Learning Loop from performance table
    .map(r => roleStatsByNumber[r.role_number] || { roleNumber: r.role_number, roleName: r.role_name, total: 0, correct: 0, rows: [], hitRate: null, trend: null })
    .sort((a, b) => (b.hitRate ?? -1) - (a.hitRate ?? -1))

  // Recent predictions (last 20)
  const recentPredictions = accuracyRows.slice(0, 20)

  // Calibration last-ran
  const lastCalibration = calibration.length
    ? calibration.reduce((a, b) => new Date(b.updated_at) > new Date(a.updated_at) ? b : a)
    : null

  const calByRoleId = {}
  for (const c of calibration) calByRoleId[c.role_id] = c

  // ── RENDER ──────────────────────────────────────────────────────────────

  return (
    <div style={{ padding: wide ? '32px 40px' : '16px', maxWidth: 1200 }}>

      {/* Back link */}
      <button
        onClick={() => navigate('/')}
        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', fontSize: 12, padding: 0, marginBottom: 16, fontFamily: 'inherit' }}
      >
        ← Dashboard
      </button>

      {/* Header */}
      <h1 style={{ fontSize: wide ? 22 : 18, fontWeight: 700, color: 'var(--color-text-primary)', marginBottom: 4 }}>
        Model Performance Review
      </h1>
      <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 24 }}>
        Tracking prediction accuracy across all settled matches
      </p>

      {/* ── ROW 1: Summary pills ── */}
      <div style={{ display: 'flex', gap: wide ? 12 : 8, flexWrap: 'wrap', marginBottom: 28 }}>
        <SummaryPill label="Total Predictions" value={loading ? '—' : String(totalPredictions)} />
        <SummaryPill
          label="Correct"
          value={loading ? '—' : String(totalCorrect)}
          valueColor="var(--color-success)"
        />
        <SummaryPill
          label="Wrong"
          value={loading ? '—' : String(totalWrong)}
          valueColor={totalWrong > 0 ? 'var(--color-danger)' : 'var(--color-text-primary)'}
        />
        <SummaryPill
          label="Hit Rate"
          value={loading ? '—' : overallHitRate == null ? '—' : `${overallHitRate}%`}
          valueColor={overallHitRate == null ? 'var(--color-text-muted)' : hitRateColor(overallHitRate / 100)}
        />
      </div>

      {loading ? (
        <div>
          {[1,2,3,4,5].map(i => <SkeletonRow key={i} />)}
        </div>
      ) : totalPredictions === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--color-text-muted)' }}>
          <p style={{ fontSize: 14, marginBottom: 8 }}>No settled predictions yet</p>
          <p style={{ fontSize: 12 }}>Performance is tracked automatically after match settlement</p>
        </div>
      ) : (
        <>
          {/* ── ROW 2: Role table | Recent predictions ── */}
          <div style={{ display: 'flex', gap: 24, marginBottom: 28, flexDirection: wide ? 'row' : 'column' }}>

            {/* LEFT: Performance by Role */}
            <div style={{ flex: wide ? '0 0 440px' : '1', minWidth: 0 }}>
              <span style={SH}>Performance by Role</span>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={{ ...TH, width: 28 }}>#</th>
                      <th style={TH}>Role</th>
                      <th style={{ ...TH, textAlign: 'right' }}>Preds</th>
                      <th style={{ ...TH, textAlign: 'right' }}>✓</th>
                      <th style={{ ...TH, textAlign: 'right' }}>Hit Rate</th>
                      <th style={{ ...TH, textAlign: 'center' }}>Trend</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allRoleRows.map(rs => {
                      const isBest  = rs.total > 0 && rs.roleNumber === bestRoleNumber
                      const isWorst = rs.total > 0 && rs.roleNumber === worstRoleNumber && rs.roleNumber !== bestRoleNumber
                      const rateStr = rs.hitRate == null ? '—' : `${Math.round(rs.hitRate * 100)}%`
                      return (
                        <tr key={rs.roleNumber}>
                          <td style={{ ...TD, color: 'var(--color-text-muted)', fontWeight: 600, fontSize: 11 }}>
                            {rs.roleNumber}
                          </td>
                          <td style={TD}>
                            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                              <span style={{ fontWeight: 600, color: 'var(--color-text-primary)' }}>
                                {rs.roleName}
                              </span>
                              {isBest  && <span style={{ color: 'var(--color-accent)', fontSize: 12 }} title="Best performing role">★</span>}
                              {isWorst && <span style={{ color: 'var(--color-danger)',  fontSize: 12 }} title="Needs improvement">⚠</span>}
                            </span>
                          </td>
                          <td style={{ ...TD, textAlign: 'right', fontFamily: 'monospace' }}>{rs.total || '—'}</td>
                          <td style={{ ...TD, textAlign: 'right', fontFamily: 'monospace', color: rs.correct > 0 ? 'var(--color-success)' : 'var(--color-text-muted)' }}>
                            {rs.total ? rs.correct : '—'}
                          </td>
                          <td style={{ ...TD, textAlign: 'right', fontWeight: 700, color: hitRateColor(rs.hitRate) }}>
                            {rateStr}
                          </td>
                          <td style={{ ...TD, textAlign: 'center', fontWeight: 700 }}>
                            {rs.trend
                              ? <span style={{ color: rs.trend.color, fontSize: 14 }}>{rs.trend.char}</span>
                              : <span style={{ color: 'var(--color-text-muted)', fontSize: 11 }}>—</span>
                            }
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <p style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 10, lineHeight: 1.6 }}>
                <span style={{ color: 'var(--color-success)', fontWeight: 700 }}>Green</span> ≥70% ·{' '}
                <span style={{ color: 'var(--color-edge-amber)', fontWeight: 700 }}>Amber</span> 50–69% ·{' '}
                <span style={{ color: 'var(--color-danger)', fontWeight: 700 }}>Red</span> &lt;50% ·{' '}
                Trend compares last 5 vs overall
              </p>
            </div>

            {/* RIGHT: Performance over time */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <span style={SH}>Recent Predictions</span>
              {recentPredictions.length === 0 ? (
                <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>No predictions to show</p>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>
                        <th style={TH}>Date</th>
                        <th style={TH}>Match</th>
                        <th style={TH}>Role</th>
                        <th style={TH}>Predicted</th>
                        <th style={TH}>Actual</th>
                        <th style={{ ...TH, textAlign: 'center' }}>Result</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recentPredictions.map(row => {
                        const correct = Number(row.accuracy_score) >= 1
                        const pred = predLabel(row.predicted_json?.recommendation)
                        const actual = actualOutcome(row.actual_json)
                        const matchName = row.match
                          ? `${row.match.home_team} vs ${row.match.away_team}`
                          : '—'
                        return (
                          <tr key={row.id}>
                            <td style={{ ...TD, whiteSpace: 'nowrap', color: 'var(--color-text-muted)', fontSize: 11, fontFamily: 'monospace' }}>
                              {fmtDateTime(row.settled_at)}
                            </td>
                            <td style={{ ...TD, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {matchName}
                            </td>
                            <td style={{ ...TD, fontSize: 11, color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>
                              {row.role?.role_name || '—'}
                            </td>
                            <td style={{ ...TD, fontWeight: 600, whiteSpace: 'nowrap', fontSize: 12 }}>
                              {pred}
                            </td>
                            <td style={{ ...TD, fontSize: 12, whiteSpace: 'nowrap', color: 'var(--color-text-muted)' }}>
                              {actual ? `${actual.label} (${actual.score})` : '—'}
                            </td>
                            <td style={{ ...TD, textAlign: 'center', fontSize: 15, fontWeight: 700 }}>
                              <span style={{ color: correct ? 'var(--color-success)' : 'var(--color-danger)' }}>
                                {correct ? '✓' : '✗'}
                              </span>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          {/* ── BOTTOM: Calibration insights ── */}
          <div>
            <span style={SH}>Calibration Insights</span>
            {calibration.length === 0 ? (
              <div>
                <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 8 }}>
                  No calibration data yet — run the learning loop to generate role multipliers
                </p>
                <p style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                  The learning loop (Role 11) analyses accumulated predictions and writes confidence multipliers per role. Trigger via POST /api/learning-loop after sufficient settlements.
                </p>
              </div>
            ) : (
              <>
                <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 16 }}>
                  Role 11 Learning Loop last ran:{' '}
                  <span style={{ color: 'var(--color-text-primary)', fontWeight: 600 }}>
                    {lastCalibration ? fmtDate(lastCalibration.updated_at) : '—'}
                  </span>
                  {' '}· Roles with multiplier &lt;1.0 are being down-weighted · &gt;1.0 are being up-weighted
                </p>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', maxWidth: wide ? 800 : '100%' }}>
                    <thead>
                      <tr>
                        <th style={TH}>Role</th>
                        <th style={{ ...TH, textAlign: 'right' }}>Sample</th>
                        <th style={{ ...TH, textAlign: 'right' }}>Hit Rate</th>
                        <th style={{ ...TH, textAlign: 'center' }}>Multiplier</th>
                        <th style={TH}>Status</th>
                        <th style={{ ...TH, maxWidth: 300 }}>Bias Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {calibration
                        .slice()
                        .sort((a, b) => (a.role?.role_number ?? 99) - (b.role?.role_number ?? 99))
                        .map(c => {
                          const m = Number(c.confidence_multiplier)
                          const status = m > 1.0 ? 'Up-weighted' : m < 1.0 ? 'Down-weighted' : 'Neutral'
                          const statusColor = m > 1.0 ? 'var(--color-success)' : m < 1.0 ? 'var(--color-danger)' : 'var(--color-text-muted)'
                          return (
                            <tr key={c.role_id}>
                              <td style={{ ...TD, fontWeight: 600, color: 'var(--color-text-primary)' }}>
                                {c.role?.role_name || '—'}
                              </td>
                              <td style={{ ...TD, textAlign: 'right', fontFamily: 'monospace' }}>
                                {c.sample_size ?? '—'}
                              </td>
                              <td style={{ ...TD, textAlign: 'right', fontWeight: 700, color: hitRateColor(c.hit_rate) }}>
                                {c.hit_rate != null ? `${Math.round(Number(c.hit_rate) * 100)}%` : '—'}
                              </td>
                              <td style={{ ...TD, textAlign: 'center' }}>
                                <CalibrationBadge multiplier={c.confidence_multiplier} />
                              </td>
                              <td style={{ ...TD, color: statusColor, fontSize: 12, fontWeight: 600 }}>
                                {status}
                              </td>
                              <td style={{ ...TD, fontSize: 12, color: 'var(--color-text-muted)', maxWidth: 280, whiteSpace: 'normal', lineHeight: 1.5 }}>
                                {c.bias_notes || '—'}
                              </td>
                            </tr>
                          )
                        })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}
