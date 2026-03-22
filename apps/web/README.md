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
- `/api/inventory/enrichment/worker`
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

- concierge is always available
- staff route tabs are hidden in locked mode and shown only after unlock
- staff routes (`/inventory`, `/intake`) require `staff_unlocked` cookie
- unlock with `POST /api/auth/passcode`, lock with `POST /api/auth/lock`

## Core Docs

- `../../docs/master.md`

## Local Run

```bash
npm run dev
```

## Build Validation

```bash
npm --workspace apps/web exec tsc --noEmit
npm --workspace apps/web run lint
npm --workspace apps/web run build
```
