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
| 5A — Match list screen /matches | ⚠️ | ba8170a |
| 5B — CF Worker /api/sync-stats | ⚠️ | ba8170a |
| 5C — Match analysis shell /matches/:id | ⚠️ | ba8170a |
| 6A — src/lib/poisson.js (V1 + V2 engine) | ⚠️ | 1160737 |
| 6B — src/lib/evEngine.js (EV + Kelly) | ⚠️ | 1160737 |
| 6C — Matrix tab live + total goals anchor | ⚠️ | 1160737 |
| 30 — Pre-bet checklist | ✅ | 8e95352 |
| 35 — Model accuracy tracking + Dashboard hit rate | ✅ | 414c09d |
| 42 — Role 11 learning loop (Sonnet calibration) | ✅ | dd059cc |
| Venue advantage table (poisson.js) | ✅ | 58ae379 |

## Stage 3 — Core Algorithm ✅ COMPLETE

## Stage 4 — AI Roles  ← NEXT
| # | Task | Priority | Risk |
|---|------|----------|------|
| 16 | ai_roles + role_skills + role_outputs SQL | 🔴 | ⛔ |
| 17 | CF Worker /api/analyze (11 roles) | 🔴 | ⛔ |
| 18 | Role output schema + prompt templates | 🔴 | ⚠️ |
| 19 | Analysis screen — AI tab (role cards) | 🔴 | ⚠️ |
| 20 | Composite score display (Role 10) | 🔴 | ⚠️ |

## Stage 5 — Odds + Portfolio
| # | Task | Priority | Risk |
|---|------|----------|------|
| 25 | Odds input screen (admin) | 🔴 | ✅ |
| 26 | Vig stripping display | 🔴 | ⚠️ |
| 27 | Edge traffic light per bet | 🔴 | ✅ |
| 28 | Portfolio builder | 🔴 | ⚠️ |
| 29 | Outcome stress test table | 🔴 | ⚠️ |
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
⛔ Tasks 16, 17, 38, 39: Leo must be present
⚠️ Algorithm tasks: test each before next
Never combine HIGH risk with other work
