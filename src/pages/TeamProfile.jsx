import { useState, useEffect, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { getFlag } from '../lib/teamFlags'
import { toBeijingTime } from '../lib/dateUtils'

// Local FormDots — mirrors MatchCard version; not exported from that file
function FormDots({ formString }) {
  if (!formString) return null
  const chars = formString.slice(0, 5).split('')
  const colour = { W: 'var(--color-success)', D: 'var(--color-warning)', L: 'var(--color-danger)' }
  return (
    <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
      {chars.map((c, i) => (
        <span key={i} title={c === 'W' ? 'Win' : c === 'D' ? 'Draw' : 'Loss'}
          style={{ width: 9, height: 9, borderRadius: '50%', background: colour[c] || 'var(--color-text-muted)', display: 'inline-block', flexShrink: 0 }} />
      ))}
    </span>
  )
}

function StatCard({ label, value, sub }) {
  return (
    <div style={{ background: 'var(--color-bg-elevated)', borderRadius: 'var(--radius-sm)', padding: '10px 14px', flex: '1 1 100px', minWidth: 100 }}>
      <p style={{ fontSize: 10, fontWeight: 700, color: 'var(--color-text-muted)', letterSpacing: '0.06em', marginBottom: 4 }}>{label}</p>
      <p style={{ fontSize: 20, fontWeight: 700, color: 'var(--color-text-primary)', fontFamily: 'var(--font-display)' }}>{value ?? '—'}</p>
      {sub && <p style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>{sub}</p>}
    </div>
  )
}

// Pure standings calculator (mirrors Matches.jsx)
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
    if (h > a) { ht.w++; ht.pts += 3 } else if (h === a) { ht.d++; ht.pts += 1 } else ht.l++
    at.mp++; at.gf += a; at.ga += h
    if (a > h) { at.w++; at.pts += 3 } else if (a === h) { at.d++; at.pts += 1 } else at.l++
  }
  return Object.entries(table)
    .map(([team, s]) => ({ team, ...s, gd: s.gf - s.ga }))
    .sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf)
}

// W/D/L badge with score for this team
function ResultBadge({ match, teamCode }) {
  if (match.status !== 'finished') return null
  const isHome = match.home_team_code === teamCode
  const tf = isHome ? match.home_score : match.away_score
  const ta = isHome ? match.away_score : match.home_score
  const r  = tf > ta ? 'W' : tf < ta ? 'L' : 'D'
  const col = r === 'W' ? 'var(--color-success)' : r === 'L' ? 'var(--color-danger)' : 'var(--color-warning)'
  return (
    <span style={{ fontSize: 11, fontWeight: 700, color: col, padding: '2px 7px', borderRadius: 'var(--radius-full)', background: `${col}22`, border: `0.5px solid ${col}`, whiteSpace: 'nowrap' }}>
      {r} {tf}–{ta}
    </span>
  )
}

