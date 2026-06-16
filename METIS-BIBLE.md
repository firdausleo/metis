# METIS-BIBLE v1.0
## World Cup 2026 · Bet Intelligence · Complete Reference

---

## Part 1: Mission & Vision

**Metis** is a private betting intelligence tool for WC2026, built for a Chinese user base (primary timezone: Beijing UTC+8). It combines statistical modelling (Poisson distribution), multi-perspective AI analysis (Claude via Cloudflare Workers), and a clean mobile-first dark UI to surface positive expected value (+EV) bet recommendations.

**Mission**: Surface +EV bets by combining rigorous statistical modelling with structured AI analysis across 11 specialist roles.

**Target user**: Admin/analyst (Leo) + invited users. Not a public product.

**North Star metric**: Model accuracy > 55% on primary picks over the tournament.

**Non-goals**: Live odds feed (manual entry only), real-money integration, tipster service.

---

## Part 2: System Architecture

```
┌─────────────────────────────────────────────────────┐
│            React/Vite SPA (CF Pages)                │
│  /auth · / · /matches · /matches/:id                │
│  /matches/:id/odds · /matches/:id/bets              │
│  /my-bets · /settings                               │
└────────────────────┬────────────────────────────────┘
                     │ @supabase/supabase-js (anon key)
┌────────────────────▼────────────────────────────────┐
│         Supabase (wmxhcwellqtagpndpyhk)             │
│  Auth · matches · bets · team_stats                 │
│  ai_roles · role_skills · role_outputs              │
│  role_accuracy                                      │
└────────────────────┬────────────────────────────────┘
                     │ service role key (Workers only)
┌────────────────────▼────────────────────────────────┐
│          Cloudflare Workers (API layer)             │
│  /api/scrape   — footystats → team_stats            │
│  /api/analyze  — Claude API → role_outputs          │
│  /api/odds     — odds ingestion + vig calc          │
└─────────────────────────────────────────────────────┘
```

**Why CF Worker for Claude?** MT03 — keeps API key server-side; enables rate limiting, caching, and auth before AI calls. Never call Claude API from the frontend.

**Data flow (analysis cycle):**
1. CF Worker scrapes footystats → writes `team_stats` table
2. Admin inputs bookmaker odds → stored on `matches` row
3. Analyst clicks "Analyse" → CF Worker `POST /api/analyze`
4. Worker runs 11 AI roles (Haiku roles in parallel, Sonnet roles after)
5. Results written to `role_outputs`; frontend reads and renders 4-tab analysis
6. User reviews recommendations, saves bets via Supabase client → `bets` table
7. After match settles → admin updates scores → P&L auto-calculated

**Stack:**
| Layer | Technology |
|-------|-----------|
| Frontend | React 19 + Vite + react-router-dom v7 |
| Styling | CSS custom properties (no CSS framework) |
| Auth | Supabase Auth (email/password) |
| Database | Supabase PostgreSQL |
| API | Cloudflare Workers |
| AI | Claude API (Haiku + Sonnet) |
| Deploy | Cloudflare Pages (frontend) + CF Workers (API) |
| i18n | Custom hook (EN/中文) |

---

## Part 3: Database Schema

### 3.1 matches
```sql
id              uuid PK
external_id     text UNIQUE NOT NULL      -- WC2026-{HOME}-{AWAY}-{DATE}
match_date      timestamptz NOT NULL      -- UTC always (MT04)
stage           text NOT NULL             -- group/r32/r16/qf/sf/3rd/final
group_name      text                      -- A–L, null for knockout
home_team       text NOT NULL             -- Full name
away_team       text NOT NULL
home_team_code  text NOT NULL             -- 3-letter ISO
away_team_code  text NOT NULL
venue           text
city            text
status          text DEFAULT 'upcoming'   -- upcoming/live/finished
home_score      int                       -- null until finished
away_score      int
home_odds       numeric(8,3)              -- decimal, null until set
away_odds       numeric(8,3)
draw_odds       numeric(8,3)
created_at      timestamptz DEFAULT now()
updated_at      timestamptz DEFAULT now()
```
RLS: public SELECT · admin ALL

