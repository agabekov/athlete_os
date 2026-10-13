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

export type MetricKey = Exclude<keyof DayRow, 'date'>
const DAY_MS = 86400000
const dateMs = (date: string) => Date.parse(date + 'T00:00:00Z')

interface DailyQueryRow {
  start_time: string; timezone_offset: string | null; strain: number | null; cycle_state: string | null
  recovery_score: number | null; hrv_rmssd_milli: number | null; resting_heart_rate: number | null; rec_state: string | null
  light_ms: number | null; sws_ms: number | null; rem_ms: number | null; performance_pct: number | null; sleep_state: string | null
}

function emptyDay(date: string): DayRow {
  return { date, recovery: null, hrv: null, rhr: null, strain: null, sleepMs: null, sleepPerf: null }
}

/** Keep missing calendar days explicit so every row represents exactly one day. */
export function calendarSeries(series: DayRow[]): DayRow[] {
  if (!series.length) return []
  const sorted = [...series].sort((a, b) => a.date.localeCompare(b.date))
  const byDate = new Map(sorted.map((day) => [day.date, day]))
  const out: DayRow[] = []
  for (let time = dateMs(sorted[0].date), end = dateMs(sorted[sorted.length - 1].date); time <= end; time += DAY_MS) {
    const date = new Date(time).toISOString().slice(0, 10)
    out.push(byDate.get(date) ?? emptyDay(date))
  }
  return out
}

export function calendarWindow(series: DayRow[], days: number): DayRow[] {
  if (!series.length) return []
  if (days === Infinity) return series
  if (!Number.isInteger(days) || days < 1) throw new RangeError('days must be a positive integer')
  const cutoff = dateMs(series[series.length - 1].date) - (days - 1) * DAY_MS
  return series.filter((day) => dateMs(day.date) >= cutoff)
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
  const rows = db.prepare(DAILY_SQL).all() as DailyQueryRow[]
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
  return calendarSeries([...byDate.values()])
}

export function rollingAvg(values: (number | null)[], window: number): (number | null)[] {
  if (!Number.isInteger(window) || window < 1) throw new RangeError('window must be a positive integer')
  return values.map((_, i) => {
    const slice = values.slice(Math.max(0, i - window + 1), i + 1).filter((v): v is number => v != null)
    if (slice.length === 0) return null
    return slice.reduce((a, b) => a + b, 0) / slice.length
  })
}

