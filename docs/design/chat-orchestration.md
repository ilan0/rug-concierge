# Chat Orchestration (Current)

Backend chat is centralized in one turn processor.

## Entry Point

- `apps/web/app/api/chat/route.ts`
  - Validates request.
  - Resolves role from cookie/request and enforces policy.
  - Resolves tenant context (`tenant_id` request value or session-bound tenant).
  - Loads session (`getOrCreateSession`).
  - Updates recommendation/trade/project context.
  - Routes mode for current turn.
  - Dispatches mode handler.
  - Saves session and returns session envelope.

Request notes:
- `review_action` is a string enum (`approve|reject|regenerate|override`), not an object.
- `override` is an optional object used with `review_action: "override"`.
- Recommendation turns require tenant context; missing tenant returns `400`.
- Session tenant mismatch (`session_id` reused with different `tenant_id`) returns `403`.
- For hosted pilots with `PILOT_ACCESS_PASSCODE`, API calls require access unlock before chat routes are available.

## Role and Capability Enforcement

- Policy modules: `apps/web/lib/auth/*`
- `/api/chat` enforces:
  - baseline `chat.general`
  - `chat.recommend` when routed to recommendation
  - `review.controls` for review actions
  - appraisal role checks for appraisal mode

## Session and Context State

- `apps/web/lib/chat/session-store.ts`
  - Session store facade with Supabase-backed persistence.
  - Falls back to in-memory only if persistence tables are unavailable.
  - Enforces tenant binding per session ID.

- `apps/web/lib/chat/session-repo.ts`
  - Direct DB load/upsert for `chat_sessions`.
  - Append-only turn persistence for `chat_messages`.

- `apps/web/lib/chat/state.ts`
  - Updates recommendation state every turn.

- `apps/web/lib/chat/trade-context.ts`
  - Updates trade metadata/preferences for trade/staff/developer flows.

- `apps/web/lib/chat/project-context.ts`
  - Maintains multi-room project context and active room.

## Mode Routing

- `apps/web/lib/chat/router.ts`
  - Table-driven first-match rule engine.
  - Returns: `mode`, `rule_id`, `confidence`, `needs_clarification`.
  - Current rule order:
    - `REVIEW_ACTION_CONTROL`
    - `APPRAISAL_STAFF`
    - `APPRAISAL_NON_STAFF_BLOCK`
    - `EXPLICIT_RECOMMENDATION_REQUEST`
    - `RECOMMENDATION_FOLLOWUP`
    - `GENERAL_ADVICE_OR_EDUCATION`
    - `AMBIGUOUS_WITH_CONSTRAINTS_ONLY`
    - `DEFAULT_GENERAL_CHAT`

## Mode Handlers

- `apps/web/lib/chat/handlers/general-chat.ts`
  - General chat fallback response path.

- `apps/web/lib/chat/handlers/recommendation.ts`
  - Applies review actions and state merges.
  - Calls shared recommendation pipeline (`runRecommendationPipeline`).

- `apps/web/lib/chat/handlers/appraisal.ts`
  - Generates structured appraisal drafts for authorized roles.

## Recommendation Route Reuse

- `apps/web/app/api/recommend/route.ts`
  - Thin recommendation-only API route.
  - Uses same shared recommendation pipeline as chat recommendation turns.

## Prompt Layer Visibility

- Debug-friendly prompt-layer previews are built by:
  - `apps/web/lib/chat/prompt-builder.ts`
  - `apps/web/lib/prompts/layers.ts`
- Recommendation trace artifacts also capture actual prompt payload and parsed response.
