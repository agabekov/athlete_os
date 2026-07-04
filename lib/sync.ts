import {
  type DB, saveProfile, saveBodyMeasurement, setSyncState,
  upsertCycle, upsertRecovery, upsertSleep, upsertWorkout,
} from './db'
import type { WhoopApi } from './whoop'

const OVERLAP_MS = 14 * 86400000 // re-fetch recent records; WHOOP re-scores them

const RESOURCES = [
  { name: 'cycles', path: '/cycle', upsert: upsertCycle, watermarkSql: 'SELECT MAX(start_time) AS m FROM cycles' },
  {
    name: 'recoveries',
    path: '/recovery',
    upsert: upsertRecovery,
    watermarkSql: 'SELECT MAX(c.start_time) AS m FROM recoveries r JOIN cycles c ON c.id = r.cycle_id',
  },
  { name: 'sleeps', path: '/activity/sleep', upsert: upsertSleep, watermarkSql: 'SELECT MAX(start_time) AS m FROM sleeps' },
  { name: 'workouts', path: '/activity/workout', upsert: upsertWorkout, watermarkSql: 'SELECT MAX(start_time) AS m FROM workouts' },
] as const

export interface SyncResult {
  full: boolean
  counts: { cycles: number; recoveries: number; sleeps: number; workouts: number }
}

function newestResourceStart(db: DB, sql: string): string | null {
  const row = db.prepare(sql).get() as { m: string | null }
  return row.m
}

export async function runSync(db: DB, api: WhoopApi): Promise<SyncResult> {
  saveProfile(db, await api.get('/user/profile/basic'))
  saveBodyMeasurement(db, await api.get('/user/measurement/body'))

  const counts = { cycles: 0, recoveries: 0, sleeps: 0, workouts: 0 }
  let full = false
  for (const r of RESOURCES) {
    // Full-vs-incremental is decided per resource from sync_state, which is only
    // written AFTER a resource's pagination completes — so an interrupted full
    // sync re-runs as full instead of silently skipping older history.
    const completedBefore = db.prepare('SELECT 1 FROM sync_state WHERE resource = ?').get(r.name)
    const params: Record<string, string> = {}
    if (completedBefore) {
      const newest = newestResourceStart(db, r.watermarkSql)
      if (newest) params.start = new Date(Date.parse(newest) - OVERLAP_MS).toISOString()
    } else {
      full = true
    }
    for await (const page of api.paginate(r.path, params)) {
      db.transaction(() => {
        for (const rec of page) r.upsert(db, rec)
      })()
      counts[r.name] += page.length
    }
    setSyncState(db, r.name, new Date().toISOString())
  }
  return { full, counts }
}
