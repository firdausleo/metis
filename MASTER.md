# Metis — Session Entry Point

## Read in this order every session
1. MASTER.md (this file — 2 min)
2. TASKS.md (what to build — 2 min)
3. METIS-BIBLE.md (full reference)
4. Relevant section only as needed

## Current Status
Stage: 3 — Core Algorithm
Last commit: ba8170a
Next: Poisson engine + EV calculator + live matrix tab

## Stage 3 Prompts Queued
- Prompt 6A: src/lib/poisson.js — V1 + V2 Poisson model
- Prompt 6B: src/lib/evEngine.js — vig strip + edge + Kelly
- Prompt 6C: Matrix tab live + total goals anchor

## Critical Facts
Admin UUID: 4a6e1f29-e18b-4fd3-9a7e-cec54501db54
Repo: github.com/firdausleo/metis
Supabase: wmxhcwellqtagpndpyhk.supabase.co
Timezone: Always Beijing (UTC+8)
Algorithm: V1 (overall) + V2 (away factor) — always both (MT07)
Rolling window: 5 games, recency weighted [0.10,0.15,0.20,0.25,0.30]
Home advantage: 1.15 (WC calibrated)
League avg goals: 1.5 (tournament baseline)

## New in Stage 2 (ba8170a)
- team_stats columns: home_goals_avg, away_goals_avg, data_source
- /api/sync-stats CF Worker (bulk footystats scrape, admin-only)
- MatchCard: FormDots + StatsBadge
- MatchAnalysis: full Stats tab with LambdaBlock + SplitBar + FormRow
- Matrix/Value/Portfolio tabs: placeholders ready to fill in Stage 3

## Never violate
MT03: Claude API via CF Worker only
MT05: user_bets isolated per user
MT06: reject < 5 games (error, do not estimate)
MT07: V1 + V2 always shown together
MT11: fontSize 16px minimum on inputs
MT16: Build must pass before commit
MT22: Always strip vig before edge calc
MT25: CF Worker timeout 30s max
