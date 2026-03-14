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

- `STORE_NAME` (default: `Rug Concierge`)
- `STORE_LOGO_URL`

## Optional Runtime Tunables

- `OPENAI_MODEL`
- `OPENAI_MAX_OUTPUT_TOKENS_GENERAL_CHAT`
- `OPENAI_MAX_OUTPUT_TOKENS_RECOMMENDATION`
- `ENABLE_GENERAL_CHAT_AI`
- `CHAT_MEMORY_V1`

## Script/Automation Support

Some scripts accept either admin key name:
- `SUPABASE_SECRET_KEY` or `SUPABASE_SERVICE_ROLE_KEY`

Vercel automation helpers require:
- `VERCEL_TOKEN`
- `VERCEL_TEAM_ID`

## Notes

- `SUPABASE_SECRET_KEY` is required by app runtime (`apps/web/lib/supabase/admin.ts`).
- Rotating `COOKIE_SECRET` invalidates prior device auth signatures.
