# Architecture Map (MVP)

This is the quick orientation map for where code should live.

## Runtime Code

- `apps/web/app`
  - Next.js routes and pages
  - API entry points (`/api/chat`, `/api/recommend`, `/api/appraisal/generate`, etc.)
- `apps/web/components`
  - UI components only (`*-screen.tsx`, cards, forms)
- `apps/web/lib`
  - Domain logic, pipeline code, adapters, and shared helpers
  - Keep side-effect heavy code isolated in clear modules (AI, Supabase, QA trace)
- `apps/web/lib/types`
  - Shared contracts and response/request types

## Documentation

- `docs/master-context.md`
  - One-pager source of truth
- `docs/design`
  - Flow and architecture decisions
- `docs/prompts`
  - Official prompt layers used at runtime
- `docs/testing`
  - Reports, eval cases, and testing notes

## Scripts

- `scripts`
  - Local helpers and smoke runs (non-runtime)
  - Examples: fetch inventory snapshot, run e2e smoke report

## Data / Schema

- `packages/db`
  - SQL migrations and seed data
- `packages/shared`
  - Shared package code (if needed across apps)

## Placement Rules

- Do not add generated artifacts under `apps/web` docs folders.
- Keep generated QA/e2e files under `docs/testing` only.
- Keep API route files thin: parse/validate -> call lib module -> return response.
- Prefer adding new business logic in `apps/web/lib/*` rather than inside route files.

## Canonical Testing Artifact Paths

- `docs/testing/e2e-smoke-report.md`
- `docs/testing/e2e-smoke-report.json`
- `docs/testing/artifacts/<run-id>/<case-id>/*.json`
- `docs/testing/whats-broken.md`

(Generated artifacts and QA logs are intentionally ignored in git.)
