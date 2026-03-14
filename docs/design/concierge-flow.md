# Concierge Recommendation Flow

Backend-first, inventory-grounded recommendation architecture.

## Pipeline

1. Parse request and normalize hard constraints.
2. Resolve tenant and query tenant-scoped available rugs.
3. Apply deterministic hard filters (availability + size, with rotation support).
4. Attach primary image URLs; drop missing-image candidates.
5. Resolve effective fields (`ai_structured_fields` + `staff_overrides`).
6. Build AI context and rank candidates.
7. Sanitize output to runtime contract.
8. Return recommendations / clarifying question / no_match.

## Hard Constraints

- tenant scope
- availability
- size bounds

## Soft Ranking Signals

- `ai_description` (primary textual signal)
- effective structured fields (`origin`, `style`, `mood`, `pattern`, `primary_colors`)
- user message semantic cues

Soft signals rank candidates; they do not hard-eliminate candidates.

## No-Match Rule

`no_match` is valid only when candidate set is empty after hard filtering.

## Response Safety

- Recommendation IDs must be subset of backend candidate IDs.
- Mode-specific contracts are enforced (`recommendations`, `clarifying_question`, `no_match`).
- Deterministic fallback response is used when model output is invalid/unavailable.
