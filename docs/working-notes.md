# Working Notes (Start Here for Dev)

This is a quick, practical reference for what you’ll edit first, where things live, and the current versions.

---

## Core Stack (Current)

- Node.js: latest stable (`node` via `.nvmrc`)
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
- Chat endpoint (mode routing): `apps/web/app/api/chat/route.ts`
- Appraisal generation endpoint (staff-only): `apps/web/app/api/appraisal/generate/route.ts`

### Supabase
- Admin client (server-only): `apps/web/lib/supabase/admin.ts`
- Browser client (if needed): `apps/web/lib/supabase/client.ts`

### Filtering / Logic
- Hard constraints: `apps/web/lib/filters/hard-constraints.ts`
- Shared size bounds/tolerance math: `apps/web/lib/filters/size-bounds.ts`
- Constraint extraction: `apps/web/lib/filters/extract-constraints.ts`
- Candidate shaping: `apps/web/lib/filters/candidate-shaping.ts`
- AI rank/explain: `apps/web/lib/ai/recommend.ts`
- AI appraisal draft generation: `apps/web/lib/ai/appraisal.ts`
- Trade/project chat context: `apps/web/lib/chat/trade-context.ts`
- Multi-room project context: `apps/web/lib/chat/project-context.ts`

### Types
- Recommendation types: `apps/web/lib/types/recommendation.ts`
- Appraisal types: `apps/web/lib/types/appraisal.ts`

---

## Docs You’ll Reference Most

- System overview + prompt layers: `docs/design/overview.md`
- Concierge flow (constraints + ranking + no-match): `docs/design/concierge-flow.md`
- Appraisal flow: `docs/design/appraisal-flow.md`
- Recommendation prompt: `docs/prompts/recommendation.md`
- Structured output schema: `docs/prompts/recommendation-structured-output.md`
- Appraisal prompt: `docs/prompts/appraisal.md`
- Appraisal structured output schema: `docs/prompts/appraisal-structured-output.md`
- Trade/designer support prompt: `docs/prompts/trade-support.md`
- Schema overview: `docs/data/schema.md`

---

## Environment Variables

Template: `apps/web/.env.example`

Required:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY`
- `OPENAI_API_KEY`

---

## How to Run

```bash
npm install
npm run dev
```

### Inventory Fetch Script

Run from repo root:

```bash
npm run qa:fetch-inventory -- --limit 50
```

With tenant filter:

```bash
npm run qa:fetch-inventory -- --tenant YOUR_TENANT_ID --limit 50
```

If env vars are not already exported in your shell, preload from app env file first:

```bash
set -a
source apps/web/.env.local
set +a
npm run qa:fetch-inventory -- --limit 50
```

### E2E Smoke Test

1) Start app server (terminal A):

```bash
npm run dev
```

2) Run smoke tests (terminal B, repo root):

```bash
npm run qa:e2e-smoke
```

3) Open generated report:

`docs/testing/e2e-smoke-report.md`

### QA Check (After E2E)

Quick sequence:
1) Run E2E smoke first to confirm routes/contracts are alive.
2) If E2E passes, run manual QA prompts to check recommendation quality.
3) Review QA log entries and write follow-up issues.

Manual QA example requests (terminal B, while server is running):

```bash
curl -s -X POST http://localhost:3000/api/recommend \
  -H "Content-Type: application/json" \
  -d '{"user_message":"show me what you have"}'
```

```bash
curl -s -X POST http://localhost:3000/api/recommend \
  -H "Content-Type: application/json" \
  -d '{"user_message":"I need an 8x10 rug under $2500","constraints":{"size":{"widthIn":96,"lengthIn":120,"toleranceIn":2},"budgetMax":2500}}'
```

QA log file:

`docs/testing/qa-log.ndjson`

---

## Notes / Reminders

- Availability is always hard; size/budget are hard only when provided.
- Browse without size/budget is valid recommendation behavior.
- SQL-first filtering runs before AI sees inventory.
- Final hard checks still run in backend after SQL query.
- Candidate list is shaped with a simple cap + deterministic order for V1.
- AI ranks/explains only; backend filters deterministically.
- No RAG/vector store needed for current architecture.
