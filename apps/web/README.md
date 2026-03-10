# Web App (Next.js)

Primary UI shell for Rug Concierge.

## Routes

- `/`: app entry
- `/concierge`: chat and recommendations
- `/inventory`: tenant inventory view
- `/intake`: inventory intake flow
- `/passcode`: kiosk unlock page

## API Routes

- `/api/chat`
- `/api/recommend`
- `/api/inventory/intake`
- `/api/rugs/[id]`
- `/api/session/reset`
- `/api/config/public`
- `/api/manifest`
- `/api/auth/passcode`
- `/api/debug/trace`

## Auth Model

- if `STORE_PASSCODE` is unset, app runs open
- if `STORE_PASSCODE` is set, middleware enforces `rug_device_auth` cookie

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
