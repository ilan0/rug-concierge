# Rug Concierge Master Reference

## Product
Rug Concierge is a single-store rug gallery app with three main surfaces:
- `/concierge`: customer chat and inventory-grounded recommendations
- `/inventory`: staff inventory browser and review workflow
- `/intake`: staff rug intake

## Stack
- Next.js 16 monorepo (`apps/web`, `packages/db`)
- TypeScript
- Supabase (database + storage)
- OpenAI
- Tailwind + Radix UI

## Roles And Access
App roles:
- `retail_customer`
- `store_staff`
- `developer`

Staff access is gated by tenant-scoped secrets in `tenants.secrets`:
- `store_passcode` for unlock verification
- `cookie_secret` for the signed `staff_unlocked` cookie
Locked `/inventory` and `/intake` requests redirect to `/concierge`.

Staff-protected inventory routes:
- `POST /api/inventory/intake`
- `GET /api/inventory/rugs/[id]`
- `PATCH /api/inventory/rugs/[id]`
- `DELETE /api/inventory/rugs/[id]`
- `POST /api/inventory/rugs/[id]/re-enrich`

## Tenant Resolution
`TENANT_ID` is the authoritative tenant binding when configured.
Dynamic fallback is disabled.
Tenant scope is enforced on inventory-backed reads and writes.

## Core Runtime Invariants
- Inventory is authoritative. AI never invents rug rows.
- Recommendation candidates come only from tenant inventory.
- Hard filters are enforced server-side before AI ranking.
- `effective_fields` are resolved at read time by overlaying `staff_overrides` onto AI/base fields.
- Retail responses never expose raw `staff_overrides`.

## Core APIs
- `POST /api/chat`: session-aware chat router
- `POST /api/recommend`: recommendation-only route
- `POST /api/inventory/intake`: create rug, upload image, hard-reject exact duplicates, enqueue enrichment
- `POST /api/inventory/enrichment/worker`: cron-secured worker that drains the durable enrichment queue
- `GET /api/inventory/rugs/[id]`: staff rug detail
- `PATCH /api/inventory/rugs/[id]`: staff edits and overrides
- `DELETE /api/inventory/rugs/[id]`: staff delete rug, image row, storage object, and cascading job row
- `POST /api/inventory/rugs/[id]/re-enrich`: set rug back to processing and enqueue a new enrichment job
- `GET /api/rugs/[id]`: retail-safe rug detail; unresolved rugs are hidden
- `POST /api/auth/passcode`, `POST /api/auth/lock`, `POST /api/session/reset`
- `GET /api/config/public`, `GET /api/manifest`

## Chat Router
Rule precedence in `apps/web/lib/chat/router.ts`:
1. `EXPLICIT_RECOMMENDATION_REQUEST`
2. `RECOMMENDATION_FOLLOWUP`
3. `GENERAL_ADVICE_OR_EDUCATION`
4. `AMBIGUOUS_WITH_CONSTRAINTS_ONLY`
5. `DEFAULT_GENERAL_CHAT`

Behavior notes:
- Recommendation followups only trigger when recent recommendation context exists.
- Bare acknowledgements like `ok` do not automatically rerun recommendations.
- Constraint-only phrases without a real recommendation intent route to clarifying general chat.

## Recommendation Pipeline
Implemented in `apps/web/lib/recommend/pipeline.ts`.

Flow:
1. Parse explicit constraints and message-derived constraints
2. Query tenant inventory from Supabase
3. Apply deterministic hard filtering
4. Shape candidates for AI ranking
5. Ask AI to rank/explain within bounded structured output
6. Sanitize and fall back deterministically if needed

Hard constraints remain strict:
- `size`
- `colors`
- `styles`
- `shape`

Closest-size followups widen size only with the ladder:
- `0`, `4`, `8`, `12`, `18`, `24` inches

## Intake And Durable Enrichment
`POST /api/inventory/intake` does all synchronous intake work:
1. Validate dimensions and image payload
2. Resolve authoritative tenant
3. Hash uploaded image bytes with SHA-256
4. Hard-reject exact duplicates with `409 DUPLICATE_IMAGE`
5. Insert the rug row with `enrichment_status = processing`
6. Upload the image to Supabase Storage and insert the `rug_images` row
7. Enqueue one durable enrichment job in `inventory_enrichment_jobs`
8. Return quickly with `ai_status = "processing"`

