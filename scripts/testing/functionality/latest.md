# Functionality Suite (Latest)

- Generated: 2026-02-26T16:36:30.041Z
- Base URL: http://127.0.0.1:3100
- Tenant ID: 0a175457-6194-4ae9-bf4e-1a785d754c4b
- Passed: 7
- Failed: 0

| Check | Result | Details |
| --- | --- | --- |
| chat endpoint returns 200 + valid envelope | PASS | {"status":200} |
| recommend endpoint returns 200 + valid envelope | PASS | {"status":200} |
| appraisal endpoint allows staff and returns structured JSON | PASS | {"status":200} |
| appraisal endpoint blocks retail (403, no 500) | PASS | {"status":403} |
| role mismatch is rejected (403, no 500) | PASS | {"status":403} |
| tenant mismatch on existing session is rejected (403) | PASS | {"status":403,"session_id_present":true} |
| recommend missing tenant returns 400 (no 500) | PASS | {"status":400} |
