import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useUser } from '../context/UserContext'
import { setLanguage, useTranslation } from '../lib/i18n'
import { getFlag } from '../lib/teamFlags'

const GROUPS = ['A','B','C','D','E','F','G','H','I','J','K','L']

const STAGE_ORDER = { r32: 1, r16: 2, qf: 3, sf: 4, bronze: 5, final: 6 }
const STAGE_LABELS = {
  r32: 'Round of 32 · 32强',
  r16: 'Round of 16 · 16强',
  qf: 'Quarterfinal · 四分之一决赛',
  sf: 'Semifinal · 半决赛',
  bronze: 'Bronze Final · 季军赛',
  final: 'Final · 决赛',
}

function calcStandings(matches) {
  const allTeams = [...new Set(matches.flatMap(m => [m.home_team, m.away_team]).filter(n => n && n !== 'TBD'))]
  const table = {}
  for (const t of allTeams) table[t] = { team: t, mp: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 }
  for (const m of matches) {
    if (m.status !== 'finished' || m.home_score == null || m.away_score == null) continue
    const h = Number(m.home_score), a = Number(m.away_score)
    const ht = table[m.home_team], at = table[m.away_team]
    if (!ht || !at) continue
    ht.mp++; ht.gf += h; ht.ga += a
    if (h > a)       { ht.w++; ht.pts += 3 }
    else if (h === a){ ht.d++; ht.pts += 1 }
    else               ht.l++
    at.mp++; at.gf += a; at.ga += h
    if (a > h)       { at.w++; at.pts += 3 }
    else if (a === h){ at.d++; at.pts += 1 }
    else               at.l++
  }
  return Object.values(table)
    .map(s => ({ ...s, gd: s.gf - s.ga }))
    .sort((a, b) => b.pts - a.pts || (b.gd - a.gd) || (b.gf - a.gf))
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

export default function AdminKnockout() {
  const { tier } = useUser()
  const navigate = useNavigate()
  const { lang } = useTranslation()

  const [groupMatches, setGroupMatches] = useState([])
  const [knockoutMatches, setKnockoutMatches] = useState([])
  const [loading, setLoading] = useState(true)
  const [saves, setSaves] = useState({})
  const [allTeams, setAllTeams] = useState([])

  useEffect(() => {
    if (tier !== 'admin') { navigate('/'); return }
    load()
  }, [tier, navigate])

  async function load() {
    setLoading(true)
    const [gRes, kRes] = await Promise.all([
      supabase.from('matches').select('*').eq('stage', 'group').order('match_date'),
      supabase.from('matches').select('*').neq('stage', 'group').order('match_date'),
    ])
    const gm = gRes.data || []
    const km = kRes.data || []
    setGroupMatches(gm)
    setKnockoutMatches(km)

    const teams = [...new Set(gm.flatMap(m => [m.home_team, m.away_team]).filter(n => n && n !== 'TBD'))].sort()
    setAllTeams(teams)

    const init = {}
    for (const m of km) {
      init[m.id] = {
        home: m.home_team === 'TBD' ? '' : (m.home_team || ''),
        away: m.away_team === 'TBD' ? '' : (m.away_team || ''),
        saving: false, saved: false, error: null,
      }
    }
    setSaves(init)
    setLoading(false)
  }

  // Group standings by group
  const byGroup = {}
  for (const m of groupMatches) {
    if (!m.group_name) continue
    if (!byGroup[m.group_name]) byGroup[m.group_name] = []
    byGroup[m.group_name].push(m)
  }
  const standings = {}
  for (const [g, gm] of Object.entries(byGroup)) standings[g] = calcStandings(gm)

  // Third place tracker
  const thirdPlace = GROUPS.filter(g => standings[g]?.length >= 3)
    .map(g => ({ group: g, ...standings[g][2] }))
    .sort((a, b) => b.pts - a.pts || (b.gd - a.gd) || (b.gf - a.gf))

  // Team code lookup from group matches
  function getTeamCode(teamName) {
    if (!teamName) return ''
    const m = groupMatches.find(m => m.home_team === teamName || m.away_team === teamName)
    if (!m) return teamName.slice(0, 3).toUpperCase()
    return m.home_team === teamName ? (m.home_team_code || '') : (m.away_team_code || '')
  }

  async function saveMatch(matchId) {
    const s = saves[matchId]
    if (!s?.home || !s?.away) return
    setSaves(p => ({ ...p, [matchId]: { ...p[matchId], saving: true, error: null } }))
    const res = await adminPost('update_knockout_match', {
      matchId,
      homeTeam: s.home, awayTeam: s.away,
      homeTeamCode: getTeamCode(s.home),
      awayTeamCode: getTeamCode(s.away),
    })
    setSaves(p => ({ ...p, [matchId]: { ...p[matchId], saving: false, saved: !!res.ok, error: res.error || null } }))
    if (res.ok) setTimeout(() => setSaves(p => ({ ...p, [matchId]: { ...p[matchId], saved: false } })), 2500)
  }

  // Group knockout matches by stage
  const stageGroups = {}
  for (const m of knockoutMatches) {
    const stage = m.stage || 'unknown'
    if (!stageGroups[stage]) stageGroups[stage] = []
    stageGroups[stage].push(m)
  }
  const stageOrder = Object.keys(stageGroups).sort((a, b) => (STAGE_ORDER[a] || 99) - (STAGE_ORDER[b] || 99))

  // Styles
  const card = { background: 'var(--color-bg-card)', border: '0.5px solid var(--color-border)', borderRadius: 'var(--radius-lg)', padding: '20px', marginBottom: 20 }
  const SH = { fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--color-accent)', textTransform: 'uppercase', borderBottom: '1px solid var(--color-accent)', paddingBottom: 6, marginBottom: 14, display: 'block' }
  const thS = { textAlign: 'left', padding: '6px 10px', fontSize: 11, fontWeight: 700, color: 'var(--color-text-muted)', borderBottom: '0.5px solid var(--color-border)', whiteSpace: 'nowrap' }
  const tdS = { padding: '8px 10px', fontSize: 13, borderBottom: '0.5px solid var(--color-border-light)', verticalAlign: 'middle' }
  const selS = { fontSize: 16, minHeight: 44, padding: '0 10px', borderRadius: 'var(--radius-sm)', background: 'var(--color-bg)', color: 'var(--color-text-primary)', border: '0.5px solid var(--color-border-active)', cursor: 'pointer', width: '100%' }

  if (loading) return (
    <div style={{ padding: 40, textAlign: 'center', color: 'var(--color-text-muted)' }}>
      {lang === 'en' ? 'Loading...' : '加载中...'}
    </div>
  )

  return (
    <div>
      {/* Navy header */}
      <div style={{ background: '#1A3A6C', padding: '16px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 800, color: '#fff', margin: 0 }}>
          {lang === 'en' ? 'Knockout Stage Manager' : '淘汰赛管理'}
        </h1>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          {[['en','EN'],['zh','中文']].map(([code, label], i) => (
            <span key={code} style={{ display: 'flex', alignItems: 'center' }}>
              {i > 0 && <span style={{ color: 'rgba(255,255,255,0.30)', fontSize: 13, margin: '0 4px' }}>|</span>}
              <button onClick={() => setLanguage(code)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px 6px', fontSize: 13, fontWeight: 700, fontFamily: 'var(--font-ui)', color: lang === code ? 'var(--color-accent)' : 'rgba(255,255,255,0.40)' }}>
                {label}
              </button>
            </span>
          ))}
        </div>
      </div>

      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '24px 16px' }}>

        {/* SECTION A: Group standings */}
        <div style={card}>
          <span style={SH}>{lang === 'en' ? 'Group Standings' : '小组赛积分榜'}</span>
          {Object.keys(standings).length === 0 ? (
            <p style={{ fontSize: 14, color: 'var(--color-text-muted)' }}>
              {lang === 'en' ? 'Group standings will appear here after matches are played.' : '赛事结算后显示积分榜。'}
            </p>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
              {GROUPS.filter(g => standings[g]).map(g => (
                <div key={g} style={{ background: 'var(--color-bg-secondary)', borderRadius: 'var(--radius-sm)', padding: '10px 12px' }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--color-accent)', letterSpacing: '0.08em', marginBottom: 6 }}>GROUP {g}</div>
                  {standings[g].map((r, i) => (
                    <div key={r.team} style={{ display: 'flex', gap: 6, fontSize: 12, padding: '2px 0', color: i < 2 ? 'var(--color-success)' : i === 2 ? 'var(--color-text-secondary)' : 'var(--color-text-muted)' }}>
                      <span style={{ width: 14, flexShrink: 0 }}>{i + 1}.</span>
                      <span>{getFlag(r.team)}</span>
                      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.team}</span>
                      <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, flexShrink: 0 }}>{r.pts}pts</span>
                      <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--color-text-muted)', flexShrink: 0, minWidth: 36 }}>
                        {r.gd >= 0 ? '+' : ''}{r.gd}
                      </span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* SECTION B: Third-place tracker */}
        {thirdPlace.length > 0 && (
          <div style={card}>
            <span style={SH}>{lang === 'en' ? 'Best Third-Place Teams' : '最佳第三名排名'}</span>
            <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 12 }}>
              {lang === 'en' ? 'Top 8 advance to Round of 32' : '前8名晋级32强'}
            </p>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={thS}>#</th>
                    <th style={thS}>{lang === 'en' ? 'Team' : '球队'}</th>
                    <th style={thS}>{lang === 'en' ? 'Group' : '小组'}</th>
                    <th style={{ ...thS, textAlign: 'center' }}>Pts</th>
                    <th style={{ ...thS, textAlign: 'center' }}>GD</th>
                    <th style={{ ...thS, textAlign: 'center' }}>GF</th>
                    <th style={thS}>{lang === 'en' ? 'Status' : '状态'}</th>
                  </tr>
                </thead>
                <tbody>
                  {thirdPlace.map((r, i) => (
                    <tr key={r.team}>
                      <td style={tdS}>{i + 1}</td>
                      <td style={tdS}>{getFlag(r.team)} {r.team}</td>
                      <td style={tdS}>{r.group}</td>
                      <td style={{ ...tdS, textAlign: 'center', fontFamily: "'IBM Plex Mono', monospace" }}>{r.pts}</td>
                      <td style={{ ...tdS, textAlign: 'center', fontFamily: "'IBM Plex Mono', monospace", color: r.gd >= 0 ? 'var(--color-success)' : 'var(--color-danger)' }}>{r.gd >= 0 ? '+' : ''}{r.gd}</td>
                      <td style={{ ...tdS, textAlign: 'center', fontFamily: "'IBM Plex Mono', monospace" }}>{r.gf}</td>
                      <td style={tdS}>
                        <span style={{
                          fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 'var(--radius-sm)',
                          background: i < 8 ? '#EAF3DE' : '#FCEBEB',
                          color: i < 8 ? '#27500A' : '#791F1F',
                        }}>
                          {i < 8
                            ? (lang === 'en' ? '✓ Advances' : '✓ 晋级')
                            : (lang === 'en' ? '✗ Out' : '✗ 淘汰')}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* SECTION C: Knockout bracket assignment */}
        {stageOrder.length === 0 ? (
          <div style={{ ...card, textAlign: 'center', color: 'var(--color-text-muted)', padding: 32 }}>
            {lang === 'en' ? 'No knockout matches found. Seed the fixture schedule first.' : '未找到淘汰赛赛程，请先录入赛程数据。'}
          </div>
        ) : stageOrder.map(stage => (
          <div key={stage} style={card}>
            <span style={SH}>{STAGE_LABELS[stage] || stage}</span>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 600 }}>
                <thead>
                  <tr>
                    <th style={thS}>{lang === 'en' ? 'Date' : '日期'}</th>
                    <th style={thS}>{lang === 'en' ? 'Venue' : '场馆'}</th>
                    <th style={{ ...thS, minWidth: 180 }}>{lang === 'en' ? 'Home Team' : '主队'}</th>
                    <th style={{ ...thS, minWidth: 180 }}>{lang === 'en' ? 'Away Team' : '客队'}</th>
                    <th style={thS}></th>
                  </tr>
                </thead>
                <tbody>
                  {(stageGroups[stage] || []).map(m => {
                    const s = saves[m.id] || { home: '', away: '' }
                    return (
                      <tr key={m.id}>
                        <td style={{ ...tdS, whiteSpace: 'nowrap', fontSize: 12, color: 'var(--color-text-muted)' }}>
                          {new Date(m.match_date).toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai', month: 'short', day: 'numeric' })}
                        </td>
                        <td style={{ ...tdS, fontSize: 12, color: 'var(--color-text-muted)', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {m.venue || '—'}
                        </td>
                        <td style={{ ...tdS, minWidth: 180 }}>
                          <select value={s.home} onChange={e => setSaves(p => ({ ...p, [m.id]: { ...p[m.id], home: e.target.value } }))} style={selS}>
                            <option value="">— {lang === 'en' ? 'Select team' : '选择球队'} —</option>
                            {allTeams.map(t => <option key={t} value={t}>{getFlag(t)} {t}</option>)}
                          </select>
                        </td>
                        <td style={{ ...tdS, minWidth: 180 }}>
                          <select value={s.away} onChange={e => setSaves(p => ({ ...p, [m.id]: { ...p[m.id], away: e.target.value } }))} style={selS}>
                            <option value="">— {lang === 'en' ? 'Select team' : '选择球队'} —</option>
                            {allTeams.map(t => <option key={t} value={t}>{getFlag(t)} {t}</option>)}
                          </select>
                        </td>
                        <td style={{ ...tdS, whiteSpace: 'nowrap' }}>
                          <button
                            onClick={() => saveMatch(m.id)}
                            disabled={!s.home || !s.away || s.saving}
                            style={{
                              padding: '6px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                              border: `0.5px solid ${s.saved ? 'var(--color-success)' : s.error ? 'var(--color-danger)' : 'var(--color-accent)'}`,
                              borderRadius: 'var(--radius-sm)', background: 'transparent',
                              color: s.saved ? 'var(--color-success)' : s.error ? 'var(--color-danger)' : 'var(--color-accent)',
                              fontFamily: 'var(--font-ui)', minHeight: 44, opacity: (!s.home || !s.away) ? 0.4 : 1,
                            }}
                          >
                            {s.saving ? '...' : s.saved ? (lang === 'en' ? '✓ Saved' : '✓ 已保存') : s.error ? '✗ Error' : (lang === 'en' ? 'Save' : '保存')}
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
