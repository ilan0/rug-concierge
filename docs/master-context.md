# Rug Concierge Master Context

Canonical runtime source of truth.

## Product Goal

AI concierge for rug showrooms:
- inventory-grounded recommendations
- customer-facing concierge chat
- staff inventory intake
- rug detail enrichment

## Runtime Rules

- Inventory is authoritative.
- Backend owns tenant scoping and access control.
- All inventory DB queries are tenant scoped.
- AI can rank and explain candidates, but cannot invent inventory.
- AI response text must be plain text only.

## Deployment Mode

Single kiosk deployment:
- `STORE_PASSCODE` configures staff unlock
- `staff_unlocked=1` cookie grants staff access
- proxy redirects locked `/inventory` and `/intake` requests to `/concierge`
- intake write API (`POST /api/inventory/intake`) requires unlocked staff cookie
- unlock endpoint: `POST /api/auth/passcode`
- lock endpoint: `POST /api/auth/lock`

## Routes

Pages:
- `/`
- `/concierge`
- `/inventory`
- `/intake`

APIs:
- `/api/chat`
- `/api/recommend`
- `/api/inventory/intake`
- `/api/rugs/[id]`
- `/api/session/reset`
- `/api/config/public`
- `/api/manifest`
- `/api/auth/passcode`
- `/api/auth/lock`
- `/api/debug/trace`

## Role Defaults

- No customer-facing role switcher in UI.
- Concierge requests default to customer tone/behavior.
- Debug trace endpoints remain non-production only.

## Tenant Resolution

Priority for server resolution:
1. `TENANT_ID` env
2. request body `tenant_id`
3. reject request if neither exists for inventory-backed flow

If env `TENANT_ID` is set, it always wins.

## Chat Contract

Entry: `POST /api/chat`

Behavior:
- validates message and optional `session_id`
- validates `session_id` as UUID and length-caps it
- loads or creates session state
- routes turn to general chat or recommendation flow
- persists session and turn messages

Session state shape:
- `session_id`
- `tenant_id`
- `role`
- `chat_history`
- `conversation_memory`
- `recommendation_state`
- `created_at`
- `updated_at`

## Recommendation Pipeline

- hard filtering: availability + size
- candidate rows require primary image URL
- missing-image candidates are dropped and logged server-side with rug id and label
- AI ranking uses `ai_description` as primary content signal
- fallback reason text must be rug-specific; generic filler is disallowed

## Intake and Rug Detail

`POST /api/inventory/intake`:
- writes rug + primary image synchronously
- returns quickly with `ai_status: "processing"`
- launches async vision enrichment for `intake_label` and `ai_description`

`GET /api/rugs/[id]`:
- returns rug, primary image URL, and `size_display`
- generates `contextual_blurb` once if missing, then caches it

## Branding and PWA

`GET /api/config/public` returns:
- `storeName`
- `storeLogoUrl`
- `isPasscodeGated`

`GET /api/manifest` returns dynamic manifest JSON using store branding.

## QA

Canonical suites:
1. `TENANT_ID=<tenant> npm run qa:functional`
2. `TENANT_ID=<tenant> npm run qa:quality`

Output files:
- `scripts/testing/functionality/latest-functional.md`
- `scripts/testing/quality/latest-quality.md`
