/**
 * One-time cleanup: remove stale and null team_stats rows.
 *
 * Run: node scripts/cleanTeamStats.js
 * Requires SUPABASE_SERVICE_ROLE_KEY in .env.local (or env)
 *
 * SQL equivalent:
 *   DELETE FROM team_stats
 *   WHERE goals_scored_avg IS NULL AND xgf_per_game IS NULL AND games_window = 0;
 *
 *   DELETE FROM team_stats
 *   WHERE team_code = 'SEN'
 *     AND match_id = '3f78c57c-39dd-4331-b47c-0fed05f700b5';
 */
import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'

dotenv.config({ path: '.env.local' })

const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!key) {
  console.error('❌  SUPABASE_SERVICE_ROLE_KEY required — set it in .env.local')
  process.exit(1)
}

const supabase = createClient(process.env.VITE_SUPABASE_URL, key)

async function main() {
  // 1. Delete all null/empty rows (games_window=0, no stats)
  const { error: e1, count: c1 } = await supabase
    .from('team_stats')
    .delete({ count: 'exact' })
    .is('goals_scored_avg', null)
    .is('xgf_per_game', null)
    .eq('games_window', 0)

  if (e1) { console.error('❌  Delete null rows failed:', e1.message); process.exit(1) }
  console.log(`✅  Deleted ${c1 ?? '?'} null/empty team_stats rows`)

  // 2. Delete the stale SEN row stored against the NED vs JPN match
  const STALE_MATCH = '3f78c57c-39dd-4331-b47c-0fed05f700b5'
  const { error: e2, count: c2 } = await supabase
    .from('team_stats')
    .delete({ count: 'exact' })
    .eq('team_code', 'SEN')
    .eq('match_id', STALE_MATCH)

  if (e2) { console.error('❌  Delete stale SEN row failed:', e2.message); process.exit(1) }
  console.log(`✅  Deleted ${c2 ?? '?'} stale SEN row(s) from match ${STALE_MATCH}`)

  // 3. Verify match 3f78c57c now has zero rows
  const { data: remaining } = await supabase
    .from('team_stats')
    .select('team_code, games_window')
    .eq('match_id', STALE_MATCH)

  if (remaining?.length) {
    console.log(`ℹ️  Remaining rows for ${STALE_MATCH}:`, remaining)
  } else {
    console.log(`✅  Match ${STALE_MATCH} now has 0 team_stats rows — ready for fresh fetch`)
  }
}

main().catch(err => { console.error('❌', err); process.exit(1) })