export function averages(series: DayRow[], days: number) {
  const tail = calendarWindow(series, days)
  const avg = (key: MetricKey) => {
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
  interface RecordRow { value: number; start_time: string; timezone_offset: string | null; sport_name?: string | null }
  const one = (sql: string) => (db.prepare(sql).get() as RecordRow | undefined) ?? null
  const hrv = one(`SELECT r.hrv_rmssd_milli AS value, c.start_time, c.timezone_offset FROM recoveries r
    JOIN cycles c ON c.id = r.cycle_id WHERE r.score_state='SCORED' AND r.user_calibrating=0 AND r.hrv_rmssd_milli IS NOT NULL
    ORDER BY r.hrv_rmssd_milli DESC LIMIT 1`)
  const rhr = one(`SELECT r.resting_heart_rate AS value, c.start_time, c.timezone_offset FROM recoveries r
    JOIN cycles c ON c.id = r.cycle_id WHERE r.score_state='SCORED' AND r.user_calibrating=0 AND r.resting_heart_rate IS NOT NULL
    ORDER BY r.resting_heart_rate ASC LIMIT 1`)
  const strain = one(`SELECT strain AS value, start_time, timezone_offset FROM cycles
    WHERE score_state='SCORED' AND strain IS NOT NULL ORDER BY strain DESC LIMIT 1`)
  const sleep = one(`SELECT (light_ms + COALESCE(sws_ms,0) + COALESCE(rem_ms,0)) AS value, COALESCE(end_time,start_time) AS start_time, timezone_offset FROM sleeps
    WHERE score_state='SCORED' AND nap=0 AND light_ms IS NOT NULL ORDER BY value DESC LIMIT 1`)
  const workout = one(`SELECT strain AS value, sport_name, start_time, timezone_offset FROM workouts
    WHERE score_state='SCORED' AND strain IS NOT NULL ORDER BY strain DESC LIMIT 1`)
  const toRec = (r: RecordRow | null): RecordStat | null =>
    r && r.value != null ? { value: r.value, date: localDate(r.start_time, r.timezone_offset) } : null
  return {
    bestHrv: toRec(hrv),
    lowestRhr: toRec(rhr),
    maxStrain: toRec(strain),
    longestSleep: toRec(sleep),
    hardestWorkout: workout ? { value: workout.value, date: localDate(workout.start_time, workout.timezone_offset), sport: workout.sport_name ?? null } : null,
  }
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const

export interface WeekdayStat {
  weekday: (typeof WEEKDAYS)[number]
  avgRecovery: number | null
  avgStrain: number | null
  avgSleepMs: number | null
}

export function getWeekdayPattern(db: DB, series = getDailySeries(db)): WeekdayStat[] {
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
  observationStart: string | null; observationEnd: string | null
}

export function getWorkoutTotals(db: DB, series = getDailySeries(db)): WorkoutTotals {
  interface TotalsRow {
    count: number; totalMs: number; kj: number | null; dist: number | null; alt: number | null
    first: string | null; last: string | null
  }
  const r = db.prepare(`SELECT COUNT(*) AS count,
      COALESCE(SUM((julianday(end_time) - julianday(start_time)) * 86400000), 0) AS totalMs,
      SUM(kilojoule) AS kj, SUM(distance_meter) AS dist, SUM(altitude_gain_meter) AS alt,
      MIN(date(start_time, COALESCE(timezone_offset,'+00:00'))) AS first,
      MAX(date(start_time, COALESCE(timezone_offset,'+00:00'))) AS last
    FROM workouts WHERE score_state='SCORED'`).get() as TotalsRow
  // WHOOP reports energy in kilojoules; 1 kcal = 4.184 kJ
  // Include observed rest days, including those after the last workout. A partial
  // first week is reported as a count rather than extrapolated into a full week.
  const starts = [series[0]?.date, r.first].filter((date): date is string => !!date).sort()
  const ends = [series[series.length - 1]?.date, r.last].filter((date): date is string => !!date).sort()
  const observationStart = starts[0] ?? null
  const observationEnd = ends[ends.length - 1] ?? null
  const weeks = observationStart && observationEnd ? Math.max(1, ((dateMs(observationEnd) - dateMs(observationStart)) / DAY_MS + 1) / 7) : 1
  return {
    count: r.count,
    totalMs: r.totalMs,
    totalKcal: r.kj != null ? r.kj / 4.184 : null,
    totalKm: r.dist != null ? r.dist / 1000 : null,
    totalElevationM: r.alt,
    perWeek: r.count / weeks,
    observationStart,
    observationEnd,
  }
}

export interface RecentWorkout {
  date: string; sport: string | null; strain: number | null; durationMs: number | null
  avgHr: number | null; maxHr: number | null; zones: number[] | null
}

export function getRecentWorkouts(db: DB, limit = 8): RecentWorkout[] {
  interface WorkoutRow {
    start_time: string; end_time: string | null; timezone_offset: string | null; sport_name: string | null
    strain: number | null; avg_heart_rate: number | null; max_heart_rate: number | null; zone_durations: string | null
  }
  const rows = db.prepare(`SELECT start_time, end_time, timezone_offset, sport_name, strain,
    avg_heart_rate, max_heart_rate, zone_durations FROM workouts ORDER BY start_time DESC LIMIT ?`).all(limit) as WorkoutRow[]
  return rows.map((r) => {
    return {
      date: localDate(r.start_time, r.timezone_offset),
      sport: r.sport_name,
      strain: r.strain,
      durationMs: r.end_time ? Date.parse(r.end_time) - Date.parse(r.start_time) : null,
      avgHr: r.avg_heart_rate,
      maxHr: r.max_heart_rate,
      zones: parseZones(r.zone_durations),
    }
  })
}

function parseZones(json: string | null): number[] | null {
  if (!json) return null
  try {
    const value: unknown = JSON.parse(json)
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    const row = value as Record<string, unknown>
    const values = ['zero', 'one', 'two', 'three', 'four', 'five'].map((zone) => row[`zone_${zone}_milli`] ?? 0)
    return values.every((v): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0) ? values : null
  } catch {
    // A malformed optional chart field must not prevent the dashboard loading.
    return null
  }
}

export interface RecentSleep {
  id: string; date: string; lightMs: number; swsMs: number; remMs: number; awakeMs: number; perf: number | null
}

export function getRecentSleeps(db: DB, limit = 14): RecentSleep[] {
  const rows = db.prepare(`SELECT id, start_time, end_time, timezone_offset, light_ms, sws_ms, rem_ms, awake_ms, performance_pct
    FROM sleeps WHERE nap=0 AND score_state='SCORED' AND light_ms IS NOT NULL
    ORDER BY start_time DESC LIMIT ?`).all(limit) as SleepRow[]
  return rows.reverse().map((r) => ({
    id: r.id,
    date: localDate(r.end_time ?? r.start_time, r.timezone_offset),
    lightMs: r.light_ms, swsMs: r.sws_ms ?? 0, remMs: r.rem_ms ?? 0, awakeMs: r.awake_ms ?? 0,
    perf: r.performance_pct,
  }))
}

interface SleepRow {
  id: string; start_time: string; end_time: string | null; timezone_offset: string | null
  light_ms: number; sws_ms: number | null; rem_ms: number | null; awake_ms: number | null
  performance_pct: number | null
}

export interface SleepAverages {
  avgSleepMs: number | null; avgEfficiency: number | null; avgConsistency: number | null; avgRespRate: number | null
}

export function getSleepAverages(db: DB, days = 30, anchorDate?: string): SleepAverages {
  if (!Number.isInteger(days) || days < 1) throw new RangeError('days must be a positive integer')
  interface SleepAverageRow extends SleepRow {
    efficiency_pct: number | null; consistency_pct: number | null; respiratory_rate: number | null
  }
  const rows = db.prepare(`SELECT id, start_time, end_time, timezone_offset, light_ms, sws_ms, rem_ms, awake_ms,
      performance_pct, efficiency_pct, consistency_pct, respiratory_rate
    FROM sleeps WHERE nap=0 AND score_state='SCORED' AND light_ms IS NOT NULL`).all() as SleepAverageRow[]
  const dated = rows.map((row) => ({ row, date: localDate(row.end_time ?? row.start_time, row.timezone_offset) }))
  const end = anchorDate ?? dated.map((item) => item.date).sort().at(-1)
  const cutoff = end ? dateMs(end) - (days - 1) * DAY_MS : Infinity
  const recent = end ? dated.filter((item) => dateMs(item.date) >= cutoff && item.date <= end).map((item) => item.row) : []
  const avg = (pick: (row: SleepAverageRow) => number | null) => {
    const values = recent.map(pick).filter((value): value is number => value != null)
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null
  }
  return {
    avgSleepMs: avg((row) => row.light_ms + (row.sws_ms ?? 0) + (row.rem_ms ?? 0)),
    avgEfficiency: avg((row) => row.efficiency_pct),
    avgConsistency: avg((row) => row.consistency_pct),
    avgRespRate: avg((row) => row.respiratory_rate),
  }
}

export function getHeatmap(db: DB, series = getDailySeries(db)): { date: string; recovery: number | null }[] {
  const byDate = new Map(series.map((d) => [d.date, d.recovery]))
  const out: { date: string; recovery: number | null }[] = []
  const today = series.length ? new Date(series[series.length - 1].date + 'T00:00:00Z') : new Date()
  for (let i = 364; i >= 0; i--) {
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
  return getLatestSnapshot(getDailySeries(db))
}

export function getLatestSnapshot(series: DayRow[]): TodaySnapshot | null {
  if (!series.length) return null
  const last = series[series.length - 1]
  return { ...last }
}
