# Testing Guide

All suites require `TENANT_ID=<tenant-uuid>`.

## Canonical Suites

1. `npm run qa:functional`
2. `npm run qa:quality`

Shortcuts:
- `npm run qa` -> functional
- `npm run qa:all` -> functional + quality

## Output Files

- Functional: `scripts/testing/functionality/latest-functional.md`
- Quality: `scripts/testing/quality/latest-quality.md`
