# Deployment Environment Variables

## Required (all deployments)

- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `OPENAI_API_KEY`
- `COOKIE_SECRET`

## Tenant and Branding

- `TENANT_ID` (recommended; authoritative when set)
- `STORE_NAME` (optional, defaults to `Rug Concierge`)
- `STORE_LOGO_URL` (optional)

## Access Control

- `STORE_PASSCODE` (optional)
  - unset: open mode
  - set: passcode-gated mode

## Optional Runtime Tunables

- `OPENAI_MODEL`
- `OPENAI_MAX_OUTPUT_TOKENS_GENERAL_CHAT`
- `OPENAI_MAX_OUTPUT_TOKENS_RECOMMENDATION`
- `ENABLE_GENERAL_CHAT_AI`
- `CHAT_MEMORY_V1`

## QA / CI

- `RECOMMENDATION_QA_LOG_PATH` (optional)

## Notes

- `COOKIE_SECRET` should be 32+ random characters.
- rotating `COOKIE_SECRET` invalidates prior device cookies.
