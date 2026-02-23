# Chat Orchestration (Scaffold)

This file maps where each backend chat responsibility lives.

## Entry Point

- `apps/web/app/api/chat/route.ts`
  - Receives user message + `session_id` + role + optional constraints/context
  - Loads session
  - Updates recommendation state for this turn
  - Updates trade context and project context for this turn
  - Routes mode (`general_chat`, `recommendation`, or `appraisal`)
  - Calls mode handler
  - Saves updated session

## Session + State

- `apps/web/lib/chat/session-store.ts`
  - Placeholder in-memory session storage
  - Replace with DB/Redis later

- `apps/web/lib/chat/state.ts`
  - Updates `recommendation_state` every turn
  - Works even when turn routes to freeform chat

- `apps/web/lib/chat/types.ts`
  - Shared chat/session/role contracts

## Routing + Prompts

- `apps/web/lib/chat/router.ts`
  - Single source of truth for turn-level mode decision
  - Table-driven decision output: `mode`, `rule_id`, `confidence`, `needs_clarification`
  - First-match rule order:
    - `REVIEW_ACTION_CONTROL`
    - `APPRAISAL_STAFF`
    - `APPRAISAL_NON_STAFF_BLOCK`
    - `EXPLICIT_RECOMMENDATION_REQUEST`
    - `RECOMMENDATION_FOLLOWUP`
    - `GENERAL_ADVICE_OR_EDUCATION`
    - `AMBIGUOUS_WITH_CONSTRAINTS_ONLY`
    - `DEFAULT_GENERAL_CHAT`

- `apps/web/lib/chat/prompt-builder.ts`
  - Prompt-layer trace preview for debug readability
  - Uses shared prompt-layer IDs from `apps/web/lib/prompts/layers.ts`
  - Recommendation preview is aligned to actual AI payload order

## Mode Handlers

- `apps/web/lib/chat/handlers/general-chat.ts`
  - Placeholder freeform response path

- `apps/web/lib/chat/handlers/recommendation.ts`
  - Uses persistent recommendation/trade/project state
  - Calls shared SQL-first recommendation pipeline
  - Pipeline trace includes `ai_trace.prompt_layers` (id/role/preview/length)

- `apps/web/lib/chat/handlers/appraisal.ts`
  - Store-staff appraisal handler
  - Calls structured appraisal draft generation

## Existing Recommendation Endpoint

- `apps/web/app/api/recommend/route.ts`
  - Thin recommendation-only route
  - Uses the same shared recommendation pipeline as chat mode

## Trade UI Flow

- `apps/web/app/trade/page.tsx`
  - Uses the shared chat shell (`ConciergeScreen`) in trade variant mode
  - Injects trade/project context in `/api/chat` requests
