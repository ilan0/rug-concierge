# Rug Concierge

MVP codebase for AI-powered rug recommendation, trade support, and staff appraisal drafting.

## 15-Minute Onboarding

1. Read `/Users/ilannabatkhorian/Documents/rug-concierge/docs/master-context.md`.
2. Read `/Users/ilannabatkhorian/Documents/rug-concierge/docs/contributor-map.md`.
3. Install and run:

```bash
npm install
npm run dev
```

4. Run baseline validation:

```bash
npm --workspace apps/web run lint
npm --workspace apps/web run build
```

## Where to Edit

Use the contributor map as the source of truth:

- `/Users/ilannabatkhorian/Documents/rug-concierge/docs/contributor-map.md`

Quick docs index:

- `/Users/ilannabatkhorian/Documents/rug-concierge/docs/README.md`

## Workspace + Lockfile Policy

- Use npm workspaces from the repo root only.
- Canonical lockfile is:
  - `/Users/ilannabatkhorian/Documents/rug-concierge/package-lock.json`
- Do not maintain or commit app-level lockfiles.
- Next Turbopack workspace root is pinned in:
  - `/Users/ilannabatkhorian/Documents/rug-concierge/apps/web/next.config.mjs`

## Commands

Run app:

```bash
npm run dev
```

Run smoke:

```bash
SMOKE_TENANT_ID=YOUR_TENANT_ID npm run qa:e2e-smoke
```
