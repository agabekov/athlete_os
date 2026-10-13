import type { RecentWorkout, SportStat, WorkoutTotals } from '@/lib/stats'
import { fmtMs, fmtNum, fmtDate, fmtCompact, fmtHours } from '@/lib/format'

const ZONE_COLORS = ['#23232b', '#274b63', '#2f7f8f', '#2ea86c', '#ffd60a', '#ff453a']

function ZoneBar({ zones }: { zones: number[] | null }) {
  if (!zones) return null
  const total = zones.reduce((a, b) => a + b, 0) || 1
  return (
    <div className="flex h-1.5 w-full overflow-hidden rounded-full">
      {zones.map((z, i) => (
        <div key={i} style={{ width: `${(z / total) * 100}%`, background: ZONE_COLORS[i] }} />
      ))}
    </div>
  )
}

function TotalTile({ value, label }: { value: string; label: string }) {
  return (
    <div className="surface-inset p-4">
      <p className="font-display text-3xl font-bold leading-none tabular-nums text-ink">{value}</p>
      <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.2em] text-muted">{label}</p>
    </div>
  )
}

export function WorkoutsSection({ sports, recent, totals }: {
  sports: SportStat[]; recent: RecentWorkout[]; totals: WorkoutTotals
}) {
  const topSports = sports.slice(0, 6)
  const maxStrain = Math.max(...topSports.map((s) => s.totalStrain), 1)
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
      <div className="flex flex-col gap-5">
        <div className="surface p-6">
          <p className="mb-4 font-mono text-[11px] uppercase tracking-[0.3em] text-muted">Strain by sport</p>
          {topSports.length === 0 && <p className="font-mono text-xs text-muted">no workouts yet</p>}
          {topSports.map((s) => (
            <div key={s.sport} className="mb-4">
              <div className="mb-1 flex justify-between font-mono text-[11px]">
                <span className="capitalize text-ink">{s.sport.replace(/_/g, ' ')}</span>
                <span className="text-muted">{s.count}× · {fmtMs(s.totalMs)}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-white/5">
                <div className="h-full rounded-full bg-gradient-to-r from-strain to-rec-high" style={{ width: `${(s.totalStrain / maxStrain) * 100}%` }} />
              </div>
            </div>
          ))}
        </div>
        <div className="surface p-6">
          <p className="mb-4 font-mono text-[11px] uppercase tracking-[0.3em] text-muted">All-time totals</p>
          <div className="grid grid-cols-2 gap-3">
            <TotalTile value={fmtCompact(totals.count)} label="workouts" />
            <TotalTile value={fmtHours(totals.totalMs)} label="active time" />
            <TotalTile value={fmtCompact(totals.totalKcal)} label="kcal burned" />
            <TotalTile value={fmtCompact(totals.totalKm)} label="km covered" />
            <TotalTile value={fmtCompact(totals.totalElevationM)} label="m elevation" />
            <TotalTile value={totals.perWeek > 0 ? `${fmtNum(totals.perWeek, 1)}×` : '—'} label="per week" />
          </div>
          {totals.observationStart && totals.observationEnd && <p className="mt-3 font-mono text-[10px] text-muted">
            Frequency over {fmtDate(totals.observationStart)}–{fmtDate(totals.observationEnd)}
          </p>}
        </div>
      </div>
      <div className="surface p-6 lg:col-span-2">
        <p className="mb-4 font-mono text-[11px] uppercase tracking-[0.3em] text-muted">Recent sessions</p>
        <div className="space-y-2.5">
          {recent.length === 0 && <p className="font-mono text-xs text-muted">no workouts yet</p>}
          {recent.map((w, i) => (
            <div key={i} className="surface-inset flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 transition-[background-color,box-shadow,transform] duration-150 hover:-translate-y-0.5 hover:bg-white/[0.04]">
              <span className="w-full truncate font-display text-sm font-semibold capitalize sm:w-36">
                {(w.sport ?? 'workout').replace(/_/g, ' ')}
              </span>
              <span className="font-mono text-[11px] text-muted">
                <b className="font-semibold text-strain">{fmtNum(w.strain, 1)}</b> strain
              </span>
              <span className="font-mono text-[11px] text-muted">{fmtMs(w.durationMs)}</span>
              <span className="font-mono text-[11px] text-muted">
                {w.avgHr != null ? `${Math.round(w.avgHr)}${w.maxHr != null ? `/${Math.round(w.maxHr)}` : ''} bpm` : '—'}
              </span>
              <div className="hidden min-w-0 flex-1 sm:block"><ZoneBar zones={w.zones} /></div>
              <span className="ml-auto font-mono text-[11px] text-muted sm:ml-0">{fmtDate(w.date)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
