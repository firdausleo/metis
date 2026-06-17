import React, { useState, useRef, useEffect } from 'react'
import { NavLink, useNavigate, useLocation } from 'react-router-dom'
import { useTranslation, setLanguage } from '../lib/i18n'

const NAV_ITEMS = [
  { path: '/metis',     icon: 'ti-bolt',              labelEn: 'METIS',     labelZh: 'METIS',  gold: true },
  { path: '/dashboard', icon: 'ti-layout-dashboard',  labelEn: 'Dashboard', labelZh: '总览' },
  { path: '/matches',   icon: 'ti-calendar-event',    labelEn: 'Matches',   labelZh: '比赛' },
  { path: '/my-bets',   icon: 'ti-coins',             labelEn: 'My Tracker',labelZh: '追踪' },
  { path: '/faq',       icon: 'ti-help-circle',       labelEn: 'FAQ',       labelZh: '帮助' },
]

function DropdownPanel({ open, userName, isAdmin, lang, navigate, onLogout, setOpen, posStyle }) {
  if (!open) return null
  const itemStyle = (gold) => ({
    display: 'block', width: '100%',
    padding: '10px 14px', textAlign: 'left',
    background: 'transparent', border: 'none',
    borderBottom: '0.5px solid #e5e7eb',
    fontSize: 13, cursor: 'pointer',
    fontFamily: "'Space Grotesk', sans-serif",
    color: gold ? '#C9A84C' : '#111',
    fontWeight: gold ? 500 : 400,
  })
  return (
    <div style={{
      position: 'absolute', ...posStyle,
      width: 200, background: 'white',
      border: '0.5px solid #e5e7eb',
      borderRadius: 10,
      boxShadow: '0 8px 32px rgba(0,0,0,0.15)',
      overflow: 'hidden', zIndex: 400,
    }}>
      <div style={{
        padding: '12px 14px', borderBottom: '0.5px solid #e5e7eb',
        background: '#f9fafb',
      }}>
        <div style={{ fontSize: 12, fontWeight: 500, color: '#111', fontFamily: "'Space Grotesk', sans-serif" }}>
          {userName}
        </div>
        <div style={{ fontSize: 10, color: '#999', fontFamily: "'IBM Plex Mono', monospace", marginTop: 2 }}>
          {isAdmin ? 'ADMIN' : 'MEMBER'}
        </div>
      </div>

      <button onClick={() => { navigate('/settings'); setOpen(false) }} style={itemStyle()}>
        {lang === 'zh' ? '设置' : 'Settings'}
      </button>

      {isAdmin && (
        <>
          <div style={{
            padding: '6px 14px 4px', fontSize: 9,
            fontFamily: "'IBM Plex Mono', monospace",
            letterSpacing: '0.08em', color: '#999',
            textTransform: 'uppercase',
          }}>Admin</div>
          <button onClick={() => { navigate('/settings/metis'); setOpen(false) }} style={itemStyle(true)}>
            ⚡ METIS Settings
          </button>
          <button onClick={() => { navigate('/admin/users'); setOpen(false) }} style={itemStyle()}>
            👥 User Management
          </button>
          <button onClick={() => { navigate('/admin/knockout'); setOpen(false) }} style={itemStyle()}>
            🏆 Knockout Admin
          </button>
        </>
      )}

      <button
        onClick={() => { onLogout(); setOpen(false) }}
        style={{ ...itemStyle(), borderBottom: 'none', color: '#791F1F' }}
      >
        {lang === 'zh' ? '退出登录' : 'Logout'}
      </button>
    </div>
  )
}

