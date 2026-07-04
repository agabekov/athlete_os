import type { CSSProperties, ReactNode } from 'react'
import type { TodaySnapshot } from '@/lib/stats'
import { fmtMs, fmtNum } from '@/lib/format'
import { RecoveryRing } from './RecoveryRing'

interface Avgs { strain: number | null; hrv: number | null; rhr: number | null; sleepPerf: number | null }

function Delta({ value, avg, invert = false }: { value: number | null; avg: number | null; invert?: boolean }) {
  if (value == null || avg == null) return null
  const diff = value - avg
  const good = invert ? diff < 0 : diff > 0
  const sign = diff > 0 ? '+' : ''
  return (
    <span className={`font-mono text-xs ${good ? 'text-rec-high' : 'text-rec-low'}`}>
      {sign}{diff.toFixed(1)} vs 30d
    </span>
  )
}

function Tile({ label, value, sub, accent }: { label: string; value: string; sub: ReactNode; accent?: string }) {
  const style = {
    '--metric-accent': accent ?? 'rgba(46, 232, 108, 0.16)',
  } as CSSProperties
  return (
    <div className="metric-card p-5 sm:p-6" style={style}>
      <div className="relative z-10">
        <div className="flex items-center justify-between gap-3">
          <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-muted">{label}</p>
          <span className="h-2 w-2 rounded-full" style={{ background: accent ?? 'var(--color-rec-high)' }} />
        </div>
        <p className="mt-3 font-display text-5xl font-bold leading-none tabular-nums sm:text-6xl" style={accent ? { color: accent } : undefined}>
          {value}
        </p>
        <div className="mt-3 min-h-4">{sub}</div>
      </div>
    </div>
  )
}

export function HeroStats({ today, avgs }: { today: TodaySnapshot; avgs: Avgs }) {
  return (
    <section className="surface-lg grid grid-cols-1 gap-5 p-4 sm:p-5 lg:grid-cols-[340px_1fr] lg:p-6">
      <div className="surface-inset flex min-h-80 items-center justify-center rounded-[24px] p-6">
        <RecoveryRing score={today.recovery} />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Tile label="Day Strain" value={fmtNum(today.strain, 1)} accent="var(--color-strain)"
          sub={<Delta value={today.strain} avg={avgs.strain} />} />
        <Tile label="HRV" value={today.hrv != null ? `${Math.round(today.hrv)}` : '—'}
          sub={<Delta value={today.hrv} avg={avgs.hrv} />} />
        <Tile label="Resting HR" value={today.rhr != null ? `${Math.round(today.rhr)}` : '—'}
          sub={<Delta value={today.rhr} avg={avgs.rhr} invert />} />
        <Tile label="Sleep" value={fmtMs(today.sleepMs)} accent="var(--color-violet)"
          sub={today.sleepPerf != null ? <span className="font-mono text-xs text-muted">{Math.round(today.sleepPerf)}% performance</span> : null} />
      </div>
    </section>
  )
}
