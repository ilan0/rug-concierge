# Rug Concierge Master Context

Canonical runtime summary for the current production code.

## Product

AI rug concierge for single-store kiosk deployments:
- customer chat (`/concierge`)
- staff inventory browser (`/inventory`)
- staff intake (`/intake`)
- inventory-grounded recommendations

## Runtime Invariants

- Inventory is authoritative. AI never invents inventory rows.
- Tenant scope is enforced on all inventory-backed DB reads/writes.
- Recommendation hard filters are backend-enforced (availability + size).
- Response strings are plain text only.
- `contextual_blurb` is removed from runtime and API contracts.

## Access Model

- `STORE_PASSCODE` enables staff unlock mode.
- Staff unlock cookie: `staff_unlocked=1` (`HttpOnly`, `SameSite=Lax`, `Secure` in prod).
- Locked `/inventory` and `/intake` requests are redirected to `/concierge`.
- Staff-protected endpoints require unlocked cookie:
  - `POST /api/inventory/intake`
  - `GET|PATCH /api/inventory/rugs/[id]`
  - `POST /api/inventory/rugs/[id]/re-enrich`

## Tenant Resolution

Server-side priority:
1. deployment env `TENANT_ID`
2. request `tenant_id` (fallback)
3. reject inventory-backed flow if still missing

When env `TENANT_ID` is set, it is authoritative.

## Core APIs

- `POST /api/chat` (chat router + session persistence)
- `POST /api/recommend` (recommendation-only deterministic route)
- `POST /api/inventory/intake` (async enrichment kickoff)
- `GET /api/rugs/[id]` (retail-safe detail response)
- `GET|PATCH /api/inventory/rugs/[id]` (staff detail + overrides)
- `POST /api/inventory/rugs/[id]/re-enrich` (staff manual re-analysis)
- `POST /api/session/reset`
- `POST /api/auth/passcode`, `POST /api/auth/lock`
- `GET /api/config/public`, `GET /api/manifest`

## Intake + Enrichment

`POST /api/inventory/intake`:
- writes rug row + image row synchronously
- returns quickly with `ai_status: "processing"`
- runs vision enrichment in background

Enrichment writes:
- `intake_label` (3-6 words, no dimensions)
- `ai_description` (1-2 sentences)
- `ai_structured_fields` (`origin`, `style`, `pattern[]`, `primary_colors[]`, `age_category`, `mood`)

On enrichment failure:
- `intake_label` falls back to `Rug {id6}`
- `ai_description = null`
- `ai_structured_fields = null`

## Recommendation Pipeline

- SQL candidate query (tenant + availability + optional size bounds)
- deterministic hard filtering in backend
- candidate shaping for bounded AI input
- AI ranking/explanations with strict JSON schema output
- sanitizer and deterministic fallback behavior

Signals used:
- `ai_description` (primary textual relevance)
- merged effective structured fields (`origin/style/mood/pattern/colors`)
- user message soft-signal matching

## Field Resolution

Effective display fields are resolved at read time:
- base: `intake_label` + `ai_structured_fields`
- overlay: `staff_overrides`
- merge helper: `resolveEffectiveFields()`

## Scripts

- `scripts/re-enrich-rugs.ts`: batch vision enrichment for existing rugs
- `scripts/seed-demo-rugs.ts`: seed 8 demo rugs + storage objects (idempotent by `stock_id`)
- `scripts/verify-api-contracts.ts`: production contract + behavior checks, writes
  `tmp/release-validation/overnight-phase2-report.json`

## QA Entrypoints

- `npm run qa:functional`
- `npm run qa:quality`
- `npm run qa:all`
