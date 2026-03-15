# QA Operations

Canonical operational testing guide.

## Core Local Gates

```bash
npm run quality:release
```

Equivalent expanded commands:

```bash
npm --workspace apps/web exec tsc --noEmit
npm --workspace apps/web run lint
npm --workspace apps/web run build
npm run test:unit
npm run check:docs
npm run check:migrations
npm run check:api-contracts
```

Notes:
- `check:api-contracts` defaults to `NON_DESTRUCTIVE=1`.
- It skips outside strict mode when `BASE_URL`, `TENANT_ID`, or `STORE_PASSCODE` are missing.
- Set `REQUIRE_API_CONTRACT_CHECK=1` (or run in CI) to fail hard on missing env.
- For production release validation, run strict + write-path checks:
  - `REQUIRE_API_CONTRACT_CHECK=1 NON_DESTRUCTIVE=0`.

## Functional + Quality Suites

```bash
TENANT_ID=<tenant-uuid> npm run qa:functional
TENANT_ID=<tenant-uuid> npm run qa:quality
TENANT_ID=<tenant-uuid> npm run qa:all
```

Outputs:
- Functional: `scripts/testing/functionality/latest-functional.md`
- Quality: `scripts/testing/quality/latest-quality.md`

## Contract Verification (Non-Destructive)

```bash
BASE_URL=<deployment-or-local-url> \
TENANT_ID=<tenant-uuid> \
STORE_PASSCODE=<passcode> \
NON_DESTRUCTIVE=1 \
npx tsx scripts/verify-api-contracts.ts
```

Artifact:
- `tmp/release-validation/overnight-phase2-report.json`

## Contract Verification (Production Strict)

```bash
BASE_URL=https://rug-concierge.vercel.app \
TENANT_ID=<tenant-uuid> \
STORE_PASSCODE=<passcode> \
REQUIRE_API_CONTRACT_CHECK=1 \
NON_DESTRUCTIVE=0 \
npm run check:api-contracts
```

## Demo Inventory Flow

```bash
TENANT_ID=<tenant-uuid> npx tsx scripts/seed-demo-rugs.ts
TENANT_ID=<tenant-uuid> npx tsx scripts/re-enrich-rugs.ts --tenant-id=<tenant-uuid>
```

If enrichment failures remain, rerun without `--force` to retry only unenriched rows.
