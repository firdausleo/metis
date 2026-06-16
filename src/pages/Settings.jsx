import { useState } from 'react'
import { useTranslation, setLanguage } from '../lib/i18n'
import { useAuth } from '../hooks/useAuth'
import { useUser } from '../context/UserContext'
import { supabase } from '../lib/supabase'

const TIER_COLORS = {
  admin:    { bg: '#2D1B69', text: '#E0D7FF' },
  ultra:    { bg: '#1A3A6C', text: '#D0E4FF' },
  power:    { bg: '#2D4A1A', text: '#C8F0C0' },
  standard: { bg: '#3A2A10', text: '#F0D898' },
}

function SectionCard({ title, children }) {
  return (
    <div style={{
      background: 'var(--color-bg-card)',
      border: '1px solid var(--color-border)',
      borderRadius: 'var(--radius-lg)',
      marginBottom: 20,
      overflow: 'hidden',
    }}>
      <div style={{
        padding: '14px 20px',
        borderBottom: '1px solid var(--color-border-light)',
        fontFamily: 'var(--font-display)',
        fontSize: 13,
        fontWeight: 700,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        color: 'var(--color-text-secondary)',
      }}>{title}</div>
      <div style={{ padding: 20 }}>{children}</div>
    </div>
  )
}

function FieldError({ msg }) {
  if (!msg) return null
  return <div style={{ fontSize: 12, color: 'var(--color-danger)', marginTop: 4 }}>{msg}</div>
}

