# Claude Code — Session Setup

## Every session start
1. git pull
2. git log --oneline -3
3. npm run build (confirm zero errors)
4. Read MASTER.md then TASKS.md
5. Only then: start building

## Commit format
feat: description
fix: description
design: description
refactor: description
docs: description

## Core rules
- AUDIT FIRST: read files before touching
- One logical change per commit
- Build must pass before every commit
- git pull before every commit
- Never write code in comments
- Never guess — always read the file first

## Admin UUID (RLS policies)
4a6e1f29-e18b-4fd3-9a7e-cec54501db54

## Algorithm files (to create in Stage 3)
src/lib/poisson.js — statistical engine
src/lib/evEngine.js — EV + vig stripping
src/lib/roles/ — AI role implementations
