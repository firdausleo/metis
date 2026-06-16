import { useState } from 'react'
import { useTranslation } from '../lib/i18n'
import { getFlag } from '../lib/teamFlags'
import { toBeijingTime, isToday } from '../lib/dateUtils'

const STAGE_LABELS = {
  r32: 'ROUND OF 32',
  r16: 'ROUND OF 16',
  qf: 'QUARTER FINAL',
  sf: 'SEMI FINAL',
  '3rd': 'THIRD PLACE',
  final: 'FINAL',
}

function FormDots({ formString }) {
  if (!formString) return null
  const chars = formString.slice(0, 5).split('')
  const colour = { W: 'var(--color-success)', D: 'var(--color-warning)', L: 'var(--color-danger)' }
  return (
    <span style={{ display: 'inline-flex', gap: 3, alignItems: 'center' }}>
      {chars.map((c, i) => (
        <span
          key={i}
          title={c === 'W' ? 'Win' : c === 'D' ? 'Draw' : 'Loss'}
          style={{
            width: 7, height: 7,
            borderRadius: '50%',
            background: colour[c] || 'var(--color-text-muted)',
            display: 'inline-block',
            flexShrink: 0,
          }}
        />
      ))}
    </span>
  )
}

function StatsBadge({ homeStats, awayStats }) {
  if (!homeStats && !awayStats) return null
  const both = homeStats && awayStats
  return (
    <span style={{
      fontSize: 10, fontWeight: 600,
      padding: '2px 6px',
      borderRadius: 'var(--radius-sm)',
      background: both ? 'var(--color-success-dim)' : 'var(--color-warning-dim)',
      color: both ? 'var(--color-success)' : 'var(--color-warning)',
      letterSpacing: '0.04em',
      whiteSpace: 'nowrap',
    }}>
      {both ? '📊 Stats' : '📊 Partial'}
    </span>
  )
}

