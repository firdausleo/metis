import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useUser } from '../context/UserContext'
import { useTranslation, setLanguage } from '../lib/i18n'

// FAQ replaces Settings in the main nav items; Settings stays in desktop right section
const NAV_ITEMS = [
  { key: 'nav.dashboard', icon: '📊', path: '/' },
  { key: 'nav.matches',   icon: '⚽', path: '/matches' },
  { key: 'nav.myBets',   icon: '🎯', path: '/my-bets' },
  { key: 'nav.picks',    icon: '💡', path: '/recommendations' },
  { key: 'nav.faq',      icon: '❓', path: '/faq' },
]

function isActive(path, pathname) {
  if (path === '/') return pathname === '/'
  return pathname.startsWith(path)
}

function LanguageToggle({ lang, mobile = false }) {
  const langs = [['en', 'EN'], ['zh', '中文']]
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: mobile ? 4 : 0 }}>
      {langs.map(([code, label], i) => (
        <span key={code} style={{ display: 'flex', alignItems: 'center' }}>
          {!mobile && i > 0 && (
            <span style={{ color: 'rgba(255,255,255,0.30)', fontSize: 13, margin: '0 4px', userSelect: 'none' }}>|</span>
          )}
          <button
            onClick={() => setLanguage(code)}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              padding: mobile ? '4px 6px' : '4px 6px',
              fontSize: mobile ? 11 : 13, fontWeight: 700,
              fontFamily: 'var(--font-ui)',
              color: lang === code ? 'var(--color-accent)' : 'rgba(255,255,255,0.40)',
              transition: 'color 0.15s',
            }}
          >
            {label}
          </button>
        </span>
      ))}
    </div>
  )
}

function CreditPill({ credits, navigate, t }) {
  let bg = '#EAF3DE', color = '#27500A'
  if (credits < 5)       { bg = '#FCEBEB'; color = '#791F1F' }
  else if (credits <= 10) { bg = '#FAEEDA'; color = '#633806' }

  return (
    <button
      onClick={() => navigate('/faq')}
      title={t('credits.tooltip')}
      style={{
        display: 'flex', alignItems: 'center', gap: 4,
        padding: '3px 10px', borderRadius: 99,
        background: bg, border: 'none',
        color, cursor: 'pointer',
        fontFamily: 'var(--font-ui)', fontSize: 12, fontWeight: 500,
        whiteSpace: 'nowrap', minHeight: 44,
      }}
    >
      ⚡ {credits}
    </button>
  )
}

