import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useTranslation } from '../lib/i18n'
import { supabase } from '../lib/supabase'
import { fetchMyBets, portfolioStats } from '../lib/bets'
import { isToday } from '../lib/dateUtils'
import MatchCard from '../components/MatchCard'

export default function Dashboard() {
  const { user } = useAuth()
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [matches, setMatches] = useState([])
  const [bets, setBets] = useState([])
  const [accuracy, setAccuracy] = useState([])

  useEffect(() => {
    supabase.from('matches').select('*').order('match_date', { ascending: true }).then(({ data }) => setMatches(data || []))
    fetchMyBets().then(setBets).catch(() => setBets([]))
    supabase.from('role_accuracy').select('accuracy_score').then(({ data }) => setAccuracy(data || []))
  }, [])

  const today = matches.filter(m => isToday(m.match_date))
  const pending = bets.filter(b => b.status === 'pending').length
  const pnl = portfolioStats(bets).pnl
  const recent = matches.filter(m => m.status === 'finished' && m.home_score != null)
    .sort((a, b) => new Date(b.match_date) - new Date(a.match_date)).slice(0, 5)

  const hits = accuracy.filter(r => Number(r.accuracy_score) >= 1).length
  const hitRate = accuracy.length ? Math.round((hits / accuracy.length) * 100) : null

  const cards = [
    { label: t('dashboard.matchesToday'), value: today.length, colour: today.length > 0 ? 'var(--color-accent)' : 'var(--color-text-primary)' },
    { label: t('dashboard.activeBets'), value: pending, colour: 'var(--color-text-primary)' },
    { label: t('dashboard.totalPnl'), value: `${pnl >= 0 ? '+' : ''}¥${pnl.toFixed(0)}`, colour: pnl >= 0 ? 'var(--color-edge-green)' : 'var(--color-edge-red)' },
    { label: t('dashboard.hitRate'), value: hitRate == null ? '—' : `${hitRate}%`, colour: 'var(--color-accent)' },
  ]

  const secLabel = {
    fontSize: 13, fontWeight: 700, color: 'var(--color-text-muted)',
    letterSpacing: '0.06em', marginBottom: 10,
  }

  return (
    <div style={{ padding: '24px 16px', maxWidth: 720, margin: '0 auto' }}>
      <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: 4 }}>{t('dashboard.welcome')}</h1>
      {user && <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 24 }}>{user.email}</p>}

      {/* ── Stat cards ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 12, marginBottom: 28 }}>
        {cards.map(c => (
          <div key={c.label} style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '20px 12px' }}>
            <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{c.label}</p>
            <p style={{ fontSize: 28, fontFamily: 'var(--font-display)', fontWeight: 600, color: c.colour }}>{c.value}</p>
          </div>
        ))}
      </div>

      {/* ── Today's matches ── */}
      {today.length > 0 && (
        <div style={{ marginBottom: 28 }}>
          <p style={secLabel}>{t('dashboard.matchesToday').toUpperCase()}</p>
          {today.map(m => (
            <MatchCard
              key={m.id}
              match={m}
              onAnalyze={id => navigate(`/matches/${id}`)}
            />
          ))}
        </div>
      )}

      {/* ── Recent results ── */}
      {recent.length > 0 && (
        <div>
          <p style={secLabel}>{t('dashboard.recent').toUpperCase()}</p>
          {recent.map(m => (
            <MatchCard
              key={m.id}
              match={m}
              onAnalyze={id => navigate(`/matches/${id}`)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
