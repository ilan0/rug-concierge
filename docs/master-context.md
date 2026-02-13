# Rug Concierge Master Context

This file is the source of truth for starting a fresh chat.

## Product

Build an AI Rug Concierge for independent rug stores that:
- recommends rugs from real inventory
- supports retail + trade workflows
- drafts appraisal text for internal review

Primary objective: trust and correctness over aggressive recommendations.

## Non-Negotiables

- Inventory is the source of truth.
- Backend enforces active hard constraints.
- AI does ranking and explanation only.
- No-match is a valid outcome.
- AI must not invent inventory facts.
- User messages are routed through backend first (not directly to AI).

## Chat Routing Contract (v1)

- UI sends user messages to backend.
- Backend decides mode:
  - `general_chat` for education/care/policy conversation
  - `recommendation` for inventory matching requests
- In `general_chat`, backend returns freeform assistant text.
- In `recommendation`, backend runs the recommendation pipeline and returns structured output.
- If intent is unclear, backend asks clarifying question(s) before recommendation.

Hard constraints (eliminators):
- availability (always)
- budget (when provided)
- size (when provided, with tolerance and rotation)

Soft signals (ranking only):
- style
- palette/color
- room/use-case
- practical needs
- other preference language

## Recommendation Pipeline (v1)

1. Parse request.
2. Extract any stated constraints (from explicit fields and/or user text).
3. Query Supabase with coarse hard-constraint filters.
4. Apply final deterministic filtering in code (availability + optional budget/size).
5. Shape candidate set for AI context (bounded + varied).
6. If candidate set is empty, return `no_match`.
7. Else pass candidates to AI for ranking + explanation.
8. Return structured output for UI rendering.

Rules:
- Browse without size/budget is valid.
- Supabase query is SQL-first and should apply active hard constraints before AI.
- In-code hard filter still runs after query for exact tolerance + rotation + safety.
- Candidate set sent to AI should be bounded (roughly 20-30) and deterministically ordered.
- No-match is only when backend candidate set is empty.

## OpenAI Direction
- Do not use vector store / RAG for inventory recommendations.
- Use DB-filtered candidates as model context.
- Use structured output schema for deterministic responses.

## Architecture Choices (Current)

- Next.js App Router + TypeScript
- Supabase (Postgres + Auth + Storage)
- Vercel target hosting
- Single monorepo
- Multi-tenant with `tenant_id` + RLS model

## Data Model Direction

Core entities are defined in the schema docs (`tenants`, `profiles`, `trade_clients`, `rugs`, `rug_images`, `appraisals`).
Trade client preferences are workflow/presentation context, not modeled as aesthetic taste rules.

## Near-Term Implementation Priorities

1. Wire Supabase query in recommendation route.
2. Support optional constraints (browse + constrained search in one flow).
3. Keep candidate shaping simple (cap + deterministic order) for V1.
4. Replace AI stub with OpenAI call using structured output.
5. Validate returned IDs are subset of backend candidate set.
