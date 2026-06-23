#!/usr/bin/env python3
"""
Dixon-Coles MLE refit for Metis WC2026.
Run after each matchday to update dcRatings.js.

Usage: python3 scripts/fit_dc.py
"""

import json
import math
import re
from scipy.optimize import minimize
from scipy.stats import poisson
import numpy as np

# ── Base ratings from dcRatings.js ──────────────────
# These are updated after each refit
BASE_RATINGS = {
  "Algeria":      {"att": 0.7756, "def": 0.6335},
  "Argentina":    {"att": 1.2256, "def": 1.521 },
  "Australia":    {"att": 0.8362, "def": 1.0268},
  "Austria":      {"att": 0.6392, "def": 0.6171},
  "Belgium":      {"att": 0.8143, "def": 0.7109},
  "Bosnia-Herzegovina": {"att": 0.55, "def": 0.48},
  "Brazil":       {"att": 1.2398, "def": 1.1681},
  "Canada":       {"att": 0.6898, "def": 0.7759},
  "Cape Verde":   {"att": 0.45,   "def": 0.6960},
  "Colombia":     {"att": 1.1652, "def": 1.1233},
  "Croatia":      {"att": 0.7021, "def": 0.6929},
  "Curacao":      {"att": 0.42,   "def": 0.1500},
  "Czechia":      {"att": 0.521,  "def": 0.3442},
  "DR Congo":     {"att": 0.2374, "def": 0.7108},
  "Ecuador":      {"att": 0.7858, "def": 1.1789},
  "Egypt":        {"att": 0.3857, "def": 0.7533},
  "England":      {"att": 0.9148, "def": 1.0847},
  "France":       {"att": 0.9505, "def": 0.8609},
  "Germany":      {"att": 1.2143, "def": 0.6532},
  "Ghana":        {"att": 0.2862, "def": 0.3843},
  "Haiti":        {"att": 0.5357, "def": 0.2367},
  "Iran":         {"att": 0.9244, "def": 0.831 },
  "Iraq":         {"att": 0.3673, "def": 0.6146},
  "Ivory Coast":  {"att": 0.5984, "def": 0.7478},
  "Japan":        {"att": 1.0697, "def": 1.0238},
  "Jordan":       {"att": 0.38,   "def": 0.42  },
  "Mexico":       {"att": 0.7881, "def": 0.9748},
  "Morocco":      {"att": 0.702,  "def": 1.1311},
  "Netherlands":  {"att": 0.9734, "def": 0.6271},
  "New Zealand":  {"att": 0.7655, "def": 0.5924},
  "Norway":       {"att": 0.8893, "def": 0.5712},
  "Panama":       {"att": 0.6042, "def": 0.4326},
  "Paraguay":     {"att": 0.58,   "def": 0.3720},
  "Portugal":     {"att": 0.9923, "def": 0.867 },
  "Qatar":        {"att": 0.4697, "def": 0.1831},
  "Saudi Arabia": {"att": 0.3705, "def": 0.5892},
  "Scotland":     {"att": 0.62,   "def": 0.6360},
  "Senegal":      {"att": 0.7447, "def": 0.7528},
  "South Africa": {"att": 0.2092, "def": 0.3652},
  "South Korea":  {"att": 0.8393, "def": 0.6949},
  "Spain":        {"att": 1.0290, "def": 0.9349},
  "Sweden":       {"att": 0.9580, "def": 0.3429},
  "Switzerland":  {"att": 0.7938, "def": 0.6516},
  "Tunisia":      {"att": 0.65,   "def": 0.3780},
  "Turkiye":      {"att": 0.7033, "def": 0.3537},
  "USA":          {"att": 0.8716, "def": 0.6682},
  "Uruguay":      {"att": 0.886,  "def": 1.2223},
  "Uzbekistan":   {"att": 0.5149, "def": 0.8727},
}

MU = 0.1158
HOME_ADV = 0.2686
RHO = -0.0612
WC_WEIGHT = 1.4

