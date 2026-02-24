# One-Hour Validation Report (Risk Gate)

- Generated: 2026-02-23T23:15:00Z
- Timebox: 60 minutes
- Base URL: http://localhost:3000
- Tenant used: `0a175457-6194-4ae9-bf4e-1a785d754c4b`
- OpenAI runtime: **real OpenAI responses detected**
- Smoke run: `docs/testing/e2e-smoke-report.md`

## Gate Summary

| Gate | Result | Notes |
| --- | --- | --- |
| Preflight | PASS | Node 20.20.0, npm 10.8.2, dev server reachable, tenant inventory present, OpenAI+Supabase env loaded |
| Static stability | PASS | `npm --workspace apps/web run lint` and `npm --workspace apps/web run build` passed |
| Automated API gate | PASS | Smoke suite passed **12/12**, failed **0** |
| Security/API checks | PASS (with P2 notes) | Tenant/session/role/debug/appraisal checks passed; identified request-contract ambiguity (see defects) |
| Persistence integrity | PASS | Session + message tenant consistency verified in Supabase |
| UI sanity sweep | PASS (fast manual) | Role-scoped route behavior verified; recommendation endpoint produced recommendation payload |

## Commands Executed

1. `node -v`
2. `npm -v`
3. `npm --workspace apps/web run lint`
4. `npm --workspace apps/web run build`
5. `SMOKE_TENANT_ID=0a175457-6194-4ae9-bf4e-1a785d754c4b npm run qa:e2e-smoke`
6. Targeted `curl` checks for `/api/recommend`, `/api/chat`, `/api/debug/trace`, `/api/appraisal/generate`
7. Supabase integrity spot-check queries against `chat_sessions` and `chat_messages`

## Automated API Gate Verification

- Smoke summary from `docs/testing/e2e-smoke-report.md`:
  - Passed: **12**
  - Failed: **0**
  - OpenAI Runtime: **real OpenAI responses detected**
- Must-hit smoke cases confirmed pass:
  - `recommend missing tenant returns 400`
  - `chat project room follow-up updates active room`
  - `appraisal endpoint blocks non-staff`

## Targeted Security/API Checks

| Check | Expected | Actual | Result |
| --- | --- | --- | --- |
| `/api/recommend` without tenant | 400 | 400 | PASS |
| `/api/recommend` with tenant | 200 + structured response | 200, `mode=recommendations` | PASS |
| Create session with tenant A | 200 | 200 | PASS |
| Follow-up same session, no tenant | 200 | 200 | PASS |
| Same session with tenant B | 403 | 403 | PASS |
| Retail `review_action=regenerate` | 403 | 403 | PASS |
| Staff regenerate with role cookie | 200 | 200 (`decision=regenerated`) | PASS |
| Debug trace as anon/staff | 403 | 403/403 | PASS |
| Debug trace as developer | 200 | 200 | PASS |
| Appraisal generate as non-staff | 403 | 403 | PASS |
| Invalid JSON request | 400 | 400 | PASS |
| Empty chat message | 400 | 400 | PASS |
| Invalid constraints type (`constraints: "bad"`) | graceful handling | 200 (ignored, recommendations returned) | PASS (behavioral), see P2 |

## Persistence Integrity

Validated sample sessions:

- `91260205-62d8-4de2-93f0-0c19c04f917c`
- `9ce9c7a2-911c-443c-940c-eaed9ba5558f`
- `1ec93867-d8b7-4fdb-ae96-6cd57f328020` (staff review action)

Checks:

1. `chat_sessions.tenant_id` matches expected tenant: PASS
2. `chat_sessions.session_data.tenant_id` matches expected tenant: PASS
3. `chat_messages.tenant_id` populated and consistent per session: PASS
4. `chat_messages.metadata.review_action` present on staff review-action session: PASS

Also verified post-restart continuity by reusing an existing session after restarting dev server.

## UI Sanity Sweep (Fast)

Role-route matrix (HTTP + block copy):

- `retail_customer`: `/concierge` open, `/trade` blocked copy, `/inventory` blocked copy, `/appraisal` blocked copy
- `trade_client`: `/concierge` open, `/trade` open, `/inventory` blocked copy, `/appraisal` blocked copy
- `store_staff`: all four routes open
- `developer`: all four routes open

Additional checks:

- Recommendation path returns recommendation payload with items: PASS
- Appraisal page render contains generate/copy/export controls for staff role: PASS
- Debug trace API is developer-only (enforced server-side): PASS

## Defects and Risks

### P2

1. **Request role-field ambiguity (`role` vs `user_role`)**
   - Authorization mismatch checks are tied to `role` field, while many test payloads use `user_role`.
   - Risk: false assumptions during manual testing/integration.
   - Action: document contract clearly and align UI/test payloads to one field.

2. **Invalid constraints payload is tolerated (ignored)**
   - `constraints` with wrong type can still return 200 recommendations.
   - Risk: clients may think malformed constraints were applied.
   - Action: either hard-reject invalid types (400) or return explicit warning metadata.

3. **Dev warning: multiple lockfiles/root inference**
   - Non-blocking but noisy; can mask real warnings.
   - Action: set `turbopack.root` or remove duplicate lockfile strategy.

## GO / NO-GO Decision

**GO** for next coding phase.

Reasoning:

- No P0/P1 defects were found in this one-hour high-risk gate.
- Core risk areas (tenant isolation, role authorization, recommendation contract behavior, session persistence, basic role-scoped UI paths) passed.
- Only P2 follow-ups remain and can be addressed without blocking the next phase.

## Output Artifacts

1. `docs/testing/e2e-smoke-report.md`
2. `docs/testing/e2e-smoke-report.json`
3. `docs/testing/qa-log.ndjson`
4. `docs/testing/one-hour-validation-report.md`
