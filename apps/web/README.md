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

## Local Run

```bash
npm run dev
```
