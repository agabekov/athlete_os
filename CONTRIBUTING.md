# Contributing

Athlete OS is a self-hosted WHOOP dashboard. Contributions should keep
that shape: one deployment reads one WHOOP account into local SQLite and renders
the dashboard without third-party analytics or hosted services.

## Local setup

```bash
npm install
cp .env.example .env.local
npm run dev
```

Add your own WHOOP developer credentials to `.env.local` before connecting a
real account.

## Checks

Run these before opening a pull request:

```bash
npm test
npm run typecheck
npm run build
npm audit
```

## Development data

Use fake data for UI work:

```bash
node scripts/seed-demo.mjs
npm run dev
```

That writes `data/whoop.db`, which is gitignored. Delete `data/whoop.db*` to
return to a clean real-sync state.

## Security and privacy expectations

- Do not log OAuth access tokens, refresh tokens, WHOOP API responses with
  personal data, or `.env*` contents.
- Keep the app single-user unless a change includes a complete user isolation
  design.
- Keep data local to the operator's machine or self-hosted server.
- Preserve the Host allow-list behavior in `middleware.ts`; it protects local
  users from DNS rebinding and lets VPS users explicitly opt in to their domain.
