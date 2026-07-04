'use client'

import { useEffect, useState } from 'react'

export function RecoveryRing({ score }: { score: number | null }) {
  const [progress, setProgress] = useState(0)
  useEffect(() => {
    const t = setTimeout(() => setProgress(score ?? 0), 80)
    return () => clearTimeout(t)
  }, [score])

  const r = 84
  const c = 2 * Math.PI * r
  const color =
    score == null ? 'var(--color-muted)'
    : score >= 67 ? 'var(--color-rec-high)'
    : score >= 34 ? 'var(--color-rec-mid)'
    : 'var(--color-rec-low)'
  const glow =
    score == null ? 'rgba(255,255,255,0.1)'
    : score >= 67 ? 'rgba(46,232,108,0.45)'
    : score >= 34 ? 'rgba(255,214,10,0.4)'
    : 'rgba(255,69,58,0.4)'

  return (
    <div className="relative h-64 w-64 shrink-0 rounded-full bg-[radial-gradient(circle,rgba(255,255,255,0.08),transparent_62%)]">
      <svg viewBox="0 0 200 200" className="h-full w-full -rotate-90">
        <circle cx="100" cy="100" r="92" fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="1" />
        <circle cx="100" cy="100" r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="12" />
        <circle
          cx="100" cy="100" r={r} fill="none" stroke={color} strokeWidth="10" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c - (c * progress) / 100}
          style={{ transitionProperty: 'stroke-dashoffset', transitionDuration: '1.4s', transitionTimingFunction: 'cubic-bezier(0.22, 1, 0.36, 1)', filter: `drop-shadow(0 0 14px ${glow})` }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-display text-7xl font-bold leading-none tabular-nums">{score != null ? Math.round(score) : '—'}</span>
        <span className="mt-2 font-mono text-[11px] tracking-[0.35em] text-muted">RECOVERY</span>
      </div>
    </div>
  )
}
