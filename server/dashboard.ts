import { type DB, getTokens, getProfile, getLastSyncedAt, hasIncompleteSync } from '../lib/db'
import {
  getDailySeries, getLatestSnapshot, averages, getRecentSleeps, getSleepAverages,
  getWeekdayPattern, getSportBreakdown, getRecentWorkouts, getWorkoutTotals, getRecords, getHeatmap,
} from '../lib/stats'
import { redirectUri } from '../lib/whoop'
import type { DashboardResponse } from '../lib/dashboard-types'

export function dashboard(db: DB): DashboardResponse {
  if (!process.env.WHOOP_CLIENT_ID || !process.env.WHOOP_CLIENT_SECRET) {
    return { state: 'setup', redirectUri: redirectUri() }
  }
  if (!getTokens(db)) return { state: 'disconnected' }
  const series = getDailySeries(db)
  const snapshot = getLatestSnapshot(series)
  if (!snapshot) return { state: 'empty' }
  return { state: 'ready', data: {
    name: getProfile(db)?.first_name ?? null,
    lastSynced: getLastSyncedAt(db), syncIncomplete: hasIncompleteSync(db),
    series, snapshot, averages: averages(series, 30),
    sleeps: getRecentSleeps(db), sleepAverages: getSleepAverages(db, 30, snapshot.date),
    weekdays: getWeekdayPattern(db, series), sports: getSportBreakdown(db),
    workouts: getRecentWorkouts(db, 10), workoutTotals: getWorkoutTotals(db, series),
    records: getRecords(db), heatmap: getHeatmap(db, series),
  } }
}
