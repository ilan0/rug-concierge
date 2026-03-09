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

## Role and Capability Enforcement

- Policy modules: `apps/web/lib/auth/*`
- `/api/chat` enforces:
  - baseline `chat.general`
  - `chat.recommend` when routed to recommendation
  - `review.controls` for review actions

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
  - Supports explicit size/budget reset commands.

- `apps/web/lib/chat/memory.ts`
  - Maintains bounded conversation memory summary/facts/open threads.
  - Trims `chat_history` tail to keep context bounded.

- `apps/web/lib/chat/context-packet.ts`
  - Builds bounded model context packets (memory + structured state + recent turns).

- `apps/web/lib/chat/trade-context.ts`
  - Updates trade metadata/preferences for trade/staff/developer flows.

- `apps/web/lib/chat/project-context.ts`
  - Maintains multi-room project context and active room.

## Mode Routing

- `apps/web/lib/chat/router.ts`
  - Table-driven first-match rule engine.
  - Returns: `mode`, `rule_id`, `confidence`, `needs_clarification`.
  - Rule precedence is explicit in `ROUTE_RULE_PRECEDENCE`.
  - Current rule order:
    - `REVIEW_ACTION_CONTROL`
    - `EXPLICIT_RECOMMENDATION_REQUEST`
    - `RECOMMENDATION_FOLLOWUP`
    - `GENERAL_ADVICE_OR_EDUCATION`
    - `AMBIGUOUS_WITH_CONSTRAINTS_ONLY`
    - `DEFAULT_GENERAL_CHAT`

## Mode Handlers

- `apps/web/lib/chat/handlers/general-chat.ts`
  - Real OpenAI-backed general chat handler with deterministic fallback.
  - No backend char clipping on user-facing assistant text.
  - One retry on incomplete/invalid structured output before fallback.
  - Surfaces optional `follow_up_question` for UI rendering.

- `apps/web/lib/chat/handlers/recommendation.ts`
  - Applies review actions and state merges.
  - Calls shared recommendation pipeline (`runRecommendationPipeline`).
  - Recommendation output text is bounded by schema/prompt/token budgets, not post-trimmed.

## Recommendation Route Reuse

- `apps/web/app/api/recommend/route.ts`
  - Thin recommendation-only API route.
  - Uses same shared recommendation pipeline as chat recommendation turns.

## Prompt Layer Visibility

- Debug-friendly prompt-layer previews are built by:
  - `apps/web/lib/chat/prompt-builder.ts`
  - `apps/web/lib/prompts/layers.ts`
  - `apps/web/lib/prompts/general-chat-stack.ts`
  - `apps/web/lib/prompts/recommendation-stack.ts` (shared recommendation layer source)
- Recommendation trace artifacts also capture actual prompt payload and parsed response.
- General chat trace artifacts capture bounded AI debug details:
  - prompt-layer metadata
  - request/response previews
  - parsed response
  - fallback reason (when used)
  - context-packet stats and timing
- Appraisal trace artifacts capture bounded AI debug details:
  - request/response previews
  - parsed response preview
  - retry/incomplete/fallback flags
  - emitted from dedicated appraisal APIs, not `/api/chat`
- Chat route trace captures memory snapshots and context-packet stats:
  - `memory_snapshot_before`
  - `memory_snapshot_after`
  - `ai_context_packet_stats`

## Response Contract Notes

- `/api/chat` returns both coarse and fine mode semantics:
  - `mode` (coarse)
  - `fine_mode` (fine-grained turn outcome)
