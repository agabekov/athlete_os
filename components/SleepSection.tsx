import type { RecentSleep, SleepAverages, WeekdayStat } from '@/lib/stats'
import { fmtMs, fmtNum } from '@/lib/format'

const STAGES = [
  ['swsMs', 'Deep', '#4da3ff'],
  ['remMs', 'REM', '#a78bfa'],
  ['lightMs', 'Light', '#3a3f5c'],
  ['awakeMs', 'Awake', '#26262e'],
] as const

function Night({ sleep, maxMs }: { sleep: RecentSleep; maxMs: number }) {
  const total = Math.max(sleep.lightMs + sleep.swsMs + sleep.remMs + sleep.awakeMs, 1)
  const day = new Date(sleep.date + 'T00:00:00Z').toLocaleDateString('en-US', { weekday: 'narrow', timeZone: 'UTC' })
  return (
    <div className="group flex h-full flex-1 flex-col items-center justify-end gap-2" title={`${sleep.date}: ${fmtMs(total - sleep.awakeMs)} asleep`}>
      <div className="flex w-full max-w-8 flex-col overflow-hidden rounded-[10px] shadow-[0_0_0_1px_rgba(255,255,255,0.07)] transition-[filter,scale] duration-150 group-hover:scale-[1.04] group-hover:brightness-110"
        style={{ height: `${Math.max(5, (total / maxMs) * 100)}%` }}>
        {STAGES.map(([key, , color]) => (
          <div key={key} style={{ height: `${(sleep[key] / total) * 100}%`, background: color }} />
        ))}
      </div>
      <span className="font-mono text-[10px] text-muted">{day}</span>
    </div>
  )
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between border-b border-line py-3 last:border-0">
      <span className="font-mono text-[11px] uppercase tracking-[0.25em] text-muted">{label}</span>
      <span className="font-display text-xl font-bold tabular-nums">{value}</span>
    </div>
  )
}

export function SleepSection({ sleeps, averages, weekdays }: {
  sleeps: RecentSleep[]; averages: SleepAverages; weekdays: WeekdayStat[]
}) {
  const maxMs = Math.max(...sleeps.map((s) => s.lightMs + s.swsMs + s.remMs + s.awakeMs), 1)
  const maxWeekday = Math.max(...weekdays.map((w) => w.avgSleepMs ?? 0), 1)
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
      <div className="surface flex flex-col p-6 lg:col-span-2">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-muted">Last {sleeps.length} nights</p>
          <div className="flex flex-wrap gap-2">
            {STAGES.filter(([k]) => k !== 'awakeMs').map(([key, name, color]) => (
              <span key={key} className="surface-inset flex items-center gap-1.5 rounded-full px-2.5 py-1.5 font-mono text-[10px] text-muted">
                <i className="h-2 w-2 rounded-sm" style={{ background: color }} /> {name}
              </span>
            ))}
          </div>
        </div>
        {sleeps.length === 0 ? (
          <p className="font-mono text-xs text-muted">no sleep data yet</p>
        ) : (
          <div className="flex min-h-56 flex-1 items-end gap-2">
            {sleeps.map((s) => <Night key={s.id} sleep={s} maxMs={maxMs} />)}
          </div>
        )}
      </div>
      <div className="space-y-4">
        <div className="surface p-6">
          <Meta label="Avg sleep" value={fmtMs(averages.avgSleepMs)} />
          <Meta label="Efficiency" value={averages.avgEfficiency != null ? `${fmtNum(averages.avgEfficiency)}%` : '—'} />
          <Meta label="Consistency" value={averages.avgConsistency != null ? `${fmtNum(averages.avgConsistency)}%` : '—'} />
          <Meta label="Resp. rate" value={fmtNum(averages.avgRespRate, 1)} />
        </div>
        <div className="surface p-6">
          <p className="mb-3 font-mono text-[11px] uppercase tracking-[0.3em] text-muted">Sleep by weekday</p>
          {weekdays.map((w) => (
            <div key={w.weekday} className="mb-2 flex items-center gap-3">
              <span className="w-8 font-mono text-[10px] text-muted">{w.weekday}</span>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/5">
                <div className="h-full rounded-full bg-gradient-to-r from-violet to-strain"
                  style={{ width: `${((w.avgSleepMs ?? 0) / maxWeekday) * 100}%` }} />
              </div>
              <span className="w-14 text-right font-mono text-[10px] text-muted">{fmtMs(w.avgSleepMs)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
