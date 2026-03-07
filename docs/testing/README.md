# Testing Guide

All suites require `TENANT_ID=<tenant-uuid>`.

## Canonical Suites

1. `npm run qa:functional`
2. `npm run qa:quality`
3. `npm run qa:intake`

Shortcuts:
- `npm run qa` -> functional
- `npm run qa:all` -> functional + quality
- `npm run qa:intake:loop` -> gated intake loop

## Intake Loop Gates

`qa:intake:loop` requires:
- intake matrix pass
- functional pass
- quality pass
- two consecutive green cycles
- zero open P0/P1 intake defects

## Output Files

- Functional: `scripts/testing/functionality/latest-functional.md`
- Quality: `scripts/testing/quality/latest-quality.md`
- Intake matrix: `scripts/testing/intake/latest-intake.md`
- Intake loop: `scripts/testing/intake/latest-intake-loop.md`
- Intake artifacts: `docs/testing/artifacts/intake/<run-id>/...`
