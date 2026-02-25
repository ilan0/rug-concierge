# Hybrid Memory + General Chat Validation Report

- Generated: 2026-02-25T22:31:00Z
- Reviewer: Codex
- Tenant ID: `0a175457-6194-4ae9-bf4e-1a785d754c4b`
- Primary Runtime: real OpenAI (`OPENAI_API_KEY` present)
- Validation Window: focused hardening pass (automated + manual + fallback matrix)

## Final Decision

**GO**

Reason: no P0 blockers and no unresolved P1 safety/contract issues found across static gates, automated suites, manual continuity checks, trace integrity checks, and fallback matrix checks.

## Gate Table

| Gate | Result | Evidence |
| --- | --- | --- |
| Preflight | PASS | `node v20.20.0`, `npm 10.8.2`, OpenAI key detected, tenant selected for run |
| Static Quality | PASS | `npm --workspace apps/web run lint` and `npm --workspace apps/web run build` passed |
| Automated Full Gate | PASS | `SMOKE_TENANT_ID=... ENABLE_GENERAL_CHAT_AI=1 CHAT_MEMORY_V1=1 npm run qa:all` passed |
| Smoke Coverage | PASS | `docs/testing/e2e-smoke-report.*` shows **18/18** passed |
| Demo Rehearsal | PASS | `docs/testing/demo-rehearsal-report.md` shows **7/7** passed |
| Manual Continuity + Routing | PASS | direct `/api/chat` sequence validated sticky constraints and routing behavior |
| Trace Integrity | PASS | chat traces include memory snapshots + context packet stats; bounded context verified |
| Fallback Matrix | PASS | `ENABLE_GENERAL_CHAT_AI=0` and `OPENAI_API_KEY=''` both returned deterministic safe behavior |

## Detailed Results

## 1) Automated Full Gate

Command:

```bash
SMOKE_TENANT_ID=0a175457-6194-4ae9-bf4e-1a785d754c4b ENABLE_GENERAL_CHAT_AI=1 CHAT_MEMORY_V1=1 npm run qa:all
```

Observed:
- `lint`: pass
- `build`: pass
- smoke suite: `18/18` pass
- demo rehearsal: `7/7` pass
- targeted contract/policy checks in `qa:all` remain pass (`400/403` checks)

Artifacts:
- `docs/testing/latest-summary.md`
- `docs/testing/latest-summary.json`
- `docs/testing/e2e-smoke-report.md`
- `docs/testing/e2e-smoke-report.json`
- `docs/testing/demo-rehearsal-report.md`

## 2) Manual Contract + Continuity Checks

API base used: `http://127.0.0.1:3301`

Validated outcomes:
1. General chat runtime marker:
- message: `tell me about rug maintenance`
- result: `mode=general_chat`
- notes contain: `GENERAL_CHAT_AI_RUNTIME:real`

2. Sticky continuity:
- turn 1: `show me 8x10 under $2500`
- turn 2: `is this size good for living room?`
- result: `recommendation_state.hard_constraints` preserved both `size` and `budgetMax=2500`

3. Clear-budget behavior:
- turn 3: `clear budget`
- result: `budgetMax` cleared, `size` preserved

4. Clear-size behavior:
- new session with explicit constraints, then `remove size`
- result: `size` cleared, `budgetMax` preserved

5. Full reset behavior:
- `start over constraints`
- result: both `size` and `budgetMax` cleared

6. Advice routing correctness:
- message: `tell me about rugs`
- result: `mode=general_chat` and `response.mode=general_chat`

## 3) Trace Integrity Validation

Latest artifact root (from smoke JSON):
- `docs/testing/artifacts/run-2026-02-25t22-23-28-420z`

Validated programmatically:
1. Chat-route trace completeness:
- chat-route files: `14`
- files with all required fields (`memory_snapshot_before`, `memory_snapshot_after`, `ai_context_packet_stats`): `14/14`

2. Bounded context behavior:
- max observed `ai_context_packet_stats.field_counts.recent_turns`: `2` (<= 4)
- occurrences of `recent_turns > 4`: `0`
- recommendation AI payloads containing `chat_history` key: `0`

3. Prompt-layer alignment:
- general chat traces include memory/recent-turn layers on subsequent turns
- recommendation traces include expected layers (`TASK_PROMPT_RECOMMENDATION`, `STRUCTURED_OUTPUT_RECOMMENDATION`, `INVENTORY_CONTEXT`, memory/recent-turn context as applicable)

## 4) Failure-Mode Matrix

## Scenario A: `ENABLE_GENERAL_CHAT_AI=0`
Runtime: server on `:3302`

Results:
- `/api/chat` general prompt -> `200`, `mode=general_chat`, notes contain `GENERAL_CHAT_AI_RUNTIME:fallback_disabled`
- `/api/recommend` -> `200`, structured response remains valid
- `/api/appraisal/generate` as `store_staff` (with role cookie) -> `200`, `mode=appraisal_draft` (unchanged behavior)

## Scenario B: `OPENAI_API_KEY=''`
Runtime: server on `:3303`

Results:
- `/api/chat` general prompt -> `200`, notes contain `GENERAL_CHAT_AI_RUNTIME:fallback_missing_api_key`
- `/api/recommend` -> `200`, notes: `Missing OPENAI_API_KEY. Returned local fallback.`
- `/api/appraisal/generate` as `store_staff` (with role cookie) -> `200`, `mode=appraisal_draft`, notes indicate missing key fallback
- `/api/appraisal/generate` as retail -> `403` (policy unchanged)

## Acceptance Criteria Check

1. `lint`, `build`, `qa:all` all pass: **PASS**
2. Manual continuity and reset scenarios behave as specified: **PASS**
3. Trace integrity fields present and bounded: **PASS**
4. Advice-only routing no longer misclassified to recommendation: **PASS**
5. Fallback modes deterministic and user-safe: **PASS**
6. Final report contains evidence + GO/NO-GO: **PASS**

## Findings by Severity

## P0
- None.

## P1
- None.

## P2
- In first-turn general chat cases, memory/recent-turn layers may be absent when memory context is empty. This is acceptable behavior, but keep this in mind when reading traces.
- Debug trace blocked response is currently `404` in production-style runs (already known behavior from existing rehearsal), not a blocker for this pass.

## Recommendation

Proceed to next development phase.

For additional confidence before external pilot handoff, run one extended manual 30-turn mixed conversation and capture latency + UX notes, but this is optional (not blocking based on this gate).
