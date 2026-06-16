import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useTranslation, setLanguage } from '../lib/i18n'
import { supabase } from '../lib/supabase'

export default function Auth() {
  const [mode, setMode] = useState('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const { signIn, signUp } = useAuth()
  const navigate = useNavigate()
  const { t, lang } = useTranslation()

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setSubmitting(true)

    if (mode === 'login') {
      const { error: authError } = await signIn(email, password)
      setSubmitting(false)
      if (authError) {
        setError(t('auth.error.invalid'))
      } else {
        navigate('/')
      }
      return
    }

    // Signup flow
    const signupOptions = inviteCode.trim()
      ? { data: { invite_code: inviteCode.trim().toUpperCase() } }
      : {}

    const { data, error: authError } = await signUp(email, password, signupOptions)
    setSubmitting(false)

    if (authError) {
      setError(t('auth.error.signup'))
      return
    }

    // Give the DB trigger a moment to run, then check profile status
    await new Promise(r => setTimeout(r, 600))

    const { data: profileData } = await supabase
      .from('user_profiles')
      .select('status')
      .eq('id', data.user.id)
      .single()

    if (profileData?.status === 'pending') {
      navigate('/pending', { replace: true })
    } else {
      navigate('/', { replace: true })
    }
  }

  const inputStyle = {
    width: '100%',
    padding: '11px 12px',
    background: 'var(--color-bg-secondary)',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-sm)',
    color: 'var(--color-text-primary)',
    fontFamily: 'var(--font-ui)',
    fontSize: 16,
    outline: 'none',
    boxSizing: 'border-box',
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--color-bg)', padding: '20px 16px' }}>
      <div style={{ width: '100%', maxWidth: 400, padding: '32px 28px', background: 'var(--color-bg-card)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)' }}>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '12px' }}>
          <button
            onClick={() => setLanguage(lang === 'zh' ? 'en' : 'zh')}
            style={{ fontSize: '12px', padding: '4px 10px', borderRadius: '99px', border: '0.5px solid var(--color-border-secondary)', background: 'transparent', color: 'var(--color-text-secondary)', cursor: 'pointer', minHeight: '32px' }}
          >
            {lang === 'zh' ? 'EN' : '中文'}
          </button>
        </div>

        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 32, fontWeight: 800, marginBottom: 4, color: 'var(--color-accent)', letterSpacing: '0.08em' }}>
          METIS
        </h1>
        <p style={{ color: 'var(--color-text-secondary)', marginBottom: 28, fontSize: 13 }}>
          {t('auth.subtitle')}
        </p>

        {/* Tab toggle */}
        <div style={{ display: 'flex', marginBottom: 24, background: 'var(--color-bg-secondary)', borderRadius: 'var(--radius-sm)', padding: 3 }}>
          {['login', 'signup'].map(m => (
            <button
              key={m}
              onClick={() => { setMode(m); setError(''); setInviteCode('') }}
              style={{
                flex: 1,
                padding: '8px 0',
                border: 'none',
                borderRadius: 'var(--radius-sm)',
                cursor: 'pointer',
                fontFamily: 'var(--font-ui)',
                fontSize: 14,
                fontWeight: 500,
                transition: 'background 0.15s, color 0.15s',
                background: mode === m ? 'var(--color-bg-card)' : 'transparent',
                color: mode === m ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
              }}
            >
              {m === 'login' ? t('auth.login') : t('auth.signup')}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 14 }}>
            <label style={{ display: 'block', marginBottom: 6, fontSize: 13, color: 'var(--color-text-secondary)' }}>
              {t('auth.email')}
            </label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder={t('auth.email')}
              required
              style={inputStyle}
            />
          </div>

          <div style={{ marginBottom: mode === 'signup' ? 14 : 20 }}>
            <label style={{ display: 'block', marginBottom: 6, fontSize: 13, color: 'var(--color-text-secondary)' }}>
              {t('auth.password')}
            </label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder={t('auth.password')}
              required
              style={inputStyle}
            />
          </div>

          {/* Invite code — signup only */}
          {mode === 'signup' && (
            <div style={{ marginBottom: 20 }}>
              <label style={{ display: 'block', marginBottom: 6, fontSize: 13, color: 'var(--color-text-secondary)' }}>
                {t('auth.inviteCode')}
              </label>
              <input
                type="text"
                value={inviteCode}
                onChange={e => setInviteCode(e.target.value.toUpperCase())}
                placeholder={t('auth.inviteCodePlaceholder')}
                maxLength={10}
                style={{ ...inputStyle, letterSpacing: '0.08em', fontWeight: 500 }}
              />
            </div>
          )}

          {error && (
            <div style={{ background: 'var(--color-danger-dim)', border: '1px solid var(--color-danger)', borderRadius: 'var(--radius-sm)', padding: '10px 12px', marginBottom: 16 }}>
              <p style={{ color: 'var(--color-danger)', fontSize: 13, margin: 0 }}>{error}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            style={{
              width: '100%',
              minHeight: 'var(--touch-target)',
              padding: '0 16px',
              background: submitting ? 'var(--color-accent-dim)' : 'var(--color-accent)',
              color: '#000000',
              fontWeight: 600,
              fontSize: 15,
              border: 'none',
              borderRadius: 'var(--radius-sm)',
              cursor: submitting ? 'not-allowed' : 'pointer',
              fontFamily: 'var(--font-ui)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              transition: 'opacity 0.15s',
            }}
          >
            {submitting && (
              <span style={{ width: 16, height: 16, border: '2px solid currentColor', borderTopColor: 'transparent', borderRadius: '50%', display: 'inline-block', animation: 'spin 0.7s linear infinite' }} />
            )}
            {submitting
              ? t('common.loading')
              : mode === 'login' ? t('auth.login') : t('auth.createAccount')}
          </button>
        </form>

        <p style={{ marginTop: 20, textAlign: 'center', fontSize: 13, color: 'var(--color-text-secondary)' }}>
          {mode === 'login' ? (
            <>{t('auth.noAccount')}{' '}<button onClick={() => { setMode('signup'); setError('') }} style={{ background: 'none', border: 'none', color: 'var(--color-accent)', cursor: 'pointer', fontFamily: 'var(--font-ui)', fontSize: 13, padding: 0 }}>{t('auth.signup')}</button></>
          ) : (
            <>{t('auth.hasAccount')}{' '}<button onClick={() => { setMode('login'); setError('') }} style={{ background: 'none', border: 'none', color: 'var(--color-accent)', cursor: 'pointer', fontFamily: 'var(--font-ui)', fontSize: 13, padding: 0 }}>{t('auth.login')}</button></>
          )}
        </p>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}
