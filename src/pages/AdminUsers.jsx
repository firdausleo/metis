import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useUser } from '../context/UserContext'
import { useTranslation } from '../lib/i18n'
import { supabase } from '../lib/supabase'

const DEFAULT_CREDITS = { standard: 20, power: 50, ultra: 9999, admin: 9999 }
const TIERS = ['standard', 'power', 'ultra']
const TIER_LABELS = { admin: 'Admin', ultra: 'Ultra', power: 'Power', standard: 'Standard' }
const TIER_COLORS = {
  admin:    { bg: 'rgba(201,168,76,0.15)',  color: 'var(--color-accent)' },
  ultra:    { bg: 'rgba(128,0,200,0.12)',   color: '#8B00C8' },
  power:    { bg: 'var(--color-blue-dim)',  color: 'var(--color-blue)' },
  standard: { bg: 'var(--color-bg-secondary)', color: 'var(--color-text-secondary)' },
}

function TierBadge({ tier }) {
  const c = TIER_COLORS[tier] || TIER_COLORS.standard
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px',
      borderRadius: 'var(--radius-sm)', fontSize: 12, fontWeight: 700,
      background: c.bg, color: c.color,
    }}>
      {TIER_LABELS[tier] || tier}
    </span>
  )
}

function fmtDate(ts) {
  if (!ts) return '—'
  return new Date(ts).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

function codeStatus(code) {
  if (code.revoked) return { label: 'Revoked', color: 'var(--color-danger)' }
  if (code.used_by) return { label: 'Used', color: 'var(--color-text-muted)' }
  if (new Date(code.expires_at) < new Date()) return { label: 'Expired', color: 'var(--color-warning)' }
  return { label: 'Active', color: 'var(--color-success)' }
}

async function adminPost(action, body = {}) {
  const { data: { session } } = await supabase.auth.getSession()
  const res = await fetch('/api/admin-users', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${session?.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ action, ...body }),
  })
  return res.json()
}

