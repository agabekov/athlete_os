import type { DB } from './db'

export function parseOffsetMs(offset: string | null): number {
  if (!offset) return 0
  const m = /^([+-])(\d{2}):(\d{2})/.exec(offset)
  if (!m) return 0
  const ms = (Number(m[2]) * 60 + Number(m[3])) * 60000
  return m[1] === '-' ? -ms : ms
}

export function localDate(iso: string, offset: string | null): string {
  return new Date(Date.parse(iso) + parseOffsetMs(offset)).toISOString().slice(0, 10)
}

export interface DayRow {
  date: string
  recovery: number | null
  hrv: number | null
  rhr: number | null
  strain: number | null
  sleepMs: number | null
  sleepPerf: number | null
}

const DAILY_SQL = `
SELECT c.start_time, c.timezone_offset, c.strain, c.score_state AS cycle_state,
       r.recovery_score, r.hrv_rmssd_milli, r.resting_heart_rate, r.score_state AS rec_state,
       s.light_ms, s.sws_ms, s.rem_ms, s.performance_pct, s.score_state AS sleep_state
FROM cycles c
LEFT JOIN recoveries r ON r.cycle_id = c.id
LEFT JOIN sleeps s ON s.id = r.sleep_id
ORDER BY c.start_time ASC
`

