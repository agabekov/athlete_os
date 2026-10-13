// Only the fields this application consumes are described here. WHOOP may add
// fields without requiring a client release; consumed fields are checked below.
// Required upstream fields follow https://api.prod.whoop.com/developer/doc/openapi.json.
// Storage types also accept sparse older records, while the network parser is strict.
export interface WhoopProfile {
  user_id: number
  email?: string | null
  first_name?: string | null
  last_name?: string | null
}

export interface WhoopBodyMeasurement {
  height_meter: number
  weight_kilogram: number
  max_heart_rate: number
}

type Scored<S> = { score_state: 'SCORED'; score: S }
  | { score_state: 'PENDING_SCORE' | 'UNSCORABLE'; score?: null }

export interface CycleScore {
  strain?: number
  kilojoule?: number
  average_heart_rate?: number
  max_heart_rate?: number
}
export interface RecoveryScore {
  user_calibrating?: boolean
  recovery_score?: number
  resting_heart_rate?: number
  hrv_rmssd_milli?: number
  spo2_percentage?: number | null
  skin_temp_celsius?: number | null
}
export interface SleepScore {
  sleep_performance_percentage?: number
  sleep_consistency_percentage?: number
  sleep_efficiency_percentage?: number
  respiratory_rate?: number
  stage_summary?: {
    total_light_sleep_time_milli?: number
    total_slow_wave_sleep_time_milli?: number
    total_rem_sleep_time_milli?: number
    total_awake_time_milli?: number
    total_in_bed_time_milli?: number
    disturbance_count?: number
  }
  sleep_needed?: {
    baseline_milli?: number
    need_from_sleep_debt_milli?: number
    need_from_recent_strain_milli?: number
    need_from_recent_nap_milli?: number
  }
}
export interface WorkoutScore extends CycleScore {
  distance_meter?: number | null
  altitude_gain_meter?: number | null
  zone_durations?: {
    zone_zero_milli?: number
    zone_one_milli?: number
    zone_two_milli?: number
    zone_three_milli?: number
    zone_four_milli?: number
    zone_five_milli?: number
  }
}
interface TimeRange {
  start: string
  end?: string | null
  timezone_offset?: string | null
}
export type WhoopCycle = TimeRange & { id: number } & Scored<CycleScore>
export type WhoopRecovery = { cycle_id: number; sleep_id?: string | null } & Scored<RecoveryScore>
export type WhoopSleep = TimeRange & { id: string; cycle_id?: number | null; nap?: boolean } & Scored<SleepScore>
export type WhoopWorkout = TimeRange & { id: string; sport_name?: string | null } & Scored<WorkoutScore>
export interface WhoopCollectionMap {
  '/cycle': WhoopCycle
  '/recovery': WhoopRecovery
  '/activity/sleep': WhoopSleep
  '/activity/workout': WhoopWorkout
}
export type CollectionPath = keyof WhoopCollectionMap
export type WhoopRecord = WhoopCollectionMap[CollectionPath]
export interface WhoopPage<T> { records: T[]; next_token?: string | null }
export interface WhoopResponseMap {
  '/user/profile/basic': WhoopProfile
  '/user/measurement/body': WhoopBodyMeasurement
  '/cycle': WhoopPage<WhoopCycle>
  '/recovery': WhoopPage<WhoopRecovery>
  '/activity/sleep': WhoopPage<WhoopSleep>
  '/activity/workout': WhoopPage<WhoopWorkout>
}

