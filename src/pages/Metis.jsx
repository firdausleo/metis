import React, { useState, useEffect, useRef, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useTranslation } from '../lib/i18n'
import { useBrainCanvas, useMiniCanvas } from '../hooks/useBrainCanvas'

/* ─── MiniAvatar ─── */
function MiniAvatar() {
  const canvasRef = useRef(null)
  useMiniCanvas(canvasRef, true)
  return (
    <canvas
      ref={canvasRef}
      width={36}
      height={36}
      style={{
        width: 36, height: 36,
        borderRadius: '50%',
        border: '1px solid rgba(201,168,76,0.35)',
        flexShrink: 0,
      }}
    />
  )
}

/* ─── MetisMessage ─── */
function MetisMessage({ content }) {
  if (!content) return null
  const lines = content.split('\n')
  return (
    <div style={{ lineHeight: 1.7, fontSize: 13 }}>
      {lines.map((line, i) => {
        if (!line.trim()) return <div key={i} style={{ height: 6 }} />
        const isGood = line.startsWith('✅')
        const isWarn = line.startsWith('⚠')
        const isBad  = line.startsWith('❌')
        const isRec  = line.startsWith('⚡')
        const color = isGood ? '#4ade80' : isWarn ? '#fbbf24' : isBad ? '#f87171' : isRec ? '#C9A84C' : 'rgba(220,230,255,0.88)'
        const parsed = line
          .replace(/\*\*([^*]+)\*\*/g, '<strong style="color:#C9A84C">$1</strong>')
          .replace(/\*([^*]+)\*/g, '<em>$1</em>')
        return (
          <div
            key={i}
            style={{
              color,
              marginBottom: 3,
              paddingLeft: line.match(/^[•\-\*›]\s/) ? 14 : 0,
              fontWeight: isRec ? 500 : 400,
              background: isRec ? 'rgba(201,168,76,0.08)' : 'transparent',
              borderLeft: isRec ? '2px solid rgba(201,168,76,0.5)' : 'none',
              borderRadius: isRec ? '0 4px 4px 0' : 0,
              padding: isRec ? '5px 10px' : '0',
            }}
            dangerouslySetInnerHTML={{ __html: parsed }}
          />
        )
      })}
    </div>
  )
}

