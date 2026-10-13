import { describe, it, expect } from 'vitest'
import { createDb, getLastSyncedAt, hasIncompleteSync, AccountMismatchError } from '../lib/db'
import { runSync } from '../lib/sync'
import type { WhoopApi } from '../lib/whoop'
import type { WhoopCycle, WhoopRecovery, WhoopSleep, WhoopWorkout } from '../lib/whoop-types'

function fakeApi(collections: Record<string, unknown[][]>, calls: { path: string; params: Record<string, string> }[]): WhoopApi {
  return {
    async get(path: string) {
      if (path === '/user/profile/basic') return { user_id: 1, email: 'x@y.z', first_name: 'D', last_name: 'A' }
      if (path === '/user/measurement/body') return { height_meter: 1.8, weight_kilogram: 80, max_heart_rate: 195 }
      throw new Error(`unexpected get ${path}`)
    },
    async *paginate(path: string, params: Record<string, string> = {}) {
      calls.push({ path, params })
      for (const page of collections[path] ?? [[]]) yield page
    },
  } as unknown as WhoopApi
}

const cycle = (id: number, start: string): WhoopCycle => ({
  id, start, end: null, timezone_offset: '+00:00', score_state: 'SCORED',
  score: { strain: 10, kilojoule: 8000, average_heart_rate: 70, max_heart_rate: 150 },
})

const recovery = (cycleId: number, sleepId = `sleep-${cycleId}`): WhoopRecovery => ({
  cycle_id: cycleId, sleep_id: sleepId, score_state: 'SCORED',
  score: { user_calibrating: false, recovery_score: 80, resting_heart_rate: 50, hrv_rmssd_milli: 100 },
})

const sleep = (id: string, cycleId: number, start: string): WhoopSleep => ({
  id, cycle_id: cycleId, start, end: null, timezone_offset: '+00:00', nap: false, score_state: 'SCORED',
  score: {
    stage_summary: {
      total_light_sleep_time_milli: 14000000,
      total_slow_wave_sleep_time_milli: 6000000,
      total_rem_sleep_time_milli: 6000000,
      total_awake_time_milli: 1000000,
      total_in_bed_time_milli: 27000000,
      disturbance_count: 3,
    },
  },
})

const workout = (id: string, start: string): WhoopWorkout => ({
  id, start, end: null, timezone_offset: '+00:00', sport_name: 'running', score_state: 'SCORED',
  score: { strain: 10, average_heart_rate: 140, max_heart_rate: 170 },
})

