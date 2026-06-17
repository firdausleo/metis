import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import { dcLambdas, dcScoreMatrix, matrixStats, isWC2026Host } from '../src/utils/dcRatings.js'

dotenv.config({ path: '.env.local' })

const url = process.env.VITE_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!key) {
  console.error('SUPABASE_SERVICE_ROLE_KEY not set in .env.local')
  process.exit(1)
}

const supabase = createClient(url, key)

async function run() {
  const { data: matches, error } = await supabase
    .from('matches')
    .select('id, home_team, away_team, match_date')
    .eq('status', 'upcoming')
    .order('match_date')

  if (error) { console.error(error); process.exit(1) }
  console.log(`Found ${matches.length} upcoming matches\n`)

  const rows = []

  for (const match of matches) {
    try {
      const homeIsHost = isWC2026Host(match.home_team)
      const { lh, la } = dcLambdas(match.home_team, match.away_team, homeIsHost)

      if (!lh || !la || isNaN(lh) || isNaN(la)) {
        console.warn(`SKIP ${match.home_team} vs ${match.away_team} — invalid lambdas`)
        continue
      }

      const matrix = dcScoreMatrix(lh, la)
      const stats = matrixStats(matrix)

      const topScore = stats.topScores?.[0]
      const sortedTotals = [...stats.totalGoals].sort((a, b) => b.prob - a.prob)
      const anchor = sortedTotals[0]

      rows.push({
        match_id: match.id,
        v3_home_win: Math.round(stats.homeWin * 10000) / 10000,
        v3_draw:     Math.round(stats.draw     * 10000) / 10000,
        v3_away_win: Math.round(stats.awayWin  * 10000) / 10000,
        v3_top_score: topScore?.score ?? null,
        anchor_total: anchor?.goals ?? null,
        quality_warning: false,
      })

      console.log(
        `✓ ${match.home_team} vs ${match.away_team}: ` +
        `H=${(stats.homeWin*100).toFixed(1)}% ` +
        `D=${(stats.draw*100).toFixed(1)}% ` +
        `A=${(stats.awayWin*100).toFixed(1)}% ` +
        `top=${topScore?.score} anchor=${anchor?.goals}`
      )
    } catch (err) {
      console.warn(`✗ ${match.home_team} vs ${match.away_team}: ${err.message}`)
    }
  }

  if (rows.length === 0) {
    console.log('No rows to insert')
    return
  }

  const { error: upsertError } = await supabase
    .from('model_predictions')
    .upsert(rows, { onConflict: 'match_id' })

  if (upsertError) {
    console.error('\nUpsert failed:', upsertError)
    process.exit(1)
  } else {
    console.log(`\n✅ Inserted/updated ${rows.length} predictions`)
  }
}

run()
