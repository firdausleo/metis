import { useState } from 'react'
import { useTranslation } from '../../lib/i18n'
import { useUser } from '../../context/UserContext'
import { getFlag } from '../../lib/teamFlags'
import { SCORE_MAX } from '../../lib/poisson'
import { getRangeProbabilities } from '../../utils/pasp'
import InfoTooltip from '../InfoTooltip'

// ── Rank → color mapping (gold #1 / navy #2 / green #3 / gray #4+) ────────
const RANK_COLORS = { 1: '#C9A84C', 2: '#1A3A6C', 3: '#2D7A4F' }
function getRankColor(rank) {
  return RANK_COLORS[rank] || (rank <= 5 ? '#6B7280' : '#9CA3AF')
}

// ── Compact matrix cell ───────────────────────────────────────────────────

function MatrixCell({ value, isMax }) {
  const intensity = Math.min(value * 12, 0.9)
  const textColor = intensity > 0.45 ? '#FFFFFF' : 'var(--color-text-primary)'
  return (
    <div style={{
      height: 38, borderRadius: 4,
      background: isMax ? `rgba(45,122,79,${intensity + 0.15})` : `rgba(45,122,79,${intensity})`,
      border: isMax ? '2px solid var(--color-accent)' : '0.5px solid var(--color-border-light)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 12, color: isMax ? '#FFFFFF' : textColor,
      fontWeight: isMax ? 800 : intensity > 0.3 ? 600 : 400,
    }}>
      {(value * 100).toFixed(1)}
    </div>
  )
}

// ── Compact score matrix with axis labels ────────────────────────────────

