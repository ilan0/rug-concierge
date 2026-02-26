# Testing Guide

Use one command for full validation:

```bash
SMOKE_TENANT_ID=YOUR_TENANT_ID npm run qa:all
```

## Read This First

- `docs/testing/latest-summary.md`

## Deep Debug (Only If Needed)

- `docs/testing/e2e-smoke-report.md`
- `docs/testing/e2e-smoke-report.json`
- `docs/testing/demo-rehearsal-report.md`
- `docs/testing/artifacts/`
- `docs/testing/qa-log.ndjson`

## Stable Test Docs (Tracked)

- `docs/testing/eval-cases.md`
- `docs/testing/whats-broken.md`
- `docs/testing/fixtures/`
- `docs/testing/archive/`

## Notes

- `latest-summary.*`, `e2e-smoke-report.*`, `demo-rehearsal-report.md`, and `qa-log.ndjson` are generated outputs.
- Treat generated files as run artifacts, not long-term documentation.
