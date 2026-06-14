/**
 * CF Pages Function: POST /api/analyze
 *
 * Runs all 11 AI roles for a given match_id.
 * MT03: Claude API called here only — never from frontend.
 * MT25: 28s timeout per role group.
 *
 * Execution order (per METIS-BIBLE Part 6):
 *   Phase 1 — Parallel: Roles 1,2,4,5,6,7,8,9 (Haiku)
 *   Phase 2 — Sequential: Role 3 (Sonnet) — receives Phase 1 outputs as context
 *   Phase 3 — Sequential: Role 10 (Haiku) — composite scorer, receives all outputs
 *   Phase 11 — Post-settlement only, not triggered here
 *
 * Auth: admin-only (verified via Supabase JWT → user id check)
 */

const HAIKU_MODEL     = 'claude-haiku-4-5-20251001'
const SONNET_MODEL    = 'claude-sonnet-4-6'
const ANTHROPIC_API   = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VER   = '2023-06-01'

// ── CORS ─────────────────────────────────────────────────────

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Content-Type':                 'application/json',
}

function jsonRes(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS_HEADERS })
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS })
}

// ── Auth ──────────────────────────────────────────────────────

async function verifyUser(request, env) {
  const auth = request.headers.get('Authorization')
  if (!auth?.startsWith('Bearer ')) return null

  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { 'Authorization': auth, 'apikey': env.SUPABASE_ANON_KEY },
  })
  if (!res.ok) return null
  const user = await res.json()
  if (!user?.id) return null

  const profileRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/user_profiles?id=eq.${user.id}&select=*&limit=1`,
    { headers: sbHeaders(env) }
  )
  if (!profileRes.ok) return null
  const profiles = await profileRes.json()
  if (!profiles.length) return null

  return { user, profile: profiles[0] }
}

async function deductCredits(env, userId, currentCredits) {
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/user_profiles?id=eq.${userId}`,
    {
      method: 'PATCH',
      headers: { ...sbHeaders(env), 'Prefer': 'return=minimal' },
      body: JSON.stringify({ credits_remaining: Math.max(0, currentCredits - 5) }),
    }
  )
  if (!res.ok) {
    const txt = await res.text()
    throw new Error(`deductCredits failed: ${res.status} ${txt}`)
  }
}

// ── Supabase helpers ──────────────────────────────────────────

async function getMatch(env, matchId) {
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/matches?id=eq.${matchId}&select=*&limit=1`,
    { headers: sbHeaders(env) }
  )
  if (!res.ok) throw new Error(`Match fetch failed: ${res.status}`)
  const rows = await res.json()
  if (!rows.length) throw new Error(`Match not found: ${matchId}`)
  return rows[0]
}

async function getTeamStats(env, matchId) {
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/team_stats?match_id=eq.${matchId}&select=*`,
    { headers: sbHeaders(env) }
  )
  if (!res.ok) throw new Error(`Stats fetch failed: ${res.status}`)
  return res.json()
}

async function getAiRoles(env) {
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/ai_roles?enabled=eq.true&order=role_number.asc&select=*`,
    { headers: sbHeaders(env) }
  )
  if (!res.ok) throw new Error(`ai_roles fetch failed: ${res.status}`)
  return res.json()
}

// Role 11 feedback: confidence multipliers keyed by role_id (empty if unset).
async function getCalibration(env) {
  try {
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/role_calibration?select=role_id,confidence_multiplier`, { headers: sbHeaders(env) })
    if (!res.ok) return {}
    const map = {}
    for (const r of await res.json()) map[r.role_id] = Number(r.confidence_multiplier)
    return map
  } catch { return {} }
}

// Apply a role's learning-loop multiplier; capped at 1.0 (numeric(4,3) max).
function applyCalibration(output, mult) {
  if (mult && typeof output?.confidence === 'number') output.confidence = Math.min(1, output.confidence * mult)
  return output
}

