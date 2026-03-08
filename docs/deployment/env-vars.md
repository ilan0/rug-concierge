# Deployment Environment Variables

`DEPLOYMENT_TYPE` is the server-authoritative deployment mode.
`NEXT_PUBLIC_DEPLOYMENT_TYPE` is UI-only and must never be used for security decisions.

## Shared (All Deployments)

- `DEPLOYMENT_TYPE` = `customer | staff | developer` (server-only, required in production)
- `NEXT_PUBLIC_DEPLOYMENT_TYPE` = `customer | staff | developer` (client-visible UI hint)
- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `OPENAI_API_KEY`
- `OPENAI_MODEL` (optional, defaults to `gpt-4.1-nano`)
- `OPENAI_MAX_OUTPUT_TOKENS_GENERAL_CHAT` (optional)
- `OPENAI_MAX_OUTPUT_TOKENS_RECOMMENDATION` (optional)
- `OPENAI_MAX_OUTPUT_TOKENS_APPRAISAL` (optional)
- `COOKIE_SECRET` (required in production, 32+ chars)
- `ENABLE_GENERAL_CHAT_AI` (optional, defaults enabled)
- `CHAT_MEMORY_V1` (optional, defaults enabled)

## Tenant Scoping

- `TENANT_ID` (required on `customer` and `staff`; authoritative tenant on server)
- `NEXT_PUBLIC_TENANT_ID` (same tenant, client-visible convenience value)

## Customer Deployment

- `DEPLOYMENT_TYPE=customer`
- `NEXT_PUBLIC_DEPLOYMENT_TYPE=customer`
- `NEXT_PUBLIC_ENABLE_ROLE_SWITCHER=0`
- `TENANT_ID` required
- `NEXT_PUBLIC_TENANT_ID` required
- No access tokens required
- No pilot passcode required

## Staff Deployment

- `DEPLOYMENT_TYPE=staff`
- `NEXT_PUBLIC_DEPLOYMENT_TYPE=staff`
- `NEXT_PUBLIC_ENABLE_ROLE_SWITCHER=0`
- `TENANT_ID` required
- `NEXT_PUBLIC_TENANT_ID` required
- `PILOT_ACCESS_PASSCODE` (required for passcode gate)
- `STAFF_ACCESS_TOKEN` (32-char hex)
- `TRADE_ACCESS_TOKEN` (32-char hex)
- `DEV_ACCESS_TOKEN` (32-char hex, optional but recommended for owner/dev support)

## Developer / Local

- `DEPLOYMENT_TYPE=developer`
- `NEXT_PUBLIC_DEPLOYMENT_TYPE=developer`
- `NEXT_PUBLIC_ENABLE_ROLE_SWITCHER=1`
- `NEXT_PUBLIC_ENABLE_DEVELOPER_ROLE` (optional UI toggle)
- `NEXT_PUBLIC_PILOT_DEFAULT_ROLE` (optional default home-screen role)
- `TENANT_ID` optional
- Tokens optional
- `PILOT_ACCESS_PASSCODE` optional

## QA / CI Only

- `QA_MODE` (set to `1` in QA harnesses only)
- `RECOMMENDATION_QA_LOG_PATH` (optional artifact path)

## Notes

- Use `openssl rand -hex 32` for `COOKIE_SECRET` and access tokens.
- Access tokens are secrets: never commit, never log, never return in API responses.
- `SUPABASE_SECRET_KEY` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` are canonical for this repo.
- Rotating `COOKIE_SECRET` invalidates all existing signed role cookies and forces re-entry via `/join`.
