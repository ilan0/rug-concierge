# Deployment Overview

## Model

Each store uses one codebase with tenant-scoped data and two runtime modes:

1. Open concierge mode (`STORE_PASSCODE` unset)
2. Passcode-gated kiosk mode (`STORE_PASSCODE` set)

`TENANT_ID` binds inventory/chat scope per deployment.

## Access Model

- Open mode: requests are allowed without device cookie.
- Passcode mode: middleware requires `rug_device_auth` cookie.
- Passcode unlock endpoint: `POST /api/auth/passcode`.
- Public exceptions in passcode mode:
  - `/api/auth/passcode`
  - `/api/config/public`
  - `/api/manifest`

## Role Semantics

- `retail_customer`: default runtime behavior in open mode.
- `store_staff`: behavior when passcode gate is active and device is unlocked.
- `developer`: local/dev-only role path; no production grant path.

## Cookie Security

`rug_device_auth` cookie:
- value: SHA-256 signature of `device:{tenantId}:unlocked`
- generated with `COOKIE_SECRET`
- `HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/`
- max age: 400 days

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
