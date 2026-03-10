# Concierge Flow

Recommendation flow is backend-first and inventory-grounded.

## Entry Contract

- Chat messages are processed by backend first.
- Router decides `general_chat` or `recommendation`.
- Recommendation execution requires tenant context.
- Ambiguous intent can return one clarifying question.

## Recommendation Pipeline

1. Parse request and merge constraints.
2. Query tenant-scoped available inventory.
3. Apply deterministic hard filters (size/availability).
4. Drop candidates with missing primary image URL and log warning.
5. Build AI context payload from candidate rugs.
6. Rank candidates and generate reasons.
7. Sanitize response to contract.

## Hard Constraints

- availability
- size (including rotation)
- tenant scope

## Soft Signals

- cues found in `ai_description`
- user intent language
- room/aesthetic preference hints

Soft signals rank; they do not hard-eliminate candidates.

## Browse Behavior

Without explicit size constraints, backend still enforces tenant + availability and returns best available candidates.

## Prompt Rules

- use `ai_description` as primary fit signal
- reasons must be rug-specific
- all response text must be plain text only

## No-Match Rule

`no_match` is returned only when candidate set is empty after hard filtering.