### 3.2 bets
```sql
id          uuid PK
user_id     uuid FK → auth.users ON DELETE CASCADE
match_id    uuid FK → matches ON DELETE CASCADE
bet_type    text NOT NULL        -- 1X2/AH/goals/btts
selection   text NOT NULL        -- "home"/"draw"/"away"/"over 2.5" etc.
stake       numeric(10,2) DEFAULT 0
odds        numeric(8,3)         -- decimal
status      text DEFAULT 'pending' -- pending/won/lost/void
pnl         numeric(10,2)        -- null until settled
notes       text                 -- analyst reasoning
created_at  timestamptz DEFAULT now()
```
RLS: user reads/writes own rows only (MT05)

### 3.3 team_stats
```sql
id                  uuid PK
team_code           text NOT NULL
match_id            uuid FK → matches  -- context: upcoming match
games_window        int DEFAULT 5      -- always 5 (MT06)
goals_scored_avg    numeric(5,3)       -- recency-weighted rolling avg
goals_conceded_avg  numeric(5,3)
home_goals_avg      numeric(5,3)       -- home games only
away_goals_avg      numeric(5,3)       -- away games only
form_string         text               -- "WWDLL" latest first
updated_at          timestamptz DEFAULT now()
UNIQUE(team_code, match_id)
```
RLS: public SELECT · admin ALL

---

## Part 3.5: AI Role Tables

### ai_roles
```sql
id           uuid PK
role_number  int UNIQUE NOT NULL
role_name    text NOT NULL
description  text NOT NULL
model        text DEFAULT 'claude-haiku-4-5-20251001'
enabled      boolean DEFAULT true
created_at   timestamptz DEFAULT now()
```

### role_skills
```sql
id          uuid PK
role_id     uuid FK → ai_roles ON DELETE CASCADE
skill_name  text NOT NULL
skill_desc  text
weight      numeric(4,3) DEFAULT 1.0
created_at  timestamptz DEFAULT now()
```

### role_outputs
```sql
id           uuid PK
match_id     uuid FK → matches ON DELETE CASCADE
role_id      uuid FK → ai_roles ON DELETE CASCADE
output_json  jsonb NOT NULL
confidence   numeric(4,3)         -- 0.000–1.000
created_at   timestamptz DEFAULT now()
UNIQUE(match_id, role_id)         -- one output per role per match
```

### role_accuracy
```sql
id              uuid PK
role_id         uuid FK → ai_roles ON DELETE CASCADE
match_id        uuid FK → matches ON DELETE CASCADE
predicted_json  jsonb NOT NULL
actual_json     jsonb            -- filled post-settlement
accuracy_score  numeric(4,3)    -- 0.000–1.000
settled_at      timestamptz
created_at      timestamptz DEFAULT now()
```

All four tables: public SELECT · admin ALL (RLS).

---

## Part 4: The Algorithm

### 4.1 Data Inputs
- Source: `team_stats` table, populated by CF Worker scraper
- Window: 5 most recent competitive games per team (MT06)
- Recency weights (oldest → newest): `[0.10, 0.15, 0.20, 0.25, 0.30]`
- Sum of weights = 1.0
- **Minimum 5 games required** — throw error if fewer available, do not estimate

Weighted average formula:
```
weighted_avg = Σ(weight_i × value_i)  for i in [0..4]
```

### 4.2 V1 Model — Overall Rating

Uses all games (home + away combined):
```
λ_home = attack_home × defense_away_factor × HOME_ADVANTAGE
λ_away = attack_away × defense_home_factor

attack_X          = X.goals_scored_avg         (recency-weighted)
defense_Y_factor  = league_avg_goals / Y.goals_conceded_avg
HOME_ADVANTAGE    = 1.15                        (15% uplift, WC calibrated)
league_avg_goals  = 1.5                         (tournament baseline)
```

