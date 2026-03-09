# Deployment Environment Variables

`DEPLOYMENT_TYPE` is server-authoritative.  
`NEXT_PUBLIC_DEPLOYMENT_TYPE` is UI-only and must never be used for security decisions.

Do not use legacy Supabase key names (`SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`).

## Shared (All Deployments)

- `DEPLOYMENT_TYPE` = `customer | staff | developer`
- `NEXT_PUBLIC_DEPLOYMENT_TYPE` = `customer | staff | developer`
- `TENANT_ID` (required for customer/staff)
- `NEXT_PUBLIC_TENANT_ID` (same value as `TENANT_ID` on customer/staff)
- `COOKIE_SECRET` (32+ chars; use same value on customer + staff for a store)
- `SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SECRET_KEY`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `OPENAI_API_KEY`
- `OPENAI_MODEL` (optional)
- `OPENAI_MAX_OUTPUT_TOKENS_GENERAL_CHAT` (optional)
- `OPENAI_MAX_OUTPUT_TOKENS_RECOMMENDATION` (optional)
- `OPENAI_MAX_OUTPUT_TOKENS_APPRAISAL` (optional)
- `ENABLE_GENERAL_CHAT_AI` (optional)
- `CHAT_MEMORY_V1` (optional)

## Customer Deployment

- `DEPLOYMENT_TYPE=customer`
- `NEXT_PUBLIC_DEPLOYMENT_TYPE=customer`
- `NEXT_PUBLIC_ENABLE_ROLE_SWITCHER=0`
- `TENANT_ID=<TENANT_UUID>`
- `NEXT_PUBLIC_TENANT_ID=<TENANT_UUID>`
- `TRADE_ACCESS_TOKEN=<TRADE_ACCESS_TOKEN>`
- `COOKIE_SECRET=<COOKIE_SECRET>`
- `SUPABASE_URL=<SUPABASE_URL>`
- `NEXT_PUBLIC_SUPABASE_URL=<NEXT_PUBLIC_SUPABASE_URL>`
- `SUPABASE_SECRET_KEY=<SUPABASE_SECRET_KEY>`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY>`
- `OPENAI_API_KEY=<OPENAI_API_KEY>`

## Staff Deployment

- `DEPLOYMENT_TYPE=staff`
- `NEXT_PUBLIC_DEPLOYMENT_TYPE=staff`
- `NEXT_PUBLIC_ENABLE_ROLE_SWITCHER=0`
- `TENANT_ID=<TENANT_UUID>`
- `NEXT_PUBLIC_TENANT_ID=<TENANT_UUID>`
- `STAFF_ACCESS_TOKEN=<STAFF_ACCESS_TOKEN>`
- `DEV_ACCESS_TOKEN=<DEV_ACCESS_TOKEN>`
- `COOKIE_SECRET=<COOKIE_SECRET>` (same value as customer deployment for that store)
- `SUPABASE_URL=<SUPABASE_URL>`
- `NEXT_PUBLIC_SUPABASE_URL=<NEXT_PUBLIC_SUPABASE_URL>`
- `SUPABASE_SECRET_KEY=<SUPABASE_SECRET_KEY>`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY>`
- `OPENAI_API_KEY=<OPENAI_API_KEY>`

## Developer / Local

- `DEPLOYMENT_TYPE=developer`
- `NEXT_PUBLIC_DEPLOYMENT_TYPE=developer`
- `NEXT_PUBLIC_ENABLE_ROLE_SWITCHER=1`
- `TENANT_ID` optional
- `NEXT_PUBLIC_TENANT_ID` optional
- `STAFF_ACCESS_TOKEN` optional
- `TRADE_ACCESS_TOKEN` optional
- `DEV_ACCESS_TOKEN` optional
- `NEXT_PUBLIC_PILOT_DEFAULT_ROLE` optional

## QA / CI Only

- `QA_MODE=1`
- `RECOMMENDATION_QA_LOG_PATH` optional

## Notes

- Generate tokens/secrets with `openssl rand -hex 32`.
- Keep real token/secret values out of committed files.
- Rotating `COOKIE_SECRET` logs out all current sessions (signed cookie invalidation by design).
