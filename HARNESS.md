# Metis — Pre-Commit Harness (H01–H35)

Run relevant checks before every commit.
Run the **full harness** (all 35) before any deploy.

Legend: ☐ = check to perform | ✓ = passed | ✗ = failed (must fix before proceeding)

---

## Code Quality (H01–H05)

**H01 — Build passes**
```bash
npm run build
```
Expected: `✓ built in Xms` with zero errors. Any error = do not commit.

**H02 — ESLint clean**
```bash
npm run lint
```
Expected: zero errors on changed files. Warnings acceptable but should be minimised.

**H03 — No console statements**
```bash
grep -rn "console\." src/ --include="*.js" --include="*.jsx"
```
Expected: zero results. Remove all `console.log`, `.warn`, `.error` before committing.

**H04 — No hardcoded admin UUID in React**
```bash
grep -rn "4a6e1f29" src/ --include="*.jsx" --include="*.js"
```
Expected: zero results in `src/` (allowed in `scripts/` and `supabase/`).

**H05 — No secrets in staged files**
```bash
git diff --cached | grep -i "sk_\|service_role\|ANTHROPIC\|eyJ"
```
Expected: zero results. Never commit API keys or JWTs.

---

## Data Integrity (H06–H15)

**H06 — external_id unique constraint exists**

In Supabase SQL Editor:
```sql
SELECT conname FROM pg_constraint
WHERE conrelid = 'public.matches'::regclass
  AND contype = 'u';
```
Expected: `matches_external_id_key` in results.

**H07 — All match_date values are valid UTC**

```sql
SELECT COUNT(*) FROM matches
WHERE match_date::text NOT LIKE '%+00%'
  AND match_date::text NOT LIKE '%Z';
```
Expected: 0 rows.

**H08 — Total seed count = 104**

```sql
SELECT COUNT(*) FROM matches;
```
Expected: 104.

**H09 — Group stage count = 72**

```sql
SELECT group_name, COUNT(*) as n
FROM matches WHERE stage = 'group'
GROUP BY group_name ORDER BY group_name;
```
Expected: 12 rows, each with n = 6.

**H10 — Knockout count = 32**

```sql
SELECT stage, COUNT(*) FROM matches
WHERE stage != 'group'
GROUP BY stage ORDER BY stage;
```
Expected: r32=16, r16=8, qf=4, sf=2, 3rd=1, final=1.

**H11 — No duplicate external_ids**

```sql
SELECT external_id, COUNT(*) as n
FROM matches
GROUP BY external_id
HAVING COUNT(*) > 1;
```
Expected: 0 rows.

**H12 — All teams in TEAM_FLAGS**

In browser console or Node:
```javascript
import { TEAM_FLAGS } from './src/lib/teamFlags.js'
console.log(Object.keys(TEAM_FLAGS).length) // expect ≥ 44
```

**H13 — getFlag covers all team codes in matches**

```sql
SELECT DISTINCT home_team FROM matches
UNION
SELECT DISTINCT away_team FROM matches
ORDER BY 1;
```
Cross-reference every name against `TEAM_FLAGS` keys.

**H14 — RLS enabled on all tables**

In Supabase: Auth → Policies. Confirm row-level security is ON for:
`matches` · `bets` · `team_stats` · `ai_roles` · `role_skills` · `role_outputs` · `role_accuracy`

**H15 — Admin UUID in all write policies**

```sql
SELECT policyname, qual FROM pg_policies
WHERE tablename IN ('matches','bets','team_stats','ai_roles')
  AND cmd IN ('INSERT','UPDATE','DELETE','ALL');
```
Expected: all policies reference `4a6e1f29-e18b-4fd3-9a7e-cec54501db54`.

---

## Algorithm (H16–H22)

**H16 — Rolling window rejects < 5 games**

In `src/lib/poisson.js`:
```javascript
// Verify this guard exists at function start:
if (games.length < 5) throw new Error('Insufficient data: need 5 games, got ' + games.length)
```
Test: pass 4 game objects → expect thrown error.

**H17 — V1 probabilities sum to ~100%**

