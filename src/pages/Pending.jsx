import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useUser } from '../context/UserContext'
import { useTranslation, setLanguage } from '../lib/i18n'

export default function Pending() {
  const { user, signOut } = useAuth()
  const { status, refreshProfile } = useUser()
  const navigate = useNavigate()
  const { t, lang } = useTranslation()

  const isRejected = status === 'rejected'

  // Auto-refresh every 60s; redirect when approved
  useEffect(() => {
    const interval = setInterval(async () => {
      await refreshProfile()
    }, 60_000)
    return () => clearInterval(interval)
  }, [refreshProfile])

  useEffect(() => {
    if (status === 'approved') navigate('/', { replace: true })
  }, [status, navigate])

  async function handleLogout() {
    await signOut()
    navigate('/auth', { replace: true })
  }

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--color-bg)',
      position: 'relative',
      padding: '20px 16px',
    }}>
      <button
        onClick={() => setLanguage(lang === 'en' ? 'zh' : 'en')}
        style={{
          position: 'absolute', top: 16, right: 16,
          background: 'var(--color-bg-card)', border: '1px solid var(--color-border)',
          color: 'var(--color-text-secondary)', padding: '6px 14px',
          borderRadius: 'var(--radius-sm)', cursor: 'pointer',
          fontFamily: 'var(--font-ui)', fontSize: 13,
        }}
      >
        {lang === 'en' ? '中文' : 'EN'}
      </button>

      <div style={{
        width: '100%', maxWidth: 440,
        padding: '40px 32px',
        background: 'var(--color-bg-card)',
        borderRadius: 'var(--radius-lg)',
        border: `1px solid ${isRejected ? 'var(--color-danger)' : 'var(--color-accent-border)'}`,
        textAlign: 'center',
      }}>
        {/* Logo */}
        <div style={{
          fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 28,
          color: 'var(--color-accent)', letterSpacing: '0.08em', marginBottom: 24,
        }}>
          METIS
        </div>

        {/* Icon */}
        <div style={{ fontSize: 48, marginBottom: 16 }}>
          {isRejected ? '❌' : '⏳'}
        </div>

        {/* Heading */}
        <h1 style={{
          fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 700,
          color: isRejected ? 'var(--color-danger)' : 'var(--color-text-primary)',
          marginBottom: 12,
        }}>
          {isRejected ? t('pending.rejected.heading') : t('pending.heading')}
        </h1>

        {/* Body */}
        <p style={{
          color: 'var(--color-text-secondary)', fontSize: 15, lineHeight: 1.6,
          marginBottom: 24,
        }}>
          {isRejected ? t('pending.rejected.body') : t('pending.body')}
        </p>

        {/* Registered email */}
        {user?.email && (
          <div style={{
            background: 'var(--color-bg-secondary)',
            borderRadius: 'var(--radius-sm)',
            padding: '10px 14px',
            marginBottom: 28,
            display: 'inline-block',
            width: '100%',
          }}>
            <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 2 }}>
              {t('pending.email')}
            </p>
            <p style={{ fontSize: 14, color: 'var(--color-text-primary)', fontWeight: 500 }}>
              {user.email}
            </p>
          </div>
        )}

        {/* Auto-refresh note (pending only) */}
        {!isRejected && (
          <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 20 }}>
            {t('pending.autoRefresh')}
          </p>
        )}

        {/* Logout */}
        <button
          onClick={handleLogout}
          style={{
            width: '100%',
            minHeight: 'var(--touch-target)',
            padding: '0 16px',
            background: 'transparent',
            border: '1px solid var(--color-border)',
            color: 'var(--color-text-secondary)',
            fontWeight: 500, fontSize: 14,
            borderRadius: 'var(--radius-sm)',
            cursor: 'pointer',
            fontFamily: 'var(--font-ui)',
          }}
        >
          {t('nav.logout')}
        </button>
      </div>
    </div>
  )
}