Score matrix P(home=i, away=j) for i,j in 0..6:
```
P(i,j) = Poisson(i | λ_home) × Poisson(j | λ_away)
Poisson(k | λ) = (λ^k × e^−λ) / k!
```

Result probabilities:
```
P(home win) = Σ P(i,j) where i > j
P(draw)     = Σ P(i,j) where i = j
P(away win) = Σ P(i,j) where i < j
```
These three must sum to 1.0 ± 0.001.

### 4.3 V2 Model — Away Factor Correction

Same as V1 but adjusts the away team's expected goals using their home/away split:
```
away_scoring_factor = team.away_goals_avg / team.goals_scored_avg

If away_scoring_factor < 0.6:  team struggles away → downward correction
If away_scoring_factor > 0.9:  team travels well  → upward correction

λ_away_v2 = λ_away × away_scoring_factor
```

Both V1 and V2 always displayed together (MT07). When they diverge > 8 percentage points on any outcome, V2 is the primary recommendation with the divergence flagged.

### 4.4 Dixon-Coles Correction (Optional Toggle)

Corrects Poisson's underestimate of low-score results (0-0, 1-0, 0-1, 1-1):
```
Correction factors (ρ = 0.1):
  P(0,0) ×= (1 - λ_home × λ_away × ρ)
  P(1,0) ×= (1 + λ_away × ρ)
  P(0,1) ×= (1 + λ_home × ρ)
  P(1,1) ×= (1 - ρ)
  All others: unchanged
```
Default: **OFF** (MT21). UI toggle clearly labelled "Dixon-Coles correction".

### 4.5 Total Goals Model

```
λ_total = λ_home + λ_away  (or λ_home_v2 + λ_away_v2 for V2)

P(over N.5)  = 1 - CDF_Poisson(N, λ_total)
P(under N.5) = CDF_Poisson(N, λ_total)

CDF_Poisson(N, λ) = Σ Poisson(k|λ) for k=0..N
```

Lines to calculate: 0.5, 1.5, 2.5, 3.5, 4.5

**Anchor line**: the line whose over/under is closest to 50/50 — display prominently.

### 4.6 EV Calculation (MT22)

Must always strip vig before calculating edge. Never compare model probability directly to raw implied probability.

```
Step 1: Model probability
  p = P(outcome) from Poisson matrix

Step 2: Bookmaker decimal odds → raw implied probability
  p_raw = 1 / decimal_odds

Step 3: Sum all raw implied probs in the market
  vig_total = Σ p_raw  (will be > 1.0, e.g. 1.05 = 5% vig)

Step 4: Vig-stripped true market probability
  p_market = p_raw / vig_total

Step 5: Raw EV
  EV = (p × decimal_odds) - 1

Step 6: Edge (percentage)
  edge = (p - p_market) / p_market × 100
```

Display rules:
- Edge ≥ 5%:    GREEN  — recommend (MT23)
- Edge 1–4.9%:  AMBER  — marginal, note only
- Edge < 0%:    RED    — do not bet

### 4.7 Kelly Criterion

```
Full Kelly:      f* = (b×p - q) / b
Fractional:      stake = f* × 0.25 × bankroll
Hard cap:        max stake = 5% of bankroll (MT24)

where:
  b = decimal_odds - 1
  p = model probability (from Poisson)
  q = 1 - p
```

If Kelly suggests < 1% bankroll: display as "marginal — skip or min stake".
If Kelly < 0: bet has negative EV — do not show recommendation.

---

## Part 5: Design System

### 5.1 Typography

| Token | Typeface | Usage |
|-------|----------|-------|
| `--font-display` | Barlow Condensed | App name, page headings, stat numbers |
| `--font-ui` | DM Sans | All body text, labels, inputs, nav |

Imports:
```css
@import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;500;600&family=DM+Sans:wght@400;500&display=swap');
```

### 5.2 Color Tokens

