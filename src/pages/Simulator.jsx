// src/pages/Simulator.jsx
import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useTranslation } from '../lib/i18n'
import { getFlag } from '../lib/teamFlags'
import { dcLambdas, dcScoreMatrix, isWC2026Host } from '../utils/dcRatings.js'

// ─── simulation core (pure functions) ────────────────────────────────────────

function sampleScore(M) {
  const flat = M.flat()
  let r = Math.random(), cum = 0
  for (let i = 0; i < flat.length; i++) {
    cum += flat[i]
    if (r <= cum) return { hg: Math.floor(i / 9), ag: i % 9 }
  }
  return { hg: 0, ag: 0 }
}

function simulateMatch(home, away, actualResults, knockout = false) {
  const key1 = `${home}|${away}`
  const key2 = `${away}|${home}`
  if (actualResults[key1]) {
    const { hg, ag } = actualResults[key1]
    const winner = hg > ag ? home : ag > hg ? away : null
    return { home, away, hg, ag, winner, pens: false, actual: true }
  }
  if (actualResults[key2]) {
    const { hg: rH, ag: rA } = actualResults[key2]
    const hg = rA, ag = rH
    const winner = hg > ag ? home : ag > hg ? away : null
    return { home, away, hg, ag, winner, pens: false, actual: true }
  }

  const homeIsHost = isWC2026Host(home)
  const { lh, la } = dcLambdas(home, away, homeIsHost)
  const M = dcScoreMatrix(lh, la)
  const { hg, ag } = sampleScore(M)
  let winner = hg > ag ? home : ag > hg ? away : null
  let pens = false

  if (knockout && winner === null) {
    let hw = 0, aw = 0
    for (let x = 0; x <= 8; x++)
      for (let y = 0; y <= 8; y++) {
        if (x > y) hw += M[x][y]; else if (x < y) aw += M[x][y]
      }
    winner = Math.random() < hw / (hw + aw) ? home : away
    pens = true
  }

  return { home, away, hg, ag, winner, pens, actual: false }
}

function updateStandings(prev, gf, ga) {
  const win = gf > ga, draw = gf === ga
  return {
    ...prev,
    p: prev.p + 1,
    w: prev.w + (win ? 1 : 0),
    d: prev.d + (draw ? 1 : 0),
    l: prev.l + (!win && !draw ? 1 : 0),
    gf: prev.gf + gf,
    ga: prev.ga + ga,
    gd: prev.gd + gf - ga,
    pts: prev.pts + (win ? 3 : draw ? 1 : 0),
  }
}

function sortTable(table) {
  return [...table].sort((a, b) =>
    b.pts - a.pts || b.gd - a.gd || b.gf - a.gf || a.team.localeCompare(b.team)
  )
}

function simulateGroups(fixtures, actualResults) {
  const groupMap = {}
  fixtures.forEach(f => {
    const g = f.group_name
    if (!groupMap[g]) groupMap[g] = []
    groupMap[g].push(f)
  })

  const results = {}
  for (const [groupName, groupFixtures] of Object.entries(groupMap)) {
    const standings = {}
    const matchResults = []
    for (const f of groupFixtures) {
      const m = simulateMatch(f.home_team, f.away_team, actualResults, false)
      matchResults.push(m)
      const initH = standings[m.home] || { team: m.home, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, gd: 0, pts: 0 }
      const initA = standings[m.away] || { team: m.away, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, gd: 0, pts: 0 }
      standings[m.home] = updateStandings(initH, m.hg, m.ag)
      standings[m.away] = updateStandings(initA, m.ag, m.hg)
    }
    results[groupName] = { table: sortTable(Object.values(standings)), fixtures: matchResults }
  }
  return results
}

