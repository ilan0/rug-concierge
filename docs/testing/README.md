# Testing Guide

## Baseline QA Suites

Use tenant-scoped execution:
- `TENANT_ID=<tenant-uuid> npm run qa:functional`
- `TENANT_ID=<tenant-uuid> npm run qa:quality`
- `TENANT_ID=<tenant-uuid> npm run qa:all`

Outputs:
- Functional: `scripts/testing/functionality/latest-functional.md`
- Quality: `scripts/testing/quality/latest-quality.md`

## Overnight Demo Verification Flow

1. Seed demo inventory:
   - `TENANT_ID=<tenant> npx tsx scripts/seed-demo-rugs.ts`
2. Enrich seeded rugs:
   - `TENANT_ID=<tenant> npx tsx scripts/re-enrich-rugs.ts --tenant-id=<tenant>`
   - if some rugs remain unenriched, rerun the same command (without `--force`) until complete
   - use `--force` only when intentionally reprocessing all rugs
3. Verify API contracts/behavior against deployment:
   - `BASE_URL=<deployment-url> TENANT_ID=<tenant> STORE_PASSCODE=<passcode> npx tsx scripts/verify-api-contracts.ts`

Report artifact:
- `tmp/release-validation/overnight-phase2-report.json`

## Deterministic Recommendation Checks

For `/api/recommend` automation:
- pass explicit `constraints.size` for size-sensitive tests
- use `user_message` for style/room intent text
