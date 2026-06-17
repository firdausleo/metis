import { useState } from 'react'

const SECTIONS = [
  {
    id: 'metis',
    title: '⚡ What is METIS?',
    items: [
      {
        q: 'What is the Metis app?',
        a: [{ p: 'Metis is a WC2026 prediction and betting intelligence app built for a small private group. It combines three statistical models (V1, V2, V3) to generate match predictions and identify value betting opportunities across China lottery and Indonesia markets.' }],
      },
      {
        q: 'Who is the METIS AI Wizard?',
        a: [{ p: 'METIS (Matchday Edge & Tournament Intelligence System) is an AI advisor powered by Claude. It has full access to all match data, V1/V2/V3 predictions, PASP edge calculations, and your betting history. Ask it anything about WC2026.' }],
      },
      {
        q: 'How do I access METIS?',
        a: [
          { p: 'Three ways:' },
          { list: ['⚡ tab in the navbar — full-screen chat', '⚡ floating button — available on any page', '⚡ METIS tab inside any match analysis'] },
        ],
      },
    ],
  },
  {
    id: 'models',
    title: '📊 The Three Models',
    items: [
      {
        q: 'What is V1?',
        a: [{ p: 'Rolling Poisson model. Uses last 5 matches weighted 30/25/20/15/10% (most recent highest). Data: xG for/against, goals scored/conceded. Updates automatically when stats are fetched. Fast to react. Accuracy ~57–59%.' }],
      },
      {
        q: 'What is V2?',
        a: [{ p: 'Away-corrected Poisson. Same as V1 but splits home and away stats separately. Better for teams with strong home/away differential. Since WC matches are neutral, V2 averages both splits.' }],
      },
      {
        q: 'What is V3? Why is it the primary model?',
        a: [
          { p: 'Dixon-Coles Ensemble — 65% DC historical ratings (fitted on 15,508 international matches 2010–2026) + 35% Model 7 (V1/V2 blend).' },
          { p: 'Also applies DC correction (rho=−0.0612) for low-score cells and Temperature T=1.11 for probability calibration. Accuracy ~61–62%. Always use V3 for betting decisions.' },
        ],
      },
      {
        q: 'What are DC ratings?',
        a: [
          { p: 'Every team has Attack (att) and Defense (def) ratings fitted from historical match data. Higher att = scores more. Higher def = concedes less. Updated after each matchday using MLE.' },
          { code: 'Example post-Matchday 1:\nArgentina att=1.226 · Germany att=1.214 (7-1 boost)\nSpain att=1.029 (dropped after 0-0 vs Cape Verde)' },
        ],
      },
      {
        q: 'What does Low Confidence mean?',
        a: [{ p: 'Team has fewer than 5 recent matches in the database. V1/V2 components are unreliable. DC historical component dominates (65%). Reduce stakes by 25–50% for these matches.' }],
      },
    ],
  },
  {
    id: 'pasp',
    title: '🎯 PASP Algorithm',
    items: [
      {
        q: 'What is PASP?',
        a: [
          { p: 'Probability-Anchored Scoreline Portfolio. Converts model probabilities into a structured portfolio:' },
          { list: [
            'Step 1: Find anchor total (most likely goals)',
            'Step 2: Check 3-goal range windows',
            'Step 3: Calculate edge% for each bet',
            'Step 4: Build primary + secondary + insurance',
            'Step 5: Size stakes with Kelly criterion',
          ]},
        ],
      },
      {
        q: 'What does edge% mean?',
        a: [
          { p: 'edge% = modelProbability − (1/bookmakerOdds). Positive = value bet. Negative = avoid.' },
          { code: 'Example: France win\n  Model: 56.5% · Odds 1.85 → implied 54.1%\n  Edge = 56.5% − 54.1% = +2.4% (marginal)' },
          { list: [
            '✅ ≥+5% = Good value',
            '⚠ 0–5% = Marginal',
            '〜 −5% to 0% = Fair',
            '❌ <−5% = Avoid',
          ]},
        ],
      },
      {
        q: 'What are the three portfolio modes?',
        a: [
          { list: [
            '⚖ Balanced: Primary follows model direction, secondary/insurance take best edge.',
            '🏆 Follow Model: Only bet model\'s prediction. Safe psychologically, may miss value.',
            '🎯 Best Edge: Pure math — may bet against model if odds are generous. Shows ⚠ warning.',
          ]},
        ],
      },
      {
        q: 'What is 胜其它?',
        a: [
          { p: 'China lottery lists 12 specific home win scores. 胜其它 covers ALL other home wins (4-3, 5-3, 6-0 etc). Its probability = total homeWin minus the sum of the 12 listed scores — usually 2–5%.' },
          { p: 'Odds of 30–400 reflect genuinely rare events. METIS never recommends 胜其它 as primary bet.' },
        ],
      },
      {
        q: 'How are stakes calculated?',
        a: [
          { p: 'Kelly criterion (quarter Kelly):' },
          { code: 'stake = edge / (odds − 1) × bankroll × 25%' },
          { p: 'Hard cap: never more than 5% bankroll per bet. This is the MT24 guardrail — cannot be overridden.' },
        ],
      },
    ],
  },
  {
    id: 'usage',
    title: '📱 Using the App',
    items: [
      {
        q: 'How do I get V3 predictions for a match?',
        a: [
          { code: 'Matches → select match → Analyze →\nPrediction tab → click Fetch Stats' },
          { p: 'V3 generates automatically. Match card updates with probability bar.' },
        ],
      },
      {
        q: 'How do I enter China lottery odds?',
        a: [
          { p: 'Match → Bets tab → China Lottery section → Upload photo → select 1–2 screenshots from the China lottery app. Claude reads the photos and fills all odds automatically. Edge% calculates instantly for every market.' },
          { p: 'Odds sync to all your devices via cloud.' },
        ],
      },
      {
        q: 'How do I enter Indonesia odds?',
        a: [{ p: 'Bets tab → Indonesia section → paste raw text from your Indonesia app → Parse odds. Handicap and total goals populate automatically.' }],
      },
      {
        q: 'How do I record and settle bets?',
        a: [
          { p: 'After odds are entered, Portfolio Suggestion shows recommended bets. Adjust stakes if needed.' },
          { p: 'Click Record all bets. After the match, go to My Bets → Settle → mark won/lost.' },
        ],
      },
      {
        q: 'How do I use METIS for bet advice?',
        a: [
          { p: 'Type your intended bets in plain text:' },
          { code: '"法国 4球 5.0 x 50, 3-1 9.0 x 50"' },
          { p: 'METIS analyzes edge%, flags risks, recommends alternatives. Access via ⚡ button or METIS tab in match view.' },
        ],
      },
    ],
  },
  {
    id: 'responsible',
    title: '⚠ Responsible Betting',
    items: [
      {
        q: 'What is the MT24 guardrail?',
        a: [{ p: 'Hard rule: never bet more than 5% of bankroll on a single selection. METIS enforces this in Kelly sizing. Cannot be overridden.' }],
      },
      {
        q: 'How should I size my bets?',
        a: [
          { p: 'Follow quarter Kelly:' },
          { code: 'stake = edge / (odds − 1) × bankroll × 25%' },
          { p: 'Higher edge → larger stake automatically. Never deviate significantly without good reason.' },
        ],
      },
      {
        q: 'What does METIS not know?',
        a: [
          { p: 'Team news from the last few hours, weather, referee tendencies, player motivations, any information not in the stats database.' },
          { p: 'Always check team news before kickoff.' },
        ],
      },
    ],
  },
  {
    id: 'technical',
    title: '🔧 Technical',
    items: [
      {
        q: 'How often are DC ratings updated?',
        a: [
          { p: 'Manually after each matchday using MLE refit. After matchday 2 (each team has 2+ games) the refit becomes statistically reliable.' },
          { code: 'Run: python3 scripts/fit_dc.py' },
        ],
      },
      {
        q: 'What data does Metis use?',
        a: [{ p: 'API-Football via footystats scraper for xG and match stats. Dixon-Coles ratings fitted on 15,508 international matches (2010–2026). Manual WC2026 results after each matchday.' }],
      },
      {
        q: 'Can other users see my bets?',
        a: [{ p: 'No. Supabase RLS (Row Level Security) ensures only you can see your own bets and odds.' }],
      },
    ],
  },
]

