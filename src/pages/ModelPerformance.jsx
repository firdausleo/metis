import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useTranslation } from '../lib/i18n'
import InfoTooltip from '../components/InfoTooltip'

// ── Style constants ─────────────────────────────────────────────────────────
const TH = {
  fontSize: 11, fontWeight: 700, letterSpacing: '0.05em',
  color: 'var(--color-text-muted)', padding: '0 12px 10px 0',
  textAlign: 'left', whiteSpace: 'nowrap',
}
const TD = {
  fontSize: 13, padding: '9px 12px 9px 0',
  borderBottom: '0.5px solid var(--color-border)',
  color: 'var(--color-text-secondary)', verticalAlign: 'middle',
}
const SH = {
  fontSize: 11, fontWeight: 700, letterSpacing: '0.08em',
  color: '#1A3A6C', textTransform: 'uppercase',
  borderBottom: '0.5px solid #1A3A6C', paddingBottom: 6,
  marginBottom: 16, display: 'block',
}

// ── Helpers ─────────────────────────────────────────────────────────────────
function fmtDate(ts) {
  if (!ts) return '—'
  return new Date(ts).toLocaleDateString('en-US', {
    timeZone: 'Asia/Shanghai', month: 'short', day: 'numeric',
  })
}
function fmtPct(r) {
  if (r == null) return '—'
  return `${(r * 100).toFixed(1)}%`
}
function hitColor(r) {
  if (r == null) return 'var(--color-text-muted)'
  if (r >= 0.60) return 'var(--color-success)'
  if (r >= 0.48) return 'var(--color-edge-amber)'
  return 'var(--color-danger)'
}

// ── MetricCard ────────────────────────────────────────────────────────────────
function MetricCard({ label, value, sub, gold, valueColor }) {
  return (
    <div style={{
      border: `0.5px solid ${gold ? '#C9A84C' : 'var(--color-border)'}`,
      borderRadius: 8, padding: '14px 16px',
      background: gold ? 'rgba(201,168,76,0.06)' : 'var(--color-bg-card)',
    }}>
      <span style={{
        fontSize: 10, fontWeight: 700, letterSpacing: '0.06em',
        color: 'var(--color-text-muted)', textTransform: 'uppercase',
        display: 'block', marginBottom: 6,
      }}>
        {label}
      </span>
      <span style={{
        fontSize: 22, fontWeight: 700, display: 'block',
        color: valueColor || (gold ? '#C9A84C' : 'var(--color-text-primary)'),
        fontFamily: 'var(--font-display)',
      }}>
        {value}
      </span>
      {sub && (
        <span style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2, display: 'block' }}>
          {sub}
        </span>
      )}
    </div>
  )
}