Duplicate response shape:
- `code: "DUPLICATE_IMAGE"`
- `existing_rug.id`
- `existing_rug.label`

### Enrichment Queue
Durable queue state lives in `inventory_enrichment_jobs`.
The worker route is `POST /api/inventory/enrichment/worker`.
It is protected by `Authorization: Bearer <cron_secret>` loaded from `tenants.secrets`.

Worker behavior:
- claims up to 5 jobs per run
- runs inside a 45 second budget
- retries transient failures up to 3 attempts
- backoff schedule: `60s`, `5m`, `15m`
- reclaims stale `processing` locks older than 10 minutes via `claim_inventory_enrichment_jobs`

### Enrichment Outcomes
Rug-level statuses:
- `processing`
- `ready`
- `needs_review`

Review reason codes:
- `ANALYSIS_INCOMPLETE`
- `ANALYSIS_FAILED`

Job-level states:
- `queued`
- `retry_scheduled`
- `processing`
- `completed`
- `needs_review`

## AI Enrichment Output
Vision enrichment writes:
- `intake_label`
- `ai_description`
- `ai_structured_fields`

Structured fields currently include:
- `origin`
- `style`
- `pattern[]`
- `primary_colors[]`
- `age_category`
- `mood`

## Deterministic Title Construction
Titles are not trusted as freeform AI output.
The primary title source is `buildTradeTitle()` in `apps/web/lib/inventory/title-builder.ts`.

Title construction rules:
- deterministic trade-vocabulary format
- uses age/origin/style/format when meaningful
- excludes generic pattern words as styles
- does not include size
- returns `null` when the structured signal is too weak

When deterministic title generation fails:
- the intake record is marked `needs_review`
- a sanitized fallback label may be preserved for staff context
- unresolved rugs remain hidden from customer-facing detail/recommendation flows

## Inventory Read Model
Staff inventory shows all rugs, including unresolved rows.
Customer-facing flows include only rugs that are both:
- `status = available`
- `enrichment_status = ready`

## Image And Storage Model
- Storage bucket: `rug-images`
- `rug_images.path` stores the object path, not the full URL
- `rug_images.image_sha256` stores the exact uploaded image hash for duplicate detection
- One primary image row is expected per rug in the current intake model

## Key Modules
- role/capability checks: `apps/web/lib/http/guards.ts`
- tenant resolution: `apps/web/lib/auth/tenant.ts`
- chat router: `apps/web/lib/chat/router.ts`
- chat memory: `apps/web/lib/chat/memory.ts`
- recommendation pipeline: `apps/web/lib/recommend/pipeline.ts`
- inventory parsing: `apps/web/lib/inventory/rug-record.ts`
- enrichment queue: `apps/web/lib/inventory/enrichment-jobs.ts`
- title builder: `apps/web/lib/inventory/title-builder.ts`
- vision enrichment: `apps/web/lib/inventory/vision-enrichment.ts`

## Environment Variables
Required runtime variables:
- `TENANT_ID`
- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY`
- `OPENAI_API_KEY`
- `OPENAI_CHAT_MODEL`
- `OPENAI_VISION_MODEL`
- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`
- `ENABLE_GENERAL_CHAT_AI`

Per-tenant secrets are stored in `tenants.secrets` and fetched at runtime in
auth/cron paths only:
- `store_passcode`
- `cookie_secret`
- `cron_secret`

Operational tunables such as OpenAI retry/timeouts, chat memory, and tenant fallback behavior are hardcoded in `apps/web/lib/config.ts`.

Branding source order:
1. `tenants.settings.branding`
2. default `Rug Concierge`

## Scripts
- `scripts/seed-demo-rugs.ts`: seed demo inventory
- `scripts/re-enrich-rugs.ts`: batch re-enrichment for existing rugs
- `scripts/purge-tenant-inventory.ts`: destructive tenant-specific inventory reset
- `scripts/check-docs-drift.mjs`: validates the master doc + runtime prompt doc layout
- `scripts/check-migrations.mjs`: validates expected runtime schema snapshots

## Runtime Prompt Files
These prompt docs are runtime inputs and are intentionally kept under `docs/prompts/`:
- `docs/prompts/system.md`
- `docs/prompts/general-chat.md`
- `docs/prompts/recommendation.md`
- `docs/prompts/recommendation-structured-output.md`

They are loaded by `apps/web/lib/ai/prompt-library.ts`.
