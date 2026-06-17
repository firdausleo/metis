// scripts/seed-predictions.mjs
// Run: SUPABASE_SERVICE_KEY=xxx node scripts/seed-predictions.mjs
// Populates model_predictions for all upcoming matches using DC ratings

import { createClient } from '@supabase/supabase-js'
import {
  dcLambdas,
  dcScoreMatrix,
  matrixStats,
  isWC2026Host,
} from '../src/utils/dcRatings.js'

const SUPABASE_URL = 'https://wmxhcwellqtagpndpyhk.supabase.co'
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY

if (!SERVICE_KEY) {
  console.error('❌ Missing SUPABASE_SERVICE_KEY environment variable')
  console.error('Run: SUPABASE_SERVICE_KEY=your_service_role_key node scripts/seed-predictions.mjs')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY)

async function run() {
  console.log('Fetching upcoming matches...')

  const { data: matches, error } = await supabase
    .from('matches')
    .select('id, home_team, away_team, match_date')
    .eq('status', 'upcoming')
    .order('match_date')

  if (error) {
    console.error('❌ Failed to fetch matches:', error.message)
    process.exit(1)
  }

  console.log(`Found ${matches.length} upcoming matches\n`)

  const rows = []
  const skipped = []

  for (const match of matches) {
    try {
      const homeIsHost = isWC2026Host(match.home_team)
      const { lh, la } = dcLambdas(match.home_team, match.away_team, homeIsHost)

      if (!lh || !la || isNaN(lh) || isNaN(la) || lh <= 0 || la <= 0) {
        skipped.push(`${match.home_team} vs ${match.away_team} — invalid lambdas (lh=${lh}, la=${la})`)
        continue
      }

      const matrix = dcScoreMatrix(lh, la)
      const stats = matrixStats(matrix)

      // Find anchor total (highest probability goal total)
      const sortedTotals = [...stats.totalGoals].sort((a, b) => b.prob - a.prob)
      const anchor = sortedTotals[0]

      // Top scoreline
      const topScore = stats.topScores?.[0]
      const topScoreStr = topScore
        ? `${topScore.home}-${topScore.away}`
        : null

      // Low confidence if < 5 games data — we don't have stats info
      // at seed time so mark all as false (will be updated when stats fetched)
      const qualityWarning = false

      rows.push({
        match_id: match.id,
        v3_home_win: Math.round(stats.homeWin * 10000) / 10000,
        v3_draw:     Math.round(stats.draw     * 10000) / 10000,
        v3_away_win: Math.round(stats.awayWin  * 10000) / 10000,
        v1_home_win: Math.round(stats.homeWin  * 10000) / 10000,
        v1_draw:     Math.round(stats.draw     * 10000) / 10000,
        v1_away_win: Math.round(stats.awayWin  * 10000) / 10000,
        v3_lambda_home: Math.round(lh * 1000) / 1000,
        v3_lambda_away: Math.round(la * 1000) / 1000,
        v3_top_score:   topScoreStr,
        anchor_total:   anchor?.goals ?? null,
        model_version:  'v3-dc-only',
        quality_warning: qualityWarning,
        predicted_at:   new Date().toISOString(),
      })

      const h = (stats.homeWin * 100).toFixed(1)
      const d = (stats.draw    * 100).toFixed(1)
      const a = (stats.awayWin * 100).toFixed(1)
      const ht = match.home_team.padEnd(20)
      const at = match.away_team.padEnd(20)
      console.log(`✓ ${ht} vs ${at}  H:${h}%  D:${d}%  A:${a}%  anchor:${anchor?.goals}  top:${topScoreStr}`)

    } catch (err) {
      skipped.push(`${match.home_team} vs ${match.away_team} — ${err.message}`)
    }
  }

  if (skipped.length > 0) {
    console.log('\n⚠ Skipped:')
    skipped.forEach(s => console.log('  -', s))
  }

  if (rows.length === 0) {
    console.log('\n❌ No rows to insert — check DC ratings cover all teams')
    process.exit(1)
  }

  console.log(`\nUpserting ${rows.length} predictions...`)

  const { error: upsertError } = await supabase
    .from('model_predictions')
    .upsert(rows, {
      onConflict: 'match_id',
      ignoreDuplicates: false,
    })

  if (upsertError) {
    console.error('❌ Upsert failed:', upsertError.message)
    process.exit(1)
  }

  console.log(`\n✅ Done — ${rows.length} predictions seeded`)
  console.log('Match cards will now show predictions after page refresh.')
}

run()
