# Metis — Session Entry Point

## Read in this order every session
1. MASTER.md (this file — 2 min)
2. TASKS.md (what to build — 2 min)
3. METIS-BIBLE.md (full reference)
4. Relevant section only as needed

## Current Status
Stage: 2 — Data Pipeline
Last commit: c428f30
Next: CF Worker footystats scraper

## Critical Facts
Admin UUID: 4a6e1f29-e18b-4fd3-9a7e-cec54501db54
Repo: github.com/firdausleo/metis
Supabase: wmxhcwellqtagpndpyhk.supabase.co
Timezone: Always Beijing (UTC+8)
Algorithm: V1 (overall) + V2 (away factor)
Rolling window: 5 games, recency weighted
Models: V1 + V2 (two scenarios always)

## Never violate
MT03: Claude API via CF Worker only
MT05: user_bets isolated per user
MT11: fontSize 16px minimum on inputs
MT16: Build must pass before commit
MT22: Always strip vig before edge calc
