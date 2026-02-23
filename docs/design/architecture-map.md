# Architecture Map (MVP)

Quick placement map for where code and docs belong.

## Runtime Code

- `apps/web/app`
  - Next.js pages and API route entry points.
  - Key routes:
    - UI: `/`, `/concierge`, `/trade`, `/inventory`, `/appraisal`
    - API: `/api/chat`, `/api/recommend`, `/api/appraisal/generate`, `/api/debug/trace`, `/api/ui-role`

- `apps/web/components`
  - UI components only.
  - Shared workspace shell/navigation lives under `apps/web/components/shell`.

- `apps/web/lib`
  - Business/domain logic modules.
  - Keep route files thin: parse/validate -> call lib module -> return response.
  - Key domains:
    - `lib/chat/*` orchestration + state
    - `lib/recommend/*` shared recommendation pipeline
    - `lib/ai/*` model adapters
    - `lib/filters/*` deterministic filtering helpers
    - `lib/supabase/*` data access
    - `lib/auth/*` role/capability policy
    - `lib/qa/*` trace and QA logging

- `apps/web/lib/types`
  - Shared response/request contracts.

## Documentation

- `docs/master-context.md`
  - One-page source of truth.
- `docs/design/*`
  - Architecture, routing, and behavior docs.
- `docs/prompts/*`
  - Official prompt documents used by runtime prompt builder.
- `docs/testing/*`
  - Smoke reports, eval cases, artifacts, and QA logs.
- `docs/README.md`
  - Docs index.

## Scripts

- `scripts/*`
  - Local non-runtime helpers (inventory snapshot, smoke run).

## Data / Schema

- `packages/db`
  - SQL migrations and seed scaffolding.
- `packages/shared`
  - Shared package code when needed across apps.

## Placement Rules

- Keep generated testing artifacts under `docs/testing` only.
- Do not create app-local docs artifact folders for runtime logs.
- Keep auth policy centralized in `apps/web/lib/auth/*`.
- Keep session/routing rules centralized in `apps/web/lib/chat/*`.
- Reuse the shared recommendation pipeline for any recommendation execution path.