async function upsertOutput(env, matchId, roleId, outputJson, confidence) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/role_outputs`, {
    method:  'POST',
    headers: { ...sbHeaders(env), 'Prefer': 'resolution=merge-duplicates' },
    body:    JSON.stringify({
      match_id:    matchId,
      role_id:     roleId,
      output_json: outputJson,
      confidence,
      created_at:  new Date().toISOString(),
    }),
  })
  if (!res.ok) {
    const t = await res.text()
    throw new Error(`upsert role_output failed: ${res.status} ${t}`)
  }
}

function sbHeaders(env) {
  return {
    'apikey':        env.SUPABASE_SERVICE_ROLE_KEY,
    'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type':  'application/json',
  }
}

// ── Claude API call ───────────────────────────────────────────

async function callClaude(env, model, systemPrompt, userContent, signal, maxTokens = 600) {
  const res = await fetch(ANTHROPIC_API, {
    method:  'POST',
    signal,
    headers: {
      'x-api-key':         env.ANTHROPIC_API_KEY,
      'anthropic-version': ANTHROPIC_VER,
      'Content-Type':      'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content: userContent }],
    }),
  })

  if (!res.ok) {
    const t = await res.text()
    throw new Error(`Claude API ${res.status}: ${t}`)
  }

  const data = await res.json()
  const text = data.content?.[0]?.text || ''

  // Strategy 1: parse a complete balanced JSON object
  const result = extractJson(text)
  if (result) return normaliseConfidence(result)

  // Strategy 2: response was truncated (stop_reason=max_tokens) → no closing
  // brace, balanced scan fails. Salvage required fields by regex so confidence
  // is never lost just because the summary ran long.
  const salvaged = salvageFields(text)
  if (salvaged.confidence !== null) {
    return normaliseConfidence({ ...salvaged, flags: ['salvaged_truncated'] })
  }

  // Total failure — keep the raw text so it can be inspected in the DB.
  return {
    role:           0,
    summary:        text.replace(/`/g, '').replace(/^\s*json\s*/i, '').trim().slice(0, 400),
    signals:        [],
    confidence:     null,
    recommendation: null,
    flags:          ['parse_error', `stop:${data.stop_reason}`],
  }
}

/** Confidence may come back 0–100 instead of 0.00–1.00; numeric(4,3) caps at
 *  1.000 so >1 values would be rejected by the DB. Scale them down. */
function normaliseConfidence(obj) {
  if (typeof obj.confidence === 'number' && obj.confidence > 1) {
    obj.confidence = Math.min(1, obj.confidence / 100)
  }
  return obj
}

/** Pull individual fields from a malformed/truncated JSON string by regex. */
function salvageFields(text) {
  const num = text.match(/"confidence"\s*:\s*([0-9.]+)/)
  const rec = text.match(/"recommendation"\s*:\s*"([^"]*)"/)
  const sum = text.match(/"summary"\s*:\s*"([^"]*)"/)
  const role = text.match(/"role"\s*:\s*([0-9]+)/)
  return {
    role:           role ? Number(role[1]) : 0,
    summary:        sum ? sum[1] : '',
    signals:        [],
    confidence:     num ? Number(num[1]) : null,
    recommendation: rec ? rec[1] : null,
  }
}

/**
 * Extract a JSON object from a Claude response. Robust against:
 *  - markdown code fences (```json ... ```)
 *  - a leading "json" label before the brace
 *  - prose before or after the object (balanced-brace scan, not lastIndexOf)
 * Returns the parsed object, or null if none parses.
 */
function extractJson(text) {
  if (!text) return null

  // Locate every '{' and try a balanced-brace scan from each until one parses.
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '{') continue
    let depth = 0, inStr = false, esc = false
    for (let j = i; j < text.length; j++) {
      const ch = text[j]
      if (inStr) {
        if (esc) esc = false
        else if (ch === '\\') esc = true
        else if (ch === '"') inStr = false
      } else if (ch === '"') inStr = true
      else if (ch === '{') depth++
      else if (ch === '}') {
        depth--
        if (depth === 0) {
          try { return JSON.parse(text.slice(i, j + 1)) } catch { /* try next '{' */ }
          break
        }
      }
    }
  }
  return null
}

// ── Context builders ──────────────────────────────────────────