export default function MatchCard({
  match,
  onAnalyze,
  compact = false,
  isAnalyzed = false,
  homeStats = null,
  awayStats = null,
  dcDivergent = null,
  prediction = null,
}) {
  const { t, lang } = useTranslation()
  const [hovered, setHovered] = useState(false)

  const isTBD = match.home_team === 'TBD' || match.away_team === 'TBD'
  const today = isToday(match.match_date)
  const hasScore = match.home_score !== null && match.away_score !== null
  const isFinished = match.status === 'finished' || match.status === 'completed'
  const isLive = match.status === 'live'

  const stageLabel = match.stage === 'group'
    ? `GROUP ${match.group_name}`
    : STAGE_LABELS[match.stage] || match.stage?.toUpperCase() || ''

  const timeStr = toBeijingTime(match.match_date, 'time')

  // Status badge
  let statusText, statusBg, statusColor
  if (isFinished && hasScore) {
    statusText = `FT · ${match.home_score}–${match.away_score}`
    if (match.home_score > match.away_score) {
      statusBg = 'var(--color-success-dim)'; statusColor = 'var(--color-success)'
    } else if (match.away_score > match.home_score) {
      statusBg = 'var(--color-danger-dim)'; statusColor = 'var(--color-danger)'
    } else {
      statusBg = 'var(--color-warning-dim)'; statusColor = 'var(--color-warning)'
    }
  } else if (isLive) {
    statusText = t('match.live')
    statusBg = 'var(--color-danger-dim)'; statusColor = 'var(--color-danger)'
  } else {
    statusText = `${timeStr} 北京`
    statusBg = 'var(--color-info-dim)'; statusColor = 'var(--color-info)'
  }

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: 'var(--color-bg-secondary)',
        border: today
          ? '1px solid var(--color-accent-border)'
          : '0.5px solid var(--color-border)',
        boxShadow: hovered ? 'inset 3px 0 0 var(--color-accent)' : 'none',
        borderRadius: 'var(--radius-lg)',
        padding: compact ? 12 : 16,
        marginBottom: compact ? 0 : 8,
        position: 'relative',
        minWidth: compact ? 190 : 'auto',
        flexShrink: compact ? 0 : undefined,
        transition: 'box-shadow 0.15s',
      }}
    >
      {/* Top row: group badge + today badge */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{
          fontSize: 10, fontWeight: 700, letterSpacing: '0.05em',
          color: 'var(--color-text-muted)',
          background: 'var(--color-bg-hover)',
          padding: '2px 6px',
          borderRadius: 'var(--radius-sm)',
        }}>
          {stageLabel}
        </span>
        {today && (
          <span style={{
            fontSize: 10, fontWeight: 700,
            color: 'var(--color-accent)',
            letterSpacing: '0.06em',
          }}>
            {t('match.today')}
          </span>
        )}
      </div>

      {/* Horizontal layout: Home | Score/vs | Away */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        marginBottom: compact ? 8 : 10,
      }}>
        {/* Home team — left */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontFamily: 'var(--font-display)',
            fontSize: compact ? 14 : 16,
            fontWeight: 500,
            color: match.home_team === 'TBD' ? 'var(--color-text-muted)' : 'var(--color-text-primary)',
            lineHeight: 1.3,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}>
            {getFlag(match.home_team)}{' '}
            {match.home_team === 'TBD' ? t('match.tbdTeam') : match.home_team}
          </div>
          {!compact && homeStats?.form_string && (
            <div style={{ marginTop: 4 }}>
              <FormDots formString={homeStats.form_string} />
            </div>
          )}
        </div>

        {/* Score / vs — center */}
        <div style={{ textAlign: 'center', flexShrink: 0, minWidth: compact ? 40 : 64 }}>
          {hasScore ? (
            <span style={{
              fontFamily: 'var(--font-display)',
              fontSize: compact ? 20 : 28,
              fontWeight: 700,
              color: 'var(--color-text-primary)',
              letterSpacing: '0.04em',
            }}>
              {match.home_score} – {match.away_score}
            </span>
          ) : (
            <span style={{
              fontFamily: 'var(--font-display)',
              fontSize: compact ? 13 : 16,
              fontWeight: 400,
              color: 'var(--color-text-muted)',
            }}>
              vs
            </span>
          )}
        </div>

        {/* Away team — right */}
        <div style={{ flex: 1, minWidth: 0, textAlign: 'right' }}>
          <div style={{
            fontFamily: 'var(--font-display)',
            fontSize: compact ? 14 : 16,
            fontWeight: 500,
            color: match.away_team === 'TBD' ? 'var(--color-text-muted)' : 'var(--color-text-primary)',
            lineHeight: 1.3,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}>
            {match.away_team === 'TBD' ? t('match.tbdTeam') : match.away_team}{' '}
            {getFlag(match.away_team)}
          </div>
          {!compact && awayStats?.form_string && (
            <div style={{ marginTop: 4, display: 'flex', justifyContent: 'flex-end' }}>
              <FormDots formString={awayStats.form_string} />
            </div>
          )}
        </div>
      </div>

      {/* ── Prediction bar (upcoming only) ── */}
      {!compact && !isFinished && !isLive && prediction?.v3_home_win != null && (
        <div style={{ padding: '8px 0 10px', borderBottom: '0.5px solid var(--color-border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <span style={{ fontSize: 11, fontWeight: 500, color: '#1A3A6C', width: 34, flexShrink: 0 }}>
              {(prediction.v3_home_win * 100).toFixed(0)}%
            </span>
            <div style={{ flex: 1, height: 6, borderRadius: 3, overflow: 'hidden', display: 'flex' }}>
              <div style={{ width: `${prediction.v3_home_win * 100}%`, background: '#1A3A6C', height: '100%' }} />
              <div style={{ width: `${prediction.v3_draw * 100}%`, background: '#9CA3AF', height: '100%' }} />
              <div style={{ width: `${prediction.v3_away_win * 100}%`, background: '#C9A84C', height: '100%' }} />
            </div>
            <span style={{ fontSize: 11, fontWeight: 500, color: '#C9A84C', width: 34, textAlign: 'right', flexShrink: 0 }}>
              {(prediction.v3_away_win * 100).toFixed(0)}%
            </span>
          </div>
          <div style={{ textAlign: 'center', fontSize: 10, color: 'var(--color-text-muted)', marginBottom: 6 }}>
            {lang === 'zh' ? '平局' : 'Draw'} {(prediction.v3_draw * 100).toFixed(0)}%
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>
              {prediction.anchor_total != null
                ? (lang === 'zh' ? `锚定：${prediction.anchor_total}球` : `Anchor: ${prediction.anchor_total} goals`)
                : ''}
              {prediction.v3_top_score ? ` · ${prediction.v3_top_score}` : ''}
            </span>
            <div style={{ display: 'flex', gap: 3 }}>
              <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 99, background: '#EEEDFE', color: '#3C3489', fontWeight: 500 }}>V3</span>
              {prediction.quality_warning && (
                <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 99, background: '#FAEEDA', color: '#633806', fontWeight: 500 }}>
                  {lang === 'zh' ? '⚠ 低置信' : '⚠ Low conf'}
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Bottom row: status badge + stats + analyzed + analyze button */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <span
          className={isLive ? 'badge-live' : undefined}
          style={{
            fontSize: 10, fontWeight: 700, letterSpacing: '0.06em',
            padding: '3px 7px',
            borderRadius: 'var(--radius-sm)',
            background: statusBg,
            color: statusColor,
            whiteSpace: 'nowrap',
          }}
        >
          {statusText}
        </span>

        {!compact && <StatsBadge homeStats={homeStats} awayStats={awayStats} />}

        {isAnalyzed && (
          <span style={{
            fontSize: 10, fontWeight: 700, letterSpacing: '0.06em',
            padding: '3px 7px',
            borderRadius: 'var(--radius-sm)',
            background: 'var(--color-accent-dim)',
            color: 'var(--color-accent)',
          }}>
            {t('match.analyzed')}
          </span>
        )}

        {dcDivergent && (
          <span style={{
            fontSize: 10, fontWeight: 700, letterSpacing: '0.05em',
            padding: '3px 7px',
            borderRadius: 'var(--radius-sm)',
            background: '#EEEDFE',
            color: '#3C3489',
            border: '0.5px solid #534AB7',
            whiteSpace: 'nowrap',
          }}>
            ⚠ Models diverge
          </span>
        )}

        {!compact && (
          <button
            onClick={() => onAnalyze(match.id)}
            disabled={isTBD}
            style={{
              marginLeft: 'auto',
              minHeight: 'var(--touch-target)',
              padding: '0 14px',
              background: isTBD ? 'transparent' : 'var(--color-accent-dim)',
              border: isTBD
                ? '0.5px solid var(--color-border)'
                : '0.5px solid var(--color-accent-border)',
              borderRadius: 'var(--radius-sm)',
              color: isTBD ? 'var(--color-text-muted)' : 'var(--color-accent)',
              fontFamily: 'var(--font-ui)',
              fontSize: 13,
              fontWeight: 500,
              cursor: isTBD ? 'not-allowed' : 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            {t('matches.analyze')} →
          </button>
        )}
      </div>
      {/* ── Accuracy row (finished matches with prediction data) ── */}
      {!compact && isFinished && prediction?.actual_outcome != null && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8, paddingTop: 8, borderTop: '0.5px solid var(--color-border)', flexWrap: 'wrap', gap: 6 }}>
          <div style={{ fontSize: 11 }}>
            <span style={{ color: 'var(--color-text-muted)' }}>
              {lang === 'zh' ? 'V3预测：' : 'V3 predicted: '}
            </span>
            <span style={{ fontWeight: 500, color: 'var(--color-text-primary)' }}>
              {prediction.actual_outcome === 'H'
                ? `${match.home_team.split(' ')[0]} ${(prediction.v3_home_win * 100).toFixed(0)}%`
                : prediction.actual_outcome === 'D'
                ? `Draw ${(prediction.v3_draw * 100).toFixed(0)}%`
                : `${match.away_team.split(' ')[0]} ${(prediction.v3_away_win * 100).toFixed(0)}%`}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            {prediction.correct_v1 !== null && (
              <span style={{ fontSize: 9, fontWeight: 500, padding: '2px 5px', borderRadius: 99, background: prediction.correct_v1 ? '#EAF3DE' : '#FCEBEB', color: prediction.correct_v1 ? '#27500A' : '#791F1F' }}>
                V1 {prediction.correct_v1 ? '✓' : '✗'}
              </span>
            )}
            {prediction.correct_v2 !== null && (
              <span style={{ fontSize: 9, fontWeight: 500, padding: '2px 5px', borderRadius: 99, background: prediction.correct_v2 ? '#EAF3DE' : '#FCEBEB', color: prediction.correct_v2 ? '#27500A' : '#791F1F' }}>
                V2 {prediction.correct_v2 ? '✓' : '✗'}
              </span>
            )}
            {prediction.correct_v3 !== null && (
              <span style={{ fontSize: 9, fontWeight: 500, padding: '2px 5px', borderRadius: 99, background: prediction.correct_v3 ? '#EAF3DE' : '#FCEBEB', color: prediction.correct_v3 ? '#27500A' : '#791F1F', border: '0.5px solid #C9A84C' }}>
                V3 {prediction.correct_v3 ? '✓' : '✗'}
              </span>
            )}
            {prediction.brier_score != null && (
              <span style={{ fontSize: 9, color: 'var(--color-text-muted)', marginLeft: 2 }}>
                B:{prediction.brier_score.toFixed(2)}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
