import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { getFlag } from '../lib/teamFlags'
import { toBeijingTime } from '../lib/dateUtils'
import { runModels, getVenueAdvantage } from '../lib/poisson'
import { analyse1X2, calcStake } from '../lib/evEngine'

const EDGE_COLOURS = {
  green: 'var(--color-edge-green)',
  amber: 'var(--color-edge-amber)',
  red:   'var(--color-edge-red)',
}

function edgeColourStr(edge) {
  if (edge >= 0.05) return 'green'
  if (edge >= 0)    return 'amber'
  return 'red'
}

const STAGE_LABELS = {
  group: 'Group', r32: 'R32', r16: 'R16', qf: 'QF', sf: 'SF', '3rd': '3rd', final: 'Final',
}

export default function BetRecommendations() {
  const navigate = useNavigate()
  const [picks, setPicks] = useState(null)         // null = loading
  const [noOdds, setNoOdds] = useState([])
  const [error, setError] = useState(null)

  useEffect(() => {
    async function load() {
      setError(null)

      // Run both fetches in parallel
      const [withOddsRes, withoutOddsRes] = await Promise.all([
        supabase
          .from('matches')
          .select('*')
          .neq('status', 'finished')
          .not('odds_home', 'is', null)
          .not('odds_draw', 'is', null)
          .not('odds_away', 'is', null)
          .order('match_date', { ascending: true }),
        supabase
          .from('matches')
          .select('id, home_team, away_team, home_team_code, away_team_code, match_date, group_name, stage, status')
          .neq('status', 'finished')
          .is('odds_home', null)
          .neq('home_team', 'TBD')
          .neq('away_team', 'TBD')
          .order('match_date', { ascending: true })
          .limit(15),
      ])

      if (withOddsRes.error) { setError(withOddsRes.error.message); return }

      setNoOdds(withoutOddsRes.data || [])

      const matches = withOddsRes.data || []
      if (!matches.length) { setPicks([]); return }

      // Fetch team_stats for all matches with odds in one query
      const matchIds = matches.map(m => m.id)
      const { data: allStats } = await supabase
        .from('team_stats')
        .select('*')
        .in('match_id', matchIds)

      const statsIndex = {}
      for (const s of (allStats || [])) {
        statsIndex[`${s.match_id}:${s.team_code}`] = s
      }

      const candidates = []
      for (const m of matches) {
        const homeStats = statsIndex[`${m.id}:${m.home_team_code}`]
        const awayStats = statsIndex[`${m.id}:${m.away_team_code}`]
        if (!homeStats || !awayStats) continue

        let model
        try {
          model = runModels(homeStats, awayStats, { venue: m.venue, city: m.city, homeTeam: m.home_team })
        } catch { continue }

        const odds = { home: m.odds_home, draw: m.odds_draw, away: m.odds_away }
        const ev = analyse1X2(model.v2.probs, odds)
        if (!ev?.outcomes) continue

        for (const key of ['home', 'draw', 'away']) {
          const oc = ev.outcomes[key]
          if (!oc?.ev) continue
          const edge = oc.ev.edge
          if (edge <= 0) continue

          const stake = calcStake(oc.modelProb, oc.odds)
          candidates.push({
            matchId:     m.id,
            matchDate:   m.match_date,
            homeTeam:    m.home_team,
            awayTeam:    m.away_team,
            outcome:     key,
            label:       key === 'home' ? `${m.home_team} Win`
                       : key === 'away' ? `${m.away_team} Win`
                       : 'Draw',
            modelPct:    (oc.modelProb * 100).toFixed(1),
            odds:        oc.odds,
            edgePct:     oc.ev.edgePct,
            edgeDisplay: oc.ev.edgeDisplay,
            colour:      edgeColourStr(edge),
            stakePct:    stake.pct.toFixed(1),
          })
        }
      }

      candidates.sort((a, b) => b.edgePct - a.edgePct)
      setPicks(candidates.slice(0, 5))
    }

    load()
  }, [])

  const th = {
    padding: '8px 10px', fontSize: 11, fontWeight: 700, letterSpacing: '0.05em',
    color: 'var(--color-text-muted)', background: 'var(--color-bg-elevated)',
    borderBottom: '0.5px solid var(--color-border)', whiteSpace: 'nowrap',
  }
  const td = {
    padding: '10px 10px', fontSize: 13, color: 'var(--color-text-secondary)',
    borderBottom: '0.5px solid var(--color-border)', verticalAlign: 'middle',
  }

  const loading = picks === null && !error

  return (
    <div style={{ padding: '24px 16px', maxWidth: 820, margin: '0 auto' }}>

      {/* ── Header ── */}
      <div style={{ marginBottom: 16 }}>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 700, color: 'var(--color-text-primary)', marginBottom: 4 }}>
          💡 Top Picks
        </h1>
        <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
          Top 5 positive-edge 1X2 bets · ¼ Kelly · V2 model · MT22 vig-stripped
        </p>
      </div>

      {/* ── Activation note — always visible ── */}
      <div style={{
        display: 'flex', alignItems: 'flex-start', gap: 10, padding: '12px 14px',
        background: 'var(--color-info-dim)', border: '0.5px solid var(--color-info)',
        borderRadius: 'var(--radius-md)', marginBottom: 20,
      }}>
        <span style={{ fontSize: 16, flexShrink: 0 }}>ℹ️</span>
        <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>
          <strong style={{ color: 'var(--color-text-primary)' }}>How to activate:</strong> Open a match → go to the <strong>Value tab</strong> → enter bookmaker odds for Home / Draw / Away. Picks appear here automatically once odds are saved.
        </p>
      </div>

      {/* ── Loading ── */}
      {loading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[1, 2, 3].map(i => (
            <div key={i} className="skeleton" style={{ height: 56, borderRadius: 'var(--radius-md)' }} />
          ))}
        </div>
      )}

      {/* ── Error ── */}
      {error && (
        <div style={{ padding: 16, background: 'var(--color-danger-dim)', border: '0.5px solid var(--color-danger)', borderRadius: 'var(--radius-md)', color: 'var(--color-danger)', fontSize: 14 }}>
          {error}
        </div>
      )}

      {/* ── Picks table ── */}
      {!loading && !error && picks?.length > 0 && (
        <div style={{ background: 'var(--color-bg-card)', border: '0.5px solid var(--color-border)', borderRadius: 'var(--radius-md)', overflow: 'hidden', marginBottom: 24 }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 560 }}>
              <thead>
                <tr>
                  <th style={{ ...th, textAlign: 'left' }}>#</th>
                  <th style={{ ...th, textAlign: 'left' }}>Match</th>
                  <th style={{ ...th, textAlign: 'left' }}>Outcome</th>
                  <th style={{ ...th, textAlign: 'center' }}>Model %</th>
                  <th style={{ ...th, textAlign: 'center' }}>Odds</th>
                  <th style={{ ...th, textAlign: 'center' }}>Edge %</th>
                  <th style={{ ...th, textAlign: 'center' }}>Kelly</th>
                  <th style={{ ...th, textAlign: 'center' }}>Analyze</th>
                </tr>
              </thead>
              <tbody>
                {picks.map((p, i) => {
                  const col = EDGE_COLOURS[p.colour] || 'var(--color-text-muted)'
                  return (
                    <tr key={`${p.matchId}-${p.outcome}`} style={{ background: p.colour === 'green' ? 'rgba(45,122,79,0.05)' : 'transparent' }}>
                      <td style={{ ...td, fontFamily: 'var(--font-display)', fontWeight: 700, color: 'var(--color-text-muted)', paddingLeft: 14 }}>
                        {i + 1}
                      </td>
                      <td style={{ ...td, textAlign: 'left', minWidth: 160 }}>
                        <p style={{ fontSize: 13, color: 'var(--color-text-primary)', fontWeight: 600, margin: 0 }}>
                          {getFlag(p.homeTeam)} {p.homeTeam} <span style={{ fontWeight: 400, color: 'var(--color-text-muted)' }}>vs</span> {getFlag(p.awayTeam)} {p.awayTeam}
                        </p>
                        <p style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>
                          {toBeijingTime(p.matchDate, 'date')}
                        </p>
                      </td>
                      <td style={{ ...td, textAlign: 'left', fontWeight: 600, color: 'var(--color-text-primary)' }}>
                        {p.label}
                      </td>
                      <td style={{ ...td, textAlign: 'center', color: 'var(--color-accent)', fontWeight: 700 }}>
                        {p.modelPct}%
                      </td>
                      <td style={{ ...td, textAlign: 'center', fontWeight: 600, color: 'var(--color-text-secondary)' }}>
                        {p.odds.toFixed(2)}
                      </td>
                      <td style={{ ...td, textAlign: 'center' }}>
                        <span style={{
                          fontSize: 13, fontWeight: 700, color: col,
                          padding: '3px 8px', borderRadius: 'var(--radius-full)',
                          background: `${col}22`, border: `0.5px solid ${col}`,
                          whiteSpace: 'nowrap',
                        }}>
                          {p.edgeDisplay}
                        </span>
                      </td>
                      <td style={{ ...td, textAlign: 'center', fontSize: 12, color: 'var(--color-text-muted)' }}>
                        {p.stakePct}%
                      </td>
                      <td style={{ ...td, textAlign: 'center' }}>
                        <button
                          onClick={() => navigate(`/matches/${p.matchId}`)}
                          style={{ minHeight: 32, padding: '0 12px', fontSize: 12, fontWeight: 700, borderRadius: 'var(--radius-sm)', border: 'none', background: 'var(--color-accent)', color: 'var(--color-bg)', cursor: 'pointer' }}
                        >
                          Analyze →
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', padding: '10px 14px', borderTop: '0.5px solid var(--color-border)' }}>
            {[
              { c: EDGE_COLOURS.green, l: '≥ 5% — Recommend' },
              { c: EDGE_COLOURS.amber, l: '0–4.9% — Marginal' },
            ].map(({ c, l }) => (
              <span key={l} style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 'var(--radius-full)', background: `${c}22`, color: c, border: `0.5px solid ${c}` }}>
                {l}
              </span>
            ))}
            <span style={{ fontSize: 11, color: 'var(--color-text-muted)', alignSelf: 'center' }}>
              ¼ Kelly · 5% cap (MT24) · V2 · vig stripped (MT22)
            </span>
          </div>
        </div>
      )}

      {/* ── No picks yet ── */}
      {!loading && !error && picks?.length === 0 && (
        <div style={{ padding: '16px 18px', background: 'var(--color-bg-card)', border: '0.5px solid var(--color-border)', borderRadius: 'var(--radius-md)', marginBottom: 24 }}>
          <p style={{ fontSize: 14, color: 'var(--color-text-muted)', fontWeight: 600, marginBottom: 4 }}>
            No positive-edge bets found yet
          </p>
          <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
            Either no odds have been entered, or none of the entered odds show positive model edge. Enter odds for upcoming matches below.
          </p>
        </div>
      )}

      {/* ── Matches without odds — "Add odds" list ── */}
      {!loading && !error && noOdds.length > 0 && (
        <div>
          <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text-muted)', letterSpacing: '0.06em', marginBottom: 10 }}>
            UPCOMING MATCHES — ODDS NOT YET ENTERED
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {noOdds.map(m => {
              const stageLabel = m.stage === 'group'
                ? `Group ${m.group_name}`
                : (STAGE_LABELS[m.stage] || m.stage)
              return (
                <div
                  key={m.id}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    gap: 12, padding: '10px 14px',
                    background: 'var(--color-bg-card)', border: '0.5px solid var(--color-border)',
                    borderRadius: 'var(--radius-md)',
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 14, color: 'var(--color-text-primary)', fontWeight: 600, margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {getFlag(m.home_team)} {m.home_team}
                      <span style={{ fontWeight: 400, color: 'var(--color-text-muted)', margin: '0 6px' }}>vs</span>
                      {getFlag(m.away_team)} {m.away_team}
                    </p>
                    <p style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>
                      {stageLabel} · {toBeijingTime(m.match_date, 'date')} {toBeijingTime(m.match_date, 'time')} 北京
                    </p>
                  </div>
                  <button
                    onClick={() => navigate(`/matches/${m.id}`)}
                    style={{
                      flexShrink: 0, minHeight: 34, padding: '0 12px',
                      fontSize: 12, fontWeight: 700,
                      borderRadius: 'var(--radius-sm)',
                      border: '0.5px solid var(--color-accent-border)',
                      background: 'var(--color-accent-dim)',
                      color: 'var(--color-accent)',
                      cursor: 'pointer', whiteSpace: 'nowrap',
                    }}
                  >
                    Add odds →
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
