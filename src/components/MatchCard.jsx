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
}) {
  const { t } = useTranslation()
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
    </div>
  )
}
