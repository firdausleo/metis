import { useState } from 'react'
import { useTranslation } from '../../lib/i18n'
import { getFlag } from '../../lib/teamFlags'
import { SCORE_MAX } from '../../lib/poisson'

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

// ── PredictionTab ────────────────────────────────────────────────────────

export default function PredictionTab({
  match, stats, statsLoading, statsError,
  isAdmin, refreshing, onRefresh, onSaveManual, lastUpdated,
  sidebarModel, aiComposite,
}) {
  const { t, lang } = useTranslation()
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

  // ── Total goals table ────────────────────────────────────────────────────
  // v3.totalGoals is [{ goals, prob }] from matrixStats — sorted by goals
  // We want sorted by prob desc, top 8.
  const goalsSorted = v3?.totalGoals
    ? [...v3.totalGoals].sort((a, b) => b.prob - a.prob).slice(0, 8)
    : []

  // k_star = single highest-prob goals total (no lambda thresholds)
  const kStarEntry = goalsSorted[0] ?? null  // goalsSorted is already desc by prob
  const kStar = kStarEntry?.goals ?? null

  // Over/under probs at kStar - 0.5 (from v1, which has anchor flag)
  const anchorEntry = v1?.totalGoals?.find(g => g.anchor)

  // dominant outcome from V3 probs (single highest)
  const dominant = v3?.probs
    ? v3.probs.home >= v3.probs.away && v3.probs.home >= v3.probs.draw ? 'home'
    : v3.probs.away > v3.probs.home && v3.probs.away >= v3.probs.draw ? 'away'
    : 'draw'
    : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

      {/* ── AI Verdict ── */}
      {aiComposite && normRec && (
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
        </div>
      )}

      {/* ── V3 Probability boxes ── */}
      {hasModel ? (
        <>
          <div>
            <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--color-text-muted)', marginBottom: 8 }}>
              V3 MODEL (DC BLEND) · WIN / DRAW / LOSS
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

          {/* ── Total Goals table ── */}
          <div style={{ background: 'var(--color-bg-card)', border: '0.5px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '12px 14px' }}>
            <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--color-text-muted)', marginBottom: 10 }}>
              TOTAL GOALS · V3 (by probability)
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {goalsSorted.map(({ goals, prob }) => {
                const pct = (prob * 100).toFixed(1)
                const isAnchor = kStar != null && goals === kStar
                return (
                  <div key={goals} style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '6px 10px', borderRadius: 4,
                    background: isAnchor ? 'var(--color-accent-dim)' : 'transparent',
                    border: isAnchor ? '0.5px solid var(--color-accent-border)' : '0.5px solid transparent',
                  }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-text-secondary)', width: 20, textAlign: 'right' }}>
                      {goals}
                    </span>
                    <div style={{ flex: 1, height: 6, background: 'var(--color-bg)', borderRadius: 99, overflow: 'hidden' }}>
                      <div style={{ width: `${Math.min(pct * 4, 100)}%`, height: '100%', background: isAnchor ? 'var(--color-accent)' : 'var(--color-text-muted)', borderRadius: 99 }} />
                    </div>
                    <span style={{ fontSize: 13, fontWeight: 600, color: isAnchor ? 'var(--color-accent)' : 'var(--color-text-primary)', width: 44, textAlign: 'right' }}>
                      {pct}%
                    </span>
                    {isAnchor && <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--color-accent)', letterSpacing: '0.05em' }}>ANCHOR</span>}
                  </div>
                )
              })}
            </div>
            {kStar != null && (() => {
              // Compute Over (kStar-0.5) and Under (kStar-0.5) from v3 distribution
              let kOver = 0, kUnder = 0
              for (const { goals, prob } of (v3.totalGoals || [])) {
                if (goals >= kStar) kOver += prob
                else kUnder += prob
              }
              const betLine = kStar - 0.5
              return (
                <div style={{ marginTop: 10, paddingTop: 10, borderTop: '0.5px solid var(--color-border)', display: 'flex', gap: 20, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
                    Over {betLine}: <strong style={{ color: 'var(--color-accent)' }}>{(kOver * 100).toFixed(1)}%</strong>
                  </span>
                  <span style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
                    Under {kStar + 0.5}: <strong style={{ color: 'var(--color-text-primary)' }}>{(kUnder * 100).toFixed(1)}%</strong>
                  </span>
                </div>
              )
            })()}
          </div>

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

    </div>
  )
}
