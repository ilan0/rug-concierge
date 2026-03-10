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
- `/api/rugs/[id]`
- `/api/session/reset`
- `/api/config/public`
- `/api/manifest`
- `/api/auth/passcode`
- `/api/auth/lock`
- `/api/debug/trace`

## Auth Model

- kiosk navigation is always available; concierge is always visible
- staff routes (`/inventory`, `/intake`) require `staff_unlocked=1`
- unlock with `POST /api/auth/passcode`, lock with `POST /api/auth/lock`

## Styling

- Tailwind CSS
- shadcn/ui components

## Core Docs

- `../../docs/master-context.md`
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