function buildMatchContext(match, homeStats, awayStats) {
  return `
MATCH: ${match.home_team} vs ${match.away_team}
Stage: ${match.stage}${match.group_name ? ` Group ${match.group_name}` : ''}
Date: ${match.match_date} (Beijing UTC+8)
Venue: ${match.venue || 'TBD'}, ${match.city || ''}

HOME TEAM STATS (${match.home_team}):
  Goals scored/game:   ${homeStats?.goals_scored_avg ?? 'N/A'}
  Goals conceded/game: ${homeStats?.goals_conceded_avg ?? 'N/A'}
  xGF/game:            ${homeStats?.xgf_per_game ?? 'N/A'}
  xGA/game:            ${homeStats?.xga_per_game ?? 'N/A'}
  Home goals/game:     ${homeStats?.home_goals_avg ?? 'N/A'}
  Form (latest→old):   ${homeStats?.form_string ?? 'N/A'}
  Games in window:     ${homeStats?.games_window ?? 0}/5
  WC games in window:  ${homeStats?.wc_games_in_window ?? 0}

AWAY TEAM STATS (${match.away_team}):
  Goals scored/game:   ${awayStats?.goals_scored_avg ?? 'N/A'}
  Goals conceded/game: ${awayStats?.goals_conceded_avg ?? 'N/A'}
  xGF/game:            ${awayStats?.xgf_per_game ?? 'N/A'}
  xGA/game:            ${awayStats?.xga_per_game ?? 'N/A'}
  Away goals/game:     ${awayStats?.away_goals_avg ?? 'N/A'}
  Form (latest→old):   ${awayStats?.form_string ?? 'N/A'}
  Games in window:     ${awayStats?.games_window ?? 0}/5
  WC games in window:  ${awayStats?.wc_games_in_window ?? 0}
`.trim()
}

function buildPhase1Context(phase1Results) {
  return phase1Results
    .filter(r => r?.output)
    .map(r => `ROLE ${r.roleNumber} (${r.roleName}):\n${JSON.stringify(r.output, null, 2)}`)
    .join('\n\n---\n\n')
}

// ── Role system prompts ───────────────────────────────────────

const JSON_INSTRUCTION = `
CRITICAL: Your ENTIRE response must be ONLY a raw JSON object.
Do NOT use markdown. Do NOT use code blocks. Do NOT write backticks.
Do NOT write the word "json". Do NOT write anything before { or after }.
First character must be { and last character must be }. No prose, no preamble.
Required schema (copy exactly, fill in values):
{"role":<number>,"summary":"<text>","signals":["<signal>"],"confidence":<0.00-1.00>,"recommendation":"<home_win|away_win|draw|over|under|value_home|value_away|null>","flags":[]}
`.trim()

function rolePrompt(roleNumber, roleName, matchContext) {
  const base = `You are the ${roleName} (Role ${roleNumber}) in Metis, a WC2026 betting intelligence system.\n${JSON_INSTRUCTION}\n\nMATCH DATA:\n${matchContext}`

  const roleInstructions = {
    1: `\nFocus: Validate the statistical inputs. Check if games_window is 5 (flag if lower). Check if xGF/xGA data is present (flag if missing). Assess if goals_scored_avg looks reasonable for a WC team (flag outliers > 3.0 or < 0.5). Rate data quality. Your confidence reflects data integrity, not match outcome.`,

    2: `\nFocus: Analyse the form strings. W=win, D=draw, L=loss, latest result first. Calculate win rate, momentum direction (improving/declining/flat), streak length. Consider recency weighting (most recent game = 30% weight). Flag if fewer than 5 form results available.`,

    4: `\nFocus: WC-specific context. Consider: group stage math (does team need a win/draw?), rest days between matches (flag if < 3 days), travel distance, squad rotation likelihood if already qualified. Stage of tournament: group stage vs knockout changes motivation significantly.`,

    5: `\nFocus: Market intelligence signals. Without live odds data, assess: is this a high-profile match likely to attract sharp money? Which side is more likely to be public favourite vs sharp play? Flag if market is likely to be efficient (major nations) vs inefficient (smaller nations). Note any known market biases for these teams.`,

    6: `\nFocus: Risk management. Based on data quality (games_window, xG availability) and form consistency, what is the risk level (low/medium/high)? Recommend bet sizing tier: full (edge ≥8%), half (edge 5-8%), skip (<5%). Flag if any stats suggest the Poisson model may be unreliable for this match.`,

    7: `\nFocus: Tactical analysis. Based on team names and WC context, assess: likely defensive shape (high/mid/low block), pressing intensity, set-piece threat, pace on counter. Which tactical matchup advantages are evident? Note: work with available data — do not invent specific player stats.`,

    8: `\nFocus: Head-to-head history. Based on known historical context between these nations: H2H win/loss tendency, typical score patterns (high/low scoring), psychological edge, any notable rivalry or recent tournament encounters. If H2H is limited or unknown, state this and adjust confidence accordingly.`,

    9: `\nFocus: Motivation scoring (0–10 scale for each team). Factors: must-win pressure, already qualified status, group permutations, rivalry intensity, pride/prestige, home advantage (WC host considerations). Higher motivation differential = bigger edge for motivated side.`,

    10: `\nFocus: You are the Composite Scorer. Your confidence is the final score as a DECIMAL between 0.00 and 1.00 (e.g. 0.72 means 72%) — never write a number above 1. Synthesise all role outputs into a single score. Weight: data quality (Role 1) = 25%, form (Role 2) = 20%, context (Roles 4,9) = 20%, risk (Role 6) = 20%, tactical/H2H (Roles 7,8) = 15%. Your recommendation is the consensus bet direction. In ADDITION to the standard fields, include: "verdict" (one concise sentence stating conviction and role agreement, e.g. "Strong HOME WIN conviction — 6/7 roles agree"); "drivers" (array of exactly 3 short one-line strings); "calc_note" (one line showing the weighted math); "risk_flags" (array of short warning strings, empty if none). Keep "summary" as the full paragraph for fallback.`,
  }

  return base + (roleInstructions[roleNumber] || '')
}

