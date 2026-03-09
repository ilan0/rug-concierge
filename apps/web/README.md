# Web App (Next.js)

Primary UI shell for Rug Concierge MVP.

## Routes

- `/`: role/tenant setup + workspace entry
- `/concierge`: retail/staff chat workflow via `/api/chat`
- `/trade`: trade workflow via `/api/chat`
- `/inventory`: tenant-scoped inventory browser
- `/intake`: staff/developer mobile-first intake workflow
- `/appraisal`: staff/developer appraisal workflow

## API Routes

- `/api/chat`
- `/api/recommend`
- `/api/inventory/intake`
- `/api/appraisal/generate`
- `/api/appraisal/rugs`
- `/api/appraisal/drafts`
- `/api/debug/trace`
- `/api/ui-role`
- `/api/ui-access`

## Role Policy

Policy source:
- `/apps/web/lib/auth/roles.ts`
- `/apps/web/lib/auth/capabilities.ts`
- `/apps/web/lib/auth/policy.ts`
- `/apps/web/lib/auth/request-role.ts`

Rules:
- cookie role first
- cookie/body mismatch rejected
- privileged roles require cookie role

## Styling

- Tailwind CSS
- shadcn/ui components
- shared primitives in `/apps/web/components/ui/*`

## Workspace Nav

Shared role-aware nav:
- `/apps/web/components/shell/workspace-nav.tsx`

## Core Docs

- `../../docs/master-context.md`
- `../../docs/testing/README.md`

## Local Run

```bash
npm run dev
```

## Build Validation

```bash
npm --workspace apps/web run lint
npm --workspace apps/web run build
```

## QA (Repo Root)

```bash
TENANT_ID=<tenant-uuid> npm run qa:functional
TENANT_ID=<tenant-uuid> npm run qa:quality
```

`qa:functional` includes intake matrix validation.
