import { useTranslation } from '../lib/i18n'
import { useAuth } from '../hooks/useAuth'

export default function Settings() {
  const { t } = useTranslation()
  const { signOut } = useAuth()

  return (
    <div style={{ padding: '24px 16px', maxWidth: 720, margin: '0 auto' }}>
      <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 600, marginBottom: 24 }}>{t('nav.settings')}</h1>

      <button onClick={signOut} style={{ minHeight: 44, width: '100%', fontSize: 16, fontWeight: 700, background: 'var(--color-bg-card)', color: 'var(--color-danger)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', cursor: 'pointer' }}>
        {t('nav.logout')}
      </button>
    </div>
  )
}
