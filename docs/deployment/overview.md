# Deployment Overview

## Model

Each store uses one kiosk deployment with tenant-scoped data.
`STORE_PASSCODE` unlocks staff routes and actions.

`TENANT_ID` binds inventory/chat scope per deployment.

## Access Model

- Concierge is always accessible.
- Staff routes (`/inventory`, `/intake`) require `staff_unlocked=1`.
- Locked requests to staff routes are redirected to `/concierge`.
- Staff unlock endpoint: `POST /api/auth/passcode`.
- Staff lock endpoint: `POST /api/auth/lock`.
- Intake write endpoint (`POST /api/inventory/intake`) requires staff unlock.

## Cookie Security

`staff_unlocked` cookie:
- value: `1` when unlocked
- `HttpOnly`, `Secure` (prod), `SameSite=Lax`, `Path=/`
- session cookie (cleared on browser close unless explicitly locked first)

## Tenant Safety

`TENANT_ID` from env is authoritative when set.
Request `tenant_id` is accepted only as fallback when env tenant is not set.

## Branding

Branding config is runtime-driven:
- `STORE_NAME`
- `STORE_LOGO_URL`

Consumed by:
- `GET /api/config/public`
- `GET /api/manifest`
