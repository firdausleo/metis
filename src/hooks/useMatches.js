import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { isToday, isUpcoming } from '../lib/dateUtils'

export function useMatches() {
  const [matches, setMatches] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const fetchMatches = useCallback(async () => {
    setLoading(true)
    setError(null)
    const { data, error: err } = await supabase
      .from('matches')
      .select('*')
      .order('match_date', { ascending: true })
    setLoading(false)
    if (err) {
      setError(err.message)
    } else {
      setMatches(data || [])
    }
  }, [])

  useEffect(() => { fetchMatches() }, [fetchMatches])

  return { matches, loading, error, refetch: fetchMatches }
}

export function useMatchesByGroup() {
  const { matches, loading, error, refetch } = useMatches()

  const matchesByGroup = {}
  for (const match of matches) {
    if (match.stage === 'group') {
      const g = match.group_name
      if (!matchesByGroup[g]) matchesByGroup[g] = []
      matchesByGroup[g].push(match)
    } else {
      if (!matchesByGroup['knockout']) matchesByGroup['knockout'] = []
      matchesByGroup['knockout'].push(match)
    }
  }

  return { matchesByGroup, matches, loading, error, refetch }
}

export function getTodaysMatches(matches) {
  return matches.filter(m => isToday(m.match_date))
}

export function getUpcomingMatches(matches) {
  return matches.filter(m => m.status === 'upcoming' && isUpcoming(m.match_date))
}