function buildR32Bracket(groupResults, best8Third) {
  const groups = Object.keys(groupResults).sort()
  const matches = []
  for (let i = 0; i < groups.length - 1; i += 2) {
    const gA = groups[i], gB = groups[i + 1]
    const tA = groupResults[gA].table, tB = groupResults[gB].table
    if (tA?.[0] && tB?.[1]) matches.push({ home: tA[0].team, away: tB[1].team, label: `1${gA} v 2${gB}` })
    if (tB?.[0] && tA?.[1]) matches.push({ home: tB[0].team, away: tA[1].team, label: `1${gB} v 2${gA}` })
  }
  for (let i = 0; i < best8Third.length - 1; i += 2) {
    matches.push({ home: best8Third[i].team, away: best8Third[i + 1].team, label: `3rd #${i + 1} v 3rd #${i + 2}` })
  }
  return matches
}

function simulateKnockoutRound(matchups, actualResults) {
  return matchups.map(m => {
    const res = simulateMatch(m.home, m.away, actualResults, true)
    return { ...res, label: m.label || '' }
  })
}

function buildNextRound(prev) {
  const matches = []
  for (let i = 0; i < prev.length - 1; i += 2) {
    if (prev[i].winner && prev[i + 1].winner)
      matches.push({ home: prev[i].winner, away: prev[i + 1].winner })
  }
  return matches
}

function runSimulation(fixtures, actualResults) {
  try {
    const groups = simulateGroups(fixtures, actualResults)
    const groupArr = Object.keys(groups).sort()
    const allThird = groupArr
      .filter(g => groups[g].table.length >= 3)
      .map(g => ({ ...groups[g].table[2], group: g }))
    const rankedThird = [...allThird].sort((a, b) =>
      b.pts - a.pts || b.gd - a.gd || b.gf - a.gf || a.team.localeCompare(b.team)
    )
    const best8 = rankedThird.slice(0, 8)

    const r32Fixtures = buildR32Bracket(groups, best8)
    const r32 = simulateKnockoutRound(r32Fixtures, actualResults)
    const r16 = simulateKnockoutRound(buildNextRound(r32), actualResults)
    const qf = simulateKnockoutRound(buildNextRound(r16), actualResults)
    const sf = simulateKnockoutRound(buildNextRound(qf), actualResults)

    const sfLoser0 = sf[0]?.winner === sf[0]?.home ? sf[0]?.away : sf[0]?.home
    const sfLoser1 = sf[1]?.winner === sf[1]?.home ? sf[1]?.away : sf[1]?.home
    const finalMatch = simulateMatch(sf[0]?.winner, sf[1]?.winner, actualResults, true)
    const bronzeMatch = simulateMatch(sfLoser0, sfLoser1, actualResults, true)
    const runnerUp = finalMatch.winner === finalMatch.home ? finalMatch.away : finalMatch.home

    return {
      groups, thirdPlace: rankedThird,
      rounds: { r32, r16, qf, sf, final: finalMatch, bronze: bronzeMatch },
      champion: finalMatch.winner, runnerUp, third: bronzeMatch.winner,
    }
  } catch (e) {
    console.error('Simulation error:', e)
    return null
  }
}

// ─── sub-components ───────────────────────────────────────────────────────────

function ActualBadge() {
  return (
    <span style={{
      fontSize: 9, fontWeight: 700, letterSpacing: '0.04em',
      padding: '1px 5px', borderRadius: 3,
      background: 'var(--color-success-dim)', color: 'var(--color-success)',
      marginLeft: 4, flexShrink: 0,
    }}>
      actual
    </span>
  )
}

