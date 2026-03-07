# UI Iteration Report (Global Rollout)

## Scope
- Routes reviewed: `/`, `/concierge`, `/trade`, `/inventory`, `/appraisal`
- Browsers: Chromium + WebKit
- Devices: Desktop + Mobile
- Iterations captured: `v1` to `v7`

## Iteration Critique Summary

### v1 — Initial post-foundation pass
- P1: Trade mobile showed jump-to-latest in empty/no-turn context.
- P2: Trade quick starts overflowed on mobile due nowrap buttons.
- P2: Inventory page still had technical context section causing visual density.

### v2 — After first fix pass
- Fixed P1 jump button visibility for empty state.
- Fixed quick-start overflow by allowing wrapping.
- Removed inventory technical snapshot section.
- Remaining P2: Inventory filter density still high on mobile.

### v3 — After density tuning
- Added optional size filter disclosure to inventory.
- Mobile appraisal header badges simplified.
- No P1 found.
- Remaining P2: Trade quick starts still visually heavy on mobile.

### v4 — Cognitive load trim
- Reduced mobile trade quick starts to top two prompts.
- No P1 found.

### v5 — Stability pass
- No new layout regressions.
- Screenshot capture retried with timeout-safe helper.

### v6 — Cross-browser parity pass
- Chromium/WebKit spacing deltas within acceptable range for all top states.
- No P1 found.

### v7 — Final curation pass
- Selected final client-facing set of 20 screenshots (desktop/mobile x Chromium/WebKit x 5 routes).
- No P1 blockers in curated set.

## Remaining P2 observations
- Trade mobile still carries moderate density because designer context is long-form by nature.
- Inventory desktop remains table-heavy for staff workflows, but improved via calmer header and optional size filter disclosure.
- Concierge chat on mobile may appear visually close to floating support launcher icon (external overlay), not from app layout.

## Artifacts
- Full matrix per iteration: `tmp/ui-matrix/v1` … `tmp/ui-matrix/v7`
- Curated final 20: `tmp/ui-matrix/final-20`
- Real concierge recommendation/image audit: `tmp/concierge-real-audit/report.json`

---

## Hardening Pass (Pre-Merge)

### Scope
- Iteration set: `hardening-v1` … `hardening-v7`
- Matrix: Chromium/WebKit x desktop/mobile x `/`, `/concierge`, `/trade`, `/inventory`, `/appraisal`

### Hardening Findings
- `P1`: none found in final pass set.
- `P2`: trade mobile still visually dense due required designer-context fields; accepted.
- `P2`: minor badge wrapping variance across browsers at certain widths; accepted.

### Fixes applied during hardening
- Trade header controls improved for mobile readability (role selector + New Session sizing/hierarchy).
- Inventory tenant badge truncation hardened with overflow/ellipsis handling.

### Final curated artifacts (hardening)
- Matrix snapshots: `tmp/ui-matrix/hardening-v1` … `tmp/ui-matrix/hardening-v7`
- Curated client set: `tmp/ui-matrix/hardening-final-20`
