# Deployment Environment Variables

## Required For Web Runtime

- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `OPENAI_API_KEY`
- `COOKIE_SECRET`

## Strongly Recommended For Kiosk Deployments

- `TENANT_ID` (authoritative tenant binding)
- `STORE_PASSCODE` (staff unlock gate)

## Branding (Optional)

- `STORE_NAME` (fallback only; tenant settings are authoritative when present)
- `STORE_LOGO_URL` (fallback only)

## Optional Runtime Tunables

- `OPENAI_MODEL`
- `OPENAI_TIMEOUT_MS`
- `OPENAI_RETRY_ATTEMPTS`
- `OPENAI_RETRY_BASE_MS`
- `OPENAI_MAX_OUTPUT_TOKENS_GENERAL_CHAT`
- `OPENAI_MAX_OUTPUT_TOKENS_RECOMMENDATION`
- `ENABLE_GENERAL_CHAT_AI`
- `CHAT_MEMORY_V1`
- `CHAT_PERSISTENCE_FAIL_OPEN`
- `RATE_LIMIT_FAIL_OPEN`
- `ALLOW_DYNAMIC_TENANT_ID`
- `ENABLE_RECOMMENDATION_QA_LOGGING`
- `ENABLE_E2E_TRACE_ARTIFACTS`

## Script/Automation Support

Some scripts accept either admin key name:
- `SUPABASE_SECRET_KEY` or `SUPABASE_SERVICE_ROLE_KEY`

Vercel automation helpers require:
- `VERCEL_TOKEN`
- `VERCEL_TEAM_ID`

## Notes

- `SUPABASE_SECRET_KEY` is required by app runtime (`apps/web/lib/supabase/admin.ts`).
- Runtime branding source order:
  1. `tenants.settings.branding` for deployment `TENANT_ID`
  2. env fallback (`STORE_NAME`, `STORE_LOGO_URL`)
  3. default (`Rug Concierge`)
- Rotating `COOKIE_SECRET` invalidates prior device auth signatures.
