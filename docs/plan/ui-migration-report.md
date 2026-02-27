# UI Migration Report

Date: 2026-02-27
Branch: `codex/chore/demo-script-harness`

## 1) Installed Stack

Frontend styling stack is now:
- Tailwind CSS (`apps/web/tailwind.config.ts`)
- shadcn-style component layer (`apps/web/components/ui/*`)
- Radix primitives (dialog/sheet/popover/dropdown/tabs/select/accordion/scroll-area)
- Theme tokens in `apps/web/app/globals.css`

## 2) New Shared Primitives

Added reusable UI foundation components:
- `apps/web/components/ui/app-shell.tsx`
- `apps/web/components/ui/page-header.tsx`
- `apps/web/components/ui/section-card.tsx`
- `apps/web/components/ui/form-field.tsx`
- base controls in `apps/web/components/ui/*`:
  - `button`, `card`, `input`, `label`, `textarea`, `badge`, `alert`
  - `dialog`, `sheet`, `popover`, `dropdown-menu`, `tabs`, `select`
  - `accordion`, `separator`, `scroll-area`
  - `sonner`

## 3) Pages/Features Migrated

### App Shell + Nav
- `apps/web/components/shell/workspace-nav.tsx`
- route guards moved to reusable `AccessGuard` card:
  - `apps/web/components/ui/access-guard.tsx`

### Home
- `apps/web/components/home/home-screen.tsx`
- migrated to AppShell + PageHeader + SectionCard pattern

### Concierge + Trade
- `apps/web/components/concierge/concierge-screen.tsx`
- `apps/web/components/concierge/chat-thread.tsx`
- `apps/web/components/concierge/message-composer.tsx`
- `apps/web/components/concierge/recommendation-card.tsx`
- `apps/web/components/concierge/operator-drawer.tsx`
  - moved to Radix `Sheet`

### Inventory
- `apps/web/app/inventory/page.tsx`
- migrated to consistent card/form/table styling

### Appraisal Studio v3
- `apps/web/components/appraisal/appraisal-screen.tsx`
- rebuilt to low-overwhelm step flow:
  - Step A Source (Store Rug / Customer Rug)
  - Step B Essentials (4 primary fields)
  - Step C Actions (Generate/Save/Mark Final/New)
  - Step D More details (collapsed)
- Advanced tools hidden by default
- Finalized lock behavior surfaced in UI

## 4) Global Styling Cleanup

- `apps/web/app/globals.css` was reduced to:
  - Tailwind directives
  - theme tokens
  - base typography/background
  - minimal document preview styles
- removed dependency on legacy `ui-*` class architecture in current pages/components.

## 5) Validation Results

Executed successfully:
- `npm --workspace apps/web run lint`
- `npm --workspace apps/web run build`
- `TENANT_ID=0a175457-6194-4ae9-bf4e-1a785d754c4b npm run qa:functional`
- `TENANT_ID=0a175457-6194-4ae9-bf4e-1a785d754c4b QA_CHAT_TIMEOUT_MS=90000 npm run qa:quality`
- `TENANT_ID=0a175457-6194-4ae9-bf4e-1a785d754c4b QA_CHAT_TIMEOUT_MS=90000 node scripts/qa.mjs quality --extended`

Notes:
- Quality suite had one timeout-only failure at default 45s and passed with the approved timeout override.

## 6) Follow-Ups (Optional)

- Add explicit UI-level tests for Appraisal v3 interaction flows (finalize lock, new draft copy).
- Continue replacing any remaining legacy copy in docs that references old `ui-*` class conventions.
