import type { DashboardResponse } from '../../lib/dashboard-types'

const series = Array.from({ length: 60 }, (_, i) => ({
  date: new Date(Date.UTC(2026, 7, 15 + i)).toISOString().slice(0, 10),
  recovery: i === 25 ? null : 65 + Math.round(Math.sin(i / 4) * 25),
  hrv: i === 25 ? null : 85 + Math.round(Math.sin(i / 6) * 20),
  rhr: 52 + Math.round(Math.sin(i / 5) * 4), strain: 10 + Math.sin(i / 3) * 4,
  sleepMs: 27_000_000 + Math.sin(i / 5) * 3_600_000, sleepPerf: 90,
}))

export const readyDashboard: DashboardResponse = { state: 'ready', data: {
  name: 'Demo Athlete', lastSynced: '2026-10-13T10:00:00.000Z', syncIncomplete: false,
  series, snapshot: series[series.length - 1],
  averages: { recovery: 65, hrv: 85, rhr: 52, strain: 10, sleepMs: 27_000_000, sleepPerf: 90 },
  sleeps: series.slice(-14).map(d => ({ id: d.date, date: d.date, lightMs: 14_000_000, swsMs: 6_000_000, remMs: 7_000_000, awakeMs: 1_000_000, perf: 90 })),
  sleepAverages: { avgSleepMs: 27_000_000, avgEfficiency: 95, avgConsistency: 80, avgRespRate: 15 },
  weekdays: (['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const).map(weekday => ({ weekday, avgRecovery: 65, avgStrain: 10, avgSleepMs: 27_000_000 })),
  sports: [{ sport: 'running', count: 24, totalStrain: 240, totalMs: 86_400_000 }],
  workouts: [{ date: '2026-10-13', sport: 'running', strain: 12, durationMs: 3_600_000, avgHr: 140, maxHr: 170, zones: [0, 600_000, 1_000_000, 1_000_000, 600_000, 400_000] }],
  workoutTotals: { count: 24, totalMs: 86_400_000, totalKcal: 12_000, totalKm: 180, totalElevationM: 700, perWeek: 2.8, observationStart: series[0].date, observationEnd: series[series.length - 1].date },
  records: { bestHrv: { value: 110, date: '2026-10-01' }, lowestRhr: { value: 45, date: '2026-10-02' }, maxStrain: { value: 19, date: '2026-10-03' }, longestSleep: { value: 32_400_000, date: '2026-10-04' }, hardestWorkout: { value: 18, date: '2026-10-05', sport: 'running' } },
  heatmap: series.map(d => ({ date: d.date, recovery: d.recovery })),
} }
