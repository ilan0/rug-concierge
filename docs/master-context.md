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
- Store branding is tenant-owned (`tenants.settings.branding`) with env fallback.
- Recommendation hard filters are backend-enforced (availability + `size/colors/styles/shape`).
- Response strings are plain text only.

## Access Model

- `STORE_PASSCODE` enables staff unlock mode.
- Staff unlock cookie: `staff_unlocked=<derived-token>` (`HttpOnly`, `SameSite=Lax`, `Secure` in prod).
  - Legacy fallback remains `staff_unlocked=1` when `COOKIE_SECRET` is not configured.
- Locked `/inventory` and `/intake` requests are redirected to `/concierge`.
- Staff-protected endpoints require unlocked cookie:
  - `POST /api/inventory/intake`
  - `GET|PATCH /api/inventory/rugs/[id]`
  - `POST /api/inventory/rugs/[id]/re-enrich`

## Tenant Resolution

Server-side priority:
1. deployment env `TENANT_ID`
2. request/cookie `tenant_id` fallback only when dynamic resolution is allowed
3. reject inventory-backed flow if still missing

When env `TENANT_ID` is set, it is authoritative. In production, dynamic fallback is disabled by default unless `ALLOW_DYNAMIC_TENANT_ID=1`.

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

## Source Of Truth Map

| Contract Surface | Canonical Code Module |
| --- | --- |
| Role capability checks | `apps/web/lib/http/guards.ts` |
| Request role normalization | `apps/web/lib/auth/request-role.ts` |
| Tenant resolution | `apps/web/lib/auth/tenant.ts` |
| Tenant branding resolution | `apps/web/lib/branding/tenant-branding.ts` |
| Inventory row parsing/shape | `apps/web/lib/inventory/rug-record.ts` |
| Inventory filter normalization | `apps/web/lib/inventory/filters.ts` |
| Recommendation orchestration | `apps/web/lib/recommend/pipeline.ts` |
| Recommendation output shaping | `apps/web/lib/ai/recommend.ts` |
| Shared route validation | `apps/web/lib/http/route-validation.ts` |

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

Constraint policy:
- hard: `size`, `colors`, `styles`, `shape`
- soft only: `room`, `material`
- explicit closest follow-up widens size with ladder `0/4/8/12/18/24` only
- non-size hard constraints are never auto-relaxed

## Field Resolution

Effective display fields are resolved at read time:
- base: `intake_label` + `ai_structured_fields`
- overlay: `staff_overrides`
- merge helper: `resolveEffectiveFields()`

## Scripts

- `scripts/re-enrich-rugs.ts`: batch vision enrichment for existing rugs
- `scripts/seed-demo-rugs.ts`: seed 8 demo rugs + storage objects (idempotent by `stock_id`)
- validation checks run operationally via ad hoc shell/browser walkthroughs; no saved QA harness scripts in repo

## Quality Entrypoint

- `npm run quality:release`