function role3Prompt(matchContext, phase1Context) {
  return `You are the Deep Analysis engine (Role 3) in Metis, a WC2026 betting intelligence system.
You receive the full match data AND all specialist role outputs. Your job is to synthesise everything into a final, nuanced recommendation.
${JSON_INSTRUCTION}

MATCH DATA:
${matchContext}

SPECIALIST ROLE OUTPUTS:
${phase1Context}`
}

// ── Main handler ──────────────────────────────────────────────

export async function onRequestPost(context) {
  const { request, env } = context

  // MT25: 55s timeout (CF Pages Functions limit = 60s)
  const controller = new AbortController()
  const timeout    = setTimeout(() => controller.abort(), 55_000)

  try {
    // Auth check — any approved user
    const authResult = await verifyUser(request, env)
    if (!authResult) return jsonRes({ error: 'Unauthorized' }, 401)

    const { profile } = authResult

    // Status check
    if (profile.status !== 'approved') return jsonRes({ error: 'ACCESS_DENIED' }, 403)

    // Credit check and deduction BEFORE Claude calls (prevent race conditions)
    if (profile.tier === 'power' || profile.tier === 'standard') {
      if (profile.credits_remaining < 5) {
        return jsonRes({ error: 'INSUFFICIENT_CREDITS', credits_remaining: profile.credits_remaining }, 402)
      }
      await deductCredits(env, profile.id, profile.credits_remaining)
    }
    // admin / ultra: unlimited — skip credit check

    // Parse body
    let body = {}
    try { body = await request.json() } catch { /* empty ok */ }
    const { match_id } = body
    if (!match_id) return jsonRes({ error: 'match_id required' }, 400)

    // Load match + stats + roles from Supabase
    const [match, statsRows, aiRoles, calibration] = await Promise.all([
      getMatch(env, match_id),
      getTeamStats(env, match_id),
      getAiRoles(env),
      getCalibration(env),
    ])

    // Build stats lookup
    const homeStats = statsRows.find(s => s.team_code === match.home_team_code) || null
    const awayStats = statsRows.find(s => s.team_code === match.away_team_code) || null
    const matchCtx  = buildMatchContext(match, homeStats, awayStats)

    // Build role lookup: role_number → db row
    const roleByNumber = {}
    for (const r of aiRoles) roleByNumber[r.role_number] = r

    // ── Phase 1: Roles 1,2,4,5,6,7,8,9 — parallel Haiku ──────
    const PHASE1_ROLES = [1, 2, 4, 5, 6, 7, 8, 9]

    const phase1Results = await Promise.allSettled(
      PHASE1_ROLES
        .filter(n => roleByNumber[n])
        .map(async (roleNumber) => {
          const roleRow  = roleByNumber[roleNumber]
          const system   = rolePrompt(roleNumber, roleRow.role_name, matchCtx)
          const userMsg  = `Analyse this WC2026 match and return your JSON assessment.`

          let output
          try {
            output = await callClaude(env, HAIKU_MODEL, system, userMsg, controller.signal)
          } catch (err) {
            output = {
              role: roleNumber, summary: `Role ${roleNumber} failed: ${err.message}`,
              signals: [], confidence: null, recommendation: null, flags: ['call_error'],
            }
          }

          applyCalibration(output, calibration[roleRow.id])

          // Write to Supabase (non-blocking failure)
          try {
            await upsertOutput(env, match_id, roleRow.id, output, output.confidence)
          } catch { /* log silently — don't fail the whole request */ }

          return { roleNumber, roleName: roleRow.role_name, output }
        })
    )

    const phase1Outputs = phase1Results
      .filter(r => r.status === 'fulfilled')
      .map(r => r.value)

    // ── Phase 2: Role 3 — Sonnet, sequential ─────────────────
    let role3Output = null
    if (roleByNumber[3]) {
      const phase1Ctx = buildPhase1Context(phase1Outputs)
      const system    = role3Prompt(matchCtx, phase1Ctx)
      const userMsg   = `Provide your deep analysis and final recommendation.`

      try {
        role3Output = await callClaude(env, SONNET_MODEL, system, userMsg, controller.signal, 1024)
        applyCalibration(role3Output, calibration[roleByNumber[3].id])
        await upsertOutput(env, match_id, roleByNumber[3].id, role3Output, role3Output.confidence)
      } catch (err) {
        role3Output = {
          role: 3, summary: `Deep Analysis failed: ${err.message}`,
          signals: [], confidence: null, recommendation: null, flags: ['call_error'],
        }
      }
    }

    // ── Phase 3: Role 10 — Composite Scorer ──────────────────
    let role10Output = null
    if (roleByNumber[10]) {
      const allContext = [
        ...phase1Outputs,
        role3Output ? { roleNumber: 3, roleName: 'Deep Analysis', output: role3Output } : null,
      ].filter(Boolean)

      const allCtxStr = buildPhase1Context(allContext)
      const system = rolePrompt(10, 'Composite Scorer',
        `${matchCtx}\n\nALL ROLE OUTPUTS:\n${allCtxStr}`
      )
      const userMsg = `Synthesise all role outputs into a composite confidence score.`

      // Role 10 gets its own 15s controller — independent of main timeout
      const r10controller = new AbortController()
      const r10timeout = setTimeout(() => r10controller.abort(), 15_000)

      try {
        role10Output = await callClaude(env, HAIKU_MODEL, system, userMsg, r10controller.signal, 1024)
        clearTimeout(r10timeout)
        applyCalibration(role10Output, calibration[roleByNumber[10].id])
        await upsertOutput(env, match_id, roleByNumber[10].id, role10Output, role10Output.confidence)
      } catch (err) {
        clearTimeout(r10timeout)
        role10Output = {
          role: 10, summary: `Composite Scorer failed: ${err.message}`,
          signals: [], confidence: null, recommendation: null, flags: ['call_error'],
        }
      }
    }

    clearTimeout(timeout)

    // Return all outputs
    const allOutputs = [
      ...phase1Outputs.map(r => r.output),
      role3Output,
      role10Output,
    ].filter(Boolean)

    return jsonRes({
      ok:             true,
      match_id,
      roles_run:      allOutputs.length,
      composite:      role10Output,
      recommendation: role10Output?.recommendation || role3Output?.recommendation || null,
      confidence:     role10Output?.confidence     || null,
      outputs:        allOutputs,
      timestamp:      new Date().toISOString(),
    })

  } catch (err) {
    clearTimeout(timeout)
    if (err.name === 'AbortError') {
      return jsonRes({ error: 'Timeout (MT25)', details: 'Worker exceeded 28s' }, 504)
    }
    return jsonRes({ error: 'Analysis failed', details: err.message }, 500)
  }
}