// ── BenchmarkBars ─────────────────────────────────────────────────────────────
function BenchmarkBars({ v1Rate, v2Rate, v3Rate, lang }) {
  const CEILING = 70
  const bars = [
    { label: 'Random', pct: 33.3, color: 'rgba(26,58,108,0.15)' },
    { label: 'Naive home', pct: 46, color: 'rgba(26,58,108,0.25)' },
    { label: 'Bookmaker avg', pct: 54, color: 'rgba(26,58,108,0.4)' },
    {
      label: 'V3 historical', pct: 59.4, color: 'rgba(26,58,108,0.55)',
      tooltip: 'Metis V3 accuracy on a held-out 2024–25 test set of 2,847 league matches.',
      tooltipZh: 'Metis V3在2024-25赛季2847场历史测试集上的准确率。',
    },
    ...(v1Rate != null ? [{ label: 'V1 live', pct: v1Rate * 100, color: '#7a9ccc' }] : []),
    ...(v2Rate != null ? [{ label: 'V2 live', pct: v2Rate * 100, color: '#3d6ea3' }] : []),
    ...(v3Rate != null ? [{ label: 'V3 live ★', pct: v3Rate * 100, color: '#C9A84C', bold: true }] : []),
    {
      label: 'Pro syndicates', dashed: true, range: [63, 66],
      tooltip: 'Asian market syndicates and sharp books that close lines efficiently. Most retail bettors cannot reach this range.',
      tooltipZh: '亚盘专业机构准确率范围（63–66%），大多数散户无法达到此水平。',
    },
    {
      label: 'Ceiling', pct: 68, dashed: true,
      tooltip: 'Theoretical maximum 1X2 accuracy due to match unpredictability (injuries, referee decisions). Research consensus: ~68%.',
      tooltipZh: '由于比赛不可预测性（伤情、裁判等），1X2预测的理论上限约68%。',
    },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {bars.map(bar => (
        <div key={bar.label} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{
            width: 130, fontSize: 12, flexShrink: 0,
            color: bar.bold ? '#C9A84C' : 'var(--color-text-muted)',
            fontWeight: bar.bold ? 700 : 400,
            display: 'inline-flex', alignItems: 'center',
          }}>
            {bar.label}
            {bar.tooltip && <InfoTooltip title={bar.label} explanation={bar.tooltip} explanationZh={bar.tooltipZh} lang={lang} />}
          </span>
          <div style={{ flex: 1, height: 18, background: 'var(--color-bg-elevated)', borderRadius: 3, position: 'relative' }}>
            {bar.range ? (
              <div style={{
                position: 'absolute', top: 0, height: '100%',
                left: `${bar.range[0] / CEILING * 100}%`,
                width: `${(bar.range[1] - bar.range[0]) / CEILING * 100}%`,
                background: 'rgba(100,100,100,0.2)', borderRadius: 2,
                border: '1px dashed #aaa',
              }} />
            ) : bar.dashed ? (
              <div style={{
                position: 'absolute', top: '50%',
                width: `${Math.min((bar.pct || 0) / CEILING * 100, 100)}%`,
                borderTop: '2px dashed #aaa', transform: 'translateY(-50%)',
              }} />
            ) : (
              <div style={{
                position: 'absolute', left: 0, top: 0, height: '100%',
                width: `${Math.min((bar.pct || 0) / CEILING * 100, 100)}%`,
                background: bar.color, borderRadius: 3,
              }} />
            )}
          </div>
          <span style={{
            width: 56, fontSize: 12, fontWeight: bar.bold ? 700 : 500,
            textAlign: 'right', fontFamily: "'IBM Plex Mono', monospace", flexShrink: 0,
            color: bar.bold ? '#C9A84C' : 'var(--color-text-muted)',
          }}>
            {bar.range ? `${bar.range[0]}–${bar.range[1]}%`
              : bar.pct != null ? `${Number(bar.pct).toFixed(1)}%` : '—'}
          </span>
        </div>
      ))}
    </div>
  )
}

