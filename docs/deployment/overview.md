# Multi-Tenant Deployment Overview

## Model

- Each store uses two Vercel deployments backed by one shared Supabase instance:
- Customer deployment: public concierge entry.
- Staff deployment: passcode + signed-token role entry.

## Role Entry

- Customer deployment auto-enters `retail_customer`.
- Staff/trade/developer roles are issued only through `/join?token=...`.
- `/join` maps token to role server-side, sets signed cookies, then redirects to role portal.

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
