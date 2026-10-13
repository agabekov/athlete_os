import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import {
  createDb, getTokens, saveTokens, upsertCycle, upsertRecovery,
  upsertSleep, upsertWorkout, saveProfile, getProfile, assertAccountOwner, AccountMismatchError,
  getLastSyncedAt, hasIncompleteSync, markSyncStarted, markSyncCompleted,
} from '../lib/db'
import type { WhoopCycle } from '../lib/whoop-types'

const cycleRec = {
  id: 12345, start: '2026-06-10T21:00:00.000Z', end: '2026-06-11T21:00:00.000Z',
  timezone_offset: '+00:00', score_state: 'SCORED',
  score: { strain: 14.2, kilojoule: 9000, average_heart_rate: 72, max_heart_rate: 165 },
} satisfies WhoopCycle

describe('db', () => {
  it('creates schema and stores tokens', () => {
    const db = createDb(':memory:')
    expect(getTokens(db)).toBeNull()
    saveTokens(db, { access_token: 'a', refresh_token: 'r', expires_at: 123 })
    expect(getTokens(db)).toEqual({ access_token: 'a', refresh_token: 'r', expires_at: 123 })
    saveTokens(db, { access_token: 'a2', refresh_token: 'r2', expires_at: 456 })
    expect(getTokens(db)!.access_token).toBe('a2') // single-row upsert
  })

  it('creates local database files with owner-only permissions', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whoop-db-test-'))
    const file = path.join(dir, 'nested', 'whoop.db')
    const db = createDb(file)
    db.close()

    expect(fs.statSync(path.dirname(file)).mode & 0o777).toBe(0o700)
    expect(fs.statSync(file).mode & 0o777).toBe(0o600)
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('upserts cycles idempotently and extracts score columns', () => {
    const db = createDb(':memory:')
    upsertCycle(db, cycleRec)
    upsertCycle(db, { ...cycleRec, score: { ...cycleRec.score, strain: 15.0 } })
    const rows = db.prepare('SELECT * FROM cycles').all() as { strain: number; start_time: string; raw: string }[]
    expect(rows).toHaveLength(1)
    expect(rows[0].strain).toBe(15.0)
    expect(rows[0].start_time).toBe('2026-06-10T21:00:00.000Z')
    expect(JSON.parse(rows[0].raw).id).toBe(12345)
  })

  it('stores NULL score columns for unscored records', () => {
    const db = createDb(':memory:')
    upsertCycle(db, { ...cycleRec, score_state: 'PENDING_SCORE', score: undefined })
    const row = db.prepare('SELECT * FROM cycles').get() as { strain: number | null; score_state: string }
    expect(row.strain).toBeNull()
    expect(row.score_state).toBe('PENDING_SCORE')
  })

  it('upserts recovery, sleep, workout, profile', () => {
    const db = createDb(':memory:')
    upsertRecovery(db, {
      cycle_id: 12345, sleep_id: 'uuid-1', score_state: 'SCORED',
      score: { user_calibrating: false, recovery_score: 87, resting_heart_rate: 48,
        hrv_rmssd_milli: 112.5, spo2_percentage: 97.2, skin_temp_celsius: 33.1 },
    })
    upsertSleep(db, {
      id: 'uuid-1', start: '2026-06-10T22:00:00.000Z', end: '2026-06-11T06:00:00.000Z',
      timezone_offset: '+00:00', nap: false, score_state: 'SCORED',
      score: {
        stage_summary: {
          total_in_bed_time_milli: 28800000, total_awake_time_milli: 1800000,
          total_light_sleep_time_milli: 14000000, total_slow_wave_sleep_time_milli: 6000000,
          total_rem_sleep_time_milli: 7000000, disturbance_count: 4,
        },
        sleep_needed: {
          baseline_milli: 27000000, need_from_sleep_debt_milli: 1000000,
          need_from_recent_strain_milli: 500000, need_from_recent_nap_milli: 0,
        },
        respiratory_rate: 15.2, sleep_performance_percentage: 92,
        sleep_consistency_percentage: 80, sleep_efficiency_percentage: 94,
      },
    })
    upsertWorkout(db, {
      id: 'uuid-w1', start: '2026-06-11T10:00:00.000Z', end: '2026-06-11T11:00:00.000Z',
      timezone_offset: '+00:00', sport_name: 'running', score_state: 'SCORED',
      score: { strain: 10.1, average_heart_rate: 150, max_heart_rate: 178, kilojoule: 2500,
        distance_meter: 8000, altitude_gain_meter: 40,
        zone_durations: { zone_zero_milli: 0, zone_one_milli: 60000, zone_two_milli: 600000,
          zone_three_milli: 1800000, zone_four_milli: 1000000, zone_five_milli: 140000 } },
    })
    saveProfile(db, { user_id: 1, email: 'x@y.z', first_name: 'Test', last_name: 'A' })
    expect(db.prepare('SELECT hrv_rmssd_milli AS h FROM recoveries').get()).toEqual({ h: 112.5 })
    expect(db.prepare('SELECT rem_ms FROM sleeps').get()).toEqual({ rem_ms: 7000000 })
    expect(db.prepare('SELECT sleep_needed_ms FROM sleeps').get()).toEqual({ sleep_needed_ms: 28500000 })
    expect(db.prepare('SELECT sport_name FROM workouts').get()).toEqual({ sport_name: 'running' })
    expect(getProfile(db)!.first_name).toBe('Test')
  })

  it('claims the existing legacy profile owner and rejects another account', () => {
    const db = createDb(':memory:')
    db.prepare('INSERT INTO profile (user_id,first_name) VALUES (7,?)').run('Owner')
    assertAccountOwner(db, 7)
    expect(db.prepare('SELECT user_id FROM account_owner').get()).toEqual({ user_id: 7 })
    expect(() => assertAccountOwner(db, 8)).toThrow(AccountMismatchError)
    expect(() => saveProfile(db, { user_id: 8, first_name: 'Other' })).toThrow(AccountMismatchError)
    expect(getProfile(db)?.first_name).toBe('Owner')
    db.close()
  })

  it('refuses legacy databases containing profiles for several accounts', () => {
    const db = createDb(':memory:')
    db.prepare('INSERT INTO profile (user_id) VALUES (?)').run(7)
    db.prepare('INSERT INTO profile (user_id) VALUES (?)').run(8)
    expect(() => assertAccountOwner(db, 7)).toThrow(AccountMismatchError)
    expect(db.prepare('SELECT user_id FROM account_owner').all()).toEqual([])
    db.close()
  })

  it('migrates legacy sync state without trusting partial-page dates and persists incomplete status', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whoop-migration-test-'))
    const file = path.join(dir, 'whoop.db')
    const legacy = new Database(file)
    legacy.exec('CREATE TABLE sync_state (resource TEXT PRIMARY KEY, last_synced_at TEXT NOT NULL)')
    legacy.prepare('INSERT INTO sync_state VALUES (?,?)').run('cycles', '2026-06-01T00:00:00.000Z')
    legacy.close()
    let db = createDb(file)
    try {
      expect(db.prepare('SELECT * FROM sync_state').get()).toEqual({
        resource: 'cycles', last_synced_at: '2026-06-01T00:00:00.000Z',
        committed_watermark: null, watermark_initialized: 0,
      })
      expect(getLastSyncedAt(db)).toBeNull()
      markSyncCompleted(db, '2026-06-02T00:00:00.000Z')
      markSyncStarted(db)
      db.close()
      db = createDb(file)
      expect(getLastSyncedAt(db)).toBe('2026-06-02T00:00:00.000Z')
      expect(hasIncompleteSync(db)).toBe(true)
      markSyncCompleted(db, '2026-06-03T00:00:00.000Z')
      expect(hasIncompleteSync(db)).toBe(false)
    } finally {
      db.close()
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