# ── WC2026 results — ADD NEW ROWS AFTER EACH MATCHDAY
WC_RESULTS = [
  # (home, away, home_score, away_score, is_host_home)
  ("Mexico",       "South Africa", 2, 0, True),
  ("Canada",       "Bosnia-Herzegovina", 1, 1, True),
  ("South Korea",  "Czechia",      2, 1, False),
  ("USA",          "Paraguay",     4, 1, True),
  ("Australia",    "Turkiye",      2, 0, False),
  ("Qatar",        "Switzerland",  1, 1, False),
  ("Brazil",       "Morocco",      1, 1, False),
  ("Haiti",        "Scotland",     0, 1, False),
  ("Germany",      "Curacao",      7, 1, False),
  ("Netherlands",  "Japan",        2, 2, False),
  ("Ivory Coast",  "Ecuador",      1, 0, False),
  ("Spain",        "Cape Verde",   0, 0, False),
  ("Belgium",      "Egypt",        1, 1, False),
  ("Iran",         "New Zealand",  2, 2, False),
  ("Sweden",       "Tunisia",      5, 1, False),
  ("Saudi Arabia", "Uruguay",      1, 1, False),
  # Matchday 2
  ("Iraq",         "Norway",           1, 4, False),
  ("France",       "Senegal",          3, 1, False),
  ("Argentina",    "Algeria",          3, 0, False),
  ("Austria",      "Jordan",           3, 1, False),
  ("Portugal",     "DR Congo",         1, 1, False),
  ("England",      "Croatia",          4, 2, False),
  ("Ghana",        "Panama",           1, 0, False),
  ("Uzbekistan",   "Colombia",         1, 2, False),
  ("Czechia",      "South Africa",     1, 1, False),
  ("Switzerland",  "Bosnia-Herzegovina", 4, 1, False),
  ("Canada",       "Qatar",            6, 0, True),
  ("Mexico",       "South Korea",      1, 0, True),
  ("USA",          "Australia",        2, 0, True),
  ("Scotland",     "Morocco",          0, 1, False),
  ("Brazil",       "Haiti",            3, 0, False),
  ("Turkiye",      "Paraguay",         0, 1, False),
  # Matchday 3
  ("Netherlands", "Sweden",      5, 1, False),
  ("Germany",     "Ivory Coast", 2, 1, False),
  ("Ecuador",     "Curacao",     0, 0, False),
  ("Tunisia",     "Japan",       0, 4, False),
# Jun 21-22 Beijing
("Spain",        "Saudi Arabia", 4, 0, False),
("Belgium",      "Iran",         0, 0, False),
("Uruguay",      "Cape Verde",   2, 2, False),
("New Zealand",  "Egypt",        1, 3, False),
("Argentina",    "Austria",      2, 0, False),
("France",       "Iraq",         3, 0, False),
("Norway",  "Senegal", 3, 2, False),
("Jordan",  "Algeria", 1, 2, False),

  # ← ADD NEW RESULTS HERE AFTER EACH MATCHDAY
]

def dc_correction(lh, la, x, y, rho):
  if x == 0 and y == 0: return max(1 - lh*la*rho, 0.001)
  if x == 1 and y == 0: return max(1 + la*rho, 0.001)
  if x == 0 and y == 1: return max(1 + lh*rho, 0.001)
  if x == 1 and y == 1: return max(1 - rho, 0.001)
  return 1.0

def neg_log_likelihood(params, matches, teams):
  n = len(teams)
  att = {t: params[i] for i, t in enumerate(teams)}
  defe = {t: params[n+i] for i, t in enumerate(teams)}
  ll = 0
  for home, away, hs, aws, is_host in matches:
    if home not in att or away not in att:
      continue
    ha = HOME_ADV if is_host else 0
    lh = math.exp(MU + ha + att[home] - defe[away])
    la = math.exp(MU + att[away] - defe[home])
    tau = dc_correction(lh, la, hs, aws, RHO)
    ph = poisson.pmf(hs, lh)
    pa = poisson.pmf(aws, la)
    ll += WC_WEIGHT * math.log(max(tau * ph * pa, 1e-10))
  return -ll

