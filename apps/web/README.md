# Web App (Next.js)

This app is the primary UI shell for Rug Concierge MVP.

## Routes

- `/`:
  - minimal home/workspace entry
- `/inventory`:
  - read-only inventory browser for owner/staff transparency
  - uses server-side Supabase query from `rugs`
  - supports URL-driven search + filters (status, price range, size range, sort) and pagination

## API Routes (same project)

- `/api/chat`
- `/api/recommend`
- `/api/appraisal/generate`

## Local Run

```bash
npm run dev
```
