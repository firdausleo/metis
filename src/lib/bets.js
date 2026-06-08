/**
 * bets.js — Stage 6 bet placement, settlement, P&L
 * RLS isolates rows per user (MT05). Decimal odds only (MT09).
 */
import { supabase } from './supabase'

/** Place a bet for the current user. */
export async function placeBet({ matchId, betType, selection, odds, stake }) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not signed in')
  const { error } = await supabase.from('bets').insert({
    user_id: user.id, match_id: matchId, bet_type: betType,
    selection, odds, stake, status: 'pending',
  })
  if (error) throw error
}

/** All bets for the current user, newest first, with match joined. */
export async function fetchMyBets() {
  const { data, error } = await supabase
    .from('bets')
    .select('*, match:matches(home_team,away_team,home_score,away_score,status,match_date)')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

/** P&L for a settled bet. Won: stake*(odds-1); lost: -stake; void: 0. */
export function calcPnl(bet) {
  if (bet.status === 'won')  return bet.stake * (bet.odds - 1)
  if (bet.status === 'lost') return -bet.stake
  return 0
}

/** Resolve a 1X2 bet against a final score. Returns 'won'|'lost'. */
export function resultFor1X2(selection, home, away) {
  const r = home > away ? 'home' : home < away ? 'away' : 'draw'
  return selection === r ? 'won' : 'lost'
}

/** Settle one bet to a status and write pnl. */
export async function settleBet(betId, status, pnl) {
  const { error } = await supabase.from('bets').update({ status, pnl }).eq('id', betId)
  if (error) throw error
}

/** Aggregate stats for a bet list. */
export function portfolioStats(bets) {
  const settled = bets.filter(b => b.status === 'won' || b.status === 'lost')
  const staked = settled.reduce((s, b) => s + Number(b.stake), 0)
  const pnl = settled.reduce((s, b) => s + (b.pnl != null ? Number(b.pnl) : calcPnl(b)), 0)
  const wins = settled.filter(b => b.status === 'won').length
  return {
    total: bets.length,
    settled: settled.length,
    pending: bets.length - settled.length,
    staked, pnl,
    roi: staked ? (pnl / staked) * 100 : 0,
    winRate: settled.length ? (wins / settled.length) * 100 : 0,
  }
}
