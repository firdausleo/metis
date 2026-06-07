import { supabase } from './supabase'

async function getAuthToken() {
  const { data: { session } } = await supabase.auth.getSession()
  return session?.access_token
}

export async function fetchTeamStats(teamName) {
  const token = await getAuthToken()
  if (!token) throw new Error('Not authenticated')

  const response = await fetch(
    `/api/fetch-stats?team=${encodeURIComponent(teamName)}`,
    {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    }
  )

  if (!response.ok) {
    throw new Error(`Stats fetch failed: ${response.status}`)
  }

  return response.json()
}

export async function settleMatch(matchId, homeScore, awayScore) {
  const token = await getAuthToken()
  if (!token) throw new Error('Not authenticated')

  const response = await fetch('/api/settle-match', {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      match_id: matchId,
      home_score: homeScore,
      away_score: awayScore,
    }),
  })

  if (!response.ok) {
    throw new Error(`Settle failed: ${response.status}`)
  }

  return response.json()
}

/**
 * Admin: trigger bulk sync of all upcoming match stats via CF Worker.
 * POST /api/sync-stats
 * Optional: pass matchIds array to sync specific matches only.
 */
export async function syncAllStats(matchIds) {
  const token = await getAuthToken()
  if (!token) throw new Error('Not authenticated')

  const body = matchIds?.length ? { match_ids: matchIds } : {}

  const response = await fetch('/api/sync-stats', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    throw new Error(`Sync failed: ${response.status}`)
  }

  return response.json()
}
