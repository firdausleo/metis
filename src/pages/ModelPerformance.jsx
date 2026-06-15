import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

// ── Constants ─────────────────────────────────────────────────────────────

const PRED_TYPES = [
  { key: '1x2',          label: '1X2' },
  { key: 'total_goals',  label: 'Total Goals' },
  { key: 'correct_score',label: 'Correct Score' },
]

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
  return new Date(ts).toLocaleDateString('en-US', {
    timeZone: 'Asia/Shanghai', month: 'short', day: 'numeric',
  })
}

function predDisplay(predicted, type) {
  if (!predicted) return '—'
  if (type === '1x2') {
    return predicted === 'home_win' ? 'Home Win'
         : predicted === 'away_win' ? 'Away Win'
         : 'Draw'
  }
  if (type === 'total_goals') {
    const [side, line] = predicted.split('_').length === 2
      ? predicted.split('_')
      : [predicted.slice(0, predicted.indexOf('_')), predicted.slice(predicted.indexOf('_') + 1)]
    return `${side === 'over' ? 'Over' : 'Under'} ${line}`
  }
  return predicted   // correct_score: '2-1' etc.
}

function actualDisplay(actual, type, matchRow) {
  if (!actual) return '—'
  if (type === '1x2') {
    const base = actual === 'home_win' ? 'Home Win'
               : actual === 'away_win' ? 'Away Win'
               : 'Draw'
    if (matchRow?.home_score != null) return `${base} (${matchRow.home_score}–${matchRow.away_score})`
    return base
  }
  if (type === 'total_goals') {
    const parts = actual.split('_')
    const side = parts[0]
    const line = parts.slice(1).join('_')
    const score = matchRow?.home_score != null ? ` (${Number(matchRow.home_score) + Number(matchRow.away_score)} goals)` : ''
    return `${side === 'over' ? 'Over' : 'Under'} ${line}${score}`
  }
  // correct_score
  if (matchRow?.home_score != null) return `${matchRow.home_score}–${matchRow.away_score}`
  return actual
}

// ── Sub-components ─────────────────────────────────────────────────────────

function SkeletonRow({ height = 40 }) {
  return <div className="skeleton" style={{ height, borderRadius: 4, marginBottom: 8 }} />
}

function MiniPill({ label, value, valueColor }) {
  return (
    <div style={{ flex: 1, background: 'var(--color-bg-card)', border: '1px solid var(--color-border)', borderRadius: 8, padding: '10px 18px' }}>
      <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--color-text-muted)', textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>
        {label}
      </span>
      <span style={{ fontSize: 20, fontWeight: 700, display: 'block', color: valueColor || 'var(--color-text-primary)' }}>
        {value}
      </span>
    </div>
  )
}

function SummaryPill({ label, value, valueColor }) {
  return (
    <div style={{ flex: 1, background: 'var(--color-bg-card)', border: '1px solid var(--color-border)', borderRadius: 8, padding: '12px 24px' }}>
      <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--color-text-muted)', textTransform: 'uppercase', display: 'block', marginBottom: 5 }}>
        {label}
      </span>
      <span style={{ fontSize: 22, fontWeight: 700, display: 'block', color: valueColor || 'var(--color-text-primary)' }}>
        {value}
      </span>
    </div>
  )
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

// ── Model predictions tab panel ────────────────────────────────────────────

