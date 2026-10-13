# Athlete OS

Single-user self-hosted WHOOP dashboard: React/Vite frontend, Hono on Node 24 LTS,
and local SQLite. Production runs one server process per database.

## Boundaries

- `client/` owns dashboard loading and sync polling; `components/` owns presentation.
- `server/` owns HTTP routes, OAuth cookies, static assets and background sync jobs.
- `lib/whoop.ts` and `lib/whoop-types.ts` own validated external API contracts.
- `lib/db.ts` owns schema migration and persistence; `lib/sync.ts` owns checkpoints.
- `lib/stats.ts` owns calendar-based calculations. Reuse one daily series per request.

Never inspect, seed, migrate experimentally, or reset the operator's real `data/whoop.db`.
Tests use memory/temp databases. Demo data uses a separate `data/whoop-demo.db`.
Do not log secrets, tokens, raw API responses, or `.env` contents.
Preserve history on reconnect and reject a different owner; destructive reset is explicit.

## Verification

Use the Node 24 LTS version pinned in `.nvmrc` (`nvm use` or equivalent) and dependencies installed with that runtime.
Run `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`,
`npm audit`, and `npm run test:e2e` for changes spanning server/frontend contracts.
For small changes run the relevant checks. Do not add tests that merely mirror code.

Keep localhost binding, Host allow-list, same-origin mutation checks and proxy isolation.
State separately which checks were local and which require real WHOOP, Docker or VPS.
