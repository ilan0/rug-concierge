# Working Notes (Start Here for Dev)

This is a quick, practical reference for what you’ll edit first, where things live, and the current versions.

---

## Core Stack (Current)

- Node.js: `20.11.1` (see `.nvmrc`)
- Next.js: `16.1.6`
- TypeScript: `5.x`
- Supabase JS: `2.95.3`
- Deployment: Vercel (planned)

---

## Main App Location

- Next.js app: `apps/web`

---

## Files You’ll Edit First (Primary)

### API (server)
- Recommendation endpoint: `apps/web/app/api/recommend/route.ts`
  - Wire Supabase query
  - Call OpenAI Responses API
  - Return structured output

### Supabase
- Admin client (server-only): `apps/web/lib/supabase/admin.ts`
- Browser client (if needed): `apps/web/lib/supabase/client.ts`

### Filtering / Logic
- Hard constraints: `apps/web/lib/filters/hard-constraints.ts`
- AI rank/explain stub: `apps/web/lib/ai/recommend.ts`

### Types
- Recommendation types: `apps/web/lib/types/recommendation.ts`

---

## Docs You’ll Reference Most

- System overview + prompt layers: `docs/design/overview.md`
- Concierge flow (constraints + ranking + no-match): `docs/design/concierge-flow.md`
- Appraisal flow: `docs/design/appraisal-flow.md`
- Recommendation prompt: `docs/prompts/recommendation.md`
- Structured output schema: `docs/prompts/recommendation-structured-output.md`
- Schema overview: `docs/data/schema.md`

---

## Environment Variables

Template: `apps/web/.env.example`

Required:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `OPENAI_API_KEY`

---

## How to Run

```bash
npm install
npm run dev
```

---

## Notes / Reminders

- Hard constraints are applied before AI sees inventory.
- AI ranks/explains only; backend filters deterministically.
- No RAG/vector store needed for current architecture.