export default function NavBar() {
  const { user, signOut } = useAuth()
  const { tier, credits } = useUser()
  const { t, lang } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()

  const showCreditPill = tier === 'power' || tier === 'standard'
  const isAdmin = tier === 'admin'

  async function handleSignOut() {
    await signOut()
    navigate('/auth')
  }

  return (
    <>
      {/* Desktop top nav */}
      <nav className="navbar-desktop" style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 100,
        height: 56,
        background: 'var(--color-blue)',
        borderBottom: '1px solid var(--color-accent-border)',
        display: 'flex', alignItems: 'center', padding: '0 24px', gap: 8,
      }}>
        <span style={{
          fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 20,
          color: 'var(--color-accent)', letterSpacing: '0.08em', marginRight: 16,
        }}>
          METIS
        </span>

        <div style={{ display: 'flex', gap: 4, flex: 1 }}>
          {NAV_ITEMS.slice(0, 4).map(item => (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              style={{
                border: 'none', cursor: 'pointer', padding: '6px 14px',
                borderRadius: 'var(--radius-sm)', fontFamily: 'var(--font-ui)',
                fontSize: 14, fontWeight: 500, minHeight: 'var(--touch-target)',
                color: isActive(item.path, location.pathname) ? 'var(--color-accent)' : 'rgba(255,255,255,0.80)',
                background: isActive(item.path, location.pathname) ? 'var(--color-accent-dim)' : 'transparent',
                transition: 'color 0.15s, background 0.15s',
              }}
            >
              {item.icon} {t(item.key)}
            </button>
          ))}
          {/* FAQ — 5th item, desktop */}
          <button
            onClick={() => navigate('/faq')}
            style={{
              border: 'none', cursor: 'pointer', padding: '6px 14px',
              borderRadius: 'var(--radius-sm)', fontFamily: 'var(--font-ui)',
              fontSize: 14, fontWeight: 500, minHeight: 'var(--touch-target)',
              color: isActive('/faq', location.pathname) ? 'var(--color-accent)' : 'rgba(255,255,255,0.80)',
              background: isActive('/faq', location.pathname) ? 'var(--color-accent-dim)' : 'transparent',
              transition: 'color 0.15s, background 0.15s',
            }}
          >
            ❓ {t('nav.faq')}
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <LanguageToggle lang={lang} />

          {/* Credit pill — power/standard only */}
          {showCreditPill && (
            <CreditPill credits={credits} navigate={navigate} t={t} />
          )}

          {/* Settings gear */}
          <button
            onClick={() => navigate('/settings')}
            style={{
              background: isActive('/settings', location.pathname) ? 'var(--color-accent-dim)' : 'none',
              border: 'none', cursor: 'pointer', padding: '6px 10px',
              borderRadius: 'var(--radius-sm)', fontSize: 16,
              minHeight: 'var(--touch-target)',
              color: isActive('/settings', location.pathname) ? 'var(--color-accent)' : 'rgba(255,255,255,0.80)',
            }}
            title={t('nav.settings')}
          >
            ⚙️
          </button>

          {/* Admin link — admin tier only */}
          {isAdmin && (
            <button
              onClick={() => navigate('/admin/users')}
              style={{
                border: 'none', cursor: 'pointer', padding: '5px 12px',
                borderRadius: 'var(--radius-sm)', fontFamily: 'var(--font-ui)',
                fontSize: 13, fontWeight: 700, minHeight: 'var(--touch-target)',
                color: isActive('/admin', location.pathname) ? '#000' : 'var(--color-accent)',
                background: isActive('/admin', location.pathname) ? 'var(--color-accent)' : 'var(--color-accent-dim)',
                transition: 'background 0.15s, color 0.15s',
              }}
            >
              {t('nav.admin')}
            </button>
          )}

          {user && (
            <span style={{
              fontSize: 12, color: 'rgba(255,255,255,0.55)',
              maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {user.email}
            </span>
          )}
          <button
            onClick={handleSignOut}
            style={{
              background: 'none', border: '0.5px solid var(--color-accent-border)',
              cursor: 'pointer', padding: '5px 12px', borderRadius: 'var(--radius-sm)',
              fontFamily: 'var(--font-ui)', fontSize: 13, color: 'rgba(255,255,255,0.80)',
            }}
          >
            {t('nav.logout')}
          </button>
        </div>
      </nav>

      {/* Mobile bottom nav */}
      <nav className="navbar-mobile" style={{
        position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 100,
        background: 'var(--color-blue)',
        borderTop: '1px solid var(--color-accent-border)',
        paddingBottom: 'env(safe-area-inset-bottom)',
        display: 'flex',
      }}>
        {NAV_ITEMS.map(item => {
          const active = isActive(item.path, location.pathname)
          return (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              style={{
                flex: 1, display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center',
                gap: 3, padding: '10px 0',
                background: 'none', border: 'none', cursor: 'pointer',
                color: active ? 'var(--color-accent)' : 'rgba(255,255,255,0.80)',
                minHeight: 'var(--touch-target)',
              }}
            >
              <span style={{ fontSize: 20, lineHeight: 1 }}>{item.icon}</span>
              <span style={{ fontSize: 11, fontFamily: 'var(--font-ui)', fontWeight: active ? 600 : 400 }}>
                {t(item.key)}
              </span>
            </button>
          )
        })}

        {/* Admin tab — mobile, admin only */}
        {isAdmin && (
          <button
            onClick={() => navigate('/admin/users')}
            style={{
              flex: 1, display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center',
              gap: 3, padding: '10px 0',
              background: 'none', border: 'none', cursor: 'pointer',
              color: isActive('/admin', location.pathname) ? 'var(--color-accent)' : 'rgba(255,255,255,0.80)',
              minHeight: 'var(--touch-target)',
            }}
          >
            <span style={{ fontSize: 20, lineHeight: 1 }}>🔧</span>
            <span style={{ fontSize: 11, fontFamily: 'var(--font-ui)', fontWeight: isActive('/admin', location.pathname) ? 600 : 400 }}>
              {t('nav.admin')}
            </span>
          </button>
        )}

        {/* Language toggle */}
        <div style={{
          flex: 1, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          gap: 3, padding: '10px 0', minHeight: 'var(--touch-target)',
        }}>
          <span style={{ fontSize: 20, lineHeight: 1 }}>🌐</span>
          <LanguageToggle lang={lang} mobile />
        </div>
      </nav>
    </>
  )
}
