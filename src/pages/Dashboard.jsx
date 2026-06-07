import { useAuth } from '../hooks/useAuth'
import { useTranslation } from '../lib/i18n'

const STAT_CARDS = [
  { key: 'dashboard.matchesAnalyzed', value: '0' },
  { key: 'dashboard.activeBets', value: '0' },
  { key: 'dashboard.totalPnl', value: '¥0.00' },
]

export default function Dashboard() {
  const { user } = useAuth()
  const { t } = useTranslation()

  return (
    <div style={{ padding: '24px 16px', maxWidth: 720, margin: '0 auto' }}>
      <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: 4 }}>
        {t('dashboard.welcome')}
      </h1>
      {user && (
        <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 24 }}>
          {user.email}
        </p>
      )}

      <div style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '16px 20px', marginBottom: 28 }}>
        <p style={{ color: 'var(--color-text-secondary)', fontSize: 14, margin: 0 }}>
          ⚽ {t('dashboard.coming')}
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
        {STAT_CARDS.map(card => (
          <div
            key={card.key}
            style={{
              background: 'var(--color-bg-card)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md)',
              padding: '20px 16px',
            }}
          >
            <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 8, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              {t(card.key)}
            </p>
            <p style={{ fontSize: 28, fontFamily: 'var(--font-display)', fontWeight: 600, color: 'var(--color-text-primary)' }}>
              {card.value}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}