export default function TeamProfile() {
  const { teamCode } = useParams()
  const navigate = useNavigate()

  const [teamMatches,     setTeamMatches]     = useState([])
  const [groupAllMatches, setGroupAllMatches] = useState([])
  const [stats,           setStats]           = useState(null)
  const [profile,         setProfile]         = useState(null)
  const [loading,         setLoading]         = useState(true)
  const [error,           setError]           = useState(null)

  useEffect(() => {
    if (!teamCode) return
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const [{ data: m, error: me }, { data: s }, { data: p }] = await Promise.all([
          supabase.from('matches').select('*')
            .or(`home_team_code.eq.${teamCode},away_team_code.eq.${teamCode}`)
            .order('match_date', { ascending: true }),
          supabase.from('team_stats').select('*')
            .eq('team_code', teamCode)
            .order('updated_at', { ascending: false })
            .limit(1),
          supabase.from('team_profiles').select('*')
            .eq('team_code', teamCode)
            .limit(1),
        ])
        if (me) throw new Error(me.message)
        const tm = m || []
        setTeamMatches(tm)
        setStats(s?.[0] || null)
        setProfile(p?.[0] || null)

        // Fetch all group matches for standings (needs group_name from team's matches)
        const grpName = tm.find(x => x.stage === 'group')?.group_name
        if (grpName) {
          const { data: gm } = await supabase.from('matches').select('*')
            .eq('group_name', grpName)
            .eq('stage', 'group')
            .order('match_date', { ascending: true })
          setGroupAllMatches(gm || [])
        }
      } catch (err) {
        setError(err.message)
      }
      setLoading(false)
    }
    load()
  }, [teamCode])

  const teamName = useMemo(() => {
    const m = teamMatches[0]
    if (!m) return teamCode
    return m.home_team_code === teamCode ? m.home_team : m.away_team
  }, [teamMatches, teamCode])

  const groupName  = teamMatches.find(m => m.stage === 'group')?.group_name
  const nextMatch  = teamMatches.find(m => m.status !== 'finished' && m.home_team !== 'TBD' && m.away_team !== 'TBD')

  const standings  = useMemo(() => groupAllMatches.length ? calcStandings(groupAllMatches) : [], [groupAllMatches])
  const myRow      = standings.find(r => r.team === teamName)
  const myPosition = standings.findIndex(r => r.team === teamName) + 1

  const card = {
    background: 'var(--color-bg-card)',
    border: '0.5px solid var(--color-border)',
    borderRadius: 'var(--radius-md)',
    padding: '16px',
    marginBottom: 12,
  }
  const secTitle = { fontSize: 11, fontWeight: 700, color: 'var(--color-text-muted)', letterSpacing: '0.06em', marginBottom: 12 }

  if (loading) {
    return (
      <div style={{ padding: '24px 16px', maxWidth: 720, margin: '0 auto' }}>
        <div style={{ height: 36, width: 220, marginBottom: 20 }} className="skeleton" />
        {[1, 2, 3].map(i => <div key={i} className="skeleton" style={{ height: 110, marginBottom: 12 }} />)}
      </div>
    )
  }

  if (error || !teamMatches.length) {
    return (
      <div style={{ padding: '24px 16px', maxWidth: 720, margin: '0 auto' }}>
        <button onClick={() => navigate(-1)} style={{ background: 'none', border: 'none', color: 'var(--color-accent)', cursor: 'pointer', fontSize: 14, marginBottom: 16 }}>← Back</button>
        <p style={{ color: 'var(--color-danger)' }}>{error || `No data found for team code "${teamCode}"`}</p>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '16px' }}>

      {/* ── SECTION 1: Header ── */}
      <div style={card}>
        <button
          onClick={() => navigate('/matches', { state: { from: 'group' } })}
          style={{ background: 'none', border: 'none', color: 'var(--color-text-secondary)', cursor: 'pointer', fontSize: 13, marginBottom: 14, padding: 0, display: 'flex', alignItems: 'center', gap: 4 }}
        >
          ← Back to Groups
        </button>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 52, lineHeight: 1 }}>{getFlag(teamName)}</div>
          <div style={{ flex: 1 }}>
            <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 700, color: 'var(--color-text-primary)', marginBottom: 6 }}>
              {teamName}
            </h1>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              {groupName && (
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-accent)', background: 'var(--color-accent-dim)', padding: '2px 8px', borderRadius: 'var(--radius-full)', border: '0.5px solid var(--color-accent-border)' }}>
                  Group {groupName}
                </span>
              )}
              {profile?.fifa_ranking && (
                <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>FIFA #{profile.fifa_ranking}</span>
              )}
              {profile?.coach_name && (
                <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>Coach: {profile.coach_name}</span>
              )}
              {profile?.confederation && (
                <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{profile.confederation}</span>
              )}
            </div>
            {profile?.playing_style && (
              <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 8 }}>{profile.playing_style}</p>
            )}
          </div>
        </div>
      </div>

      {/* ── SECTION 2: Current Form ── */}
      {stats ? (
        <div style={card}>
          <p style={secTitle}>CURRENT FORM</p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
            <FormDots formString={stats.form_string} />
            <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Last {stats.games_window || 5} games</span>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <StatCard label="SCORED" value={stats.goals_scored_avg?.toFixed(2)} sub="per game" />
            <StatCard label="CONCEDED" value={stats.goals_conceded_avg?.toFixed(2)} sub="per game" />
            {stats.xgf_per_game != null && <StatCard label="xGF" value={stats.xgf_per_game?.toFixed(2)} sub="per game" />}
            {stats.xga_per_game != null && <StatCard label="xGA" value={stats.xga_per_game?.toFixed(2)} sub="per game" />}
          </div>
        </div>
      ) : (
        <div style={{ ...card, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13 }}>
          No stats synced yet for {teamName}
        </div>
      )}

      {/* ── SECTION 3: WC2026 Campaign ── */}
      <div style={card}>
        <p style={secTitle}>WC2026 CAMPAIGN</p>

        {/* Group position summary */}
        {myRow && (
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 14, padding: '10px 12px', background: 'var(--color-bg-elevated)', borderRadius: 'var(--radius-sm)' }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text-primary)' }}>
              {myPosition <= 2 ? '✅' : myPosition === 3 ? '🟡' : '⬜'} #{myPosition} in Group {groupName}
            </span>
            <span style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>{myRow.mp} played</span>
            <span style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>{myRow.pts} pts</span>
            <span style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
              GD {myRow.gd >= 0 ? '+' : ''}{myRow.gd}
            </span>
            <span style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>{myRow.gf} GF · {myRow.ga} GA</span>
          </div>
        )}

        {/* Match list */}
        {teamMatches.map(m => {
          const isHome   = m.home_team_code === teamCode
          const opponent = isHome ? m.away_team : m.home_team
          const isKO     = m.stage !== 'group'
          const isPending = m.status !== 'finished' && m.home_team !== 'TBD' && m.away_team !== 'TBD'
          return (
            <div key={m.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderBottom: '0.5px solid var(--color-border)', gap: 8, flexWrap: 'wrap' }}>
              <div>
                <p style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 2 }}>
                  {toBeijingTime(m.match_date)}
                  {isKO && (
                    <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, color: 'var(--color-warning)', background: 'rgba(204,136,0,0.12)', padding: '1px 5px', borderRadius: 'var(--radius-full)' }}>
                      {m.stage?.toUpperCase()}
                    </span>
                  )}
                </p>
                <p style={{ fontSize: 14, color: 'var(--color-text-primary)', fontWeight: 500 }}>
                  {isHome ? 'vs' : '@'} {getFlag(opponent)} {opponent}
                </p>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
                <ResultBadge match={m} teamCode={teamCode} />
                {isPending && (
                  <button onClick={() => navigate(`/matches/${m.id}`)}
                    style={{ minHeight: 30, padding: '0 10px', fontSize: 12, fontWeight: 700, borderRadius: 'var(--radius-sm)', border: '0.5px solid var(--color-accent-border)', background: 'var(--color-accent-dim)', color: 'var(--color-accent)', cursor: 'pointer' }}>
                    Analyze →
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* ── SECTION 4: Key Players (placeholder) ── */}
      <div style={{ ...card, textAlign: 'center', padding: '22px 16px', color: 'var(--color-text-muted)' }}>
        <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Key Players</p>
        <p style={{ fontSize: 12 }}>Coming soon — data will be seeded via team_profiles</p>
      </div>

      {/* ── SECTION 5: Next Match ── */}
      {nextMatch && (
        <div style={card}>
          <p style={secTitle}>NEXT MATCH</p>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 4 }}>{toBeijingTime(nextMatch.match_date)}</p>
              <p style={{ fontSize: 16, fontWeight: 700, color: 'var(--color-text-primary)' }}>
                {getFlag(nextMatch.home_team)} {nextMatch.home_team}
                <span style={{ color: 'var(--color-text-muted)', fontWeight: 400, margin: '0 6px' }}>vs</span>
                {getFlag(nextMatch.away_team)} {nextMatch.away_team}
              </p>
              {nextMatch.venue && <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 3 }}>{nextMatch.venue}</p>}
            </div>
            <button onClick={() => navigate(`/matches/${nextMatch.id}`)}
              style={{ minHeight: 40, padding: '0 16px', fontSize: 14, fontWeight: 700, borderRadius: 'var(--radius-sm)', border: 'none', background: 'var(--color-accent)', color: 'var(--color-bg)', cursor: 'pointer', flexShrink: 0 }}>
              Analyze →
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
