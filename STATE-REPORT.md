# Metis — Current State Report

*Last updated: 2026-06-08*
*Stage: 2 — Data Pipeline (starting)*

---

## What Is Built (Stage 1 Complete)

### Infrastructure
- [x] React 19 + Vite project scaffold
- [x] react-router-dom v7 routing
- [x] Supabase JS client (`src/lib/supabase.js`)
- [x] `.env.local` with project URL + anon key (git-ignored)
- [x] `package.json`: `"type": "module"`, all deps installed

### Authentication
- [x] `useAuth` hook — `signIn`, `signUp`, `signOut`, user state
- [x] `ProtectedRoute` component — redirects unauthenticated users
- [x] Auth page (`/auth`) — Login/Sign Up tabs, language toggle
- [x] Error messages in EN and 中文
- [x] Loading spinner on submit
- [x] Font-size 16px on inputs (MT11 ✓)
- [x] Touch targets 44px on buttons (MT12 ✓)

### Navigation
- [x] `NavBar` component — dual-mode (mobile bottom / desktop top)
- [x] Active route highlighting via `useLocation()`
- [x] `signOut()` → navigates to `/auth`
- [x] NavBar hidden on `/auth` route
- [x] Safe area inset on mobile bottom nav

### Pages (Scaffolded)
- [x] Dashboard (`/`) — welcome + 3 stat cards (all zeroes)
- [x] Matches (`/matches`) — placeholder
- [x] MatchAnalysis (`/matches/:id`) — placeholder
- [x] MatchOdds (`/matches/:id/odds`) — placeholder
- [x] BetRecommendations (`/matches/:id/bets`) — placeholder
- [x] MyBets (`/my-bets`) — placeholder
- [x] Settings (`/settings`) — placeholder

### Database
- [x] `matches` table created in Supabase
- [x] `external_id` UNIQUE constraint added
- [x] RLS enabled: public read, admin write
- [x] `bets` table scaffolded in `schema.sql`
- [x] 104 WC2026 fixtures seeded (72 group stage + 32 knockout slots)
- [x] Seed script idempotent (upsert on `external_id`)

### Utilities
- [x] `src/lib/i18n.js` — `useTranslation`, `setLanguage`, EN/中文 translations
- [x] `src/lib/dateUtils.js` — `toBeijingTime()`, `isToday()`, `isUpcoming()`
- [x] `src/lib/teamFlags.js` — `TEAM_FLAGS`, `getFlag()`, `getTeamDisplay()`

### Design System
- [x] Full CSS token set in `src/index.css`
- [x] Barlow Condensed + DM Sans (Google Fonts)
- [x] Responsive NavBar CSS classes
- [x] App content padding classes

### Documentation
- [x] `METIS-BIBLE.md` — complete 11-part reference
- [x] `MASTER.md` — session entry point
- [x] `CLAUDE.md` — Claude Code session setup
- [x] `TASKS.md` — full stage-by-stage task queue
- [x] `GUARDRAILS.md` — MT01–MT25 registry
- [x] `HARNESS.md` — H01–H35 pre-commit checklist
- [x] `DESIGN.md` — full design system reference
- [x] `STATE-REPORT.md` — this file
- [x] `supabase/schema.sql` — full DDL with RLS
- [x] `supabase/roles-schema.sql` — AI roles tables DDL

---

## What Is NOT Built

### Stage 2 — Data Pipeline
- [ ] `supabase/team_stats` table (not yet created in DB)
- [ ] CF Worker footystats scraper
- [ ] Rolling window calculator (`src/lib/rollingWindow.js`)
- [ ] `team_stats` auto-population
- [ ] Matches screen with real data from DB
- [ ] Match cards with team flags + stats preview
- [ ] Confidence indicator component
- [ ] Manual stats override (admin)

### Stage 3 — Core Algorithm
- [ ] `src/lib/poisson.js` — Poisson model, V1 + V2 matrices
- [ ] `src/lib/evEngine.js` — vig stripping, edge, Kelly
- [ ] Score matrix generator (7×7 grid)
- [ ] Match analysis screen (4 tabs: Overview, Stats, Probability, Odds)
- [ ] Probability heatmap component
- [ ] Total goals anchor display
- [ ] Dixon-Coles toggle
- [ ] Confidence display component

### Stage 4 — AI Roles
- [ ] AI roles tables in DB (run `supabase/roles-schema.sql`)
- [ ] CF Worker `metis-api` project created
- [ ] 11 AI role implementations
- [ ] `/api/analyze` endpoint
- [ ] Role output display in analysis UI

### Stage 5 — Odds + Portfolio
- [ ] Odds input screen (admin)
- [ ] Vig stripping display
- [ ] Edge traffic light component
- [ ] Portfolio builder
- [ ] Outcome stress test table
- [ ] Pre-commit checklist UI
- [ ] Save to My Bets flow

### Stage 6 — My Bets + P&L
- [ ] My Bets screen with real data
- [ ] Result settlement (admin)
- [ ] P&L calculation per user
- [ ] Model accuracy tracking (Role 11)
- [ ] Dashboard stat cards with real data

### Stage 7-8 — Deploy + Harden
- [ ] Knockout bracket admin tool
- [ ] Cloudflare Pages deployment
- [ ] CF Workers deployment
- [ ] `_redirects` file for SPA routing
- [ ] Full H01–H35 harness pass
- [ ] Mobile polish pass
- [ ] Learning loop (Role 11)

---

## Known Issues / Blockers

| Issue | Status | Notes |
|-------|--------|-------|
| Supabase service role key needed for seed script | Resolved via `.env.local` | Do not commit key |
| Supabase MCP tools return permission error | Known | Use SQL Editor directly for DDL |
| AI roles tables not yet in DB | Pending | Run `supabase/roles-schema.sql` in SQL Editor |
| CF Worker not yet created | Pending | Needed for Stage 4 |
| Matches page shows placeholder only | Pending | Needs DB query + team_stats |

---

## Metrics

| Metric | Current | Target |
|--------|---------|--------|
| Matches in DB | 104 | 104 ✓ |
| Teams with stats | 0 | 44 |
| AI roles configured | 0 | 11 |
| Build status | ✓ passing | ✓ |
| Harness checks passing | H01, H16, H23-H30 | H01–H35 |
| Model accuracy | N/A | > 55% |

---

## Next Actions

1. Run `supabase/roles-schema.sql` in Supabase SQL Editor (creates 4 AI role tables)
2. Create `team_stats` table DDL and add to `schema.sql`
3. Build CF Worker project (`wrangler init metis-api`)
4. Implement footystats scraper in CF Worker
5. Build Matches page (`/matches`) with real data from `matches` table
