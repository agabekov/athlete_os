import { useId } from 'react'
import { buildAreaPath, buildLinePath, splitPointSegments } from './chart-path'

export interface SeriesPoint { date: string; value: number | null }

const W = 560
const H = 140
const PAD = 8

export function TrendChart({ label, unit, color, data, avgData, decimals = 0 }: {
  label: string; unit: string; color: string; data: SeriesPoint[]; avgData?: SeriesPoint[]; decimals?: number
}) {
  const valid = data.map((d, i) => ({ i, v: d.value })).filter((d): d is { i: number; v: number } => d.v != null)
  const avgValid = (avgData ?? []).map((d, i) => ({ i, v: d.value })).filter((d): d is { i: number; v: number } => d.v != null)
  const gid = useId()
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
  const point = (d: SeriesPoint, i: number) => d.value == null ? null : { x: x(i), y: y(d.value) }
  const segments = splitPointSegments(data.map(point))
  const avgSegments = splitPointSegments((avgData ?? []).map(point))
  const lastPoint = { x: x(valid[valid.length - 1].i), y: y(valid[valid.length - 1].v) }
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
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-4 w-full overflow-visible" role="img" aria-label={`${label}: latest ${last.v.toFixed(decimals)} ${unit}; minimum ${min.toFixed(decimals)}, maximum ${max.toFixed(decimals)}. Dashed line is a seven-day average; gaps indicate missing measurements.`}>
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.32" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {gridLines.map((gy) => <line key={gy} x1={PAD} x2={W - PAD} y1={gy} y2={gy} className="chart-grid-line" />)}
        {segments.map((pts, i) => <path key={`area-${i}`} d={buildAreaPath(pts, H)} fill={`url(#${gid})`} />)}
        {avgSegments.filter((pts) => pts.length >= 2).map((pts, i) => (
          <path key={`avg-${i}`} d={buildLinePath(pts)} fill="none" stroke={color} strokeWidth="1.25"
            strokeDasharray="5 5" opacity="0.45" />
        ))}
        {segments.map((pts, i) => pts.length === 1
          ? <circle key={`point-${i}`} cx={pts[0].x} cy={pts[0].y} r="2" fill={color} />
          : <path key={`line-${i}`} d={buildLinePath(pts)} fill="none" stroke={color} strokeWidth="2" />)}
        <circle cx={lastPoint.x} cy={lastPoint.y} r="3.5" fill={color}
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
