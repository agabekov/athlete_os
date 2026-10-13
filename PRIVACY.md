# Privacy Policy — Athlete OS

**Last updated: 13 October 2026**

## Overview

Athlete OS is a self-hosted WHOOP dashboard. Each person or organization
that deploys it operates their own instance and controls where that instance
runs, who can access it, and how its data is backed up.

The upstream project does not run a hosted service, collect telemetry, or
receive your WHOOP data.

## What data the app accesses

When an operator connects a WHOOP account, the app reads data under these WHOOP
API scopes:

- **Profile** (`read:profile`) — name and email associated with the WHOOP account
- **Body measurements** (`read:body_measurement`) — height, weight, max heart rate
- **Physiological cycles** (`read:cycles`) — daily strain and related metrics
- **Recovery** (`read:recovery`) — recovery score, resting heart rate, HRV, SpO2,
  skin temperature
- **Sleep** (`read:sleep`) — sleep stages, duration, efficiency, and related metrics
- **Workouts** (`read:workout`) — activity type, strain, heart rate, and related metrics

The app only reads WHOOP data. It does not write, modify, or delete data in the
connected WHOOP account.

## How data is used

Data is used to render the self-hosted dashboard: charts, trends, records, and
summary views. The app does not include analytics, advertising, or third-party
tracking.

## How data is stored

- WHOOP data is stored in SQLite on the machine or VPS running the app.
- OAuth access and refresh tokens are stored in the same SQLite database so the
  operator does not have to reconnect on every use.
- The default database path is `data/whoop.db` locally and `/app/data/whoop.db`
  in Docker. Operators can override it with `WHOOP_DB_PATH`.

## Data sharing and disclosure

The upstream project does not receive or share instance data. A running instance
communicates with:

1. The WHOOP API, to retrieve data for the connected account; and
2. WHOOP OAuth, for sign-in and token exchange.

If an operator hosts the app on a VPS or behind a proxy, that operator is
responsible for the security, access controls, logs, backups, and network
configuration of that deployment.

## Data retention and deletion

Data persists until the operator deletes it. To reset an instance, stop the app
and delete the SQLite files, usually `data/whoop.db`, `data/whoop.db-wal`, and
`data/whoop.db-shm`, or the Docker volume used for `/app/data`.

Operators can also revoke the app's access in their WHOOP account settings.

## Security

- Local development is localhost-only by default.
- Public hostnames must be explicitly allowed with `WHOOP_ALLOWED_HOSTS`.
- Public deployments should use HTTPS and an access-control layer if anyone
  besides the operator can reach the URL.
- The app is single-user. It does not include accounts, passwords, roles, or
  multi-tenant isolation.

## Children's privacy

The app is not directed to children. Each self-hosted operator is responsible
for using it only in ways that comply with applicable laws and WHOOP's terms.

## Changes to this policy

If this policy changes, the updated version should be published with the
repository and in any deployed instance that links to it.
