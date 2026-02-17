# What's Broken (Fix Tomorrow)

Generated: 2026-02-13

## P0 (Blocks Testing Today)

1. Local API server was not running for smoke tests.
- Impact: all E2E smoke checks failed with `fetch failed`.
- Repro: `npm run qa:e2e-smoke`
- Fix tomorrow: start app (`npm run dev`) before running smoke tests.


## P1 (Important, Not Blocking First Run)

1. Smoke tests depend on default `http://localhost:3000` and optional tenant id.
- Impact: easy to run against wrong environment.
- Current behavior: `scripts/e2e-smoke.mjs` reads `SMOKE_BASE_URL` and `SMOKE_TENANT_ID`.
- Fix tomorrow: document standard command examples in README/working notes.

2. QA logging is file-based only and not yet queryable.
- Impact: logs exist but no dashboard/filtering.
- Current path: `docs/testing/qa-log.ndjson` (or `RECOMMENDATION_QA_LOG_PATH`).
- Fix tomorrow: add simple parser/report script for QA log summary.