export function getDailySeries(db: DB): DayRow[] {
  const rows = db.prepare(DAILY_SQL).all() as any[]
  const byDate = new Map<string, DayRow>()
  for (const r of rows) {
    const date = localDate(r.start_time, r.timezone_offset)
    const scored = r.rec_state === 'SCORED'
    const sleepScored = r.sleep_state === 'SCORED'
    const sleepMs = sleepScored && r.light_ms != null ? r.light_ms + (r.sws_ms ?? 0) + (r.rem_ms ?? 0) : null
    const next: DayRow = {
      date,
      recovery: scored ? r.recovery_score : null,
      hrv: scored ? r.hrv_rmssd_milli : null,
      rhr: scored ? r.resting_heart_rate : null,
      strain: r.cycle_state === 'SCORED' ? r.strain : null,
      sleepMs,
      sleepPerf: sleepScored ? r.performance_pct : null,
    }
    // Two cycles can bucket to the same local date (timezone shifts, split days).
    // Merge instead of replace so an unscored later cycle can't wipe a scored day.
    const prev = byDate.get(date)
    if (prev) {
      for (const k of ['recovery', 'hrv', 'rhr', 'strain', 'sleepMs', 'sleepPerf'] as const) {
        if (next[k] == null) next[k] = prev[k]
      }
    }
    byDate.set(date, next)
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
}

export function rollingAvg(values: (number | null)[], window: number): (number | null)[] {
  return values.map((_, i) => {
    const slice = values.slice(Math.max(0, i - window + 1), i + 1).filter((v): v is number => v != null)
    if (slice.length === 0) return null
    return slice.reduce((a, b) => a + b, 0) / slice.length
  })
}

export function averages(series: DayRow[], days: number) {
  const tail = series.slice(-days)
  const avg = (key: keyof DayRow) => {
    const vals = tail.map((d) => d[key]).filter((v): v is number => typeof v === 'number')
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null
  }
  return { recovery: avg('recovery'), hrv: avg('hrv'), rhr: avg('rhr'), strain: avg('strain'), sleepMs: avg('sleepMs'), sleepPerf: avg('sleepPerf') }
}

export interface RecordStat { value: number; date: string }

export interface PersonalRecords {
  bestHrv: RecordStat | null
  lowestRhr: RecordStat | null
  maxStrain: RecordStat | null
  longestSleep: RecordStat | null
  hardestWorkout: (RecordStat & { sport: string | null }) | null
}

export function getRecords(db: DB): PersonalRecords {
  const one = (sql: string) => (db.prepare(sql).get() as any) ?? null
  const hrv = one(`SELECT r.hrv_rmssd_milli AS value, c.start_time, c.timezone_offset FROM recoveries r
    JOIN cycles c ON c.id = r.cycle_id WHERE r.score_state='SCORED' AND r.user_calibrating=0
    ORDER BY r.hrv_rmssd_milli DESC LIMIT 1`)
  const rhr = one(`SELECT r.resting_heart_rate AS value, c.start_time, c.timezone_offset FROM recoveries r
    JOIN cycles c ON c.id = r.cycle_id WHERE r.score_state='SCORED' AND r.user_calibrating=0
    ORDER BY r.resting_heart_rate ASC LIMIT 1`)
  const strain = one(`SELECT strain AS value, start_time, timezone_offset FROM cycles
    WHERE score_state='SCORED' ORDER BY strain DESC LIMIT 1`)
  const sleep = one(`SELECT (light_ms + sws_ms + rem_ms) AS value, start_time, timezone_offset FROM sleeps
    WHERE score_state='SCORED' AND nap=0 AND light_ms IS NOT NULL ORDER BY value DESC LIMIT 1`)
  const workout = one(`SELECT strain AS value, sport_name, start_time, timezone_offset FROM workouts
    WHERE score_state='SCORED' ORDER BY strain DESC LIMIT 1`)
  const toRec = (r: any): RecordStat | null =>
    r && r.value != null ? { value: r.value, date: localDate(r.start_time, r.timezone_offset) } : null
  return {
    bestHrv: toRec(hrv),
    lowestRhr: toRec(rhr),
    maxStrain: toRec(strain),
    longestSleep: toRec(sleep),
    hardestWorkout: workout && workout.value != null ? { ...toRec(workout)!, sport: workout.sport_name } : null,
  }
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const

export interface WeekdayStat {
  weekday: (typeof WEEKDAYS)[number]
  avgRecovery: number | null
  avgStrain: number | null
  avgSleepMs: number | null
}

export function getWeekdayPattern(db: DB): WeekdayStat[] {
  const series = getDailySeries(db)
  return WEEKDAYS.map((weekday, idx) => {
    const days = series.filter((d) => (new Date(d.date + 'T00:00:00Z').getUTCDay() + 6) % 7 === idx)
    const avg = (key: 'recovery' | 'strain' | 'sleepMs') => {
      const vals = days.map((d) => d[key]).filter((v): v is number => v != null)
      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null
    }
    return { weekday, avgRecovery: avg('recovery'), avgStrain: avg('strain'), avgSleepMs: avg('sleepMs') }
  })
}

export interface SportStat { sport: string; count: number; totalStrain: number; totalMs: number }

export function getSportBreakdown(db: DB): SportStat[] {
  return db.prepare(`SELECT COALESCE(sport_name, 'other') AS sport, COUNT(*) AS count,
      COALESCE(SUM(strain), 0) AS totalStrain,
      COALESCE(SUM((julianday(end_time) - julianday(start_time)) * 86400000), 0) AS totalMs
    FROM workouts WHERE score_state='SCORED'
    GROUP BY sport ORDER BY totalStrain DESC`).all() as SportStat[]
}

export interface WorkoutTotals {
  count: number; totalMs: number; totalKcal: number | null
  totalKm: number | null; totalElevationM: number | null; perWeek: number
}

export function getWorkoutTotals(db: DB): WorkoutTotals {
  const r = db.prepare(`SELECT COUNT(*) AS count,
      COALESCE(SUM((julianday(end_time) - julianday(start_time)) * 86400000), 0) AS totalMs,
      SUM(kilojoule) AS kj, SUM(distance_meter) AS dist, SUM(altitude_gain_meter) AS alt,
      MIN(start_time) AS first, MAX(start_time) AS last
    FROM workouts WHERE score_state='SCORED'`).get() as any
  // WHOOP reports energy in kilojoules; 1 kcal = 4.184 kJ
  const weeks = r.first && r.last ? (Date.parse(r.last) - Date.parse(r.first)) / (7 * 86400000) : 0
  return {
    count: r.count,
    totalMs: r.totalMs,
    totalKcal: r.kj != null ? r.kj / 4.184 : null,
    totalKm: r.dist != null ? r.dist / 1000 : null,
    totalElevationM: r.alt,
    perWeek: weeks >= 1 ? r.count / weeks : r.count,
  }
}

export interface RecentWorkout {
  date: string; sport: string | null; strain: number | null; durationMs: number | null
  avgHr: number | null; maxHr: number | null; zones: number[] | null
}

export function getRecentWorkouts(db: DB, limit = 8): RecentWorkout[] {
  const rows = db.prepare(`SELECT * FROM workouts ORDER BY start_time DESC LIMIT ?`).all(limit) as any[]
  return rows.map((r) => {
    const z = r.zone_durations ? JSON.parse(r.zone_durations) : null
    return {
      date: localDate(r.start_time, r.timezone_offset),
      sport: r.sport_name,
      strain: r.strain,
      durationMs: r.end_time ? Date.parse(r.end_time) - Date.parse(r.start_time) : null,
      avgHr: r.avg_heart_rate,
      maxHr: r.max_heart_rate,
      zones: z ? [z.zone_zero_milli ?? 0, z.zone_one_milli ?? 0, z.zone_two_milli ?? 0, z.zone_three_milli ?? 0, z.zone_four_milli ?? 0, z.zone_five_milli ?? 0] : null,
    }
  })
}

export interface RecentSleep {
  id: string; date: string; lightMs: number; swsMs: number; remMs: number; awakeMs: number; perf: number | null
}

export function getRecentSleeps(db: DB, limit = 14): RecentSleep[] {
  const rows = db.prepare(`SELECT * FROM sleeps WHERE nap=0 AND score_state='SCORED' AND light_ms IS NOT NULL
    ORDER BY start_time DESC LIMIT ?`).all(limit) as any[]
  return rows.reverse().map((r) => ({
    id: r.id,
    date: localDate(r.start_time, r.timezone_offset),
    lightMs: r.light_ms, swsMs: r.sws_ms ?? 0, remMs: r.rem_ms ?? 0, awakeMs: r.awake_ms ?? 0,
    perf: r.performance_pct,
  }))
}

export interface SleepAverages {
  avgSleepMs: number | null; avgEfficiency: number | null; avgConsistency: number | null; avgRespRate: number | null
}

export function getSleepAverages(db: DB, days = 30): SleepAverages {
  const row = db.prepare(`SELECT AVG(light_ms + sws_ms + rem_ms) AS avgSleepMs, AVG(efficiency_pct) AS avgEfficiency,
      AVG(consistency_pct) AS avgConsistency, AVG(respiratory_rate) AS avgRespRate
    FROM (SELECT * FROM sleeps WHERE nap=0 AND score_state='SCORED' AND light_ms IS NOT NULL
          ORDER BY start_time DESC LIMIT ?)`).get(days) as any
  return row
}

export function getHeatmap(db: DB): { date: string; recovery: number | null }[] {
  const series = getDailySeries(db)
  const byDate = new Map(series.map((d) => [d.date, d.recovery]))
  const out: { date: string; recovery: number | null }[] = []
  const today = series.length ? new Date(series[series.length - 1].date + 'T00:00:00Z') : new Date()
  for (let i = 370; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 86400000)
    const date = d.toISOString().slice(0, 10)
    out.push({ date, recovery: byDate.get(date) ?? null })
  }
  return out
}

export interface TodaySnapshot {
  date: string; recovery: number | null; strain: number | null; hrv: number | null
  rhr: number | null; sleepPerf: number | null; sleepMs: number | null
}

export function getToday(db: DB): TodaySnapshot | null {
  const series = getDailySeries(db)
  if (!series.length) return null
  const last = series[series.length - 1]
  return { ...last }
}
