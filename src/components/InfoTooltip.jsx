import { useState, useRef, useEffect } from 'react'

export default function InfoTooltip({ title, explanation, explanationZh, lang = 'en' }) {
  const [open, setOpen] = useState(false)
  const [flipLeft, setFlipLeft] = useState(false)
  const iconRef = useRef(null)
  const popupRef = useRef(null)

  function handleClick(e) {
    e.stopPropagation()
    if (!open && iconRef.current) {
      const rect = iconRef.current.getBoundingClientRect()
      setFlipLeft(rect.left > window.innerWidth / 2)
    }
    setOpen(v => !v)
  }

  useEffect(() => {
    if (!open) return
    function handleOutside(e) {
      if (
        popupRef.current && !popupRef.current.contains(e.target) &&
        iconRef.current && !iconRef.current.contains(e.target)
      ) {
        setOpen(false)
      }
    }
    document.addEventListener('click', handleOutside)
    return () => document.removeEventListener('click', handleOutside)
  }, [open])

  const text = lang === 'zh' && explanationZh ? explanationZh : explanation

  return (
    <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', verticalAlign: 'middle', marginLeft: 3 }}>
      <button
        ref={iconRef}
        onClick={handleClick}
        aria-label="More info"
        style={{
          background: 'none', border: 'none', padding: 0, cursor: 'pointer',
          color: 'var(--color-text-muted)', lineHeight: 1,
          display: 'inline-flex', alignItems: 'center', minHeight: 0,
        }}
      >
        <i className="ti ti-info-circle" style={{ fontSize: 13, textTransform: 'none' }} />
      </button>
      {open && (
        <div
          ref={popupRef}
          style={{
            position: 'absolute',
            top: '100%',
            ...(flipLeft ? { right: 0 } : { left: 0 }),
            marginTop: 4,
            width: 240,
            background: 'var(--color-bg-card)',
            border: '0.5px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            padding: '10px 12px',
            zIndex: 999,
            boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
            textTransform: 'none',
            letterSpacing: 'normal',
            fontWeight: 400,
          }}
        >
          {title && (
            <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text-primary)', marginBottom: 4, margin: '0 0 4px' }}>
              {title}
            </p>
          )}
          <p style={{ fontSize: 12, color: 'var(--color-text-muted)', lineHeight: 1.5, margin: 0 }}>
            {text}
          </p>
        </div>
      )}
    </span>
  )
}
