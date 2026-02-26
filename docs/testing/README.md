# Testing (Current)

Use only two suites:

1. Functionality (app runs + APIs work)
2. Quality (core chat behavior)

## Run

```bash
TENANT_ID=<tenant-uuid> npm run qa:functional
TENANT_ID=<tenant-uuid> npm run qa:quality
```

Default shortcut:

```bash
TENANT_ID=<tenant-uuid> npm run qa
```

## Outputs (overwritten each run)

- `scripts/testing/functionality/latest.md`
- `scripts/testing/quality/latest.md`

No historical run folders are kept by the QA scripts.
