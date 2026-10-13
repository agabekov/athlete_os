export function ConnectScreen({ error }: { error?: string }) {
  return (
    <main className="reveal relative z-10 flex min-h-screen items-center justify-center p-6 text-center sm:p-10">
      <section className="surface-lg flex max-w-2xl flex-col items-center gap-6 p-8 sm:p-10">
        <p className="font-mono text-[11px] uppercase tracking-[0.4em] text-rec-high">Athlete OS</p>
        <h1 className="font-display text-5xl font-bold leading-tight text-balance sm:text-6xl">Your WHOOP story,<br />on your machine.</h1>
        <p className="max-w-md text-pretty text-sm text-muted">
          Connect your WHOOP account to pull your full history — recovery, sleep, strain, workouts —
          into a local dashboard. Your history stays on your own computer or server.
        </p>
        {error && <p role="alert" className="surface-inset rounded-full px-3 py-2 font-mono text-xs text-rec-low">{error === 'account_mismatch'
          ? 'This database belongs to another WHOOP account. Use a separate database for this account.'
          : 'Connection failed. Check your WHOOP app settings and try again.'}</p>}
      <a
        href="/api/auth/login"
        className="pressable inline-flex items-center justify-center rounded-full bg-rec-high px-8 py-3 font-mono text-sm font-bold uppercase tracking-[0.2em] text-black shadow-[0_0_0_1px_rgba(46,232,108,0.2),0_18px_48px_rgba(46,232,108,0.22)] transition-[scale,box-shadow,background-color] hover:shadow-[0_0_0_1px_rgba(46,232,108,0.35),0_22px_60px_rgba(46,232,108,0.3)]"
      >
        Connect WHOOP
      </a>
      </section>
    </main>
  )
}
