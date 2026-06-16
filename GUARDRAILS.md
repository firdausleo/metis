# Metis — Guardrails Registry (MT01–MT25)

Check the relevant guardrails before any task. Run the full list before any deploy.

---

## MT01 — Audit First
**Rule**: Read every file you will touch before writing a single line of code.
**Why**: Prevents overwriting intentional logic, missing existing patterns, and introducing regressions.
**How to apply**: Always use Read tool on the target file first. No exceptions.

---

## MT02 — UTC in DB, Beijing in UI
**Rule**: All match times stored as UTC (`timestamptz`) in the database. Convert to Beijing (Asia/Shanghai, UTC+8) only at the display layer using `toBeijingTime()`.
**Why**: Single source of truth. Avoids timezone offset bugs accumulating across reads/writes.
**How to apply**: Any `match_date` write goes in as a UTC ISO string. Any `match_date` display goes through `toBeijingTime()` from `src/lib/dateUtils.js`.

---

## MT03 — Claude API via CF Worker Only
**Rule**: The Anthropic/Claude API must only be called from a Cloudflare Worker. Never from the React frontend.
**Why**: Keeps the API key server-side. Enables rate limiting, caching, auth checks, and future cost controls before AI calls hit billing.
**How to apply**: Frontend calls `POST /api/analyze` on the CF Worker. Worker holds the `ANTHROPIC_API_KEY` as a secret.

---

## MT04 — No Secrets Committed
**Rule**: Never commit `.env`, `.env.local`, service role keys, API keys, or any token to the git repo.
**Why**: Public repo means permanent secret exposure. Cannot be undone even with force push.
**How to apply**: Confirm `.env.local` is in `.gitignore` before every commit. If accidentally staged, `git restore --staged .env.local` before committing.

---

## MT05 — User Bets Isolated Per User
**Rule**: The `bets` table must have RLS policies ensuring users can only read and write their own rows.
**Why**: Users must not see each other's bet history or P&L data.
**How to apply**: Policy: `auth.uid() = user_id` on both SELECT and INSERT. Verify in Supabase Auth > Policies after any schema change.

---

## MT06 — Rolling Window = 5 Games Minimum
**Rule**: The rolling window calculator always uses exactly 5 most recent games. If fewer than 5 games are available, the function must throw an error — it must not estimate or use a smaller window silently.
**Why**: The recency weights `[0.10, 0.15, 0.20, 0.25, 0.30]` are calibrated for exactly 5 data points. Fewer points corrupt the model output.
**How to apply**: Add guard at the top of the rolling window function: `if (games.length < 5) throw new Error('Insufficient data: need 5 games')`.

---

## MT07 — V1 and V2 Always Together
**Rule**: The analysis screen must always display V1 (overall) and V2 (away factor) model outputs together, side by side or in adjacent tabs. Never show only one.
**Why**: The value of the two-scenario approach is comparison. Seeing only V1 or only V2 gives a false impression of certainty.
**How to apply**: Analysis screen has a "V1 / V2" toggle or split display. Both percentage sets always visible.

---

## MT08 — Probability Display Caps
**Rule**: Never display a probability lower than 5% or higher than 95%, regardless of model output.
**Why**: Extreme probabilities mislead users into over-confident bets. The model is not calibrated for near-certainties in football.
**How to apply**: `displayProb = Math.min(0.95, Math.max(0.05, modelProb))` before any percentage render.

---

## MT09 — Decimal Odds Internally
**Rule**: All odds stored in the database and used in calculations are in decimal format (e.g. 2.10, not -110 American or 11/10 fractional).
**Why**: Single format prevents conversion bugs in EV and Kelly formulas.
**How to apply**: Odds input UI accepts decimal format. If the user pastes Asian/American odds, convert before storing.

---

## MT10 — Service Role Key Isolation
**Rule**: The Supabase service role key is only allowed in: CF Workers secrets, `.env.local` (local dev, git-ignored).
**Why**: Service role key bypasses all RLS — if exposed, any user can read/write all data.
**How to apply**: Never pass it to frontend code. Never put it in `VITE_` prefixed env vars (those are embedded in the JS bundle).

---

## MT11 — Input Font Size 16px Minimum
**Rule**: All `<input>`, `<textarea>`, and `<select>` elements must have `font-size: 16px` or larger.
**Why**: iOS Safari auto-zooms the viewport when a focused input has font-size < 16px. This breaks the mobile layout and is a poor UX.
**How to apply**: Check every new input. The `inputStyle` object in Auth.jsx is the reference pattern.

---

## MT12 — Touch Target 44px Minimum
**Rule**: All buttons, links, and interactive elements must have `min-height: 44px` (use `var(--touch-target)`).
**Why**: Apple HIG and Google Material both require 44px minimum tap targets for accessible mobile UX. Smaller targets cause mis-taps.
**How to apply**: Every new `<button>` gets `minHeight: 'var(--touch-target)'`. Nav items, form submit buttons — all of them.

---

## MT13 — Use TEAM_FLAGS for All Emoji
**Rule**: All team name → flag emoji lookups must go through `getFlag(teamName)` from `src/lib/teamFlags.js`. Never hardcode flag emoji inline in components.
**Why**: Centralised source of truth. Ensures consistent display and makes future additions (playoff teams) a one-file change.
**How to apply**: `import { getFlag, getTeamDisplay } from '../lib/teamFlags'`. Use `getTeamDisplay(match.home_team)` for "🇧🇷 Brazil" format.

