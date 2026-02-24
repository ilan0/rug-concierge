# Thorough Testing Report

- Generated (UTC): 2026-02-24T01:40:00Z
- Scope: Recent API/security/tenant/UX hardening changes
- Base URL: `http://localhost:3000`
- Tenant used for integration checks: `0a175457-6194-4ae9-bf4e-1a785d754c4b`
- OpenAI runtime: Real API responses enabled

## 1) Preflight

- Node: `v20.20.0`
- npm: `10.8.2`
- Dev server reachable on port 3000

Result: PASS

## 2) Static Quality Gate

### Command
- `npm --workspace apps/web run lint`
- `npm --workspace apps/web run build`

### Result
- Lint: PASS (no blocking errors)
- Build: PASS (Next build + TypeScript completed)

## 3) Automated API/Flow Validation

### E2E smoke suite
- Command: `SMOKE_TENANT_ID=0a175457-6194-4ae9-bf4e-1a785d754c4b npm run qa:e2e-smoke`
- Report: `/Users/ilannabatkhorian/Documents/rug-concierge/docs/testing/e2e-smoke-report.md`
- JSON: `/Users/ilannabatkhorian/Documents/rug-concierge/docs/testing/e2e-smoke-report.json`
- Result: `Passed 12/12`, `Failed 0`
- OpenAI runtime line: `real OpenAI responses detected`

### Demo rehearsal suite
- Command: `SMOKE_TENANT_ID=0a175457-6194-4ae9-bf4e-1a785d754c4b npm run qa:demo-rehearsal`
- Report: `/Users/ilannabatkhorian/Documents/rug-concierge/docs/testing/demo-rehearsal-report.md`
- Result: `Passed 7/7`, `Failed 0`

## 4) Targeted Contract + Security Checks (manual curl)

| Check | Expected | Actual | Result |
| --- | --- | --- | --- |
| `/api/recommend` missing tenant | 400 | 400 | PASS |
| `/api/recommend` constraints wrong type | 400 | 400 | PASS |
| `/api/chat` cookie/body role mismatch | 403 | 403 | PASS |
| `/api/debug/trace` non-developer | 403 | 403 | PASS |
| `/api/debug/trace` developer | 200 | 200 | PASS |
| Chat follow-up, same session, no tenant sent | 200 | 200 | PASS |
| Chat follow-up, same session, different tenant sent | 403 | 403 | PASS |
| `review_action` by retail | 403 | 403 | PASS |
| `review_action=regenerate` by staff | 200 + `decision=regenerated` | 200 + regenerated | PASS |
| `/api/appraisal/generate` missing tenant | 400 | 400 | PASS |
| `/api/appraisal/generate` retail role | 403 | 403 | PASS |

Evidence payload samples were captured in `/tmp/*.json` during this run.

## 5) Pilot Access Gate Validation (passcode mode)

I temporarily restarted dev server with `PILOT_ACCESS_PASSCODE=pilottest` and verified access gating.

| Check | Expected | Actual | Result |
| --- | --- | --- | --- |
| `GET /api/ui-access` | required=true, verified=false | matched | PASS |
| `POST /api/ui-access` wrong passcode | 401 | 401 | PASS |
| `POST /api/ui-access` correct passcode | 200 + verified=true | matched | PASS |
| `/api/chat` without pilot access cookie | 401 | 401 | PASS |
| `/api/chat` with verified access cookie | 200 | 200 | PASS |

After validation, dev server was restored to normal startup (no passcode override).

## 6) Persistence Integrity (Supabase)

Using service-role query checks on latest 8 sessions:

- `chat_sessions.tenant_id` == `chat_sessions.session_data.tenant_id` for all checked sessions
- `chat_messages.tenant_id` consistent per session for all checked sessions
- Review metadata present on sessions where review action occurred

Summary: 8/8 sessions consistent. No tenant drift observed.

## 7) UI Route/Guard Sanity (SSR output checks)

Validated rendered page content by role/tenant cookies:

- Retail opening `/trade` shows blocked copy: PASS
- Retail opening `/appraisal` shows blocked copy: PASS
- Staff opening `/inventory` without tenant shows "Store Tenant Required": PASS
- Staff opening `/inventory` with tenant renders inventory view: PASS
- Concierge debug link hidden for retail and shown for developer: PASS
- Inventory tenant record count matches DB available count for tenant (`10`): PASS

## Findings

### P0
- None

### P1
- None

### P2
- Page-level role/tenant guards intentionally render blocked pages with HTTP 200 (not 403/redirect). This is acceptable for current UX, but external monitors relying on status codes alone may misclassify access-denied states.

## Gate Decision

- Decision: GO
- Confidence: High
- Rationale: Static checks clean, smoke and demo suites fully green, targeted security/tenant/pilot-access checks passed, and persistence consistency validated in DB.
