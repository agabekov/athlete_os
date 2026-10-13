import { describe, it, expect } from 'vitest'
import { createDb, upsertCycle, upsertRecovery, upsertSleep, upsertWorkout } from '../lib/db'
import { localDate, getDailySeries, rollingAvg, averages, calendarWindow, getLatestSnapshot, getHeatmap, getRecords, getWeekdayPattern, getWorkoutTotals, getSleepAverages, getRecentSleeps, getRecentWorkouts } from '../lib/stats'
import { fmtMs, fmtHours, fmtCompact } from '../lib/format'
import { splitPointSegments } from '../components/chart-path'

function seed(db: ReturnType<typeof createDb>) {
  // Two days: Jun 10 and Jun 11 local (+05:00)
  upsertCycle(db, { id: 1, start: '2026-06-09T19:00:00.000Z', end: '2026-06-10T19:00:00.000Z', timezone_offset: '+05:00', score_state: 'SCORED', score: { strain: 12.5, kilojoule: 9000, average_heart_rate: 70, max_heart_rate: 160 } })
  upsertCycle(db, { id: 2, start: '2026-06-10T19:00:00.000Z', end: null, timezone_offset: '+05:00', score_state: 'SCORED', score: { strain: 8.1, kilojoule: 7000, average_heart_rate: 68, max_heart_rate: 150 } })
  upsertRecovery(db, { cycle_id: 1, sleep_id: 's1', score_state: 'SCORED', score: { user_calibrating: false, recovery_score: 60, resting_heart_rate: 50, hrv_rmssd_milli: 90, spo2_percentage: 97, skin_temp_celsius: 33 } })
  upsertRecovery(db, { cycle_id: 2, sleep_id: 's2', score_state: 'SCORED', score: { user_calibrating: false, recovery_score: 87, resting_heart_rate: 48, hrv_rmssd_milli: 112, spo2_percentage: 97, skin_temp_celsius: 33 } })
  upsertSleep(db, { id: 's1', start: '2026-06-09T18:00:00.000Z', end: '2026-06-10T02:00:00.000Z', timezone_offset: '+05:00', nap: false, score_state: 'SCORED', score: { stage_summary: { total_in_bed_time_milli: 28800000, total_awake_time_milli: 2800000, total_light_sleep_time_milli: 14000000, total_slow_wave_sleep_time_milli: 6000000, total_rem_sleep_time_milli: 6000000, disturbance_count: 5 }, sleep_needed: { baseline_milli: 27000000, need_from_sleep_debt_milli: 0, need_from_recent_strain_milli: 0, need_from_recent_nap_milli: 0 }, respiratory_rate: 15, sleep_performance_percentage: 85, sleep_consistency_percentage: 70, sleep_efficiency_percentage: 90 } })
  upsertSleep(db, { id: 's2', start: '2026-06-10T18:00:00.000Z', end: '2026-06-11T02:00:00.000Z', timezone_offset: '+05:00', nap: false, score_state: 'SCORED', score: { stage_summary: { total_in_bed_time_milli: 28800000, total_awake_time_milli: 1800000, total_light_sleep_time_milli: 13000000, total_slow_wave_sleep_time_milli: 7000000, total_rem_sleep_time_milli: 7000000, disturbance_count: 2 }, sleep_needed: { baseline_milli: 27000000, need_from_sleep_debt_milli: 0, need_from_recent_strain_milli: 0, need_from_recent_nap_milli: 0 }, respiratory_rate: 14.5, sleep_performance_percentage: 92, sleep_consistency_percentage: 80, sleep_efficiency_percentage: 94 } })
  upsertWorkout(db, { id: 'w1', start: '2026-06-10T10:00:00.000Z', end: '2026-06-10T11:00:00.000Z', timezone_offset: '+05:00', sport_name: 'running', score_state: 'SCORED', score: { strain: 10.1, average_heart_rate: 150, max_heart_rate: 178, kilojoule: 2500, distance_meter: 8000, altitude_gain_meter: 40, zone_durations: { zone_zero_milli: 0, zone_one_milli: 60000, zone_two_milli: 600000, zone_three_milli: 1800000, zone_four_milli: 1000000, zone_five_milli: 140000 } } })
}

