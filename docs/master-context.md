# Rug Concierge Master Context

This file is the one-page source of truth for a fresh chat.

## Product Goal

Build an AI Rug Concierge for independent rug stores that:
- recommends rugs from real inventory
- supports retail and trade workflows
- drafts appraisal documents for internal staff workflows

Primary objective: trust, correctness, and operational usefulness.

## Non-Negotiables

- Inventory is the source of truth.
- User chat always goes to backend first.
- Backend owns routing, policy checks, and hard filtering.
- Recommendation flows require tenant context (`tenant_id`) and never query cross-tenant inventory.
- AI ranks/explains only after backend candidate selection.
- AI must not invent inventory facts.
- `no_match` is a valid outcome.

## Current Runtime Surfaces

- UI pages: `/`, `/concierge`, `/trade`, `/inventory`, `/appraisal`
- API routes:
  - `/api/chat`
  - `/api/recommend`
  - `/api/appraisal/generate`
  - `/api/debug/trace` (developer-only)
  - `/api/ui-role` (cookie sync)
  - `/api/ui-access` (optional pilot access gate)

## Role + Capability Model (Current)

Roles:
- `retail_customer`
- `trade_client`
- `store_staff`
- `developer`

Policy source of truth:
- `apps/web/lib/auth/roles.ts`
- `apps/web/lib/auth/capabilities.ts`
- `apps/web/lib/auth/policy.ts`
- `apps/web/lib/auth/request-role.ts`

Authorization rules:
- Server resolves role from cookie first (`rug_ui_role`), request role second.
- Cookie/request mismatch is `403`.
- Privileged roles (`store_staff`, `developer`) require cookie-resolved role.
- Request contract uses `role` as canonical field. `user_role` is accepted as a compatibility alias only.

## Chat Routing Contract (Current)

Single entry: `POST /api/chat`

Per turn:
1. Validate request.
2. Resolve/enforce role.
3. Load or create session.
4. Update recommendation, trade, and project context.
5. Route mode via router table:
   - `general_chat`
   - `recommendation`
   - `appraisal`
6. Run mode handler.
7. Persist updated session.
8. Return session envelope + handler response.

Router behavior:
- Review actions force recommendation mode.
- Appraisal intent routes to appraisal only for roles with `appraisal.generate`.
- Ambiguous messages with constraint signals return clarifying question path.
- Recommendation mode requires tenant context. Missing tenant returns `400`.
- Existing sessions are tenant-bound; tenant mismatch on the same `session_id` returns `403`.

## Session Model (Current)

Session state stores:
- `chat_history`
- `recommendation_state` (hard constraints + soft prefs)
- `trade_context` (trade identity metadata + preferences)
- `project_context` (multi-room, active room)
- `review_state` (last recommendations + review actions)

This supports mixed conversations without relying on model memory.
Session state is persisted in Supabase tables (`chat_sessions`, `chat_messages`) for durability across restarts.

## Recommendation Pipeline (Shared)

Used by both `/api/recommend` and recommendation turns in `/api/chat`.

1. Parse input + merge constraints (explicit fields + extracted text hints).
2. Validate tenant context (request tenant or existing session-bound tenant).
3. Query Supabase with SQL-first hard filters:
   - availability always
   - budget when provided
   - size when provided (tolerance + rotation support)
   - tenant filter always
4. Apply deterministic in-code hard checks as safety.
5. Shape bounded candidate set for AI.
6. If empty: return `no_match`.
7. If non-empty: send candidate context + prompt layers to AI.
8. Sanitize and normalize AI output to strict schema.
9. Apply deterministic confidence, confidence tier/factors, and `why_not`.
10. Return structured response.

## AI Prompting Direction

Recommendation prompt stack uses official prompt docs plus runtime context blocks.
Primary docs:
- `docs/prompts/system.md`
- `docs/prompts/recommendation.md`
- `docs/prompts/recommendation-structured-output.md`
- `docs/prompts/trade-support.md` (trade role only)

Contract enforcement:
- API-level `json_schema` (`strict: true`) is the hard output contract.
- Prompt structured-output instructions are behavior guidance.

## Appraisal Draft Flow (Current)

- Entry: `/api/appraisal/generate` and appraisal mode in `/api/chat`.
- Allowed roles: `store_staff`, `developer`.
- Output is a structured draft for human review/export, never final authority.

## Pilot UI Shell (Current)

- Home screen selects role and syncs cookie.
- Home screen sets tenant context (`tenant_id`) and syncs tenant cookie.
- Role switcher is environment-controlled for pilot simplicity:
  - `NEXT_PUBLIC_ENABLE_ROLE_SWITCHER`
  - `NEXT_PUBLIC_PILOT_DEFAULT_ROLE`
  - `NEXT_PUBLIC_ENABLE_DEVELOPER_ROLE`
- Optional hosted pilot gate:
  - `PILOT_ACCESS_PASSCODE`
- Shared role-aware nav component used across workspace pages.
- Developer-only debug trace affordances are hidden from non-developer roles.
- Staff review controls are shown only in recommendation context turns.

## Testing + QA Artifacts

- Smoke reports:
  - `docs/testing/e2e-smoke-report.md`
  - `docs/testing/e2e-smoke-report.json`
- Full smoke suite recommendation cases require `SMOKE_TENANT_ID`.
- Deep trace artifacts:
  - `docs/testing/artifacts/<run-id>/<case-id>/*.json`
- QA event log:
  - `docs/testing/qa-log.ndjson`

Canonical testing root: `docs/testing`.

## Pointers

- Architecture/file placement: `docs/design/architecture-map.md`
- Chat flow map: `docs/design/chat-orchestration.md`
- Role policy map: `docs/design/role-capability-matrix.md`
- Recommendation behavior: `docs/design/concierge-flow.md`
