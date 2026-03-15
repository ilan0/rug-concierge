# Architecture Flow

Canonical architecture reference for chat orchestration, recommendation flow, and role capability behavior.

## Entrypoints

- `POST /api/chat` (session-aware router)
- `POST /api/recommend` (recommendation-only route)
- `GET|PATCH /api/inventory/rugs/[id]` (staff detail + overrides)
- `POST /api/inventory/rugs/[id]/re-enrich` (staff re-analysis)
- `GET /api/rugs/[id]` (retail-safe rug detail)

## Chat + Recommendation Orchestration

1. Validate request payload and resolve role capability.
2. Resolve authoritative tenant context.
3. For `/api/chat`: load/create session, update recommendation state, route mode.
4. For recommendation mode: run inventory-grounded pipeline.
5. Persist session snapshot + turn history.
6. Return deterministic mode envelope (`general_chat`, `recommendation`, `clarifying_question`, `no_match`).

## Recommendation Pipeline

1. Parse/merge constraints from explicit payload + user text.
2. SQL candidate query (tenant + availability + optional size filters).
3. Deterministic hard-constraint filter.
4. Candidate shaping for bounded AI input.
5. AI rank/explain with strict output contract.
6. Sanitize response (candidate ID subset, field grounding, capped output).
7. Deterministic fallback when model output is invalid/unavailable.

## Role Capability Matrix

| Role | chat.general | chat.recommend | inventory.read | inventory.intake | debug.trace.read | debug.trace.capture |
| --- | --- | --- | --- | --- | --- | --- |
| `retail_customer` | yes | yes | no | no | no | no |
| `store_staff` | yes | yes | yes | yes | yes | yes |
| `developer` | yes | yes | yes | yes | yes | yes |

Runtime references:
- `apps/web/lib/auth/roles.ts`
- `apps/web/lib/auth/capabilities.ts`
- `apps/web/lib/http/guards.ts`

## Contracts and Safety Invariants

- Inventory is authoritative; recommendation IDs must come from backend candidate set.
- Hard constraints are enforced server-side before AI ranking.
- `effective_fields` are resolved at read time (`ai_structured_fields` overlaid by `staff_overrides`).
- Retail detail responses must not expose raw `staff_overrides`.
- Session tenant mismatch is denied.