export class WhoopValidationError extends Error {
  constructor() { super('WHOOP returned an invalid response.'); this.name = 'WhoopValidationError' }
}
function invalid(): never { throw new WhoopValidationError() }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid()
  return value as Record<string, unknown>
}
function number(value: unknown): void {
  if (typeof value !== 'number' || !Number.isFinite(value)) invalid()
}
function id(value: unknown): void {
  number(value)
  if (!Number.isSafeInteger(value) || (value as number) <= 0) invalid()
}
function string(value: unknown): void {
  if (typeof value !== 'string' || value.length === 0) invalid()
}
function optional(value: unknown, validate: (value: unknown) => void, nullable = false): void {
  if (value === undefined || (nullable && value === null)) return
  validate(value)
}
function boolean(value: unknown): void { if (typeof value !== 'boolean') invalid() }
function date(value: unknown): void {
  string(value)
  const text = value as string
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(text) || !Number.isFinite(Date.parse(text))) invalid()
  const [year, month, day] = text.slice(0, 10).split('-').map(Number)
  if (new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10) !== text.slice(0, 10)) invalid()
}
function requiredNumbers(obj: Record<string, unknown>, keys: string[]): void {
  for (const key of keys) number(obj[key])
}
function numbers(obj: Record<string, unknown>, keys: string[], nullable: string[] = []): void {
  for (const key of keys) optional(obj[key], number, nullable.includes(key))
}
function timeRange(row: Record<string, unknown>): void {
  date(row.start)
  optional(row.end, date, true)
  { const v = row.timezone_offset
    if (typeof v !== 'string' || !/^[+-](?:0\d|1\d|2[0-3]):[0-5]\d$/.test(v)) invalid()
  }
}
function score(row: Record<string, unknown>): Record<string, unknown> | null {
  if (row.score_state === 'SCORED') return object(row.score)
  if (row.score_state !== 'PENDING_SCORE' && row.score_state !== 'UNSCORABLE') invalid()
  if (row.score !== undefined && row.score !== null) invalid()
  return null
}
const cycleFields = ['strain', 'kilojoule', 'average_heart_rate', 'max_heart_rate']
function validateRecord(path: CollectionPath, value: unknown): void {
  const row = object(value)
  if (path === '/recovery') {
    id(row.cycle_id)
    string(row.sleep_id)
  } else {
    if (path === '/cycle') id(row.id)
    else string(row.id)
    timeRange(row)
    if (path !== '/cycle') date(row.end)
    if (path === '/activity/sleep') {
      id(row.cycle_id)
      boolean(row.nap)
    }
    if (path === '/activity/workout') string(row.sport_name)
  }
  const s = score(row)
  if (!s) return
  if (path === '/cycle') requiredNumbers(s, cycleFields)
  if (path === '/recovery') {
    boolean(s.user_calibrating)
    requiredNumbers(s, ['recovery_score', 'resting_heart_rate', 'hrv_rmssd_milli'])
    numbers(s, ['recovery_score', 'resting_heart_rate', 'hrv_rmssd_milli', 'spo2_percentage', 'skin_temp_celsius'], ['spo2_percentage', 'skin_temp_celsius'])
  }
  if (path === '/activity/workout') {
    requiredNumbers(s, cycleFields)
    numbers(s, ['distance_meter', 'altitude_gain_meter'], ['distance_meter', 'altitude_gain_meter'])
    requiredNumbers(object(s.zone_durations), ['zone_zero_milli', 'zone_one_milli', 'zone_two_milli', 'zone_three_milli', 'zone_four_milli', 'zone_five_milli'])
  }
  if (path === '/activity/sleep') {
    numbers(s, ['sleep_performance_percentage', 'sleep_consistency_percentage', 'sleep_efficiency_percentage', 'respiratory_rate'])
    requiredNumbers(object(s.stage_summary), ['total_light_sleep_time_milli', 'total_slow_wave_sleep_time_milli', 'total_rem_sleep_time_milli', 'total_awake_time_milli', 'total_in_bed_time_milli', 'disturbance_count'])
    requiredNumbers(object(s.sleep_needed), ['baseline_milli', 'need_from_sleep_debt_milli', 'need_from_recent_strain_milli', 'need_from_recent_nap_milli'])
  }
}

export function parseWhoopResponse<P extends keyof WhoopResponseMap>(path: P, value: unknown): WhoopResponseMap[P] {
  const row = object(value)
  if (path === '/user/profile/basic') {
    id(row.user_id)
    for (const key of ['email', 'first_name', 'last_name']) if (typeof row[key] !== 'string') invalid()
  } else if (path === '/user/measurement/body') {
    for (const key of ['height_meter', 'weight_kilogram', 'max_heart_rate']) number(row[key])
  } else {
    if (!Array.isArray(row.records)) invalid()
    for (const record of row.records) validateRecord(path, record)
    optional(row.next_token, string, true)
  }
  // All fields consumed by the declared contract have now been checked.
  return value as WhoopResponseMap[P]
}
