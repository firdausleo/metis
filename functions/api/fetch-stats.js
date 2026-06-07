// CF Pages Function: GET /api/fetch-stats?team=TeamName
// Fetches WC team stats from footystats.org and returns parsed data.
// Auth: requires Supabase Bearer token (any authenticated user).

const NAME_MAP = {
  'Spain': 'Spain National Team',
  'England': 'England National Team',
  'France': 'France National Team',
  'Brazil': 'Brazil National Team',
  'Argentina': 'Argentina National Team',
  'Germany': 'Germany National Team',
  'Portugal': 'Portugal National Team',
  'Netherlands': 'Netherlands National Team',
  'Belgium': 'Belgium National Team',
  'Japan': 'Japan National Team',
  'USA': 'United States',
  'South Korea': 'South Korea National Team',
  'Mexico': 'Mexico National Team',
  'Uruguay': 'Uruguay National Team',
  'Colombia': 'Colombia National Team',
  'Senegal': 'Senegal National Team',
  'Morocco': 'Morocco National Team',
  'Croatia': 'Croatia National Team',
  'Serbia': 'Serbia National Team',
  'Switzerland': 'Switzerland National Team',
  'Canada': 'Canada National Team',
  'Australia': 'Australia National Team',
  'Norway': 'Norway National Team',
  'Austria': 'Austria National Team',
  'Turkiye': 'Turkey National Team',
  'Ecuador': 'Ecuador National Team',
  'Peru': 'Peru National Team',
  'Ghana': 'Ghana National Team',
  'Egypt': 'Egypt National Team',
  'Algeria': 'Algeria National Team',
  'Saudi Arabia': 'Saudi Arabia National Team',
  'Iran': 'Iran National Team',
  'Qatar': 'Qatar National Team',
  'Jordan': 'Jordan National Team',
  'Scotland': 'Scotland National Team',
  'Haiti': 'Haiti National Team',
  'Panama': 'Panama National Team',
  'Paraguay': 'Paraguay National Team',
  'Cape Verde': 'Cape Verde Islands National Team',
  'DR Congo': 'Congo DR National Team',
  'Curacao': 'Curacao National Team',
  'New Zealand': 'New Zealand National Team',
  'Bosnia-Herzegovina': 'Bosnia And Herzegovina National Team',
  'Czechia': 'Czech Republic National Team',
  'South Africa': 'South Africa National Team',
}

async function verifyAuth(request, env) {
  const authHeader = request.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return null

  const response = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      'Authorization': authHeader,
      'apikey': env.SUPABASE_ANON_KEY,
    },
  })
  if (!response.ok) return null
  return response.json()
}

async function fetchFootyStats(teamName) {
  const xgUrl = 'https://footystats.org/international/world-cup/xg'

  try {
    const response = await fetch(xgUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Metis/1.0)',
        'Accept': 'text/html,application/xhtml+xml',
      },
    })

    if (!response.ok) {
      throw new Error(`footystats returned ${response.status}`)
    }

    const html = await response.text()
    return parseFootyStatsXG(html, teamName)
  } catch (err) {
    return {
      team: teamName,
      source: 'error',
      error: err.message,
      xgf: null,
      xga: null,
      scored: null,
      conceded: null,
      matches_played: 0,
    }
  }
}

function parseFootyStatsXG(html, teamName) {
  const footyName = NAME_MAP[teamName] || teamName

  const teamPattern = new RegExp(
    footyName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
    'i'
  )
  const teamIndex = html.search(teamPattern)

  if (teamIndex === -1) {
    return {
      team: teamName,
      source: 'not_found',
      xgf: null,
      xga: null,
      scored: null,
      conceded: null,
      matches_played: 0,
    }
  }

  const chunk = html.slice(teamIndex, teamIndex + 2000)
  const numbers = chunk.match(/\d+\.?\d*/g)

  if (!numbers || numbers.length < 6) {
    return {
      team: teamName,
      source: 'parse_error',
      xgf: null,
      xga: null,
      scored: null,
      conceded: null,
      matches_played: 0,
    }
  }

  return {
    team: teamName,
    source: 'footystats',
    matches_played: parseInt(numbers[0]) || 0,
    xgf: parseFloat(numbers[1]) || null,
    xga: parseFloat(numbers[2]) || null,
    // numbers[3] = xGD — skip
    scored: parseFloat(numbers[4]) || null,
    conceded: parseFloat(numbers[5]) || null,
    fetched_at: new Date().toISOString(),
  }
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
}

export async function onRequestGet(context) {
  const { request, env } = context

  const user = await verifyAuth(request, env)
  if (!user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: CORS })
  }

  const url = new URL(request.url)
  const teamName = url.searchParams.get('team')
  if (!teamName) {
    return new Response(JSON.stringify({ error: 'team parameter required' }), { status: 400, headers: CORS })
  }

  const stats = await fetchFootyStats(teamName)
  return new Response(JSON.stringify(stats), { status: 200, headers: CORS })
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    },
  })
}
