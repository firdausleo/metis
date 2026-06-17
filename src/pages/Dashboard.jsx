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
    ;(predictions || []).forEach(p => { pm[p.match_id] = p })
    return pm
  }, [predictions])

  // ── MODEL PERFORMANCE ──────────────────────────────────────────────────
  const modelPerf = useMemo(() => {
    const finished = (matches || []).filter(
      m => m.status === 'finished' && m.home_score !== null
    )

    let v1Correct = 0, v2Correct = 0, v3Correct = 0, total = 0
    let brierSum = 0, rpsSum = 0, brierCount = 0
    let anchorHit = 0, anchorTotal = 0

    const details = finished.map(m => {
      const pred = predMap[m.id]
      if (!pred) return null

      const actual = m.home_score > m.away_score ? 'home'
        : m.home_score < m.away_score ? 'away' : 'draw'

      const v1Pred = (pred.v1_home_win || 0) > (pred.v1_draw || 0) && (pred.v1_home_win || 0) > (pred.v1_away_win || 0)
        ? 'home' : (pred.v1_away_win || 0) > (pred.v1_draw || 0) ? 'away' : 'draw'

      const v2Pred = (pred.v2_home_win || 0) > (pred.v2_draw || 0) && (pred.v2_home_win || 0) > (pred.v2_away_win || 0)
        ? 'home' : (pred.v2_away_win || 0) > (pred.v2_draw || 0) ? 'away' : 'draw'

      const v3Pred = (pred.v3_home_win || 0) > (pred.v3_draw || 0) && (pred.v3_home_win || 0) > (pred.v3_away_win || 0)
        ? 'home' : (pred.v3_away_win || 0) > (pred.v3_draw || 0) ? 'away' : 'draw'

      const v1Hit = v1Pred === actual
      const v2Hit = v2Pred === actual
      const v3Hit = v3Pred === actual

      if (pred.v3_home_win != null) {
        total++
        if (v1Hit) v1Correct++
        if (v2Hit) v2Correct++
        if (v3Hit) v3Correct++

        const Ih = actual === 'home' ? 1 : 0
        const Id = actual === 'draw' ? 1 : 0
        const Ia = actual === 'away' ? 1 : 0
        const hw = pred.v3_home_win || 0
        const dw = pred.v3_draw || 0
        const aw = pred.v3_away_win || 0

        brierSum += Math.pow(hw - Ih, 2) + Math.pow(dw - Id, 2) + Math.pow(aw - Ia, 2)
        rpsSum += 0.5 * (Math.pow(hw - Ih, 2) + Math.pow(hw + dw - Ih - Id, 2))
        brierCount++
      }

      if (pred.anchor_total != null) {
        anchorTotal++
        if (m.home_score + m.away_score === pred.anchor_total) anchorHit++
      }

      const predProb = actual === 'home' ? pred.v3_home_win
        : actual === 'away' ? pred.v3_away_win : pred.v3_draw

      return {
        match: m, actual, v1Pred, v2Pred, v3Pred,
        v1Hit, v2Hit, v3Hit, predProb,
        anchorPred: pred.anchor_total,
        anchorActual: m.home_score + m.away_score,
      }
    }).filter(Boolean)

    return {
      details, total,
      v1Correct, v2Correct, v3Correct,
      v1Acc: total > 0 ? (v1Correct / total * 100).toFixed(1) : null,
      v2Acc: total > 0 ? (v2Correct / total * 100).toFixed(1) : null,
      v3Acc: total > 0 ? (v3Correct / total * 100).toFixed(1) : null,
      avgBrier: brierCount > 0 ? (brierSum / brierCount).toFixed(3) : null,
      avgRps: brierCount > 0 ? (rpsSum / brierCount).toFixed(3) : null,
      anchorHit, anchorTotal,
      anchorAcc: anchorTotal > 0 ? (anchorHit / anchorTotal * 100).toFixed(1) : null,
    }
  }, [matches, predMap])

  // ── TRACKER SUMMARY ────────────────────────────────────────────────────
  const tracker = useMemo(() => {
    const all = bets || []
    const settled = all.filter(b => b.status !== 'pending')
    const pending = all.filter(b => b.status === 'pending')
    const staked = settled.reduce((s, b) => s + (b.stake || 0), 0)
    const returned = settled.reduce((s, b) => s + (b.actual_return || 0), 0)
    const pnl = returned - staked
    const roi = staked > 0 ? (pnl / staked * 100).toFixed(1) : null
    const wins = settled.filter(b => b.status === 'won' || b.status === 'half_won').length
    return {
      settled: settled.length, pending: pending.length, wins, staked, pnl, roi,
      pendingStake: pending.reduce((s, b) => s + (b.stake || 0), 0),
    }
  }, [bets])

  if (loading) return (
    <div style={{
      padding: 24,
      fontFamily: "'IBM Plex Mono', monospace",
      fontSize: 12,
      color: 'var(--color-text-muted)',
    }}>
      {lang === 'zh' ? '加载中...' : 'Loading...'}
    </div>
  )

  const upcoming = (matches || [])
    .filter(m => m.status === 'upcoming')
    .sort((a, b) => new Date(a.match_date) - new Date(b.match_date))
    .slice(0, 6)

  const recentResults = (matches || [])
    .filter(m => m.status === 'finished')
    .sort((a, b) => new Date(b.match_date) - new Date(a.match_date))
    .slice(0, 5)

  const v3Rate = modelPerf.total > 0 ? modelPerf.v3Correct / modelPerf.total : null

  return (
    <div style={{
      maxWidth: 920,
      margin: '0 auto',
      padding: '16px 16px 48px',
    }}>

      {/* ── PAGE HEADER ── */}
      <div style={{
        display: 'flex',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        marginBottom: 16,
      }}>
        <div>
          <div style={{
            fontSize: 13, fontWeight: 500,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            fontFamily: "'IBM Plex Mono', monospace",
            color: 'var(--color-text-primary)',
          }}>
            {lang === 'zh' ? '总览' : 'Dashboard'}
          </div>
          <div style={{
            fontSize: 10,
            fontFamily: "'IBM Plex Mono', monospace",
            color: 'var(--color-text-muted)',
            marginTop: 3, letterSpacing: '0.05em',
          }}>
            WC2026 · {(matches || []).filter(m => m.status === 'finished').length}{' '}
            {lang === 'zh' ? '已完成' : 'played'} ·{' '}
            {(matches || []).filter(m => m.status === 'upcoming').length}{' '}
            {lang === 'zh' ? '即将' : 'upcoming'}
            {modelPerf.total > 0 && ` · V3 `}
            {modelPerf.v3Acc && (
              <span style={{ color: '#C9A84C' }}>{modelPerf.v3Acc}%</span>
            )}
            {modelPerf.total > 0 && ` ${lang === 'zh' ? '准确率' : 'acc'}`}
          </div>
        </div>
        <div style={{
          fontSize: 10,
          fontFamily: "'IBM Plex Mono', monospace",
          color: 'var(--color-text-muted)',
        }}>
          {new Date().toLocaleString('zh-CN', {
            timeZone: 'Asia/Shanghai',
            month: 'numeric', day: 'numeric',
            hour: '2-digit', minute: '2-digit',
          })} BJ
        </div>
      </div>

      {/* ── ROW 1: 3 MODEL KPI CARDS ── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: 10, marginBottom: 10,
      }}>
        {[
          {
            label: lang === 'zh' ? 'V3 方向准确率' : 'V3 Direction Acc',
            value: modelPerf.v3Acc ? `${modelPerf.v3Acc}%` : '—',
            sub: modelPerf.total > 0
              ? `${modelPerf.v3Correct}/${modelPerf.total} ${lang === 'zh' ? '命中' : 'correct'}`
              : lang === 'zh' ? '需要已完成比赛' : 'needs finished matches',
            color: parseFloat(modelPerf.v3Acc) >= 54
              ? '#C9A84C' : 'var(--color-text-primary)',
          },
          {
            label: lang === 'zh' ? 'V3 Brier 分' : 'V3 Brier Score',
            value: modelPerf.avgBrier ?? '—',
            sub: lang === 'zh' ? '越低越好 · 随机≈0.667' : 'lower = better · random ≈ 0.667',
            color: modelPerf.avgBrier != null
              ? (parseFloat(modelPerf.avgBrier) < 0.5 ? '#2D7A4F' : '#BA7517')
              : 'var(--color-text-primary)',
          },
          {
            label: lang === 'zh' ? '锚定总进球准确率' : 'Anchor Total Acc',
            value: modelPerf.anchorAcc ? `${modelPerf.anchorAcc}%` : '—',
            sub: `${modelPerf.anchorHit}/${modelPerf.anchorTotal} ${lang === 'zh' ? '精确' : 'exact'}`,
            color: parseFloat(modelPerf.anchorAcc) >= 20
              ? '#BA7517' : 'var(--color-text-primary)',
          },
        ].map((card, i) => (
          <div key={i} style={{
            background: 'var(--color-bg-secondary)',
            borderRadius: 'var(--radius-md)',
            padding: '10px 14px',
          }}>
            <div style={{
              fontSize: 9, fontWeight: 500,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              fontFamily: "'IBM Plex Mono', monospace",
              color: 'var(--color-text-muted)',
              marginBottom: 6,
            }}>{card.label}</div>
            <div style={{
              fontSize: 20, fontWeight: 500,
              fontFamily: "'IBM Plex Mono', monospace",
              color: card.color, lineHeight: 1,
            }}>{card.value}</div>
            <div style={{
              fontSize: 10, marginTop: 4,
              color: 'var(--color-text-muted)',
            }}>{card.sub}</div>
          </div>
        ))}
      </div>

      {/* ── ROW 2: UPCOMING (wide) + RIGHT COLUMN ── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '2fr 1fr',
        gap: 10, marginBottom: 10,
      }}>

        {/* Upcoming matches panel */}
        <div style={{
          background: 'var(--color-bg-card)',
          border: '0.5px solid var(--color-border)',
          borderRadius: 'var(--radius-lg)',
          overflow: 'hidden',
        }}>
          {/* Today marker */}
          <div style={{
            display: 'flex', alignItems: 'center',
            gap: 8, padding: '7px 14px',
            background: 'var(--color-bg-secondary)',
            borderBottom: '0.5px solid var(--color-border)',
          }}>
            <div style={{
              width: 6, height: 6, borderRadius: '50%',
              background: '#2D7A4F', flexShrink: 0,
            }} />
            <div style={{
              fontSize: 10, letterSpacing: '0.05em',
              fontFamily: "'IBM Plex Mono', monospace",
              color: 'var(--color-text-muted)',
            }}>
              {new Date().toLocaleDateString('zh-CN', {
                timeZone: 'Asia/Shanghai',
                month: 'long', day: 'numeric',
              })}
            </div>
          </div>
          {/* Header */}
          <div style={{
            display: 'flex', alignItems: 'center',
            justifyContent: 'space-between',
            padding: '9px 14px',
            borderBottom: '0.5px solid var(--color-border)',
          }}>
            <span style={{
              fontSize: 9, fontWeight: 500,
              letterSpacing: '0.10em',
              textTransform: 'uppercase',
              fontFamily: "'IBM Plex Mono', monospace",
              color: 'var(--color-text-muted)',
            }}>
              {lang === 'zh' ? '即将开赛' : 'Upcoming Matches'}
            </span>
            <button
              onClick={() => navigate('/matches')}
              style={{
                background: 'none', border: 'none',
                cursor: 'pointer', fontSize: 10,
                fontFamily: "'IBM Plex Mono', monospace",
                color: '#1A3A6C', padding: 0,
                letterSpacing: '0.04em',
              }}
            >
              {lang === 'zh' ? '全部比赛 →' : 'All matches →'}
            </button>
          </div>
          {/* Match list */}
          <div>
            {upcoming.length === 0 ? (
              <div style={{
                padding: '12px 14px', fontSize: 12,
                color: 'var(--color-text-muted)',
              }}>
                {lang === 'zh' ? '暂无即将到来的比赛' : 'No upcoming matches'}
              </div>
            ) : upcoming.map((m, i) => {
              const pred = predMap[m.id]
              const bj = new Date(m.match_date).toLocaleString('zh-CN', {
                timeZone: 'Asia/Shanghai',
                month: 'numeric', day: 'numeric',
                hour: '2-digit', minute: '2-digit',
              })
              return (
                <div
                  key={m.id}
                  onClick={() => navigate(`/matches/${m.id}`)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    padding: '9px 14px',
                    borderBottom: i < upcoming.length - 1
                      ? '0.5px solid var(--color-border-light)'
                      : 'none',
                    cursor: 'pointer',
                    gap: 10,
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--color-bg-secondary)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: 12, fontWeight: 500,
                      color: 'var(--color-text-primary)',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}>
                      {m.home_team} vs {m.away_team}
                    </div>
                    {pred?.v3_home_win != null && (
                      <div style={{
                        fontSize: 10, marginTop: 2,
                        fontFamily: "'IBM Plex Mono', monospace",
                        color: 'var(--color-text-muted)',
                      }}>
                        {m.home_team.slice(0, 3).toUpperCase()}{' '}
                        <span style={{ color: '#1A3A6C', fontWeight: 500 }}>
                          {(pred.v3_home_win * 100).toFixed(0)}%
                        </span>
                        {' · D '}
                        {(pred.v3_draw * 100).toFixed(0)}%
                        {' · '}
                        {m.away_team.slice(0, 3).toUpperCase()}{' '}
                        {(pred.v3_away_win * 100).toFixed(0)}%
                        {pred.anchor_total != null && (
                          <span style={{ marginLeft: 8, color: '#C9A84C' }}>
                            ⚓{pred.anchor_total}g
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  <div style={{
                    fontSize: 10,
                    fontFamily: "'IBM Plex Mono', monospace",
                    color: 'var(--color-text-muted)',
                    flexShrink: 0,
                  }}>
                    {bj}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* RIGHT: Benchmark + Recent results */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

          {/* Benchmark bar panel */}
          <div style={{
            background: 'var(--color-bg-card)',
            border: '0.5px solid var(--color-border)',
            borderRadius: 'var(--radius-lg)',
            overflow: 'hidden',
          }}>
            <div style={{
              display: 'flex', alignItems: 'center',
              justifyContent: 'space-between',
              padding: '9px 14px',
              borderBottom: '0.5px solid var(--color-border)',
            }}>
              <span style={{
                fontSize: 9, fontWeight: 500,
                letterSpacing: '0.10em',
                textTransform: 'uppercase',
                fontFamily: "'IBM Plex Mono', monospace",
                color: 'var(--color-text-muted)',
              }}>
                {lang === 'zh' ? '准确率基准' : 'Accuracy Benchmark'}
              </span>
              <button
                onClick={() => navigate('/model-performance')}
                style={{
                  background: 'none', border: 'none',
                  cursor: 'pointer', fontSize: 10,
                  fontFamily: "'IBM Plex Mono', monospace",
                  color: '#1A3A6C', padding: 0,
                  letterSpacing: '0.04em',
                }}
              >
                {lang === 'zh' ? '完整报告 →' : 'Full report →'}
              </button>
            </div>
            <div style={{ padding: '10px 14px' }}>
              {[
                {
                  label: 'Random',
                  pct: 33.3,
                  color: 'rgba(26,58,108,0.12)',
                  bold: false,
                },
                {
                  label: lang === 'zh' ? '庄家均值' : 'Bookmakers',
                  pct: 54,
                  color: 'rgba(26,58,108,0.35)',
                  bold: false,
                },
                {
                  label: 'V3 live ★',
                  pct: v3Rate != null ? v3Rate * 100 : null,
                  color: '#C9A84C',
                  bold: true,
                },
                {
                  label: lang === 'zh' ? '理论上限' : 'Ceiling',
                  pct: 68, color: null, dashed: true,
                  bold: false,
                },
              ].map((bar, i) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center',
                  gap: 8, marginBottom: 7,
                }}>
                  <div style={{
                    width: 76, fontSize: 10,
                    flexShrink: 0,
                    color: bar.bold ? '#C9A84C' : 'var(--color-text-muted)',
                    fontWeight: bar.bold ? 500 : 400,
                    fontFamily: "'IBM Plex Mono', monospace",
                    letterSpacing: '0.03em',
                  }}>
                    {bar.label}
                  </div>
                  <div style={{
                    flex: 1, height: 12,
                    background: 'var(--color-bg-secondary)',
                    borderRadius: 3, position: 'relative',
                    overflow: 'hidden',
                  }}>
                    {bar.pct != null && !bar.dashed && (
                      <div style={{
                        position: 'absolute',
                        left: 0, top: 0, height: '100%',
                        width: `${Math.min((bar.pct / 70) * 100, 100)}%`,
                        background: bar.color,
                        borderRadius: 3,
                      }} />
                    )}
                    {bar.dashed && (
                      <div style={{
                        position: 'absolute',
                        top: '50%',
                        width: `${Math.min(((bar.pct || 0) / 70) * 100, 100)}%`,
                        borderTop: '1.5px dashed var(--color-border)',
                        transform: 'translateY(-50%)',
                      }} />
                    )}
                  </div>
                  <div style={{
                    width: 40, fontSize: 10,
                    textAlign: 'right', flexShrink: 0,
                    fontFamily: "'IBM Plex Mono', monospace",
                    color: bar.bold ? '#C9A84C' : 'var(--color-text-muted)',
                    fontWeight: bar.bold ? 500 : 400,
                  }}>
                    {bar.pct != null ? `${Number(bar.pct).toFixed(1)}%` : '—'}
                  </div>
                </div>
              ))}
              <div style={{
                fontSize: 9, marginTop: 6,
                fontFamily: "'IBM Plex Mono', monospace",
                color: 'var(--color-text-muted)',
                letterSpacing: '0.03em',
              }}>
                V3 historical 59.4% · DC 65/35 · T=1.11
              </div>
            </div>
          </div>

          {/* Recent results panel */}
          <div style={{
            background: 'var(--color-bg-card)',
            border: '0.5px solid var(--color-border)',
            borderRadius: 'var(--radius-lg)',
            overflow: 'hidden', flex: 1,
          }}>
            <div style={{
              padding: '9px 14px',
              borderBottom: '0.5px solid var(--color-border)',
            }}>
              <span style={{
                fontSize: 9, fontWeight: 500,
                letterSpacing: '0.10em',
                textTransform: 'uppercase',
                fontFamily: "'IBM Plex Mono', monospace",
                color: 'var(--color-text-muted)',
              }}>
                {lang === 'zh' ? '最近结果' : 'Recent Results'}
              </span>
            </div>
            <div>
              {recentResults.map((m, i) => {
                const pred = predMap[m.id]
                const actual = m.home_score > m.away_score ? 'home'
                  : m.home_score < m.away_score ? 'away' : 'draw'
                const v3Pred = pred?.v3_home_win != null
                  ? (pred.v3_home_win > pred.v3_draw && pred.v3_home_win > pred.v3_away_win
                    ? 'home'
                    : pred.v3_away_win > pred.v3_draw ? 'away' : 'draw')
                  : null
                const hit = v3Pred != null ? v3Pred === actual : null
                return (
                  <div key={m.id} style={{
                    display: 'flex',
                    alignItems: 'center',
                    padding: '8px 14px', gap: 8,
                    borderBottom: i < recentResults.length - 1
                      ? '0.5px solid var(--color-border-light)'
                      : 'none',
                  }}>
                    <div style={{
                      flex: 1, fontSize: 11,
                      color: 'var(--color-text-primary)',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}>
                      {m.home_team} vs {m.away_team}
                    </div>
                    <div style={{
                      fontSize: 11, fontWeight: 500,
                      fontFamily: "'IBM Plex Mono', monospace",
                      color: 'var(--color-text-primary)',
                      flexShrink: 0,
                    }}>
                      {m.home_score}–{m.away_score}
                    </div>
                    {hit !== null && (
                      <span style={{
                        fontSize: 9, fontWeight: 500,
                        padding: '1px 5px',
                        borderRadius: 3, flexShrink: 0,
                        fontFamily: "'IBM Plex Mono', monospace",
                        background: hit ? 'rgba(45,122,79,0.12)' : 'rgba(121,31,31,0.10)',
                        color: hit ? '#2D7A4F' : '#791F1F',
                      }}>
                        {hit ? '✓' : '✗'} V3
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>

      {/* ── ROW 3: V1/V2/V3 TABLE + TRACKER ── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '2fr 1fr',
        gap: 10,
      }}>

        {/* Match breakdown table */}
        <div style={{
          background: 'var(--color-bg-card)',
          border: '0.5px solid var(--color-border)',
          borderRadius: 'var(--radius-lg)',
          overflow: 'hidden',
        }}>
          <div style={{
            display: 'flex', alignItems: 'center',
            justifyContent: 'space-between',
            padding: '9px 14px',
            borderBottom: '0.5px solid var(--color-border)',
          }}>
            <span style={{
              fontSize: 9, fontWeight: 500,
              letterSpacing: '0.10em',
              textTransform: 'uppercase',
              fontFamily: "'IBM Plex Mono', monospace",
              color: 'var(--color-text-muted)',
            }}>
              {lang === 'zh' ? 'V1 / V2 / V3 逐场明细' : 'V1 / V2 / V3 Match Breakdown'}
            </span>
            <button
              onClick={() => navigate('/model-performance')}
              style={{
                background: 'none', border: 'none',
                cursor: 'pointer', fontSize: 10,
                fontFamily: "'IBM Plex Mono', monospace",
                color: '#1A3A6C', padding: 0,
                letterSpacing: '0.04em',
              }}
            >
              {lang === 'zh' ? '完整报告 →' : 'Full report →'}
            </button>
          </div>
          <div style={{ padding: '0 14px' }}>
            {modelPerf.details.length === 0 ? (
              <div style={{
                padding: '12px 0', fontSize: 12,
                color: 'var(--color-text-muted)',
                fontStyle: 'italic',
              }}>
                {lang === 'zh' ? '暂无已结算比赛数据' : 'No settled matches yet'}
              </div>
            ) : (
              <>
                {/* Table header */}
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 56px 36px 36px 36px 44px 52px',
                  padding: '8px 0',
                  fontSize: 9, fontWeight: 500,
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  fontFamily: "'IBM Plex Mono', monospace",
                  color: 'var(--color-text-muted)',
                  borderBottom: '0.5px solid var(--color-border)',
                }}>
                  <span>{lang === 'zh' ? '比赛' : 'Match'}</span>
                  <span style={{ textAlign: 'center' }}>{lang === 'zh' ? '比分' : 'Score'}</span>
                  <span style={{ textAlign: 'center' }}>V1</span>
                  <span style={{ textAlign: 'center' }}>V2</span>
                  <span style={{ textAlign: 'center' }}>V3★</span>
                  <span style={{ textAlign: 'right' }}>Prob</span>
                  <span style={{ textAlign: 'center' }}>{lang === 'zh' ? '锚定' : 'Anchor'}</span>
                </div>
                {/* Table rows */}
                {modelPerf.details.slice(0, 6).map((d, i) => {
                  const anchorHit = d.anchorPred != null && d.anchorActual != null
                    && d.anchorPred === d.anchorActual
                  return (
                    <div key={d.match.id} style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 56px 36px 36px 36px 44px 52px',
                      padding: '7px 0',
                      fontSize: 11,
                      borderBottom: i < Math.min(modelPerf.details.length, 6) - 1
                        ? '0.5px solid var(--color-border-light)'
                        : 'none',
                      background: d.v3Hit ? 'rgba(45,122,79,0.02)' : 'transparent',
                      alignItems: 'center',
                    }}>
                      <span style={{
                        fontSize: 11,
                        color: 'var(--color-text-primary)',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}>
                        {d.match.home_team.slice(0, 9)}{' v '}{d.match.away_team.slice(0, 9)}
                      </span>
                      <span style={{
                        textAlign: 'center',
                        fontFamily: "'IBM Plex Mono', monospace",
                        fontWeight: 500,
                        color: 'var(--color-text-primary)',
                      }}>
                        {d.match.home_score}–{d.match.away_score}
                      </span>
                      {[d.v1Hit, d.v2Hit, d.v3Hit].map((hit, ci) => (
                        <span key={ci} style={{
                          textAlign: 'center',
                          fontSize: 12,
                          fontWeight: ci === 2 ? 600 : 400,
                          color: hit ? '#2D7A4F' : '#791F1F',
                        }}>
                          {hit ? '✓' : '✗'}
                        </span>
                      ))}
                      <span style={{
                        textAlign: 'right',
                        fontFamily: "'IBM Plex Mono', monospace",
                        fontSize: 11,
                        color: '#C9A84C',
                      }}>
                        {d.predProb != null ? `${(d.predProb * 100).toFixed(0)}%` : '—'}
                      </span>
                      <span style={{
                        textAlign: 'center',
                        fontSize: 12,
                        color: anchorHit ? '#2D7A4F' : 'var(--color-text-muted)',
                      }}>
                        {d.anchorPred != null ? (anchorHit ? '✓' : `${d.anchorPred}g`) : '—'}
                      </span>
                    </div>
                  )
                })}
                {/* Table footer */}
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '8px 0',
                  borderTop: '0.5px solid var(--color-border)',
                  marginTop: 2,
                }}>
                  <span style={{
                    fontSize: 10,
                    fontFamily: "'IBM Plex Mono', monospace",
                    color: 'var(--color-text-muted)',
                  }}>
                    {modelPerf.total}{' '}
                    {lang === 'zh' ? '场 ·' : 'matches ·'}
                    {' '}Brier{' '}
                    {modelPerf.avgBrier ?? '—'}{' '}
                    · RPS {modelPerf.avgRps ?? '—'}
                  </span>
                  <span style={{ fontSize: 10, fontFamily: "'IBM Plex Mono', monospace" }}>
                    <span style={{ color: 'var(--color-text-muted)' }}>V1 </span>
                    <span style={{ color: '#BA7517' }}>{modelPerf.v1Acc ?? '—'}%</span>
                    <span style={{ color: 'var(--color-text-muted)', marginLeft: 8 }}>V2 </span>
                    <span style={{ color: '#BA7517' }}>{modelPerf.v2Acc ?? '—'}%</span>
                    <span style={{ color: 'var(--color-text-muted)', marginLeft: 8 }}>V3★ </span>
                    <span style={{ color: '#C9A84C', fontWeight: 500 }}>{modelPerf.v3Acc ?? '—'}%</span>
                  </span>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Tracker summary */}
        <div style={{
          background: 'var(--color-bg-card)',
          border: '0.5px solid var(--color-border)',
          borderRadius: 'var(--radius-lg)',
          overflow: 'hidden',
        }}>
          <div style={{
            display: 'flex', alignItems: 'center',
            justifyContent: 'space-between',
            padding: '9px 14px',
            borderBottom: '0.5px solid var(--color-border)',
          }}>
            <span style={{
              fontSize: 9, fontWeight: 500,
              letterSpacing: '0.10em',
              textTransform: 'uppercase',
              fontFamily: "'IBM Plex Mono', monospace",
              color: 'var(--color-text-muted)',
            }}>
              {lang === 'zh' ? '我的追踪器' : 'My Tracker'}
            </span>
            <button
              onClick={() => navigate('/my-bets')}
              style={{
                background: 'none', border: 'none',
                cursor: 'pointer', fontSize: 10,
                fontFamily: "'IBM Plex Mono', monospace",
                color: '#1A3A6C', padding: 0,
                letterSpacing: '0.04em',
              }}
            >
              {lang === 'zh' ? '查看全部 →' : 'View all →'}
            </button>
          </div>
          <div style={{ padding: '10px 14px' }}>
            {tracker.settled === 0 && tracker.pending === 0 ? (
              <div style={{
                fontSize: 12,
                color: 'var(--color-text-muted)',
                fontStyle: 'italic',
                padding: '4px 0',
              }}>
                {lang === 'zh' ? '暂无追踪记录' : 'No tracked predictions yet'}
              </div>
            ) : (
              <div style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: 8,
              }}>
                {[
                  {
                    label: lang === 'zh' ? '已结算' : 'Settled',
                    value: tracker.settled,
                    sub: `${tracker.wins} ${lang === 'zh' ? '赢' : 'won'}`,
                    color: 'var(--color-text-primary)',
                  },
                  {
                    label: lang === 'zh' ? '待结算' : 'Pending',
                    value: tracker.pending,
                    sub: `¥${tracker.pendingStake} at risk`,
                    color: tracker.pending > 0 ? '#BA7517' : 'var(--color-text-primary)',
                  },
                  {
                    label: 'P&L',
                    value: tracker.pnl !== undefined
                      ? `${(tracker.pnl || 0) >= 0 ? '+' : ''}¥${tracker.pnl}`
                      : '—',
                    sub: `${lang === 'zh' ? '已投' : 'on'} ¥${tracker.staked}`,
                    color: (tracker.pnl || 0) >= 0 ? '#2D7A4F' : '#791F1F',
                  },
                  {
                    label: 'ROI',
                    value: tracker.roi ? `${tracker.roi}%` : '—',
                    sub: lang === 'zh' ? '仅计已结算' : 'settled only',
                    color: parseFloat(tracker.roi || 0) >= 0 ? '#2D7A4F' : '#791F1F',
                  },
                ].map((c, i) => (
                  <div
                    key={i}
                    onClick={() => navigate('/my-bets')}
                    style={{
                      background: 'var(--color-bg-secondary)',
                      borderRadius: 'var(--radius-md)',
                      padding: '10px 12px',
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{
                      fontSize: 9, fontWeight: 500,
                      letterSpacing: '0.08em',
                      textTransform: 'uppercase',
                      fontFamily: "'IBM Plex Mono', monospace",
                      color: 'var(--color-text-muted)',
                      marginBottom: 5,
                    }}>{c.label}</div>
                    <div style={{
                      fontSize: 18, fontWeight: 500,
                      fontFamily: "'IBM Plex Mono', monospace",
                      color: c.color, lineHeight: 1,
                    }}>{c.value}</div>
                    <div style={{
                      fontSize: 10, marginTop: 3,
                      color: 'var(--color-text-muted)',
                    }}>{c.sub}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

      </div>

    </div>
  )
}
