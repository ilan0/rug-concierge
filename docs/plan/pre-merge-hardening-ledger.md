# Pre-Merge Hardening Ledger

## Scope Lock (keep / revise / drop)

### Keep (product code)
- `apps/web/app/globals.css`
- `apps/web/app/trade/page.tsx`
- `apps/web/app/inventory/page.tsx`
- `apps/web/app/appraisal/page.tsx`
- `apps/web/components/home/home-screen.tsx`
- `apps/web/components/concierge/concierge-screen.tsx`
- `apps/web/components/concierge/chat-thread.tsx`
- `apps/web/components/appraisal/appraisal-screen.tsx`
- `apps/web/components/shell/workspace-nav.tsx`
- `apps/web/components/ui/app-shell.tsx`
- `apps/web/components/ui/page-header.tsx`
- `apps/web/components/ui/section-card.tsx`
- `apps/web/components/ui/access-guard.tsx`
- `apps/web/components/ui/button.tsx`
- `apps/web/components/ui/input.tsx`
- `apps/web/components/ui/textarea.tsx`

### Keep (docs/process)
- `docs/plan/ui-decision-log.md`
- `docs/plan/ui-iteration-report.md`
- `docs/plan/pre-merge-hardening-ledger.md`

### Keep (deterministic validation tooling)
- `tmp/ui-matrix-capture.cjs`

### Drop from merge scope (generated / ephemeral)
- `scripts/testing/functionality/latest-functional.md`
- `scripts/testing/quality/latest-quality.md`
- `tmp/concierge-real-audit/*` screenshots/log outputs
- `tmp/ui-matrix/v1..v7` generated screenshot directories

## Findings (severity)

### P1 (blocking)
- `P1-01`: Jump-to-latest showing with no chat turns (Trade flow). Status: **fixed** in `chat-thread` by gating on `turns.length > 0`.

### P2 (non-blocking, fixed)
- `P2-01`: Trade mobile quick-start chips overflow/wrap awkwardly. Status: **fixed** by allowing wrapping and limiting to two on small screens.
- `P2-02`: Inventory visual overload from technical snapshot panel. Status: **fixed** by removing panel and simplifying filters.
- `P2-03`: Inventory mobile readability for table data. Status: **fixed** via mobile card fallback and optional size-filter disclosure.
- `P2-04`: Trade header action controls too dense on mobile. Status: **fixed** (larger role select, lighter New Session treatment).

### P2 (accepted with follow-up)
- `P2-05`: Trade route still information-dense when full designer context is visible on small screens. Status: **accepted** (workflow necessity).

### P3 (optional polish)
- `P3-01`: Minor visual variance in header badge wrapping between Chromium and WebKit at specific widths. Status: accepted.

## Validation Gates
- `npm --workspace apps/web run lint`: pass
- `npm --workspace apps/web run build`: pass
- `TENANT_ID=... npm run qa:functional`: pass (18/18)
- `TENANT_ID=... npm run qa:quality`: pass (7/7)
- Screenshot matrix captured for Chromium/WebKit x desktop/mobile x all core routes over 7 iterations.

## Merge Risk Statement
- Blocking UI/QA regressions identified in hardening have been fixed.
- Remaining items are minor density/polish concerns and do not impact correctness or core usability.