describe('stats', () => {
  it('localDate applies timezone offset', () => {
    expect(localDate('2026-06-10T21:30:00.000Z', '+05:00')).toBe('2026-06-11')
    expect(localDate('2026-06-10T03:00:00.000Z', '-05:00')).toBe('2026-06-09')
    expect(localDate('2026-06-10T03:00:00.000Z', null)).toBe('2026-06-10')
  })

  it('getDailySeries joins cycle+recovery+sleep per local day, ascending', () => {
    const db = createDb(':memory:')
    seed(db)
    const series = getDailySeries(db)
    expect(series.map((d) => d.date)).toEqual(['2026-06-10', '2026-06-11'])
    expect(series[1]).toMatchObject({ recovery: 87, hrv: 112, rhr: 48, strain: 8.1, sleepPerf: 92 })
    expect(series[1].sleepMs).toBe(13000000 + 7000000 + 7000000) // light + sws + rem
  })

  it('a later unscored cycle on the same local date does not wipe a scored day', () => {
    const db = createDb(':memory:')
    seed(db)
    // second cycle starting later but bucketing to the same local date (2026-06-11), unscored
    upsertCycle(db, { id: 3, start: '2026-06-11T05:00:00.000Z', end: null, timezone_offset: '+05:00', score_state: 'PENDING_SCORE', score: undefined })
    const series = getDailySeries(db)
    const day = series.find((d) => d.date === '2026-06-11')!
    expect(day).toMatchObject({ recovery: 87, hrv: 112, rhr: 48, strain: 8.1 })
  })

  it('rollingAvg averages over trailing window, skipping nulls', () => {
    expect(rollingAvg([10, 20, null, 30], 2)).toEqual([10, 15, 20, 30])
  })

  it('calendar gaps stay unknown and do not widen 30-day or 7-day windows', () => {
    const db = createDb(':memory:')
    seed(db)
    db.prepare('UPDATE cycles SET start_time=? WHERE id=2').run('2026-07-19T19:00:00.000Z')
    const series = getDailySeries(db)
    expect(series).toHaveLength(41)
    expect(series[1]).toMatchObject({ date: '2026-06-11', recovery: null, sleepMs: null })
    expect(calendarWindow(series, 30)).toHaveLength(30)
    expect(calendarWindow(series, 30)[0].date).toBe('2026-06-21')
    expect(averages(series, 30).recovery).toBe(87)
    const smoothed = rollingAvg(series.map((day) => day.recovery), 7)
    expect(smoothed[6]).toBe(60)
    expect(smoothed[7]).toBeNull()
    expect(smoothed.at(-1)).toBe(87)
    db.close()
  })

  it('latest snapshot preserves its real historical date and handles empty data', () => {
    const db = createDb(':memory:')
    expect(getLatestSnapshot(getDailySeries(db))).toBeNull()
    seed(db)
    const series = getDailySeries(db)
    expect(getLatestSnapshot(series)?.date).toBe('2026-06-11')
    const heatmap = getHeatmap(db, series)
    expect(heatmap).toHaveLength(365)
    expect(heatmap.at(-1)).toMatchObject({ date: '2026-06-11', recovery: 87 })
    db.close()
  })

  it('chart paths split at missing measurements, retaining isolated points', () => {
    const a = { x: 0, y: 10 }, b = { x: 2, y: 30 }, c = { x: 3, y: 20 }
    expect(splitPointSegments([null, a, null, b, c, null])).toEqual([[a], [b, c]])
    expect(splitPointSegments([null, null])).toEqual([])
  })

  it('sleep averages use calendar days and nights use wake-up dates', () => {
    const db = createDb(':memory:')
    seed(db)
    expect(getRecentSleeps(db).map((sleep) => sleep.date)).toEqual(['2026-06-10', '2026-06-11'])
    expect(getSleepAverages(db, 1, '2026-06-11').avgSleepMs).toBe(27000000)
    expect(getSleepAverages(db, 30, '2026-07-20')).toEqual({ avgSleepMs: null, avgEfficiency: null, avgConsistency: null, avgRespRate: null })
    db.close()
  })

  it('missing record values and malformed optional zones do not hide valid data', () => {
    const db = createDb(':memory:')
    seed(db)
    db.prepare('UPDATE recoveries SET resting_heart_rate=NULL WHERE cycle_id=1').run()
    expect(getRecords(db).lowestRhr).toMatchObject({ value: 48, date: '2026-06-11' })
    db.prepare('UPDATE workouts SET zone_durations=? WHERE id=?').run('{broken', 'w1')
    expect(getRecentWorkouts(db)[0].zones).toBeNull()
    db.close()
  })

  it('getRecords finds personal bests with dates', () => {
    const db = createDb(':memory:')
    seed(db)
    const r = getRecords(db)
    expect(r.bestHrv).toMatchObject({ value: 112, date: '2026-06-11' })
    expect(r.lowestRhr).toMatchObject({ value: 48, date: '2026-06-11' })
    expect(r.maxStrain).toMatchObject({ value: 12.5, date: '2026-06-10' })
    expect(r.longestSleep!.value).toBe(13000000 + 7000000 + 7000000)
    expect(r.hardestWorkout).toMatchObject({ value: 10.1, sport: 'running' })
  })

  it('getWeekdayPattern groups by weekday', () => {
    const db = createDb(':memory:')
    seed(db)
    const pattern = getWeekdayPattern(db)
    expect(pattern).toHaveLength(7)
    // 2026-06-11 is a Thursday
    const thu = pattern.find((p) => p.weekday === 'Thu')!
    expect(thu.avgRecovery).toBe(87)
  })

  it('fmtMs renders hours and minutes', () => {
    expect(fmtMs(27000000)).toBe('7h 30m')
    expect(fmtMs(null)).toBe('—')
  })

  it('fmtHours renders whole hours, — for null/zero', () => {
    expect(fmtHours(2120400000)).toBe('589h')
    expect(fmtHours(5400000)).toBe('2h') // rounds, not truncates
    expect(fmtHours(1000000)).toBe('—')
    expect(fmtHours(0)).toBe('—')
    expect(fmtHours(null)).toBe('—')
  })

  it('fmtCompact: k-suffix at ≥100k, locale-formatted below, — for null/zero', () => {
    expect(fmtCompact(1200000)).toBe('1,200k')
    expect(fmtCompact(241032)).toBe('241k')
    expect(fmtCompact(100000)).toBe('100k')
    expect(fmtCompact(99999.6)).toBe('100k')
    expect(fmtCompact(99999)).toBe('99,999')
    expect(fmtCompact(2114.3)).toBe('2,114')
    expect(fmtCompact(946)).toBe('946')
    expect(fmtCompact(0)).toBe('—')
    expect(fmtCompact(0.4)).toBe('—')
    expect(fmtCompact(null)).toBe('—')
  })
})

