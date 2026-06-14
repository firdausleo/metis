import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { supabase } from '../lib/supabase'
import { fetchMyBets, calcPnl } from '../lib/bets'
import { isToday, toBeijingTime } from '../lib/dateUtils'
import { getFlag } from '../lib/teamFlags'
import { runModels, getVenueAdvantage } from '../lib/poisson'
import { analyse1X2 } from '../lib/evEngine'

// ── Constants ─────────────────────────────────────────────────────────────

const GROUPS = ['A','B','C','D','E','F','G','H','I','J','K','L']

const SH = {
  fontSize: 11, fontWeight: 700, letterSpacing: '0.08em',
  color: 'var(--color-accent)', textTransform: 'uppercase',
  borderBottom: '1px solid var(--color-accent)',
  paddingBottom: 6, marginBottom: 12, display: 'block',
}

const TH = {
  fontSize: 11, fontWeight: 700, letterSpacing: '0.05em',
  color: 'var(--color-text-muted)', padding: '0 10px 8px 0',
  textAlign: 'left', whiteSpace: 'nowrap',
}

const TD = {
  fontSize: 14, padding: '8px 10px 8px 0',
  borderBottom: '1px solid var(--color-border-light)',
  color: 'var(--color-text-secondary)', whiteSpace: 'nowrap',
}

const GOLD_LINK = {
  background: 'none', border: 'none', cursor: 'pointer',
  color: 'var(--color-accent)', fontSize: 12, fontWeight: 600,
  padding: '4px 0', display: 'inline-block', fontFamily: 'inherit',
}

const GOLD_BTN = {
  background: 'none', border: '1px solid var(--color-accent)',
  borderRadius: 6, cursor: 'pointer', color: 'var(--color-accent)',
  fontSize: 13, fontWeight: 600, padding: '7px 16px', fontFamily: 'inherit',
}

// ── Pure helpers ───────────────────────────────────────────────────────────

function getWcDay() {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' })
  const todayStr = fmt.format(new Date())
  const [ty, tm, td] = todayStr.split('-').map(Number)
  const todayMs = Date.UTC(ty, tm - 1, td)
  const startMs = Date.UTC(2026, 5, 11) // June 11 2026
  return Math.max(1, Math.floor((todayMs - startMs) / 86400000) + 1)
}

function getGreeting() {
  const h = parseInt(
    new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', hour: 'numeric', hour12: false }).format(new Date()),
    10
  )
  if (h >= 5 && h < 12) return 'Good morning'
  if (h >= 12 && h < 18) return 'Good afternoon'
  return 'Good evening'
}

function getBeijingDateLabel() {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai', weekday: 'long', month: 'long', day: 'numeric',
  }).format(new Date())
}

function calcStandings(matches) {
  const allTeams = [...new Set(matches.flatMap(m => [m.home_team, m.away_team]))].filter(n => n !== 'TBD')
  const table = {}
  for (const t of allTeams) table[t] = { mp: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 }
  for (const m of matches) {
    if (m.status !== 'finished' || m.home_score == null || m.away_score == null) continue
    const h = m.home_score, a = m.away_score
    const ht = table[m.home_team], at = table[m.away_team]
    if (!ht || !at) continue
    ht.mp++; ht.gf += h; ht.ga += a
    if (h > a)      { ht.w++; ht.pts += 3 }
    else if (h === a){ ht.d++; ht.pts += 1 }
    else              ht.l++
    at.mp++; at.gf += a; at.ga += h
    if (a > h)      { at.w++; at.pts += 3 }
    else if (a === h){ at.d++; at.pts += 1 }
    else              at.l++
  }
  return Object.entries(table)
    .map(([team, s]) => ({ team, ...s, gd: s.gf - s.ga }))
    .sort((a, b) => b.pts - a.pts || (b.gd - a.gd) || (b.gf - a.gf))
}

// ── Sub-components ─────────────────────────────────────────────────────────

function SkeletonRow({ height = 36 }) {
  return <div className="skeleton" style={{ height, borderRadius: 4, marginBottom: 8 }} />
}

function StatusBadge({ match }) {
  if (match.status === 'live') {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--color-success)', fontSize: 11, fontWeight: 600, flexShrink: 0 }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--color-success)', display: 'inline-block' }} />
        LIVE
      </span>
    )
  }
  if (match.status === 'finished' && match.home_score != null) {
    return (
      <span style={{ fontSize: 11, color: 'var(--color-text-muted)', fontWeight: 500, flexShrink: 0 }}>
        FT {match.home_score}–{match.away_score}
      </span>
    )
  }
  return <span style={{ fontSize: 11, color: 'var(--color-text-muted)', flexShrink: 0 }}>Upcoming</span>
}

