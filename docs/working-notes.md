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

## Workspace Policy

- Run npm from repo root (workspace mode).
- Canonical lockfile: `package-lock.json` at repo root.
- Do not commit `apps/web/package-lock.json`.

---

## Files You’ll Edit First (Primary)

### API (server)
- Recommendation endpoint: `apps/web/app/api/recommend/route.ts`
  - Wire Supabase query
  - Call OpenAI Responses API
  - Return structured output
- Chat endpoint (mode routing): `apps/web/app/api/chat/route.ts`
- Appraisal generation endpoint (staff-only): `apps/web/app/api/appraisal/generate/route.ts`
- Debug trace endpoint (developer-only): `apps/web/app/api/debug/trace/route.ts`
- UI role cookie sync endpoint: `apps/web/app/api/ui-role/route.ts`

### Supabase
- Admin client (server-only): `apps/web/lib/supabase/admin.ts`
- Browser client (if needed): `apps/web/lib/supabase/client.ts`

### Filtering / Logic
- Hard constraints: `apps/web/lib/filters/hard-constraints.ts`
- Shared size bounds/tolerance math: `apps/web/lib/filters/size-bounds.ts`
- Constraint extraction: `apps/web/lib/filters/extract-constraints.ts`
- Candidate shaping: `apps/web/lib/filters/candidate-shaping.ts`
- AI rank/explain: `apps/web/lib/ai/recommend.ts`
- AI general chat: `apps/web/lib/ai/general-chat.ts`
- AI appraisal draft generation: `apps/web/lib/ai/appraisal.ts`
- Conversation memory + compaction: `apps/web/lib/chat/memory.ts`
- AI context packet builder: `apps/web/lib/chat/context-packet.ts`
- Trade/project chat context: `apps/web/lib/chat/trade-context.ts`
- Multi-room project context: `apps/web/lib/chat/project-context.ts`
- Role/capability policy: `apps/web/lib/auth/*`
- Session persistence repo: `apps/web/lib/chat/session-repo.ts`
- Shared chat UI shell (concierge + trade variant): `apps/web/components/concierge/concierge-screen.tsx`

### Types
- Recommendation types: `apps/web/lib/types/recommendation.ts`
- Appraisal types: `apps/web/lib/types/appraisal.ts`

---

## Docs You’ll Reference Most

- Docs index: `docs/README.md`
- System overview + prompt layers: `docs/design/overview.md`
- Concierge flow (constraints + ranking + no-match): `docs/design/concierge-flow.md`
- Appraisal flow: `docs/design/appraisal-flow.md`
- Chat orchestration map: `docs/design/chat-orchestration.md`
- Role capability matrix: `docs/design/role-capability-matrix.md`
- Recommendation prompt: `docs/prompts/recommendation.md`
- General chat prompt: `docs/prompts/general-chat.md`
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

Optional (hosted owner pilot):
- `PILOT_ACCESS_PASSCODE`
- `ENABLE_GENERAL_CHAT_AI` (`1` default; set `0` to force fallback)
- `CHAT_MEMORY_V1` (`1` default; set `0` to disable memory updates/context injection)

---

## How to Run

```bash
npm install
npm run dev
```

### DB Migration (Session Persistence)

Apply migration before expecting durable chat sessions:

`packages/db/migrations/20260223_chat_sessions.sql`

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
SMOKE_TENANT_ID=YOUR_TENANT_ID npm run qa:e2e-smoke
```

Run a single smoke case:

```bash
SMOKE_TENANT_ID=YOUR_TENANT_ID npm run qa:e2e-smoke -- --case "recommend browse request returns contract"
```

3) Open generated report:

`docs/testing/e2e-smoke-report.md`

### One-Command Comprehensive QA

Run the full stack in one command:

```bash
SMOKE_TENANT_ID=YOUR_TENANT_ID npm run qa:all
```

What it runs:
1) `lint`
2) `build`
3) `qa:e2e-smoke`
4) `qa:demo-rehearsal`
5) targeted contract/security checks
6) artifact cleanup (keeps latest run folder)

Read this first:
- `docs/testing/latest-summary.md`

Deep debug only if needed:
- `docs/testing/e2e-smoke-report.md`
- `docs/testing/demo-rehearsal-report.md`
- `docs/testing/artifacts/`

Testing hub:
- `docs/testing/README.md`

### Demo Rehearsal (Owner Flow)

```bash
SMOKE_TENANT_ID=YOUR_TENANT_ID npm run qa:demo-rehearsal
```

Outputs:
- `docs/testing/demo-rehearsal-report.md`

### QA Check (After E2E)

Quick sequence:
1) Run E2E smoke first to confirm routes/contracts are alive.
2) If E2E passes, run manual QA prompts to check recommendation quality.
3) Review QA log entries and write follow-up issues.

Manual QA example requests (terminal B, while server is running):

```bash
curl -s -X POST http://localhost:3000/api/recommend \
  -H "Content-Type: application/json" \
  -d '{"tenant_id":"YOUR_TENANT_ID","user_message":"show me what you have"}'
```

```bash
curl -s -X POST http://localhost:3000/api/recommend \
  -H "Content-Type: application/json" \
  -d '{"tenant_id":"YOUR_TENANT_ID","user_message":"I need an 8x10 rug under $2500","constraints":{"size":{"widthIn":96,"lengthIn":120,"toleranceIn":2},"budgetMax":2500}}'
```

QA log file:

`docs/testing/qa-log.ndjson`

---

## Notes / Reminders

- Availability is always hard; size/budget are hard only when provided.
- Tenant scoping is always hard for recommendation flows.
- Browse without size/budget is valid recommendation behavior.
- SQL-first filtering runs before AI sees inventory.
- Final hard checks still run in backend after SQL query.
- Candidate list is shaped with a simple cap + deterministic order for V1.
- AI ranks/explains only; backend filters deterministically.
- No RAG/vector store needed for current architecture.

### Error + Fallback Behavior (Current)

- `/api/chat`
  - Empty/missing message -> `400` with friendly error.
  - Unexpected failure -> `500` with `CHAT_INTERNAL_ERROR`.
  - General chat uses AI with bounded context packet and deterministic fallback.

- `/api/recommend`
  - Empty body or invalid request shape -> `400`.
  - Invalid constraint values (negative/zero budget or size) -> `400`.
  - Pipeline failure -> `500` with `RECOMMENDATION_PIPELINE_ERROR`.

- Recommendation fallback behavior
  - Missing OpenAI key, request failure, or parse failure uses deterministic fallback response.
  - Fallback remains structured so UI can continue rendering without dead ends.

### Request Contract Clarification (Current)

- Canonical role field for UI/API requests is `role`.
- `user_role` is still accepted server-side for compatibility, but should not be used by new client code.

### Micro-Phase Validation Checklist (Pilot UX + Reliability)

Run these after UI/contract guardrail changes:

```bash
npm --workspace apps/web run lint
npm --workspace apps/web run build
```

Targeted API checks:

```bash
curl -s -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -H "Cookie: rug_ui_role=retail_customer" \
  -d '{"tenant_id":"YOUR_TENANT_ID","role":"store_staff","message":"show rugs"}'
```

```bash
curl -s -X POST http://localhost:3000/api/recommend \
  -H "Content-Type: application/json" \
  -H "Cookie: rug_ui_role=retail_customer" \
  -d '{"tenant_id":"YOUR_TENANT_ID","role":"retail_customer","user_message":"show rugs","constraints":"bad"}'
```

```bash
curl -s "http://localhost:3000/api/debug/trace?run=RUN_ID&case=CASE_ID" \
  -H "Cookie: rug_ui_role=trade_client"
```

Latest validation status (2026-02-23):
- `lint`: pass
- `build`: pass
- `role` mismatch check (`/api/chat`): `403` pass
- malformed `constraints` check (`/api/recommend`): `400` pass
- debug trace access: non-developer `403`, developer `200` pass
- staff review flow: recommendation turn + regenerate review action both `200` pass
