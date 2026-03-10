# Chat Orchestration

## Entry Point

- `apps/web/app/api/chat/route.ts`

Turn flow:
1. validate request body
2. resolve tenant
3. validate or create `session_id`
4. load/create session
5. route mode (`general_chat` or `recommendation`)
6. run selected handler
7. persist session and messages
8. return response envelope

## Request Contract

Accepted fields:
- `message`
- `session_id` (optional UUID)
- `tenant_id` (optional fallback)
- `constraints` (optional)

Validation rules:
- malformed `session_id` returns `400`
- oversized `session_id` returns `400`
- inventory-backed turns without tenant context return `400`

## Session State

Session data fields:
- `session_id`
- `tenant_id`
- `role`
- `chat_history`
- `conversation_memory`
- `recommendation_state`
- `created_at`
- `updated_at`

## Mode Routing

- explicit shopping intent -> recommendation
- educational/general questions -> general chat
- follow-up shopping turns can remain in recommendation

## Recommendation Handler

- calls shared recommendation pipeline
- never invents inventory items
- emits plain text responses only

## General Chat Handler

- answers non-inventory questions
- can prompt user to request recommendations
- emits plain text responses only

## Observability

- optional trace headers for chat and recommendation
- recommendation QA logs include candidate counts and selected rug IDs
