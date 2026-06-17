import { useState, useEffect, useRef, useCallback } from 'react'

const INACTIVITY_MS = 30 * 60 * 1000
const PIN = '2026'
const LOCK_KEY = 'metis_screen_locked'

export default function ScreenLock({ userId, children }) {
  const [locked, setLocked]     = useState(false)
  const [pin, setPin]           = useState('')
  const [shake, setShake]       = useState(false)
  const [attempts, setAttempts] = useState(0)
  const timerRef = useRef(null)
  const inputRef = useRef(null)

  const lock = useCallback(() => {
    setLocked(true)
    setPin('')
    sessionStorage.setItem(LOCK_KEY, '1')
  }, [])

  const resetTimer = useCallback(() => {
    clearTimeout(timerRef.current)
    if (!locked) {
      timerRef.current = setTimeout(lock, INACTIVITY_MS)
    }
  }, [locked, lock])

  useEffect(() => {
    if (!userId) return
    if (sessionStorage.getItem(LOCK_KEY) === '1') setLocked(true)
    const events = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart']
    events.forEach(e => window.addEventListener(e, resetTimer, { passive: true }))
    resetTimer()
    return () => {
      events.forEach(e => window.removeEventListener(e, resetTimer))
      clearTimeout(timerRef.current)
    }
  }, [userId, resetTimer])

  useEffect(() => {
    if (locked && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }, [locked])

  if (!userId) return children

  function handlePinInput(val) {
    const next = (pin + val).slice(0, 4)
    setPin(next)
    if (next.length === 4) {
      if (next === PIN) {
        setLocked(false)
        setPin('')
        setAttempts(0)
        sessionStorage.removeItem(LOCK_KEY)
        resetTimer()
      } else {
        setAttempts(a => a + 1)
        setShake(true)
        setTimeout(() => { setShake(false); setPin('') }, 600)
      }
    }
  }

  function handleKeyDown(e) {
    if (e.key >= '0' && e.key <= '9') handlePinInput(e.key)
    if (e.key === 'Backspace') setPin(p => p.slice(0, -1))
  }

  if (!locked) return children

  return (
    <div
      onKeyDown={handleKeyDown}
      tabIndex={-1}
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'var(--color-bg)',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        outline: 'none',
      }}
    >
      {/* Blurred overlay */}
      <div style={{
        position: 'absolute', inset: 0,
        background: 'var(--color-bg)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        opacity: 0.95,
      }} />

      {/* Lock card */}
      <div style={{
        position: 'relative', zIndex: 1,
        background: 'var(--color-bg-card)',
        border: '0.5px solid var(--color-border)',
        borderRadius: 'var(--radius-lg)',
        padding: '40px 48px',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', gap: 24,
        maxWidth: 320, width: '100%',
      }}>

        {/* Lock icon */}
        <div style={{
          width: 48, height: 48, borderRadius: '50%',
          background: 'var(--color-bg-secondary)',
          border: '0.5px solid var(--color-border)',
          display: 'flex', alignItems: 'center',
          justifyContent: 'center',
        }}>
          <i className="ti ti-lock" style={{
            fontSize: 22,
            color: 'var(--color-text-muted)',
          }} />
        </div>

        {/* Title */}
        <div style={{ textAlign: 'center' }}>
          <div style={{
            fontSize: 15, fontWeight: 500,
            color: 'var(--color-text-primary)',
            marginBottom: 4,
          }}>
            Metis is locked
          </div>
          <div style={{
            fontSize: 12,
            color: 'var(--color-text-muted)',
            fontFamily: "'IBM Plex Mono', monospace",
          }}>
            Enter PIN to continue
          </div>
        </div>

        {/* PIN dots */}
        <div style={{
          display: 'flex', gap: 14,
          animation: shake ? 'shake 0.5s ease' : 'none',
        }}>
          {[0,1,2,3].map(i => (
            <div key={i} style={{
              width: 14, height: 14,
              borderRadius: '50%',
              background: i < pin.length
                ? (shake ? '#791F1F' : '#1A3A6C')
                : 'var(--color-bg-secondary)',
              border: `0.5px solid ${
                i < pin.length
                  ? (shake ? '#791F1F' : '#1A3A6C')
                  : 'var(--color-border-light)'
              }`,
              transition: 'background 0.15s, border-color 0.15s',
            }} />
          ))}
        </div>

        {/* Wrong PIN message */}
        {attempts > 0 && pin.length === 0 && !shake && (
          <div style={{
            fontSize: 11,
            fontFamily: "'IBM Plex Mono', monospace",
            color: '#791F1F',
            marginTop: -12,
          }}>
            Incorrect PIN · {attempts} {attempts === 1 ? 'attempt' : 'attempts'}
          </div>
        )}

        {/* Numpad */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 8, width: '100%',
        }}>
          {[1,2,3,4,5,6,7,8,9,'',0,'⌫'].map((k, i) => (
            <button
              key={i}
              ref={k === 1 ? inputRef : undefined}
              onClick={() => {
                if (k === '⌫') setPin(p => p.slice(0, -1))
                else if (k !== '') handlePinInput(String(k))
              }}
              disabled={k === ''}
              style={{
                height: 52, borderRadius: 'var(--radius-md)',
                border: '0.5px solid var(--color-border)',
                background: k === '' ? 'transparent' : 'var(--color-bg-secondary)',
                cursor: k === '' ? 'default' : 'pointer',
                fontSize: k === '⌫' ? 18 : 20,
                fontWeight: 500,
                fontFamily: "'IBM Plex Mono', monospace",
                color: 'var(--color-text-primary)',
                visibility: k === '' ? 'hidden' : 'visible',
                transition: 'background 0.1s',
              }}
              onMouseEnter={e => {
                if (k !== '') e.currentTarget.style.background = 'var(--color-bg-hover)'
              }}
              onMouseLeave={e => {
                if (k !== '') e.currentTarget.style.background = 'var(--color-bg-secondary)'
              }}
            >
              {k}
            </button>
          ))}
        </div>

        {/* Inactivity note */}
        <div style={{
          fontSize: 10,
          fontFamily: "'IBM Plex Mono', monospace",
          color: 'var(--color-text-muted)',
          textAlign: 'center', marginTop: -8,
        }}>
          Locked after 30 min inactivity
        </div>
      </div>

      <style>{`
        @keyframes shake {
          0%,100%{transform:translateX(0)}
          20%{transform:translateX(-8px)}
          40%{transform:translateX(8px)}
          60%{transform:translateX(-6px)}
          80%{transform:translateX(6px)}
        }
      `}</style>
    </div>
  )
}