describe('getWorkoutTotals', () => {
  function seedWorkouts(db: ReturnType<typeof createDb>) {
    // Inclusive observed dates May 1 → May 29 = 29 days.
    upsertWorkout(db, { id: 'wt1', start: '2026-05-01T10:00:00.000Z', end: '2026-05-01T11:00:00.000Z', timezone_offset: '+05:00', sport_name: 'running', score_state: 'SCORED', score: { strain: 10, average_heart_rate: 150, max_heart_rate: 178, kilojoule: 2092, distance_meter: 5000, altitude_gain_meter: 50, zone_durations: { zone_zero_milli: 0, zone_one_milli: 0, zone_two_milli: 3600000, zone_three_milli: 0, zone_four_milli: 0, zone_five_milli: 0 } } })
    upsertWorkout(db, { id: 'wt2', start: '2026-05-15T10:00:00.000Z', end: '2026-05-15T10:30:00.000Z', timezone_offset: '+05:00', sport_name: 'walking', score_state: 'SCORED', score: { strain: 5, average_heart_rate: 110, max_heart_rate: 130, kilojoule: 1046 } })
    upsertWorkout(db, { id: 'wt3', start: '2026-05-29T10:00:00.000Z', end: null, timezone_offset: '+05:00', sport_name: 'swimming', score_state: 'SCORED', score: { strain: 7, average_heart_rate: 120, max_heart_rate: 150 } })
    // unscored — must be excluded from every aggregate
    upsertWorkout(db, { id: 'wt4', start: '2026-05-20T10:00:00.000Z', end: '2026-05-20T11:00:00.000Z', timezone_offset: '+05:00', sport_name: 'cycling', score_state: 'PENDING_SCORE', score: undefined })
  }

  it('aggregates scored workouts: count, duration, kJ→kcal, km, elevation, per-week', () => {
    const db = createDb(':memory:')
    seedWorkouts(db)
    const t = getWorkoutTotals(db)
    expect(t.count).toBe(3)
    expect(t.totalMs).toBeCloseTo(5400000, -3) // 60m + 30m + 0 (null end_time)
    expect(t.totalKcal).toBeCloseTo(750, 0)    // (2092 + 1046) kJ / 4.184
    expect(t.totalKm).toBeCloseTo(5, 3)        // only wt1 has distance
    expect(t.totalElevationM).toBe(50)
    expect(t.perWeek).toBeCloseTo(3 * 7 / 29, 3)
    expect(t.observationStart).toBe('2026-05-01')
    expect(t.observationEnd).toBe('2026-05-29')
  })

  it('returns zeros/nulls on an empty db', () => {
    const db = createDb(':memory:')
    expect(getWorkoutTotals(db)).toEqual({
      count: 0, totalMs: 0, totalKcal: null, totalKm: null, totalElevationM: null, perWeek: 0,
      observationStart: null, observationEnd: null,
    })
  })

  it('perWeek guard: span under a week returns raw count', () => {
    const db = createDb(':memory:')
    upsertWorkout(db, { id: 'wt5', start: '2026-05-01T10:00:00.000Z', end: '2026-05-01T11:00:00.000Z', timezone_offset: '+05:00', sport_name: 'running', score_state: 'SCORED', score: { strain: 10, average_heart_rate: 150, max_heart_rate: 178, kilojoule: 1000 } })
    expect(getWorkoutTotals(db).perWeek).toBe(1)
  })

  it('workout frequency includes observed rest days after the final workout', () => {
    const db = createDb(':memory:')
    seedWorkouts(db)
    upsertCycle(db, { id: 9, start: '2026-06-09T19:00:00.000Z', end: null, timezone_offset: '+05:00', score_state: 'PENDING_SCORE' })
    const totals = getWorkoutTotals(db, getDailySeries(db))
    expect(totals.observationStart).toBe('2026-05-01')
    expect(totals.observationEnd).toBe('2026-06-10')
    expect(totals.perWeek).toBeCloseTo(3 * 7 / 41, 3)
    db.close()
  })
})
