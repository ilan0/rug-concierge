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
- Backend enforces hard constraints.
- AI does ranking and explanation only.
- No-match is a valid outcome.
- AI must not invent inventory facts.

Hard constraints (eliminators):
- availability
- budget
- size (with tolerance, rotation allowed)

Soft signals (ranking only):
- style
- palette/color
- room/use-case
- practical needs
- other preference language

## Recommendation Pipeline (v1)

1. Parse request.
2. If required constraints are missing, return `clarifying_question`.
3. Query Supabase with coarse hard-constraint filters.
4. Apply final deterministic filtering in code (tolerance/rotation/null safety).
5. If candidate set is empty, return `no_match`.
6. Else pass candidates to AI for ranking + explanation.
7. Return structured output for UI rendering.

Rules:
- Missing required constraints are checked before any inventory query.
- Supabase query should do coarse filtering (availability/budget/size bounds).
- In-code hard filter still runs after query for exact tolerance + rotation and safety.
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
2. Keep pre-query missing-constraint guard.
3. Implement candidate shaping for AI context.
4. Replace AI stub with OpenAI call using structured output.
5. Validate returned IDs are subset of backend candidate set.
