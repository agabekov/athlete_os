import type {
  DayRow, TodaySnapshot, PersonalRecords, RecentSleep, SleepAverages,
  WeekdayStat, SportStat, RecentWorkout, WorkoutTotals, averages,
} from './stats'

export interface DashboardData {
  name: string | null
  lastSynced: string | null
  syncIncomplete: boolean
  series: DayRow[]
  snapshot: TodaySnapshot
  averages: ReturnType<typeof averages>
  sleeps: RecentSleep[]
  sleepAverages: SleepAverages
  weekdays: WeekdayStat[]
  sports: SportStat[]
  workouts: RecentWorkout[]
  workoutTotals: WorkoutTotals
  records: PersonalRecords
  heatmap: { date: string; recovery: number | null }[]
}

export type DashboardResponse =
  | { state: 'setup'; redirectUri: string }
  | { state: 'disconnected' }
  | { state: 'empty' }
  | { state: 'ready'; data: DashboardData }

export interface SyncStatus {
  state: 'idle' | 'running' | 'succeeded' | 'failed'
  error?: string
  errorCode?: string
}
