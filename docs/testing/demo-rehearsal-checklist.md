# Demo Rehearsal Checklist (Owner Pilot)

Use this before sharing the pilot with a rug store owner.

## Setup

1. Confirm env values:
- `SMOKE_TENANT_ID` set to store tenant.
- `OPENAI_API_KEY` set.
- Optional hosted gate: `PILOT_ACCESS_PASSCODE`.

2. Start app:

```bash
npm run dev
```

## Owner Journey (Manual)

1. Home:
- If passcode is enabled, unlock with correct code.
- Set `Store Tenant ID`.
- Select role (`store_staff` for owner pilot).

2. Concierge:
- Ask: “show me what you have”.
- Ask refinement: “show me 8x10 rugs under $2500”.
- Confirm recommendations render with reasons and confidence.
- Confirm loading state and slow-notice behavior are understandable.

3. Inventory:
- Open `/inventory`.
- Confirm data loads.
- Confirm tenant-bound view only (no cross-tenant data).
- Apply 2-3 filters and verify expected narrowing.

4. Appraisal:
- Open `/appraisal`.
- Fill minimal known fields.
- Generate draft.
- Copy text and export JSON/TXT.

5. Role safety:
- Switch to `retail_customer` and confirm appraisal/inventory are blocked.
- Confirm debug trace UI is not visible for non-developer.

## Scripted Rehearsal

Run:

```bash
SMOKE_TENANT_ID=YOUR_TENANT_ID npm run qa:demo-rehearsal
```

Output:
- Console pass/fail table.
- Report file: `docs/testing/demo-rehearsal-report.md`.

## Pass Criteria

1. No blocker errors in owner journey.
2. Tenant-bound data behavior confirmed in inventory and recommendation paths.
3. Role restrictions enforce staff-only capabilities.
4. Scripted rehearsal passes all scenarios.
