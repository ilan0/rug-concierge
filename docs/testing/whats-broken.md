# What's Broken (Fix Tomorrow)

Generated: 2026-02-13

## P0 (Blocks Testing Today)

1. Local API server was not running for smoke tests.
- Impact: all E2E smoke checks failed with `fetch failed`.
- Repro: `npm run qa:e2e-smoke`
- Fix tomorrow: start app (`npm run dev`) before running smoke tests.

2. Supabase service env vars missing for inventory snapshot script.
- Impact: cannot fetch DB snapshot.
- Repro: `npm run qa:fetch-inventory -- --limit 50`
- Error: `Missing SUPABASE_URL or SUPABASE_SECRET_KEY`
- Fix tomorrow: set `SUPABASE_URL` and `SUPABASE_SECRET_KEY`, then rerun.

## P1 (Important, Not Blocking First Run)

1. Smoke tests depend on default `http://localhost:3000` and optional tenant id.
- Impact: easy to run against wrong environment.
- Current behavior: `scripts/e2e-smoke.mjs` reads `SMOKE_BASE_URL` and `SMOKE_TENANT_ID`.
- Fix tomorrow: document standard command examples in README/working notes.

2. QA logging is file-based only and not yet queryable.
- Impact: logs exist but no dashboard/filtering.
- Current path: `docs/testing/qa-log.ndjson` (or `RECOMMENDATION_QA_LOG_PATH`).
- Fix tomorrow: add simple parser/report script for QA log summary.

## P2 (Cleanups / Nice-to-Have)

1. `/api/chat` recommendation handler and `/api/recommend` are not fully unified.
- Impact: two recommendation entry paths with different maturity.
- Fix tomorrow: either route recommendation turns through `/api/recommend` from `/api/chat`, or formally keep `/api/chat` as scaffold-only.

2. Smoke tests currently verify response contract availability, not deep ranking quality.
- Impact: good for pipeline health, not recommendation accuracy.
- Fix tomorrow: add assertions using fixed fixtures after inventory snapshot is available.

