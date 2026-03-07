# Concierge Flow (v1)

Recommendation flow is backend-first and inventory-grounded.

## Entry Contract

- All chat messages go to backend first.
- Router decides whether the turn is:
  - `general_chat`
  - `recommendation`
- This flow applies only to recommendation turns.
- Recommendation execution requires tenant context.
  - `/api/recommend`: `tenant_id` is required in request.
  - `/api/chat`: recommendation turns use request `tenant_id` or an existing session-bound tenant.
- If intent is ambiguous, backend returns a clarifying question before running recommendation.

## Recommendation Pipeline (Current)

1. Parse request body and merge constraints:
   - explicit constraints from request
   - inferred hard constraints from message text
   - session/project context where applicable
2. SQL-first Supabase query with active hard constraints.
3. Deterministic in-code hard check pass (safety + tolerance + rotation).
4. Candidate shaping (bounded deterministic set).
5. If no candidates -> `no_match`.
6. If candidates exist -> AI ranking/explanation over candidate set only.
7. Backend sanitizes and normalizes AI output to strict schema.
8. Backend applies deterministic confidence and `why_not` fields.

## Hard Constraints (Eliminators)

- availability (always)
- size (when provided, with tolerance and rotation support)
- budget (when provided; sale/list logic handled in pipeline)
  - intake policy: when both sale/list price are missing, candidate is treated as `$0` for budget filtering
- tenant_id scoping (always)

## Soft Signals (Ranking Only)

- style
- palette/color
- room/use-case
- practical preference language
- trade preferences

Soft signals never remove candidates.

## Browse Behavior (No Size/Budget)

- Recommendation mode is still valid.
- Backend still enforces availability.
- Candidate set is built for variety and passed to AI for ranking/explanation.
- Optional clarifying question can follow if useful.

## Prompt Layering (Recommendation Mode)

Runtime layer order:
1. system prompt (`docs/prompts/system.md`)
2. recommendation task prompt (`docs/prompts/recommendation.md`)
3. structured-output guidance prompt (`docs/prompts/recommendation-structured-output.md`)
4. optional trade-support prompt (`docs/prompts/trade-support.md`) for trade role
5. optional trade preferences context block
6. inventory candidate context block
7. latest user request block (with hard constraints + project context snapshot)

Important:
- API-level JSON schema (`strict: true`) is the hard response contract.
- Prompt structured-output instructions are guidance, not the enforcement mechanism.

## Output Contract

Recommendation endpoint output modes:
- `recommendations`
- `clarifying_question`
- `no_match`

Chat route maps recommendation output for chat UI response handling while preserving recommendation state.

## No-Match Rule

`no_match` is returned only when backend candidate set is empty after hard filtering.
The response explains the limiting factor and can include at most one follow-up question.

## Tenant Safety Rule

- Recommendation requests never run against cross-tenant inventory.
- Session tenant mismatch is rejected with `403`.
