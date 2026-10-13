import { SyncButton } from './SyncButton'

export function Header({ name, lastSynced, snapshotDate, syncIncomplete = false }: {
  name: string | null; lastSynced: string | null; snapshotDate: string; syncIncomplete?: boolean
}) {
  const latestDate = new Date(snapshotDate + 'T00:00:00Z').toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  })
  const now = new Date()
  const localToday = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const stale = snapshotDate < localToday
  return (
    <header className="surface flex flex-wrap items-end justify-between gap-5 p-5 sm:p-6">
      <div>
        <p className="font-mono text-[11px] uppercase tracking-[0.4em] text-rec-high">Athlete OS</p>
        <h1 className="mt-1 font-display text-4xl font-bold tracking-tight text-balance sm:text-5xl">{name ?? 'Athlete'}</h1>
        <p className="mt-2 font-mono text-xs text-muted">Data for {latestDate}{stale ? ' · historical snapshot' : ''}</p>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-3">
        {lastSynced && (
          <span className="surface-inset rounded-full px-3 py-2 font-mono text-[11px] text-muted tabular-nums">
            synced {new Date(lastSynced).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
          </span>
        )}
        {syncIncomplete && <span className="font-mono text-xs text-rec-mid" role="status">Sync incomplete</span>}
        <SyncButton />
      </div>
    </header>
  )
}
