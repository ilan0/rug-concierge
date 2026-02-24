# Demo Rehearsal Report

- Generated: 2026-02-24T01:35:36.407Z
- Base URL: http://localhost:3000
- Tenant ID: 0a175457-6194-4ae9-bf4e-1a785d754c4b
- Passed: 7
- Failed: 0

| Scenario | Result | Details |
| --- | --- | --- |
| Staff recommendation turn | PASS | status=200, mode=recommendation |
| Staff follow-up recommendation | PASS | status=200, mode=recommendation |
| Staff review regenerate action | PASS | status=200, decision=regenerated |
| Staff appraisal draft generation | PASS | status=200, mode=appraisal_draft |
| Retail appraisal blocked | PASS | status=403 |
| Retail debug trace blocked | PASS | status=403 |
| Developer debug trace allowed | PASS | status=200 |
