# QA Operations

Canonical operational validation guide. This repo does not keep saved test suites or QA harness scripts.

## 1) Core Local Gates (Blocking)

Run before each deployment:

```bash
npm run quality:release
```

Equivalent expanded commands:

```bash
npm --workspace apps/web exec tsc --noEmit
npm --workspace apps/web run lint
npm --workspace apps/web run build
npm run check:docs
npm run check:migrations
```

## 2) Manual Local Runtime Checks (Ad Hoc)

Start local app with real env values, then run ad hoc checks using shell commands:

1. `GET /api/config/public` returns branding + tenant-safe config.
2. `GET /api/manifest` returns valid web manifest.
3. `POST /api/chat` greeting returns 200 and assistant text.
4. `POST /api/recommend` with strict size returns recommendations.
5. stacked hard constraints (`size + color/style/shape`) can return no-match without hallucination.
6. follow-up `show closest` after no-match widens size only (`0/4/8/12/18/24`) and keeps non-size hard constraints strict.
7. staff unlock + inventory detail access works; invalid staff override payload returns 400.
8. override set and clear behavior resolves `effective_fields` correctly.

## 3) Production Validation (Blocking)

Target: `https://rug-concierge.vercel.app`

1. Repeat the same API checks live with ad hoc commands (no saved harness).
2. Full browser walkthrough on desktop + mobile:
   - locked customer flow
   - unlock/lock cycle
   - concierge multi-turn recommendations + no-match + closest follow-up
   - inventory filtering, modal, overrides, re-analyze
   - intake async enrichment flow
   - session persistence after refresh
3. Run accessibility scan ad hoc (Playwright + axe) and ensure zero violations on `/concierge`, `/inventory`, `/intake`.
4. Capture latency samples for:
   - `/api/config/public`
   - greeting `/api/chat`
   - constrained `/api/recommend`
   and report p50/p95.

## 4) Data Hygiene Before Sign-Off

1. Remove QA pollution rows from production inventory.
2. Clear test override labels (for example: `Override Test Label`).
3. Verify recommendation payloads do not expose deprecated/forbidden fields.

## 5) AI Constraint Policy (Runtime Truth)

- Hard constraints: `size`, `colors`, `styles`, `shape`.
- Soft preferences only: `room`, `material`.
- Closest behavior only applies after explicit closest-style follow-up and only relaxes size.
- Non-size hard constraints are never silently dropped.
