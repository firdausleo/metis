# Metis — Session Entry Point

## Read in this order every session
1. MASTER.md (this file — 2 min)
2. TASKS.md (what to build — 2 min)
3. METIS-BIBLE.md (full reference)
4. Relevant section only as needed

## Current Status
Stage: 4 — AI Roles
Last commit: 1160737
Next: Supabase tables + CF Worker /api/analyze + AI role outputs

## Stage 4 Prompts Queued
- Prompt 7A: Supabase ai_roles + role_skills + role_outputs tables (Leo runs SQL)
- Prompt 7B: CF Worker /api/analyze — 11 roles, Haiku parallel + Sonnet sequential
- Prompt 7C: Analysis screen AI tab — role output cards + composite score

## Critical Facts
Admin UUID: 4a6e1f29-e18b-4fd3-9a7e-cec54501db54
Repo: github.com/firdausleo/metis
Supabase: wmxhcwellqtagpndpyhk.supabase.co
Timezone: Always Beijing (UTC+8)

## Algorithm (Stage 3 complete — lib/poisson.js + lib/evEngine.js)
- runModels(homeStats, awayStats, { dixonColes }) → { v1, v2, divergence }
- stripVig(oddsArray) → { trueProbs, vigPct, fairOdds }
- calcEV(modelProb, decOdds, marketProb) → { evDisplay, edgePct, colour, recommend }
- calcStake(modelProb, decOdds) → { fraction, pct, label }

## Stage 4 high-risk tasks — Leo must be present for:
- Task 16: ai_roles + role_skills SQL (⛔)
- Task 21: CF Worker /api/analyze deployment (⛔)

## Never violate
MT03: Claude API via CF Worker only — never frontend
MT05: user_bets isolated per user
MT06: reject < 5 games
MT07: V1 + V2 always together
MT10: service role key in CF secrets only
MT16: Build must pass before commit
MT22: Always strip vig before edge
MT25: CF Worker timeout 30s max
