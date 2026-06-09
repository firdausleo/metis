# Metis — Session Entry Point

## Read in this order every session
1. MASTER.md (this file — 2 min)
2. TASKS.md (what to build — 2 min)
3. METIS-BIBLE.md (full reference)
4. Relevant section only as needed

## Current Status
Stage: 7 — Dashboard + Intelligence
Last commit: 8e95352 — Task 30 pre-bet checklist
Live URL: https://metis.tiga6.com
Tournament: WC2026 started June 11, 2026

## Completed Stages
- Stage 1 ✅ Scaffold + Auth + 104 fixtures seeded
- Stage 2 ✅ Match list + sync-stats CF Worker + API-Football integration
- Stage 3 ✅ Poisson engine (poisson.js) + EV calculator (evEngine.js) + Monte Carlo
- Stage 4 ✅ 11 AI roles + /api/analyze CF Worker + composite score
- Stage 5 ✅ Odds input + vig strip + EV/edge display + Kelly calculator
- Stage 6 ✅ Bets table + Place Bet flow + My Bets screen + settlement Worker
- Stage 6+ ✅ Bilingual EN/ZH + Dashboard real data + API-Football rolling window

## What's Live at metis.tiga6.com
- Matches screen with form dots + stats badges
- Match analysis: Stats / Matrix / Value / Portfolio / AI Roles tabs
- Poisson V1 + V2 matrix with Monte Carlo (10k/100k)
- AI Roles: 11 roles, composite score 0-100, structured verdict
- Value tab: odds input, vig strip, EV%, edge traffic light, Kelly stake
- My Bets: place bets, P&L tracking, auto-settlement
- Dashboard: live matches today, active bets, P&L
- Language toggle: EN / 中文

## Critical Facts
Admin UUID: 4a6e1f29-e18b-4fd3-9a7e-cec54501db54
Repo: github.com/firdausleo/metis
Supabase: wmxhcwellqtagpndpyhk.supabase.co
Timezone: Always Beijing (UTC+8)
Algorithm: V1 + V2 always together (MT07)
Rolling window: 5 games, recency weighted, API-Football
xG: fixture statistics, competitive games only

## CF Secrets (all set in CF Pages)
VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY (wrangler.toml)
SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
ANTHROPIC_API_KEY, API_FOOTBALL_KEY

## Active Issues (fix next)
1. Task 35 model accuracy tracking
2. Role 11 learning loop

## Model Cost Rules — ENFORCE STRICTLY
Claude Code MUST use: claude-sonnet-4-6
Run now: claude config set model claude-sonnet-4-6
Roles 1,2,4,5,6,7,8,9,10 → claude-haiku-4-5-20251001
Role 3 only → claude-sonnet-4-6
claude-opus-* → NEVER USE EVER

## Never Violate
MT03 MT05 MT06 MT07 MT10 MT16 MT22 MT25
