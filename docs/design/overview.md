# System Overview (v1)

High-level architecture and flow summary.

## Architecture Summary

- Single monorepo
- Next.js app router for UI + API
- Supabase for inventory and business data
- Multi-tenant data model via `tenant_id`
- Backend-first chat orchestration
- Shared recommendation pipeline for both chat and recommendation endpoint

## Chat Entry and Mode Routing

All user turns enter backend first (`/api/chat`).

Backend responsibilities:
- validate request + enforce role/capability policy
- load/update session context
- route turn mode (`general_chat`, `recommendation`, `appraisal`)
- call mode handler and persist session

AI responsibilities:
- general chat: AI-backed guidance with bounded memory context
- recommendation: rank/explain from provided candidates only
- appraisal: generate structured draft from provided facts only

## Role Model

Roles:
- `retail_customer`
- `trade_client`
- `store_staff`
- `developer`

Role policy is centralized under `apps/web/lib/auth/*` and applied across UI route access and API authorization.

## Prompt Layering

Prompt stack is layered by mode and role.

General chat mode includes:
1. system prompt
2. general-chat task prompt
3. role prompt
4. optional trade/project context
5. chat memory context
6. recent turns context
7. latest user message

Recommendation mode includes:
1. system prompt
2. recommendation task prompt
3. structured-output guidance prompt
4. optional trade support prompt
5. optional trade preferences context
6. optional project context
7. optional chat memory/recent turns context
8. inventory context
9. user request with constraint/project snapshot

Implementation note:
- Recommendation prompt layer ordering is centralized in `apps/web/lib/prompts/recommendation-stack.ts`
  and reused by both debug preview and runtime AI request assembly.

Appraisal mode uses appraisal prompts + appraisal context payload.

API-level strict JSON schema is the hard response contract where structured output is required.

## Recommendation Model

- SQL-first filtering for active hard constraints.
- Tenant scoping is always applied for inventory-backed recommendation queries.
- Deterministic backend filtering and candidate shaping.
- AI ranking/explanation only after backend candidate selection.
- Deterministic post-processing for confidence and objection fields.
- Constraints remain sticky across turns until explicitly changed/cleared by user.

No RAG/vector search is used for MVP recommendation behavior.

## Appraisal Model

- Appraisal generation is internal workflow only (`store_staff`, `developer`).
- Output is a draft, not final authority.
- Grounding is restricted to provided appraisal/inventory fields.

## UI Shell

- Home route sets/syncs role.
- Home route also sets/syncs tenant context (`tenant_id`) for owner/staff flows.
- Optional pilot passcode gate can be enabled with `PILOT_ACCESS_PASSCODE`.
- Role-aware workspace pages:
  - concierge
  - trade
  - inventory
  - appraisal
- Shared workspace navigation and standardized global styling (`ui-*` classes).
