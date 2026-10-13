import {
  type DB, saveProfile, saveBodyMeasurement, setSyncState, markSyncStarted, markSyncCompleted,
  upsertCycle, upsertRecovery, upsertSleep, upsertWorkout,
} from './db'
import type { WhoopApi } from './whoop'
import type { CollectionPath, WhoopCollectionMap } from './whoop-types'

const OVERLAP_MS = 14 * 86400000 // re-fetch recent records; WHOOP re-scores them

export interface SyncResult {
  full: boolean
  counts: { cycles: number; recoveries: number; sleeps: number; workouts: number }
}

function resource<P extends CollectionPath>(
  name: keyof SyncResult['counts'], path: P,
  upsert: (db: DB, record: WhoopCollectionMap[P]) => void, watermarkSql: string,
) {
  return {
    name,
    watermarkSql,
    async syncPages(db: DB, api: WhoopApi, params: Record<string, string>): Promise<number> {
      let count = 0
      for await (const page of api.paginate(path, params)) {
        db.transaction(() => {
          for (const rec of page) upsert(db, rec)
        })()
        count += page.length
      }
      return count
    },
  }
}

const RESOURCES = [
  resource('cycles', '/cycle', upsertCycle, 'SELECT MAX(start_time) AS m FROM cycles'),
  resource('recoveries', '/recovery', upsertRecovery,
    'SELECT MAX(c.start_time) AS m FROM recoveries r JOIN cycles c ON c.id = r.cycle_id'),
  resource('sleeps', '/activity/sleep', upsertSleep, 'SELECT MAX(start_time) AS m FROM sleeps'),
  resource('workouts', '/activity/workout', upsertWorkout, 'SELECT MAX(start_time) AS m FROM workouts'),
]

function newestResourceStart(db: DB, sql: string): string | null {
  const row = db.prepare(sql).get() as { m: string | null }
  return row.m
}

const inFlightSyncs = new WeakMap<DB, Promise<SyncResult>>()

export function runSync(db: DB, api: WhoopApi): Promise<SyncResult> {
  const existing = inFlightSyncs.get(db)
  if (existing) return existing
  const pending = executeSync(db, api).finally(() => {
    if (inFlightSyncs.get(db) === pending) inFlightSyncs.delete(db)
  })
  inFlightSyncs.set(db, pending)
  return pending
}

async function executeSync(db: DB, api: WhoopApi): Promise<SyncResult> {
  markSyncStarted(db)
  // saveProfile checks the database owner before changing profile or history.
  saveProfile(db, await api.get('/user/profile/basic'))
  saveBodyMeasurement(db, await api.get('/user/measurement/body'))

  const counts = { cycles: 0, recoveries: 0, sleeps: 0, workouts: 0 }
  let full = false
  for (const r of RESOURCES) {
    const state = db.prepare('SELECT committed_watermark, watermark_initialized FROM sync_state WHERE resource = ?')
      .get(r.name) as { committed_watermark: string | null; watermark_initialized: number } | undefined
    const params: Record<string, string> = {}
    if (state?.watermark_initialized) {
      // Only a fully completed pagination advances this boundary. Records written
      // by an interrupted run cannot narrow the retry's original date range.
      if (state.committed_watermark) {
        params.start = new Date(Date.parse(state.committed_watermark) - OVERLAP_MS).toISOString()
      }
    } else {
      full = true
    }
    counts[r.name] = await r.syncPages(db, api, params)
    setSyncState(db, r.name, new Date().toISOString(), newestResourceStart(db, r.watermarkSql))
  }
  markSyncCompleted(db, new Date().toISOString())
  return { full, counts }
}