export default function Settings() {
  const { t, lang } = useTranslation()
  const { signOut, user } = useAuth()
  const { tier, credits } = useUser()

  const [currentPw, setCurrentPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [pwLoading, setPwLoading] = useState(false)
  const [pwSuccess, setPwSuccess] = useState(false)
  const [pwError, setPwError] = useState('')
  const [fieldErrors, setFieldErrors] = useState({})

  const inputStyle = {
    display: 'block',
    width: '100%',
    minHeight: 44,
    fontSize: 16,
    padding: '10px 12px',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-md)',
    background: 'var(--color-bg)',
    color: 'var(--color-text-primary)',
    outline: 'none',
    marginTop: 6,
    fontFamily: 'var(--font-ui)',
  }

  const labelStyle = {
    display: 'block',
    fontSize: 14,
    fontWeight: 600,
    color: 'var(--color-text-secondary)',
    marginBottom: 16,
  }

  async function handlePasswordChange(e) {
    e.preventDefault()
    setPwError('')
    setFieldErrors({})

    const errs = {}
    if (!currentPw) errs.currentPw = lang === 'zh' ? '请输入当前密码' : 'Required'
    if (!newPw) errs.newPw = lang === 'zh' ? '请输入新密码' : 'Required'
    else if (newPw.length < 8) errs.newPw = lang === 'zh' ? '至少8位字符' : 'Minimum 8 characters'
    if (!confirmPw) errs.confirmPw = lang === 'zh' ? '请确认新密码' : 'Required'
    else if (newPw && confirmPw !== newPw) errs.confirmPw = lang === 'zh' ? '两次密码不一致' : 'Passwords do not match'
    if (newPw && currentPw && newPw === currentPw) errs.newPw = lang === 'zh' ? '新密码不能与当前密码相同' : 'New password must differ from current'

    if (Object.keys(errs).length) { setFieldErrors(errs); return }

    setPwLoading(true)
    const email = user?.email
    const { error: verifyErr } = await supabase.auth.signInWithPassword({ email, password: currentPw })
    if (verifyErr) {
      setPwLoading(false)
      setPwError(lang === 'zh' ? '当前密码不正确' : 'Current password is incorrect')
      return
    }

    const { error: updateErr } = await supabase.auth.updateUser({ password: newPw })
    setPwLoading(false)
    if (updateErr) {
      setPwError(updateErr.message)
      return
    }

    setCurrentPw('')
    setNewPw('')
    setConfirmPw('')
    setPwSuccess(true)
    setTimeout(() => setPwSuccess(false), 3000)
  }

  const tierColor = TIER_COLORS[tier] ?? TIER_COLORS.standard

  return (
    <div style={{ padding: '24px 16px', maxWidth: 560, margin: '0 auto' }}>
      <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 700, marginBottom: 24 }}>
        {t('nav.settings')}
      </h1>

      {/* Account */}
      <SectionCard title={lang === 'zh' ? '账户' : 'Account'}>
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-muted)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            {t('auth.email')}
          </div>
          <div style={{ fontSize: 15, color: 'var(--color-text-primary)' }}>{user?.email ?? '—'}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-muted)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              {lang === 'zh' ? '会员等级' : 'Tier'}
            </div>
            <span style={{
              display: 'inline-block',
              padding: '3px 10px',
              borderRadius: 20,
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
              background: tierColor.bg,
              color: tierColor.text,
            }}>{tier}</span>
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-muted)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              {lang === 'zh' ? '剩余积分' : 'Credits'}
            </div>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--color-accent)' }}>{credits}</div>
          </div>
        </div>
      </SectionCard>

      {/* Security */}
      <SectionCard title={lang === 'zh' ? '安全设置' : 'Security'}>
        <form onSubmit={handlePasswordChange} noValidate>
          <div style={{ marginBottom: 16 }}>
            <label style={labelStyle}>
              {lang === 'zh' ? '当前密码' : 'Current password'}
              <input
                type="password"
                value={currentPw}
                onChange={e => setCurrentPw(e.target.value)}
                style={{ ...inputStyle, borderColor: fieldErrors.currentPw ? 'var(--color-danger)' : 'var(--color-border)' }}
                autoComplete="current-password"
                disabled={pwLoading}
              />
              <FieldError msg={fieldErrors.currentPw} />
            </label>
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={labelStyle}>
              {lang === 'zh' ? '新密码' : 'New password'}
              <input
                type="password"
                value={newPw}
                onChange={e => setNewPw(e.target.value)}
                style={{ ...inputStyle, borderColor: fieldErrors.newPw ? 'var(--color-danger)' : 'var(--color-border)' }}
                autoComplete="new-password"
                disabled={pwLoading}
              />
              <FieldError msg={fieldErrors.newPw} />
            </label>
          </div>

          <div style={{ marginBottom: 20 }}>
            <label style={labelStyle}>
              {lang === 'zh' ? '确认新密码' : 'Confirm new password'}
              <input
                type="password"
                value={confirmPw}
                onChange={e => setConfirmPw(e.target.value)}
                style={{ ...inputStyle, borderColor: fieldErrors.confirmPw ? 'var(--color-danger)' : 'var(--color-border)' }}
                autoComplete="new-password"
                disabled={pwLoading}
              />
              <FieldError msg={fieldErrors.confirmPw} />
            </label>
          </div>

          {pwError && (
            <div style={{
              padding: '10px 14px',
              background: 'var(--color-danger-dim)',
              border: '1px solid var(--color-danger)',
              borderRadius: 'var(--radius-sm)',
              fontSize: 14,
              color: 'var(--color-danger)',
              marginBottom: 16,
            }}>{pwError}</div>
          )}

          <button
            type="submit"
            disabled={pwLoading || pwSuccess}
            style={{
              minHeight: 44,
              width: '100%',
              fontSize: 15,
              fontWeight: 700,
              borderRadius: 'var(--radius-md)',
              border: 'none',
              cursor: pwLoading || pwSuccess ? 'default' : 'pointer',
              background: pwSuccess ? 'var(--color-success)' : '#1A3A6C',
              color: '#FFFFFF',
              transition: 'background 0.2s',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
            }}
          >
            {pwLoading && (
              <span style={{
                width: 16, height: 16,
                border: '2px solid rgba(255,255,255,0.3)',
                borderTopColor: '#fff',
                borderRadius: '50%',
                animation: 'spin 0.8s linear infinite',
                display: 'inline-block',
              }} />
            )}
            {pwSuccess
              ? (lang === 'zh' ? '密码已更新 ✓' : 'Password updated ✓')
              : pwLoading
                ? (lang === 'zh' ? '更新中...' : 'Updating...')
                : (lang === 'zh' ? '更新密码' : 'Update password')}
          </button>
        </form>
      </SectionCard>

      {/* Preferences */}
      <SectionCard title={lang === 'zh' ? '偏好设置' : 'Preferences'}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 15, color: 'var(--color-text-primary)' }}>{t('settings.language')}</span>
          <div style={{ display: 'flex', gap: 8 }}>
            {['en', 'zh'].map(l => (
              <button
                key={l}
                onClick={() => setLanguage(l)}
                style={{
                  minHeight: 36,
                  padding: '0 16px',
                  fontSize: 14,
                  fontWeight: 600,
                  borderRadius: 'var(--radius-sm)',
                  border: lang === l ? '2px solid var(--color-accent)' : '1px solid var(--color-border)',
                  background: lang === l ? 'var(--color-accent-dim)' : 'var(--color-bg)',
                  color: lang === l ? 'var(--color-accent)' : 'var(--color-text-secondary)',
                  cursor: 'pointer',
                }}
              >{l === 'en' ? 'English' : '中文'}</button>
            ))}
          </div>
        </div>
      </SectionCard>

      {/* Logout */}
      <button
        onClick={signOut}
        style={{
          minHeight: 44,
          width: '100%',
          fontSize: 15,
          fontWeight: 700,
          background: 'var(--color-bg-card)',
          color: 'var(--color-danger)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-md)',
          cursor: 'pointer',
        }}
      >
        {t('nav.logout')}
      </button>
    </div>
  )
}
