# Deployment Runbook

## 1) Tenant Bootstrap

1. Ensure deployment `TENANT_ID` is set in Vercel project env.
2. Ensure a `public.tenants` row exists for that UUID.
3. Verify tenant-scoped baseline counts are expected before intake/seed runs.

## 2) Configure Environment

Set required env vars from `docs/deployment/env-vars.md`.

Minimum critical values:
- Supabase runtime keys
- OpenAI key
- `TENANT_ID`
- `STORE_PASSCODE` (if staff gate enabled)

## 3) Deploy

1. Run production deploy.
2. Verify healthy responses:
   - `GET /api/config/public` -> 200
   - `GET /api/manifest` -> 200

## 4) Core Smoke Tests

1. `POST /api/chat` -> 200
2. locked `/inventory` and `/intake` redirect to `/concierge`
3. `POST /api/auth/passcode` wrong code -> 401
4. `POST /api/auth/passcode` correct code -> 200 + `staff_unlocked=1`
5. unlocked `/inventory` and `/intake` load
6. `POST /api/auth/lock` clears staff cookie

## 5) Intake + Detail Validation

1. `POST /api/inventory/intake` returns quickly with `ai_status: "processing"`.
2. After processing, rug row has non-null `ai_description` and `ai_structured_fields`.
3. `GET /api/rugs/{id}` returns `effective_fields`, `size_display`, and image URL.
4. Confirm `contextual_blurb` is absent from response payloads.

## 6) Overnight Demo Verification (Optional)

Commands:
1. `TENANT_ID=<tenant> npx tsx scripts/seed-demo-rugs.ts`
2. `TENANT_ID=<tenant> npx tsx scripts/re-enrich-rugs.ts --tenant-id=<tenant>`
   - if some rugs fail enrichment, rerun the same command (no `--force`) for failed-only retries
   - use `--force` only for intentional full reprocessing
3. `BASE_URL=<prod-url> TENANT_ID=<tenant> STORE_PASSCODE=<staff-passcode> npx tsx scripts/verify-api-contracts.ts`

Verification artifact:
- `tmp/release-validation/overnight-phase2-report.json`

## 7) Secret Rotation

- Rotate `STORE_PASSCODE` to change staff unlock code.
- Rotate `COOKIE_SECRET` with awareness that signed device state resets.

## 8) Optional Full Reset (Destructive)

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
