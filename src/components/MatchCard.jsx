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

export default function MatchCard({ match, onAnalyze, compact = false, isAnalyzed = false }) {
  const { t } = useTranslation()

  const isTBD = match.home_team === 'TBD' || match.away_team === 'TBD'
  const today = isToday(match.match_date)
  const hasScore = match.home_score !== null && match.away_score !== null

  const stageLabel = match.stage === 'group'
    ? `GROUP ${match.group_name}`
    : STAGE_LABELS[match.stage] || match.stage.toUpperCase()

  const dateStr = toBeijingTime(match.match_date, 'date')
  const timeStr = toBeijingTime(match.match_date, 'time')

  const statusMap = {
    upcoming:  { key: 'match.upcoming',  bg: 'var(--color-info-dim)',    color: 'var(--color-info)',         pulse: false },
    live:      { key: 'match.live',      bg: 'var(--color-danger-dim)',  color: 'var(--color-danger)',       pulse: true  },
    completed: { key: 'match.completed', bg: 'var(--color-bg-hover)',    color: 'var(--color-text-muted)',   pulse: false },
    finished:  { key: 'match.completed', bg: 'var(--color-bg-hover)',    color: 'var(--color-text-muted)',   pulse: false },
  }
  const status = statusMap[match.status] || statusMap.upcoming

  return (
    <div style={{
      background: 'var(--color-bg-secondary)',
      border: today
        ? '1px solid var(--color-accent-border)'
        : '0.5px solid var(--color-border)',
      borderRadius: 'var(--radius-lg)',
      padding: compact ? 12 : 16,
      marginBottom: compact ? 0 : 8,
      position: 'relative',
      minWidth: compact ? 190 : 'auto',
      flexShrink: compact ? 0 : undefined,
    }}>

      {/* TODAY badge */}
      {today && (
        <span style={{
          position: 'absolute', top: 12, right: compact ? 8 : 12,
          fontSize: 10, fontWeight: 700,
          color: 'var(--color-accent)',
          letterSpacing: '0.06em',
        }}>
          {t('match.today')}
        </span>
      )}

      {/* Meta row: stage · time or score */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: compact ? 6 : 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, color: 'var(--color-text-muted)', fontWeight: 500, letterSpacing: '0.05em' }}>
          {stageLabel}
        </span>
        <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>·</span>
        {hasScore ? (
          <span style={{ fontSize: 11, color: 'var(--color-text-secondary)', fontWeight: 700 }}>
            {match.home_score} – {match.away_score}
          </span>
        ) : (
          <span style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>
            {dateStr} {timeStr} 北京
          </span>
        )}
      </div>

      {/* Teams */}
      <div style={{ marginBottom: compact ? 8 : 12 }}>
        <div style={{
          fontFamily: 'var(--font-display)',
          fontSize: compact ? 15 : 17,
          fontWeight: 500,
          color: match.home_team === 'TBD' ? 'var(--color-text-muted)' : 'var(--color-text-primary)',
          marginBottom: 3,
          lineHeight: 1.3,
        }}>
          {getFlag(match.home_team)}{' '}
          {match.home_team === 'TBD' ? t('match.tbdTeam') : match.home_team}
        </div>
        <div style={{
          fontFamily: 'var(--font-display)',
          fontSize: compact ? 15 : 17,
          fontWeight: 500,
          color: match.away_team === 'TBD' ? 'var(--color-text-muted)' : 'var(--color-text-primary)',
          lineHeight: 1.3,
        }}>
          {getFlag(match.away_team)}{' '}
          {match.away_team === 'TBD' ? t('match.tbdTeam') : match.away_team}
        </div>
      </div>

      {/* Bottom row: status badge + analyzed badge + analyze button */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span
          className={status.pulse ? 'badge-live' : undefined}
          style={{
            fontSize: 10, fontWeight: 700, letterSpacing: '0.06em',
            padding: '3px 7px',
            borderRadius: 'var(--radius-sm)',
            background: status.bg,
            color: status.color,
          }}
        >
          {t(status.key)}
        </span>

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
