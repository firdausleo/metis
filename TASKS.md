# Metis — Task Queue

## Legend
🔴 HIGH priority  🟡 MEDIUM  🟢 LOW
⛔ HIGH risk  ⚠️ MEDIUM risk  ✅ LOW risk
⏳ PENDING  🔄 IN PROGRESS  ✅ DONE

## Completed
| Task | Risk | Commit |
|------|------|--------|
| Project scaffold | ⚠️ | initial |
| Supabase schema + RLS | ⛔ | feat: supabase |
| Auth + NavBar + Dashboard | ⚠️ | feat: auth |
| Seed 104 WC2026 fixtures | ✅ | c428f30 |
| Complete Metis Bible | ✅ | docs: bible |

## Stage 2 — Data Pipeline
| # | Task | Priority | Risk |
|---|------|----------|------|
| 1 | CF Worker footystats scraper | 🔴 | ⚠️ |
| 2 | Rolling window calculator | 🔴 | ⚠️ |
| 3 | team_stats auto-population | 🔴 | ⚠️ |
| 4 | Match list screen /matches | 🔴 | ⚠️ |
| 5 | Match cards with flags + stats | 🔴 | ✅ |
| 6 | Confidence indicator | 🔴 | ✅ |
| 7 | Manual stats override (admin) | 🟡 | ✅ |

## Stage 3 — Core Algorithm
| # | Task | Priority | Risk |
|---|------|----------|------|
| 8  | src/lib/poisson.js | 🔴 | ⚠️ |
| 9  | src/lib/evEngine.js | 🔴 | ⚠️ |
| 10 | V1 + V2 matrix generation | 🔴 | ⚠️ |
| 11 | Match analysis screen (4 tabs) | 🔴 | ⚠️ |
| 12 | Probability heatmap component | 🔴 | ⚠️ |
| 13 | Total goals anchor + scenarios | 🔴 | ⚠️ |
| 14 | Dixon-Coles toggle | 🟡 | ✅ |
| 15 | Confidence display | 🔴 | ✅ |

## Stage 4 — AI Roles
| # | Task | Priority | Risk |
|---|------|----------|------|
| 16 | ai_roles + role_skills tables | 🔴 | ⛔ |
| 17 | Role 1: Statistical Validator | 🔴 | ⚠️ |
| 18 | Role 2: Form Intelligence | 🔴 | ⚠️ |
| 19 | Role 4: Tournament Context | 🔴 | ⚠️ |
| 20 | Role 6: Risk Manager | 🔴 | ⚠️ |
| 21 | CF Worker /api/analyze | 🔴 | ⛔ |
| 22 | Role 3: Deep Analysis (Claude) | 🟡 | ⚠️ |
| 23 | Role 5: Market Intelligence | 🔴 | ⚠️ |
| 24 | Admin roles screen | 🟡 | ✅ |

## Stage 5 — Odds + Portfolio
| # | Task | Priority | Risk |
|---|------|----------|------|
| 25 | Odds input screen (admin) | 🔴 | ✅ |
| 26 | Vig stripping display | 🔴 | ⚠️ |
| 27 | Edge traffic light per bet | 🔴 | ✅ |
| 28 | Portfolio builder | 🔴 | ⚠️ |
| 29 | Outcome stress test table | 🔴 | ⚠️ |
| 30 | Pre-commit checklist | 🟡 | ✅ |
| 31 | Save to My Bets flow | 🔴 | ⚠️ |

## Stage 6 — My Bets + P&L
| # | Task | Priority | Risk |
|---|------|----------|------|
| 32 | My Bets screen | 🔴 | ⚠️ |
| 33 | Result settlement (admin) | 🔴 | ⚠️ |
| 34 | P&L calculation per user | 🔴 | ⚠️ |
| 35 | Model accuracy tracking | 🟡 | ⚠️ |
| 36 | Dashboard real data | 🟡 | ✅ |

## Stage 7-8 — Deploy + Harden
| # | Task | Priority | Risk |
|---|------|----------|------|
| 37 | Knockout admin tool | 🟡 | ⚠️ |
| 38 | Cloudflare Pages deploy | 🔴 | ⛔ |
| 39 | CF Workers deploy | 🔴 | ⛔ |
| 40 | Full harness H01-H35 | 🔴 | ✅ |
| 41 | Mobile polish pass | 🟡 | ✅ |
| 42 | Role 11: Learning loop | 🟢 | ⚠️ |

## Risk Notes
⛔ Tasks 16, 21, 38, 39: Leo must be present
⚠️ Algorithm tasks 8-15: test each before next
Never combine HIGH risk with other work
