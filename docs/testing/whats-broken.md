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

1. Session persistence requires DB migration to be applied in each environment.
- Impact: if `chat_sessions` / `chat_messages` tables are missing, backend falls back to in-memory behavior for continuity.
- Follow-up: apply `packages/db/migrations/20260223_chat_sessions.sql` in all environments.

2. Smoke coverage is API-focused; no browser automation yet.
- Impact: UI regressions can pass backend smoke checks.
- Follow-up: add Playwright happy-path suite for role-based UI navigation.

3. `user_role` compatibility alias is still accepted server-side.
- Impact: request contract remains slightly broader than desired canonical API shape.
- Follow-up: remove alias after all clients/tests are fully standardized on `role`.

4. Pilot access gate currently uses a single passcode cookie (no per-user identity).
- Impact: better than open role-cookie mode, but still not full auth.
- Follow-up: replace with real identity (magic link or provider auth) before broad rollout.
