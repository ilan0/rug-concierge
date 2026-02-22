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
- AI ranks and explains only after backend candidate selection.
- No-match is a valid outcome.
- AI must not invent inventory facts.
- User messages are routed through backend first (not directly to AI).

## Chat Routing Contract (v1)

- UI sends user messages to backend.
- Backend decides mode:
  - `general_chat` for education/care/policy conversation
  - `recommendation` for inventory matching requests
  - `appraisal` for appraisal draft generation requests (store staff only)
- In `general_chat`, backend returns freeform assistant text.
- In `recommendation`, backend runs the recommendation pipeline and returns structured output.
- In `appraisal`, backend enforces role access (`store_staff`) and returns structured appraisal draft output.
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

## Recommendation Pipeline (Current)

1. Parse request.
2. Extract any stated constraints (from explicit fields and/or user text).
3. Query Supabase with SQL-first hard-constraint filters.
4. Apply final deterministic filtering in code (availability + optional budget/size).
5. Shape candidate set for AI context (bounded + deterministic cap).
6. If candidate set is empty, return `no_match`.
7. Else pass candidates to AI for ranking + explanation.
8. Run deterministic backend post-processing on AI output:
   - grounded `match_reasons`
   - deterministic `confidence`
   - `confidence_tier` + `confidence_factors`
   - `why_not` objection-handling notes
9. Return structured output for UI rendering.

Rules:
- Browse without size/budget is valid.
- Supabase query is SQL-first and applies active hard constraints before AI.
- In-code hard filter still runs after query for exact tolerance + rotation + safety.
- Candidate set sent to AI should be bounded (roughly 20-30) and deterministically ordered.
- No-match is only when backend candidate set is empty.
- `/api/chat` recommendation turns and `/api/recommend` both use the same shared backend pipeline.

## OpenAI Direction
- Do not use vector store / RAG for inventory recommendations.
- Use DB-filtered candidates as model context.
- Use structured output schema for deterministic responses.
- Runtime recommendation prompt layers are sourced from official docs prompts:
  - `docs/prompts/system.md`
  - `docs/prompts/recommendation.md`
  - `docs/prompts/recommendation-structured-output.md`
  - `docs/prompts/trade-support.md` (trade role only)

## Architecture Choices (Current)

- Next.js App Router + TypeScript
- Supabase (Postgres + Auth + Storage)
- Vercel target hosting
- Single monorepo
- Multi-tenant with `tenant_id` + RLS model
- Shared recommendation pipeline module powers both chat and recommendation routes.
- Session state includes:
  - recommendation constraints
  - trade context (preferences + trade client identity metadata)
  - project context (multi-room workflow with active room)

## Data Model Direction

Core entities are defined in the schema docs (`tenants`, `profiles`, `trade_clients`, `rugs`, `rug_images`, `appraisals`).
Trade client preferences are workflow/presentation context, not modeled as aesthetic taste rules.

## Reliability / UX Baseline (Current)

1. Input validation and friendly 400 responses for bad/empty requests.
2. Error handling with stable error codes and non-crashing fallback paths.
3. Deterministic fallback responses when OpenAI is unavailable or invalid.
4. QA logging for recommendation pipeline events.
5. Smoke/integration tests covering request validation, recommendation contract, trade/project context, and appraisal access control.

## Structured Output Enforcement (Current)

- Prompt instructions are guidance; API `json_schema` with `strict: true` is the hard contract.
- Backend applies mode-specific normalization after model output:
  - `clarifying_question` -> recommendations forced empty, 1-2 questions.
  - `no_match` -> recommendations forced empty, max 1 question.
  - `recommendations` -> recommendations bounded and questions cleared.
- Backend sanitization also re-grounds recommendation fields against candidate inventory (IDs, confidence, reasons, caveats).

## Testing Artifacts (Current)

- Smoke run outputs:
  - human report: `docs/testing/e2e-smoke-report.md`
  - machine report: `docs/testing/e2e-smoke-report.json`
  - deep trace artifacts: `docs/testing/artifacts/<run-id>/<case-slug>/*.json`
- Deep artifacts include:
  - flow path/function trace
  - Supabase query variants + filters + row counts
  - exact AI request payload and raw/parsed response
  - timing breakdown and fallback/error signals