def fit(matches):
  teams = sorted(set(
    t for h, a, *_ in matches for t in [h, a]
  ))
  n = len(teams)

  x0 = []
  for t in teams:
    x0.append(BASE_RATINGS.get(t, {"att": 0.5})["att"])
  for t in teams:
    x0.append(BASE_RATINGS.get(t, {"def": 0.5})["def"])

  bounds = (
    [(0.1, 3.0)] * n +  # att bounds
    [(0.1, 3.0)] * n    # def bounds
  )

  result = minimize(
    neg_log_likelihood,
    x0,
    args=(matches, teams),
    method="L-BFGS-B",
    bounds=bounds,
    options={"maxiter": 2000, "ftol": 1e-9}
  )

  att = {t: result.x[i] for i, t in enumerate(teams)}
  defe = {t: result.x[n+i] for i, t in enumerate(teams)}
  return att, defe, teams

def generate_js(att_new, def_new):
  all_teams = dict(BASE_RATINGS)
  for t in att_new:
    all_teams[t] = {
      "att": round(att_new[t], 4),
      "def": round(def_new[t], 4),
    }

  # Read current dcRatings.js
  with open("src/utils/dcRatings.js", "r") as f:
    content = f.read()

  # Replace teams block
  lines = []
  for team, r in sorted(all_teams.items()):
    lines.append(
      f'    "{team}": {{ att: {r["att"]}, def: {r["def"]} }},'
    )
  teams_block = "\n".join(lines)

  # Update fittedDate and matchCount
  from datetime import date
  today = date.today().isoformat()
  content = re.sub(
    r"fittedDate: '[^']*'",
    f"fittedDate: '{today}'",
    content
  )
  content = re.sub(
    r"matchCount: \d+",
    f"matchCount: {15508 + len(WC_RESULTS)}",
    content
  )

  # Replace teams object content
  content = re.sub(
    r'(teams: \{)[\s\S]*?(\n  \})',
    f'\\1\n{teams_block}\\2',
    content
  )

  return content

if __name__ == "__main__":
  print(f"Fitting DC on {len(WC_RESULTS)} WC2026 results...")

  game_counts = {}
  for home, away, *_ in WC_RESULTS:
    game_counts[home] = game_counts.get(home, 0) + 1
    game_counts[away] = game_counts.get(away, 0) + 1

  att, defe, teams = fit(WC_RESULTS)

  # ── Bayesian blending: shrink fitted values toward base prior ────────────
  PRIOR_WEIGHT = 3  # trust 3 historical games worth
  final_ratings = {}
  for team in teams:
    n_wc = game_counts.get(team, 0)
    fitted_att = att[team]
    fitted_def = defe[team]
    base_att = BASE_RATINGS.get(team, {}).get('att', 0.5)
    base_def = BASE_RATINGS.get(team, {}).get('def', 0.5)
    blended_att = (n_wc * fitted_att + PRIOR_WEIGHT * base_att) / (n_wc + PRIOR_WEIGHT)
    blended_def = (n_wc * fitted_def + PRIOR_WEIGHT * base_def) / (n_wc + PRIOR_WEIGHT)
    final_ratings[team] = {
      'att': round(blended_att, 4),
      'def': round(blended_def, 4)
    }

  print(f"\nRating changes vs base (blended, PRIOR_WEIGHT={PRIOR_WEIGHT}):")
  print(f"{'Team':<20} {'att_old':>8} {'att_new':>8} {'Δatt':>7} {'def_old':>8} {'def_new':>8} {'Δdef':>7}")
  print("-" * 75)
  for t in sorted(teams):
    base = BASE_RATINGS.get(t, {"att": 0.5, "def": 0.5})
    da = final_ratings[t]['att'] - base["att"]
    dd = final_ratings[t]['def'] - base["def"]
    print(f"{t:<20} {base['att']:>8.4f} {final_ratings[t]['att']:>8.4f} {da:>+7.4f} {base['def']:>8.4f} {final_ratings[t]['def']:>8.4f} {dd:>+7.4f}")

  # Write updated dcRatings.js
  blended_att = {t: final_ratings[t]['att'] for t in final_ratings}
  blended_def = {t: final_ratings[t]['def'] for t in final_ratings}
  new_content = generate_js(blended_att, blended_def)
  with open("src/utils/dcRatings.js", "w") as f:
    f.write(new_content)

  print(f"\n✅ Updated src/utils/dcRatings.js")
  print("Next steps:")
  print("  git add src/utils/dcRatings.js")
  print("  git commit -m 'chore: DC refit after matchday X'")
  print("  HTTPS_PROXY=http://127.0.0.1:7890 git push")