export default function NavBar({ user, isAdmin, onLogout }) {
  const { lang } = useTranslation()
  const location = useLocation()
  const navigate = useNavigate()
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768)
  const menuRef = useRef(null)

  useEffect(() => {
    const fn = () => setIsMobile(window.innerWidth < 768)
    window.addEventListener('resize', fn)
    return () => window.removeEventListener('resize', fn)
  }, [])

  useEffect(() => {
    function handleClick(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setUserMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const userInitial = user?.email?.[0]?.toUpperCase() || 'U'
  const userName = (user?.email || '').split('@')[0]

  function isActive(path) {
    if (path === '/metis') return location.pathname === '/metis'
    return location.pathname.startsWith(path)
  }

  // ── MOBILE ──────────────────────────────────────────────────────────────
  if (isMobile) {
    return (
      <>
        {/* Top brand strip */}
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, height: 44,
          background: '#1A3A6C', display: 'flex',
          alignItems: 'center', justifyContent: 'space-between',
          padding: '0 16px', zIndex: 300,
          borderBottom: '0.5px solid rgba(255,255,255,0.08)',
        }}>
          <div style={{
            fontSize: 13, fontFamily: "'IBM Plex Mono', monospace",
            fontWeight: 600, letterSpacing: '0.2em', color: '#C9A84C',
          }}>METIS</div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button
              onClick={() => setLanguage(lang === 'zh' ? 'en' : 'zh')}
              style={{
                background: 'transparent', border: 'none',
                color: 'rgba(255,255,255,0.6)', fontSize: 11,
                fontFamily: "'IBM Plex Mono', monospace",
                cursor: 'pointer', padding: '4px 8px', minHeight: 'auto',
              }}
            >{lang === 'zh' ? 'EN' : '中文'}</button>

            <div ref={menuRef} style={{ position: 'relative' }}>
              <button
                onClick={() => setUserMenuOpen(prev => !prev)}
                style={{
                  width: 28, height: 28, borderRadius: '50%', minHeight: 'auto',
                  background: isAdmin ? '#C9A84C' : 'rgba(255,255,255,0.2)',
                  border: 'none', fontSize: 11, fontWeight: 600,
                  color: isAdmin ? '#1A3A6C' : 'white',
                  cursor: 'pointer', fontFamily: "'IBM Plex Mono', monospace",
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >{userInitial}</button>
              <DropdownPanel
                open={userMenuOpen} userName={userName} isAdmin={isAdmin}
                lang={lang} navigate={navigate} onLogout={onLogout}
                setOpen={setUserMenuOpen}
                posStyle={{ top: 36, right: 0 }}
              />
            </div>
          </div>
        </div>

        {/* Bottom nav */}
        <div style={{
          position: 'fixed', bottom: 0, left: 0, right: 0, height: 60,
          background: '#1A3A6C', display: 'flex',
          alignItems: 'center', justifyContent: 'space-around',
          zIndex: 300, borderTop: '0.5px solid rgba(255,255,255,0.08)',
        }}>
          {NAV_ITEMS.map(item => {
            const active = isActive(item.path)
            return (
              <NavLink key={item.path} to={item.path} style={{
                display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center',
                flex: 1, height: '100%', textDecoration: 'none',
                borderTop: active ? '2px solid #C9A84C' : '2px solid transparent',
              }}>
                <i className={`ti ${item.icon}`} aria-hidden="true" style={{
                  fontSize: 22,
                  color: active ? '#C9A84C' : 'rgba(255,255,255,0.50)',
                  display: 'block', lineHeight: 1,
                }} />
                <span style={{
                  fontSize: 9, fontFamily: "'IBM Plex Mono', monospace",
                  color: active ? '#C9A84C' : 'rgba(255,255,255,0.5)',
                  marginTop: 2, letterSpacing: '0.04em',
                }}>
                  {lang === 'zh' ? item.labelZh : item.labelEn}
                </span>
              </NavLink>
            )
          })}
        </div>
      </>
    )
  }

  // ── DESKTOP SIDEBAR ──────────────────────────────────────────────────────
  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, bottom: 0, width: 72,
      background: '#1A3A6C', display: 'flex', flexDirection: 'column',
      alignItems: 'center', paddingTop: 8, paddingBottom: 8,
      zIndex: 300, borderRight: '0.5px solid rgba(255,255,255,0.08)',
    }}>
      {/* Brand */}
      <div style={{
        padding: '14px 0 10px',
        textAlign: 'center',
        borderBottom: '0.5px solid rgba(255,255,255,0.08)',
        marginBottom: 6,
        width: '100%',
      }}>
        <div style={{
          fontSize: 10, fontFamily: "'IBM Plex Mono', monospace",
          fontWeight: 600, letterSpacing: '0.18em',
          color: '#C9A84C', lineHeight: 1,
        }}>METIS</div>
      </div>

      {/* Nav items */}
      {NAV_ITEMS.map(item => {
        const active = isActive(item.path)
        return (
          <NavLink key={item.path} to={item.path} style={{
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            width: '100%', padding: '10px 0', borderRadius: 10, marginBottom: 4,
            textDecoration: 'none',
            background: active ? 'rgba(201,168,76,0.15)' : 'transparent',
            border: active ? '0.5px solid rgba(201,168,76,0.3)' : '0.5px solid transparent',
            transition: 'all 0.15s',
          }}>
            <i className={`ti ${item.icon}`} aria-hidden="true" style={{
              fontSize: 22,
              color: active ? '#C9A84C' : 'rgba(255,255,255,0.50)',
              marginBottom: 3, display: 'block', lineHeight: 1,
            }} />
            <span style={{
              fontSize: 8, fontFamily: "'IBM Plex Mono', monospace",
              letterSpacing: '0.05em',
              color: active ? '#C9A84C' : 'rgba(255,255,255,0.55)',
              textAlign: 'center', fontWeight: active ? 600 : 400,
            }}>
              {lang === 'zh' ? item.labelZh : item.labelEn}
            </span>
          </NavLink>
        )
      })}

      <div style={{ flex: 1 }} />
      <div style={{ width: 32, height: '0.5px', background: 'rgba(255,255,255,0.12)', marginBottom: 12 }} />

      {/* Language toggle */}
      <button
        onClick={() => setLanguage(lang === 'zh' ? 'en' : 'zh')}
        style={{
          width: 58, height: 28, borderRadius: 6, minHeight: 'auto',
          background: 'rgba(255,255,255,0.08)',
          border: '0.5px solid rgba(255,255,255,0.15)',
          color: 'rgba(255,255,255,0.6)',
          fontSize: 9, fontFamily: "'IBM Plex Mono', monospace",
          letterSpacing: '0.05em', cursor: 'pointer', marginBottom: 8,
        }}
      >{lang === 'zh' ? 'EN' : '中文'}</button>

      {/* User icon + dropdown */}
      <div ref={menuRef} style={{ position: 'relative' }}>
        <button
          onClick={() => setUserMenuOpen(prev => !prev)}
          style={{
            width: 36, height: 36, borderRadius: '50%', minHeight: 'auto',
            background: isAdmin ? '#C9A84C' : 'rgba(255,255,255,0.15)',
            border: 'none', cursor: 'pointer', fontSize: 13,
            fontFamily: "'IBM Plex Mono', monospace", fontWeight: 600,
            color: isAdmin ? '#1A3A6C' : 'white',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            marginBottom: 2,
          }}
        >{userInitial}</button>
        <div style={{
          fontSize: 7, color: 'rgba(255,255,255,0.4)',
          fontFamily: "'IBM Plex Mono', monospace",
          textAlign: 'center', marginBottom: 4,
          maxWidth: 60, overflow: 'hidden',
          textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{userName.slice(0, 7)}</div>
        <DropdownPanel
          open={userMenuOpen} userName={userName} isAdmin={isAdmin}
          lang={lang} navigate={navigate} onLogout={onLogout}
          setOpen={setUserMenuOpen}
          posStyle={{ bottom: 48, left: 68 }}
        />
      </div>
    </div>
  )
}
