# Deployment Runbook

## 1) Tenant Bootstrap

1. Ensure deployment `TENANT_ID` is set in Vercel project env.
2. Ensure a `public.tenants` row exists for that UUID.
3. Set tenant branding in `tenants.settings.branding`:
   - `store_name`
   - `logo_mark_url` (public Supabase Storage URL)
4. Verify tenant-scoped baseline counts are expected before intake/seed runs.

## 2) Configure Environment

Set required env vars from `docs/deployment/env-vars.md`.

Minimum critical values:
- Supabase runtime keys
- OpenAI key
- `TENANT_ID`
- `STORE_PASSCODE` (if staff gate enabled)
- `CRON_SECRET` (required for `/api/inventory/enrichment/worker`)
- fallback branding env vars (`STORE_NAME`, `STORE_LOGO_URL`) optional

## 3) Deploy

1. Run production deploy.
2. Verify healthy responses:
   - `GET /api/config/public` -> 200
   - `GET /api/manifest` -> 200
3. Verify `/api/config/public` returns expected tenant branding values.

## 4) Core Smoke Tests

1. `POST /api/chat` -> 200
2. locked `/inventory` and `/intake` redirect to `/concierge`
3. `POST /api/auth/passcode` wrong code -> 401
4. `POST /api/auth/passcode` correct code -> 200 + `staff_unlocked` cookie set
5. unlocked `/inventory` and `/intake` load
6. `POST /api/auth/lock` clears staff cookie

## 5) Intake + Detail Validation

1. `POST /api/inventory/intake` returns quickly with `ai_status: "processing"` and `enrichment_status: "processing"`.
2. Worker cron (`/api/inventory/enrichment/worker`) drains queue and resolves rugs to `ready` or `needs_review`.
3. After processing, `ready` rugs have deterministic title + structured fields.
3. `GET /api/rugs/{id}` returns `effective_fields`, `size_display`, and image URL.
4. Confirm retail payloads expose only retail-safe fields (no raw staff override internals).

## 6) Overnight Demo Verification (Optional)

Commands:
1. `TENANT_ID=<tenant> npx tsx scripts/seed-demo-rugs.ts`
2. `TENANT_ID=<tenant> npx tsx scripts/re-enrich-rugs.ts --tenant-id=<tenant>`
   - if some rugs fail enrichment, rerun the same command (no `--force`) for failed-only retries
   - use `--force` only for intentional full reprocessing
3. Run ad hoc API checks against production:
   - `GET /api/config/public`
   - `GET /api/manifest`
   - `POST /api/chat` greeting
   - `POST /api/recommend` strict-size match and strict no-match
   - follow-up `closest` check after no-match
   - staff unlock + staff detail + override set/clear + invalid payload

Operational note:
- This repo does not keep saved QA harness scripts. Release verification is executed ad hoc and recorded in operator notes.

## 7) Secret Rotation

- Rotate `STORE_PASSCODE` to change staff unlock code.
- Rotate `COOKIE_SECRET` with awareness that signed device state resets.

## 8) Store Onboarding (Manual)

1. Get store display name and logo mark from owner.
2. Upload logo mark to a public Supabase Storage path.
3. Update tenant row:
   - `settings.branding.store_name`
   - `settings.branding.logo_mark_url`
4. Set deployment `TENANT_ID` for that store deployment.
5. Confirm brand bar + `/api/config/public` reflect tenant branding.

## 9) Optional Full Reset (Destructive)

Use only when you intentionally want a complete wipe before reseeding.

```sql
BEGIN;
DELETE FROM public.chat_messages;
DELETE FROM public.chat_sessions;
DELETE FROM public.rug_images;
DELETE FROM public.rugs;
DELETE FROM public.tenants;
COMMIT;
```

Notes:
- If you only want one store reset, delete by `tenant_id` instead of full-table deletes.
- Database deletes do not remove Supabase Storage objects; clear the `rug-images` bucket paths separately.