export default function AdminUsers() {
  const { tier } = useUser()
  const navigate = useNavigate()
  const { t } = useTranslation()

  const [users, setUsers] = useState([])
  const [codes, setCodes] = useState([])
  const [loading, setLoading] = useState(true)
  const [codeFilter, setCodeFilter] = useState('all')

  // Per-row state
  const [approveTier, setApproveTier] = useState({})
  const [changeTierSel, setChangeTierSel] = useState({})
  const [pendingAction, setPendingAction] = useState({})
  const [newCodeTier, setNewCodeTier] = useState('standard')
  const [generatedCode, setGeneratedCode] = useState(null)
  const [copied, setCopied] = useState(false)
  const [showGenForm, setShowGenForm] = useState(false)

  const loadData = useCallback(async () => {
    const [usersRes, codesRes] = await Promise.all([
      adminPost('list_users'),
      adminPost('list_invites'),
    ])
    if (usersRes.ok) setUsers(usersRes.users || [])
    if (codesRes.ok) setCodes(codesRes.codes || [])
    setLoading(false)
  }, [])

  useEffect(() => {
    if (tier !== 'admin') { navigate('/'); return }
    loadData()
  }, [tier, navigate, loadData])

  async function doAction(key, fn) {
    setPendingAction(p => ({ ...p, [key]: true }))
    await fn()
    await loadData()
    setPendingAction(p => ({ ...p, [key]: false }))
  }

  async function handleApprove(userId) {
    const selectedTier = approveTier[userId] || 'standard'
    await doAction(`approve-${userId}`, () => adminPost('approve_user', { userId, tier: selectedTier }))
  }

  async function handleReject(userId) {
    if (!window.confirm('Reject this user?')) return
    await doAction(`reject-${userId}`, () => adminPost('reject_user', { userId }))
  }

  async function handleChangeTier(userId) {
    const newTier = changeTierSel[userId]
    if (!newTier) return
    await doAction(`tier-${userId}`, () => adminPost('change_tier', { userId, newTier }))
    setChangeTierSel(p => ({ ...p, [userId]: '' }))
  }

  async function handleResetCredits(userId) {
    await doAction(`credits-${userId}`, () => adminPost('reset_credits', { userId }))
  }

  async function handleSuspend(userId) {
    if (!window.confirm('Suspend this user?')) return
    await doAction(`suspend-${userId}`, () => adminPost('reject_user', { userId }))
  }

  async function handleGenerateCode() {
    const res = await adminPost('generate_invite', { tier: newCodeTier })
    if (res.ok) {
      setGeneratedCode(res.code)
      await loadData()
    }
  }

  async function handleRevoke(codeId) {
    if (!window.confirm('Revoke this invite code?')) return
    await doAction(`revoke-${codeId}`, () => adminPost('revoke_invite', { codeId }))
  }

  function handleCopy(code) {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const pending = users.filter(u => u.status === 'pending')
  const active  = users.filter(u => u.status !== 'pending')

  const filteredCodes = codes.filter(c => {
    if (codeFilter === 'unused')  return !c.used_by && !c.revoked && new Date(c.expires_at) >= new Date()
    if (codeFilter === 'used')    return !!c.used_by
    if (codeFilter === 'expired') return !c.revoked && new Date(c.expires_at) < new Date()
    return true
  })

  const cardStyle = {
    background: 'var(--color-bg-card)',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-lg)',
    padding: '24px',
    marginBottom: 24,
  }

  const thStyle = {
    textAlign: 'left', padding: '8px 12px',
    fontSize: 12, fontWeight: 700,
    color: 'var(--color-text-muted)',
    borderBottom: '1px solid var(--color-border)',
    whiteSpace: 'nowrap',
  }

  const tdStyle = {
    padding: '10px 12px', fontSize: 14,
    color: 'var(--color-text-primary)',
    borderBottom: '1px solid var(--color-border-light)',
    verticalAlign: 'middle',
  }

  const btnSm = (color = 'var(--color-accent)') => ({
    padding: '4px 10px', fontSize: 12, fontWeight: 600,
    border: `1px solid ${color}`, borderRadius: 'var(--radius-sm)',
    background: 'transparent', color, cursor: 'pointer',
    fontFamily: 'var(--font-ui)',
  })

  const selectStyle = {
    padding: '4px 8px', fontSize: 12,
    background: 'var(--color-bg-secondary)',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-sm)',
    color: 'var(--color-text-primary)',
    fontFamily: 'var(--font-ui)',
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
        <span style={{ color: 'var(--color-text-secondary)' }}>{t('common.loading')}</span>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '24px 16px' }}>
      <h1 style={{
        fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 800,
        color: 'var(--color-text-primary)', marginBottom: 24,
      }}>
        {t('admin.title')}
      </h1>

      {/* ── SECTION A: Pending Approvals ──────────────────────── */}
      <div style={{
        ...cardStyle,
        borderColor: pending.length > 0 ? 'var(--color-accent-border)' : 'var(--color-border)',
        background: pending.length > 0 ? 'rgba(201,168,76,0.04)' : 'var(--color-bg-card)',
      }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16, color: 'var(--color-text-primary)', display: 'flex', alignItems: 'center', gap: 8 }}>
          {t('admin.pending')}
          {pending.length > 0 && (
            <span style={{ background: 'var(--color-accent)', color: '#000', fontSize: 11, fontWeight: 800, padding: '2px 7px', borderRadius: 10 }}>
              {pending.length}
            </span>
          )}
        </h2>

        {pending.length === 0 ? (
          <p style={{ color: 'var(--color-text-muted)', fontSize: 14 }}>{t('admin.noPending')}</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={thStyle}>Email</th>
                  <th style={thStyle}>Registered</th>
                  <th style={thStyle}>Invite code used</th>
                  <th style={thStyle}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {pending.map(u => (
                  <tr key={u.id}>
                    <td style={tdStyle}>{u.email}</td>
                    <td style={tdStyle}>{fmtDate(u.created_at)}</td>
                    <td style={tdStyle}>
                      {u.invite_code_used
                        ? <code style={{ background: 'var(--color-bg-secondary)', padding: '2px 6px', borderRadius: 4, fontSize: 12 }}>{u.invite_code_used}</code>
                        : <span style={{ color: 'var(--color-text-muted)' }}>—</span>}
                    </td>
                    <td style={tdStyle}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                        <select
                          value={approveTier[u.id] || 'standard'}
                          onChange={e => setApproveTier(p => ({ ...p, [u.id]: e.target.value }))}
                          style={selectStyle}
                        >
                          {TIERS.map(t => (
                            <option key={t} value={t}>{TIER_LABELS[t]}</option>
                          ))}
                        </select>
                        <button
                          onClick={() => handleApprove(u.id)}
                          disabled={!!pendingAction[`approve-${u.id}`]}
                          style={btnSm('var(--color-success)')}
                        >
                          {pendingAction[`approve-${u.id}`] ? '...' : t('admin.approve')}
                        </button>
                        <button
                          onClick={() => handleReject(u.id)}
                          disabled={!!pendingAction[`reject-${u.id}`]}
                          style={btnSm('var(--color-danger)')}
                        >
                          {pendingAction[`reject-${u.id}`] ? '...' : t('admin.reject')}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── SECTION B: Active Users ────────────────────────────── */}
      <div style={cardStyle}>
        <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16, color: 'var(--color-text-primary)' }}>
          {t('admin.activeUsers')}
        </h2>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={thStyle}>Email</th>
                <th style={thStyle}>Tier</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>Credits</th>
                <th style={thStyle}>Joined</th>
                <th style={thStyle}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {active.map(u => {
                const maxCredits = DEFAULT_CREDITS[u.tier] ?? 20
                const creditsDisplay = (u.tier === 'admin' || u.tier === 'ultra')
                  ? '∞'
                  : `${u.credits_remaining} / ${maxCredits}`
                return (
                  <tr key={u.id}>
                    <td style={tdStyle}>{u.email}</td>
                    <td style={tdStyle}><TierBadge tier={u.tier} /></td>
                    <td style={tdStyle}>
                      <span style={{
                        fontSize: 12, fontWeight: 600,
                        color: u.status === 'approved' ? 'var(--color-success)' : 'var(--color-danger)',
                      }}>
                        {u.status}
                      </span>
                    </td>
                    <td style={tdStyle}>
                      <span style={{
                        fontSize: 13,
                        color: u.credits_remaining < 5 && u.tier !== 'admin' && u.tier !== 'ultra'
                          ? 'var(--color-danger)' : 'var(--color-text-primary)',
                      }}>
                        {creditsDisplay}
                      </span>
                    </td>
                    <td style={tdStyle}>{fmtDate(u.created_at)}</td>
                    <td style={tdStyle}>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                        <select
                          value={changeTierSel[u.id] || ''}
                          onChange={e => setChangeTierSel(p => ({ ...p, [u.id]: e.target.value }))}
                          style={selectStyle}
                        >
                          <option value="">{t('admin.changeTier')}</option>
                          {['standard','power','ultra'].map(tr => (
                            <option key={tr} value={tr}>{TIER_LABELS[tr]}</option>
                          ))}
                        </select>
                        {changeTierSel[u.id] && (
                          <button
                            onClick={() => handleChangeTier(u.id)}
                            disabled={!!pendingAction[`tier-${u.id}`]}
                            style={btnSm('var(--color-blue)')}
                          >
                            {pendingAction[`tier-${u.id}`] ? '...' : t('admin.confirm')}
                          </button>
                        )}
                        <button
                          onClick={() => handleResetCredits(u.id)}
                          disabled={!!pendingAction[`credits-${u.id}`]}
                          style={btnSm('var(--color-text-muted)')}
                        >
                          {pendingAction[`credits-${u.id}`] ? '...' : t('admin.resetCredits')}
                        </button>
                        {u.tier !== 'admin' && (
                          <button
                            onClick={() => handleSuspend(u.id)}
                            disabled={!!pendingAction[`suspend-${u.id}`]}
                            style={btnSm('var(--color-danger)')}
                          >
                            {pendingAction[`suspend-${u.id}`] ? '...' : t('admin.suspend')}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── SECTION C: Invite Codes ────────────────────────────── */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--color-text-primary)', margin: 0 }}>
            {t('admin.inviteCodes')}
          </h2>
          <button
            onClick={() => { setShowGenForm(f => !f); setGeneratedCode(null) }}
            style={{
              padding: '7px 14px', fontSize: 13, fontWeight: 600,
              background: 'var(--color-accent)', color: '#000',
              border: 'none', borderRadius: 'var(--radius-sm)',
              cursor: 'pointer', fontFamily: 'var(--font-ui)',
            }}
          >
            + {t('admin.generateCode')}
          </button>
        </div>

        {/* Generate form */}
        {showGenForm && (
          <div style={{
            background: 'var(--color-bg-secondary)', borderRadius: 'var(--radius-md)',
            padding: '16px', marginBottom: 20,
            display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap',
          }}>
            <select
              value={newCodeTier}
              onChange={e => setNewCodeTier(e.target.value)}
              style={{ ...selectStyle, fontSize: 14 }}
            >
              {TIERS.map(tr => (
                <option key={tr} value={tr}>{TIER_LABELS[tr]}</option>
              ))}
            </select>
            <button
              onClick={handleGenerateCode}
              style={{
                padding: '6px 14px', fontSize: 13, fontWeight: 600,
                background: 'var(--color-blue)', color: '#fff',
                border: 'none', borderRadius: 'var(--radius-sm)',
                cursor: 'pointer', fontFamily: 'var(--font-ui)',
              }}
            >
              {t('admin.generateCode')}
            </button>
            {generatedCode && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <code style={{
                  background: 'var(--color-bg-card)', border: '1px solid var(--color-accent-border)',
                  padding: '6px 12px', borderRadius: 'var(--radius-sm)',
                  fontSize: 15, fontWeight: 700, color: 'var(--color-accent)',
                  letterSpacing: '0.08em',
                }}>
                  {generatedCode}
                </code>
                <button onClick={() => handleCopy(generatedCode)} style={btnSm('var(--color-accent)')}>
                  {copied ? t('admin.copied') : t('admin.copyCode')}
                </button>
              </div>
            )}
          </div>
        )}

        {/* Filter tabs */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 16 }}>
          {['all','unused','used','expired'].map(f => (
            <button
              key={f}
              onClick={() => setCodeFilter(f)}
              style={{
                padding: '5px 12px', fontSize: 12, fontWeight: 600,
                border: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                fontFamily: 'var(--font-ui)',
                background: codeFilter === f ? 'var(--color-accent)' : 'var(--color-bg-secondary)',
                color: codeFilter === f ? '#000' : 'var(--color-text-secondary)',
              }}
            >
              {t(`admin.codeFilter.${f}`)}
            </button>
          ))}
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={thStyle}>Code</th>
                <th style={thStyle}>Tier</th>
                <th style={thStyle}>Created</th>
                <th style={thStyle}>Expires</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}></th>
              </tr>
            </thead>
            <tbody>
              {filteredCodes.map(c => {
                const status = codeStatus(c)
                return (
                  <tr key={c.id}>
                    <td style={tdStyle}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <code style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-accent)', letterSpacing: '0.05em' }}>
                          {c.code}
                        </code>
                        <button onClick={() => handleCopy(c.code)} style={{ ...btnSm('var(--color-text-muted)'), padding: '2px 6px' }}>
                          📋
                        </button>
                      </div>
                    </td>
                    <td style={tdStyle}><TierBadge tier={c.tier} /></td>
                    <td style={tdStyle}>{fmtDate(c.created_at)}</td>
                    <td style={tdStyle}>{fmtDate(c.expires_at)}</td>
                    <td style={tdStyle}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: status.color }}>{status.label}</span>
                    </td>
                    <td style={tdStyle}>
                      {!c.revoked && !c.used_by && (
                        <button
                          onClick={() => handleRevoke(c.id)}
                          disabled={!!pendingAction[`revoke-${c.id}`]}
                          style={btnSm('var(--color-danger)')}
                        >
                          {pendingAction[`revoke-${c.id}`] ? '...' : t('admin.revokeCode')}
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
              {filteredCodes.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ ...tdStyle, textAlign: 'center', color: 'var(--color-text-muted)', padding: '24px' }}>
                    No codes found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
