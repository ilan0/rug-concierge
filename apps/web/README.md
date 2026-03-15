# Web App (Next.js)

Primary UI shell for Rug Concierge.

## Routes

- `/`: app entry
- `/concierge`: chat and recommendations
- `/inventory`: tenant inventory view
- `/intake`: inventory intake flow

## API Routes

- `/api/chat`
- `/api/recommend`
- `/api/inventory/intake`
- `/api/inventory/rugs/[id]`
- `/api/inventory/rugs/[id]/re-enrich`
- `/api/rugs/[id]`
- `/api/session/reset`
- `/api/config/public`
- `/api/manifest`
- `/api/auth/passcode`
- `/api/auth/lock`
- `/api/debug/trace`

## Auth Model

- kiosk navigation is always available; concierge is always visible
- staff routes (`/inventory`, `/intake`) require `staff_unlocked` cookie
  - legacy `staff_unlocked=1` works only when `COOKIE_SECRET` is unset
- unlock with `POST /api/auth/passcode`, lock with `POST /api/auth/lock`

## Branding Model

- runtime source order:
  1. tenant settings (`tenants.settings.branding`) for deployment `TENANT_ID`
  2. env fallback (`STORE_NAME`, `STORE_LOGO_URL`)
  3. default `Rug Concierge`

## Styling

- Tailwind CSS
- shadcn/ui components

## Core Docs

- `../../docs/README.md`
- `../../docs/master-context.md`
- `../../docs/deployment/runbook.md`
- `../../docs/testing/README.md`

## Local Run

```bash
npm run dev
```

## Build Validation

```bash
npm --workspace apps/web run lint
npm --workspace apps/web run build
```

## QA (Repo Root)

```bash
TENANT_ID=<tenant-uuid> npm run qa:functional
TENANT_ID=<tenant-uuid> npm run qa:quality
```
