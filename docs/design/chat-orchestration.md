# Chat Orchestration (Scaffold)

This file maps where each backend chat responsibility lives.

## Entry Point

- `apps/web/app/api/chat/route.ts`
  - Receives user message + `session_id` + role + optional constraints/inventory
  - Loads session
  - Updates recommendation state for this turn
  - Routes mode (`general_chat` or `recommendation`)
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
  - Turn-level mode decision
  - Placeholder keyword router for now

- `apps/web/lib/chat/prompt-builder.ts`
  - Placeholder layer assembly: system + role + task + context + latest message

## Mode Handlers

- `apps/web/lib/chat/handlers/general-chat.ts`
  - Placeholder freeform response path

- `apps/web/lib/chat/handlers/recommendation.ts`
  - Uses persistent recommendation state
  - Applies hard filters and candidate shaping
  - Calls AI recommendation pipeline

## Existing Recommendation Endpoint

- `apps/web/app/api/recommend/route.ts`
  - Still available as recommendation-only endpoint
  - Can be kept for direct recommendation calls or internal reuse

