import { useState, useEffect } from 'react'
import { fetchMyBets, calcPnl, portfolioStats } from '../lib/bets'
import { toBeijingTime } from '../lib/dateUtils'

const STATUS_COLOUR = {
  pending: 'var(--color-text-muted)',
  won:     'var(--color-edge-green)',
  lost:    'var(--color-edge-red)',
  void:    'var(--color-text-muted)',
}

export default function MyBets() {
  const [bets, setBets] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(null)

  useEffect(() => {
    fetchMyBets().then(setBets).catch(e => setErr(e.message)).finally(() => setLoading(false))
  }, [])

  const s = portfolioStats(bets)
  const pnlPositive = s.pnl >= 0

  if (loading) return <div style={{ padding: 24, color: 'var(--color-text-muted)' }}>Loading…</div>
  if (err) return <div style={{ padding: 24, color: 'var(--color-danger)' }}>{err}</div>

  return (
    <div className="app-content" style={{ maxWidth: 720, margin: '0 auto', padding: 16 }}>
      <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 28, marginBottom: 16 }}>My Bets</h1>

      {/* P&L summary */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8, marginBottom: 20 }}>
        {[
          { label: 'P&L', value: `${pnlPositive ? '+' : ''}¥${s.pnl.toFixed(0)}`, colour: pnlPositive ? 'var(--color-edge-green)' : 'var(--color-edge-red)' },
          { label: 'ROI', value: `${s.roi >= 0 ? '+' : ''}${s.roi.toFixed(1)}%`, colour: s.roi >= 0 ? 'var(--color-edge-green)' : 'var(--color-edge-red)' },
          { label: 'Win rate', value: `${s.winRate.toFixed(0)}%`, colour: 'var(--color-text-primary)' },
          { label: 'Bets', value: `${s.settled}/${s.total}`, colour: 'var(--color-text-primary)' },
        ].map(c => (
          <div key={c.label} style={{ background: 'var(--color-bg-card)', border: '0.5px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '12px 8px', textAlign: 'center' }}>
            <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 4 }}>{c.label}</p>
            <p style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 700, color: c.colour }}>{c.value}</p>
          </div>
        ))}
      </div>

      {bets.length === 0 ? (
        <p style={{ color: 'var(--color-text-muted)', textAlign: 'center', padding: 24 }}>No bets yet. Place one from a match's Value tab.</p>
      ) : bets.map(b => {
        const pnl = b.pnl != null ? Number(b.pnl) : calcPnl(b)
        return (
          <div key={b.id} style={{ background: 'var(--color-bg-card)', border: '0.5px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '12px 14px', marginBottom: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ fontSize: 15, fontWeight: 600 }}>{b.match ? `${b.match.home_team} v ${b.match.away_team}` : 'Match'}</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: STATUS_COLOUR[b.status], textTransform: 'uppercase' }}>{b.status}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, color: 'var(--color-text-secondary)' }}>
              <span>{b.bet_type} · {b.selection} @ {Number(b.odds).toFixed(2)} · ¥{Number(b.stake).toFixed(0)}</span>
              {b.status !== 'pending' && <span style={{ color: pnl >= 0 ? 'var(--color-edge-green)' : 'var(--color-edge-red)' }}>{pnl >= 0 ? '+' : ''}¥{pnl.toFixed(0)}</span>}
            </div>
            {b.match?.match_date && <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 4 }}>{toBeijingTime(b.match.match_date, 'full')}</p>}
          </div>
        )
      })}
    </div>
  )
}
