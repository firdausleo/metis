import { useTranslation, setLanguage } from '../lib/i18n'
import { useAuth } from '../hooks/useAuth'

export default function Settings() {
  const { t, lang } = useTranslation()
  const { signOut } = useAuth()

  return (
    <div style={{ padding: '24px 16px', maxWidth: 720, margin: '0 auto' }}>
      <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 600, marginBottom: 24 }}>{t('nav.settings')}</h1>

      <div style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '16px 20px', marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 16 }}>{t('settings.language')}</span>
        <div style={{ display: 'flex', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-full)', overflow: 'hidden' }}>
          {[['en', 'EN'], ['zh', '中文']].map(([code, label]) => (
            <button key={code} onClick={() => setLanguage(code)} style={{
              minHeight: 44, padding: '0 18px', fontSize: 15, fontWeight: 700, border: 'none', cursor: 'pointer',
              background: lang === code ? 'var(--color-accent)' : 'transparent',
              color: lang === code ? 'var(--color-bg)' : 'var(--color-text-secondary)',
            }}>{label}</button>
          ))}
        </div>
      </div>

      <button onClick={signOut} style={{ minHeight: 44, width: '100%', fontSize: 16, fontWeight: 700, background: 'var(--color-bg-card)', color: 'var(--color-danger)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', cursor: 'pointer' }}>
        {t('nav.logout')}
      </button>
    </div>
  )
}
