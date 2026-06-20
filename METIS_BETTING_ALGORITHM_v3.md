# METIS BETTING ALGORITHM v3
## Probability-Anchored Scoreline Portfolio (PASP v3)
**Version:** 3.0 — Validated against 4 WC2026 matches  
**Last updated:** 2026-06-18  
**Classification:** Private — betting strategy  

---

## 1. Philosophy

> **Principle 1:** The primary bet is always an exact scoreline — high payout, highest conviction, biggest stake. If it hits, the return is large.

> **Principle 2:** Total goals bets are insurance — lower stakes, designed to recoup the cost of the match if the exact score is wrong but the goal count is right.

> **Principle 3:** When the market strongly disagrees with the model on the dominant team, trust the market's anchor but use the model for scoreline selection.

---

## 2. Algorithm — Step by Step

### STEP 1 — Strip vig from 1X2 odds
```
For each outcome (home, draw, away):
  raw_implied = 1 / odds
  
vig = sum(raw_implied for all outcomes)
implied(outcome) = raw_implied(outcome) / vig
```

### STEP 2 — Check R11 Market Divergence
```
dominant_model  = max(v3_home_win, v3_away_win)
dominant_market = max(implied_home, implied_away)
divergence = dominant_market - dominant_model

IF divergence > 15pp:
  → R11 triggered → shift anchor UP by 1 goal
  → Market knows something the DC model doesn't
  → Typically: star team, recent form not captured in DC ratings

IF divergence ≤ 15pp:
  → No adjustment → use model anchor
```

### STEP 3 — Identify anchor total
```
Model anchor: λ_home + λ_away → round to nearest integer
  < 2.0 → anchor = 1
  2.0–2.8 → anchor = 2  
  2.8–3.8 → anchor = 3
  3.8–4.8 → anchor = 4

If R11 triggered: anchor = model_anchor + 1

Confirm with market: strip vig from total goals odds
  market_anchor = total with highest implied probability

If market_anchor ≠ model_anchor (no R11):
  Use market_anchor (market has real money behind it)
```

### STEP 4 — Check for flat distribution (Rule R1)
```
IF top 3 total goals implied probabilities are within 3pp of each other:
  → Distribution is flat → range betting mode
  → Primary = best scoreline at most likely total
  → Insurance 1 = Total Goals at that total
  → Insurance 2 = Total Goals at adjacent lower total
  → Value play = best scoreline at adjacent higher total
  (Same structure, different anchor selection logic)
```

### STEP 5 — Select primary scoreline
```
Within anchor total AND dominant outcome direction:
  candidates = all scorelines where home + away = anchor
               AND direction matches (home win / draw / away win)
  
  primary = candidate with lowest odds (most probable per market)
  
  Exception: if model strongly disagrees with market on
  specific scoreline (model prob > 2× market implied):
    → Use model's preferred scoreline instead
```

### STEP 6 — Select value play scoreline
```
Within anchor+1 total AND same dominant direction:
  value = candidate with best payout relative to probability
  
  Threshold: only include if odds ≤ 12.00
  (Higher odds = too speculative for the value play slot)
```

### STEP 7 — Build portfolio
```
Budget = session stake (e.g. ¥400)

Primary    = 45% of budget  → best scoreline at anchor
Insurance1 = 25% of budget  → Total Goals = anchor  
Insurance2 = 20% of budget  → Total Goals = anchor ± 1
             (choose adjacent total with higher implied prob)
Value play = 10% of budget  → best scoreline at anchor+1

Round stakes to nearest ¥5 or ¥10 for clean numbers.
```

### STEP 8 — Verify insurance coverage
```
Insurance check:
  (Insurance1_stake × Insurance1_odds) should cover ≥ 70% of budget
  (Insurance2_stake × Insurance2_odds) should cover ≥ 50% of budget

If Insurance1 fails check: increase Insurance1 stake by 10%,
reduce Primary stake by 10%

Logic: if exact score is wrong but total goals is right →
  Insurance1 return should recover most of total budget
```

### STEP 9 — Bets to avoid
```
AVOID any correct score bet where:
  market_implied_prob > model_prob × 1.25   [market overprices by 25%+]
  
AVOID total goals bet where:
  implied_prob < 10%   [too unlikely to serve as useful insurance]

FLAG (do not automatically avoid):
  Odds > 12.00 for any primary or insurance bet
  Games window < 5 for either team (insufficient data)
```

---

## 3. Portfolio Template

| Role | Bet | Odds | Stake | % |
|------|-----|------|-------|---|
| Primary | [Scoreline] [Team] | X.XX | ¥XXX | 45% |
| Insurance 1 | Total Goals [N] | X.XX | ¥XXX | 25% |
| Insurance 2 | Total Goals [N±1] | X.XX | ¥XXX | 20% |
| Value play | [Scoreline] [Team] | X.XX | ¥XXX | 10% |
| **TOTAL** | | | **¥XXX** | **100%** |

