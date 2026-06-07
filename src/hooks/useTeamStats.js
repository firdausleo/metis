import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { fetchTeamStats } from '../lib/statsApi'

function buildStatsRow(matchId, teamCode, footyData) {
  const mp = footyData.matches_played || 0
  return {
    team_code: teamCode,
    match_id: matchId,
    xgf_per_game: footyData.xgf && mp ? Number((footyData.xgf / mp).toFixed(3)) : null,
    xga_per_game: footyData.xga && mp ? Number((footyData.xga / mp).toFixed(3)) : null,
    goals_scored_avg: footyData.scored && mp ? Number((footyData.scored / mp).toFixed(3)) : null,
    goals_conceded_avg: footyData.conceded && mp ? Number((footyData.conceded / mp).toFixed(3)) : null,
    games_window: mp,
    wc_games_in_window: 0,
    updated_at: new Date().toISOString(),
  }
}

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
      .select('id, team_code, match_id, games_window, goals_scored_avg, goals_conceded_avg, home_goals_avg, away_goals_avg, xgf_per_game, xga_per_game, form_string, wc_games_in_window, data_source, updated_at')
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

  async function refreshStats(homeTeam, awayTeam) {
    if (!match?.id) return
    setError(null)
    try {
      const [homeData, awayData] = await Promise.all([
        fetchTeamStats(homeTeam),
        fetchTeamStats(awayTeam),
      ])
      const rows = [
        buildStatsRow(match.id, match.home_team_code, homeData),
        buildStatsRow(match.id, match.away_team_code, awayData),
      ]
      await supabase.from('team_stats').upsert(rows, { onConflict: 'team_code,match_id' })
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
