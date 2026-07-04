import type { PersonalRecords } from '@/lib/stats'
import { fmtMs, fmtDate } from '@/lib/format'

function Card({ label, value, unit, date }: { label: string; value: string; unit?: string; date?: string }) {
  return (
    <div className="surface group p-5 transition-[box-shadow,transform] duration-150 hover:-translate-y-1 hover:shadow-[0_0_0_1px_rgba(46,232,108,0.18),0_18px_48px_rgba(0,0,0,0.36)] sm:p-6">
      <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-muted">{label}</p>
      <p className="mt-3 font-display text-3xl font-bold leading-none tabular-nums transition-colors duration-150 group-hover:text-rec-high sm:text-4xl">
        {value}{unit && <span className="ml-1 font-mono text-sm text-muted">{unit}</span>}
      </p>
      {date && <p className="mt-2 font-mono text-[10px] text-muted">{fmtDate(date)}</p>}
    </div>
  )
}

export function RecordsWall({ records }: { records: PersonalRecords }) {
  const { bestHrv, lowestRhr, maxStrain, longestSleep, hardestWorkout } = records
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
      <Card label="Best HRV" value={bestHrv ? `${Math.round(bestHrv.value)}` : '—'} unit="ms" date={bestHrv?.date} />
      <Card label="Lowest RHR" value={lowestRhr ? `${Math.round(lowestRhr.value)}` : '—'} unit="bpm" date={lowestRhr?.date} />
      <Card label="Peak strain" value={maxStrain ? maxStrain.value.toFixed(1) : '—'} date={maxStrain?.date} />
      <Card label="Longest sleep" value={longestSleep ? fmtMs(longestSleep.value) : '—'} date={longestSleep?.date} />
      <Card label="Hardest workout" value={hardestWorkout ? hardestWorkout.value.toFixed(1) : '—'}
        unit={hardestWorkout?.sport?.replace(/_/g, ' ')} date={hardestWorkout?.date} />
    </div>
  )
}