**Backgrounds**
| Token | Hex | Usage |
|-------|-----|-------|
| `--color-bg` | `#0a0a0a` | Page background |
| `--color-bg-secondary` | `#141414` | Nav bars, sidebars |
| `--color-bg-card` | `#1a1a1a` | Cards, modals |
| `--color-bg-elevated` | `#222222` | Elevated cards, dropdowns |
| `--color-bg-overlay` | `rgba(0,0,0,0.7)` | Modal overlays |

**Borders**
| Token | Value | Usage |
|-------|-------|-------|
| `--color-border` | `rgba(255,255,255,0.08)` | Default borders |
| `--color-border-hover` | `rgba(255,255,255,0.15)` | Hover state borders |
| `--color-border-strong` | `rgba(255,255,255,0.25)` | Focused inputs |

**Text**
| Token | Hex | Usage |
|-------|-----|-------|
| `--color-text-primary` | `#f0f0f0` | Body text |
| `--color-text-secondary` | `#888888` | Labels, captions |
| `--color-text-muted` | `#555555` | Placeholder, disabled |
| `--color-text-inverse` | `#0a0a0a` | Text on accent buttons |

**Accent**
| Token | Value | Usage |
|-------|-------|-------|
| `--color-accent` | `#00e5a0` | Primary brand, active states |
| `--color-accent-dim` | `rgba(0,229,160,0.12)` | Accent backgrounds |
| `--color-accent-hover` | `#00c98a` | Accent hover |

**Semantic**
| Token | Value |
|-------|-------|
| `--color-success` | `#00e5a0` |
| `--color-success-dim` | `rgba(0,229,160,0.12)` |
| `--color-danger` | `#ff4d4d` |
| `--color-danger-dim` | `rgba(255,77,77,0.12)` |
| `--color-warning` | `#ffb547` |
| `--color-warning-dim` | `rgba(255,181,71,0.12)` |
| `--color-info` | `#4db8ff` |
| `--color-info-dim` | `rgba(77,184,255,0.12)` |

**Edge Traffic Lights**
| Token | Value | Meaning |
|-------|-------|---------|
| `--color-edge-green` | `#00e5a0` | Edge ≥ 5% — bet |
| `--color-edge-amber` | `#ffb547` | Edge 0–4.9% — marginal |
| `--color-edge-red` | `#ff4d4d` | Edge < 0% — skip |

### 5.3 Spacing & Shape

| Token | Value |
|-------|-------|
| `--radius-sm` | `6px` |
| `--radius-md` | `10px` |
| `--radius-lg` | `16px` |
| `--radius-full` | `9999px` |
| `--touch-target` | `44px` |
| `--nav-height-top` | `56px` |
| `--nav-height-bottom` | `64px` |

### 5.4 Layout Rules

- Max content width: **720px**, centered (`margin: 0 auto`)
- Mobile breakpoint: **768px** (`@media (min-width: 768px)`)
- Desktop: fixed top nav (56px) → `padding-top: 56px` on `.app-content`
- Mobile: fixed bottom nav (64px + safe-area) → `padding-bottom: 80px` on `.app-content`
- Page padding: `24px` desktop · `16px` mobile
- Cards: `--color-bg-card` background + `--color-border` border + `--radius-md`
- Section gap: `12px` between cards, `24px` between sections

### 5.5 Component Rules

- **All form inputs**: `font-size: 16px` minimum — prevents iOS auto-zoom (MT11)
- **All interactive elements**: `min-height: var(--touch-target)` = 44px (MT12)
- **Loading states**: spinner animation + `disabled` attribute + `opacity: 0.7`
- **Error states**: `--color-danger-dim` background + `--color-danger` border + danger text
- **Active nav items**: `--color-accent` text + `--color-accent-dim` background
- **Stat numbers**: `--font-display`, 28–36px, `--color-text-primary`
- **Edge badges**: pill shape (`--radius-full`), 12px text, traffic-light colour
- **Probability bars**: accent fill on dark track, percentage label inline

---

## Part 6: AI Roles

All roles called through CF Worker → Claude API. **Never direct from frontend** (MT03).

