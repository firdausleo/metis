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
    <div style={{ padding: 24, fontSize: 12, fontFamily: "'IBM Plex Mono', monospace",
      color: 'var(--color-text-muted)' }}>
      {lang === 'zh' ? '加载中...' : 'Loading...'}
    </div>
  )

  function SH({ label, sub }) {
    return (
      <div style={{ marginBottom: 10, marginTop: 28 }}>
        <div style={{ fontSize: 10, fontFamily: "'IBM Plex Mono', monospace",
          fontWeight: 500, letterSpacing: '0.10em', textTransform: 'uppercase',
          color: 'var(--color-text-muted)' }}>{label}</div>
        {sub && <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 2 }}>{sub}</div>}
      </div>
    )
  }

  function KCard({ label, value, sub, color, onClick }) {
    return (
      <div onClick={onClick} style={{
        border: '0.5px solid var(--color-border)',
        borderRadius: 'var(--radius-lg)', padding: '12px 14px',
        background: 'var(--color-bg-card)', cursor: onClick ? 'pointer' : 'default',
      }}>
        <div style={{ fontSize: 10, fontFamily: "'IBM Plex Mono', monospace",
          letterSpacing: '0.06em', textTransform: 'uppercase',
          color: 'var(--color-text-muted)', marginBottom: 6 }}>{label}</div>
        <div style={{ fontSize: 22, fontWeight: 600, fontFamily: "'IBM Plex Mono', monospace",
          color: color || 'var(--color-text-primary)', lineHeight: 1, marginBottom: 4 }}>
          {value ?? '—'}
        </div>
        {sub && <div style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>{sub}</div>}
      </div>
    )
  }

  const upcoming = (matches || [])
    .filter(m => m.status === 'upcoming' && m.home_team !== 'TBD')
    .sort((a, b) => new Date(a.match_date) - new Date(b.match_date))
    .slice(0, 5)

  const recentResults = (matches || [])
    .filter(m => m.status === 'finished')
    .sort((a, b) => new Date(b.match_date) - new Date(a.match_date))
    .slice(0, 6)

  const finished = (matches || []).filter(m => m.status === 'finished').length
  const upcomingCount = (matches || []).filter(m => m.status === 'upcoming').length

  return (
    <div style={{ maxWidth: 820, margin: '0 auto', padding: '16px 16px 48px' }}>

      {/* Page header */}
      <div style={{ fontSize: 18, fontFamily: "'IBM Plex Mono', monospace",
        fontWeight: 600, letterSpacing: '0.10em',
        color: 'var(--color-text-primary)', marginBottom: 2 }}>
        {lang === 'zh' ? '总览' : 'DASHBOARD'}
      </div>
      <div style={{ fontSize: 10, fontFamily: "'IBM Plex Mono', monospace",
        color: 'var(--color-text-muted)', letterSpacing: '0.06em', marginBottom: 8 }}>
        WC2026 · {finished} RESULTS · {upcomingCount} UPCOMING
        {modelPerf.total > 0 && ` · V3 ${modelPerf.v3Acc}% ACC`}
      </div>

      {/* ═══ SECTION 1: UPCOMING MATCHES ═══ */}
      <SH
        label={lang === 'zh' ? '即将开赛' : 'UPCOMING MATCHES'}
        sub={lang === 'zh' ? '点击查看分析' : 'Click to analyze'}
      />
      {upcoming.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--color-text-muted)', padding: '8px 0' }}>
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
              marginBottom: 8, background: 'var(--color-bg-card)', cursor: 'pointer',
            }}
            onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--color-accent)'}
            onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--color-border)'}
          >
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 500,
                color: 'var(--color-text-primary)', marginBottom: pred?.v3_home_win ? 3 : 0 }}>
                {m.home_team} vs {m.away_team}
              </div>
              {pred?.v3_home_win != null && (
                <div style={{ fontSize: 10, fontFamily: "'IBM Plex Mono', monospace",
                  color: 'var(--color-text-muted)' }}>
                  <strong style={{ color: 'var(--color-blue)' }}>
                    {(pred.v3_home_win * 100).toFixed(0)}%
                  </strong>
                  {' · D '}{(pred.v3_draw * 100).toFixed(0)}%
                  {' · '}{(pred.v3_away_win * 100).toFixed(0)}%
                  {pred.anchor_total != null && (
                    <span style={{ marginLeft: 8, color: 'var(--color-accent)' }}>
                      ⚓ {pred.anchor_total}g
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

      {/* ═══ SECTION 2: RECENT RESULTS ═══ */}
      <SH label={lang === 'zh' ? '最近结果' : 'RECENT RESULTS'} />
      <div style={{ border: '0.5px solid var(--color-border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
        {recentResults.length === 0 ? (
          <div style={{ padding: '12px 14px', fontSize: 12, color: 'var(--color-text-muted)' }}>
            {lang === 'zh' ? '暂无结果' : 'No results yet'}
          </div>
        ) : recentResults.map((m, i) => {
          const pred = predMap[m.id]
          const actual = m.home_score > m.away_score ? 'home'
            : m.home_score < m.away_score ? 'away' : 'draw'
          const v3Pred = pred?.v3_home_win != null
            ? pred.v3_home_win > pred.v3_draw && pred.v3_home_win > pred.v3_away_win ? 'home'
            : pred.v3_away_win > pred.v3_draw ? 'away' : 'draw'
            : null
          const hit = v3Pred != null ? v3Pred === actual : null

          return (
            <div key={m.id} style={{
              display: 'flex', alignItems: 'center', padding: '9px 14px',
              borderBottom: i < recentResults.length - 1 ? '0.5px solid var(--color-border-light)' : 'none',
              background: 'var(--color-bg-card)',
            }}>
              <span style={{ flex: 1, fontSize: 12, color: 'var(--color-text-primary)' }}>
                {m.home_team} vs {m.away_team}
              </span>
              <span style={{ fontSize: 13, fontWeight: 600, fontFamily: "'IBM Plex Mono', monospace",
                color: 'var(--color-text-primary)', marginRight: 10 }}>
                {m.home_score} – {m.away_score}
              </span>
              {hit !== null && (
                <span style={{
                  fontSize: 9, fontFamily: "'IBM Plex Mono', monospace",
                  padding: '2px 6px', borderRadius: 4,
                  background: hit ? 'rgba(45,122,79,0.12)' : 'rgba(192,57,43,0.10)',
                  color: hit ? 'var(--color-success)' : 'var(--color-danger)', fontWeight: 500,
                }}>
                  {hit ? '✓ V3' : '✗ V3'}
                </span>
              )}
            </div>
          )
        })}
      </div>

      {/* ═══ SECTION 3: MODEL PERFORMANCE ═══ */}
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10, marginTop: 28 }}>
        <div>
          <div style={{ fontSize: 10, fontFamily: "'IBM Plex Mono', monospace", fontWeight: 500,
            letterSpacing: '0.10em', textTransform: 'uppercase', color: 'var(--color-text-muted)' }}>
            {lang === 'zh' ? '模型表现' : 'MODEL PERFORMANCE'}
          </div>
          <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 2 }}>
            {modelPerf.total > 0
              ? `${modelPerf.total} matches analyzed · Benchmarks: Random 33% · Bookmakers ~54%`
              : lang === 'zh' ? '需要有V3预测的已完成比赛' : 'Requires finished matches with V3 predictions'}
          </div>
        </div>
        <button
          onClick={() => navigate('/model-performance')}
          style={{
            background: 'none', border: 'none', cursor: 'pointer', fontSize: 11,
            fontFamily: "'IBM Plex Mono', monospace", color: 'var(--color-blue)',
            padding: 0, letterSpacing: '0.04em', flexShrink: 0, marginLeft: 12,
          }}
        >
          {lang === 'zh' ? '完整报告 →' : 'Full report →'}
        </button>
      </div>

      {modelPerf.total === 0 ? (
        <div style={{ padding: '16px', border: '0.5px solid var(--color-border)',
          borderRadius: 'var(--radius-lg)', fontSize: 12, color: 'var(--color-text-muted)' }}>
          {lang === 'zh'
            ? '在比赛分析页面获取统计数据后，模型表现数据将显示在此处。'
            : 'Fetch stats on match analysis pages to populate model performance data here.'}
        </div>
      ) : (
        <>
          {/* Row 1 — direction accuracy */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8, marginBottom: 8 }}>
            <KCard
              label='V1 Direction'
              value={modelPerf.v1Acc ? `${modelPerf.v1Acc}%` : '—'}
              sub={`${modelPerf.v1Correct}/${modelPerf.total} correct`}
              color={parseFloat(modelPerf.v1Acc) >= 55 ? 'var(--color-success)' : 'var(--color-warning)'}
            />
            <KCard
              label='V2 Direction'
              value={modelPerf.v2Acc ? `${modelPerf.v2Acc}%` : '—'}
              sub={`${modelPerf.v2Correct}/${modelPerf.total} correct`}
              color={parseFloat(modelPerf.v2Acc) >= 55 ? 'var(--color-success)' : 'var(--color-warning)'}
            />
            <KCard
              label='V3 Direction ⭐'
              value={modelPerf.v3Acc ? `${modelPerf.v3Acc}%` : '—'}
              sub={`${modelPerf.v3Correct}/${modelPerf.total} correct`}
              color={parseFloat(modelPerf.v3Acc) >= 55 ? 'var(--color-success)' : 'var(--color-warning)'}
            />
          </div>

          {/* Row 2 — calibration */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8, marginBottom: 16 }}>
            <KCard
              label='V3 Brier Score'
              value={modelPerf.avgBrier ?? '—'}
              sub='lower = better · random ≈ 0.667'
              color={parseFloat(modelPerf.avgBrier) < 0.35 ? 'var(--color-success)' : 'var(--color-warning)'}
            />
            <KCard
              label='V3 RPS'
              value={modelPerf.avgRps ?? '—'}
              sub='lower = better · random ≈ 0.227'
              color={parseFloat(modelPerf.avgRps) < 0.20 ? 'var(--color-success)' : 'var(--color-warning)'}
            />
            <KCard
              label={lang === 'zh' ? '锚定总进球准确率' : 'Anchor Total Acc'}
              value={modelPerf.anchorAcc ? `${modelPerf.anchorAcc}%` : '—'}
              sub={`${modelPerf.anchorHit}/${modelPerf.anchorTotal} exact`}
              color={parseFloat(modelPerf.anchorAcc) >= 20 ? 'var(--color-success)' : 'var(--color-warning)'}
            />
            <KCard
              label={lang === 'zh' ? '已分析场次' : 'Matches'}
              value={modelPerf.total}
              sub='with V3 predictions'
            />
          </div>

          {/* Match-by-match breakdown table */}
          <div style={{ border: '0.5px solid var(--color-border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
            <div style={{
              display: 'grid', gridTemplateColumns: '1fr 60px 55px 55px 55px 55px 65px',
              padding: '7px 14px', background: 'var(--color-bg-secondary)',
              borderBottom: '0.5px solid var(--color-border)',
              fontSize: 9, fontFamily: "'IBM Plex Mono', monospace",
              letterSpacing: '0.06em', textTransform: 'uppercase',
              color: 'var(--color-text-muted)', gap: 4,
            }}>
              <span>Match</span>
              <span style={{ textAlign: 'center' }}>Score</span>
              <span style={{ textAlign: 'center' }}>V1</span>
              <span style={{ textAlign: 'center' }}>V2</span>
              <span style={{ textAlign: 'center' }}>V3 ⭐</span>
              <span style={{ textAlign: 'center' }}>Prob</span>
              <span style={{ textAlign: 'center' }}>Anchor</span>
            </div>

            {modelPerf.details.map((d, i) => (
              <div key={d.match.id} style={{
                display: 'grid', gridTemplateColumns: '1fr 60px 55px 55px 55px 55px 65px',
                padding: '8px 14px',
                borderBottom: i < modelPerf.details.length - 1 ? '0.5px solid var(--color-border-light)' : 'none',
                background: d.v3Hit ? 'rgba(45,122,79,0.03)' : 'transparent',
                gap: 4, alignItems: 'center',
              }}>
                <span style={{ fontSize: 11, color: 'var(--color-text-primary)' }}>
                  {d.match.home_team.slice(0, 9)} v {d.match.away_team.slice(0, 9)}
                </span>
                <span style={{ fontSize: 11, fontFamily: "'IBM Plex Mono', monospace",
                  color: 'var(--color-text-secondary)', textAlign: 'center' }}>
                  {d.match.home_score}–{d.match.away_score}
                </span>
                <span style={{ textAlign: 'center', fontSize: 12, color: d.v1Hit ? 'var(--color-success)' : 'var(--color-danger)' }}>
                  {d.v1Hit ? '✓' : '✗'}
                </span>
                <span style={{ textAlign: 'center', fontSize: 12, color: d.v2Hit ? 'var(--color-success)' : 'var(--color-danger)' }}>
                  {d.v2Hit ? '✓' : '✗'}
                </span>
                <span style={{ textAlign: 'center', fontSize: 12, fontWeight: 600, color: d.v3Hit ? 'var(--color-success)' : 'var(--color-danger)' }}>
                  {d.v3Hit ? '✓' : '✗'}
                </span>
                <span style={{ textAlign: 'center', fontSize: 11, fontFamily: "'IBM Plex Mono', monospace", color: 'var(--color-accent)' }}>
                  {d.predProb != null ? `${(d.predProb * 100).toFixed(0)}%` : '—'}
                </span>
                <span style={{
                  textAlign: 'center', fontSize: 11, fontFamily: "'IBM Plex Mono', monospace",
                  color: d.anchorPred === d.anchorActual ? 'var(--color-success)' : 'var(--color-text-muted)',
                }}>
                  {d.anchorPred != null ? `${d.anchorPred}g` : '—'}
                  {d.anchorPred != null && d.anchorPred === d.anchorActual && ' ✓'}
                </span>
              </div>
            ))}

            {/* Summary footer */}
            <div style={{
              display: 'grid', gridTemplateColumns: '1fr 60px 55px 55px 55px 55px 65px',
              padding: '8px 14px', background: 'var(--color-bg-secondary)',
              borderTop: '0.5px solid var(--color-border)',
              fontSize: 10, fontFamily: "'IBM Plex Mono', monospace",
              fontWeight: 500, gap: 4, alignItems: 'center',
            }}>
              <span style={{ color: 'var(--color-text-muted)' }}>
                {lang === 'zh' ? '合计' : 'Total'} {modelPerf.total}
              </span>
              <span />
              <span style={{ textAlign: 'center', color: parseFloat(modelPerf.v1Acc) >= 55 ? 'var(--color-success)' : 'var(--color-warning)' }}>
                {modelPerf.v1Acc ? `${modelPerf.v1Acc}%` : '—'}
              </span>
              <span style={{ textAlign: 'center', color: parseFloat(modelPerf.v2Acc) >= 55 ? 'var(--color-success)' : 'var(--color-warning)' }}>
                {modelPerf.v2Acc ? `${modelPerf.v2Acc}%` : '—'}
              </span>
              <span style={{ textAlign: 'center', fontWeight: 700, color: parseFloat(modelPerf.v3Acc) >= 55 ? 'var(--color-success)' : 'var(--color-warning)' }}>
                {modelPerf.v3Acc ? `${modelPerf.v3Acc}%` : '—'}
              </span>
              <span style={{ textAlign: 'center', color: 'var(--color-accent)' }}>
                Brier {modelPerf.avgBrier ?? '—'}
              </span>
              <span style={{ textAlign: 'center', color: parseFloat(modelPerf.anchorAcc) >= 20 ? 'var(--color-success)' : 'var(--color-warning)' }}>
                {modelPerf.anchorAcc ? `${modelPerf.anchorAcc}%` : '—'}
              </span>
            </div>
          </div>

          <div style={{ fontSize: 10, fontFamily: "'IBM Plex Mono', monospace",
            color: 'var(--color-text-muted)', marginTop: 8, letterSpacing: '0.04em' }}>
            BENCHMARKS: Random 33.3% · Bookmakers ~54% · V3 historical 59.4% (2,217 held-out matches 2024–26)
          </div>
        </>
      )}

      {/* ═══ SECTION 4: TRACKER SUMMARY ═══ */}
      <SH label={lang === 'zh' ? '追踪摘要' : 'TRACKER SUMMARY'} />

      {tracker.settled === 0 && tracker.pending === 0 ? (
        <div style={{ padding: '12px 14px', border: '0.5px solid var(--color-border)',
          borderRadius: 'var(--radius-lg)', fontSize: 12, color: 'var(--color-text-muted)' }}>
          {lang === 'zh'
            ? '暂无追踪记录。在比赛分析页面追踪你的预测。'
            : 'No tracked predictions yet. Track predictions from the match analysis pages.'}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8 }}>
          {[
            {
              label: lang === 'zh' ? '已结算' : 'Settled',
              value: tracker.settled,
              sub: `${tracker.wins} won`,
              color: 'var(--color-text-primary)',
            },
            {
              label: lang === 'zh' ? '待结算' : 'Pending',
              value: tracker.pending,
              sub: `¥${tracker.pendingStake} at risk`,
              color: tracker.pending > 0 ? 'var(--color-warning)' : 'var(--color-text-primary)',
            },
            {
              label: 'P&L',
              value: tracker.pnl !== undefined
                ? `${tracker.pnl >= 0 ? '+' : ''}¥${tracker.pnl}` : '—',
              sub: `on ¥${tracker.staked} staked`,
              color: (tracker.pnl || 0) >= 0 ? 'var(--color-success)' : 'var(--color-danger)',
            },
            {
              label: 'ROI',
              value: tracker.roi ? `${tracker.roi}%` : '—',
              sub: 'settled only',
              color: parseFloat(tracker.roi || 0) >= 0 ? 'var(--color-success)' : 'var(--color-danger)',
            },
          ].map((c, i) => (
            <KCard
              key={i}
              label={c.label}
              value={c.value}
              sub={c.sub}
              color={c.color}
              onClick={() => navigate('/my-bets')}
            />
          ))}
        </div>
      )}

    </div>
  )
}
