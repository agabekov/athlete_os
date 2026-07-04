'use client'

import { useState } from 'react'
import { rollingAvg, type DayRow } from '@/lib/stats'
import { TrendChart } from './TrendChart'

const RANGES = [
  ['30D', 30],
  ['90D', 90],
  ['1Y', 365],
  ['ALL', Infinity],
] as const

export function ChartsPanel({ series }: { series: DayRow[] }) {
  const [range, setRange] = useState<(typeof RANGES)[number][0]>('90D')
  const days = RANGES.find(([k]) => k === range)![1]
  const from = days === Infinity ? 0 : Math.max(0, series.length - days)
  const pick = (key: keyof DayRow) => series.slice(from).map((d) => ({ date: d.date, value: d[key] as number | null }))
  // 7-day rolling average computed over the FULL series before slicing, so the
  // first visible days still have proper trailing windows
  const pickAvg = (key: keyof DayRow, scale = 1) => {
    const avg = rollingAvg(series.map((d) => d[key] as number | null), 7)
    return series.map((d, i) => ({ date: d.date, value: avg[i] != null ? avg[i]! * scale : null })).slice(from)
  }
  const sleepHours = series.slice(from).map((d) => ({ date: d.date, value: d.sleepMs != null ? d.sleepMs / 3600000 : null }))

  return (
    <div>
      <div className="surface-inset mb-5 inline-flex flex-wrap gap-1 rounded-full p-1">
        {RANGES.map(([key]) => (
          <button
            key={key}
            onClick={() => setRange(key)}
            className={`pressable rounded-full px-4 py-2 font-mono text-[11px] tracking-[0.2em] transition-[scale,color,background-color,box-shadow] ${
              range === key
                ? 'bg-rec-high text-black shadow-[0_0_0_1px_rgba(46,232,108,0.2),0_8px_24px_rgba(46,232,108,0.18)]'
                : 'text-muted hover:bg-white/5 hover:text-ink'
            }`}
          >
            {key}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <TrendChart label="HRV" unit="ms" color="#2ee86c" data={pick('hrv')} avgData={pickAvg('hrv')} />
        <TrendChart label="Resting HR" unit="bpm" color="#ff7a6e" data={pick('rhr')} avgData={pickAvg('rhr')} />
        <TrendChart label="Recovery" unit="%" color="#5ce1e6" data={pick('recovery')} avgData={pickAvg('recovery')} />
        <TrendChart label="Day Strain" unit="" color="#4da3ff" data={pick('strain')} avgData={pickAvg('strain')} decimals={1} />
        <TrendChart label="Sleep" unit="h" color="#a78bfa" data={sleepHours} avgData={pickAvg('sleepMs', 1 / 3600000)} decimals={1} />
      </div>
    </div>
  )
}
