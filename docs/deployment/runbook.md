# Deployment Runbook

## 1. Prepare Tenant

1. Create or verify tenant row in Supabase.
2. Capture tenant UUID.
3. Set `TENANT_ID` on deployment.

## 2. Configure Env Vars

Set required vars from `docs/deployment/env-vars.md`.

Choose one mode:
- Open mode: do not set `STORE_PASSCODE`.
- Kiosk mode: set `STORE_PASSCODE` to a 4-digit value.

## 3. Deploy

1. Deploy app.
2. Verify health routes:
   - `GET /api/config/public` returns 200
   - `GET /api/manifest` returns 200

## 4. Smoke Tests (Open Mode)

1. `POST /api/chat` returns 200.
2. `POST /api/auth/passcode` returns 404.
3. `/` and `/concierge` load without auth.

## 5. Smoke Tests (Kiosk Mode)

1. `POST /api/chat` without cookie returns 401.
2. `POST /api/auth/passcode` with wrong code returns 401 and decrements attempts.
3. `POST /api/auth/passcode` with correct code returns 200 and sets `rug_device_auth`.
4. `POST /api/chat` with cookie returns 200.
5. page route access without cookie redirects to `/passcode`.

## 6. Intake + Detail Check

1. `POST /api/inventory/intake` returns quickly with `ai_status: "processing"`.
2. after ~30s, rug row has non-null `ai_description`.
3. `GET /api/rugs/{id}` returns `size_display` and cached `contextual_blurb`.

## 7. Rotate Secrets

1. Rotate `STORE_PASSCODE` to change unlock code.
2. Rotate `COOKIE_SECRET` to invalidate prior device cookies.
