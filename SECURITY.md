# Security Policy

Athlete OS stores sensitive health data and OAuth tokens in SQLite. Treat
security reports seriously even though the app is designed for self-hosting.

## Supported versions

The `main` branch is the supported development line.

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub Security Advisories if
the repository has them enabled. If not, contact the repository owner directly
instead of opening a public issue with exploit details.

## Deployment security notes

- Use HTTPS for any VPS or public-domain deployment.
- Set `WHOOP_ALLOWED_HOSTS` to the exact hostname that should serve the app.
- Do not expose the app publicly without an access-control layer if other people
  can reach the URL. The app is intentionally single-user and does not include
  accounts, passwords, or role-based access control.
- Back up and protect `data/whoop.db`; it contains WHOOP history and OAuth
  tokens.