function PredTab({ rows, type, wide }) {
  const correct = rows.filter(r => r.correct).length
  const total = rows.length
  const hitRate = total ? correct / total : null

  // correct score: annotate the typical expected range
  const csNote = type === 'correct_score'
    ? ' (correct score is hard — 5–15% is typical)'
    : ''

  return (
    <div>
      {/* Mini pills */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
        <MiniPill label="Predictions" value={String(total)} />
        <MiniPill label="Correct" value={String(correct)} valueColor="var(--color-success)" />
        <MiniPill
          label="Hit Rate"
          value={hitRate == null ? '—' : `${Math.round(hitRate * 100)}%`}
          valueColor={hitRateColor(hitRate)}
        />
      </div>
      {total === 0 ? (
        <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
          No settled predictions yet — settle a match via /api/settle-match to populate this.
        </p>
      ) : (
        <>
          {csNote && (
            <p style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 12 }}>
              ℹ{csNote}
            </p>
          )}
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={TH}>Date</th>
                  <th style={TH}>Match</th>
                  <th style={TH}>Predicted</th>
                  {type !== 'correct_score' && <th style={{ ...TH }}>Prob</th>}
                  <th style={TH}>Actual</th>
                  {type === 'correct_score' && <th style={{ ...TH, fontFamily: 'monospace' }}>λ</th>}
                  <th style={{ ...TH, textAlign: 'center' }}>Result</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 25).map(row => (
                  <tr key={row.id}>
                    <td style={{ ...TD, whiteSpace: 'nowrap', color: 'var(--color-text-muted)', fontSize: 11, fontFamily: 'monospace' }}>
                      {fmtDate(row.settled_at)}
                    </td>
                    <td style={{ ...TD, maxWidth: wide ? 180 : 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {row.match ? `${row.match.home_team} vs ${row.match.away_team}` : '—'}
                    </td>
                    <td style={{ ...TD, fontWeight: 600, whiteSpace: 'nowrap' }}>
                      {predDisplay(row.predicted, type)}
                    </td>
                    {type !== 'correct_score' && (
                      <td style={{ ...TD, fontFamily: 'monospace', color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>
                        {row.predicted_prob != null ? `${Math.round(Number(row.predicted_prob) * 100)}%` : '—'}
                      </td>
                    )}
                    <td style={{ ...TD, whiteSpace: 'nowrap', color: 'var(--color-text-muted)' }}>
                      {actualDisplay(row.actual, type, row.match)}
                    </td>
                    {type === 'correct_score' && (
                      <td style={{ ...TD, fontFamily: 'monospace', fontSize: 11, color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>
                        {row.lambda_home != null ? `${Number(row.lambda_home).toFixed(2)}–${Number(row.lambda_away).toFixed(2)}` : '—'}
                      </td>
                    )}
                    <td style={{ ...TD, textAlign: 'center', fontSize: 15, fontWeight: 700 }}>
                      <span style={{ color: row.correct ? 'var(--color-success)' : 'var(--color-danger)' }}>
                        {row.correct ? '✓' : '✗'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────

export default function ModelPerformance() {
  const navigate = useNavigate()
  const [wide, setWide] = useState(() => window.innerWidth >= 1024)
  const [loading, setLoading] = useState(true)

  // model_predictions (3 prediction types — legacy schema)
  const [modelPreds, setModelPreds]     = useState([])
  const [activeTab, setActiveTab]       = useState('1x2')
  // model_predictions v2 — settled rows with V1/V2/V3 columns
  const [liveAccuracy, setLiveAccuracy] = useState([])

  // role_accuracy (role-level 1X2 tracking)
  const [accuracyRows, setAccuracyRows] = useState([])
  const [aiRoles, setAiRoles]           = useState([])
  const [calibration, setCalibration]   = useState([])

  useEffect(() => {
    const handler = () => setWide(window.innerWidth >= 1024)
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [])

  useEffect(() => {
    async function load() {
      const [predsRes, liveRes, accRes, rolesRes, calRes] = await Promise.all([
        supabase
          .from('model_predictions')
          .select('*, match:matches(home_team,away_team,home_score,away_score,match_date)')
          .not('prediction_type', 'is', null)
          .order('settled_at', { ascending: false }),
        supabase
          .from('model_predictions')
          .select('*, match:matches(home_team,away_team,home_score,away_score,match_date)')
          .not('settled_at', 'is', null)
          .not('v3_home_win', 'is', null)
          .order('settled_at', { ascending: false }),
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
      setModelPreds(predsRes.data || [])
      setLiveAccuracy(liveRes.data || [])
      setAccuracyRows(accRes.data || [])
      setAiRoles(rolesRes.data || [])
      setCalibration(calRes.data || [])
      setLoading(false)
    }
    load().catch(console.error)
  }, [])

  // ── model_predictions aggregates ────────────────────────────────────────

  const predsByType = {}
  for (const TYPE of PRED_TYPES) predsByType[TYPE.key] = []
  for (const r of modelPreds) {
    if (predsByType[r.prediction_type]) predsByType[r.prediction_type].push(r)
  }

  const totalModelPreds = modelPreds.length
  const totalModelCorrect = modelPreds.filter(r => r.correct).length
  const overallModelRate = totalModelPreds ? totalModelCorrect / totalModelPreds : null

  // ── role_accuracy aggregates ─────────────────────────────────────────────

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
    .map(r => ({ ...r, hitRate: r.total ? r.correct / r.total : null, trend: trendArrow(r.rows) }))
    .sort((a, b) => (b.hitRate ?? -1) - (a.hitRate ?? -1))

  const bestRoleNumber  = roleStats.length ? roleStats[0].roleNumber : null
  const worstRoleNumber = roleStats.length ? roleStats[roleStats.length - 1].roleNumber : null

  const roleStatsByNumber = {}
  for (const rs of roleStats) roleStatsByNumber[rs.roleNumber] = rs

  const allRoleRows = aiRoles
    .filter(r => r.role_number !== 11)
    .map(r => roleStatsByNumber[r.role_number] || { roleNumber: r.role_number, roleName: r.role_name, total: 0, correct: 0, rows: [], hitRate: null, trend: null })
    .sort((a, b) => (b.hitRate ?? -1) - (a.hitRate ?? -1))

  const lastCalibration = calibration.length
    ? calibration.reduce((a, b) => new Date(b.updated_at) > new Date(a.updated_at) ? b : a)
    : null

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div style={{ padding: wide ? '32px 40px' : '16px', maxWidth: 1200 }}>

      {/* Back link */}
      <button
        onClick={() => navigate('/')}
        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', fontSize: 12, padding: 0, marginBottom: 16, fontFamily: 'inherit' }}
      >
        ← Dashboard
      </button>

      <h1 style={{ fontSize: wide ? 22 : 18, fontWeight: 700, color: 'var(--color-text-primary)', marginBottom: 4 }}>
        Model Performance Review
      </h1>
      <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 28 }}>
        Tracking prediction accuracy across all settled matches
      </p>

      {loading ? (
        <div>{[1,2,3,4,5].map(i => <SkeletonRow key={i} />)}</div>
      ) : (
        <>
          {/* ── SECTION 0: Live WC2026 Accuracy (v2 schema: single row per match) ── */}
          {(() => {
            const settled = liveAccuracy
            const n = settled.length
            if (n === 0) return null
            const v1c = settled.filter(r => r.correct_v1).length
            const v2c = settled.filter(r => r.correct_v2).length
            const v3c = settled.filter(r => r.correct_v3).length
            const avgBrier = n ? settled.reduce((s, r) => s + (Number(r.brier_score) || 0), 0) / n : null
            const avgRps   = n ? settled.reduce((s, r) => s + (Number(r.rps_score)   || 0), 0) / n : null

            return (
              <div style={{ marginBottom: 36 }}>
                <span style={SH}>Live WC2026 Accuracy</span>

                {/* Summary pills */}
                <div style={{ display: 'flex', gap: wide ? 12 : 8, flexWrap: 'wrap', marginBottom: 20 }}>
                  <SummaryPill label="Matches settled" value={String(n)} />
                  <SummaryPill
                    label="V1 1X2"
                    value={`${v1c}/${n} (${Math.round(v1c/n*100)}%)`}
                    valueColor={hitRateColor(v1c / n)}
                  />
                  <SummaryPill
                    label="V2 1X2"
                    value={`${v2c}/${n} (${Math.round(v2c/n*100)}%)`}
                    valueColor={hitRateColor(v2c / n)}
                  />
                  <SummaryPill
                    label="V3 1X2 ★"
                    value={`${v3c}/${n} (${Math.round(v3c/n*100)}%)`}
                    valueColor={hitRateColor(v3c / n)}
                  />
                  {avgBrier != null && (
                    <SummaryPill
                      label="V3 Brier"
                      value={avgBrier.toFixed(3)}
                      valueColor={avgBrier < 0.5 ? 'var(--color-success)' : avgBrier < 0.65 ? 'var(--color-edge-amber)' : 'var(--color-danger)'}
                    />
                  )}
                  {avgRps != null && (
                    <SummaryPill
                      label="V3 RPS"
                      value={avgRps.toFixed(3)}
                      valueColor={avgRps < 0.25 ? 'var(--color-success)' : avgRps < 0.35 ? 'var(--color-edge-amber)' : 'var(--color-danger)'}
                    />
                  )}
                </div>

                {/* Match-by-match table */}
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>
                        <th style={TH}>Date</th>
                        <th style={TH}>Match</th>
                        <th style={{ ...TH, textAlign: 'center' }}>Result</th>
                        <th style={{ ...TH, textAlign: 'center' }}>V1</th>
                        <th style={{ ...TH, textAlign: 'center' }}>V2</th>
                        <th style={{ ...TH, textAlign: 'center' }}>V3 ★</th>
                        <th style={{ ...TH, textAlign: 'right' }}>Brier</th>
                        <th style={{ ...TH, textAlign: 'right' }}>RPS</th>
                      </tr>
                    </thead>
                    <tbody>
                      {settled.map(row => {
                        const m = row.match
                        const scoreStr = m?.home_score != null ? `${m.home_score}–${m.away_score}` : ''
                        const outcomeLabel = row.actual_outcome === 'H' ? 'H' : row.actual_outcome === 'A' ? 'A' : 'D'
                        return (
                          <tr key={row.id}>
                            <td style={{ ...TD, whiteSpace: 'nowrap', color: 'var(--color-text-muted)', fontSize: 11, fontFamily: 'monospace' }}>
                              {fmtDate(row.settled_at)}
                            </td>
                            <td style={{ ...TD, maxWidth: wide ? 200 : 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {m ? `${m.home_team} vs ${m.away_team}` : '—'}
                            </td>
                            <td style={{ ...TD, textAlign: 'center', fontFamily: 'monospace', fontWeight: 600 }}>
                              <span style={{ color: 'var(--color-text-muted)', fontSize: 11 }}>{outcomeLabel}</span>
                              {scoreStr && <span style={{ color: 'var(--color-text-muted)', fontSize: 10, marginLeft: 4 }}>({scoreStr})</span>}
                            </td>
                            {[row.correct_v1, row.correct_v2, row.correct_v3].map((c, i) => (
                              <td key={i} style={{ ...TD, textAlign: 'center', fontSize: 14, fontWeight: 700 }}>
                                <span style={{ color: c ? 'var(--color-success)' : 'var(--color-danger)' }}>
                                  {c ? '✓' : '✗'}
                                </span>
                              </td>
                            ))}
                            <td style={{ ...TD, textAlign: 'right', fontFamily: 'monospace', fontSize: 12 }}>
                              {row.brier_score != null ? Number(row.brier_score).toFixed(3) : '—'}
                            </td>
                            <td style={{ ...TD, textAlign: 'right', fontFamily: 'monospace', fontSize: 12 }}>
                              {row.rps_score != null ? Number(row.rps_score).toFixed(3) : '—'}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Benchmarks */}
                <p style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 10, lineHeight: 1.6 }}>
                  Benchmarks · Random baseline: 33.3% · Bookmaker average: ~54% ·
                  Brier: lower is better (random = 0.667, perfect = 0) · RPS: lower is better
                </p>
              </div>
            )
          })()}

          {/* ── SECTION 1: Model Accuracy (3 prediction types) ── */}
          <div style={{ marginBottom: 36 }}>
            <span style={SH}>Model Accuracy</span>

            {/* Overall summary pills */}
            <div style={{ display: 'flex', gap: wide ? 12 : 8, flexWrap: 'wrap', marginBottom: 20 }}>
              <SummaryPill label="Total Predictions" value={String(totalModelPreds)} />
              <SummaryPill label="Correct" value={String(totalModelCorrect)} valueColor="var(--color-success)" />
              <SummaryPill
                label="Wrong"
                value={String(totalModelPreds - totalModelCorrect)}
                valueColor={totalModelPreds - totalModelCorrect > 0 ? 'var(--color-danger)' : 'var(--color-text-primary)'}
              />
              <SummaryPill
                label="Hit Rate (all types)"
                value={overallModelRate == null ? '—' : `${Math.round(overallModelRate * 100)}%`}
                valueColor={hitRateColor(overallModelRate)}
              />
            </div>

            {/* Tabs */}
            <div style={{ display: 'flex', gap: 2, marginBottom: 20, borderBottom: '1px solid var(--color-border)' }}>
              {PRED_TYPES.map(pt => {
                const isActive = activeTab === pt.key
                const tabRows = predsByType[pt.key] || []
                const tabCorrect = tabRows.filter(r => r.correct).length
                const tabRate = tabRows.length ? Math.round(tabCorrect / tabRows.length * 100) : null
                return (
                  <button
                    key={pt.key}
                    onClick={() => setActiveTab(pt.key)}
                    style={{
                      background: 'none', border: 'none', cursor: 'pointer',
                      padding: '10px 18px', fontFamily: 'inherit',
                      fontSize: 13, fontWeight: isActive ? 700 : 500,
                      color: isActive ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
                      borderBottom: isActive ? '2px solid var(--color-accent)' : '2px solid transparent',
                      marginBottom: -1,
                      transition: 'color 0.15s',
                    }}
                  >
                    {pt.label}
                    {tabRate != null && (
                      <span style={{
                        marginLeft: 6, fontSize: 11, fontWeight: 700,
                        color: hitRateColor(tabRate / 100),
                      }}>
                        {tabRate}%
                      </span>
                    )}
                  </button>
                )
              })}
            </div>

            {/* Active tab panel */}
            <PredTab
              rows={predsByType[activeTab] || []}
              type={activeTab}
              wide={wide}
            />
          </div>

          {/* ── SECTION 2: Performance by AI Role (role_accuracy) ── */}
          <div style={{ marginBottom: 36 }}>
            <div style={{ display: 'flex', gap: 24, flexDirection: wide ? 'row' : 'column' }}>

              {/* Left: Role table */}
              <div style={{ flex: wide ? '0 0 440px' : '1', minWidth: 0 }}>
                <span style={SH}>Performance by AI Role</span>
                {accuracyRows.length === 0 ? (
                  <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
                    No role accuracy data yet — roles are scored via the settle-match endpoint.
                  </p>
                ) : (
                  <>
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
                            return (
                              <tr key={rs.roleNumber}>
                                <td style={{ ...TD, color: 'var(--color-text-muted)', fontWeight: 600, fontSize: 11 }}>{rs.roleNumber}</td>
                                <td style={TD}>
                                  <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                                    <span style={{ fontWeight: 600, color: 'var(--color-text-primary)' }}>{rs.roleName}</span>
                                    {isBest  && <span style={{ color: 'var(--color-accent)', fontSize: 12 }} title="Best performing role">★</span>}
                                    {isWorst && <span style={{ color: 'var(--color-danger)',  fontSize: 12 }} title="Needs improvement">⚠</span>}
                                  </span>
                                </td>
                                <td style={{ ...TD, textAlign: 'right', fontFamily: 'monospace' }}>{rs.total || '—'}</td>
                                <td style={{ ...TD, textAlign: 'right', fontFamily: 'monospace', color: rs.correct > 0 ? 'var(--color-success)' : 'var(--color-text-muted)' }}>
                                  {rs.total ? rs.correct : '—'}
                                </td>
                                <td style={{ ...TD, textAlign: 'right', fontWeight: 700, color: hitRateColor(rs.hitRate) }}>
                                  {rs.hitRate != null ? `${Math.round(rs.hitRate * 100)}%` : '—'}
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
                      Trend: last 5 vs overall
                    </p>
                  </>
                )}
              </div>

              {/* Right: Recent role predictions */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <span style={SH}>Recent Role Predictions</span>
                {accuracyRows.length === 0 ? (
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
                        {accuracyRows.slice(0, 20).map(row => {
                          const correct = Number(row.accuracy_score) >= 1
                          const pred = row.predicted_json?.recommendation
                          const predStr = pred === 'home_win' || pred === 'value_home' ? 'Home Win'
                                        : pred === 'away_win' || pred === 'value_away' ? 'Away Win'
                                        : pred === 'draw' ? 'Draw'
                                        : pred === 'over' ? 'Over 2.5'
                                        : pred === 'under' ? 'Under 2.5'
                                        : pred ? pred : '—'
                          const h = row.actual_json?.home_score, a = row.actual_json?.away_score
                          const actualStr = h == null ? '—'
                                          : h > a ? `Home Win (${h}–${a})`
                                          : a > h ? `Away Win (${h}–${a})`
                                          : `Draw (${h}–${a})`
                          const matchName = row.match ? `${row.match.home_team} vs ${row.match.away_team}` : '—'
                          return (
                            <tr key={row.id}>
                              <td style={{ ...TD, whiteSpace: 'nowrap', color: 'var(--color-text-muted)', fontSize: 11, fontFamily: 'monospace' }}>
                                {fmtDate(row.settled_at)}
                              </td>
                              <td style={{ ...TD, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {matchName}
                              </td>
                              <td style={{ ...TD, fontSize: 11, color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>
                                {row.role?.role_name || '—'}
                              </td>
                              <td style={{ ...TD, fontWeight: 600, whiteSpace: 'nowrap', fontSize: 12 }}>{predStr}</td>
                              <td style={{ ...TD, fontSize: 12, whiteSpace: 'nowrap', color: 'var(--color-text-muted)' }}>{actualStr}</td>
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
          </div>

          {/* ── SECTION 3: Calibration ── */}
          <div>
            <span style={SH}>Calibration Insights</span>
            {calibration.length === 0 ? (
              <div>
                <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 8 }}>
                  No calibration data yet — run the learning loop to generate role multipliers
                </p>
                <p style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                  POST /api/learning-loop after sufficient settlements to populate this section.
                </p>
              </div>
            ) : (
              <>
                <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 16 }}>
                  Role 11 Learning Loop last ran:{' '}
                  <span style={{ color: 'var(--color-text-primary)', fontWeight: 600 }}>
                    {lastCalibration ? fmtDate(lastCalibration.updated_at) : '—'}
                  </span>
                  {' '}· Multiplier &lt;1.0 = down-weighted · &gt;1.0 = up-weighted
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
                              <td style={{ ...TD, fontWeight: 600, color: 'var(--color-text-primary)' }}>{c.role?.role_name || '—'}</td>
                              <td style={{ ...TD, textAlign: 'right', fontFamily: 'monospace' }}>{c.sample_size ?? '—'}</td>
                              <td style={{ ...TD, textAlign: 'right', fontWeight: 700, color: hitRateColor(c.hit_rate) }}>
                                {c.hit_rate != null ? `${Math.round(Number(c.hit_rate) * 100)}%` : '—'}
                              </td>
                              <td style={{ ...TD, textAlign: 'center' }}>
                                <CalibrationBadge multiplier={c.confidence_multiplier} />
                              </td>
                              <td style={{ ...TD, color: statusColor, fontSize: 12, fontWeight: 600 }}>{status}</td>
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