describe('runSync', () => {
  it('full sync: no start param, all pages upserted, profile saved', async () => {
    const db = createDb(':memory:')
    const calls: { path: string; params: Record<string, string> }[] = []
    const api = fakeApi({
      '/cycle': [[cycle(1, '2026-06-01T21:00:00.000Z')], [cycle(2, '2026-05-31T21:00:00.000Z')]],
      '/recovery': [[]], '/activity/sleep': [[]], '/activity/workout': [[]],
    }, calls)
    const result = await runSync(db, api)
    expect(result.full).toBe(true)
    expect(result.counts.cycles).toBe(2)
    expect(db.prepare('SELECT COUNT(*) AS n FROM cycles').get()).toEqual({ n: 2 })
    expect(db.prepare('SELECT first_name FROM profile').get()).toEqual({ first_name: 'D' })
    expect(calls.find((c) => c.path === '/cycle')!.params.start).toBeUndefined()
  })

  it('interrupted full sync re-runs as full, not incremental', async () => {
    const db = createDb(':memory:')
    const calls: { path: string; params: Record<string, string> }[] = []
    // first run: /cycle page 1 succeeds (committed), then pagination dies
    const crashingApi = {
      ...fakeApi({}, calls),
      async *paginate(path: string, params: Record<string, string> = {}) {
        calls.push({ path, params })
        yield [cycle(1, '2026-06-10T21:00:00.000Z')]
        throw new Error('network died')
      },
    } as unknown as WhoopApi
    await expect(runSync(db, crashingApi)).rejects.toThrow('network died')
    expect(db.prepare('SELECT COUNT(*) AS n FROM cycles').get()).toEqual({ n: 1 })

    // second run must NOT send a start param for cycles — sync_state was never written
    calls.length = 0
    const api = fakeApi({ '/cycle': [[cycle(2, '2026-06-11T21:00:00.000Z')]] }, calls)
    const result = await runSync(db, api)
    expect(result.full).toBe(true)
    expect(calls.find((c) => c.path === '/cycle')!.params.start).toBeUndefined()
  })

  it('incremental sync: passes start = each resource watermark - 14d', async () => {
    const db = createDb(':memory:')
    const calls: { path: string; params: Record<string, string> }[] = []
    const api = fakeApi({
      '/cycle': [[cycle(1, '2026-06-10T21:00:00.000Z')]],
      '/recovery': [[recovery(1, 's1')]],
      '/activity/sleep': [[sleep('s1', 1, '2026-05-20T21:00:00.000Z')]],
      '/activity/workout': [[workout('w1', '2026-04-15T21:00:00.000Z')]],
    }, calls)
    await runSync(db, api)
    calls.length = 0
    await runSync(db, api)
    expect(calls.find((c) => c.path === '/cycle')!.params.start)
      .toBe(new Date(Date.parse('2026-06-10T21:00:00.000Z') - 14 * 86400000).toISOString())
    expect(calls.find((c) => c.path === '/recovery')!.params.start)
      .toBe(new Date(Date.parse('2026-06-10T21:00:00.000Z') - 14 * 86400000).toISOString())
    expect(calls.find((c) => c.path === '/activity/sleep')!.params.start)
      .toBe(new Date(Date.parse('2026-05-20T21:00:00.000Z') - 14 * 86400000).toISOString())
    expect(calls.find((c) => c.path === '/activity/workout')!.params.start)
      .toBe(new Date(Date.parse('2026-04-15T21:00:00.000Z') - 14 * 86400000).toISOString())
  })

  it('incremental sync does not skip a lagging resource after a later cycle sync', async () => {
    const db = createDb(':memory:')
    const calls: { path: string; params: Record<string, string> }[] = []
    await runSync(db, fakeApi({
      '/cycle': [[cycle(1, '2026-05-01T21:00:00.000Z')]],
      '/recovery': [[recovery(1)]],
      '/activity/sleep': [[]],
      '/activity/workout': [[workout('old-workout', '2026-05-01T21:00:00.000Z')]],
    }, calls))

    const crashingApi = {
      ...fakeApi({}, calls),
      async *paginate(path: string, params: Record<string, string> = {}) {
        calls.push({ path, params })
        if (path === '/cycle') {
          yield [cycle(2, '2026-07-01T21:00:00.000Z')]
          return
        }
        if (path === '/recovery') throw new Error('network died before lagging resources')
        yield []
      },
    } as unknown as WhoopApi
    await expect(runSync(db, crashingApi)).rejects.toThrow('network died')

    calls.length = 0
    await runSync(db, fakeApi({
      '/cycle': [[]],
      '/recovery': [[]],
      '/activity/sleep': [[]],
      '/activity/workout': [[]],
    }, calls))

    expect(calls.find((c) => c.path === '/cycle')!.params.start)
      .toBe(new Date(Date.parse('2026-07-01T21:00:00.000Z') - 14 * 86400000).toISOString())
    expect(calls.find((c) => c.path === '/activity/workout')!.params.start)
      .toBe(new Date(Date.parse('2026-05-01T21:00:00.000Z') - 14 * 86400000).toISOString())
  })

  it('retries an interrupted incremental pagination from its committed watermark', async () => {
    const db = createDb(':memory:')
    const calls: { path: string; params: Record<string, string> }[] = []
    await runSync(db, fakeApi({ '/cycle': [[cycle(1, '2026-05-01T21:00:00.000Z')]] }, calls))
    const lastCompleted = getLastSyncedAt(db)
    const crashingApi = {
      ...fakeApi({}, calls),
      async *paginate(path: string) {
        if (path === '/cycle') {
          yield [cycle(3, '2026-07-01T21:00:00.000Z')]
          throw new Error('page two failed')
        }
        yield []
      },
    } as unknown as WhoopApi
    await expect(runSync(db, crashingApi)).rejects.toThrow('page two failed')
    expect(db.prepare("SELECT committed_watermark FROM sync_state WHERE resource='cycles'").get())
      .toEqual({ committed_watermark: '2026-05-01T21:00:00.000Z' })
    expect(getLastSyncedAt(db)).toBe(lastCompleted)
    expect(hasIncompleteSync(db)).toBe(true)

    calls.length = 0
    await runSync(db, fakeApi({ '/cycle': [
      [cycle(3, '2026-07-01T21:00:00.000Z')],
      [cycle(2, '2026-05-25T21:00:00.000Z')],
    ] }, calls))
    expect(calls.find((c) => c.path === '/cycle')!.params.start).toBe('2026-04-17T21:00:00.000Z')
    expect(db.prepare('SELECT COUNT(*) AS n FROM cycles').get()).toEqual({ n: 3 })
    expect(db.prepare("SELECT committed_watermark FROM sync_state WHERE resource='cycles'").get())
      .toEqual({ committed_watermark: '2026-07-01T21:00:00.000Z' })
    expect(hasIncompleteSync(db)).toBe(false)
    db.close()
  })

  it('performs one conservative full refresh for legacy resource state', async () => {
    const db = createDb(':memory:')
    const calls: { path: string; params: Record<string, string> }[] = []
    db.prepare("INSERT INTO sync_state (resource,last_synced_at) VALUES ('cycles',?)").run('2026-06-01T00:00:00.000Z')
    const api = fakeApi({ '/cycle': [[cycle(1, '2026-06-10T21:00:00.000Z')]] }, calls)
    expect((await runSync(db, api)).full).toBe(true)
    expect(calls.find((c) => c.path === '/cycle')!.params.start).toBeUndefined()
    calls.length = 0
    expect((await runSync(db, api)).full).toBe(false)
    expect(calls.find((c) => c.path === '/cycle')!.params.start).toBe('2026-05-27T21:00:00.000Z')
    db.close()
  })

  it('does not label a partially completed first sync as successfully synced', async () => {
    const db = createDb(':memory:')
    const calls: { path: string; params: Record<string, string> }[] = []
    const api = {
      ...fakeApi({}, calls),
      async *paginate(path: string) {
        if (path === '/recovery') throw new Error('recoveries unavailable')
        yield path === '/cycle' ? [cycle(1, '2026-06-10T21:00:00.000Z')] : []
      },
    } as unknown as WhoopApi
    await expect(runSync(db, api)).rejects.toThrow('recoveries unavailable')
    expect(db.prepare("SELECT resource FROM sync_state WHERE resource='cycles'").get()).toEqual({ resource: 'cycles' })
    expect(getLastSyncedAt(db)).toBeNull()
    expect(hasIncompleteSync(db)).toBe(true)
    await runSync(db, fakeApi({}, calls))
    expect(getLastSyncedAt(db)).not.toBeNull()
    expect(hasIncompleteSync(db)).toBe(false)
    db.close()
  })

  it('rejects a changed WHOOP owner before writing profile, measurements or history', async () => {
    const db = createDb(':memory:')
    const calls: { path: string; params: Record<string, string> }[] = []
    await runSync(db, fakeApi({ '/cycle': [[cycle(1, '2026-06-10T21:00:00.000Z')]] }, calls))
    calls.length = 0
    const getCalls: string[] = []
    const changedAccount = {
      ...fakeApi({}, calls),
      async get(path: string) {
        getCalls.push(path)
        return { user_id: 2, first_name: 'Other' }
      },
    } as unknown as WhoopApi
    await expect(runSync(db, changedAccount)).rejects.toThrow(AccountMismatchError)
    expect(getCalls).toEqual(['/user/profile/basic'])
    expect(calls).toHaveLength(0)
    expect(db.prepare('SELECT user_id,first_name FROM profile').all()).toEqual([{ user_id: 1, first_name: 'D' }])
    expect(db.prepare('SELECT COUNT(*) AS n FROM cycles').get()).toEqual({ n: 1 })
    expect(db.prepare('SELECT weight_kilogram FROM body_measurement').get()).toEqual({ weight_kilogram: 80 })
    db.close()
  })

  it('shares an in-flight sync between clients and releases it after completion', async () => {
    const db = createDb(':memory:')
    const calls: { path: string; params: Record<string, string> }[] = []
    let release!: () => void
    const ready = new Promise<void>((resolve) => { release = resolve })
    let profileCalls = 0
    const base = fakeApi({}, calls)
    const waitingApi = {
      ...base,
      async get(path: string) {
        if (path === '/user/profile/basic') {
          profileCalls++
          await ready
        }
        return base.get(path as '/user/profile/basic')
      },
    } as unknown as WhoopApi
    const first = runSync(db, waitingApi)
    const second = runSync(db, fakeApi({}, []))
    expect(second).toBe(first)
    expect(profileCalls).toBe(1)
    release()
    await Promise.all([first, second])
    expect(calls).toHaveLength(4)
    const next = runSync(db, waitingApi)
    expect(next).not.toBe(first)
    await next
    expect(profileCalls).toBe(2)
    db.close()
  })

  it('releases single-flight state after a failure so the next sync can recover', async () => {
    const db = createDb(':memory:')
    const failed = runSync(db, {
      ...fakeApi({}, []),
      async get() { throw new Error('temporary error') },
    } as unknown as WhoopApi)
    await expect(failed).rejects.toThrow('temporary error')
    await expect(runSync(db, fakeApi({}, []))).resolves.toMatchObject({ full: true })
    expect(hasIncompleteSync(db)).toBe(false)
    db.close()
  })
})