Roles 1, 2, 4, 5, 6, 7, 8, 9 run in parallel (`Promise.all` in CF Worker).
Role 3 (Sonnet) runs after all Haiku roles complete — receives their full output as context.
Role 10 (Composite Scorer) runs after Role 3.
Role 11 (Learning Loop) runs post-settlement only.

| # | Name | Model | Purpose |
|---|------|-------|---------|
| 1 | Statistical Validator | Haiku | Validates Poisson inputs; checks team_stats integrity, rolling window data quality, flags missing data |
| 2 | Form Intelligence | Haiku | Analyses 5-game rolling form with recency weighting; identifies momentum shifts, streaks |
| 3 | Deep Analysis | Sonnet | Full narrative match analysis; synthesises all role outputs into final recommendation with reasoning |
| 4 | Tournament Context | Haiku | WC-specific factors: group stage math, elimination pressure, rest days, travel, squad rotation risk |
| 5 | Market Intelligence | Haiku | Line movement analysis, market efficiency signals, where sharp money is going |
| 6 | Risk Manager | Haiku | Applies Kelly criterion, portfolio exposure check, bankroll protection; outputs stake recommendation |
| 7 | Tactical Analyst | Haiku | Formation matchups, pressing style, set-piece threat, defensive shape, key player influence |
| 8 | Head-to-Head Historian | Haiku | H2H records, venue patterns, historical score tendencies, psychological precedents |
| 9 | Motivation Analyst | Haiku | Scores team motivation: must-win vs already-qualified, group permutations, rivalry, pride factors |
| 10 | Composite Scorer | Haiku | Aggregates all role outputs into single confidence score 0–100; explains drivers |
| 11 | Learning Loop | Sonnet | Post-settlement accuracy tracking; identifies systematic biases; feeds back into confidence calibration |

### Role Output Schema (role_outputs.output_json)
```json
{
  "role": 1,
  "summary": "One-paragraph narrative",
  "signals": ["positive signal", "negative signal"],
  "confidence": 0.72,
  "recommendation": "home_win | away_win | draw | over | under | null",
  "flags": ["missing_away_stats", "small_sample"]
}
```

---

## Part 7: Betting Strategy

### 7.1 Decision Framework

1. **Qualify**: Does the match have `team_stats` for both teams (≥5 games)?
2. **Model**: Run V1 + V2. Note agreement vs divergence.
3. **AI**: Run all 11 roles. Check composite score (Role 10 output).
4. **Odds**: Input bookmaker odds. Strip vig. Calculate edge per market.
5. **Filter**: Only recommend bets with edge ≥ 5% (MT23 hard floor).
6. **Size**: Apply fractional Kelly (×0.25), cap at 5% bankroll (MT24).
7. **Portfolio check**: Avoid stacking correlated bets from the same match.
8. **Pre-commit**: Walk through checklist before placing any bet.
9. **Record**: Save to My Bets via UI. Never manually track outside the app.
10. **Review**: Check P&L; review Role 11 accuracy reports after settlement.

### 7.2 Bet Types
- **1X2**: Match result. Higher vig, use only with clear edge.
- **Asian Handicap**: Most efficient market. Preferred type.
- **Total Goals**: Well-modelled by Poisson. Second-best market.
- **BTTS**: Use sparingly — Poisson correlation assumption is weakest here.

### 7.3 Market Priority
1. Asian Handicap (lowest vig, most efficient)
2. Total Goals (well-modelled)
3. 1X2 (use when edge is ≥ 8% to justify higher vig)
4. BTTS (only with Role 7 tactical confirmation)

### 7.4 Red Lines
- Never bet on a match without AI analysis complete
- Never bet if team_stats missing or < 5 games
- Never exceed 5% bankroll on any single bet
- Never place a bet with negative edge (even "feels right")
- Never combine 2+ correlated bets from same match in a parlay

---

## Part 8: Guardrails (MT01–MT25)

*Full registry — see also GUARDRAILS.md*

