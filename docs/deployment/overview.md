# Multi-Tenant Deployment Overview

## Model

- Each store uses two Vercel deployments backed by one shared Supabase instance:
- Customer deployment: `retail_customer` (open) + `trade_client` (token entry).
- Staff deployment: `store_staff` + `developer` (token entry).

## Role Entry

- Customer URL (`/`) enters retail experience with no setup.
- Trade role is issued from customer deployment `/join?token=<TRADE_ACCESS_TOKEN>`.
- Staff/developer roles are issued from staff deployment `/join?token=...`.
- `/join` maps token to role server-side, sets signed cookies, then redirects to role portal.
- No passcode gate. Join token is the only hosted access gate.

## Persona Links

- Retail customer: `https://<customer-domain>/`
- Trade/design client: `https://<customer-domain>/join?token=<TRADE_ACCESS_TOKEN>`
- Store staff/owner: `https://<staff-domain>/join?token=<STAFF_ACCESS_TOKEN>`
- Developer: `https://<staff-domain>/join?token=<DEV_ACCESS_TOKEN>`

## Cookie Security

- Role cookie format: `{role}.{hmac}`
- Signature payload: `role:tenantId`
- HMAC algorithm: SHA-256 with `COOKIE_SECRET`
- Role cookie verification is required for API role resolution and server-page role checks.
- Role cookie intentionally remains readable by client JS (`httpOnly: false`) in this phase to avoid breaking existing client-side role-aware UI. Integrity comes from signature verification, not obscurity.

## Tenant Security

- On `customer` and `staff` deployments, `TENANT_ID` is authoritative.
- Request/body tenant IDs are ignored on those deployments.
- On `developer`, tenant can come from request/cookie for local iteration.

## Deployment-Type Responsibilities

- `DEPLOYMENT_TYPE` (server-only): all security decisions.
- `NEXT_PUBLIC_DEPLOYMENT_TYPE` (client): UI behavior only.
- Middleware performs lightweight presence/routing checks only.
- Signature verification and authorization remain in server runtime utilities/routes.

## Customer Role Cap

- Customer deployment allows cookie roles: `retail_customer`, `trade_client`.
- Customer deployment rejects cookie roles: `store_staff`, `developer` (fallback to retail flow).

## Secret Rotation

- Rotating `COOKIE_SECRET` invalidates all existing signed role cookies.
- Expected behavior: users re-enter through their `/join` link (or customer root for retail).
