# Store Deployment Runbook

## 1. Prepare Tenant

1. Create or confirm tenant row in Supabase.
2. Capture tenant UUID for env configuration.
3. Seed initial inventory if needed.

## 2. Create Customer Deployment

1. Create Vercel project: `<store>-customer`.
2. Connect to this repo/branch.
3. Configure env vars:
4. Set shared vars from [`env-vars.md`](./env-vars.md).
5. Set `DEPLOYMENT_TYPE=customer`, `NEXT_PUBLIC_DEPLOYMENT_TYPE=customer`.
6. Set `TENANT_ID` and `NEXT_PUBLIC_TENANT_ID` to store tenant UUID.
7. Disable role switcher: `NEXT_PUBLIC_ENABLE_ROLE_SWITCHER=0`.
8. Deploy and verify `/` lands on `/concierge`.

## 3. Create Staff Deployment

1. Create Vercel project: `<store>-staff`.
2. Connect to this repo/branch.
3. Generate secrets:
4. `COOKIE_SECRET`: `openssl rand -hex 32`
5. `STAFF_ACCESS_TOKEN`: `openssl rand -hex 32`
6. `TRADE_ACCESS_TOKEN`: `openssl rand -hex 32`
7. `DEV_ACCESS_TOKEN`: `openssl rand -hex 32`
8. Configure env vars:
9. Set shared vars from [`env-vars.md`](./env-vars.md).
10. Set `DEPLOYMENT_TYPE=staff`, `NEXT_PUBLIC_DEPLOYMENT_TYPE=staff`.
11. Set `TENANT_ID` and `NEXT_PUBLIC_TENANT_ID`.
12. Set `PILOT_ACCESS_PASSCODE`.
13. Set all three access tokens.
14. Set `NEXT_PUBLIC_ENABLE_ROLE_SWITCHER=0`.
15. Deploy and verify passcode gate appears on `/`.

## 4. Create Join Links

1. Staff: `https://<staff-domain>/join?token=<STAFF_ACCESS_TOKEN>`
2. Trade: `https://<staff-domain>/join?token=<TRADE_ACCESS_TOKEN>`
3. Developer: `https://<staff-domain>/join?token=<DEV_ACCESS_TOKEN>`

## 5. Distribution To Humans

1. Retail customers: share customer URL only.
2. Trade clients: share trade join link only.
3. Store staff: share staff join link + pilot passcode.
4. Store owner/demo presenter: same as staff; optionally keep dev link private for support.
5. Tell staff and trade users to bookmark their `/join?token=...` URL. Cookie recovery is re-clicking that bookmark.

## 6. Smoke Tests

1. Customer `/` -> `/concierge`, no setup UI.
2. Customer `/inventory` -> redirected `/concierge`.
3. Staff `/` -> passcode gate.
4. After passcode, staff join link -> `/inventory`.
5. Trade join link -> `/trade`.
6. Clear role cookie only (keep pilot cookie) -> staff URL routes to `/join` recovery.
7. Clear both role + pilot cookies -> passcode gate first, then join recovery.

## 7. Rotation

1. Rotate access token: update env var, redeploy, redistribute new join link.
2. Rotate `COOKIE_SECRET`: all role cookies invalidated; users re-enter through `/join`.
