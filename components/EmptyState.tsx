import { SyncButton } from './SyncButton'

export function EmptyState() {
  return (
    <main className="reveal relative z-10 flex min-h-screen items-center justify-center p-6 text-center sm:p-10">
      <section className="surface-lg flex max-w-xl flex-col items-center gap-6 p-8 sm:p-10">
        <p className="font-mono text-[11px] uppercase tracking-[0.4em] text-rec-high">Connected</p>
        <h1 className="font-display text-4xl font-bold text-balance sm:text-5xl">Let&apos;s pull your history.</h1>
        <p className="max-w-md text-pretty text-sm text-muted">
          First sync fetches everything WHOOP has on you, 25 records at a time.
          Depending on account age this can take a few minutes. Leave the tab open.
        </p>
        <SyncButton label="Run first sync" />
      </section>
    </main>
  )
}