function MiniMatrix({ matrix, homeTeam, awayTeam }) {
  const size = SCORE_MAX + 1
  const flat = matrix.flat()
  const maxVal = Math.max(...flat)
  return (
    <div style={{ overflowX: 'auto' }}>
      <div style={{ display: 'flex', gap: 4, alignItems: 'stretch', minWidth: 360 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 16, flexShrink: 0 }}>
          <span style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', fontSize: 10, fontWeight: 600, color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>
            {getFlag(homeTeam)} {homeTeam} ↓
          </span>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ textAlign: 'center', fontSize: 10, fontWeight: 600, color: 'var(--color-text-muted)', marginBottom: 4 }}>
            {getFlag(awayTeam)} {awayTeam} →
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: `24px repeat(${size}, 1fr)`, gap: 2, marginBottom: 2 }}>
            <div />
            {Array.from({ length: size }, (_, j) => (
              <div key={j} style={{ textAlign: 'center', fontSize: 12, color: 'var(--color-text-primary)', fontWeight: 700 }}>{j}</div>
            ))}
          </div>
          {matrix.map((row, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: `24px repeat(${size}, 1fr)`, gap: 2, marginBottom: 2 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: 'var(--color-text-muted)', fontWeight: 600 }}>{i}</div>
              {row.map((v, j) => <MatrixCell key={j} value={v} isMax={v === maxVal} />)}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Compact stats card ───────────────────────────────────────────────────

function CompactTeamStats({ teamStats, teamName, isHome, t }) {
  if (!teamStats) return (
    <div style={{ flex: 1, minWidth: 0, background: 'var(--color-bg-elevated)', border: '0.5px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '12px 14px' }}>
      <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: 6 }}>{getFlag(teamName)} {teamName}</p>
      <p style={{ fontSize: 13, color: 'var(--color-text-muted)', fontStyle: 'italic' }}>{t('analysis.noStats')}</p>
    </div>
  )

  const form = teamStats.form_string?.slice(0, 5).split('') || []
  const formColour = { W: 'var(--color-success)', D: 'var(--color-warning)', L: 'var(--color-danger)' }
  const gw = teamStats.games_window ?? 0
  const qualBg = gw >= 5 ? '#EAF3DE' : gw >= 3 ? '#FAEEDA' : '#FCEBEB'
  const qualCol = gw >= 5 ? '#27500A' : gw >= 3 ? '#633806' : '#791F1F'

  return (
    <div style={{ flex: 1, minWidth: 0, background: 'var(--color-bg-elevated)', border: '0.5px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '12px 14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, flexWrap: 'wrap', gap: 4 }}>
        <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text-primary)' }}>{getFlag(teamName)} {teamName}</p>
        <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 99, background: qualBg, color: qualCol }}>{gw} games</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 8 }}>
        {[
          { label: 'Scored/G', val: teamStats.goals_scored_avg?.toFixed(2) },
          { label: 'Conceded/G', val: teamStats.goals_conceded_avg?.toFixed(2) },
        ].map(({ label, val }) => (
          <div key={label} style={{ background: 'var(--color-bg-card)', border: '0.5px solid var(--color-border)', borderRadius: 4, padding: '6px 8px' }}>
            <p style={{ fontSize: 10, color: 'var(--color-text-muted)', marginBottom: 2 }}>{label}</p>
            <p style={{ fontFamily: 'var(--font-display)', fontSize: 19, fontWeight: 600, color: 'var(--color-text-primary)' }}>{val ?? '—'}</p>
          </div>
        ))}
      </div>
      {form.length > 0 && (
        <div style={{ display: 'flex', gap: 4 }}>
          <span style={{ fontSize: 11, color: 'var(--color-text-muted)', fontWeight: 600 }}>FORM</span>
          {form.map((c, i) => (
            <span key={i} style={{ width: 18, height: 18, borderRadius: '50%', background: formColour[c] || 'var(--color-text-muted)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#000' }}>{c}</span>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Collapsible wrapper ──────────────────────────────────────────────────

function Collapsible({ label, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div style={{ border: '0.5px solid var(--color-border)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '12px 14px', background: 'var(--color-bg-card)', border: 'none', cursor: 'pointer',
          fontFamily: 'var(--font-ui)', fontSize: 13, fontWeight: 600, color: 'var(--color-text-primary)',
          minHeight: 44,
        }}
      >
        {label}
        <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{open ? '▲' : '▼'}</span>
      </button>
      {open && <div style={{ padding: '12px 14px', background: 'var(--color-bg-card)', borderTop: '0.5px solid var(--color-border)' }}>{children}</div>}
    </div>
  )
}

// ── Edge colour helper ───────────────────────────────────────────────────

function edgeColour(prob) {
  if (prob >= 0.55) return 'var(--color-success)'
  if (prob >= 0.40) return 'var(--color-accent)'
  if (prob >= 0.28) return 'var(--color-warning)'
  return 'var(--color-text-muted)'
}

// ── AI role helpers ──────────────────────────────────────────────────────

const ROLE_META = {
  1:  { name: 'Statistical Validator', icon: '📊' },
  2:  { name: 'Form Intelligence',     icon: '📈' },
  3:  { name: 'Deep Analysis',         icon: '🧠' },
  4:  { name: 'Tournament Context',    icon: '🏆' },
  5:  { name: 'Market Intelligence',   icon: '💹' },
  6:  { name: 'Risk Manager',          icon: '🛡️' },
  7:  { name: 'Tactical Analyst',      icon: '⚽' },
  8:  { name: 'Head-to-Head Historian',icon: '📜' },
  9:  { name: 'Motivation Analyst',    icon: '🔥' },
  10: { name: 'Composite Scorer',      icon: '🎯' },
}

const REC_COLOURS = {
  home_win: 'var(--color-accent)', away_win: 'var(--color-info)', draw: 'var(--color-warning)',
  over: 'var(--color-success)', under: 'var(--color-text-secondary)',
  value_home: 'var(--color-accent)', value_away: 'var(--color-info)',
}

function normaliseOutput(raw) {
  if (!raw) return null
  if (typeof raw === 'object') return raw
  try { return JSON.parse(String(raw).replace(/```json\n?|\n?```/g, '').trim()) }
  catch { return { summary: String(raw).slice(0, 300), confidence: null, recommendation: null, signals: [], flags: ['parse_error'] } }
}

function RoleConfBar({ value }) {
  if (value == null) return <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>—</span>
  const pct = Math.round(value * 100)
  const color = pct >= 70 ? 'var(--color-success)' : pct >= 45 ? 'var(--color-warning)' : 'var(--color-danger)'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 3 }}>
      <div style={{ flex: 1, height: 4, background: 'var(--color-bg)', border: '0.5px solid var(--color-border)', borderRadius: 99, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 99 }} />
      </div>
      <span style={{ fontSize: 12, fontWeight: 700, color, minWidth: 30 }}>{pct}%</span>
    </div>
  )
}

function AiRoleCard({ output_json, isComposite }) {
  const [expanded, setExpanded] = useState(false)
  const out = normaliseOutput(output_json)
  const roleNum = out?.role
  const meta = ROLE_META[roleNum] || { name: `Role ${roleNum || '?'}`, icon: '🔹' }
  const rec = out?.recommendation
  const recColor = REC_COLOURS[rec] || 'var(--color-text-muted)'

  return (
    <div style={{
      background: 'var(--color-bg-card)',
      border: isComposite ? '1.5px solid var(--color-accent)' : '0.5px solid var(--color-border)',
      borderRadius: 'var(--radius-md)', overflow: 'hidden',
    }}>
      <button
        onClick={() => setExpanded(v => !v)}
        style={{
          width: '100%', padding: '12px 14px',
          background: isComposite ? 'var(--color-accent-dim)' : 'none',
          border: 'none', cursor: 'pointer', textAlign: 'left',
          display: 'flex', alignItems: 'center', gap: 10, minHeight: 44,
        }}
      >
        <span style={{ fontSize: 18, flexShrink: 0 }}>{meta.icon}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: 14, fontWeight: isComposite ? 700 : 600, color: isComposite ? 'var(--color-accent)' : 'var(--color-text-primary)' }}>
            {isComposite ? '★ ' : ''}{meta.name}
          </span>
          {out && <RoleConfBar value={out.confidence} />}
        </div>
        {rec && rec !== 'null' && (
          <span style={{
            fontSize: 12, fontWeight: 700, color: recColor,
            padding: '2px 7px', background: `${recColor}22`,
            border: `0.5px solid ${recColor}`, borderRadius: 99, flexShrink: 0,
          }}>
            {rec.replace(/_/g, ' ').toUpperCase()}
          </span>
        )}
        <span style={{ color: 'var(--color-text-muted)', fontSize: 12, flexShrink: 0 }}>{expanded ? '▲' : '▼'}</span>
      </button>
      {expanded && out && (
        <div style={{ padding: '10px 14px 14px', borderTop: '0.5px solid var(--color-border)' }}>
          {out.summary && (
            <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', lineHeight: 1.6, marginBottom: 8 }}>{out.summary}</p>
          )}
          {out.signals?.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {out.signals.slice(0, 5).map((sig, i) => {
                const isPos = !sig.toLowerCase().includes('⚠') &&
                  !sig.toLowerCase().includes('risk') &&
                  !sig.toLowerCase().includes('weak') &&
                  !sig.toLowerCase().includes('concern')
                return (
                  <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                    <span style={{ color: isPos ? 'var(--color-success)' : 'var(--color-warning)', flexShrink: 0 }}>{isPos ? '✓' : '⚠'}</span>
                    <span style={{ fontSize: 13, color: 'var(--color-text-secondary)', lineHeight: 1.4 }}>{sig}</span>
                  </div>
                )
              })}
            </div>
          )}
          {out.flags?.includes('parse_error') && (
            <p style={{ fontSize: 12, color: 'var(--color-danger)', marginTop: 6 }}>⚠ Output parse error</p>
          )}
        </div>
      )}
    </div>
  )
}