/* ─── Main page ─── */
export default function MetisWizard() {
  const { lang } = useTranslation()
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [context, setContext] = useState(null)
  const [focused, setFocused] = useState(false)

  const scrollRef  = useRef(null)
  const inputRef   = useRef(null)
  const brainRef   = useRef(null)

  const chatActive = messages.length > 0
  useBrainCanvas(brainRef, !chatActive)

  useEffect(() => { loadContext() }, [])
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages])

  async function loadContext() {
    try {
      const [{ data: matches }, { data: predictions }, { data: bets }] = await Promise.all([
        supabase.from('matches').select('id, home_team, away_team, match_date, status, home_score, away_score, group_name').order('match_date'),
        supabase.from('model_predictions').select('match_id, v3_home_win, v3_draw, v3_away_win, anchor_total, v3_top_score, quality_warning'),
        supabase.from('user_bets').select('selection, odds, stake, status, actual_return, bet_type').order('placed_at', { ascending: false }).limit(20),
      ])
      const predMap = {}
      predictions?.forEach(p => { predMap[p.match_id] = p })
      setContext({ matches: matches || [], predMap, bets: bets || [] })
    } catch (err) {
      console.warn('Failed to load METIS context:', err)
    }
  }

  function buildSystemPrompt() {
    if (!context) return BASE_SYSTEM_PROMPT
    const now = new Date()
    const beijingNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }))
    const finished = context.matches.filter(m => m.status === 'finished')
    const upcoming = context.matches.filter(m => m.status === 'upcoming')
    const todayUpcoming = upcoming.filter(m => {
      const bj = new Date(new Date(m.match_date).toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }))
      return bj.toDateString() === beijingNow.toDateString() || Math.abs(bj - beijingNow) < 12 * 60 * 60 * 1000
    }).slice(0, 6)
    const resultsText = finished.slice(-16).map(m => `  ${m.home_team} ${m.home_score}-${m.away_score} ${m.away_team}`).join('\n')
    const upcomingText = todayUpcoming.map(m => {
      const pred = context.predMap[m.id]
      const bj = new Date(m.match_date).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
      const predStr = pred?.v3_home_win
        ? `V3: ${m.home_team} ${(pred.v3_home_win * 100).toFixed(0)}% / D ${(pred.v3_draw * 100).toFixed(0)}% / ${m.away_team} ${(pred.v3_away_win * 100).toFixed(0)}% | Anchor: ${pred.anchor_total}g | Top: ${pred.v3_top_score}`
        : 'Prediction: DC ratings only'
      const warn = pred?.quality_warning ? ' ⚠ Low confidence' : ''
      return `  ${m.home_team} vs ${m.away_team} (${bj} BJ)${warn}\n  ${predStr}`
    }).join('\n\n')
    const settled = context.bets.filter(b => b.status !== 'pending')
    const totalStaked = settled.reduce((s, b) => s + b.stake, 0)
    const totalReturned = settled.reduce((s, b) => s + (b.actual_return || 0), 0)
    const pnl = totalReturned - totalStaked
    const betsText = context.bets.length > 0
      ? context.bets.slice(0, 10).map(b => `  ${b.selection} @${b.odds} ¥${b.stake} → ${b.status}${b.actual_return ? ` (returned ¥${b.actual_return})` : ''}`).join('\n')
      : '  No bets recorded yet'

    return `You are METIS — an elite WC2026 football prediction and betting intelligence AI. You are the central brain of the Metis app, built for a private group of friends who track predictions and bets together.

You are knowledgeable, precise, confident but honest about uncertainty. You speak like a sharp analyst — not a generic chatbot. You have full access to the prediction engine, live match data, and betting history.

════════════════════════════════════
WHO YOU ARE
════════════════════════════════════

METIS is named after the Greek Titaness of wisdom, skill, and deep thought — the first great strategist. You embody that: systematic, data-driven, strategic.

You know:
- Every WC2026 match result and upcoming fixture
- V1, V2, V3 model predictions for all matches
- The PASP betting algorithm and edge calculations
- China lottery and Indonesia betting markets
- The user's betting history and P&L
- Dixon-Coles rating system and what drives it

════════════════════════════════════
THE PREDICTION MODELS
════════════════════════════════════

V1 — Rolling Poisson (auto-updates on stats fetch):
  5-game weighted window (30/25/20/15/10%)
  Uses xG for/against + goals scored/conceded
  Fast to react, loses historical class context
  ~57-59% directional accuracy

V2 — Away-corrected Poisson (auto-updates):
  Same as V1 but splits home/away data
  Better for teams with strong home/away differential
  All WC matches are neutral venue

V3 — Dixon-Coles Ensemble (PRIMARY — use this):
  65% DC historical ratings (15,508 matches 2010-2026)
  + 35% Model 7 (V1/V2 blend)
  DC correction: rho=-0.0612 (adjusts 0-0,1-0,0-1,1-1)
  Temperature T=1.11 for calibration
  ~61-62% directional accuracy
  MOST RELIABLE — always refer to V3 for decisions

DC RATINGS (updated Jun 16 for Matchday 1):
  Top attackers: Argentina 1.226, Germany 1.214, Sweden 0.958, France 0.951, Brazil 1.240
  Top defenders: Argentina 1.521, Uruguay 1.222, Morocco 1.131, Brazil 1.168
  Surprises: Cape Verde def jumped to 0.696 (held Spain), Spain att dropped to 1.029 (0-0 shock), Germany att rose to 1.214 (7-1 vs Curacao)

════════════════════════════════════
PASP BETTING ALGORITHM
════════════════════════════════════

Step 1: Find anchor total (highest prob goal count)
Step 2: Check 3-goal range windows (sweet spot)
Step 3: Calculate edge% = modelProb - (1/odds)
  ✅ ≥+5% = Good value
  ⚠ 0-5% = Marginal
  〜 -5% to 0% = Fair
  ❌ <-5% = Negative edge
Step 4: Kelly sizing = edge/(odds-1) × bankroll × 0.25
  Hard cap: 5% bankroll per bet
Step 5: Portfolio = Primary + Secondary + Insurance

THREE PORTFOLIO MODES:
  ⚖ Balanced: Primary follows model, secondary takes edge
  🏆 Follow Model: Only bet model's predicted direction
  🎯 Best Edge: Pure math, may conflict with model

CHINA MARKET PROBABILITIES:
  胜其它 (home wins by unlisted score): prob = homeWin - sum(listed home score probs). Usually 2-5% — high odds reflect genuinely rare events
  负其它: prob = awayWin - sum(listed away scores)
  平其它: prob = draw - P(0-0) - P(1-1) - P(2-2) - P(3-3)
  ⚠ Never recommend 胜其它/负其它 as primary bet

════════════════════════════════════
LIVE WC2026 DATA
════════════════════════════════════

TOURNAMENT: ${finished.length} matches played
Current date: ${beijingNow.toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' })} Beijing

RECENT RESULTS (last 16):
${resultsText || '  No results yet'}

UPCOMING MATCHES (next 12h Beijing):
${upcomingText || '  No upcoming matches loaded'}

════════════════════════════════════
YOUR BETTING HISTORY
════════════════════════════════════

Recent bets:
${betsText}

P&L summary:
  Settled bets: ${settled.length}
  Total staked: ¥${totalStaked}
  Total returned: ¥${totalReturned}
  P&L: ${pnl >= 0 ? '+' : ''}¥${pnl}
  ${settled.length > 0 ? `ROI: ${((pnl / totalStaked) * 100).toFixed(1)}%` : 'ROI: N/A'}

════════════════════════════════════
HOW TO RESPOND
════════════════════════════════════

For bet analysis requests:
  Parse each bet → find model prob → calc edge% → rate ✅⚠〜❌ → summarize → recommend

For match prediction questions:
  Give V3 probabilities → top scores → anchor total. Note confidence level and data quality.

For strategy questions:
  Reference PASP algorithm → explain edge vs direction. Give concrete stake suggestions using Kelly.

For general WC2026 questions:
  Use the match data and results above. Be specific — give numbers not vague statements.

ALWAYS:
  - Be concise on mobile (short paragraphs)
  - Use numbers — percentages, odds, stakes
  - Distinguish "model says" vs "I think"
  - Flag low confidence matches clearly
  - Respond in same language as user (ZH/EN)
  - Never guarantee outcomes
  - Flag if total stake > 20% of bankroll

════════════════════════════════════
FORMAT YOUR RESPONSES
════════════════════════════════════

- Use **bold** for all key numbers: **56.5%**, **@7.30**, **¥150**
- Start each bet analysis line with ✅ ⚠ or ❌
- Use › for bullet points
- Keep paragraphs to 2-3 sentences max
- Always end with: ⚡ RECOMMENDATION: [your call]
- Separate sections with a blank line`
  }

  async function sendMessage() {
    const userMsg = input.trim()
    if (!userMsg || loading) return
    setInput('')
    setLoading(true)
    const newMessages = [...messages, { role: 'user', content: userMsg }]
    setMessages([...newMessages, { role: 'assistant', content: '', loading: true }])
    try {
      const response = await fetch('/api/metis-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system: buildSystemPrompt(),
          messages: newMessages.map(m => ({ role: m.role, content: m.content })),
        }),
      })
      const data = await response.json()
      const reply = data.content?.[0]?.text || 'Analysis unavailable — please try again'
      setMessages([...newMessages, { role: 'assistant', content: reply }])
    } catch {
      setMessages([...newMessages, { role: 'assistant', content: 'Connection error — please try again' }])
    } finally {
      setLoading(false)
      inputRef.current?.focus()
    }
  }

  const finished = context?.matches.filter(m => m.status === 'finished') ?? []
  const upcoming = context?.matches.filter(m => m.status === 'upcoming') ?? []

  const chips = useMemo(() => {
    const base = []
    if (context?.matches) {
      const upcomingSorted = context.matches
        .filter(m => m.status === 'upcoming')
        .sort((a, b) => new Date(a.match_date) - new Date(b.match_date))
      if (upcomingSorted[0]) {
        base.push(lang === 'zh'
          ? `${upcomingSorted[0].home_team} vs ${upcomingSorted[0].away_team} 分析`
          : `Analyze ${upcomingSorted[0].home_team} vs ${upcomingSorted[0].away_team}`
        )
      }
      if (upcomingSorted[1]) {
        base.push(lang === 'zh'
          ? `${upcomingSorted[1].home_team} 胜率多少？`
          : `${upcomingSorted[1].home_team} win probability?`
        )
      }
    }
    base.push(lang === 'zh' ? '今晚最有价值的比赛？' : 'Best value match tonight?')
    base.push(lang === 'zh' ? '分析我的投注历史' : 'Analyze my bet history')
    return base.slice(0, 4)
  }, [context, lang])

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: 'calc(var(--metis-h, 100vh))',
      background: '#080c14',
      overflow: 'hidden',
    }}>
      {/* ── COMPACT HEADER (chat active) ── */}
      {chatActive && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '10px 20px',
          borderBottom: '1px solid rgba(201,168,76,0.12)',
          background: 'rgba(8,12,20,0.95)',
          backdropFilter: 'blur(10px)',
          flexShrink: 0,
        }}>
          <MiniAvatar />
          <div>
            <div style={{
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 14, fontWeight: 600,
              color: '#C9A84C', letterSpacing: '0.18em',
            }}>METIS</div>
            <div style={{ fontSize: 10, color: 'rgba(201,168,76,0.45)', letterSpacing: '0.08em' }}>
              {context
                ? `${finished.length} RESULTS · ${upcoming.length} UPCOMING`
                : 'LOADING DATA...'}
            </div>
          </div>
          <div style={{ flex: 1 }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{
              width: 6, height: 6, borderRadius: '50%',
              background: context ? '#4ade80' : 'rgba(201,168,76,0.3)',
              boxShadow: context ? '0 0 6px #4ade80' : 'none',
            }} />
            <span style={{
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 9, color: context ? '#4ade80' : 'rgba(201,168,76,0.3)',
              letterSpacing: '0.12em',
            }}>{context ? 'ONLINE' : 'LOADING'}</span>
          </div>
        </div>
      )}

      {/* ── WELCOME / BRAIN STATE ── */}
      {!chatActive && (
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', paddingBottom: 4 }}>

          {/* ── TITLE SECTION ── */}
          <div style={{ textAlign: 'center', padding: '28px 16px 16px', flexShrink: 0 }}>
            <div style={{
              fontSize: 'clamp(32px, 6vw, 56px)',
              fontFamily: "'IBM Plex Mono', monospace",
              fontWeight: 600,
              letterSpacing: '0.25em',
              color: '#C9A84C',
              lineHeight: 1,
              marginBottom: 8,
            }}>
              METIS
            </div>
            <div style={{
              fontSize: 11,
              fontFamily: "'IBM Plex Mono', monospace",
              letterSpacing: '0.15em',
              color: 'rgba(201,168,76,0.45)',
              textTransform: 'uppercase',
              marginBottom: 4,
            }}>
              WC2026 Intelligence
            </div>
            <div style={{
              fontSize: 10,
              fontFamily: "'IBM Plex Mono', monospace",
              letterSpacing: '0.06em',
              color: 'rgba(201,168,76,0.30)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 10,
              marginTop: 6,
            }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{
                  width: 5, height: 5, borderRadius: '50%',
                  background: context ? '#2D7A4F' : '#555',
                  display: 'inline-block',
                }} />
                {context ? 'ONLINE' : 'LOADING'}
              </span>
              {context && (<>
                <span>·</span>
                <span>{context.matches.filter(m => m.status === 'finished').length} RESULTS</span>
                <span>·</span>
                <span>{context.matches.filter(m => m.status === 'upcoming').length} UPCOMING</span>
                <span>·</span>
                <span>V3 ACTIVE</span>
              </>)}
            </div>
          </div>

          {/* ── BRAIN CANVAS ── */}
          <div style={{
            position: 'relative',
            width: '100vw',
            marginLeft: 'calc(-50vw + 50%)',
            height: 'clamp(180px, 36vh, 320px)',
            flexShrink: 0,
            overflow: 'hidden',
          }}>
            <canvas
              ref={brainRef}
              style={{
                position: 'absolute',
                top: 0, left: 0,
                width: '100%',
                height: '100%',
                display: 'block',
              }}
            />
          </div>

          {/* ── SUGGESTION CHIPS ── */}
          <div style={{
            padding: '10px 16px 4px',
            display: 'flex',
            flexWrap: 'wrap',
            gap: 6,
            maxWidth: 560,
            margin: '0 auto',
            width: '100%',
            justifyContent: 'center',
            flexShrink: 0,
          }}>
            {chips.map((chip, i) => (
              <button
                key={i}
                onClick={() => { setInput(chip); inputRef.current?.focus() }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '6px 12px',
                  background: 'rgba(201,168,76,0.05)',
                  border: '0.5px solid rgba(201,168,76,0.18)',
                  borderRadius: 6,
                  cursor: 'pointer',
                  fontSize: 11,
                  fontFamily: "'IBM Plex Mono', monospace",
                  color: 'rgba(232,234,240,0.70)',
                  minHeight: 30,
                  whiteSpace: 'nowrap',
                  transition: 'all 0.15s',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.background = 'rgba(201,168,76,0.11)'
                  e.currentTarget.style.borderColor = 'rgba(201,168,76,0.45)'
                  e.currentTarget.style.color = '#e8eaf0'
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = 'rgba(201,168,76,0.05)'
                  e.currentTarget.style.borderColor = 'rgba(201,168,76,0.18)'
                  e.currentTarget.style.color = 'rgba(232,234,240,0.70)'
                }}
              >
                <span style={{ color: '#C9A84C', fontWeight: 600 }}>›</span>
                {chip}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── MESSAGES AREA ── */}
      {chatActive && (
        <div
          ref={scrollRef}
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '20px 16px 8px',
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            maxWidth: 760,
            width: '100%',
            margin: '0 auto',
            boxSizing: 'border-box',
          }}
        >
          {messages.map((msg, i) => (
            <div key={i} style={{
              display: 'flex',
              gap: 10,
              alignItems: 'flex-start',
              justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
            }}>
              {msg.role === 'assistant' && <MiniAvatar />}

              <div style={{
                maxWidth: '80%',
                padding: '10px 14px',
                borderRadius: msg.role === 'user' ? '12px 2px 12px 12px' : '2px 12px 12px 12px',
                background: msg.role === 'user'
                  ? 'rgba(26,58,108,0.85)'
                  : 'rgba(17,24,39,0.92)',
                border: msg.role === 'user'
                  ? '1px solid rgba(100,140,220,0.25)'
                  : '1px solid rgba(201,168,76,0.14)',
                borderLeft: msg.role === 'assistant' ? '2px solid rgba(201,168,76,0.45)' : undefined,
                color: msg.role === 'user' ? 'rgba(220,235,255,0.92)' : 'rgba(220,230,255,0.88)',
                fontSize: 13,
                lineHeight: 1.7,
              }}>
                {msg.loading
                  ? (
                    <span style={{
                      color: 'rgba(201,168,76,0.7)',
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontSize: 12,
                    }}>
                      {lang === 'zh' ? '分析中' : 'Analyzing'} <span style={{ animation: 'none' }}>▋</span>
                    </span>
                  )
                  : msg.role === 'assistant'
                    ? <MetisMessage content={msg.content} />
                    : <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 13 }}>{msg.content}</span>
                }
              </div>

              {msg.role === 'user' && (
                <div style={{
                  width: 32, height: 32, borderRadius: '50%',
                  background: 'rgba(26,58,108,0.8)',
                  border: '1px solid rgba(100,140,220,0.3)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 14, flexShrink: 0,
                  color: 'rgba(160,190,255,0.8)',
                }}>
                  ›
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── INPUT AREA — always visible ── */}
      <div style={{
        flexShrink: 0,
        padding: '8px 16px 16px',
        borderTop: '0.5px solid rgba(201,168,76,0.10)',
        background: '#080c14',
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'flex-end',
          gap: 8,
          background: '#0d1420',
          border: focused
            ? '0.5px solid rgba(201,168,76,0.7)'
            : '0.5px solid rgba(201,168,76,0.22)',
          borderRadius: 10,
          padding: '10px 10px 10px 16px',
          transition: 'border-color 0.2s',
          maxWidth: 720,
          margin: '0 auto',
        }}>
          <textarea
            ref={inputRef}
            value={input}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                sendMessage()
              }
            }}
            placeholder={lang === 'zh'
              ? '› 问 METIS 任何问题...'
              : '› Ask METIS anything about WC2026...'}
            rows={1}
            style={{
              flex: 1,
              fontSize: 13,
              fontFamily: "'IBM Plex Mono', monospace",
              border: 'none',
              outline: 'none',
              background: 'transparent',
              color: '#e8eaf0',
              resize: 'none',
              minHeight: 24,
              maxHeight: 100,
              lineHeight: 1.5,
              padding: 0,
              caretColor: '#C9A84C',
            }}
          />
          <button
            onClick={sendMessage}
            disabled={!input.trim() || loading}
            style={{
              width: 34, height: 34,
              borderRadius: 7,
              background: input.trim() && !loading
                ? '#C9A84C'
                : 'rgba(201,168,76,0.08)',
              border: 'none',
              cursor: input.trim() && !loading ? 'pointer' : 'default',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 15,
              flexShrink: 0,
              color: input.trim() && !loading ? '#080c14' : 'rgba(201,168,76,0.25)',
              transition: 'background 0.15s, color 0.15s',
            }}
          >⚡</button>
        </div>
        <div style={{
          fontSize: 9,
          fontFamily: "'IBM Plex Mono', monospace",
          color: 'rgba(201,168,76,0.40)',
          textAlign: 'center',
          marginTop: 7,
          letterSpacing: '0.06em',
        }}>
          METIS · STATISTICAL MODELS · PREDICTIONS CARRY UNCERTAINTY
        </div>
      </div>
    </div>
  )
}

const BASE_SYSTEM_PROMPT = `You are METIS, a WC2026 betting intelligence AI. Match data is still loading. Answer general questions about football prediction models and betting strategy. Be helpful but note that live data is not yet available.`
