import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'

function calcConfidence(stats) {
  if (!stats.home || !stats.away) return 'low'
  const wc = Math.min(stats.home.wc_games_in_window || 0, stats.away.wc_games_in_window || 0)
  if (wc === 0) return 'low'
  if (wc <= 2) return 'medium'
  if (wc === 3) return 'high'
  return 'max'
}

export function useTeamStats(match) {
  const [stats, setStats] = useState({ home: null, away: null })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [lastUpdated, setLastUpdated] = useState(null)

  const loadFromDB = useCallback(async () => {
    if (!match?.id) { setLoading(false); return }
    setLoading(true)
    setError(null)

    const { data, error: err } = await supabase
      .from('team_stats')
      .select('id, team_code, match_id, games_window, goals_scored_avg, goals_conceded_avg, home_goals_avg, away_goals_avg, xgf_per_game, xga_per_game, form_string, wc_games_in_window, recent_fixtures, data_source, updated_at')
      .eq('match_id', match.id)

    setLoading(false)
    if (err) { setError(err.message); return }

    const homeStats = data?.find(s => s.team_code === match.home_team_code) || null
    const awayStats = data?.find(s => s.team_code === match.away_team_code) || null
    setStats({ home: homeStats, away: awayStats })

    const latest = data?.reduce((acc, s) => (!acc || s.updated_at > acc ? s.updated_at : acc), null)
    setLastUpdated(latest)
  }, [match?.id, match?.home_team_code, match?.away_team_code])

  useEffect(() => { loadFromDB() }, [loadFromDB])

  async function refreshStats() {
    if (!match?.id) return
    setError(null)
    try {
      // Use CF Worker — runs outside China, has service role key (MT03)
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) throw new Error('Not authenticated')

      const res = await fetch('/api/sync-stats', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ match_ids: [match.id] }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `Sync failed: ${res.status}`)
      // Worker swallows fetch failures into scrape_error and returns ok — surface them
      if (data.scrape_error) throw new Error(`API-Football: ${data.scrape_error}`)
      if (data.teams_found === 0) throw new Error('No teams resolved from API-Football — check API key / team mapping')
      if (data.unresolved?.length) throw new Error(`Unmapped teams: ${data.unresolved.join(', ')}`)
      await loadFromDB()
    } catch (err) {
      setError(err.message)
    }
  }

  async function saveManualStats(teamCode, statsObj) {
    if (!match?.id) return
    const row = {
      team_code: teamCode,
      match_id: match.id,
      ...statsObj,
      updated_at: new Date().toISOString(),
    }
    const { error: err } = await supabase
      .from('team_stats')
      .upsert(row, { onConflict: 'team_code,match_id' })
    if (err) { setError(err.message); return }
    await loadFromDB()
  }

  return {
    stats,
    loading,
    error,
    confidence: calcConfidence(stats),
    refreshStats,
    saveManualStats,
    lastUpdated,
    refetch: loadFromDB,
  }
}
