/**
 * scripts/resync-r32.mjs
 *
 * Calls /api/sync-stats for every stage='r32' match to populate
 * team_stats + model_predictions (V3/V4) for all R32 slots.
 * Uses a 2s delay between calls to avoid rate-limiting.
 *
 * Usage:
 *   HTTPS_PROXY=http://127.0.0.1:7890 node scripts/resync-r32.mjs
 */

const SUPABASE_URL = 'https://wmxhcwellqtagpndpyhk.supabase.co'
const SERVICE_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndteGhjd2VsbHF0YWdwbmRweWhrIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MDgzODEzMSwiZXhwIjoyMDk2NDE0MTMxfQ.RvWIwMJ0Bm_2KQbvSeKV_yZQgU1_vTrPYkXHRavYHd4'
const SYNC_URL     = 'https://metis.tiga6.com/api/sync-stats'

async function fetchR32Ids() {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/matches?stage=eq.r32&select=id,home_team,away_team,status&order=match_date`,
    { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }
  )
  if (!res.ok) throw new Error(`Supabase fetch failed: ${res.status}`)
  return res.json()
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)) }

async function run() {
  const matches = await fetchR32Ids()
  console.log(`Found ${matches.length} R32 matches\n`)

  for (const m of matches) {
    console.log(`Syncing ${m.home_team} vs ${m.away_team} [${m.status}]...`)
    try {
      const r = await fetch(SYNC_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SERVICE_KEY}`,
        },
        body: JSON.stringify({ match_ids: [m.id] }),
      })
      const json = await r.json()
      if (json.message === 'No upcoming matches found') {
        console.log(`  → skipped (no upcoming filter bypass — check getUpcomingMatches)`)
      } else {
        console.log(`  → ${JSON.stringify(json).slice(0, 120)}`)
      }
    } catch (e) {
      console.error(`  → ERROR: ${e.message}`)
    }
    await delay(2000)
  }

  console.log('\nDone. Run fix-v1v2-predictions.mjs --commit next.')
}

run().catch(e => { console.error(e); process.exit(1) })
