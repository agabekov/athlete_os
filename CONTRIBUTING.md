# Contributing

Athlete OS is a self-hosted WHOOP dashboard. Contributions should keep
that shape: one deployment reads one WHOOP account into local SQLite and renders
the dashboard without third-party analytics or hosted services.

## Local setup

```bash
nvm use
npm ci
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
npm run lint
npm run build
npm audit
npx playwright install chromium
npm run test:e2e
```

## Development data

Use fake data for UI work:

```bash
npm run seed:demo
WHOOP_DB_PATH=data/whoop-demo.db npm run dev
```

That writes a separate `data/whoop-demo.db`, which is gitignored. The seed refuses
occupied databases and the real default path. Never experiment on the operator
database. Run one Node 24 LTS process per database. See [AGENTS.md](AGENTS.md).

## Security and privacy expectations

- Do not log OAuth access tokens, refresh tokens, WHOOP API responses with
  personal data, or `.env*` contents.
- Keep the app single-user unless a change includes a complete user isolation
  design.
- Keep data local to the operator's machine or self-hosted server.
- Preserve the Host allow-list behavior in `middleware.ts`; it protects local
  users from DNS rebinding and lets VPS users explicitly opt in to their domain.
