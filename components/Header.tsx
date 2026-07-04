import { SyncButton } from './SyncButton'

export function Header({ name, lastSynced }: { name: string | null; lastSynced: string | null }) {
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
  return (
    <header className="surface flex flex-wrap items-end justify-between gap-5 p-5 sm:p-6">
      <div>
        <p className="font-mono text-[11px] uppercase tracking-[0.4em] text-rec-high">Athlete OS</p>
        <h1 className="mt-1 font-display text-4xl font-bold tracking-tight text-balance sm:text-5xl">{name ?? 'Athlete'}</h1>
        <p className="mt-2 font-mono text-xs text-muted">{today}</p>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-3">
        {lastSynced && (
          <span className="surface-inset rounded-full px-3 py-2 font-mono text-[11px] text-muted tabular-nums">
            synced {new Date(lastSynced).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
          </span>
        )}
        <SyncButton />
      </div>
    </header>
  )
}
