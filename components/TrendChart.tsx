import { buildAreaPath, buildLinePath, type Pt } from './chart-path'

export interface SeriesPoint { date: string; value: number | null }

const W = 560
const H = 140
const PAD = 8

export function TrendChart({ label, unit, color, data, avgData, decimals = 0 }: {
  label: string; unit: string; color: string; data: SeriesPoint[]; avgData?: SeriesPoint[]; decimals?: number
}) {
  const valid = data.map((d, i) => ({ i, v: d.value })).filter((d): d is { i: number; v: number } => d.v != null)
  const avgValid = (avgData ?? []).map((d, i) => ({ i, v: d.value })).filter((d): d is { i: number; v: number } => d.v != null)
  const gid = `g-${label.replace(/\W/g, '')}`
  if (valid.length < 2) {
    return (
      <div className="surface p-5">
        <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-muted">{label}</p>
        <p className="mt-6 font-mono text-xs text-muted">not enough data yet</p>
      </div>
    )
  }
  const all = [...valid, ...avgValid]
  const min = Math.min(...all.map((d) => d.v))
  const max = Math.max(...all.map((d) => d.v))
  const span = max - min || 1
  const x = (i: number) => PAD + (i / Math.max(1, data.length - 1)) * (W - 2 * PAD)
  const y = (v: number) => PAD + (1 - (v - min) / span) * (H - 2 * PAD)
  const pts: Pt[] = valid.map((d) => ({ x: x(d.i), y: y(d.v) }))
  const avgPts: Pt[] = avgValid.map((d) => ({ x: x(d.i), y: y(d.v) }))
  const last = valid[valid.length - 1]
  const gridLines = [0.25, 0.5, 0.75].map((p) => PAD + p * (H - 2 * PAD))

  return (
    <div className="surface p-5">
      <div className="flex items-baseline justify-between">
        <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-muted">{label}</p>
        <p className="font-display text-2xl font-bold tabular-nums" style={{ color }}>
          {last.v.toFixed(decimals)}<span className="ml-1 font-mono text-xs text-muted">{unit}</span>
        </p>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-4 w-full overflow-visible" aria-label={`${label} trend chart`}>
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.32" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {gridLines.map((gy) => <line key={gy} x1={PAD} x2={W - PAD} y1={gy} y2={gy} className="chart-grid-line" />)}
        <path d={buildAreaPath(pts, H)} fill={`url(#${gid})`} />
        {avgPts.length >= 2 && (
          <path d={buildLinePath(avgPts)} fill="none" stroke={color} strokeWidth="1.25"
            strokeDasharray="5 5" opacity="0.45" />
        )}
        <path d={buildLinePath(pts)} fill="none" stroke={color} strokeWidth="2" />
        <circle cx={pts[pts.length - 1].x} cy={pts[pts.length - 1].y} r="3.5" fill={color}
          style={{ filter: `drop-shadow(0 0 6px ${color})` }} />
      </svg>
      <div className="mt-2 flex justify-between font-mono text-[10px] text-muted">
        <span>{data[0]?.date}</span>
        <span>min {min.toFixed(decimals)} · max {max.toFixed(decimals)}</span>
        <span>{data[data.length - 1]?.date}</span>
      </div>
    </div>
  )
}