function MatchRow({ m, showLabel }) {
  if (!m) return null
  const loserHome = m.winner === m.away
  const loserAway = m.winner === m.home

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '7px 12px',
      borderBottom: '0.5px solid var(--color-border)',
      fontSize: 13,
    }}>
      {showLabel && m.label && (
        <span style={{ fontSize: 10, color: 'var(--color-text-muted)', minWidth: 80, flexShrink: 0 }}>
          {m.label}
        </span>
      )}
      <span style={{
        flex: 1, fontFamily: 'var(--font-display)', fontWeight: loserHome ? 400 : 500,
        color: loserHome ? 'var(--color-text-muted)' : 'var(--color-text-primary)',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {getFlag(m.home)} {m.home}
      </span>
      <span style={{
        fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 15,
        color: 'var(--color-text-primary)', flexShrink: 0, minWidth: 52, textAlign: 'center',
      }}>
        {m.hg}–{m.ag}
      </span>
      <span style={{
        flex: 1, fontFamily: 'var(--font-display)', fontWeight: loserAway ? 400 : 500,
        color: loserAway ? 'var(--color-text-muted)' : 'var(--color-text-primary)',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        textAlign: 'right',
      }}>
        {m.away} {getFlag(m.away)}
      </span>
      {m.pens && (
        <span style={{ fontSize: 10, color: 'var(--color-text-muted)', flexShrink: 0 }}>(pens)</span>
      )}
      {m.actual && <ActualBadge />}
    </div>
  )
}

function GroupCard({ groupName, table, thirdAdvancedSet }) {
  return (
    <div style={{
      background: 'var(--color-bg-secondary)',
      border: '0.5px solid var(--color-border)',
      borderRadius: 'var(--radius-lg)',
      overflow: 'hidden',
    }}>
      <div style={{
        background: '#1A3A6C', color: '#fff',
        padding: '6px 12px',
        fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 13, letterSpacing: '0.05em',
      }}>
        GROUP {groupName}
      </div>
      {table.map((row, idx) => {
        const isTop2 = idx < 2
        const isThird = idx === 2
        const thirdAdvances = isThird && thirdAdvancedSet?.has(row.team)
        let borderColor = 'transparent'
        if (isTop2) borderColor = 'var(--color-success)'
        else if (thirdAdvances) borderColor = '#C9A84C'

        return (
          <div key={row.team} style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '5px 10px',
            borderLeft: `3px solid ${borderColor}`,
            opacity: idx >= 3 ? 0.55 : 1,
            borderBottom: '0.5px solid var(--color-border)',
          }}>
            <span style={{ fontSize: 10, color: 'var(--color-text-muted)', minWidth: 12, textAlign: 'center' }}>
              {idx + 1}
            </span>
            <span style={{
              flex: 1, fontFamily: 'var(--font-ui)', fontSize: 12, fontWeight: isTop2 ? 500 : 400,
              color: idx >= 3 ? 'var(--color-text-muted)' : 'var(--color-text-primary)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {getFlag(row.team)} {row.team}
            </span>
            <span style={{ fontSize: 11, color: 'var(--color-text-muted)', minWidth: 24, textAlign: 'right' }}>
              {row.pts}pt
            </span>
            <span style={{ fontSize: 11, color: 'var(--color-text-muted)', minWidth: 28, textAlign: 'right' }}>
              {row.gd >= 0 ? '+' : ''}{row.gd}
            </span>
          </div>
        )
      })}
    </div>
  )
}

function PodiumCard({ medal, team, score, secondary }) {
  const isChampion = medal === '🏆'
  return (
    <div style={{
      flex: 1, minWidth: 0,
      border: isChampion ? '0.5px solid #C9A84C' : '0.5px solid var(--color-border)',
      background: isChampion ? 'rgba(201,168,76,0.08)' : 'var(--color-bg-secondary)',
      borderRadius: 'var(--radius-lg)',
      padding: isChampion ? '20px 16px' : '14px 12px',
      textAlign: 'center',
      order: isChampion ? 0 : undefined,
    }}>
      <div style={{ fontSize: isChampion ? 32 : 24, marginBottom: 6 }}>{medal}</div>
      <div style={{
        fontFamily: 'var(--font-display)',
        fontSize: isChampion ? 18 : 15,
        fontWeight: 500,
        color: isChampion ? '#C9A84C' : 'var(--color-text-primary)',
        marginBottom: 4,
      }}>
        {getFlag(team)} {team}
      </div>
      {score && (
        <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{score}</div>
      )}
    </div>
  )
}

