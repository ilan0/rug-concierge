# Web App (Next.js)

This app is the primary UI shell for Rug Concierge MVP.

## Routes

- `/`:
  - role selection + workspace entry
  - selected role controls visible routes and access
  - developer role option is controlled by `NEXT_PUBLIC_ENABLE_DEVELOPER_ROLE`
  - role switcher visibility is controlled by `NEXT_PUBLIC_ENABLE_ROLE_SWITCHER`
  - when role switcher is hidden, `NEXT_PUBLIC_PILOT_DEFAULT_ROLE` is auto-synced
- `/concierge`:
  - main customer-facing input flow
  - posts user turns to `/api/chat`
  - renders general chat and recommendation responses
- `/trade`:
  - trade/designer repeat-buyer workflow
  - reuses shared chat shell with trade-specific context controls
  - injects trade and project context into `/api/chat` turns for personalization
- `/inventory`:
  - read-only inventory browser for owner/staff transparency
  - uses server-side Supabase query from `rugs`
  - supports URL-driven search + filters (status, price range, size range, sort) and pagination
- `/appraisal`:
  - staff-facing Appraisal Studio v3 (step-based flow)
  - uses source toggle: store rug vs customer rug
  - supports generate/save/finalize with finalized lock behavior
  - advanced tools (copy/export/internal metadata) are collapsed by default

## API Routes (same project)

- `/api/chat`
- `/api/recommend`
- `/api/appraisal/generate`
- `/api/debug/trace` (developer-only trace reader)
- `/api/ui-role` (syncs role cookie used by API authorization)
- `/api/ui-access` (optional pilot access passcode gate)

Recommendation API note:
- `/api/recommend` now requires `tenant_id`.
- `/api/chat` recommendation turns require tenant context (request tenant or session-bound tenant).
- `/inventory` is tenant-scoped via UI tenant cookie context.

Pilot access note:
- If `PILOT_ACCESS_PASSCODE` is set, API routes/pages require passcode unlock via Home.

## Role Policy

- Central role/capability policy lives in:
  - `/apps/web/lib/auth/roles.ts`
  - `/apps/web/lib/auth/capabilities.ts`
  - `/apps/web/lib/auth/policy.ts`
  - `/apps/web/lib/auth/request-role.ts`
- API routes resolve role from cookie first and reject cookie/body mismatch.
- Privileged roles (`store_staff`, `developer`) require cookie-resolved role.

## Styling Standard (Global)

UI stack is now:
- Tailwind CSS
- shadcn/ui components (Radix primitives under the hood)
- CSS variable theme in `/apps/web/app/globals.css`

Use these shared primitives first:
- `/apps/web/components/ui/app-shell.tsx`
- `/apps/web/components/ui/page-header.tsx`
- `/apps/web/components/ui/section-card.tsx`
- `/apps/web/components/ui/form-field.tsx`
- standard controls in `/apps/web/components/ui/*` (`button`, `input`, `textarea`, `sheet`, etc.)

For any new page:
1. Wrap with `AppShell`
2. Add `PageHeader`
3. Compose sections from `SectionCard`
4. Avoid page-specific CSS unless absolutely necessary

## Shared Workspace Shell

- Shared role-aware navigation:
  - `/apps/web/components/shell/workspace-nav.tsx`
- Used by concierge/trade/inventory/appraisal pages for consistent workspace routing.

## Contributor Onboarding

- Repo-level feature map:
  - `../../docs/contributor-map.md`
- One-page project truth:
  - `../../docs/master-context.md`

## Lockfile Policy

- Use npm workspaces from repo root.
- Canonical lockfile is root `package-lock.json`.
- Do not commit `apps/web/package-lock.json`.

## Local Run

```bash
npm run dev
```

## Build Validation

```bash
npm --workspace apps/web run lint
npm --workspace apps/web run build
```
