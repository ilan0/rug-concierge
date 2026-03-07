# UI Decision Log

## 2026-03-05 23:25 ET — Global foundation adopted
- Concierge is the visual benchmark (warm minimal, calm hierarchy, older-user readability).
- Shared primitives now use route archetypes instead of one generic style.
- No backend/API changes are allowed in this UI pass.

## 2026-03-05 23:29 ET — Archetype variants
- `AppShell` variants: `setup`, `conversational`, `workflow`, `catalog`, `default`.
- `PageHeader` variants: `setup`, `workflow`, `catalog`, `minimal`, `default`.
- `SectionCard` controls: `tone` (`default|soft|transparent`) and `density` (`roomy|compact`).
- `WorkspaceNav` adds `workspace-soft` for non-concierge routes.

## 2026-03-05 23:33 ET — Route migration wave
- Home moved to setup archetype with calmer stacked sections and larger controls.
- Trade uses workflow shell/header styling while keeping all existing trade features.
- Inventory moved to catalog archetype and simplified by removing technical snapshot chrome.
- Appraisal moved to workflow archetype with softer card hierarchy.

## 2026-03-05 23:37 ET — Iteration fix rules
- `P1`: layout break, overlap, unreadable text, critical mobile clipping.
- `P2`: visual rhythm issues, contrast tuning, density excess.
- `P3`: optional cosmetic polish.
- No phase can advance with unresolved `P1`.

## 2026-03-05 23:41 ET — Screenshot matrix standard
- Canonical output path: `tmp/ui-matrix/<version>/`.
- Naming: `<route>-<state>-<browser>-<device>-<version>.png`.
- Capture set: top + mid scroll for all core routes on Chromium/WebKit desktop/mobile.

## 2026-03-06 15:20 ET — Pre-merge hardening
- Added dedicated hardening iteration run: `hardening-v1` to `hardening-v7`.
- Required gates re-run: lint, build, functional QA, quality QA.
- Kept only intentional product/code/docs/tooling changes in merge scope; generated outputs excluded.