function TabButton({ label, active, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '6px 14px',
        border: active ? '0.5px solid var(--color-accent-border)' : '0.5px solid var(--color-border)',
        borderRadius: 'var(--radius-sm)',
        background: active ? 'var(--color-accent-dim)' : 'transparent',
        color: active ? 'var(--color-accent)' : 'var(--color-text-secondary)',
        fontFamily: 'var(--font-ui)', fontSize: 13, fontWeight: active ? 600 : 400,
        cursor: 'pointer', minHeight: 44, whiteSpace: 'nowrap',
      }}
    >
      {label}
    </button>
  )
}

function RoundTab({ matches }) {
  return (
    <div style={{
      background: 'var(--color-bg-secondary)',
      border: '0.5px solid var(--color-border)',
      borderRadius: 'var(--radius-lg)',
      overflow: 'hidden',
    }}>
      {matches.map((m, i) => <MatchRow key={i} m={m} showLabel />)}
    </div>
  )
}

// ─── main component ───────────────────────────────────────────────────────────

export default function Simulator() {
  const { t, lang } = useTranslation()
  const [fixtures, setFixtures] = useState([])
  const [actualResults, setActualResults] = useState({})
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState(null)
  const [simState, setSimState] = useState('idle') // idle | running | done
  const [results, setResults] = useState(null)
  const [mcState, setMcState] = useState('idle') // idle | running | done
  const [mcResults, setMcResults] = useState(null)
  const [mcProgress, setMcProgress] = useState(0)
  const [activeTab, setActiveTab] = useState('groups')
  const [copied, setCopied] = useState(false)
  const mcRafRef = useRef(null)

  useEffect(() => {
    fetchData()
    return () => { if (mcRafRef.current) cancelAnimationFrame(mcRafRef.current) }
  }, [])

  async function fetchData() {
    setLoading(true)
    setFetchError(null)
    try {
      const [playedRes, fixturesRes] = await Promise.all([
        supabase.from('matches')
          .select('home_team, away_team, home_score, away_score')
          .eq('status', 'finished'),
        supabase.from('matches')
          .select('home_team, away_team, group_name, stage, status')
          .eq('stage', 'group')
          .order('match_date'),
      ])
      const actualMap = {}
      ;(playedRes.data || []).forEach(m => {
        actualMap[`${m.home_team}|${m.away_team}`] = { hg: m.home_score, ag: m.away_score }
      })
      setActualResults(actualMap)
      setFixtures((fixturesRes.data || []).filter(f => f.group_name && f.home_team && f.away_team))
    } catch (err) {
      setFetchError(String(err))
    } finally {
      setLoading(false)
    }
  }

  async function handleRunSim() {
    setSimState('running')
    setResults(null)
    await new Promise(r => setTimeout(r, 300))
    const res = runSimulation(fixtures, actualResults)
    setResults(res)
    setSimState('done')
    setActiveTab('groups')
  }

  function handleMonteCarlo() {
    if (mcRafRef.current) cancelAnimationFrame(mcRafRef.current)
    setMcState('running')
    setMcResults(null)
    setMcProgress(0)

    const N = 1000
    const CHUNK = 80
    let done = 0
    const stats = {}

    function processChunk() {
      for (let i = 0; i < CHUNK && done < N; i++, done++) {
        const res = runSimulation(fixtures, actualResults)
        if (!res) continue
        const { champion, runnerUp, rounds: { sf } } = res

        sf.forEach(m => {
          [m.home, m.away].forEach(team => {
            if (!stats[team]) stats[team] = { team, wins: 0, finals: 0, sfs: 0 }
            stats[team].sfs++
          })
        })
        ;[champion, runnerUp].forEach(team => {
          if (!stats[team]) stats[team] = { team, wins: 0, finals: 0, sfs: 0 }
          stats[team].finals++
        })
        if (!stats[champion]) stats[champion] = { team: champion, wins: 0, finals: 0, sfs: 0 }
        stats[champion].wins++
      }

      setMcProgress(Math.round(done / N * 100))
      if (done < N) {
        mcRafRef.current = requestAnimationFrame(processChunk)
      } else {
        const sorted = Object.values(stats)
          .map(s => ({
            ...s,
            winPct: (s.wins / N * 100).toFixed(1),
            finalPct: (s.finals / N * 100).toFixed(1),
            sfPct: (s.sfs / N * 100).toFixed(1),
          }))
          .sort((a, b) => b.wins - a.wins)
          .slice(0, 20)
        setMcResults(sorted)
        setMcState('done')
      }
    }
    mcRafRef.current = requestAnimationFrame(processChunk)
  }

  function handleCopy() {
    if (!results) return
    const dateStr = new Date().toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-US', { month: 'short', day: 'numeric' })
    const text = lang === 'zh'
      ? `我的WC2026模拟 🏆 ${results.champion} 夺冠，${results.runnerUp} 亚军 · ${dateStr} · metis.tiga6.com`
      : `My WC2026 simulation: 🏆 ${results.champion} beats ${results.runnerUp} in the final · ${dateStr} · metis.tiga6.com`
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  // Derived data
  const thirdAdvancedSet = results
    ? new Set(results.thirdPlace.slice(0, 8).map(t => t.team))
    : new Set()

  const groupKeys = results ? Object.keys(results.groups).sort() : []

  const tabs = results
    ? [
        { key: 'groups', label: lang === 'zh' ? '小组' : 'Groups' },
        { key: 'third', label: lang === 'zh' ? '第三名' : '3rd Place' },
        { key: 'r32', label: 'R32' },
        { key: 'r16', label: 'R16' },
        { key: 'qf', label: lang === 'zh' ? '8强' : 'QF' },
        { key: 'sf', label: lang === 'zh' ? '4强' : 'SF' },
        { key: 'final', label: lang === 'zh' ? '决赛' : 'Final' },
      ]
    : []

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '80px 16px 100px' }}>
      {/* Header */}
      <div style={{
        background: '#1A3A6C',
        borderRadius: 'var(--radius-lg)',
        padding: '20px 24px',
        marginBottom: 20,
      }}>
        <h1 style={{
          fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 24,
          color: '#C9A84C', letterSpacing: '0.04em', margin: 0,
        }}>
          {lang === 'zh' ? '赛事模拟器' : 'Tournament Simulator'}
        </h1>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: 'rgba(255,255,255,0.60)', fontFamily: 'var(--font-ui)' }}>
          {lang === 'zh' ? '迪克森-科尔斯V3 · 蒙特卡洛模拟' : 'Dixon-Coles V3 · Monte Carlo simulation'}
        </p>
      </div>

      {/* Error */}
      {fetchError && (
        <div style={{
          background: 'var(--color-danger-dim)', color: 'var(--color-danger)',
          border: '0.5px solid var(--color-danger)', borderRadius: 'var(--radius-sm)',
          padding: '10px 14px', fontSize: 13, marginBottom: 16,
        }}>
          {lang === 'zh' ? '数据加载失败：' : 'Failed to load data: '}{fetchError}
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--color-text-muted)', fontSize: 14 }}>
          {lang === 'zh' ? '正在加载赛程数据…' : 'Loading fixture data…'}
        </div>
      )}

      {/* CTA buttons */}
      {!loading && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 24 }}>
          {/* Run single simulation */}
          <button
            onClick={handleRunSim}
            disabled={simState === 'running' || fixtures.length === 0}
            style={{
              minHeight: 44, padding: '0 24px',
              background: simState === 'running'
                ? 'var(--color-bg-hover)'
                : simState === 'done'
                  ? 'transparent'
                  : '#C9A84C',
              border: simState === 'done' ? '0.5px solid var(--color-accent-border)' : 'none',
              borderRadius: 'var(--radius-sm)',
              color: simState === 'running'
                ? 'var(--color-text-muted)'
                : simState === 'done'
                  ? 'var(--color-accent)'
                  : '#fff',
              fontFamily: 'var(--font-ui)', fontSize: 14, fontWeight: 600,
              cursor: simState === 'running' ? 'not-allowed' : 'pointer',
              transition: 'all 0.15s',
            }}
          >
            {simState === 'running'
              ? (lang === 'zh' ? '⏳ 模拟中…' : '⏳ Simulating…')
              : simState === 'done'
                ? (lang === 'zh' ? '↺ 再次模拟' : '↺ Run again')
                : (lang === 'zh' ? '▶ 开始模拟' : '▶ Run simulation')}
          </button>

          {/* Monte Carlo button */}
          {fixtures.length > 0 && (
            <button
              onClick={handleMonteCarlo}
              disabled={mcState === 'running'}
              style={{
                minHeight: 44, padding: '0 20px',
                background: 'transparent',
                border: '0.5px solid var(--color-border)',
                borderRadius: 'var(--radius-sm)',
                color: mcState === 'running' ? 'var(--color-text-muted)' : 'var(--color-text-secondary)',
                fontFamily: 'var(--font-ui)', fontSize: 13, fontWeight: 500,
                cursor: mcState === 'running' ? 'not-allowed' : 'pointer',
              }}
            >
              {mcState === 'running'
                ? `${lang === 'zh' ? '计算中' : 'Computing'} ${mcProgress}%`
                : mcState === 'done'
                  ? (lang === 'zh' ? '↺ 重新运行1000次' : '↺ Re-run 1000 simulations')
                  : (lang === 'zh' ? '📊 运行1000次模拟（统计模式）' : '📊 Run 1000 simulations (stats mode)')}
            </button>
          )}

          {fixtures.length === 0 && !loading && (
            <span style={{ fontSize: 13, color: 'var(--color-text-muted)', alignSelf: 'center' }}>
              {lang === 'zh' ? '暂无赛程数据' : 'No fixture data available'}
            </span>
          )}
        </div>
      )}

      {/* MC progress bar */}
      {mcState === 'running' && (
        <div style={{
          height: 4, background: 'var(--color-bg-hover)',
          borderRadius: 2, marginBottom: 16, overflow: 'hidden',
        }}>
          <div style={{
            height: '100%', width: `${mcProgress}%`,
            background: '#534AB7', transition: 'width 0.1s',
          }} />
        </div>
      )}

      {/* ── Simulation results ── */}
      {results && (
        <>
          {/* Podium */}
          <div style={{
            display: 'flex', gap: 10, marginBottom: 20, alignItems: 'stretch',
          }}>
            <PodiumCard
              medal="🥈"
              team={results.runnerUp}
              score={`Final: ${results.rounds.final.hg}–${results.rounds.final.ag}${results.rounds.final.pens ? ' (pens)' : ''}`}
            />
            <PodiumCard
              medal="🏆"
              team={results.champion}
              score={`${lang === 'zh' ? '决赛胜 ' : 'Final vs '}${results.runnerUp}`}
            />
            <PodiumCard
              medal="🥉"
              team={results.third}
              score={`3rd Place playoff`}
            />
          </div>

          {/* Share */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
            <button
              onClick={handleCopy}
              style={{
                minHeight: 36, padding: '0 14px',
                background: 'transparent',
                border: '0.5px solid var(--color-border)',
                borderRadius: 'var(--radius-sm)',
                color: copied ? 'var(--color-success)' : 'var(--color-text-muted)',
                fontFamily: 'var(--font-ui)', fontSize: 12, cursor: 'pointer',
              }}
            >
              {copied
                ? (lang === 'zh' ? '✓ 已复制!' : '✓ Copied!')
                : (lang === 'zh' ? '📋 复制结果' : '📋 Copy result')}
            </button>
          </div>

          {/* Tab bar */}
          <div style={{
            display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16,
            overflowX: 'auto', paddingBottom: 4,
          }}>
            {tabs.map(tab => (
              <TabButton
                key={tab.key}
                label={tab.label}
                active={activeTab === tab.key}
                onClick={() => setActiveTab(tab.key)}
              />
            ))}
          </div>

          {/* ── GROUPS TAB ── */}
          {activeTab === 'groups' && (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))',
              gap: 12,
            }}>
              {groupKeys.map(g => (
                <GroupCard
                  key={g}
                  groupName={g}
                  table={results.groups[g].table}
                  thirdAdvancedSet={thirdAdvancedSet}
                />
              ))}
            </div>
          )}

          {/* ── 3RD PLACE TAB ── */}
          {activeTab === 'third' && (
            <div style={{
              background: 'var(--color-bg-secondary)',
              border: '0.5px solid var(--color-border)',
              borderRadius: 'var(--radius-lg)',
              overflow: 'hidden',
            }}>
              <div style={{
                display: 'grid', gridTemplateColumns: '1fr 1fr',
                gap: 0,
              }}>
                {results.thirdPlace.map((row, idx) => {
                  const advances = idx < 8
                  return (
                    <div key={row.team} style={{
                      display: 'flex', gap: 8, alignItems: 'center',
                      padding: '8px 12px',
                      borderBottom: '0.5px solid var(--color-border)',
                      borderRight: idx % 2 === 0 ? '0.5px solid var(--color-border)' : 'none',
                      background: advances ? 'rgba(45,122,79,0.04)' : 'rgba(180,40,40,0.03)',
                    }}>
                      <span style={{ fontSize: 11, color: 'var(--color-text-muted)', minWidth: 16 }}>
                        {idx + 1}
                      </span>
                      <span style={{
                        fontSize: 10, fontWeight: 700, letterSpacing: '0.04em',
                        padding: '1px 5px', borderRadius: 3, flexShrink: 0,
                        background: advances ? 'var(--color-success-dim)' : 'var(--color-danger-dim)',
                        color: advances ? 'var(--color-success)' : 'var(--color-danger)',
                      }}>
                        {row.group}
                      </span>
                      <span style={{
                        flex: 1, fontFamily: 'var(--font-ui)', fontSize: 12, fontWeight: advances ? 500 : 400,
                        color: advances ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {getFlag(row.team)} {row.team}
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--color-text-muted)', minWidth: 22, textAlign: 'right' }}>
                        {row.pts}
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--color-text-muted)', minWidth: 28, textAlign: 'right' }}>
                        {row.gd >= 0 ? '+' : ''}{row.gd}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* ── KNOCKOUT ROUND TABS ── */}
          {activeTab === 'r32' && <RoundTab matches={results.rounds.r32} />}
          {activeTab === 'r16' && <RoundTab matches={results.rounds.r16} />}
          {activeTab === 'qf' && <RoundTab matches={results.rounds.qf} />}
          {activeTab === 'sf' && <RoundTab matches={results.rounds.sf} />}

          {/* ── FINAL TAB ── */}
          {activeTab === 'final' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {/* Final */}
              <div style={{
                background: 'rgba(201,168,76,0.06)',
                border: '0.5px solid #C9A84C',
                borderRadius: 'var(--radius-lg)',
                overflow: 'hidden',
              }}>
                <div style={{
                  background: '#1A3A6C', padding: '8px 16px',
                  fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 13,
                  color: '#C9A84C', letterSpacing: '0.06em',
                }}>
                  {lang === 'zh' ? '🏆 决赛' : '🏆 FINAL'}
                </div>
                {(() => {
                  const m = results.rounds.final
                  const champHome = m.winner === m.home
                  return (
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 12, padding: '20px 24px',
                    }}>
                      <span style={{
                        flex: 1, fontFamily: 'var(--font-display)', fontSize: 17, fontWeight: champHome ? 600 : 400,
                        color: champHome ? '#C9A84C' : 'var(--color-text-muted)',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {getFlag(m.home)} {m.home} {champHome ? '🏆' : ''}
                      </span>
                      <span style={{
                        fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 22,
                        color: 'var(--color-text-primary)', flexShrink: 0,
                      }}>
                        {m.hg}–{m.ag}{m.pens ? ' (P)' : ''}
                      </span>
                      <span style={{
                        flex: 1, fontFamily: 'var(--font-display)', fontSize: 17, fontWeight: !champHome ? 600 : 400,
                        color: !champHome ? '#C9A84C' : 'var(--color-text-muted)',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'right',
                      }}>
                        {!champHome ? '🏆' : ''} {m.away} {getFlag(m.away)}
                      </span>
                      {m.actual && <ActualBadge />}
                    </div>
                  )
                })()}
              </div>

              {/* Bronze */}
              <div style={{
                background: 'var(--color-bg-secondary)',
                border: '0.5px solid var(--color-border)',
                borderRadius: 'var(--radius-lg)',
                overflow: 'hidden',
              }}>
                <div style={{
                  background: 'var(--color-bg-hover)', padding: '7px 14px',
                  fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 12,
                  color: 'var(--color-text-muted)', letterSpacing: '0.05em',
                }}>
                  {lang === 'zh' ? '🥉 三四名决赛' : '🥉 THIRD PLACE PLAYOFF'}
                </div>
                <MatchRow m={results.rounds.bronze} />
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Monte Carlo results ── */}
      {mcResults && (
        <div style={{ marginTop: 32 }}>
          <h2 style={{
            fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 17,
            color: 'var(--color-text-primary)', marginBottom: 12,
          }}>
            {lang === 'zh' ? '📊 夺冠概率（1000次模拟）' : '📊 Win Probabilities (1,000 simulations)'}
          </h2>
          <div style={{
            background: 'var(--color-bg-secondary)',
            border: '0.5px solid var(--color-border)',
            borderRadius: 'var(--radius-lg)',
            overflow: 'hidden',
          }}>
            <div style={{
              display: 'grid', gridTemplateColumns: '1fr 68px 68px 68px',
              padding: '7px 14px',
              background: 'var(--color-bg-hover)',
              borderBottom: '0.5px solid var(--color-border)',
              fontSize: 11, fontWeight: 700, color: 'var(--color-text-muted)',
              letterSpacing: '0.04em', fontFamily: 'var(--font-ui)',
            }}>
              <span>{lang === 'zh' ? '球队' : 'TEAM'}</span>
              <span style={{ textAlign: 'right' }}>WIN%</span>
              <span style={{ textAlign: 'right' }}>FINAL%</span>
              <span style={{ textAlign: 'right' }}>SF%</span>
            </div>
            {mcResults.map((row, i) => (
              <div key={row.team} style={{
                display: 'grid', gridTemplateColumns: '1fr 68px 68px 68px',
                padding: '7px 14px',
                borderBottom: '0.5px solid var(--color-border)',
                background: i < 4 ? 'rgba(201,168,76,0.04)' : 'transparent',
              }}>
                <span style={{
                  fontFamily: 'var(--font-ui)', fontSize: 13, fontWeight: i < 4 ? 500 : 400,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  color: i < 4 ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
                }}>
                  {i + 1}. {getFlag(row.team)} {row.team}
                </span>
                <span style={{
                  textAlign: 'right', fontSize: 13, fontWeight: 600,
                  color: i < 4 ? '#C9A84C' : 'var(--color-text-secondary)',
                }}>
                  {row.winPct}%
                </span>
                <span style={{ textAlign: 'right', fontSize: 13, color: 'var(--color-text-muted)' }}>
                  {row.finalPct}%
                </span>
                <span style={{ textAlign: 'right', fontSize: 13, color: 'var(--color-text-muted)' }}>
                  {row.sfPct}%
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
