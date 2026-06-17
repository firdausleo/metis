import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useTranslation } from '../lib/i18n'
import { toBeijingTime } from '../lib/dateUtils'
import { useUser } from '../context/UserContext'

export default function MyBets() {
  const { lang } = useTranslation()
  const { tier } = useUser()
  const isAdmin = tier === 'admin'
  const [bets, setBets] = useState([])
  const [loading, setLoading] = useState(true)
  const [settling, setSettling] = useState(null)
  const [settleModal, setSettleModal] = useState(null)

  useEffect(() => { loadBets() }, [])

  async function loadBets() {
    setLoading(true)
    const { data, error } = await supabase
      .from('user_bets')
      .select('*, matches(home_team,away_team,match_date,home_score,away_score,status)')
      .order('placed_at', { ascending: false })
    if (!error) setBets(data || [])
    setLoading(false)
  }

  const settled = bets.filter(b => b.status !== 'pending')
  const pending  = bets.filter(b => b.status === 'pending')
  const totalStaked    = bets.reduce((s, b) => s + Number(b.stake), 0)
  const settledStaked  = settled.reduce((s, b) => s + Number(b.stake), 0)
  const totalReturned  = settled.reduce((s, b) => s + Number(b.actual_return || 0), 0)
  const pnl = totalReturned - settledStaked
  const roi = settledStaked > 0 ? ((pnl / settledStaked) * 100).toFixed(1) : null
  const wins = settled.filter(b => b.status === 'won' || b.status === 'half_won').length

  // Group bets by match
  const grouped = {}
  bets.forEach(bet => {
    if (!grouped[bet.match_id]) grouped[bet.match_id] = { match: bet.matches, bets: [] }
    grouped[bet.match_id].bets.push(bet)
  })

  async function settleBet(betId, status, actualReturn) {
    setSettling(betId)
    const { error } = await supabase
      .from('user_bets')
      .update({ status, actual_return: parseFloat(actualReturn) || 0, settled_at: new Date().toISOString() })
      .eq('id', betId)
    if (!error) { await loadBets(); setSettleModal(null) }
    setSettling(null)
  }

  if (loading) return <div style={{ padding: 24, textAlign: 'center', color: 'var(--color-text-muted)' }}>Loading…</div>

  return (
    <div style={{ maxWidth: 800, margin: '0 auto', padding: 16 }}>

      {/* Header */}
      <div style={{ background: '#1A3A6C', borderRadius: 'var(--radius-lg)', padding: '14px 18px', marginBottom: 16, color: '#fff' }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>{lang === 'zh' ? '我的投注' : 'My Bets'}</h2>
        <p style={{ fontSize: 11, opacity: 0.7, margin: '4px 0 0' }}>WC2026 · {lang === 'zh' ? '投注记录与盈亏' : 'Bet tracker & P&L'}</p>
      </div>

      {/* Summary cards */}
      {bets.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8, marginBottom: 16 }}>
          {[
            { label: lang === 'zh' ? '总投注' : 'Total staked', value: `¥${totalStaked.toLocaleString()}`, colour: 'var(--color-text-primary)' },
            { label: lang === 'zh' ? '总回报' : 'Returned',     value: `¥${totalReturned.toLocaleString()}`, colour: 'var(--color-text-primary)' },
            { label: lang === 'zh' ? '盈亏' : 'P&L',            value: `${pnl >= 0 ? '+' : ''}¥${pnl.toLocaleString()}`, colour: pnl >= 0 ? 'var(--color-edge-green)' : 'var(--color-edge-red)' },
            { label: 'ROI', value: roi ? `${roi}%` : '—', sub: `${wins}/${settled.length} hit`, colour: roi && parseFloat(roi) >= 0 ? 'var(--color-edge-green)' : 'var(--color-edge-red)' },
          ].map((card, i) => (
            <div key={i} style={{ border: '0.5px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '10px 12px', background: 'var(--color-bg-card)', textAlign: 'center' }}>
              <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 4 }}>{card.label}</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: card.colour, fontFamily: "'IBM Plex Mono', monospace" }}>{card.value}</div>
              {card.sub && <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 2 }}>{card.sub}</div>}
            </div>
          ))}
        </div>
      )}

      {/* Pending risk notice */}
      {pending.length > 0 && (
        <div style={{ padding: '8px 12px', background: 'rgba(201,168,76,0.08)', border: '0.5px solid rgba(201,168,76,0.4)', borderRadius: 'var(--radius-md)', fontSize: 12, color: 'var(--color-edge-amber)', marginBottom: 16 }}>
          {lang === 'zh'
            ? `待结果：${pending.length} 笔 · 风险金额 ¥${pending.reduce((s, b) => s + Number(b.stake), 0).toLocaleString()}`
            : `Pending: ${pending.length} bets · ¥${pending.reduce((s, b) => s + Number(b.stake), 0).toLocaleString()} at risk`}
        </div>
      )}

      {/* Empty state */}
      {bets.length === 0 && (
        <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--color-text-muted)', fontSize: 14 }}>
          {lang === 'zh' ? '暂无投注记录 — 在比赛分析页的投注标签页记录您的投注' : 'No bets yet — record bets from the Bets tab in match analysis'}
        </div>
      )}

      {/* Match groups */}
      {Object.entries(grouped).map(([matchId, group]) => {
        const m = group.match
        if (!m) return null
        const isFinished = m.status === 'finished'
        return (
          <div key={matchId} style={{ border: '0.5px solid var(--color-border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden', marginBottom: 12 }}>
            <div style={{ background: 'var(--color-bg-secondary)', padding: '8px 14px', borderBottom: '0.5px solid var(--color-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-primary)' }}>{m.home_team} vs {m.away_team}</span>
              <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                {isFinished ? `FT ${m.home_score}–${m.away_score}` : toBeijingTime(new Date(m.match_date))}
              </span>
            </div>
            {group.bets.map(bet => {
              const sc = {
                pending:   { label: lang === 'zh' ? '待结果' : 'Pending',   bg: 'rgba(201,168,76,0.12)', colour: 'var(--color-edge-amber)' },
                won:       { label: lang === 'zh' ? '✓ 赢' : '✓ Won',       bg: 'rgba(39,80,10,0.08)',   colour: 'var(--color-edge-green)' },
                lost:      { label: lang === 'zh' ? '✗ 输' : '✗ Lost',      bg: 'rgba(121,31,31,0.08)', colour: 'var(--color-edge-red)' },
                half_won:  { label: lang === 'zh' ? '½ 赢' : '½ Won',       bg: 'rgba(39,80,10,0.08)',   colour: 'var(--color-edge-green)' },
                half_lost: { label: lang === 'zh' ? '½ 输' : '½ Lost',      bg: 'rgba(121,31,31,0.08)', colour: 'var(--color-edge-red)' },
                void:      { label: lang === 'zh' ? '无效' : 'Void',         bg: 'var(--color-bg-secondary)', colour: 'var(--color-text-muted)' },
              }[bet.status] || { label: bet.status, bg: 'var(--color-bg-secondary)', colour: 'var(--color-text-muted)' }
              const pnlAmt = bet.status === 'pending' ? null : Number(bet.actual_return || 0) - Number(bet.stake)
              return (
                <div key={bet.id} style={{ padding: '10px 14px', borderBottom: '0.5px solid var(--color-border)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 99, background: sc.bg, color: sc.colour, flexShrink: 0 }}>{sc.label}</span>
                  <span style={{ flex: 1, fontSize: 12, color: 'var(--color-text-primary)', minWidth: 120 }}>{bet.selection}</span>
                  <span style={{ fontSize: 11, fontFamily: "'IBM Plex Mono', monospace", color: 'var(--color-text-secondary)', flexShrink: 0 }}>@{parseFloat(bet.odds).toFixed(2)}</span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-primary)', flexShrink: 0 }}>¥{Number(bet.stake).toLocaleString()}</span>
                  {pnlAmt !== null && (
                    <span style={{ fontSize: 12, fontWeight: 700, color: pnlAmt >= 0 ? 'var(--color-edge-green)' : 'var(--color-edge-red)', flexShrink: 0 }}>
                      {pnlAmt >= 0 ? '+' : ''}¥{pnlAmt.toFixed(0)}
                    </span>
                  )}
                  {isAdmin && bet.status === 'pending' && (
                    <button onClick={() => setSettleModal(bet)} style={{ fontSize: 11, padding: '3px 10px', borderRadius: 99, border: '0.5px solid var(--color-border)', background: 'transparent', color: 'var(--color-text-secondary)', cursor: 'pointer', flexShrink: 0, minHeight: 28 }}>
                      {lang === 'zh' ? '结算' : 'Settle'}
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )
      })}

      {settleModal && (
        <SettleModal bet={settleModal} lang={lang} onClose={() => setSettleModal(null)} onConfirm={settleBet} settling={!!settling} />
      )}
    </div>
  )
}

function SettleModal({ bet, lang, onClose, onConfirm, settling }) {
  const [status, setStatus] = useState('won')
  const [actualReturn, setActualReturn] = useState(String(Math.round(Number(bet.stake) * Number(bet.odds))))

  const opts = [
    { value: 'won',       label: lang === 'zh' ? '赢' : 'Won' },
    { value: 'lost',      label: lang === 'zh' ? '输' : 'Lost' },
    { value: 'half_won',  label: lang === 'zh' ? '半赢' : 'Half won' },
    { value: 'half_lost', label: lang === 'zh' ? '半输' : 'Half lost' },
    { value: 'void',      label: lang === 'zh' ? '无效' : 'Void' },
  ]

  function handleStatus(v) {
    setStatus(v)
    const s = Number(bet.stake), o = Number(bet.odds)
    if (v === 'won')       setActualReturn(String(Math.round(s * o)))
    else if (v === 'lost' || v === 'void') setActualReturn('0')
    else if (v === 'half_won')  setActualReturn(String(Math.round(s + (s * o - s) / 2)))
    else if (v === 'half_lost') setActualReturn(String(Math.round(s / 2)))
  }

  const pnlAmt = (parseFloat(actualReturn) || 0) - Number(bet.stake)

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
      <div style={{ background: 'var(--color-bg)', borderRadius: 'var(--radius-lg)', padding: 20, width: '100%', maxWidth: 360 }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>{lang === 'zh' ? '结算投注' : 'Settle bet'}</h3>
        <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 16 }}>
          {bet.selection} @{parseFloat(bet.odds).toFixed(2)} · ¥{bet.stake}
        </p>

        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 11, color: 'var(--color-text-muted)', display: 'block', marginBottom: 6 }}>{lang === 'zh' ? '结果' : 'Result'}</label>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {opts.map(opt => (
              <button key={opt.value} onClick={() => handleStatus(opt.value)} style={{ padding: '5px 12px', borderRadius: 99, border: '0.5px solid', fontSize: 12, cursor: 'pointer', minHeight: 32, borderColor: status === opt.value ? '#1A3A6C' : 'var(--color-border)', background: status === opt.value ? '#1A3A6C' : 'transparent', color: status === opt.value ? '#fff' : 'var(--color-text-secondary)' }}>
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={{ fontSize: 11, color: 'var(--color-text-muted)', display: 'block', marginBottom: 6 }}>{lang === 'zh' ? '实际回报 ¥' : 'Actual return ¥'}</label>
          <input type="number" inputMode="decimal" value={actualReturn} onChange={e => setActualReturn(e.target.value)}
            style={{ width: '100%', fontSize: 16, padding: '8px 12px', border: '0.5px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-bg-secondary)', minHeight: 44, color: 'var(--color-text-primary)', boxSizing: 'border-box' }}
          />
          <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4 }}>
            {lang === 'zh' ? '盈亏：' : 'P&L: '}
            <span style={{ fontWeight: 700, color: pnlAmt >= 0 ? 'var(--color-edge-green)' : 'var(--color-edge-red)' }}>
              {pnlAmt >= 0 ? '+' : ''}¥{pnlAmt.toFixed(0)}
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onClose} style={{ flex: 1, padding: 10, border: '0.5px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'transparent', fontSize: 13, cursor: 'pointer', color: 'var(--color-text-secondary)', minHeight: 44 }}>
            {lang === 'zh' ? '取消' : 'Cancel'}
          </button>
          <button onClick={() => onConfirm(bet.id, status, actualReturn)} disabled={settling} style={{ flex: 2, padding: 10, background: '#1A3A6C', color: '#fff', border: 'none', borderRadius: 'var(--radius-md)', fontSize: 13, fontWeight: 600, cursor: settling ? 'not-allowed' : 'pointer', minHeight: 44, opacity: settling ? 0.6 : 1 }}>
            {settling ? (lang === 'zh' ? '结算中…' : 'Settling…') : (lang === 'zh' ? '确认结算' : 'Confirm settle')}
          </button>
        </div>
      </div>
    </div>
  )
}
