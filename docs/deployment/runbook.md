# Deployment Runbook

## 1. Prepare Tenant

1. Create or verify tenant row in Supabase.
2. Capture tenant UUID.
3. Set `TENANT_ID` on deployment.

## 2. Configure Env Vars

Set required vars from `docs/deployment/env-vars.md`.

Set `STORE_PASSCODE` to a 4-digit value for staff unlock.

## 3. Deploy

1. Deploy app.
2. Verify health routes:
   - `GET /api/config/public` returns 200
   - `GET /api/manifest` returns 200

## 4. Smoke Tests

1. `POST /api/chat` returns 200.
2. Locked `/inventory` and `/intake` requests redirect to `/concierge`.
3. `POST /api/auth/passcode` with wrong code returns 401.
4. `POST /api/auth/passcode` with correct code returns 200 and sets `staff_unlocked=1`.
5. unlocked `/inventory` and `/intake` load normally.
6. `POST /api/auth/lock` clears `staff_unlocked`.

## 5. Intake + Detail Check

1. `POST /api/inventory/intake` returns quickly with `ai_status: "processing"`.
2. after ~30s, rug row has non-null `ai_description`.
3. `GET /api/rugs/{id}` returns `size_display` and cached `contextual_blurb`.

## 6. Rotate Secrets

1. Rotate `STORE_PASSCODE` to change unlock code.
