export function fmtMs(ms: number | null | undefined): string {
  if (ms == null) return '—'
  const totalMin = Math.round(ms / 60000)
  return `${Math.floor(totalMin / 60)}h ${String(totalMin % 60).padStart(2, '0')}m`
}

export function fmtNum(n: number | null | undefined, digits = 0): string {
  if (n == null) return '—'
  return n.toFixed(digits)
}

export function fmtDate(date: string): string {
  return new Date(date + 'T00:00:00Z').toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  })
}

export function fmtHours(ms: number | null | undefined): string {
  if (!ms) return '—'
  const h = Math.round(ms / 3600000)
  return h === 0 ? '—' : `${h}h`
}

export function fmtCompact(n: number | null | undefined): string {
  if (!n) return '—'
  const r = Math.round(n)
  if (r === 0) return '—'
  if (r >= 100000) return `${Math.round(r / 1000).toLocaleString('en-US')}k`
  return r.toLocaleString('en-US')
}