| ID | Rule | When to check |
|----|------|---------------|
| MT01 | Audit first: read all relevant files before editing any code | Every coding task |
| MT02 | All match times stored as UTC in DB; convert to Beijing only at display layer | Schema changes, any date handling |
| MT03 | Claude API called via CF Worker only — never directly from frontend | Any AI feature |
| MT04 | Never commit `.env`, `.env.local`, or service role keys | Every commit |
| MT05 | user_bets rows isolated per user via RLS — no cross-user data access | Any bets table work |
| MT06 | Rolling window = exactly 5 games; reject and error if fewer available | Algorithm work |
| MT07 | V1 and V2 models always shown together — never one alone | UI analysis screens |
| MT08 | Displayed probabilities capped: never show < 5% or > 95% | Any probability display |
| MT09 | All odds stored in decimal format internally; convert at display layer only | Odds input/storage |
| MT10 | Service role key stays in CF Workers secrets and `.env.local` only | Deployment |
| MT11 | All form inputs: `font-size: 16px` minimum (prevents iOS auto-zoom) | Any input field |
| MT12 | All interactive elements: `min-height: 44px` (var(--touch-target)) | Any button/tap target |
| MT13 | Use `getFlag()` / `TEAM_FLAGS` for all team name → emoji lookups; no inline hardcoding | Any team display |
| MT14 | All match times shown to user via `toBeijingTime()` — never raw UTC | Any date display |
| MT15 | EV displayed as percentage with sign: "+12.4%" green, "−3.1%" red | EV display |
| MT16 | `npm run build` must pass zero errors before every commit | Every commit |
| MT17 | `git pull` before every `git push`; resolve conflicts locally | Every push |
| MT18 | One logical change per commit; never bundle unrelated work | Every commit |
| MT19 | No `console.log` in production code; remove before committing | Code review |
| MT20 | Admin UUID (4a6e1f29-…) used only in SQL/RLS and seed scripts; never in React | Any admin feature |
| MT21 | Dixon-Coles correction: optional toggle, default OFF; UI label required | Algorithm/UI |
| MT22 | Always strip bookmaker vig before calculating edge (never raw implied vs model) | EV calculation |
| MT23 | Minimum edge threshold for bet recommendation: 5% (hard floor) | Bet recommendations |
| MT24 | No single bet to exceed 5% of bankroll (Kelly hard cap) | Stake calculation |
| MT25 | CF Worker timeout: 30 seconds max; fail fast with structured JSON error | CF Worker |

---

## Part 9: Pre-Commit Harness (H01–H35)

*Full checklist — see also HARNESS.md*

Run before every significant commit. Full harness before every deploy.

### Code Quality (H01–H05)
- H01: `npm run build` completes with zero errors
- H02: ESLint passes with zero warnings on changed files
- H03: No `console.log` statements in changed files
- H04: No hardcoded admin UUID in React components
- H05: No API keys, secrets, or tokens in any committed file

### Data Integrity (H06–H15)
- H06: `matches.external_id` has UNIQUE constraint in DB
- H07: All `match_date` values are valid UTC ISO 8601 strings
- H08: Seed count = 104 (72 group + 32 knockout) — `SELECT COUNT(*) FROM matches`
- H09: Group stage breakdown: 12 groups × 6 = 72 — verify per group
- H10: Knockout: r32=16, r16=8, qf=4, sf=2, 3rd=1, final=1 = 32 total
- H11: No duplicate `external_id` values — `SELECT external_id, COUNT(*) GROUP BY 1 HAVING COUNT(*) > 1`
- H12: All 44 teams listed in `TEAM_FLAGS` constant
- H13: `getFlag()` returns a flag for every team code present in `matches`
- H14: RLS enabled on all public tables — check in Supabase Auth > Policies
- H15: Admin UUID matches in all write policies

### Algorithm (H16–H22)
- H16: Rolling window rejects matches with < 5 games (throws, does not estimate)
- H17: V1 probabilities sum to 100% ± 0.5 percentage points
- H18: V2 probabilities sum to 100% ± 0.5 percentage points
- H19: No displayed probability below 5% or above 95%
- H20: Vig stripped before edge calculation in `evEngine.js`
- H21: `EV = (p × decimal_odds) - 1` formula matches Part 4.6
- H22: Kelly output capped at 5% bankroll before display

