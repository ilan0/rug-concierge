# QA Latest Summary

- Generated: 2026-02-25T22:24:47.707Z
- Base URL: http://127.0.0.1:3100
- Tenant ID: 0a175457-6194-4ae9-bf4e-1a785d754c4b
- OpenAI Runtime: real
- Final Decision: GO
- Passed Gates: 11
- Failed Gates: 0

## Gate Results

| Gate | Status | Duration (ms) | Command |
| --- | --- | ---: | --- |
| preflight | PASS | 0 | (n/a) |
| lint | PASS | 3000 | npm --workspace apps/web run lint |
| build | PASS | 4439 | npm --workspace apps/web run build |
| start server | PASS | 551 | npm --workspace apps/web run start (PORT=3100) |
| e2e smoke | PASS | 53149 | npm run qa:e2e-smoke |
| demo rehearsal | PASS | 26240 | npm run qa:demo-rehearsal |
| check /api/recommend missing tenant => 400 | PASS | 6 | POST /api/recommend |
| check /api/recommend malformed constraints => 400 | PASS | 3 | POST /api/recommend |
| check /api/chat role mismatch => 403 | PASS | 3 | POST /api/chat |
| check /api/appraisal/generate non-staff => 403 | PASS | 3 | POST /api/appraisal/generate |
| cleanup artifacts | PASS | 6 | (n/a) |

## Read First

- `docs/testing/latest-summary.md`

## Deep Debug (if needed)

- `docs/testing/e2e-smoke-report.md`
- `docs/testing/e2e-smoke-report.json`
- `docs/testing/demo-rehearsal-report.md`
- `docs/testing/artifacts/`
