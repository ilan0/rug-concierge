# QA Status

- Updated: 2026-02-26T19:25:48Z
- Baseline Commands:
  - `TENANT_ID=... npm run qa:functional`
  - `TENANT_ID=... npm run qa:quality`
  - `TENANT_ID=... node scripts/qa.mjs quality --extended`

## Baseline Result

- Functional: passed=7, failed=0
- Quality (critical): cases=7, passed=7, failed=0

## Extended Pack

- Quality (extended): cases=59, passed=59, failed=0
- Initial extended attempt: 56/59 (3 failures), then fixed and reran to 59/59.

## Bug Classes Found/Fixed

1. Routing intent misses for recommendation phrasing.
   - Failing patterns: `I would like ...`, `I am searching for ...`.
   - Fix: expanded recommendation-intent phrase coverage in `/Users/ilannabatkhorian/Documents/rug-concierge/apps/web/lib/chat/router.ts`.
2. Constraint parsing miss for amount-before-keyword budget phrasing.
   - Failing pattern: `$1500 budget`.
   - Fix: added `amountBeforeBudgetPattern` in `/Users/ilannabatkhorian/Documents/rug-concierge/apps/web/lib/filters/extract-constraints.ts`.
3. Constraint clear phrase gaps.
   - Failing patterns: `no budget limit`, `any size`.
   - Fix: expanded reset directives in `/Users/ilannabatkhorian/Documents/rug-concierge/apps/web/lib/filters/extract-constraints.ts`.
4. QA run observability and stability gap.
   - Issue: extended runs could appear hung and were hard to debug.
   - Fix: added per-turn timeout (`QA_CHAT_TIMEOUT_MS`, default 45000) and scenario progress logs in `/Users/ilannabatkhorian/Documents/rug-concierge/scripts/testing/quality/chat-check.mjs`.

## Remaining Risks

1. Extended suite runtime depends on model latency and can still be several minutes for AI-backed turns.
2. Assertions are structural by design; subtle response quality drift can still pass without dedicated copy-level checks.
3. Tenant-leak checks remain contract-level sanity checks (status/mode/session behavior), not full cross-tenant data diffing.