### UI & Accessibility (H23–H30)
- H23: All form `input` elements have `font-size: 16px` minimum
- H24: All `button` and tappable elements have `min-height: 44px`
- H25: NavBar hidden on `/auth` route
- H26: All protected routes redirect unauthenticated users to `/auth`
- H27: `signOut()` navigates to `/auth` (not just clears state)
- H28: Match times displayed in Beijing time via `toBeijingTime()`
- H29: Language toggle (EN/中文) rerenders all text immediately
- H30: Loading states: spinner visible, button disabled during async ops

### Deployment (H31–H35)
- H31: `ANTHROPIC_API_KEY` set in CF Workers secrets (not in code)
- H32: CF Worker CORS headers include the Pages domain
- H33: CF Worker returns structured JSON on all error paths
- H34: CF Pages `_redirects`: `/* /index.html 200` present (SPA routing)
- H35: End-to-end smoke test: login → /matches → analysis → save bet → /my-bets → logout

---

## Part 10: Deployment

### 10.1 Frontend — Cloudflare Pages

```bash
npm run build
# Connect GitHub repo to CF Pages dashboard
# Build command:   npm run build
# Build output:    dist
# Root directory:  (blank)
# Node version:    20
```

Add `_redirects` file in `/public`:
```
/* /index.html 200
```

Environment variables (CF Pages → Settings → Environment Variables):
```
VITE_SUPABASE_URL      = https://wmxhcwellqtagpndpyhk.supabase.co
VITE_SUPABASE_ANON_KEY = sb_publishable_...
```

### 10.2 Backend — Cloudflare Workers

```bash
cd workers/metis-api
wrangler secret put ANTHROPIC_API_KEY
wrangler secret put SUPABASE_URL
wrangler secret put SUPABASE_SERVICE_KEY
wrangler deploy
```

Worker CORS — allow from CF Pages domain:
```javascript
'Access-Control-Allow-Origin': 'https://metis.pages.dev'
```

Workers endpoint structure:
- `POST /api/analyze` — body: `{ match_id }` → runs 11 roles → returns role_outputs
- `POST /api/scrape`  — body: `{ team_codes[] }` → fetches footystats → updates team_stats
- `POST /api/odds`    — body: `{ match_id, home, draw, away }` → updates matches

### 10.3 Supabase

- Anon key: in frontend `.env.local` + CF Pages env vars (safe — public by design)
- Service role key: CF Workers secrets + `.env.local` only. **Never commit.**
- Enable Email provider in Auth → Providers
- Add site URL in Auth → URL Configuration: `https://metis.pages.dev`

---

## Part 11: Current State

*Detailed report — see also STATE-REPORT.md*

### Completed (Stage 1)
- Project scaffold: React/Vite, Supabase client, routing, folder structure
- Supabase schema: `matches` + `bets` tables, RLS policies, indexes
- Auth screen: Login/Signup with language toggle (EN/中文)
- Navigation: mobile bottom bar + desktop top bar, active route highlighting
- Dashboard: welcome + 3 placeholder stat cards
- Seed script: 104 WC2026 fixtures seeded (72 group + 32 knockout)
- i18n: dual-language support, `useTranslation` + `setLanguage`
- CSS design system: full token set, responsive nav classes
- `dateUtils.js`: Beijing time conversion helpers
- `teamFlags.js`: All 44 teams with emoji flags

### Not Yet Started (Stage 2+)
- CF Worker footystats scraper
- `team_stats` table + rolling window calculator
- Matches screen `/matches` with real data
- Match analysis screen `/matches/:id` (4 tabs)
- Probability heatmap
- EV engine (`evEngine.js`)
- Poisson model (`poisson.js`)
- AI roles integration
- Odds input (admin)
- My Bets with real data + P&L
- CF Pages + CF Workers deployment

---

*METIS-BIBLE v1.0 — constructed 2026-06-08*
*Update this document when architecture, algorithm, or guardrails change.*
