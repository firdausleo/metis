import React, { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useTranslation } from '../lib/i18n'

export default function MetisWizard() {
  const { lang } = useTranslation()
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [context, setContext] = useState(null)
  const scrollRef = useRef(null)
  const inputRef = useRef(null)

  useEffect(() => { loadContext() }, [])

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  async function loadContext() {
    try {
      const [{ data: matches }, { data: predictions }, { data: bets }] = await Promise.all([
        supabase
          .from('matches')
          .select('id, home_team, away_team, match_date, status, home_score, away_score, group_name')
          .order('match_date'),
        supabase
          .from('model_predictions')
          .select('match_id, v3_home_win, v3_draw, v3_away_win, anchor_total, v3_top_score, quality_warning'),
        supabase
          .from('user_bets')
          .select('selection, odds, stake, status, actual_return, bet_type')
          .order('placed_at', { ascending: false })
          .limit(20),
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
      return bj.toDateString() === beijingNow.toDateString() ||
        Math.abs(bj - beijingNow) < 12 * 60 * 60 * 1000
    }).slice(0, 6)

    const resultsText = finished.slice(-16).map(m =>
      `  ${m.home_team} ${m.home_score}-${m.away_score} ${m.away_team}`
    ).join('\n')

    const upcomingText = todayUpcoming.map(m => {
      const pred = context.predMap[m.id]
      const bj = new Date(m.match_date).toLocaleString('zh-CN', {
        timeZone: 'Asia/Shanghai',
        month: 'numeric', day: 'numeric',
        hour: '2-digit', minute: '2-digit',
      })
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
      ? context.bets.slice(0, 10).map(b =>
          `  ${b.selection} @${b.odds} ¥${b.stake} → ${b.status}${b.actual_return ? ` (returned ¥${b.actual_return})` : ''}`
        ).join('\n')
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
- Use • for bullet points
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
    } catch (err) {
      setMessages([
        ...newMessages,
        { role: 'assistant', content: 'Connection error — please try again' },
      ])
    } finally {
      setLoading(false)
      inputRef.current?.focus()
    }
  }

  const finished = context?.matches.filter(m => m.status === 'finished') ?? []
  const upcoming = context?.matches.filter(m => m.status === 'upcoming') ?? []

  const CHIPS = lang === 'zh'
    ? ['今晚最佳投注？', '法国胜率多少？', '分析我的投注历史', '今晚哪场最有价值？']
    : ['Best bets tonight?', 'France win probability?', 'Analyze my bet history', 'Best value match tonight?']

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: 'calc(100vh - 56px)',
      maxWidth: 720,
      margin: '0 auto',
      padding: 0,
    }}>

      {/* ── HEADER ── */}
      <div style={{
        padding: '12px 16px',
        borderBottom: '0.5px solid var(--color-border-tertiary)',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        flexShrink: 0,
        background: 'var(--color-background-primary)',
      }}>
        <div style={{
          width: 40, height: 40,
          borderRadius: '50%',
          background: 'linear-gradient(135deg, #1A3A6C 0%, #C9A84C 100%)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 20, flexShrink: 0,
        }}>⚡</div>
        <div style={{ flex: 1 }}>
          <div style={{
            fontSize: 15, fontWeight: 600,
            color: 'var(--color-text-primary)',
            fontFamily: "'Barlow Condensed', sans-serif",
            letterSpacing: '0.08em',
          }}>METIS</div>
          <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginTop: 1 }}>
            {context
              ? `${finished.length} results · ${upcoming.length} upcoming`
              : 'Loading match data...'}
          </div>
        </div>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 5,
          fontSize: 11,
          color: context ? '#2D7A4F' : 'var(--color-text-tertiary)',
        }}>
          <div style={{
            width: 7, height: 7, borderRadius: '50%',
            background: context ? '#2D7A4F' : '#9CA3AF',
          }} />
          {context ? (lang === 'zh' ? '在线' : 'Online') : (lang === 'zh' ? '加载中' : 'Loading')}
        </div>
      </div>

      {/* ── MESSAGES AREA ── */}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '16px',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          background: 'var(--color-background-secondary)',
        }}
      >
        {/* Welcome bubble */}
        {messages.length === 0 && (
          <>
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <SmallAvatar />
              <div style={{
                background: 'var(--color-background-primary)',
                borderRadius: '4px 16px 16px 16px',
                padding: '12px 14px',
                maxWidth: '80%',
                fontSize: 13,
                color: 'var(--color-text-primary)',
                lineHeight: 1.65,
                boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
              }}>
                {lang === 'zh' ? (
                  <>
                    <strong>你好，我是 METIS。</strong><br /><br />
                    你的WC2026智能投注顾问。我掌握所有比赛数据、V1/V2/V3预测模型、赔率分析和你的投注历史。<br /><br />
                    你可以问我任何关于WC2026的问题。
                  </>
                ) : (
                  <>
                    <strong>I'm METIS.</strong><br /><br />
                    Your WC2026 betting intelligence. I have full access to all match data, V1/V2/V3 predictions, edge calculations, and your betting history.<br /><br />
                    Ask me anything about WC2026.
                  </>
                )}
              </div>
            </div>

            {/* Suggestion chips */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, paddingLeft: 42 }}>
              {CHIPS.map(chip => (
                <button
                  key={chip}
                  onClick={() => { setInput(chip); inputRef.current?.focus() }}
                  style={{
                    padding: '7px 14px',
                    borderRadius: '99px',
                    border: '0.5px solid var(--color-border-secondary)',
                    background: 'var(--color-background-primary)',
                    color: 'var(--color-text-secondary)',
                    fontSize: 12,
                    cursor: 'pointer',
                    minHeight: 34,
                    fontFamily: 'var(--font-sans)',
                    transition: 'border-color 0.15s',
                  }}
                  onMouseEnter={e => e.currentTarget.style.borderColor = '#C9A84C'}
                  onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--color-border-secondary)'}
                >
                  {chip}
                </button>
              ))}
            </div>
          </>
        )}

        {/* Chat messages */}
        {messages.map((msg, i) => (
          <div key={i} style={{
            display: 'flex',
            gap: 10,
            alignItems: 'flex-start',
            justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
          }}>
            {msg.role === 'assistant' && <SmallAvatar />}

            <div style={{
              maxWidth: '78%',
              padding: '10px 14px',
              borderRadius: msg.role === 'user'
                ? '16px 4px 16px 16px'
                : '4px 16px 16px 16px',
              background: msg.role === 'user'
                ? '#1A3A6C'
                : 'var(--color-background-primary)',
              color: msg.role === 'user' ? 'white' : 'var(--color-text-primary)',
              fontSize: 13,
              lineHeight: 1.65,
              boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
            }}>
              {msg.loading
                ? <span style={{ opacity: 0.5 }}>{lang === 'zh' ? '分析中' : 'Analyzing'} ▋</span>
                : msg.role === 'assistant'
                  ? <MetisMessage content={msg.content} />
                  : msg.content}
            </div>

            {msg.role === 'user' && (
              <div style={{
                width: 32, height: 32, borderRadius: '50%',
                background: 'var(--color-background-primary)',
                border: '0.5px solid var(--color-border-secondary)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 14, flexShrink: 0,
              }}>👤</div>
            )}
          </div>
        ))}
      </div>

      {/* ── INPUT AREA ── */}
      <div style={{
        padding: '12px 16px',
        borderTop: '0.5px solid var(--color-border-tertiary)',
        background: 'var(--color-background-primary)',
        flexShrink: 0,
      }}>
        <div style={{
          display: 'flex',
          gap: 8,
          alignItems: 'flex-end',
          background: 'var(--color-background-secondary)',
          border: '0.5px solid var(--color-border-secondary)',
          borderRadius: '16px',
          padding: '8px 8px 8px 14px',
        }}>
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                sendMessage()
              }
            }}
            placeholder={lang === 'zh'
              ? '问我任何关于WC2026的问题... (Enter发送)'
              : 'Ask METIS anything about WC2026... (Enter to send)'}
            rows={1}
            style={{
              flex: 1,
              fontSize: 14,
              border: 'none',
              outline: 'none',
              background: 'transparent',
              color: 'var(--color-text-primary)',
              resize: 'none',
              minHeight: 24,
              maxHeight: 100,
              fontFamily: 'var(--font-sans)',
              lineHeight: 1.5,
              padding: 0,
            }}
          />
          <button
            onClick={sendMessage}
            disabled={!input.trim() || loading}
            style={{
              width: 36, height: 36,
              borderRadius: '50%',
              background: input.trim() && !loading
                ? 'linear-gradient(135deg, #1A3A6C, #C9A84C)'
                : 'var(--color-border-tertiary)',
              border: 'none',
              cursor: input.trim() && !loading ? 'pointer' : 'not-allowed',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 16, flexShrink: 0,
              transition: 'background 0.2s',
            }}
          >
            ⚡
          </button>
        </div>
        <div style={{
          fontSize: 10,
          color: 'var(--color-text-tertiary)',
          textAlign: 'center',
          marginTop: 6,
        }}>
          {lang === 'zh'
            ? 'METIS基于统计模型 · 预测存在不确定性 · 理性投注'
            : 'METIS uses statistical models · Predictions carry uncertainty · Bet responsibly'}
        </div>
      </div>
    </div>
  )
}

