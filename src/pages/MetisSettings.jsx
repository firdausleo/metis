import { useState } from 'react'
import { getMetisSettings, saveMetisSettings, METIS_DEFAULTS } from '../utils/metisSettings'
import { useUser } from '../context/UserContext'

export default function MetisSettings() {
  const { tier } = useUser()
  const isAdmin = tier === 'admin'
  const [settings, setSettings] = useState(getMetisSettings)
  const [saved, setSaved] = useState(false)

  if (!isAdmin) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 'calc(100vh - 56px)',
        background: '#080c14',
        color: 'rgba(201,168,76,0.6)',
        fontFamily: "'IBM Plex Mono', monospace",
        fontSize: 13,
        letterSpacing: '0.08em',
      }}>
        ACCESS DENIED — ADMIN ONLY
      </div>
    )
  }

  function update(key, value) {
    setSettings(prev => ({ ...prev, [key]: value }))
  }

  function handleSave() {
    saveMetisSettings(settings)
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  function handleReset() {
    setSettings({ ...METIS_DEFAULTS })
  }

  function Slider({ label, desc, settingKey, min, max, step = 0.01, format }) {
    const val = settings[settingKey]
    const display = format ? format(val) : val
    return (
      <div style={{ marginBottom: 20 }}>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          marginBottom: 6,
        }}>
          <span style={{
            fontSize: 12, fontWeight: 500,
            color: '#e8eaf0',
            fontFamily: "'Space Grotesk', sans-serif",
          }}>{label}</span>
          <span style={{
            fontSize: 12,
            fontFamily: "'IBM Plex Mono', monospace",
            color: '#C9A84C',
            fontWeight: 600,
          }}>{display}</span>
        </div>
        <input
          type="range"
          min={min} max={max} step={step}
          value={val}
          onChange={e => update(settingKey, parseFloat(e.target.value))}
          style={{ width: '100%', accentColor: '#C9A84C', height: 4 }}
        />
        {desc && (
          <div style={{
            fontSize: 10, marginTop: 4,
            color: 'rgba(201,168,76,0.35)',
            fontFamily: "'IBM Plex Mono', monospace",
            letterSpacing: '0.03em',
          }}>{desc}</div>
        )}
      </div>
    )
  }

  function Toggle({ label, desc, settingKey }) {
    const val = settings[settingKey]
    return (
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 16,
        gap: 16,
      }}>
        <div>
          <div style={{
            fontSize: 12, fontWeight: 500,
            color: '#e8eaf0',
            fontFamily: "'Space Grotesk', sans-serif",
          }}>{label}</div>
          {desc && (
            <div style={{
              fontSize: 10, marginTop: 2,
              color: 'rgba(201,168,76,0.35)',
              fontFamily: "'IBM Plex Mono', monospace",
            }}>{desc}</div>
          )}
        </div>
        <button
          onClick={() => update(settingKey, !val)}
          style={{
            width: 44, height: 24,
            borderRadius: 12,
            background: val ? '#C9A84C' : 'rgba(255,255,255,0.1)',
            border: 'none',
            cursor: 'pointer',
            position: 'relative',
            flexShrink: 0,
            transition: 'background 0.2s',
          }}
        >
          <div style={{
            position: 'absolute',
            top: 2,
            left: val ? 22 : 2,
            width: 20, height: 20,
            borderRadius: '50%',
            background: val ? '#080c14' : '#666',
            transition: 'left 0.2s',
          }} />
        </button>
      </div>
    )
  }

  function RadioGroup({ label, settingKey, options }) {
    return (
      <div style={{ marginBottom: 20 }}>
        <div style={{
          fontSize: 12, fontWeight: 500,
          color: '#e8eaf0', marginBottom: 8,
          fontFamily: "'Space Grotesk', sans-serif",
        }}>{label}</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {options.map(opt => (
            <button
              key={opt.value}
              onClick={() => update(settingKey, opt.value)}
              style={{
                padding: '5px 12px',
                borderRadius: 6,
                border: '0.5px solid',
                fontSize: 11,
                fontFamily: "'IBM Plex Mono', monospace",
                letterSpacing: '0.05em',
                cursor: 'pointer',
                transition: 'all 0.15s',
                borderColor: settings[settingKey] === opt.value
                  ? '#C9A84C' : 'rgba(201,168,76,0.2)',
                background: settings[settingKey] === opt.value
                  ? 'rgba(201,168,76,0.15)' : 'transparent',
                color: settings[settingKey] === opt.value
                  ? '#C9A84C' : 'rgba(232,234,240,0.5)',
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
    )
  }

  function Section({ icon, title, children }) {
    return (
      <div style={{
        background: '#0d1420',
        border: '0.5px solid rgba(201,168,76,0.15)',
        borderRadius: 12,
        overflow: 'hidden',
        marginBottom: 16,
      }}>
        <div style={{
          padding: '10px 16px',
          borderBottom: '0.5px solid rgba(201,168,76,0.12)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          background: '#080c14',
        }}>
          <span style={{ fontSize: 14 }}>{icon}</span>
          <span style={{
            fontSize: 10,
            fontFamily: "'IBM Plex Mono', monospace",
            fontWeight: 500,
            letterSpacing: '0.1em',
            color: '#C9A84C',
            textTransform: 'uppercase',
          }}>{title}</span>
        </div>
        <div style={{ padding: 16 }}>
          {children}
        </div>
      </div>
    )
  }

  return (
    <div style={{
      background: '#080c14',
      minHeight: 'calc(100vh - 56px)',
      padding: '20px 16px 40px',
      color: '#e8eaf0',
    }}>
      <div style={{ maxWidth: 600, margin: '0 auto' }}>

        {/* Header */}
        <div style={{ marginBottom: 24 }}>
          <div style={{
            fontSize: 11,
            fontFamily: "'IBM Plex Mono', monospace",
            letterSpacing: '0.2em',
            color: '#C9A84C',
            marginBottom: 4,
          }}>⚡ METIS</div>
          <div style={{
            fontSize: 20,
            fontFamily: "'IBM Plex Mono', monospace",
            fontWeight: 600,
            letterSpacing: '0.08em',
            color: '#e8eaf0',
          }}>SETTINGS</div>
          <div style={{
            fontSize: 11,
            color: 'rgba(201,168,76,0.4)',
            fontFamily: "'IBM Plex Mono', monospace",
            marginTop: 4,
          }}>
            ADMIN ONLY · CHANGES APPLY IMMEDIATELY
          </div>
        </div>

        {/* Section 1 — Model & Algorithm */}
        <Section icon="🧠" title="Model & Algorithm">
          <Slider
            label="DC Weight in V3"
            settingKey="dcWeight"
            min={0.50} max={0.80} step={0.01}
            format={v => `${(v * 100).toFixed(0)}% DC + ${((1 - v) * 100).toFixed(0)}% M7`}
            desc="Higher = more historical ratings, less recent form"
          />
          <Slider
            label="Kelly Fraction"
            settingKey="kellyFraction"
            min={0.10} max={0.40} step={0.01}
            format={v => `${(v * 100).toFixed(0)}%`}
            desc="Stake = edge/(odds-1) × bankroll × this fraction"
          />
          <Slider
            label="Minimum Edge to Recommend"
            settingKey="minEdge"
            min={0.02} max={0.10} step={0.005}
            format={v => `${(v * 100).toFixed(1)}%`}
            desc="Bets below this edge% are excluded from portfolio"
          />
          <Slider
            label="Max Stake Per Bet"
            settingKey="maxStakePct"
            min={0.01} max={0.10} step={0.005}
            format={v => `${(v * 100).toFixed(0)}% of bankroll`}
            desc="MT24 hard cap — recommended 5%, never exceed 10%"
          />
          <Slider
            label="Minimum Probability Threshold"
            settingKey="minProb"
            min={0.01} max={0.05} step={0.005}
            format={v => `${(v * 100).toFixed(1)}%`}
            desc="Bets below this model probability excluded from portfolio"
          />
          <Slider
            label="Temperature T"
            settingKey="temperature"
            min={0.80} max={1.50} step={0.01}
            format={v => v.toFixed(2)}
            desc="Calibrates DC probability distribution sharpness"
          />
        </Section>

        {/* Section 2 — METIS Personality */}
        <Section icon="💬" title="METIS Personality">
          <RadioGroup
            label="Response Tone"
            settingKey="tone"
            options={[
              { value: 'analyst', label: 'ANALYST' },
              { value: 'casual', label: 'CASUAL' },
              { value: 'dataonly', label: 'DATA ONLY' },
            ]}
          />
          <RadioGroup
            label="Default Language"
            settingKey="defaultLang"
            options={[
              { value: 'auto', label: 'AUTO' },
              { value: 'en', label: 'EN' },
              { value: 'zh', label: '中文' },
            ]}
          />
          <RadioGroup
            label="Response Length"
            settingKey="responseLength"
            options={[
              { value: 'concise', label: 'CONCISE' },
              { value: 'detailed', label: 'DETAILED' },
            ]}
          />
          <Toggle
            label="Show Disclaimer"
            settingKey="showDisclaimer"
            desc="Statistical models · Bet responsibly footer"
          />
        </Section>

        {/* Section 3 — Context Window */}
        <Section icon="📊" title="Context Window">
          <Toggle
            label="Include Betting History"
            settingKey="includeBetHistory"
            desc="METIS sees your recent bets in every response"
          />
          <Toggle
            label="Include P&L in Context"
            settingKey="includePnl"
            desc="METIS knows your current profit/loss position"
          />
          <Slider
            label="Matches in Context"
            settingKey="matchesInContext"
            min={5} max={20} step={1}
            format={v => `${v} matches`}
            desc="How many upcoming fixtures METIS knows about"
          />
        </Section>

        {/* Section 4 — Risk Guardrails */}
        <Section icon="⚠" title="Risk Guardrails">
          <Slider
            label="Flag High Stake Warning"
            settingKey="flagStakePct"
            min={0.10} max={0.30} step={0.01}
            format={v => `>${(v * 100).toFixed(0)}% bankroll`}
            desc="METIS warns when total session stake exceeds this"
          />
          <Toggle
            label="Show Risk Warnings"
            settingKey="showRiskWarnings"
            desc="Display ⚠ when bets conflict with model direction"
          />

          {/* MT24 hard cap — not configurable */}
          <div style={{
            padding: '10px 12px',
            background: 'rgba(248,113,113,0.08)',
            border: '0.5px solid rgba(248,113,113,0.25)',
            borderRadius: 8,
            marginTop: 8,
          }}>
            <div style={{
              fontSize: 10,
              fontFamily: "'IBM Plex Mono', monospace",
              letterSpacing: '0.06em',
              color: '#f87171',
              fontWeight: 500,
              marginBottom: 3,
            }}>
              MT24 · 5% BANKROLL CAP · ENFORCED
            </div>
            <div style={{
              fontSize: 10,
              color: 'rgba(248,113,113,0.6)',
              fontFamily: "'IBM Plex Mono', monospace",
            }}>
              Hard limit on single bet stake. Cannot be disabled. Protects bankroll integrity.
            </div>
          </div>
        </Section>

        {/* Save / Reset buttons */}
        <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
          <button
            onClick={handleReset}
            style={{
              flex: 1, padding: 12,
              background: 'transparent',
              border: '0.5px solid rgba(201,168,76,0.3)',
              borderRadius: 8,
              fontSize: 11,
              fontFamily: "'IBM Plex Mono', monospace",
              fontWeight: 500,
              letterSpacing: '0.08em',
              color: 'rgba(201,168,76,0.5)',
              cursor: 'pointer',
            }}
          >
            RESET DEFAULTS
          </button>
          <button
            onClick={handleSave}
            style={{
              flex: 2, padding: 12,
              background: saved ? 'rgba(74,222,128,0.15)' : '#C9A84C',
              border: saved ? '0.5px solid #4ade80' : 'none',
              borderRadius: 8,
              fontSize: 11,
              fontFamily: "'IBM Plex Mono', monospace",
              fontWeight: 600,
              letterSpacing: '0.08em',
              color: saved ? '#4ade80' : '#080c14',
              cursor: 'pointer',
              transition: 'all 0.2s',
            }}
          >
            {saved ? '✓ SAVED' : 'SAVE SETTINGS'}
          </button>
        </div>

        {/* Version info */}
        <div style={{
          textAlign: 'center',
          marginTop: 24,
          fontSize: 9,
          fontFamily: "'IBM Plex Mono', monospace",
          color: 'rgba(201,168,76,0.2)',
          letterSpacing: '0.06em',
        }}>
          METIS · WC2026 · SETTINGS v1.0
        </div>
      </div>
    </div>
  )
}
