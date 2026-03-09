# Rug Concierge Master Context

Canonical source of truth for current runtime behavior.

## Product Goal

AI Rug Concierge for independent rug stores:
- inventory-grounded recommendations
- retail and trade conversation workflows
- staff appraisal drafting
- fast staff inventory intake

## Non-Negotiables

- Inventory is source of truth.
- Backend owns auth, tenant scoping, routing, and hard filtering.
- AI ranks/explains only after backend candidate selection.
- No fabricated inventory facts.
- Tenant isolation is mandatory for inventory-backed routes.

## Runtime Surfaces

UI routes:
- `/`
- `/concierge`
- `/trade`
- `/inventory`
- `/intake`
- `/appraisal`

API routes:
- `/api/chat`
- `/api/recommend`
- `/api/inventory/intake`
- `/api/appraisal/generate`
- `/api/appraisal/rugs`
- `/api/appraisal/drafts`
- `/api/debug/trace`
- `/api/ui-role`
- `/api/ui-access`

## Roles and Capabilities

Roles:
- `retail_customer`
- `trade_client`
- `store_staff`
- `developer`

Policy source files:
- `apps/web/lib/auth/roles.ts`
- `apps/web/lib/auth/capabilities.ts`
- `apps/web/lib/auth/policy.ts`
- `apps/web/lib/auth/request-role.ts`

Auth rules:
- cookie role first, request role second
- cookie/request mismatch -> `403`
- privileged roles require cookie-resolved role
- `role` is canonical request field (`user_role` compatibility alias only)

## Inventory Intake (V1)

- UI: `/intake` (`store_staff`, `developer`)
- API: `POST /api/inventory/intake` (`multipart/form-data`)
- Capability: `inventory.intake`

Required fields:
- image
- `intake_label`
- width feet/inches
- length feet/inches
- tenant context

Defaults on create:
- `status = "available"`
- `price = null`
- `sale_price = null`

Budget policy:
- if both sale/list prices are null, rug is treated as `0` for budget filtering

Image writes:
- storage upload to `rug-images`
- primary `rug_images` row (`is_primary=true`, `sort_order=0`)
- compensating rollback on downstream failure

## Chat Orchestration

Entry: `POST /api/chat`

Turn flow:
1. validate request
2. resolve/enforce role
3. resolve tenant context
4. load/create session
5. update recommendation/trade/project context
6. route mode (`general_chat` or `recommendation`)
7. run handler
8. persist session
9. return envelope

Mode semantics:
- `mode`: coarse mode
- `fine_mode`: specific outcome (`general_chat`, `recommendation`, `clarifying_question`, `no_match`)

Session rules:
- constraints remain sticky until changed/cleared
- reset intents supported for budget and size
- tenant mismatch on reused session id -> `403`

## Recommendation Pipeline

Used by `/api/recommend` and recommendation turns in `/api/chat`.

Flow:
1. merge explicit + inferred constraints
2. validate tenant scope
3. SQL-first query
4. deterministic hard filter pass
5. candidate shaping
6. `no_match` if empty
7. AI rank/explain if non-empty
8. deterministic post-processing

Hard constraints:
- availability
- tenant scope
- budget (if provided)
- size (if provided; tolerance + rotation)

## Appraisal Flow

Appraisal is dedicated API/page workflow, not chat mode.

Endpoints:
- `POST /api/appraisal/generate`
- `GET /api/appraisal/rugs`
- `GET /api/appraisal/drafts`
- `POST /api/appraisal/drafts`

Rules:
- roles: `store_staff`, `developer`
- AI output is draft text for human review
- finalized records are locked from edits/regeneration

## QA and Testing

Canonical suites:
1. `TENANT_ID=<tenant> npm run qa:functional`
2. `TENANT_ID=<tenant> npm run qa:quality`

Notes:
- Functional and quality are the only canonical QA suites.

Latest output files:
- `scripts/testing/functionality/latest-functional.md`
- `scripts/testing/quality/latest-quality.md`

## Minimal Doc Set

Use only:
1. `docs/master-context.md`
2. `docs/testing/README.md`
3. relevant design/data/prompt file from `docs/`
