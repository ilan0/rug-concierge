# One-Hour Codebase Review (Rug Concierge Quality Gate)

## 1) Header

- Generated: 2026-02-25T21:18:00Z
- Reviewer: Codex
- Tenant used: `0a175457-6194-4ae9-bf4e-1a785d754c4b`
- OpenAI runtime mode (verification run): `real`
- Scope reviewed:
  - `/Users/ilannabatkhorian/Documents/rug-concierge/apps/web/app/*`
  - `/Users/ilannabatkhorian/Documents/rug-concierge/apps/web/lib/*`
  - `/Users/ilannabatkhorian/Documents/rug-concierge/apps/web/components/*`
  - `/Users/ilannabatkhorian/Documents/rug-concierge/docs/*`
  - `/Users/ilannabatkhorian/Documents/rug-concierge/scripts/*`

## 2) Gate Table

| Gate | Result | Evidence | Notes |
| --- | --- | --- | --- |
| Architecture integrity | PASS (with P2 maintainability risk) | `apps/web/app/api/chat/route.ts`, `apps/web/app/api/recommend/route.ts`, `apps/web/lib/recommend/pipeline.ts` | Route-to-lib separation exists, but route files are large and carry orchestration detail. |
| Tenant + auth safety | PASS | manual checks: missing tenant `400`, session tenant mismatch `403`, role mismatch `403`, appraisal non-staff `403`, debug non-dev blocked (`404` prod-style) | No obvious tenant/role bypass observed in reviewed paths. |
| Recommendation contract reliability | PASS (with P1 routing issue) | `qa:all` passed, recommendation contract checks green, fallback test with missing key returns structured output | Schema and fallback path are deterministic; one router intent issue found (see P1-1). |
| UX readiness (owner pilot) | PASS (with P1 behavior issue) | concierge/appraisal/workspace components reviewed; manual route behavior checks | Role gating and operator exposure mostly correct; one major intent-routing mismatch affects UX. |
| Testing health | PASS (with P2 ops risk) | `SMOKE_TENANT_ID=... npm run qa:all` -> GO, smoke `12/12`, rehearsal `7/7` | Single-command flow works; artifact cleanup policy can create git churn if tracked artifacts remain. |
| Onboarding clarity | PASS (with P2 drift) | `docs/master-context.md`, `docs/working-notes.md`, `docs/contributor-map.md` | Core docs are strong; one contributor-map pointer is stale/missing file. |

## 3) Findings (Ordered by Severity)

### P0

- None.

### P1

1. **Router intent misclassification sends general advice to recommendation pipeline**
   - Evidence:
     - `apps/web/lib/chat/router.ts`: `isExplicitRecommendationRequest` includes very broad token `"rugs"`.
     - Rule order checks explicit recommendation before general advice.
     - Verified behavior:
       - request: `"tell me about rugs"`
       - actual: `mode: recommendation`
       - expected: `general_chat`
   - Impact:
     - Unnecessary inventory+AI recommendation calls for advice/education turns.
     - Increased latency/cost and less natural conversation behavior.
   - Severity rationale:
     - High product-impact behavior error on common phrasing, but not a security breach.

### P2

1. **Contributor map has stale file pointer**
   - `docs/contributor-map.md` references `/apps/web/lib/supabase/inventory.ts` which does not exist.
   - Actual inventory read path is `/apps/web/lib/inventory/list.ts`.
   - Impact: onboarding friction.

2. **Testing artifact baseline in git is inconsistent/fragile**
   - Current working tree shows testing report churn and missing checklist file state.
   - `qa:all` intentionally cleans old run artifacts; if artifact folders/files are tracked, repeated churn/conflicts are likely.
   - Impact: noisy diffs and harder code review hygiene.

3. **Route files are very large for long-term maintainability**
   - `apps/web/app/api/chat/route.ts` ~478 lines
   - `apps/web/app/api/recommend/route.ts` ~442 lines
   - Impact: slower onboarding and higher regression risk over time.

4. **Access-denied UX currently returns blocked page content with HTTP 200 for UI routes**
   - Seen in role-guarded page rendering pattern.
   - Impact: acceptable for UX, but external monitors/automation may misread denied states.

## 4) Drift List

### Docs vs Runtime

1. `docs/contributor-map.md` -> stale reference to nonexistent `/apps/web/lib/supabase/inventory.ts`.
2. Working tree indicates `/docs/testing/demo-rehearsal-checklist.md` is currently deleted, while docs/notes still reference it.

### Test vs Runtime

1. `qa:all` passes, but does not currently include a dedicated assertion that explicitly catches the `"tell me about rugs"` routing bug (general advice with word `rugs`).
2. Runtime fallback behavior works with missing key, but this is validated manually; fallback assertion is not a first-class dedicated gate in `qa:all` output labels.

## 5) Top 5 Next Actions (Prioritized)

1. **Fix router rule ordering + keyword strictness (P1)**
   - Change routing precedence so clear advice/education intents are evaluated before broad recommendation tokens.
   - Tighten explicit recommendation lexicon (remove overly broad single token `"rugs"` from strong trigger).
   - Effort: 1.5-2.5 hours including tests.

2. **Add a regression test case for advice-vs-recommendation disambiguation**
   - Add smoke case: `"tell me about rugs"` must route `general_chat`.
   - Effort: 30-60 minutes.

3. **Repair contributor map pointer drift**
   - Update stale path and run a quick docs link sanity pass.
   - Effort: 20-30 minutes.

4. **Stabilize testing artifact policy in repo tracking**
   - Decide and enforce whether generated testing outputs are tracked or ignored; align `.gitignore` + docs accordingly.
   - Effort: 30-60 minutes.

5. **Extract route orchestration segments into focused helper modules**
   - Keep API routes thin (validation, guard, dispatch) and move trace/review/session-update helpers out.
   - Effort: 3-5 hours incremental refactor.

## 6) Final Decision

- **Decision: GO (with required P1 follow-up before external pilot handoff)**
- Reasoning:
  - No P0 security/tenant isolation blockers were found.
  - Core quality gates and verification run passed (`qa:all` GO, smoke 12/12, rehearsal 7/7).
  - One unresolved P1 behavior issue exists (intent routing misclassification). It is not a security safety breach, but it is significant for UX/cost correctness and should be fixed before owner-facing pilot sessions.
- Confidence score: **0.84 / 1.00**

