import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useTranslation, setLanguage } from '../lib/i18n'

export default function Auth() {
  const [mode, setMode] = useState('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const { signIn, signUp } = useAuth()
  const navigate = useNavigate()
  const { t, lang } = useTranslation()

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setSubmitting(true)

    const { error: authError } = mode === 'login'
      ? await signIn(email, password)
      : await signUp(email, password)

    setSubmitting(false)

    if (authError) {
      setError(authError.message)
    } else {
      navigate('/')
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--color-bg)', position: 'relative' }}>
      <button
        onClick={() => setLanguage(lang === 'en' ? 'zh' : 'en')}
        style={{ position: 'absolute', top: 16, right: 16, background: 'var(--color-bg-card)', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)', padding: '6px 14px', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontFamily: 'var(--font-ui)' }}
      >
        {lang === 'en' ? '中文' : 'EN'}
      </button>

      <div style={{ width: '100%', maxWidth: 380, padding: 32, background: 'var(--color-bg-card)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)' }}>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 600, marginBottom: 8, color: 'var(--color-text-primary)' }}>Metis</h1>
        <p style={{ color: 'var(--color-text-secondary)', marginBottom: 28, fontSize: 14 }}>
          {mode === 'login' ? t('auth.login') : t('auth.signup')}
        </p>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', marginBottom: 6, fontSize: 13, color: 'var(--color-text-secondary)' }}>{t('auth.email')}</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              style={{ width: '100%', padding: '10px 12px', background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', color: 'var(--color-text-primary)', fontFamily: 'var(--font-ui)', fontSize: 14, outline: 'none', boxSizing: 'border-box' }}
            />
          </div>

          <div style={{ marginBottom: 24 }}>
            <label style={{ display: 'block', marginBottom: 6, fontSize: 13, color: 'var(--color-text-secondary)' }}>{t('auth.password')}</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              style={{ width: '100%', padding: '10px 12px', background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', color: 'var(--color-text-primary)', fontFamily: 'var(--font-ui)', fontSize: 14, outline: 'none', boxSizing: 'border-box' }}
            />
          </div>

          {error && (
            <p style={{ color: 'var(--color-danger)', fontSize: 13, marginBottom: 16 }}>{error}</p>
          )}

          <button
            type="submit"
            disabled={submitting}
            style={{ width: '100%', padding: '11px', background: 'var(--color-accent)', color: '#000', fontWeight: 600, fontSize: 14, border: 'none', borderRadius: 'var(--radius-sm)', cursor: submitting ? 'not-allowed' : 'pointer', fontFamily: 'var(--font-ui)', minHeight: 'var(--touch-target)', opacity: submitting ? 0.7 : 1 }}
          >
            {submitting ? t('common.loading') : (mode === 'login' ? t('auth.login') : t('auth.signup'))}
          </button>
        </form>

        <p style={{ marginTop: 20, textAlign: 'center', fontSize: 13, color: 'var(--color-text-secondary)' }}>
          {mode === 'login' ? (
            <><span>No account? </span><button onClick={() => setMode('signup')} style={{ background: 'none', border: 'none', color: 'var(--color-accent)', cursor: 'pointer', fontFamily: 'var(--font-ui)', fontSize: 13 }}>{t('auth.signup')}</button></>
          ) : (
            <><span>Have an account? </span><button onClick={() => setMode('login')} style={{ background: 'none', border: 'none', color: 'var(--color-accent)', cursor: 'pointer', fontFamily: 'var(--font-ui)', fontSize: 13 }}>{t('auth.login')}</button></>
          )}
        </p>
      </div>
    </div>
  )
}