---

## 4. Payout Scenarios

| Scenario | What hits | Approx return |
|----------|-----------|---------------|
| Primary + Insurance 1 | Both | 45%×odds + 25%×tg_odds — huge win |
| Primary only | Primary | 45%×primary_odds — big win |
| Wrong score, right total | Insurance 1 | ~recover 70-80% of budget |
| Lower-scoring game | Insurance 2 | ~recover 50-60% of budget |
| Value play hits | Value | 10%×value_odds — bonus |
| All wrong | None | −100% of budget |

**Key insight:** In the two most common failure modes (right total, wrong score / lower scoring than expected), the insurance layer recovers 50-80% of the budget. Full loss only occurs in tail scenarios (0-1 goals total or 5+ goals when anchor was 2-3).

---

## 5. R11 — Market Divergence Rule

**Trigger:** Market implied dominant team win > Model V3 dominant team win by more than 15 percentage points.

**Interpretation:** The DC model is underestimating the stronger team — likely because:
- Team's recent form (tournament form) not yet captured in DC ratings
- Star player in exceptional form
- Opponent weaker than historical ratings suggest

**Effect:** Shift anchor total UP by 1 goal. Add value play at anchor+1.

**Example:**
- France vs Senegal: Model 43.4% France, Market 67.1% France → divergence 23.7pp → anchor 2→3
- Portugal vs DR Congo: Model 55.9%, Market 77.4% → divergence 21.5pp → but market anchor = 2 → no shift when market anchor contradicts R11

**R11 conflict resolution:** If R11 says shift up but market anchor (highest implied total goals probability) does NOT shift up → use market anchor. Market has real money behind it.

---

## 6. Validation Results (WC2026 Matchday 1)

| Match | Result | Your Bets P&L | PASP v3 P&L | PASP v3 Edge |
|-------|--------|--------------|-------------|-------------|
| France 3-1 Senegal | 4 goals | +¥300 (75% ROI) | +¥360 (90% ROI) | +¥60 |
| Portugal 1-1 DR Congo | 2 goals | −¥300 (−100% ROI) | −¥15 (−5% ROI) | +¥285 |
| Uzbekistan 1-2 Colombia | 3 goals | +¥425 (213% ROI) | +¥784 (261% ROI) | +¥359 |
| Ghana 1-0 Panama | 1 goal | ¥0 (no bet) | +¥836 (279% ROI) | +¥836 |
| **TOTAL** | | **+¥425 on ¥900** | **+¥1,965 on ¥1,300** | **+¥1,540** |

**PASP v3 ROI: 151% vs Your bets ROI: 47%**

---

## 7. Decision Rules Summary

| Rule | Condition | Action |
|------|-----------|--------|
| R1 | Top 3 total goal probs within 3pp | Range betting mode |
| R2 | No total has positive edge | Anchor on highest prob, reduce stake 10% |
| R3 | Primary market implied > model by 25% | AVOID scoreline |
| R4 | Value play odds > 12.00 | Skip value play slot |
| R5 | Insurance coverage < 70% of budget | Increase Insurance1 stake |
| R6 | Model divergence > 10pp between V1/V2/V3 | Reduce all stakes 30% |
| R7 | Games window < 5 for either team | Flag data quality, reduce stakes 20% |
| R8 | R11 triggered AND market anchor contradicts | Use market anchor, no shift |
| R9 | Single leg stake > 5% of total bankroll | Hard cap at 5% |
| R10 | China odds changed since yesterday | Re-enter before betting |
| **R11** | **Market dominant% > Model dominant% by >15pp** | **Shift anchor UP 1, add value play at anchor+1** |

---

## 8. Known Weaknesses

| Weakness | Impact | Mitigation |
|----------|--------|------------|
| R11 threshold (15pp) needs more data | May trigger too often/rarely | Review after 20+ matches |
| Model anchor from λ sum is approximate | Can miss 1 goal | Always confirm with market total goals odds |
| Insurance 2 adjacent direction | Currently fixed at lower total | Consider higher total when R11 triggered |
| Correlated legs (all lose together) | Overstates safety | √n Kelly adjustment on bankroll sizing |
| Value play 10% cap | May undersize genuine value | Increase to 15% if odds 8-12 range |

---

## 9. Documents in This Series

| Document | Contents |
|----------|---------|
| `METIS_PREDICTION_ENGINE.md` | How V1/V2/V3 probabilities are calculated |
| `METIS_BETTING_ALGORITHM_v3.md` | This document — PASP v3 framework |
| `METIS_BIBLE_v1.md` | Full system specification |
| `HARNESS.md` | Engineering patterns and lessons learned |

