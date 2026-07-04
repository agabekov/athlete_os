import { describe, it, expect } from 'vitest'
import { createDb } from '../lib/db'
import { runSync } from '../lib/sync'
import type { WhoopApi } from '../lib/whoop'

function fakeApi(collections: Record<string, any[][]>, calls: { path: string; params: any }[]): WhoopApi {
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
  }
}

const cycle = (id: number, start: string) => ({
  id, start, end: null, timezone_offset: '+00:00', score_state: 'SCORED',
  score: { strain: 10, kilojoule: 8000, average_heart_rate: 70, max_heart_rate: 150 },
})

const recovery = (cycleId: number, sleepId = `sleep-${cycleId}`) => ({
  cycle_id: cycleId, sleep_id: sleepId, score_state: 'SCORED',
  score: { user_calibrating: false, recovery_score: 80, resting_heart_rate: 50, hrv_rmssd_milli: 100 },
})

const sleep = (id: string, cycleId: number, start: string) => ({
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

const workout = (id: string, start: string) => ({
  id, start, end: null, timezone_offset: '+00:00', sport_name: 'running', score_state: 'SCORED',
  score: { strain: 10, average_heart_rate: 140, max_heart_rate: 170 },
})

describe('runSync', () => {
  it('full sync: no start param, all pages upserted, profile saved', async () => {
    const db = createDb(':memory:')
    const calls: { path: string; params: any }[] = []
    const api = fakeApi({
      '/cycle': [[cycle(1, '2026-06-01T21:00:00.000Z')], [cycle(2, '2026-05-31T21:00:00.000Z')]],
      '/recovery': [[]], '/activity/sleep': [[]], '/activity/workout': [[]],
    }, calls)
    const result = await runSync(db, api)
    expect(result.full).toBe(true)
    expect(result.counts.cycles).toBe(2)
    expect(db.prepare('SELECT COUNT(*) AS n FROM cycles').get()).toEqual({ n: 2 })
    expect((db.prepare('SELECT first_name FROM profile').get() as any).first_name).toBe('D')
    expect(calls.find((c) => c.path === '/cycle')!.params.start).toBeUndefined()
  })

  it('interrupted full sync re-runs as full, not incremental', async () => {
    const db = createDb(':memory:')
    const calls: { path: string; params: any }[] = []
    // first run: /cycle page 1 succeeds (committed), then pagination dies
    const crashingApi: WhoopApi = {
      ...fakeApi({}, calls),
      async *paginate(path: string, params: Record<string, string> = {}) {
        calls.push({ path, params })
        yield [cycle(1, '2026-06-10T21:00:00.000Z')]
        throw new Error('network died')
      },
    }
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
    const calls: { path: string; params: any }[] = []
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
    const calls: { path: string; params: any }[] = []
    await runSync(db, fakeApi({
      '/cycle': [[cycle(1, '2026-05-01T21:00:00.000Z')]],
      '/recovery': [[recovery(1)]],
      '/activity/sleep': [[]],
      '/activity/workout': [[workout('old-workout', '2026-05-01T21:00:00.000Z')]],
    }, calls))

    const crashingApi: WhoopApi = {
      ...fakeApi({}, calls),
      async *paginate(path: string, params: Record<string, string> = {}) {
        calls.push({ path, params })
        if (path === '/cycle') return yield [cycle(2, '2026-07-01T21:00:00.000Z')]
        if (path === '/recovery') throw new Error('network died before lagging resources')
        yield []
      },
    }
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
})
