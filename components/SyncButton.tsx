'use client'

import { useSync } from '../client/SyncContext'

export function SyncButton({ label = 'Sync' }: { label?: string }) {
  const { busy, error, start } = useSync()

  return (
    <div className="flex flex-wrap items-center justify-end gap-3">
      {error && <span role="alert" className="surface-inset rounded-full px-3 py-2 font-mono text-xs text-rec-low">{error}</span>}
      <button
        type="button"
        onClick={() => void start()}
        disabled={busy}
        aria-busy={busy}
        className="pressable group inline-flex items-center justify-center gap-2 rounded-full bg-rec-high px-5 py-2 font-mono text-xs font-bold uppercase tracking-[0.2em] text-black shadow-[0_0_0_1px_rgba(46,232,108,0.2),0_10px_30px_rgba(46,232,108,0.18)] transition-[scale,box-shadow,background-color,opacity] hover:shadow-[0_0_0_1px_rgba(46,232,108,0.35),0_16px_40px_rgba(46,232,108,0.24)] disabled:cursor-wait disabled:opacity-60"
      >
        <span
          aria-hidden
          className={`h-3 w-3 rounded-full border-2 border-black/35 border-t-black transition-[opacity,filter,scale] duration-300 [transition-timing-function:cubic-bezier(0.2,0,0,1)] ${busy ? 'scale-100 animate-spin opacity-100 blur-0' : 'scale-[0.25] opacity-0 blur-[4px]'}`}
        />
        {busy ? 'Syncing…' : label}
      </button>
    </div>
  )
}
