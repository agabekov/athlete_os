export function SetupScreen({ redirectUri }: { redirectUri: string }) {
  const steps = [
    ['Create a WHOOP app', 'Go to developer.whoop.com and create an app in the Developer Dashboard.'],
    ['Redirect URI', `Add exactly: ${redirectUri}`],
    ['Scopes', 'Enable read:profile, read:body_measurement, read:cycles, read:recovery, read:sleep, read:workout, offline.'],
    ['Credentials', 'Copy your Client ID and Client Secret into .env.local locally, or .env for Docker.'],
    ['Restart', 'Restart the server, then reload this page.'],
  ]
  return <main className="reveal relative z-10 mx-auto max-w-3xl p-6 sm:p-10">
    <section className="surface-lg p-6 sm:p-8">
      <p className="font-mono text-[11px] uppercase tracking-[0.4em] text-rec-high">Setup</p>
      <h1 className="mt-2 font-display text-4xl font-bold sm:text-5xl">One-time WHOOP app registration</h1>
      <p className="mt-3 text-sm text-muted">Add your WHOOP developer credentials to connect your account.</p>
      <ol className="mt-8 space-y-5">{steps.map(([title, body], i) => <li key={title} className="surface-inset flex gap-4 p-5">
        <span className="font-mono text-sm text-rec-high">{String(i + 1).padStart(2, '0')}</span>
        <div><h2 className="font-display font-semibold">{title}</h2><p className="mt-1 text-sm text-muted">{body}</p></div>
      </li>)}</ol>
      <pre className="surface-inset mt-8 overflow-x-auto p-5 font-mono text-xs text-muted">{`WHOOP_CLIENT_ID=your_client_id\nWHOOP_CLIENT_SECRET=your_client_secret\nWHOOP_REDIRECT_URI=${redirectUri}`}</pre>
    </section>
  </main>
}