// ── PredictionTab ────────────────────────────────────────────────────────

export default function PredictionTab({
  match, stats, statsLoading, statsError,
  isAdmin, refreshing, onRefresh, onSaveManual, lastUpdated,
  sidebarModel, aiComposite,
  roleOutputs, aiRoles, aiRunning, aiRunError, aiRunMsg, onRunAI,
}) {
  const { t, lang } = useTranslation()
  const { tier, credits } = useUser()
  const v3 = sidebarModel?.v3
  const v1 = sidebarModel?.v1
  const hasModel = !!v3

  // ── AI Verdict section ──────────────────────────────────────────────────
  const rawRec = aiComposite?.recommendation
  const normRec =
    rawRec === 'home_win' || rawRec === 'value_home' ? 'home' :
    rawRec === 'away_win' || rawRec === 'value_away' ? 'away' :
    rawRec === 'draw' ? 'draw' : null
  const aiConf = aiComposite?.confidence != null ? Math.round(aiComposite.confidence * 100) : null
  const recLabel = { home: match?.home_team, draw: 'Draw', away: match?.away_team }

  const lastAiRun = roleOutputs?.length
    ? new Date(Math.max(...roleOutputs.map(o => new Date(o.created_at)))).toLocaleString('zh-CN', {
        timeZone: 'Asia/Shanghai', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: false,
      })
    : null

  // ── Total goals table ────────────────────────────────────────────────────
  const goalsSorted = v3?.totalGoals
    ? [...v3.totalGoals].sort((a, b) => b.prob - a.prob).slice(0, 8)
    : []

  const kStarEntry = goalsSorted[0] ?? null
  const kStar = kStarEntry?.goals ?? null

  // rank map: goal count → rank by probability across full distribution (1 = highest)
  const rankMap = {}
  ;[...(v3?.totalGoals || [])].sort((a, b) => b.prob - a.prob)
    .forEach((item, idx) => { rankMap[item.goals] = idx + 1 })
  const goalProbMap = {}
  ;(v3?.totalGoals || []).forEach(item => { goalProbMap[item.goals] = item.prob })
  const getGoalP = g => goalProbMap[g] || 0

  const anchorEntry = v1?.totalGoals?.find(g => g.anchor)

  // hasAiResult: true only when role 10 output is present
  const role10ForCheck = roleOutputs?.find(r => r.ai_roles?.role_number === 10)
  const hasAiResult = Array.isArray(roleOutputs) && roleOutputs.length > 0 && !!role10ForCheck

  const dominant = v3?.probs
    ? v3.probs.home >= v3.probs.away && v3.probs.home >= v3.probs.draw ? 'home'
    : v3.probs.away > v3.probs.home && v3.probs.away >= v3.probs.draw ? 'away'
    : 'draw'
    : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

      {/* ── AI Analysis section ── */}
      {!hasAiResult && !aiRunning && (
        <div style={{ textAlign: 'center', padding: '1.5rem 1rem' }}>
          <p style={{ fontSize: '13px', color: 'var(--color-text-secondary)', marginBottom: '12px' }}>
            {lang === 'zh'
              ? '运行AI分析以获取专项见解和综合置信评分'
              : 'Run AI analysis to get specialist insights and a composite confidence score'}
          </p>
          <button
            onClick={onRunAI}
            disabled={!onRunAI}
            style={{
              background: '#1A3A6C',
              color: 'white',
              border: 'none',
              borderRadius: 'var(--radius-md)',
              padding: '10px 24px',
              fontSize: '14px',
              fontWeight: 500,
              cursor: onRunAI ? 'pointer' : 'not-allowed',
              opacity: onRunAI ? 1 : 0.6,
              minHeight: '44px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <i className="ti ti-brain" aria-hidden="true" />
            {lang === 'zh' ? '运行AI分析' : 'Run AI Analysis'}
          </button>
          {(tier === 'standard' || tier === 'power') && (
            <p style={{ fontSize: '11px', color: 'var(--color-text-muted)', marginTop: '8px' }}>
              ⚡ {credits} {lang === 'zh' ? '积分剩余 · 消耗5积分' : 'credits remaining · costs 5 credits'}
            </p>
          )}
        </div>
      )}

      {aiRunning && (
        <div style={{ textAlign: 'center', padding: '1.5rem' }}>
          <i className="ti ti-loader-2" style={{
            fontSize: '24px',
            color: 'var(--color-text-muted)',
            animation: 'spin 1s linear infinite',
          }} aria-hidden="true" />
          <p style={{ fontSize: '12px', color: 'var(--color-text-secondary)', marginTop: '8px' }}>
            {lang === 'zh' ? '正在分析11个专项角色...' : 'Analyzing 11 specialist roles...'}
          </p>
        </div>
      )}

      {aiRunError && (
        <p style={{ fontSize: '12px', color: 'var(--color-danger)', marginTop: '8px', textAlign: 'center' }}>
          {aiRunError}
        </p>
      )}

      {hasAiResult && aiComposite && normRec && (
        <div style={{
          background: '#EEEDFE', border: '0.5px solid #534AB7',
          borderRadius: 'var(--radius-md)', padding: '14px 16px',
        }}>
          <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: '#534AB7', marginBottom: 8 }}>
            AI VERDICT (ROLE 10)
          </p>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
            <p style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 700, color: '#3C3489', lineHeight: 1 }}>
              {recLabel[normRec]}
            </p>
            {aiConf != null && (
              <span style={{ fontSize: 14, fontWeight: 600, color: '#534AB7' }}>{aiConf}% confidence</span>
            )}
          </div>
          {aiComposite.key_risks?.length > 0 && (
            <p style={{ fontSize: 12, color: '#534AB7', marginTop: 6, fontStyle: 'italic' }}>
              Risk: {aiComposite.key_risks.slice(0, 2).join(' · ')}
            </p>
          )}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 10, flexWrap: 'wrap', gap: 8 }}>
            {lastAiRun && (
              <span style={{ fontSize: 11, color: '#534AB7' }}>
                {lang === 'zh' ? '上次运行：' : 'Last run: '}{lastAiRun} 北京
              </span>
            )}
            {onRunAI && (
              <button
                onClick={onRunAI}
                disabled={aiRunning}
                style={{
                  minHeight: 32, padding: '0 12px', background: 'transparent',
                  border: '0.5px solid #534AB7', borderRadius: 'var(--radius-sm)',
                  color: '#534AB7', fontFamily: 'var(--font-ui)', fontSize: 12, fontWeight: 500,
                  cursor: aiRunning ? 'not-allowed' : 'pointer', opacity: aiRunning ? 0.6 : 1,
                }}
              >
                {aiRunning ? '⏳…' : (lang === 'zh' ? '↺ 重新分析' : '↺ Re-run Analysis')}
              </button>
            )}
          </div>
          {aiRunMsg && <p style={{ fontSize: 12, color: 'var(--color-success)', marginTop: 6 }}>{aiRunMsg}</p>}
        </div>
      )}

      {/* ── V3 Probability boxes ── */}
      {hasModel ? (
        <>
          <div>
            <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--color-text-muted)', marginBottom: 8 }}>
              V3 MODEL (DC BLEND) · WIN / DRAW / LOSS
              <InfoTooltip title="V3 Model" explanation="Dixon-Coles blend: 65% DC attack/defence matrix + 35% recent form. Temperature-calibrated (T=1.11) to correct overconfidence." explanationZh="Dixon-Coles融合模型：65% DC攻防矩阵+35%近期表现。温度校准(T=1.11)纠正过度自信。" lang={lang} />
            </p>
            {dominant && match && (
              <div style={{ padding: '8px 12px', background: 'var(--color-bg-elevated)', border: '0.5px solid var(--color-border)', borderRadius: 6, marginBottom: 10 }}>
                <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
                  {lang === 'zh' ? '模型预测：' : 'Model predicts: '}
                </span>
                <strong style={{ fontSize: 14, color: edgeColour(v3.probs[dominant]) }}>
                  {dominant === 'home'
                    ? `${getFlag(match.home_team)} ${match.home_team}`
                    : dominant === 'away'
                    ? `${getFlag(match.away_team)} ${match.away_team}`
                    : (lang === 'zh' ? '⚖️ 平局' : '⚖️ Draw')}
                </strong>
                {dominant !== 'draw' && (
                  <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
                    {lang === 'zh' ? ' 获胜' : ' win'}
                  </span>
                )}
                <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
                  {' '}({(v3.probs[dominant] * 100).toFixed(1)}%)
                </span>
              </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
              {[
                { key: 'home', label: match.home_team, flag: getFlag(match.home_team) },
                { key: 'draw', label: 'Draw', flag: '—' },
                { key: 'away', label: match.away_team, flag: getFlag(match.away_team) },
              ].map(({ key, label, flag }) => {
                const p = v3.probs[key]
                const col = edgeColour(p)
                return (
                  <div key={key} style={{
                    background: 'var(--color-bg-card)', border: `0.5px solid ${col}`,
                    borderRadius: 'var(--radius-md)', padding: '14px 10px', textAlign: 'center',
                  }}>
                    <p style={{ fontSize: 20, marginBottom: 4 }}>{key !== 'draw' ? flag : '⚖️'}</p>
                    <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 6, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</p>
                    <p style={{ fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 700, color: col, lineHeight: 1 }}>
                      {(p * 100).toFixed(1)}%
                    </p>
                    {sidebarModel?.v2 && (
                      <p style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4 }}>
                        V2 {(sidebarModel.v2.probs[key] * 100).toFixed(1)}%
                      </p>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {/* ── Support stats: over25 + btts ── */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {[
              { label: 'Over 2.5', val: v3.over25 },
              { label: 'Under 2.5', val: 1 - v3.over25 },
              { label: 'BTTS', val: v3.btts },
            ].map(({ label, val }) => (
              <div key={label} style={{
                flex: '1 0 90px', textAlign: 'center',
                background: 'var(--color-bg-card)', border: '0.5px solid var(--color-border)',
                borderRadius: 'var(--radius-md)', padding: '10px 8px',
              }}>
                <p style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 4 }}>{label}</p>
                <p style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 700, color: edgeColour(val) }}>
                  {(val * 100).toFixed(1)}%
                </p>
              </div>
            ))}
          </div>

          {/* ── Total Goals & Range Analysis ── */}
          {v3.totalGoals?.length > 0 && (() => {
            const ranges = getRangeProbabilities(v3.totalGoals)
            const maxRP = Math.max(...ranges.map(r => Number(r.prob)))
            const maxGoalProb = goalsSorted.length > 0 ? Math.max(...goalsSorted.map(g => g.prob)) : 1

            return (
              <div style={{ background: 'var(--color-bg-card)', border: '0.5px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '12px 14px' }}>
                <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--color-text-muted)', marginBottom: 10, display: 'flex', alignItems: 'center' }}>
                  {lang === 'zh' ? '总进球与区间分析 · V3' : 'TOTAL GOALS & RANGE ANALYSIS · V3'}
                  <InfoTooltip
                    title={lang === 'zh' ? '进球分析' : 'Goals Analysis'}
                    explanation="Left: 3-goal windows sorted by combined probability. Right: individual totals by rank. Top bar = 100%."
                    explanationZh="左：按组合概率排序的3球窗口。右：按排名的单个总数。最高条=100%。"
                    lang={lang}
                  />
                </p>

                <div className="goals-analysis-grid">

                  {/* ── LEFT: BY RANGE ── */}
                  <div>
                    <p style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', color: 'var(--color-text-muted)', marginBottom: 8 }}>
                      {lang === 'zh' ? '按区间' : 'BY RANGE'}
                    </p>
                    {ranges.map((r, i) => {
                      const isTop = i === 0
                      const goalsInRange = [r.min, r.min + 1, r.max]
                      const probsInRange = goalsInRange.map(g => getGoalP(g))
                      const fillPct = (Number(r.prob) / maxRP) * 100
                      const rowRankColor = getRankColor(i + 1)

                      return (
                        <div key={r.range} style={{ marginBottom: '10px' }}>
                          {/* LINE 1 */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '3px' }}>
                            <span style={{ fontSize: '11px', fontWeight: isTop ? 600 : 400, color: rowRankColor, width: '28px', flexShrink: 0 }}>{r.range}</span>
                            <span style={{ fontSize: '10px', color: rowRankColor, width: '36px', flexShrink: 0 }}>{(Number(r.prob) * 100).toFixed(1)}%</span>
                            <span style={{ fontSize: '10px', color: '#C9A84C', width: '10px', flexShrink: 0, visibility: isTop ? 'visible' : 'hidden' }}>★</span>
                            <div style={{ flex: 1, minWidth: 0, height: '8px', background: 'var(--color-bg)', borderRadius: '4px', position: 'relative', overflow: 'hidden' }}>
                              <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: `${fillPct}%`, display: 'flex', gap: '1px' }}>
                                {goalsInRange.map((g, idx) => (
                                  <div key={g} style={{ flex: probsInRange[idx] || 0.001, height: '100%', background: getRankColor(rankMap[g] ?? 99), minWidth: 0 }} />
                                ))}
                              </div>
                            </div>
                          </div>
                          {/* LINE 2: paddingLeft = 28+6+36+6+10+6 = 92px */}
                          <div style={{ paddingLeft: '92px', display: 'flex' }}>
                            {goalsInRange.map((g, idx) => {
                              const gRank = rankMap[g] ?? 99
                              const gColor = getRankColor(gRank)
                              return (
                                <div key={g} style={{ flex: probsInRange[idx] || 1, display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 0 }}>
                                  <span style={{ fontSize: '10px', fontWeight: 500, color: gColor }}>{g}{gRank === 1 ? '★' : ''}</span>
                                  <span style={{ fontSize: '9px', padding: '0 3px', borderRadius: '99px', background: `${gColor}20`, color: gColor, fontWeight: 500 }}>#{gRank}</span>
                                  <span style={{ fontSize: '9px', color: gColor, opacity: 0.85 }}>{(probsInRange[idx] * 100).toFixed(1)}%</span>
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )
                    })}
                  </div>

                  {/* ── RIGHT: BY TOTAL ── */}
                  <div>
                    <p style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', color: 'var(--color-text-muted)', marginBottom: 8 }}>
                      {lang === 'zh' ? '按总数' : 'BY TOTAL'}
                    </p>
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      {goalsSorted.map(({ goals, prob }) => {
                        const isAnchor = kStar != null && goals === kStar
                        const rank = rankMap[goals] ?? 99
                        const rankColor = getRankColor(rank)
                        const barPct = maxGoalProb > 0 ? (prob / maxGoalProb) * 100 : 0
                        return (
                          <div key={goals} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 0', borderBottom: '0.5px solid var(--color-border-light)', background: isAnchor ? 'rgba(201,168,76,0.06)' : 'transparent' }}>
                            <div style={{ width: '88px', flexShrink: 0, display: 'flex', alignItems: 'center', gap: '4px' }}>
                              <span style={{ width: '14px', textAlign: 'right', fontSize: '12px', fontWeight: rank <= 3 ? 500 : 400, color: rankColor, flexShrink: 0 }}>{goals}</span>
                              <span style={{ fontSize: '11px', color: rankColor, fontWeight: rank <= 3 ? 500 : 400, minWidth: '34px', flexShrink: 0 }}>{(prob * 100).toFixed(1)}%</span>
                              <span style={{ fontSize: '8px', fontWeight: 500, padding: '0 3px', borderRadius: '99px', background: `${rankColor}20`, color: rankColor, width: '22px', textAlign: 'center', flexShrink: 0 }}>#{rank}</span>
                              {isAnchor && (
                                <InfoTooltip
                                  title="Anchor Total"
                                  explanation="The most likely number of goals — foundation of PASP strategy."
                                  explanationZh="最可能的总进球数——PASP策略基础。"
                                  lang={lang}
                                />
                              )}
                            </div>
                            <div style={{ flex: 1, minWidth: 0, height: '5px', background: 'var(--color-bg)', borderRadius: '3px', position: 'relative' }}>
                              <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', borderRadius: '3px', width: `${barPct}%`, background: rankColor, transition: 'width 0.4s ease' }} />
                            </div>
                          </div>
                        )
                      })}
                    </div>
                    {kStar != null && (() => {
                      let kOver = 0, kUnder = 0
                      for (const { goals, prob } of (v3.totalGoals || [])) {
                        if (goals >= kStar) kOver += prob
                        else kUnder += prob
                      }
                      const betLine = kStar - 0.5
                      return (
                        <div style={{ marginTop: 8, paddingTop: 8, borderTop: '0.5px solid var(--color-border)', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>
                            Over {betLine}: <strong style={{ color: 'var(--color-accent)' }}>{(kOver * 100).toFixed(1)}%</strong>
                          </span>
                          <span style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>
                            Under {kStar + 0.5}: <strong style={{ color: 'var(--color-text-primary)' }}>{(kUnder * 100).toFixed(1)}%</strong>
                          </span>
                        </div>
                      )
                    })()}
                  </div>

                </div>

                {/* Insight line */}
                {kStar != null && (
                  <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '0.5px solid var(--color-border-light)', fontSize: 11, color: 'var(--color-text-secondary)' }}>
                    {lang === 'zh'
                      ? `最佳区间：${ranges[0]?.range}球 (${(Number(ranges[0]?.prob) * 100).toFixed(1)}%) · 锚定：${kStar}球`
                      : `Sweet spot: ${ranges[0]?.range} goals (${(Number(ranges[0]?.prob) * 100).toFixed(1)}%) · Anchor: ${kStar} goals`}
                  </div>
                )}

                {/* Legend */}
                <div style={{ display: 'flex', gap: '12px', marginTop: '8px', flexWrap: 'wrap' }}>
                  {[
                    { color: '#C9A84C', label: lang === 'zh' ? '#1 最高' : '#1 Most likely' },
                    { color: '#1A3A6C', label: '#2' },
                    { color: '#2D7A4F', label: '#3' },
                    { color: '#6B7280', label: lang === 'zh' ? '其他' : 'Others' },
                  ].map(item => (
                    <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '10px', color: 'var(--color-text-muted)' }}>
                      <div style={{ width: '10px', height: '10px', borderRadius: '2px', background: item.color, flexShrink: 0 }} />
                      {item.label}
                    </div>
                  ))}
                </div>
              </div>
            )
          })()}

          {/* ── Top Scorelines grid ── */}
          {v3.topScores?.length > 0 && (
            <div style={{ background: 'var(--color-bg-card)', border: '0.5px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '12px 14px' }}>
              <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--color-text-muted)', marginBottom: 10 }}>
                TOP SCORELINES · V3
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
                {v3.topScores.slice(0, 6).map(({ score, prob }, i) => (
                  <div key={score} style={{
                    textAlign: 'center', padding: '10px 6px',
                    background: i === 0 ? 'var(--color-accent-dim)' : 'var(--color-bg-elevated)',
                    border: i === 0 ? '0.5px solid var(--color-accent-border)' : '0.5px solid var(--color-border)',
                    borderRadius: 'var(--radius-sm)',
                  }}>
                    <p style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: i === 0 ? 800 : 600, color: i === 0 ? 'var(--color-accent)' : 'var(--color-text-primary)' }}>
                      {score}
                    </p>
                    <p style={{ fontSize: 12, color: i === 0 ? 'var(--color-accent)' : 'var(--color-text-muted)' }}>
                      {(prob * 100).toFixed(1)}%
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Score Matrix (collapsible) ── */}
          <Collapsible label={`Score Matrix · V3 (DC blend) · λ ${v3.lambdaHome.toFixed(2)} vs ${v3.lambdaAway.toFixed(2)}`}>
            <MiniMatrix matrix={v3.matrix} homeTeam={match.home_team} awayTeam={match.away_team} />
          </Collapsible>
        </>
      ) : (
        <div style={{ background: 'var(--color-bg-card)', border: '0.5px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 20, textAlign: 'center' }}>
          <p style={{ fontSize: 15, color: 'var(--color-text-muted)' }}>
            Both teams need stats before the model can run (MT06)
          </p>
          {isAdmin && !statsLoading && (
            <button
              onClick={onRefresh}
              disabled={refreshing}
              style={{ marginTop: 12, minHeight: 44, padding: '0 16px', background: 'var(--color-accent-dim)', border: '0.5px solid var(--color-accent-border)', borderRadius: 'var(--radius-sm)', color: 'var(--color-accent)', fontFamily: 'var(--font-ui)', fontSize: 15, cursor: 'pointer' }}
            >
              {refreshing ? t('common.loading') : t('analysis.fetchStats')}
            </button>
          )}
        </div>
      )}

      {/* ── Supporting Stats (collapsible) ── */}
      <Collapsible label={`Supporting Stats · ${match.home_team} vs ${match.away_team}`}>
        {statsLoading ? (
          <div style={{ display: 'flex', gap: 10 }}>
            <div className="skeleton" style={{ flex: 1, height: 140 }} />
            <div className="skeleton" style={{ flex: 1, height: 140 }} />
          </div>
        ) : (
          <>
            {statsError && (
              <p style={{ fontSize: 13, color: 'var(--color-danger)', marginBottom: 10 }}>⚠ {statsError}</p>
            )}
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <CompactTeamStats teamStats={stats.home} teamName={match.home_team} isHome t={t} />
              <CompactTeamStats teamStats={stats.away} teamName={match.away_team} isHome={false} t={t} />
            </div>
            {isAdmin && (
              <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                {lastUpdated && (
                  <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                    {t('analysis.lastUpdated')} {new Date(lastUpdated).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false, month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </span>
                )}
                <button
                  onClick={onRefresh}
                  disabled={refreshing}
                  style={{ minHeight: 36, padding: '0 12px', background: 'var(--color-accent-dim)', border: '0.5px solid var(--color-accent-border)', borderRadius: 'var(--radius-sm)', color: 'var(--color-accent)', fontFamily: 'var(--font-ui)', fontSize: 12, cursor: refreshing ? 'not-allowed' : 'pointer', opacity: refreshing ? 0.7 : 1 }}
                >
                  {refreshing ? t('common.loading') : t('analysis.fetchLatest')}
                </button>
              </div>
            )}
          </>
        )}
      </Collapsible>

      {/* ── AI Role Analysis (collapsible) ── */}
      {(() => {
        const outputByRoleId = {}
        for (const o of (roleOutputs || [])) outputByRoleId[o.role_id] = o

        const role10 = (aiRoles || []).find(r => r.role_number === 10)
        const role10Out = role10 ? outputByRoleId[role10.id] : null
        const otherRoles = (aiRoles || []).filter(r => r.role_number !== 10)
        const hasOutputs = (roleOutputs?.length ?? 0) > 0

        const collapsePreview = aiConf != null
          ? (lang === 'zh'
              ? `综合：${aiConf}/100 · 上次运行：${lastAiRun || '—'}`
              : `Composite: ${aiConf}/100 · Last run: ${lastAiRun || '—'}`)
          : (lang === 'zh' ? '尚未运行AI分析' : 'No AI analysis run yet')

        return (
          <Collapsible label={`🤖 ${lang === 'zh' ? 'AI角色分析' : 'AI Role Analysis'} · ${collapsePreview}`}>
            {!hasOutputs ? (
              <div style={{ textAlign: 'center', padding: '8px 0 4px' }}>
                <p style={{ fontSize: 14, color: 'var(--color-text-muted)', marginBottom: 12 }}>
                  {lang === 'zh'
                    ? '此场比赛尚未运行AI分析。运行AI分析以查看11个专项角色输出。'
                    : 'No AI analysis run yet for this match. Run AI Analysis to see 11 specialist role outputs.'}
                </p>
                <button
                  onClick={onRunAI}
                  disabled={aiRunning || !onRunAI}
                  style={{
                    minHeight: 44, padding: '0 24px',
                    background: 'var(--color-accent-dim)',
                    border: '0.5px solid var(--color-accent-border)',
                    borderRadius: 'var(--radius-sm)',
                    color: 'var(--color-accent)', fontFamily: 'var(--font-ui)',
                    fontSize: 15, fontWeight: 600,
                    cursor: (aiRunning || !onRunAI) ? 'not-allowed' : 'pointer',
                    opacity: (aiRunning || !onRunAI) ? 0.6 : 1,
                  }}
                >
                  {aiRunning ? '⏳ Analysing…' : (lang === 'zh' ? '▶ 运行AI分析' : '▶ Run AI Analysis')}
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {role10Out && (
                  <AiRoleCard output_json={role10Out.output_json} isComposite />
                )}
                {otherRoles.map(r => {
                  const out = outputByRoleId[r.id]
                  if (!out) return null
                  return <AiRoleCard key={r.id} output_json={out.output_json} isComposite={false} />
                })}
                {onRunAI && (
                  <button
                    onClick={onRunAI}
                    disabled={aiRunning}
                    style={{
                      minHeight: 44, padding: '0 16px', marginTop: 4,
                      background: 'transparent',
                      border: '0.5px solid var(--color-border)',
                      borderRadius: 'var(--radius-sm)',
                      color: 'var(--color-text-secondary)', fontFamily: 'var(--font-ui)',
                      fontSize: 14, fontWeight: 500,
                      cursor: aiRunning ? 'not-allowed' : 'pointer', opacity: aiRunning ? 0.6 : 1,
                    }}
                  >
                    {aiRunning ? '⏳ Analysing…' : (lang === 'zh' ? '↺ 重新分析' : '↺ Re-run Analysis')}
                  </button>
                )}
              </div>
            )}
          </Collapsible>
        )
      })()}

    </div>
  )
}
