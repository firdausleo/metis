import React, { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useTranslation } from '../lib/i18n'

export default function Dashboard() {
  const { lang } = useTranslation()
  const navigate = useNavigate()
  const [matches, setMatches] = useState([])
  const [predictions, setPredictions] = useState([])
  const [bets, setBets] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const [{ data: m }, { data: p }, { data: b }] = await Promise.all([
        supabase.from('matches').select('*').order('match_date'),
        supabase.from('model_predictions').select('*'),
        supabase.from('user_bets').select('*').order('placed_at', { ascending: false }),
      ])
      setMatches(m || [])
      setPredictions(p || [])
      setBets(b || [])
      setLoading(false)
    }
    load()
  }, [])

  const predMap = useMemo(() => {
    const pm = {}
    predictions.forEach(p => { pm[p.match_id] = p })
    return pm
  }, [predictions])

  const modelPerf = useMemo(() => {
    const finished = matches.filter(m => m.status === 'finished' && m.home_score !== null)

    let v3Correct = 0, v3Total = 0

    const details = finished.map(m => {
      const pred = predMap[m.id]
      if (!pred) return null

      const actual = m.home_score > m.away_score ? 'home'
        : m.home_score < m.away_score ? 'away' : 'draw'

      const v3Pred = !pred.v3_home_win ? null
        : pred.v3_home_win > pred.v3_draw && pred.v3_home_win > pred.v3_away_win ? 'home'
        : pred.v3_away_win > pred.v3_draw ? 'away' : 'draw'

      const v3Hit = v3Pred ? v3Pred === actual : false

      if (pred.v3_home_win) { v3Total++; if (v3Hit) v3Correct++ }

      const predProb = actual === 'home' ? pred.v3_home_win
        : actual === 'away' ? pred.v3_away_win : pred.v3_draw

      return { match: m, actual, v3Pred, v3Hit, predProb,
        anchorTotal: pred.anchor_total, topScore: pred.v3_top_score }
    }).filter(Boolean)

    const accuracy = v3Total > 0 ? (v3Correct / v3Total * 100).toFixed(1) : null

    const highProb = details.filter(d => d.predProb > 0.50)
    const calibration = highProb.length > 0
      ? (highProb.filter(d => d.v3Hit).length / highProb.length * 100).toFixed(1) : null

    const anchorDetails = details.filter(d => d.anchorTotal !== null)
    const anchorHit = anchorDetails.filter(d =>
      d.match.home_score + d.match.away_score === d.anchorTotal)
    const anchorAcc = anchorDetails.length > 0
      ? (anchorHit.length / anchorDetails.length * 100).toFixed(1) : null

    return { details, v3Correct, v3Total, accuracy, calibration,
      anchorAcc, anchorTotal: anchorDetails.length, anchorHit: anchorHit.length }
  }, [matches, predMap])

  const trackerSummary = useMemo(() => {
    const settled = bets.filter(b => b.status !== 'pending')
    const pending = bets.filter(b => b.status === 'pending')
    const staked = settled.reduce((s, b) => s + b.stake, 0)
    const returned = settled.reduce((s, b) => s + (b.actual_return || 0), 0)
    const pnl = returned - staked
    const roi = staked > 0 ? (pnl / staked * 100).toFixed(1) : null
    const wins = settled.filter(b => b.status === 'won' || b.status === 'half_won').length
    const pendingStake = pending.reduce((s, b) => s + b.stake, 0)
    return { settled: settled.length, pending: pending.length, staked, returned, pnl, roi, wins, pendingStake }
  }, [bets])

  if (loading) return (
    <div style={{ padding: 24, color: 'var(--color-text-muted)',
      fontFamily: "'IBM Plex Mono', monospace", fontSize: 12 }}>
      Loading dashboard...
    </div>
  )

  function SH({ label }) {
    return (
      <div style={{
        fontSize: 10, fontFamily: "'IBM Plex Mono', monospace",
        fontWeight: 500, letterSpacing: '0.10em', textTransform: 'uppercase',
        color: 'var(--color-text-muted)', marginBottom: 10, marginTop: 24,
      }}>{label}</div>
    )
  }

  const upcoming = matches
    .filter(m => m.status === 'upcoming' && m.home_team !== 'TBD')
    .sort((a, b) => new Date(a.match_date) - new Date(b.match_date))
    .slice(0, 5)

  const recentResults = matches
    .filter(m => m.status === 'finished')
    .sort((a, b) => new Date(b.match_date) - new Date(a.match_date))
    .slice(0, 5)

  return (
    <div style={{ maxWidth: 800, margin: '0 auto', padding: '16px 16px 40px' }}>

      {/* Page title */}
      <div style={{
        fontSize: 18, fontFamily: "'IBM Plex Mono', monospace",
        fontWeight: 600, letterSpacing: '0.10em',
        color: 'var(--color-text-primary)', marginBottom: 2,
      }}>
        {lang === 'zh' ? '总览' : 'DASHBOARD'}
      </div>
      <div style={{
        fontSize: 10, fontFamily: "'IBM Plex Mono', monospace",
        color: 'var(--color-text-muted)', letterSpacing: '0.06em', marginBottom: 4,
      }}>
        WC2026 · {matches.filter(m => m.status === 'finished').length} RESULTS
        {' · '}{matches.filter(m => m.status === 'upcoming').length} UPCOMING
      </div>

      {/* ── SECTION 1: UPCOMING MATCHES ── */}
      <SH label={lang === 'zh' ? '即将开赛' : 'UPCOMING MATCHES'} />

      {upcoming.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--color-text-muted)', padding: '12px 0' }}>
          {lang === 'zh' ? '暂无即将到来的比赛' : 'No upcoming matches'}
        </div>
      ) : upcoming.map(m => {
        const pred = predMap[m.id]
        const bj = new Date(m.match_date).toLocaleString('zh-CN', {
          timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric',
          hour: '2-digit', minute: '2-digit',
        })
        return (
          <div
            key={m.id}
            onClick={() => navigate(`/matches/${m.id}`)}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '10px 14px',
              border: '0.5px solid var(--color-border)',
              borderRadius: 'var(--radius-md)',
              marginBottom: 8, background: 'var(--color-bg-card)',
              cursor: 'pointer', transition: 'border-color 0.15s',
            }}
            onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--color-accent)'}
            onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--color-border)'}
          >
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text-primary)',
                marginBottom: pred?.v3_home_win ? 3 : 0 }}>
                {m.home_team} vs {m.away_team}
              </div>
              {pred?.v3_home_win && (
                <div style={{ fontSize: 10, fontFamily: "'IBM Plex Mono', monospace",
                  color: 'var(--color-text-muted)' }}>
                  {m.home_team}{' '}
                  <strong style={{ color: 'var(--color-blue)' }}>
                    {(pred.v3_home_win * 100).toFixed(0)}%
                  </strong>
                  {' · D '}{(pred.v3_draw * 100).toFixed(0)}%
                  {' · '}{m.away_team}{' '}{(pred.v3_away_win * 100).toFixed(0)}%
                  {pred.anchor_total && (
                    <span style={{ marginLeft: 8, color: 'var(--color-accent)' }}>
                      ⚓{pred.anchor_total}g
                    </span>
                  )}
                </div>
              )}
            </div>
            <div style={{ fontSize: 10, fontFamily: "'IBM Plex Mono', monospace",
              color: 'var(--color-text-muted)', flexShrink: 0, marginLeft: 12, textAlign: 'right' }}>
              {bj}
            </div>
          </div>
        )
      })}

      {/* ── SECTION 2: RECENT RESULTS ── */}
      <SH label={lang === 'zh' ? '最近结果' : 'RECENT RESULTS'} />

      <div style={{ border: '0.5px solid var(--color-border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
        {recentResults.map((m, i) => {
          const pred = predMap[m.id]
          const actual = m.home_score > m.away_score ? 'home'
            : m.home_score < m.away_score ? 'away' : 'draw'
          const v3Pred = pred?.v3_home_win
            ? pred.v3_home_win > pred.v3_draw && pred.v3_home_win > pred.v3_away_win ? 'home'
            : pred.v3_away_win > pred.v3_draw ? 'away' : 'draw'
            : null
          const hit = v3Pred ? v3Pred === actual : null

          return (
            <div key={m.id} style={{
              display: 'flex', alignItems: 'center',
              padding: '10px 14px',
              borderBottom: i < recentResults.length - 1 ? '0.5px solid var(--color-border-light)' : 'none',
              background: 'var(--color-bg-card)',
            }}>
              <span style={{ flex: 1, fontSize: 13, color: 'var(--color-text-primary)' }}>
                {m.home_team} vs {m.away_team}
              </span>
              <span style={{ fontSize: 14, fontWeight: 600,
                fontFamily: "'IBM Plex Mono', monospace",
                color: 'var(--color-text-primary)', marginRight: 12 }}>
                {m.home_score} – {m.away_score}
              </span>
              {hit !== null && (
                <span style={{
                  fontSize: 10, fontFamily: "'IBM Plex Mono', monospace",
                  padding: '2px 6px', borderRadius: 4,
                  background: hit ? 'rgba(45,122,79,0.12)' : 'rgba(192,57,43,0.10)',
                  color: hit ? 'var(--color-success)' : 'var(--color-danger)',
                  fontWeight: 500,
                }}>
                  {hit ? '✓ V3' : '✗ V3'}
                </span>
              )}
            </div>
          )
        })}
      </div>

      {/* ── SECTION 3: MODEL PERFORMANCE ── */}
      <SH label={lang === 'zh' ? '模型表现' : 'MODEL PERFORMANCE'} />

      {modelPerf.v3Total === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--color-text-muted)', padding: '12px 0' }}>
          {lang === 'zh' ? '需要更多比赛数据才能统计模型表现' : 'Need more finished matches to show model performance'}
        </div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8, marginBottom: 16 }}>
            {[
              {
                label: lang === 'zh' ? 'V3 方向准确率' : 'V3 Direction',
                value: modelPerf.accuracy ? `${modelPerf.accuracy}%` : '—',
                sub: `${modelPerf.v3Correct}/${modelPerf.v3Total} correct`,
                color: parseFloat(modelPerf.accuracy) >= 55 ? 'var(--color-success)' : 'var(--color-warning)',
              },
              {
                label: lang === 'zh' ? '高概率准确率' : 'High Prob (>50%)',
                value: modelPerf.calibration ? `${modelPerf.calibration}%` : '—',
                sub: 'when model confident',
                color: parseFloat(modelPerf.calibration) >= 65 ? 'var(--color-success)' : 'var(--color-warning)',
              },
              {
                label: lang === 'zh' ? '锚定进球准确率' : 'Anchor Total',
                value: modelPerf.anchorAcc ? `${modelPerf.anchorAcc}%` : '—',
                sub: `${modelPerf.anchorHit}/${modelPerf.anchorTotal} exact`,
                color: parseFloat(modelPerf.anchorAcc) >= 20 ? 'var(--color-success)' : 'var(--color-warning)',
              },
              {
                label: lang === 'zh' ? '已分析场次' : 'Matches Analyzed',
                value: modelPerf.v3Total,
                sub: 'with V3 predictions',
                color: 'var(--color-text-primary)',
              },
            ].map((card, i) => (
              <div key={i} style={{
                border: '0.5px solid var(--color-border)',
                borderRadius: 'var(--radius-lg)', padding: '12px 14px',
                background: 'var(--color-bg-card)',
              }}>
                <div style={{ fontSize: 10, fontFamily: "'IBM Plex Mono', monospace",
                  color: 'var(--color-text-muted)', letterSpacing: '0.06em',
                  textTransform: 'uppercase', marginBottom: 6 }}>{card.label}</div>
                <div style={{ fontSize: 22, fontWeight: 600,
                  fontFamily: "'IBM Plex Mono', monospace",
                  color: card.color, lineHeight: 1, marginBottom: 4 }}>{card.value}</div>
                <div style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>{card.sub}</div>
              </div>
            ))}
          </div>

          {/* Match-by-match breakdown */}
          <div style={{ border: '0.5px solid var(--color-border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
            <div style={{
              display: 'grid', gridTemplateColumns: '1fr 80px 80px 60px 70px',
              padding: '8px 14px', background: 'var(--color-bg-secondary)',
              borderBottom: '0.5px solid var(--color-border)',
              fontSize: 9, fontFamily: "'IBM Plex Mono', monospace",
              letterSpacing: '0.06em', textTransform: 'uppercase',
              color: 'var(--color-text-muted)', gap: 8,
            }}>
              <span>{lang === 'zh' ? '比赛' : 'Match'}</span>
              <span style={{ textAlign: 'center' }}>{lang === 'zh' ? '结果' : 'Result'}</span>
              <span style={{ textAlign: 'center' }}>{lang === 'zh' ? 'V3预测' : 'V3 Pred'}</span>
              <span style={{ textAlign: 'center' }}>{lang === 'zh' ? '概率' : 'Prob'}</span>
              <span style={{ textAlign: 'center' }}>{lang === 'zh' ? '判断' : 'Verdict'}</span>
            </div>

            {modelPerf.details.map((d, i) => {
              const actualLabel = d.actual === 'home' ? d.match.home_team.slice(0, 8)
                : d.actual === 'away' ? d.match.away_team.slice(0, 8)
                : lang === 'zh' ? '平' : 'Draw'
              const predLabel = d.v3Pred === 'home' ? d.match.home_team.slice(0, 8)
                : d.v3Pred === 'away' ? d.match.away_team.slice(0, 8)
                : lang === 'zh' ? '平' : 'Draw'

              return (
                <div key={d.match.id} style={{
                  display: 'grid', gridTemplateColumns: '1fr 80px 80px 60px 70px',
                  padding: '9px 14px',
                  borderBottom: i < modelPerf.details.length - 1 ? '0.5px solid var(--color-border-light)' : 'none',
                  background: d.v3Hit ? 'rgba(45,122,79,0.03)' : 'transparent',
                  gap: 8, alignItems: 'center',
                }}>
                  <span style={{ fontSize: 12, color: 'var(--color-text-primary)' }}>
                    {d.match.home_team.slice(0, 8)} vs {d.match.away_team.slice(0, 8)}
                    <span style={{ marginLeft: 6, fontSize: 11,
                      fontFamily: "'IBM Plex Mono', monospace",
                      color: 'var(--color-text-muted)' }}>
                      {d.match.home_score}–{d.match.away_score}
                    </span>
                  </span>
                  <span style={{ fontSize: 11, fontFamily: "'IBM Plex Mono', monospace",
                    color: 'var(--color-text-secondary)', textAlign: 'center' }}>
                    {actualLabel}
                  </span>
                  <span style={{ fontSize: 11, fontFamily: "'IBM Plex Mono', monospace",
                    color: 'var(--color-text-secondary)', textAlign: 'center' }}>
                    {predLabel}
                  </span>
                  <span style={{ fontSize: 11, fontFamily: "'IBM Plex Mono', monospace",
                    color: 'var(--color-accent)', textAlign: 'center' }}>
                    {d.predProb ? `${(d.predProb * 100).toFixed(0)}%` : '—'}
                  </span>
                  <span style={{
                    fontSize: 10, fontFamily: "'IBM Plex Mono', monospace",
                    padding: '2px 6px', borderRadius: 4,
                    background: d.v3Hit ? 'rgba(45,122,79,0.12)' : 'rgba(192,57,43,0.10)',
                    color: d.v3Hit ? 'var(--color-success)' : 'var(--color-danger)',
                    fontWeight: 500, textAlign: 'center',
                  }}>
                    {d.v3Hit ? (lang === 'zh' ? '✓ 正确' : '✓ HIT') : (lang === 'zh' ? '✗ 错误' : '✗ MISS')}
                  </span>
                </div>
              )
            })}

            <div style={{
              padding: '10px 14px', background: 'var(--color-bg-secondary)',
              borderTop: '0.5px solid var(--color-border)',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <span style={{ fontSize: 11, fontFamily: "'IBM Plex Mono', monospace",
                color: 'var(--color-text-muted)' }}>
                {lang === 'zh' ? '总计' : 'Total'} {modelPerf.v3Total} {lang === 'zh' ? '场' : 'matches'}
              </span>
              <span style={{ fontSize: 12, fontFamily: "'IBM Plex Mono', monospace",
                fontWeight: 600,
                color: parseFloat(modelPerf.accuracy) >= 55 ? 'var(--color-success)' : 'var(--color-warning)' }}>
                {modelPerf.accuracy}% {lang === 'zh' ? '方向准确率' : 'accuracy'}
              </span>
            </div>
          </div>
        </>
      )}

      {/* ── SECTION 4: TRACKER SUMMARY ── */}
      <SH label={lang === 'zh' ? '追踪摘要' : 'TRACKER SUMMARY'} />

      {trackerSummary.settled === 0 && trackerSummary.pending === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--color-text-muted)', padding: '12px 0' }}>
          {lang === 'zh' ? '暂无追踪记录' : 'No tracked predictions yet'}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8 }}>
          {[
            {
              label: lang === 'zh' ? '已结算' : 'Settled',
              value: trackerSummary.settled,
              sub: `${trackerSummary.wins} won`,
              color: 'var(--color-text-primary)',
            },
            {
              label: lang === 'zh' ? '待结算' : 'Pending',
              value: trackerSummary.pending,
              sub: `¥${trackerSummary.pendingStake} at risk`,
              color: trackerSummary.pending > 0 ? 'var(--color-warning)' : 'var(--color-text-primary)',
            },
            {
              label: 'P&L',
              value: trackerSummary.pnl !== undefined
                ? `${trackerSummary.pnl >= 0 ? '+' : ''}¥${trackerSummary.pnl}` : '—',
              sub: `on ¥${trackerSummary.staked} staked`,
              color: trackerSummary.pnl >= 0 ? 'var(--color-success)' : 'var(--color-danger)',
            },
            {
              label: 'ROI',
              value: trackerSummary.roi ? `${trackerSummary.roi}%` : '—',
              sub: 'settled bets only',
              color: parseFloat(trackerSummary.roi) >= 0 ? 'var(--color-success)' : 'var(--color-danger)',
            },
          ].map((card, i) => (
            <div key={i} onClick={() => navigate('/my-bets')} style={{
              border: '0.5px solid var(--color-border)',
              borderRadius: 'var(--radius-lg)', padding: '12px 14px',
              background: 'var(--color-bg-card)', cursor: 'pointer',
            }}>
              <div style={{ fontSize: 10, fontFamily: "'IBM Plex Mono', monospace",
                color: 'var(--color-text-muted)', letterSpacing: '0.06em',
                textTransform: 'uppercase', marginBottom: 6 }}>{card.label}</div>
              <div style={{ fontSize: 20, fontWeight: 600,
                fontFamily: "'IBM Plex Mono', monospace",
                color: card.color, lineHeight: 1, marginBottom: 4 }}>{card.value}</div>
              <div style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>{card.sub}</div>
            </div>
          ))}
        </div>
      )}

    </div>
  )
}