```javascript
const { homeWin, draw, awayWin } = calculateV1(homeStats, awayStats)
const sum = homeWin + draw + awayWin
console.assert(Math.abs(sum - 1.0) < 0.005, 'V1 probs must sum to 100% ±0.5%')
```

**H18 — V2 probabilities sum to ~100%**

Same check for `calculateV2` output.

**H19 — No probability outside 5%–95%**

```javascript
const probs = [homeWin, draw, awayWin]
probs.forEach(p => {
  console.assert(p >= 0.05 && p <= 0.95, 'Probability out of display bounds: ' + p)
})
```

**H20 — Vig stripped before edge**

In `src/lib/evEngine.js`: verify the `stripVig()` function is called before `calcEdge()`. No direct comparison of model prob to `1/odds` anywhere.

**H21 — EV formula correct**

```javascript
// Verify this exact formula:
const ev = (p * decimalOdds) - 1
const edge = (p - pMarket) / pMarket
// pMarket = (1/odds) / vigTotal
```

**H22 — Kelly output capped at 5% bankroll**

```javascript
const kelly = calcKelly(p, decimalOdds)
const fractional = kelly * 0.25
const capped = Math.min(fractional, 0.05) // hard cap
```
Verify cap is applied in `evEngine.js` before returning stake recommendation.

---

## UI & Accessibility (H23–H30)

**H23 — Input font sizes ≥ 16px**

```bash
grep -rn "fontSize" src/ --include="*.jsx" | grep -v "16\|17\|18\|19\|20\|22\|24\|28"
```
Inspect manually for any new `<input>` or `<textarea>` — all must be `fontSize: 16` or above.

**H24 — Touch targets ≥ 44px**

Manually inspect any new button or tappable element. Confirm `minHeight: 'var(--touch-target)'` or `minHeight: 44` is present.

**H25 — NavBar hidden on /auth**

Open browser at `/auth`. Confirm no NavBar visible. Check `Layout` component in `App.jsx`: `showNav = location.pathname !== '/auth'`.

**H26 — Protected routes redirect unauthenticated users**

Open incognito browser, navigate to `/`. Confirm redirect to `/auth`.

**H27 — Logout navigates to /auth**

Log in, click Logout in NavBar. Confirm redirect to `/auth` and session cleared.

**H28 — Match times in Beijing time**

Check any match card displaying a time. `2026-06-12T01:00:00Z` → should display `2026/06/12 09:00` (Beijing = UTC+8).

**H29 — Language toggle works**

On `/auth`, click "中文". Confirm all text switches to Chinese immediately without page reload.

**H30 — Loading states visible**

On `/auth`, click Login. Confirm: button shows spinner, button is disabled, `opacity: 0.7` while Supabase call is in flight.

---

## Deployment (H31–H35)

**H31 — CF Worker API key set**

```bash
wrangler secret list
```
Expected: `ANTHROPIC_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` all listed.

**H32 — CF Worker CORS headers correct**

```bash
curl -I -X OPTIONS https://metis-api.workers.dev/api/analyze \
  -H "Origin: https://metis.pages.dev"
```
Expected: `Access-Control-Allow-Origin: https://metis.pages.dev` in response headers.

**H33 — CF Worker error paths return JSON**

```bash
curl -X POST https://metis-api.workers.dev/api/analyze \
  -H "Content-Type: application/json" \
  -d '{"match_id": "invalid-uuid"}'
```
Expected: `{ "error": "...", "code": "E_..." }` JSON, not an HTML error page.

**H34 — SPA routing works on CF Pages**

Navigate directly to `https://metis.pages.dev/matches` in a fresh browser tab.
Expected: React app loads (not a 404). Requires `_redirects` file: `/* /index.html 200`.

**H35 — End-to-end smoke test**

Walk through:
1. `/auth` → login with valid credentials
2. Redirect to `/` (Dashboard) — NavBar visible
3. Navigate to `/matches` — match list renders
4. Click a match → `/matches/:id` → analysis tabs render
5. Navigate to `/my-bets` — empty state or bet list renders
6. Navigate to `/settings` — settings page renders
7. Logout → redirected to `/auth`

All 7 steps must pass without console errors.
