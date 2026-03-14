# Chat Orchestration

## Entrypoints

- `POST /api/chat` (session-aware router)
- `POST /api/recommend` (recommendation-only route, no chat memory envelope)

Primary implementation references:
- `apps/web/app/api/chat/route.ts`
- `apps/web/app/api/recommend/route.ts`

## `/api/chat` Turn Flow

1. Validate request body (`message`, optional `session_id`, optional role fields).
2. Resolve role (`role`/`user_role`) and tenant binding.
3. Validate or generate UUID `session_id`.
4. Load/create session state.
5. Route to `general_chat` or `recommendation`.
6. Execute handler.
7. Persist updated session + turn messages.
8. Return mode/fine_mode response envelope.

## Request Contract Notes

Accepted fields:
- `message` (required)
- `session_id` (optional UUID)
- `tenant_id` (optional fallback if env `TENANT_ID` unset)
- `constraints` (optional object)
- `role` / `user_role` (optional; must match when both present)

Validation highlights:
- malformed or oversized `session_id` -> 400
- recommendation turns without tenant context -> 400
- session tenant mismatch on existing session -> 403

## Session Persistence Model

Session state stores:
- `session_id`, `tenant_id`, `role`
- `chat_history`
- `conversation_memory`
- `recommendation_state`
- `created_at`, `updated_at`

Persistence tables:
- `chat_sessions` (session_data snapshot)
- `chat_messages` (append-only turns)

## `/api/recommend` Notes

- Accepts natural language (`user_message`/`message`) and structured `constraints`.
- Structured constraints currently support `constraints.size`.
- For deterministic tests, pass explicit `constraints.size` and keep message text for style/room intent.