---

## MT14 — Always Show Beijing Time
**Rule**: All match dates and times shown to the user must be formatted in Beijing time (Asia/Shanghai, UTC+8) using `toBeijingTime()`.
**Why**: The target user base is Chinese. Showing UTC or US time zones is confusing and causes scheduling errors.
**How to apply**: `import { toBeijingTime } from '../lib/dateUtils'`. Use `toBeijingTime(match.match_date, 'full')` for full datetime, `'time'` for time only.

---

## MT15 — EV Display Format
**Rule**: Expected value is always displayed as a percentage with a sign: `+12.4%` (green) or `−3.1%` (red). Never as a raw decimal.
**Why**: Percentages are immediately interpretable. Raw decimals (0.124) require mental conversion.
**How to apply**: `(ev * 100).toFixed(1) + '%'` with sign prefix. Apply `--color-edge-green` for positive, `--color-edge-red` for negative.

---

## MT16 — Build Before Commit
**Rule**: `npm run build` must complete with zero errors before every commit is created.
**Why**: Catches type errors, import errors, and broken JSX before they reach the repo and break CI/CD.
**How to apply**: Run `npm run build` in the terminal. Only proceed with `git add` if output shows `✓ built in Xms`.

---

## MT17 — Pull Before Push
**Rule**: Run `git pull` before every `git push`. Resolve any conflicts locally before pushing.
**Why**: Prevents force-push situations and avoids rejected pushes that corrupt the working state.
**How to apply**: `git pull` → fix any conflicts → `npm run build` → `git push`.

---

## MT18 — One Logical Change Per Commit
**Rule**: Each commit must contain exactly one logical change. No bundling of unrelated features, fixes, or refactors.
**Why**: Makes git history readable, makes `git bisect` effective, makes code review tractable.
**How to apply**: If you've changed more than one thing, stage selectively with `git add <specific files>` before committing.

---

## MT19 — No console.log in Production
**Rule**: Remove all `console.log`, `console.warn`, and `console.error` statements before committing.
**Why**: Clutters browser dev tools, can leak sensitive data, and signals unfinished code.
**How to apply**: `grep -r "console.log" src/` before staging. Remove or replace with structured error handling.

---

## MT20 — Admin UUID Not in React
**Rule**: The admin UUID (`4a6e1f29-e18b-4fd3-9a7e-cec54501db54`) must only appear in SQL/RLS policy files, seed scripts, and Supabase SQL editor. Never in React components.
**Why**: The UUID in frontend code is visible to all users who inspect the JS bundle. It signals privileged access patterns.
**How to apply**: Admin-only UI gates should check `user.id === adminId` only if the adminId comes from an env variable or is irreversibly non-sensitive (the UUID is already in the public schema — use judgment).

---

## MT21 — Dixon-Coles Default OFF
**Rule**: The Dixon-Coles correction toggle must default to OFF. When enabled, it must be clearly labelled "Dixon-Coles correction (experimental)".
**Why**: The correction improves low-score prediction but complicates probability interpretation. Users should consciously opt in.
**How to apply**: `const [dixonColes, setDixonColes] = useState(false)` in the analysis screen.

---

## MT22 — Always Strip Vig First
**Rule**: The bookmaker's overround (vig) must be stripped before calculating true edge. Never compare model probability directly to raw implied probability (`1/odds`).
**Why**: Raw implied probability is inflated by the vig. Comparing against it makes every bet look like it has less edge than it does — or makes poor bets look like value.
**How to apply**: See Part 4.6 of METIS-BIBLE.md for the exact 6-step EV formula. Implement in `src/lib/evEngine.js`.

---

## MT23 — 5% Edge Floor for Recommendations
**Rule**: Only display a bet as a positive recommendation if the calculated edge (after vig stripping) is ≥ 5%.
**Why**: Below 5%, the edge may be within the model's margin of error. Recommending sub-5% bets leads to churn without real advantage.
**How to apply**: In the recommendation UI: `edge >= 0.05` → green badge + "Recommended". `0 <= edge < 0.05` → amber + "Marginal". `edge < 0` → red + "Skip".

---

## MT24 — 5% Bankroll Hard Cap
**Rule**: No single bet should exceed 5% of the user's total bankroll, regardless of what Kelly criterion recommends.
**Why**: Kelly can recommend aggressive sizing on high-confidence bets. Full Kelly has high variance. The 5% cap is a ruin-prevention hard floor.
**How to apply**: `suggestedStake = Math.min(fractionalKelly, bankroll * 0.05)`. Display both values so the user can see if the cap is binding.

---

## MT25 — CF Worker 30s Timeout
**Rule**: Cloudflare Worker requests must complete within 30 seconds. If any async operation risks exceeding this, implement a timeout with a structured JSON error response.
**Why**: CF Workers free tier timeout is 30s; paid is higher but the discipline applies regardless. Hanging requests degrade UX.
**How to apply**: Wrap Claude API calls in `Promise.race([apiCall, timeout(25000)])`. Return `{ error: 'TIMEOUT', code: 'E_TIMEOUT' }` on failure.
