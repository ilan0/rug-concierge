# What's Broken (Current)

Generated: 2026-02-23

## P1 (Important, Not Blocking Core Flow)

1. Next.js workspace root warning due dual lockfiles.
- Symptom: dev/build prints lockfile root warning.
- Impact: noise/confusion only; runtime still works.
- Follow-up options:
  - set `turbopack.root` in `apps/web/next.config.mjs`, or
  - remove extra lockfile if repo policy allows.

## P2 (Cleanup / Future Hardening)

1. Session store is in-memory only.
- Impact: session data resets on server restart.
- Follow-up: move session persistence to Redis/DB before pilot scale usage.

2. Smoke coverage is API-focused; no browser automation yet.
- Impact: UI regressions can pass backend smoke checks.
- Follow-up: add Playwright happy-path suite for role-based UI navigation.
