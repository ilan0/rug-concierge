# Store Deployment Runbook

## 1. Prepare Tenant

1. Create/confirm tenant row in Supabase.
2. Capture tenant UUID.
3. Seed inventory if needed.

## 2. Create Customer Deployment (`<store>-customer`)

1. Create Vercel project and connect this repo.
2. Set env vars from [`env-vars.md`](./env-vars.md).
3. Required role token on customer deployment:
4. `TRADE_ACCESS_TOKEN=<TRADE_ACCESS_TOKEN>`
5. Deploy.
6. Verify:
7. `/` lands on `/concierge`.
8. `/join?token=<TRADE_ACCESS_TOKEN>` lands on `/trade`.

## 3. Create Staff Deployment (`<store>-staff`)

1. Create Vercel project and connect this repo.
2. Generate/store secrets:
3. `COOKIE_SECRET` (same as customer deployment for the same store)
4. `STAFF_ACCESS_TOKEN`
5. `DEV_ACCESS_TOKEN`
6. Set env vars from [`env-vars.md`](./env-vars.md).
7. Deploy.
8. Verify:
9. `/join?token=<STAFF_ACCESS_TOKEN>` lands on `/inventory`.
10. `/join?token=<DEV_ACCESS_TOKEN>` lands on `/`.

## 4. Persona Link Distribution

1. Retail customer: `https://<customer-domain>/`
2. Trade/design client: `https://<customer-domain>/join?token=<TRADE_ACCESS_TOKEN>`
3. Store staff/owner: `https://<staff-domain>/join?token=<STAFF_ACCESS_TOKEN>`
4. Developer/support: `https://<staff-domain>/join?token=<DEV_ACCESS_TOKEN>`
5. Tell trade/staff/dev users to bookmark their join link.

## 5. Vercel Env Actions (Dashboard)

After changing env vars, redeploy both projects.

Customer deployment:
1. Add `TRADE_ACCESS_TOKEN=<TRADE_ACCESS_TOKEN>`
2. Ensure `COOKIE_SECRET` matches staff deployment for that store
3. Do not set `PILOT_ACCESS_PASSCODE`

Staff deployment:
1. Add `STAFF_ACCESS_TOKEN=<STAFF_ACCESS_TOKEN>`
2. Add `DEV_ACCESS_TOKEN=<DEV_ACCESS_TOKEN>`
3. Remove `TRADE_ACCESS_TOKEN`
4. Remove `PILOT_ACCESS_PASSCODE`

## 6. Smoke Test Checklist

1. Customer `/` with no cookies -> `/concierge`
2. Customer `/join?token=<TRADE_ACCESS_TOKEN>` -> `/trade`
3. Customer `/trade` with no trade cookie -> `/concierge`
4. Staff `/join?token=<STAFF_ACCESS_TOKEN>` -> `/inventory`
5. Staff `/join?token=<DEV_ACCESS_TOKEN>` -> `/`
6. Staff `/` with staff cookie -> `/inventory`
7. Staff `/trade` -> `/inventory`
8. Clear role cookie and reopen bookmarked join link -> back to portal

## 7. Rotation

1. Rotate any access token -> update env, redeploy, redistribute new link.
2. Rotate `COOKIE_SECRET` -> all signed role cookies invalidated, users re-enter via join link.