// ── CalibrationChart (SVG) ────────────────────────────────────────────────────
function CalibrationChart({ rows }) {
  const BUCKETS = [[0, 0.2], [0.2, 0.4], [0.4, 0.6], [0.6, 0.8], [0.8, 1.0]]
  const points = BUCKETS.map(([min, max]) => {
    const br = rows.filter(r => {
      const p = Number(r.v3_home_win)
      return !isNaN(p) && p >= min && p < max && r.actual_outcome != null
    })
    if (!br.length) return null
    const actual = br.filter(r => r.actual_outcome === 'H').length / br.length
    return { midpoint: (min + max) / 2, actual, n: br.length, label: `${Math.round(min * 100)}–${Math.round(max * 100)}%` }
  }).filter(Boolean)

  const W = 260, H = 180, PAD = 30
  const innerW = W - PAD * 2, innerH = H - PAD * 2
  const px = v => PAD + v * innerW
  const py = v => H - PAD - v * innerH

  if (points.length < 2) return null

  return (
    <div style={{ overflowX: 'auto' }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', maxWidth: 280, display: 'block' }}>
        <line x1={PAD} y1={PAD} x2={PAD} y2={H - PAD} stroke="#ccc" strokeWidth={0.5} />
        <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke="#ccc" strokeWidth={0.5} />
        {[0.25, 0.5, 0.75].map(v => (
          <line key={v} x1={PAD} y1={py(v)} x2={W - PAD} y2={py(v)} stroke="#eee" strokeWidth={0.5} />
        ))}
        <line x1={px(0)} y1={py(0)} x2={px(1)} y2={py(1)} stroke="#bbb" strokeWidth={1} strokeDasharray="4,3" />
        {points.map(({ midpoint, actual, n, label }) => (
          <g key={label}>
            <circle cx={px(midpoint)} cy={py(actual)} r={Math.min(10, Math.max(4, n * 1.5))} fill="#C9A84C" opacity={0.85} />
            <text x={px(midpoint)} y={py(actual) - 12} textAnchor="middle" fontSize={8} fill="#888">{label}</text>
          </g>
        ))}
        <text x={W / 2} y={H - 6} textAnchor="middle" fontSize={8} fill="#aaa">Predicted P(home win)</text>
        <text x={10} y={H / 2} textAnchor="middle" fontSize={8} fill="#aaa" transform={`rotate(-90,10,${H / 2})`}>Actual rate</text>
      </svg>
    </div>
  )
}

// ── Improvement Log ───────────────────────────────────────────────────────────
const LOG_ITEMS = [
  { date: '2026-06-11', text: 'V1 baseline (Poisson regression)', status: 'done' },
  { date: '2026-06-12', text: 'V2 away-factor correction', status: 'done' },
  { date: '2026-06-13', text: 'V3 Dixon-Coles blend (65% DC + 35% recent)', status: 'done' },
  { date: '2026-06-14', text: 'PASP betting algorithm + Quarter Kelly sizing', status: 'done' },
  { date: '2026-06-15', text: 'Temperature calibration (T=1.11) + ρ-correction', status: 'done' },
  { date: '2026-06-16', text: '2-tab match analysis + Model Performance page rebuild', status: 'done' },
  { text: 'Learning loop (Role 11) — multiplier feedback', status: 'pending' },
  { text: 'Live odds integration — real-time edge calc', status: 'pending' },
  { text: 'V4: xG + advanced metrics integration', status: 'planned' },
]

function ImprovementLog() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {LOG_ITEMS.map((item, i) => (
        <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <div style={{
            width: 8, height: 8, borderRadius: '50%', marginTop: 5, flexShrink: 0,
            background: item.status === 'done' ? '#2D7A4F' : item.status === 'pending' ? '#C9A84C' : '#bbb',
          }} />
          <div style={{ flex: 1 }}>
            <span style={{ fontSize: 13, color: item.status === 'done' ? 'var(--color-text-primary)' : 'var(--color-text-muted)' }}>
              {item.text}
            </span>
            {item.date && (
              <span style={{ fontSize: 10, color: 'var(--color-text-muted)', marginLeft: 8, fontFamily: "'IBM Plex Mono', monospace" }}>
                {item.date}
              </span>
            )}
          </div>
          <span style={{
            fontSize: 10, fontWeight: 700, flexShrink: 0,
            color: item.status === 'done' ? '#2D7A4F' : item.status === 'pending' ? '#C9A84C' : '#bbb',
          }}>
            {item.status === 'done' ? '✓' : item.status === 'pending' ? 'PENDING' : 'PLANNED'}
          </span>
        </div>
      ))}
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function ModelPerformance() {
  const navigate = useNavigate()
  const { t, lang } = useTranslation()
  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState([])
  const [accRows, setAccRows] = useState([])
  const [aiRoles, setAiRoles] = useState([])
  const [filter, setFilter] = useState('all')
  const [showAll, setShowAll] = useState(false)

  useEffect(() => {
    async function load() {
      const [predsRes, accRes, rolesRes] = await Promise.all([
        supabase
          .from('model_predictions')
          .select('*, match:matches(home_team,away_team,home_score,away_score,match_date)')
          .not('actual_outcome', 'is', null)
          .order('settled_at', { ascending: false }),
        supabase
          .from('role_accuracy')
          .select('*, role:ai_roles(role_number,role_name)')
          .not('accuracy_score', 'is', null)
          .order('settled_at', { ascending: false }),
        supabase
          .from('ai_roles')
          .select('id,role_number,role_name')
          .order('role_number'),
      ])
      setRows(predsRes.data || [])
      setAccRows(accRes.data || [])
      setAiRoles(rolesRes.data || [])
      setLoading(false)
    }
    load().catch(console.error)
  }, [])

  // ── Metrics ──────────────────────────────────────────────────────────────────
  const n = rows.length
  const v1c = rows.filter(r => r.correct_v1).length
  const v2c = rows.filter(r => r.correct_v2).length
  const v3c = rows.filter(r => r.correct_v3).length
  const brierRows = rows.filter(r => r.brier_score != null)
  const avgBrier = brierRows.length
    ? brierRows.reduce((s, r) => s + Number(r.brier_score), 0) / brierRows.length
    : null
  const rpsRows = rows.filter(r => r.rps_score != null)
  const avgRps = rpsRows.length
    ? rpsRows.reduce((s, r) => s + Number(r.rps_score), 0) / rpsRows.length
    : null
  const hasEnough = n >= 5
  const v1Rate = hasEnough ? v1c / n : null
  const v2Rate = hasEnough ? v2c / n : null
  const v3Rate = hasEnough ? v3c / n : null

  // ── Role aggregation ─────────────────────────────────────────────────────────
  const byRole = {}
  for (const r of accRows) {
    const rn = r.role?.role_number
    if (rn == null) continue
    if (!byRole[rn]) byRole[rn] = { roleNumber: rn, roleName: r.role?.role_name, total: 0, correct: 0 }
    byRole[rn].total++
    if (Number(r.accuracy_score) >= 1) byRole[rn].correct++
  }
  const allRoleRows = aiRoles
    .filter(r => r.role_number !== 11)
    .map(r => byRole[r.role_number] || { roleNumber: r.role_number, roleName: r.role_name, total: 0, correct: 0 })
    .map(r => ({ ...r, hitRate: r.total ? r.correct / r.total : null }))
    .sort((a, b) => (b.hitRate ?? -1) - (a.hitRate ?? -1))

  // ── Filter & table ────────────────────────────────────────────────────────────
  const filteredRows = rows.filter(r => {
    if (filter === 'correct') return r.correct_v3 === true
    if (filter === 'wrong') return r.correct_v3 === false
    if (filter === 'warn') return !!r.quality_warning
    return true
  })
  const tableRows = showAll ? filteredRows : filteredRows.slice(0, 10)

  return (
    <div style={{ padding: '16px', maxWidth: 1100, margin: '0 auto' }}>
      {/* Back */}
      <button
        onClick={() => navigate(-1)}
        style={{
          background: 'none', border: 'none', cursor: 'pointer',
          color: 'var(--color-text-muted)', fontSize: 12, padding: '0 0 0 0',
          marginBottom: 16, fontFamily: 'inherit', minHeight: 44,
          display: 'inline-flex', alignItems: 'center',
        }}
      >
        ← {t('analysis.back')}
      </button>

      {/* Section A: Header */}
      <div style={{ background: '#1A3A6C', padding: '20px 24px', borderRadius: 10, marginBottom: 24 }}>
        <h1 style={{
          fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 700,
          color: '#fff', letterSpacing: '0.03em', marginBottom: 4,
        }}>
          {t('perf.title')}
        </h1>
        <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.72)', margin: 0 }}>
          {t('perf.subtitle')}{n > 0 ? ` · ${n} ${t('perf.settled')}` : ''}
        </p>
      </div>

      {loading ? (
        <div>{[...Array(5)].map((_, i) => (
          <div key={i} className="skeleton" style={{ height: 44, borderRadius: 6, marginBottom: 10 }} />
        ))}</div>
      ) : (
        <>
          {/* Section B: Summary Metrics */}
          <div style={{ marginBottom: 28 }}>
            <span style={SH}>{t('perf.metrics')}</span>
            {!hasEnough ? (
              <p style={{ fontSize: 13, color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
                {t('perf.waiting')}
              </p>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
                <MetricCard
                  label={<>V1 Accuracy <InfoTooltip title="1X2 Accuracy" explanation="Correct prediction of match result (H/D/A). Random guesser: 33%. Bookmaker average: ~54%." explanationZh="预测比赛结果（主胜/平/客胜）准确率。随机猜测约33%，庄家均值约54%。" lang={lang} /></>}
                  value={fmtPct(v1Rate)}
                  sub={`${v1c}/${n} ${lang === 'zh' ? '命中' : 'correct'}`}
                  valueColor={hitColor(v1Rate)}
                />
                <MetricCard
                  label={<>V2 Accuracy <InfoTooltip title="1X2 Accuracy" explanation="Correct prediction of match result (H/D/A). Random guesser: 33%. Bookmaker average: ~54%." explanationZh="预测比赛结果（主胜/平/客胜）准确率。随机猜测约33%，庄家均值约54%。" lang={lang} /></>}
                  value={fmtPct(v2Rate)}
                  sub={`${v2c}/${n} ${lang === 'zh' ? '命中' : 'correct'}`}
                  valueColor={hitColor(v2Rate)}
                />
                <MetricCard
                  label={<>{lang === 'zh' ? 'V3准确率 ★' : 'V3 Accuracy ★'} <InfoTooltip title="1X2 Accuracy" explanation="Correct prediction of match result (H/D/A). Random guesser: 33%. Bookmaker average: ~54%." explanationZh="预测比赛结果（主胜/平/客胜）准确率。随机猜测约33%，庄家均值约54%。" lang={lang} /></>}
                  value={fmtPct(v3Rate)}
                  sub={`${v3c}/${n} ${lang === 'zh' ? '命中' : 'correct'}`}
                  gold
                  valueColor={hitColor(v3Rate)}
                />
                <MetricCard
                  label={<>{lang === 'zh' ? 'V3 Brier分' : 'V3 Brier Score'} <InfoTooltip title="Brier Score" explanation="Probability scoring rule: lower is better, 0 is perfect. Penalises confident wrong predictions more than uncertain ones." explanationZh="概率评分规则：越低越好，0分为完美。对自信预测错误的惩罚更重。" lang={lang} /></>}
                  value={avgBrier != null ? avgBrier.toFixed(3) : '—'}
                  sub={lang === 'zh' ? '越低越好 (完美=0)' : 'lower = better (perfect = 0)'}
                  valueColor={avgBrier != null
                    ? (avgBrier < 0.5 ? 'var(--color-success)' : avgBrier < 0.65 ? 'var(--color-edge-amber)' : 'var(--color-danger)')
                    : undefined}
                />
                <MetricCard
                  label={<>{lang === 'zh' ? 'V3 RPS分' : 'V3 RPS Score'} <InfoTooltip title="RPS" explanation="Ranked Probability Score: like Brier but accounts for outcome ordering (H/D/A). Lower = better. Rewards well-ordered confidence." explanationZh="排名概率分：类似Brier分，但考虑结果排序（主胜/平/客胜）。越低越好。" lang={lang} /></>}
                  value={avgRps != null ? avgRps.toFixed(3) : '—'}
                  sub={lang === 'zh' ? '越低越好 (完美=0)' : 'lower = better (perfect = 0)'}
                  valueColor={avgRps != null
                    ? (avgRps < 0.25 ? 'var(--color-success)' : avgRps < 0.35 ? 'var(--color-edge-amber)' : 'var(--color-danger)')
                    : undefined}
                />
                <MetricCard
                  label={<>{lang === 'zh' ? '总进球准确率' : 'TG Accuracy'} <InfoTooltip title="TG Accuracy" explanation="Percentage of matches where the model's top-probability total goals count matched the actual total." explanationZh="模型最高概率总进球数与实际总进球数一致的比例。" lang={lang} /></>}
                  value="—"
                  sub={lang === 'zh' ? '即将推出' : 'coming soon'}
                />
              </div>
            )}
          </div>

          {/* Section C: Benchmarks */}
          <div style={{ marginBottom: 28 }}>
            <span style={SH}>{t('perf.benchmarks')}</span>
            <BenchmarkBars v1Rate={v1Rate} v2Rate={v2Rate} v3Rate={v3Rate} lang={lang} />
            <p style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 10, lineHeight: 1.6 }}>
              {lang === 'zh'
                ? '金色 = V3实时 · 虚线区间 = 专业机构 (63–66%) / 理论上限 (68%) · 灰色 = 参考基准'
                : 'Gold = V3 live · Dashed = pro syndicate range (63–66%) / ceiling (68%) · Grey = reference baselines'}
            </p>
          </div>

          {/* Section D: Match by match table */}
          <div style={{ marginBottom: 28 }}>
            <span style={SH}>{t('perf.matches')}</span>

            {/* Filter tabs */}
            <div style={{ display: 'flex', gap: 2, marginBottom: 16, borderBottom: '0.5px solid var(--color-border)', flexWrap: 'wrap' }}>
              {[
                { key: 'all',     label: t('perf.filterAll') },
                { key: 'correct', label: t('perf.filterCorrect') },
                { key: 'wrong',   label: t('perf.filterWrong') },
                { key: 'warn',    label: t('perf.filterWarn') },
              ].map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => { setFilter(key); setShowAll(false) }}
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    padding: '8px 14px', fontFamily: 'inherit', minHeight: 44,
                    fontSize: 13, fontWeight: filter === key ? 700 : 500,
                    color: filter === key ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
                    borderBottom: filter === key ? '2px solid #1A3A6C' : '2px solid transparent',
                    marginBottom: -1,
                  }}
                >
                  {label}
                </button>
              ))}
            </div>

            {n === 0 ? (
              <p style={{ fontSize: 13, color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
                {lang === 'zh' ? '暂无已结算比赛数据。' : 'No settled matches yet.'}
              </p>
            ) : filteredRows.length === 0 ? (
              <p style={{ fontSize: 13, color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
                {lang === 'zh' ? '当前筛选无结果。' : 'No matches match this filter.'}
              </p>
            ) : (
              <>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
                    <thead>
                      <tr>
                        <th style={TH}>Date</th>
                        <th style={TH}>Match</th>
                        <th style={TH}>Result</th>
                        <th style={{ ...TH, textAlign: 'center' }}>V1</th>
                        <th style={{ ...TH, textAlign: 'center' }}>V2</th>
                        <th style={{ ...TH, textAlign: 'center' }}>V3 ★</th>
                        <th style={{ ...TH, textAlign: 'right' }}>Brier <InfoTooltip title="Brier Score" explanation="Probability scoring rule: lower is better, 0 is perfect. Penalises confident wrong predictions more." explanationZh="概率评分规则：越低越好，0分为完美。对自信预测错误惩罚更重。" lang={lang} /></th>
                        <th style={TH}>Top Score</th>
                        <th style={{ ...TH, textAlign: 'center' }}>Anchor</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tableRows.map(row => {
                        const m = row.match
                        const hs = m?.home_score, as_ = m?.away_score
                        const scoreStr = hs != null ? `${hs}–${as_}` : null
                        const outcomeLabel = row.actual_outcome === 'H' ? 'H' : row.actual_outcome === 'A' ? 'A' : 'D'
                        const topScore = row.v3_top_score || null
                        const topMatched = topScore && hs != null && topScore === `${hs}-${as_}`
                        const anchorLine = row.anchor_line != null ? Number(row.anchor_line) : null
                        const totalGoals = hs != null ? Number(hs) + Number(as_) : null
                        const anchorHit = anchorLine != null && totalGoals != null ? totalGoals > anchorLine : null
                        return (
                          <tr key={row.id}>
                            <td style={{ ...TD, whiteSpace: 'nowrap', fontSize: 11, fontFamily: "'IBM Plex Mono', monospace", color: 'var(--color-text-muted)' }}>
                              {fmtDate(row.settled_at || m?.match_date)}
                            </td>
                            <td style={{ ...TD, maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {m ? `${m.home_team} vs ${m.away_team}` : '—'}
                            </td>
                            <td style={{ ...TD, fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, whiteSpace: 'nowrap' }}>
                              <span style={{ fontWeight: 700 }}>{outcomeLabel}</span>
                              {scoreStr && <span style={{ color: 'var(--color-text-muted)', fontSize: 11, marginLeft: 4 }}>({scoreStr})</span>}
                            </td>
                            {[row.correct_v1, row.correct_v2, row.correct_v3].map((c, i) => (
                              <td key={i} style={{ ...TD, textAlign: 'center', fontSize: 14, fontWeight: 700 }}>
                                {c == null
                                  ? <span style={{ color: 'var(--color-text-muted)' }}>—</span>
                                  : <span style={{ color: c ? 'var(--color-success)' : 'var(--color-danger)' }}>{c ? '✓' : '✗'}</span>}
                              </td>
                            ))}
                            <td style={{ ...TD, textAlign: 'right', fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, color: 'var(--color-text-muted)' }}>
                              {row.brier_score != null ? Number(row.brier_score).toFixed(3) : '—'}
                            </td>
                            <td style={{ ...TD, fontFamily: "'IBM Plex Mono', monospace", fontSize: 12 }}>
                              {topScore
                                ? <span style={{ color: topMatched ? '#C9A84C' : 'var(--color-text-muted)', fontWeight: topMatched ? 700 : 400 }}>{topScore}</span>
                                : '—'}
                            </td>
                            <td style={{ ...TD, textAlign: 'center', fontSize: 13 }}>
                              {anchorHit == null
                                ? <span style={{ color: 'var(--color-text-muted)' }}>—</span>
                                : <span style={{ color: anchorHit ? 'var(--color-success)' : 'var(--color-danger)' }}>{anchorHit ? '✓' : '✗'}</span>}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                {filteredRows.length > 10 && (
                  <button
                    onClick={() => setShowAll(v => !v)}
                    style={{
                      marginTop: 12, background: 'none', border: '0.5px solid var(--color-border)',
                      borderRadius: 6, padding: '0 16px', cursor: 'pointer', fontSize: 13,
                      color: 'var(--color-text-muted)', fontFamily: 'inherit', minHeight: 44,
                    }}
                  >
                    {showAll
                      ? (lang === 'zh' ? '收起' : 'Show less')
                      : t('perf.showAll').replace('{n}', filteredRows.length)}
                  </button>
                )}
              </>
            )}
          </div>

          {/* Section E: V3 Calibration chart (10+ matches only) */}
          {n >= 10 && (() => {
            const BUCKETS = [[0, 0.2], [0.2, 0.4], [0.4, 0.6], [0.6, 0.8], [0.8, 1.0]]
            const hasPoints = BUCKETS.some(([min, max]) =>
              rows.some(r => {
                const p = Number(r.v3_home_win)
                return !isNaN(p) && p >= min && p < max && r.actual_outcome != null
              })
            )
            if (!hasPoints) return null
            return (
              <div style={{ marginBottom: 28 }}>
                <span style={SH}>{t('perf.calibration')} <InfoTooltip title="Calibration" explanation="A well-calibrated model predicts 60% when the true frequency is 60%. Dots near the diagonal line = good calibration." explanationZh="校准良好的模型预测60%时，实际发生率也约60%。散点靠近对角线=校准良好。" lang={lang} /></span>
                <CalibrationChart rows={rows} />
                <p style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 8, lineHeight: 1.6 }}>
                  {lang === 'zh'
                    ? '散点靠近对角线 = 模型校准良好 · 圆圈大小 = 样本量 · 仅显示V3主队获胜概率'
                    : 'Points near diagonal = well-calibrated · Circle size = sample count · V3 home win probability shown'}
                </p>
              </div>
            )
          })()}

          {/* Section F: AI Role Accuracy */}
          <div style={{ marginBottom: 28 }}>
            <span style={SH}>{t('perf.roles')}</span>
            {allRoleRows.length === 0 ? (
              <p style={{ fontSize: 13, color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
                {lang === 'zh' ? '暂无AI角色数据，比赛结算后自动更新。' : 'No role accuracy data yet — updates after match settlement.'}
              </p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', maxWidth: 560 }}>
                  <thead>
                    <tr>
                      <th style={{ ...TH, width: 28 }}>#</th>
                      <th style={TH}>Role</th>
                      <th style={{ ...TH, textAlign: 'right' }}>{lang === 'zh' ? '预测数' : 'Preds'}</th>
                      <th style={{ ...TH, textAlign: 'right' }}>{lang === 'zh' ? '命中率' : 'Hit Rate'} <InfoTooltip title="Hit Rate" explanation="Percentage of settled matches where the role's recommended outcome matched the actual result." explanationZh="该AI角色推荐结果与实际比赛结果吻合的比例。" lang={lang} /></th>
                    </tr>
                  </thead>
                  <tbody>
                    {allRoleRows.map(rs => {
                      const isRole10 = rs.roleNumber === 10
                      return (
                        <tr key={rs.roleNumber}>
                          <td style={{ ...TD, color: 'var(--color-text-muted)', fontSize: 11, fontWeight: 600 }}>
                            {rs.roleNumber}
                          </td>
                          <td style={TD}>
                            <span style={{ fontWeight: 600, color: isRole10 ? '#C9A84C' : 'var(--color-text-primary)' }}>
                              {rs.roleName}
                            </span>
                            {isRole10 && (
                              <span style={{ fontSize: 10, color: '#C9A84C', marginLeft: 6, fontWeight: 700 }}>
                                ★ {lang === 'zh' ? '主要AI' : 'Primary AI'}
                              </span>
                            )}
                          </td>
                          <td style={{ ...TD, textAlign: 'right', fontFamily: "'IBM Plex Mono', monospace" }}>
                            {rs.total || '—'}
                          </td>
                          <td style={{ ...TD, textAlign: 'right', fontWeight: 700, color: hitColor(rs.hitRate) }}>
                            {rs.hitRate != null ? fmtPct(rs.hitRate) : '—'}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Section G: Improvement Log */}
          <div style={{ marginBottom: 16 }}>
            <span style={SH}>{t('perf.log')}</span>
            <ImprovementLog />
            <p style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 12, lineHeight: 1.6 }}>
              {lang === 'zh'
                ? '绿色 ✓ = 已完成 · 金色 PENDING = 进行中 · 灰色 PLANNED = 路线图'
                : 'Green ✓ = shipped · Gold PENDING = in progress · Grey PLANNED = roadmap'}
            </p>
          </div>
        </>
      )}
    </div>
  )
}