function SmallAvatar() {
  return (
    <div style={{
      width: 32, height: 32, borderRadius: '50%',
      background: 'linear-gradient(135deg, #1A3A6C, #C9A84C)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 15, flexShrink: 0,
    }}>⚡</div>
  )
}

function MetisMessage({ content }) {
  if (!content) return null

  const lines = content.split('\n')

  return (
    <div style={{ lineHeight: 1.65, fontSize: 13 }}>
      {lines.map((line, i) => {
        if (!line.trim()) {
          return <div key={i} style={{ height: 8 }} />
        }

        const isGood = line.startsWith('✅')
        const isWarn = line.startsWith('⚠')
        const isBad  = line.startsWith('❌')
        const isRec  = line.startsWith('⚡')

        const color = isGood ? '#27500A'
          : isWarn ? '#BA7517'
          : isBad  ? '#791F1F'
          : isRec  ? '#C9A84C'
          : 'var(--color-text-primary)'

        const parsed = line
          .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
          .replace(/\*([^*]+)\*/g, '<em>$1</em>')

        return (
          <div
            key={i}
            style={{
              color,
              marginBottom: 3,
              paddingLeft: line.match(/^[•\-\*]\s/) ? 12 : 0,
              fontWeight: isRec ? 500 : 400,
              background: isRec ? 'rgba(201,168,76,0.08)' : 'transparent',
              borderRadius: isRec ? 6 : 0,
              padding: isRec ? '4px 8px' : undefined,
            }}
            dangerouslySetInnerHTML={{ __html: parsed }}
          />
        )
      })}
    </div>
  )
}

const BASE_SYSTEM_PROMPT = `You are METIS, a WC2026 betting intelligence AI. Match data is still loading. Answer general questions about football prediction models and betting strategy. Be helpful but note that live data is not yet available.`