function answerToText(a) {
  return a.map(block =>
    block.p || block.code || (block.list || []).join(' ')
  ).join(' ')
}

export default function FAQ() {
  const [search, setSearch] = useState('')
  const [openItems, setOpenItems] = useState({})

  function toggle(id) {
    setOpenItems(prev => ({ ...prev, [id]: !prev[id] }))
  }

  const term = search.trim().toLowerCase()

  const filtered = SECTIONS.map(section => ({
    ...section,
    items: section.items.filter(item =>
      !term ||
      item.q.toLowerCase().includes(term) ||
      answerToText(item.a).toLowerCase().includes(term)
    ),
  })).filter(section => section.items.length > 0)

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: '24px 16px 48px' }}>
      <h1 style={{
        fontFamily: "'IBM Plex Mono', monospace",
        fontSize: 22,
        fontWeight: 700,
        color: 'var(--color-text-primary)',
        letterSpacing: '0.05em',
        marginBottom: 6,
      }}>
        FAQ
      </h1>
      <p style={{ color: 'var(--color-text-secondary)', fontSize: 13, marginBottom: 20 }}>
        WC2026 · Metis betting intelligence guide
      </p>

      {/* Search */}
      <input
        type="text"
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="Search FAQ..."
        style={{
          width: '100%',
          boxSizing: 'border-box',
          fontFamily: "'Space Grotesk', sans-serif",
          fontSize: 14,
          padding: '10px 14px',
          marginBottom: 16,
          background: 'rgba(17,24,39,0.7)',
          border: '0.5px solid rgba(201,168,76,0.22)',
          borderRadius: 6,
          color: 'var(--color-text-primary)',
          outline: 'none',
        }}
      />

      {filtered.length === 0 && (
        <p style={{ color: 'var(--color-text-secondary)', fontSize: 13, padding: '24px 0' }}>
          No results for &ldquo;{search}&rdquo;
        </p>
      )}

      {filtered.map((section, si) => (
        <div key={section.id} style={{ marginTop: si === 0 ? 0 : 16 }}>
          {/* Section header */}
          <div style={{
            background: '#1A3A6C',
            color: 'white',
            padding: '10px 16px',
            fontSize: 11,
            fontFamily: "'IBM Plex Mono', monospace",
            fontWeight: 500,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
          }}>
            {section.title}
          </div>

          {/* Items */}
          {section.items.map((item, ii) => {
            const id = `${section.id}-${ii}`
            const isOpen = term ? true : !!openItems[id]
            return (
              <div key={id} style={{ borderBottom: '0.5px solid rgba(255,255,255,0.06)' }}>
                {/* Question row */}
                <div
                  onClick={() => !term && toggle(id)}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '14px 16px',
                    cursor: term ? 'default' : 'pointer',
                    gap: 12,
                  }}
                >
                  <span style={{
                    fontSize: 13,
                    fontWeight: 500,
                    color: 'var(--color-text-primary)',
                    fontFamily: "'Space Grotesk', sans-serif",
                    lineHeight: 1.4,
                  }}>
                    {item.q}
                  </span>
                  {!term && (
                    <span style={{
                      fontSize: 14,
                      color: 'rgba(201,168,76,0.5)',
                      flexShrink: 0,
                      fontFamily: 'monospace',
                    }}>
                      {isOpen ? '▾' : '▸'}
                    </span>
                  )}
                </div>

                {/* Answer */}
                {isOpen && (
                  <div style={{ padding: '0 16px 14px' }}>
                    {item.a.map((block, bi) => {
                      if (block.p) return (
                        <p key={bi} style={{
                          fontSize: 13,
                          lineHeight: 1.75,
                          color: 'var(--color-text-secondary)',
                          margin: '0 0 6px',
                          fontFamily: "'Space Grotesk', sans-serif",
                        }}>
                          {block.p}
                        </p>
                      )
                      if (block.code) return (
                        <code key={bi} style={{
                          display: 'block',
                          background: 'rgba(17,24,39,0.9)',
                          fontFamily: "'IBM Plex Mono', monospace",
                          fontSize: 11,
                          padding: '8px 12px',
                          borderRadius: 4,
                          margin: '6px 0',
                          whiteSpace: 'pre',
                          color: 'rgba(201,168,76,0.85)',
                          border: '0.5px solid rgba(201,168,76,0.12)',
                        }}>
                          {block.code}
                        </code>
                      )
                      if (block.list) return (
                        <ul key={bi} style={{ margin: '4px 0 6px', padding: 0, listStyle: 'none' }}>
                          {block.list.map((li, lii) => (
                            <li key={lii} style={{
                              fontSize: 13,
                              lineHeight: 1.75,
                              color: 'var(--color-text-secondary)',
                              paddingBottom: 2,
                              fontFamily: "'Space Grotesk', sans-serif",
                            }}>
                              {li}
                            </li>
                          ))}
                        </ul>
                      )
                      return null
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}
