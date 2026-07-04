import { redirect } from 'next/navigation'
import { DEFAULT_REDIRECT_URI, redirectUri } from '@/lib/whoop'

export const dynamic = 'force-dynamic'

const steps = [
  ['Create a WHOOP app', 'Go to developer.whoop.com → sign in with your WHOOP account → Developer Dashboard → "Create App".'],
  ['Name + contacts', 'Any name works (e.g. "Athlete OS"). Add your email as contact.'],
  ['Redirect URI', `Add exactly: ${redirectUri()}`],
  ['Scopes', 'Enable: read:profile, read:body_measurement, read:cycles, read:recovery, read:sleep, read:workout, offline'],
  ['Credentials', 'Copy the Client ID and Client Secret into your environment file (.env.local locally, .env for Docker).'],
  ['Restart', 'Restart `npm run dev`, then reload — you’ll be taken to the Connect screen.'],
] as const

export default function SetupPage() {
  if (process.env.WHOOP_CLIENT_ID && process.env.WHOOP_CLIENT_SECRET) redirect('/')
  return (
    <main className="reveal relative z-10 mx-auto max-w-3xl p-6 sm:p-10">
      <section className="surface-lg p-6 sm:p-8">
      <p className="font-mono text-[11px] uppercase tracking-[0.4em] text-rec-high">Setup</p>
      <h1 className="mt-2 font-display text-4xl font-bold text-balance sm:text-5xl">One-time WHOOP app registration</h1>
      <p className="mt-3 text-pretty text-sm text-muted">
        No WHOOP credentials found in the app environment. WHOOP requires every
        developer (even for personal use) to register a free app. Takes ~3 minutes.
      </p>
      <ol className="mt-8 space-y-5">
        {steps.map(([title, body], i) => (
          <li key={title} className="surface-inset flex gap-4 p-5">
            <span className="font-mono text-sm text-rec-high tabular-nums">{String(i + 1).padStart(2, '0')}</span>
            <div>
              <p className="font-display font-semibold">{title}</p>
              <p className="mt-1 text-pretty text-sm text-muted">{body}</p>
            </div>
          </li>
        ))}
      </ol>
      <pre className="surface-inset mt-8 overflow-x-auto p-5 font-mono text-xs text-muted">{`# .env.local (local) or .env (Docker)
WHOOP_CLIENT_ID=your_client_id
WHOOP_CLIENT_SECRET=your_client_secret
WHOOP_REDIRECT_URI=${process.env.WHOOP_REDIRECT_URI ?? DEFAULT_REDIRECT_URI}`}</pre>
      </section>
    </main>
  )
}