function MatchRow({ match, onAnalyze }) {
  const stageLabel = match.stage === 'group'
    ? `Grp ${match.group_name}`
    : (match.stage || '').toUpperCase()
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 0', borderBottom: '1px solid var(--color-border-light)' }}>
      <span style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--color-text-muted)', minWidth: 36, flexShrink: 0 }}>
        {toBeijingTime(match.match_date, 'time')}
      </span>
      <span style={{ fontSize: 10, color: 'var(--color-text-muted)', background: 'var(--color-accent-dim)', borderRadius: 4, padding: '2px 5px', flexShrink: 0 }}>
        {stageLabel}
      </span>
      <span style={{ flex: 1, fontSize: 14, fontWeight: 600, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {getFlag(match.home_team)} {match.home_team}{' '}
        <span style={{ color: 'var(--color-text-muted)', fontWeight: 400 }}>vs</span>{' '}
        {getFlag(match.away_team)} {match.away_team}
      </span>
      <StatusBadge match={match} />
      <button onClick={() => onAnalyze(match.id)} style={GOLD_LINK}>Analyze →</button>
    </div>
  )
}

function BetRow({ bet }) {
  const match = bet.match
  const matchName = match ? `${match.home_team} vs ${match.away_team}` : '—'
  const potReturn = (Number(bet.stake) * Number(bet.odds)).toFixed(0)
  const selLabel = bet.selection === 'home'
    ? (match?.home_team || 'Home')
    : bet.selection === 'away'
    ? (match?.away_team || 'Away')
    : 'Draw'
  return (
    <tr>
      <td style={TD}>{matchName}</td>
      <td style={{ ...TD, textTransform: 'capitalize' }}>{selLabel}</td>
      <td style={{ ...TD, fontFamily: 'monospace' }}>{Number(bet.odds).toFixed(2)}</td>
      <td style={{ ...TD, fontFamily: 'monospace' }}>¥{Number(bet.stake).toFixed(0)}</td>
      <td style={{ ...TD, fontFamily: 'monospace' }}>¥{potReturn}</td>
      <td style={{ ...TD, color: 'var(--color-text-muted)', textTransform: 'capitalize' }}>{bet.status}</td>
    </tr>
  )
}

function ValuePickRow({ pick, onAnalyze }) {
  const star = pick.edgePct >= 10 ? '★' : '✦'
  const starColor = pick.edgePct >= 10 ? 'var(--color-accent)' : '#D4860A'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 0', borderBottom: '1px solid var(--color-border-light)' }}>
      <span style={{ color: starColor, fontSize: 14, flexShrink: 0 }}>{star}</span>
      <span style={{ flex: 1, fontSize: 13, fontWeight: 600, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {pick.home} vs {pick.away}
        <span style={{ fontWeight: 400, color: 'var(--color-text-muted)' }}> · {pick.label}</span>
      </span>
      <span style={{ color: 'var(--color-success)', fontWeight: 600, fontSize: 12, flexShrink: 0 }}>
        +{pick.edgePct.toFixed(1)}%
      </span>
      <span style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--color-text-muted)', flexShrink: 0 }}>
        {Number(pick.odds).toFixed(2)}
      </span>
      <button onClick={() => onAnalyze(pick.matchId)} style={GOLD_LINK}>Analyze →</button>
    </div>
  )
}

function GroupSnapshot({ groupName, rows }) {
  return (
    <div style={{ marginBottom: 12, paddingBottom: 10, borderBottom: '1px solid var(--color-border-light)' }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--color-accent)', letterSpacing: '0.08em', marginBottom: 5 }}>
        GROUP {groupName}
      </div>
      {rows.slice(0, 4).map((r, i) => (
        <div key={r.team} style={{
          display: 'flex', alignItems: 'center', gap: 5, fontSize: 11,
          padding: '2px 0',
          color: i < 2 ? 'var(--color-success)' : 'var(--color-text-muted)',
          fontWeight: i < 2 ? 600 : 400,
        }}>
          <span style={{ flexShrink: 0 }}>{getFlag(r.team)}</span>
          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {r.team}
          </span>
          <span style={{ fontFamily: 'monospace', fontSize: 10, flexShrink: 0 }}>{r.pts}pts</span>
        </div>
      ))}
    </div>
  )
}

