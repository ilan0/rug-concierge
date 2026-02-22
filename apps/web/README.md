# Web App (Next.js)

This app is the primary UI shell for Rug Concierge MVP.

## Routes

- `/`:
  - role selection + workspace entry
  - selected role controls visible routes and access
- `/concierge`:
  - main customer-facing input flow
  - posts user turns to `/api/chat`
  - renders general chat and recommendation responses
- `/inventory`:
  - read-only inventory browser for owner/staff transparency
  - uses server-side Supabase query from `rugs`
  - supports URL-driven search + filters (status, price range, size range, sort) and pagination
- `/appraisal`:
  - staff-facing appraisal draft screen
  - posts appraisal context to `/api/appraisal/generate`
  - supports copy/export of draft text and JSON

## API Routes (same project)

- `/api/chat`
- `/api/recommend`
- `/api/appraisal/generate`

## Styling Standard (Global)

Use shared `ui-*` classes from `/apps/web/app/globals.css` for all new pages:

- `ui-shell`: page container spacing + width
- `ui-showroom`: classy gradient shell card
- `ui-header`: top header layout
- `ui-kicker`, `ui-subtitle`: consistent hero text hierarchy
- `ui-nav`: top route nav with standard links
- `ui-card`: reusable panel/card base
- `ui-btn`, `ui-btn-primary`: standard button styling
- `ui-empty`: standard empty state block

Pattern for new pages:

```tsx
<main className="ui-shell ui-showroom">
  <header className="ui-header">
    <p className="ui-kicker">Section</p>
    <h1>Page Title</h1>
    <p className="ui-subtitle">Short supporting description.</p>
  </header>
</main>
```

## Local Run

```bash
npm run dev
```
