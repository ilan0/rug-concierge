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
- Shared size bounds/tolerance math: `apps/web/lib/filters/size-bounds.ts`
- Constraint extraction: `apps/web/lib/filters/extract-constraints.ts`
- Candidate shaping: `apps/web/lib/filters/candidate-shaping.ts`
- AI rank/explain: `apps/web/lib/ai/recommend.ts`

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

- Availability is always hard; size/budget are hard only when provided.
- Browse without size/budget is valid recommendation behavior.
- SQL-first filtering runs before AI sees inventory.
- Final hard checks still run in backend after SQL query.
- Candidate list is shaped with a simple cap + deterministic order for V1.
- AI ranks/explains only; backend filters deterministically.
- No RAG/vector store needed for current architecture.