function StatPill({ label, value, valueColor, small }) {
  return (
    <div style={{
      flex: 1, background: 'var(--color-bg-card)',
      border: '1px solid var(--color-border)', borderRadius: 8,
      padding: small ? '10px 14px' : '12px 24px',
    }}>
      <span style={{
        fontSize: 10, fontWeight: 700, letterSpacing: '0.06em',
        color: 'var(--color-text-muted)', textTransform: 'uppercase',
        display: 'block', marginBottom: small ? 3 : 5,
      }}>
        {label}
      </span>
      <span style={{
        fontSize: small ? 18 : 22, fontWeight: 700,
        color: valueColor || 'var(--color-text-primary)', display: 'block',
      }}>
        {value}
      </span>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────

export default function Dashboard() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [wide, setWide] = useState(() => window.innerWidth >= 1024)

  const [loading, setLoading] = useState(true)
  const [todayMatches, setTodayMatches] = useState([])
  const [pendingBets, setPendingBets] = useState([])
  const [settledStats, setSettledStats] = useState({ pnl: 0, staked: 0, roi: 0 })
  const [accuracy, setAccuracy] = useState([])
  const [valuePicks, setValuePicks] = useState(null)
  const [noOddsMatches, setNoOddsMatches] = useState([])
  const [groupStandings, setGroupStandings] = useState({})
  const [standingsOpen, setStandingsOpen] = useState(false)

  useEffect(() => {
    const handler = () => setWide(window.innerWidth >= 1024)
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [])

  useEffect(() => {
    async function load() {
      const [matchesRes, betsArr, accuracyRes, oddsRes] = await Promise.all([
        supabase.from('matches').select('*').order('match_date', { ascending: true }),
        fetchMyBets().catch(() => []),
        supabase.from('role_accuracy').select('*'),
        supabase
          .from('matches')
          .select('*')
          .neq('status', 'finished')
          .not('odds_home', 'is', null)
          .not('odds_draw', 'is', null)
          .not('odds_away', 'is', null)
          .order('match_date', { ascending: true }),
      ])

      const allM = matchesRes.data || []
      setTodayMatches(allM.filter(m => isToday(m.match_date)))

      const byGroup = {}
      for (const m of allM) {
        if (m.stage !== 'group' || !m.group_name) continue
        if (!byGroup[m.group_name]) byGroup[m.group_name] = []
        byGroup[m.group_name].push(m)
      }
      const standings = {}
      for (const [g, gM] of Object.entries(byGroup)) standings[g] = calcStandings(gM)
      setGroupStandings(standings)

      const settled = betsArr.filter(b => b.status === 'won' || b.status === 'lost')
      const staked = settled.reduce((s, b) => s + Number(b.stake), 0)
      const pnl = settled.reduce((s, b) => s + (b.pnl != null ? Number(b.pnl) : calcPnl(b)), 0)
      setPendingBets(betsArr.filter(b => b.status === 'pending'))
      setSettledStats({ pnl, staked, roi: staked ? (pnl / staked) * 100 : 0 })

      setAccuracy(accuracyRes.data || [])

      const oddsMatches = oddsRes.data || []
      setNoOddsMatches(
        allM.filter(m => m.status !== 'finished' && !m.odds_home && m.home_team !== 'TBD' && m.away_team !== 'TBD').slice(0, 8)
      )

      if (oddsMatches.length) {
        const ids = oddsMatches.map(m => m.id)
        const { data: statsData } = await supabase.from('team_stats').select('*').in('match_id', ids)
        const idx = {}
        for (const s of (statsData || [])) idx[`${s.match_id}:${s.team_code}`] = s

        const picks = []
        for (const m of oddsMatches) {
          const hs = idx[`${m.id}:${m.home_team_code}`]
          const aws = idx[`${m.id}:${m.away_team_code}`]
          if (!hs || !aws) continue
          let model
          try { model = runModels(hs, aws, { venue: m.venue, city: m.city, homeTeam: m.home_team }) } catch { continue }
          const ev = analyse1X2(model.v2.probs, { home: m.odds_home, draw: m.odds_draw, away: m.odds_away })
          if (!ev?.outcomes) continue
          for (const key of ['home', 'draw', 'away']) {
            const oc = ev.outcomes[key]
            if (!oc?.ev?.recommend) continue
            picks.push({
              matchId: m.id,
              home: m.home_team, away: m.away_team,
              label: key === 'home' ? `${m.home_team} Win` : key === 'away' ? `${m.away_team} Win` : 'Draw',
              edgePct: oc.ev.edgePct,
              odds: oc.odds,
            })
          }
        }
        picks.sort((a, b) => b.edgePct - a.edgePct)
        setValuePicks(picks.slice(0, 5))
      } else {
        setValuePicks([])
      }

      setLoading(false)
    }
    load().catch(console.error)
  }, [])

  // Computed
  const hits = accuracy.filter(r => Number(r.accuracy_score) >= 1).length
  const hitRate = accuracy.length ? Math.round((hits / accuracy.length) * 100) : null
  const total = accuracy.length
  const wrong = total - hits

  const byRole = {}
  for (const r of accuracy) {
    if (!r.role_name) continue
    if (!byRole[r.role_name]) byRole[r.role_name] = { correct: 0, total: 0 }
    byRole[r.role_name].total++
    if (Number(r.accuracy_score) >= 1) byRole[r.role_name].correct++
  }
  const roleEntries = Object.entries(byRole).map(([name, s]) => ({ name, rate: s.total ? s.correct / s.total : 0 }))
  const bestRole = roleEntries.length ? roleEntries.reduce((a, b) => b.rate > a.rate ? b : a) : null
  const worstRole = roleEntries.length ? roleEntries.reduce((a, b) => b.rate < a.rate ? b : a) : null

  const greeting = getGreeting()
  const dateLabel = getBeijingDateLabel()
  const wcDay = getWcDay()
  const pnlColor = settledStats.pnl >= 0 ? 'var(--color-success)' : 'var(--color-danger)'
  const pnlLabel = `${settledStats.pnl >= 0 ? '+' : ''}¥${settledStats.pnl.toFixed(0)}`

  const onAnalyze = id => navigate(`/matches/${id}`)

  // ── MOBILE ──────────────────────────────────────────────────────────────

  if (!wide) {
    return (
      <div style={{ padding: '16px', maxWidth: 640, margin: '0 auto' }}>
        <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 16 }}>
          {greeting}, Leo · WC2026 Day {wcDay}
        </p>

        {/* 2×2 pills */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 20 }}>
          <StatPill small label="🏟 Matches Today" value={String(todayMatches.length)} />
          <StatPill small label="🎯 Active Bets" value={String(pendingBets.length)} />
          <StatPill small label="💰 Total P&L" value={pnlLabel} valueColor={pnlColor} />
          <StatPill small label="📊 Hit Rate" value={hitRate == null ? '—' : `${hitRate}%`} valueColor="var(--color-accent)" />
        </div>

        {/* Today's matches */}
        <div style={{ marginBottom: 20 }}>
          <span style={SH}>Today's Matches</span>
          {loading
            ? [1,2,3].map(i => <SkeletonRow key={i} />)
            : todayMatches.length === 0
            ? <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>No matches today</p>
            : todayMatches.slice(0, 5).map(m => <MatchRow key={m.id} match={m} onAnalyze={onAnalyze} />)
          }
          {!loading && todayMatches.length > 5 && (
            <button onClick={() => navigate('/matches')} style={{ ...GOLD_LINK, marginTop: 8 }}>View all →</button>
          )}
        </div>

        {/* Active bets summary */}
        <div style={{ marginBottom: 20 }}>
          <span style={SH}>Active Bets</span>
          <div style={{ background: 'var(--color-bg-card)', border: '1px solid var(--color-border)', borderRadius: 8, padding: '12px 14px' }}>
            {pendingBets.length === 0
              ? <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 8 }}>No active bets</p>
              : <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 8 }}>
                  {pendingBets.length} active · Staked ¥{pendingBets.reduce((s, b) => s + Number(b.stake), 0).toFixed(0)} · P&L{' '}
                  <span style={{ color: pnlColor, fontWeight: 600 }}>{pnlLabel}</span>
                </p>
            }
            <button onClick={() => navigate('/my-bets')} style={GOLD_LINK}>View My Bets →</button>
          </div>
        </div>

        {/* Top value picks */}
        <div style={{ marginBottom: 20 }}>
          <span style={SH}>💡 Top Value Picks</span>
          {valuePicks === null
            ? <SkeletonRow />
            : valuePicks.length === 0
            ? <p style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Enter bookmaker odds in the Value tab to see value picks</p>
            : valuePicks.slice(0, 3).map((p, i) => <ValuePickRow key={i} pick={p} onAnalyze={onAnalyze} />)
          }
        </div>

        {/* Group standings — collapsible */}
        <div style={{ marginBottom: 20 }}>
          <button
            onClick={() => setStandingsOpen(o => !o)}
            style={{ ...GOLD_LINK, fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 6, width: '100%', textAlign: 'left', borderBottom: '1px solid var(--color-accent)', paddingBottom: 6, marginBottom: standingsOpen ? 12 : 0 }}
          >
            <span>📊 Group Standings</span>
            <span style={{ marginLeft: 'auto' }}>{standingsOpen ? '▲' : '▼'}</span>
          </button>
          {standingsOpen && GROUPS.filter(g => groupStandings[g]).map(g => (
            <div key={g} style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--color-accent)', letterSpacing: '0.08em', marginBottom: 4 }}>GROUP {g}</div>
              {groupStandings[g].slice(0, 4).map((r, i) => (
                <div key={r.team} style={{ display: 'flex', gap: 6, fontSize: 12, padding: '3px 0', color: i < 2 ? 'var(--color-success)' : 'var(--color-text-muted)', fontWeight: i < 2 ? 600 : 400 }}>
                  <span>{getFlag(r.team)}</span>
                  <span style={{ flex: 1 }}>{r.team}</span>
                  <span style={{ fontFamily: 'monospace' }}>{r.pts}pts</span>
                </div>
              ))}
            </div>
          ))}
        </div>

        {/* Model performance */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <span style={{ ...SH, marginBottom: 0, borderBottom: 'none', paddingBottom: 0 }}>Model Performance</span>
            <button onClick={() => navigate('/model-performance')} style={{ ...GOLD_LINK, fontSize: 11 }}>Details →</button>
          </div>
          <div style={{ borderBottom: '1px solid var(--color-accent)', marginBottom: 12 }} />
          <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
            {hitRate == null
              ? 'Performance tracked after first match settlement'
              : `Hit rate: ${hitRate}% · ${hits}/${total} correct`}
          </p>
        </div>
      </div>
    )
  }

  // ── DESKTOP ──────────────────────────────────────────────────────────────

  return (
    <div style={{ padding: '32px 40px', maxWidth: 1400 }}>

      {/* Greeting */}
      <p style={{ fontSize: 15, color: 'var(--color-text-muted)', marginBottom: 20 }}>
        {greeting}, Leo · {dateLabel} · WC2026 Day {wcDay}
      </p>

      {/* ── ROW 1: Stat pills ── */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 28 }}>
        <StatPill label="🏟 Matches Today" value={String(todayMatches.length)} />
        <StatPill label="🎯 Active Bets" value={String(pendingBets.length)} />
        <StatPill label="💰 Total P&L" value={pnlLabel} valueColor={pnlColor} />
        <StatPill label="📊 Model Hit Rate" value={hitRate == null ? '—' : `${hitRate}%`} valueColor="var(--color-accent)" />
      </div>

      {/* ── ROW 2: Today's Matches | Active Bets ── */}
      <div style={{ display: 'flex', gap: 24, marginBottom: 28 }}>

        {/* Left: Today's matches (420px fixed) */}
        <div style={{ width: 420, flexShrink: 0 }}>
          <span style={SH}>Today's Matches</span>
          {loading
            ? [1,2,3,4].map(i => <SkeletonRow key={i} />)
            : todayMatches.length === 0
            ? <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 12 }}>No matches today</p>
            : todayMatches.slice(0, 8).map(m => <MatchRow key={m.id} match={m} onAnalyze={onAnalyze} />)
          }
          <button onClick={() => navigate('/matches')} style={{ ...GOLD_LINK, marginTop: 8 }}>View all matches →</button>
        </div>

        {/* Right: Active bets */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <span style={SH}>Active Bets</span>
          {pendingBets.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '32px 0' }}>
              <p style={{ fontSize: 14, color: 'var(--color-text-muted)', marginBottom: 6 }}>No active bets</p>
              <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 16 }}>
                Place bets from the Value tab in any match analysis
              </p>
              <button onClick={() => navigate('/matches')} style={GOLD_BTN}>→ View Matches</button>
            </div>
          ) : (
            <>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      {['Match','Selection','Odds','Stake ¥','Return ¥','Status'].map(h => (
                        <th key={h} style={TH}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {pendingBets.map(b => <BetRow key={b.id} bet={b} />)}
                  </tbody>
                </table>
              </div>
              <div style={{ marginTop: 12, fontSize: 14, color: 'var(--color-text-muted)', lineHeight: 1.6 }}>
                {`Total staked: ¥${pendingBets.reduce((s,b) => s + Number(b.stake), 0).toFixed(0)}`}
                {` · Potential return: ¥${pendingBets.reduce((s,b) => s + Number(b.stake) * Number(b.odds), 0).toFixed(0)}`}
                {' · All-time P&L: '}
                <span style={{ color: pnlColor, fontWeight: 600 }}>{pnlLabel}</span>
                {' · ROI: '}
                <span style={{ color: settledStats.roi >= 0 ? 'var(--color-success)' : 'var(--color-danger)' }}>
                  {settledStats.roi >= 0 ? '+' : ''}{settledStats.roi.toFixed(1)}%
                </span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── ROW 3: Top Value Picks | Group Standings ── */}
      <div style={{ display: 'flex', gap: 24, marginBottom: 28 }}>

        {/* Left: Top value picks */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <span style={SH}>💡 Top Value Picks</span>
          {valuePicks === null ? (
            [1,2,3].map(i => <SkeletonRow key={i} />)
          ) : valuePicks.length > 0 ? (
            <>
              {valuePicks.map((p, i) => <ValuePickRow key={i} pick={p} onAnalyze={onAnalyze} />)}
              <button onClick={() => navigate('/recommendations')} style={{ ...GOLD_LINK, marginTop: 8 }}>View all tips →</button>
            </>
          ) : (
            <div>
              <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 12 }}>
                Enter bookmaker odds in the Value tab to see value picks
              </p>
              {noOddsMatches.slice(0, 5).map(m => (
                <div key={m.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--color-border-light)', fontSize: 13 }}>
                  <span>{getFlag(m.home_team)} {m.home_team} vs {getFlag(m.away_team)} {m.away_team}</span>
                  <button onClick={() => onAnalyze(m.id)} style={GOLD_LINK}>Add odds →</button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right: Group standings snapshot */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <span style={SH}>Group Standings Snapshot</span>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 24px' }}>
            {GROUPS.filter(g => groupStandings[g]).map(g => (
              <GroupSnapshot key={g} groupName={g} rows={groupStandings[g]} />
            ))}
          </div>
          <button onClick={() => navigate('/matches')} style={{ ...GOLD_LINK, marginTop: 8 }}>View full standings →</button>
        </div>
      </div>

      {/* ── BOTTOM ROW: Model Performance ── */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <span style={{ ...SH, marginBottom: 0, borderBottom: 'none', paddingBottom: 0 }}>Model Performance</span>
          <button onClick={() => navigate('/model-performance')} style={{ ...GOLD_LINK, fontSize: 11 }}>Details →</button>
        </div>
        <div style={{ borderBottom: '1px solid var(--color-accent)', marginBottom: 12 }} />
        {accuracy.length === 0 ? (
          <p style={{ fontSize: 14, color: 'var(--color-text-muted)' }}>
            Performance tracked after first match settlement
          </p>
        ) : (
          <p style={{ fontSize: 14, color: 'var(--color-text-muted)', lineHeight: 1.8 }}>
            {'Predictions: '}<span style={{ color: 'var(--color-text-primary)' }}>{total}</span>
            {' · Correct: '}<span style={{ color: 'var(--color-success)', fontWeight: 600 }}>{hits}</span>
            {' · Wrong: '}<span style={{ color: 'var(--color-danger)', fontWeight: 600 }}>{wrong}</span>
            {' · Pending: 0'}
            {' · Hit Rate: '}<span style={{ color: 'var(--color-accent)', fontWeight: 600 }}>{hitRate}%</span>
            {bestRole && (
              <>{' · Best role: '}<span style={{ color: 'var(--color-success)' }}>{bestRole.name} ({Math.round(bestRole.rate * 100)}%)</span></>
            )}
            {worstRole && bestRole && worstRole.name !== bestRole.name && (
              <>{' · Needs work: '}<span style={{ color: 'var(--color-danger)' }}>{worstRole.name} ({Math.round(worstRole.rate * 100)}%)</span></>
            )}
          </p>
        )}
      </div>
    </div>
  )
}
