import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

const ADMIN_UUID = '4a6e1f29-e18b-4fd3-9a7e-cec54501db54'

function toBJ(ts) {
  if (!ts) return '—'
  return new Date(ts).toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: 'numeric', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

function fmtDuration(secs) {
  if (!secs) return '—'
  if (secs < 60) return `${secs}s`
  if (secs < 3600) return `${Math.round(secs / 60)}m`
  return `${Math.floor(secs / 3600)}h ${Math.round((secs % 3600) / 60)}m`
}

const CAT_COLOR = {
  navigation: '#1A3A6C',
  match:      '#C9A84C',
  ai:         '#2D7A4F',
  betting:    '#BA7517',
  tools:      '#888780',
}

const TD = {
  fontSize: 11, padding: '8px 0',
  borderBottom: '0.5px solid var(--color-border-light)',
  fontFamily: "'IBM Plex Mono', monospace",
  color: 'var(--color-text-secondary)',
  verticalAlign: 'middle',
}

const TH = {
  fontSize: 9, fontWeight: 500,
  letterSpacing: '0.06em', textTransform: 'uppercase',
  fontFamily: "'IBM Plex Mono', monospace",
  color: 'var(--color-text-muted)',
  padding: '0 0 8px 0', textAlign: 'left',
}

export default function AdminActivity() {
  const navigate = useNavigate()
  const [sessions,  setSessions]  = useState([])
  const [activity,  setActivity]  = useState([])
  const [selUser,   setSelUser]   = useState(null)
  const [loading,   setLoading]   = useState(true)
  const [tab,       setTab]       = useState('sessions')
  const [authed,    setAuthed]    = useState(false)

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data?.user?.id !== ADMIN_UUID) {
        navigate('/')
        return
      }
      setAuthed(true)
      load()
    })
  }, [])

  async function load() {
    setLoading(true)
    const [s, a] = await Promise.all([
      supabase.from('user_sessions')
        .select('*')
        .order('started_at', { ascending: false })
        .limit(300),
      supabase.from('user_activity_log')
        .select('*')
        .order('ts', { ascending: false })
        .limit(500),
    ])
    setSessions(s.data || [])
    setActivity(a.data || [])
    setLoading(false)
  }

  if (!authed) return null

  const userStats = Object.values(
    sessions.reduce((acc, s) => {
      const uid = s.user_id
      if (!acc[uid]) acc[uid] = {
        user_id: uid, sessions: 0,
        total_duration: 0, total_actions: 0,
        last_seen: null,
      }
      acc[uid].sessions++
      acc[uid].total_duration += s.duration_secs || 0
      acc[uid].total_actions  += s.action_count  || 0
      if (!acc[uid].last_seen || s.started_at > acc[uid].last_seen)
        acc[uid].last_seen = s.started_at
      return acc
    }, {})
  ).sort((a, b) => (b.last_seen || '') > (a.last_seen || '') ? 1 : -1)

  const shownSessions = selUser ? sessions.filter(s => s.user_id === selUser) : sessions
  const shownActivity = selUser ? activity.filter(a => a.user_id === selUser) : activity

  const panel = {
    background: 'var(--color-bg-card)',
    border: '0.5px solid var(--color-border)',
    borderRadius: 'var(--radius-lg)',
    overflow: 'hidden',
  }

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '16px 16px 48px' }}>

      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'baseline',
        justifyContent: 'space-between', marginBottom: 20,
      }}>
        <div>
          <div style={{
            fontSize: 13, fontWeight: 500,
            letterSpacing: '0.12em', textTransform: 'uppercase',
            fontFamily: "'IBM Plex Mono', monospace",
            color: 'var(--color-text-primary)',
          }}>
            Admin · User Activity
          </div>
          <div style={{
            fontSize: 10, marginTop: 4,
            fontFamily: "'IBM Plex Mono', monospace",
            color: 'var(--color-text-muted)',
          }}>
            {userStats.length} users · {sessions.length} sessions · {activity.length} events
            {selUser && (
              <button onClick={() => setSelUser(null)} style={{
                marginLeft: 10,
                background: 'rgba(201,168,76,0.15)',
                border: 'none', borderRadius: 4,
                padding: '1px 8px', cursor: 'pointer',
                fontSize: 10,
                fontFamily: "'IBM Plex Mono', monospace",
                color: '#C9A84C',
              }}>
                {selUser.slice(0, 8)}… ✕
              </button>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={load} style={{
            background: 'none',
            border: '0.5px solid var(--color-border)',
            borderRadius: 6, padding: '4px 12px',
            cursor: 'pointer', fontSize: 11,
            fontFamily: "'IBM Plex Mono', monospace",
            color: 'var(--color-text-muted)',
          }}>↻ Refresh</button>
          <button onClick={() => navigate('/dashboard')} style={{
            background: 'none', border: 'none',
            cursor: 'pointer', fontSize: 11,
            fontFamily: "'IBM Plex Mono', monospace",
            color: 'var(--color-text-muted)', padding: 0,
          }}>← Dashboard</button>
        </div>
      </div>

      {/* User cards */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))',
        gap: 8, marginBottom: 16,
      }}>
        {loading ? (
          <div style={{
            fontSize: 12, color: 'var(--color-text-muted)',
            fontStyle: 'italic', padding: '8px 0',
          }}>
            Loading...
          </div>
        ) : userStats.length === 0 ? (
          <div style={{
            fontSize: 12, color: 'var(--color-text-muted)',
            fontStyle: 'italic', padding: '8px 0',
            gridColumn: '1 / -1',
          }}>
            No sessions yet — users must log in after deployment.
          </div>
        ) : userStats.map(u => (
          <div
            key={u.user_id}
            onClick={() => setSelUser(selUser === u.user_id ? null : u.user_id)}
            style={{
              ...panel, cursor: 'pointer', padding: '12px 14px',
              outline: selUser === u.user_id ? '2px solid #C9A84C' : 'none',
            }}
          >
            <div style={{
              fontSize: 10, fontFamily: "'IBM Plex Mono', monospace",
              color: 'var(--color-text-muted)', marginBottom: 8,
            }}>
              {u.user_id.slice(0, 8)}…
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {[
                { l: 'Sessions',   v: u.sessions },
                { l: 'Total time', v: fmtDuration(u.total_duration) },
                { l: 'Actions',    v: u.total_actions },
                { l: 'Last seen',  v: toBJ(u.last_seen) },
              ].map((s, i) => (
                <div key={i}>
                  <div style={{
                    fontSize: 9, letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                    fontFamily: "'IBM Plex Mono', monospace",
                    color: 'var(--color-text-muted)',
                  }}>{s.l}</div>
                  <div style={{
                    fontSize: 12, fontWeight: 500,
                    fontFamily: "'IBM Plex Mono', monospace",
                    color: 'var(--color-text-primary)',
                    marginTop: 2,
                  }}>{s.v}</div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div style={{
        display: 'flex', gap: 0, marginBottom: 10,
        borderBottom: '0.5px solid var(--color-border)',
      }}>
        {[
          { key: 'sessions', label: 'Sessions' },
          { key: 'activity', label: 'Activity feed' },
        ].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} style={{
            background: 'none', border: 'none',
            cursor: 'pointer', padding: '8px 16px',
            fontFamily: 'inherit', minHeight: 44,
            fontSize: 13, fontWeight: tab === t.key ? 500 : 400,
            color: tab === t.key ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
            borderBottom: tab === t.key ? '2px solid #1A3A6C' : '2px solid transparent',
            marginBottom: -1,
          }}>{t.label}</button>
        ))}
      </div>

      {/* Sessions table */}
      {tab === 'sessions' && (
        <div style={panel}>
          <div style={{
            padding: '9px 14px',
            borderBottom: '0.5px solid var(--color-border)',
            display: 'flex', justifyContent: 'space-between',
            fontSize: 9, fontWeight: 500,
            letterSpacing: '0.10em', textTransform: 'uppercase',
            fontFamily: "'IBM Plex Mono', monospace",
            color: 'var(--color-text-muted)',
          }}>
            <span>Session log</span>
            <span>{shownSessions.length} sessions</span>
          </div>
          <div style={{ padding: '0 14px', overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
              <thead>
                <tr>
                  {['User','Started (BJ)','Last seen','Duration','Pages','Actions','Device','Status'].map(h => (
                    <th key={h} style={TH}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shownSessions.slice(0, 50).map(s => (
                  <tr
                    key={s.id}
                    onClick={() => setSelUser(s.user_id)}
                    style={{ cursor: 'pointer' }}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--color-bg-secondary)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    <td style={TD}>{s.user_id.slice(0, 8)}…</td>
                    <td style={TD}>{toBJ(s.started_at)}</td>
                    <td style={TD}>{toBJ(s.last_seen_at)}</td>
                    <td style={{ ...TD, fontWeight: 500, color: 'var(--color-text-primary)' }}>
                      {fmtDuration(s.duration_secs)}
                    </td>
                    <td style={TD}>{s.page_count  || 0}</td>
                    <td style={TD}>{s.action_count || 0}</td>
                    <td style={{ ...TD, fontSize: 10 }}>{s.device_type || '—'}</td>
                    <td style={TD}>
                      {s.ended_at ? (
                        <span style={{ color: 'var(--color-text-muted)' }}>ended</span>
                      ) : (
                        <span style={{
                          fontSize: 9, padding: '1px 6px',
                          borderRadius: 3, fontWeight: 500,
                          background: 'rgba(45,122,79,0.12)',
                          color: '#2D7A4F',
                        }}>active</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Activity feed */}
      {tab === 'activity' && (
        <div style={panel}>
          <div style={{
            padding: '9px 14px',
            borderBottom: '0.5px solid var(--color-border)',
            display: 'flex', justifyContent: 'space-between',
            fontSize: 9, fontWeight: 500,
            letterSpacing: '0.10em', textTransform: 'uppercase',
            fontFamily: "'IBM Plex Mono', monospace",
            color: 'var(--color-text-muted)',
          }}>
            <span>Activity feed</span>
            <span>{shownActivity.length} events</span>
          </div>
          <div style={{ padding: '0 14px', overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 560 }}>
              <thead>
                <tr>
                  {['Time (BJ)','User','Category','Action','Detail','Page'].map(h => (
                    <th key={h} style={TH}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shownActivity.slice(0, 100).map(a => (
                  <tr key={a.id}>
                    <td style={{ ...TD, whiteSpace: 'nowrap', fontSize: 10 }}>{toBJ(a.ts)}</td>
                    <td style={{ ...TD, fontSize: 10 }}>{a.user_id.slice(0, 8)}…</td>
                    <td style={TD}>
                      <span style={{
                        fontSize: 9, padding: '1px 6px', borderRadius: 3,
                        fontWeight: 500,
                        background: `${CAT_COLOR[a.category] || '#888'}22`,
                        color: CAT_COLOR[a.category] || '#888',
                      }}>
                        {a.category}
                      </span>
                    </td>
                    <td style={{ ...TD, fontWeight: 500, color: 'var(--color-text-primary)' }}>
                      {a.action}
                    </td>
                    <td style={{
                      ...TD, fontSize: 10,
                      color: 'var(--color-text-muted)',
                      maxWidth: 180, overflow: 'hidden',
                      textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {a.detail ? JSON.stringify(a.detail) : '—'}
                    </td>
                    <td style={{ ...TD, fontSize: 10 }}>{a.page || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
