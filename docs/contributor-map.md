# Contributor Map (Where to Edit)

Use this map first when you start a task. Goal: find the right files in under 15 minutes.

## Entry Docs

1. `docs/master-context.md`
2. `docs/design/chat-orchestration.md`
3. `docs/design/concierge-flow.md`

## Feature Areas

| Feature Area | Edit Here First | Supporting Files | Validate With |
| --- | --- | --- | --- |
| UI shell + navigation | `apps/web/components/shell/workspace-nav.tsx` | `apps/web/app/page.tsx`, `apps/web/app/globals.css` | manual route check + `npm --workspace apps/web run build` |
| Concierge UI (retail) | `apps/web/components/concierge/concierge-screen.tsx` | `apps/web/components/concierge/use-concierge-controller.ts`, `apps/web/components/concierge/` | `npm run qa:e2e-smoke -- --case "chat"` + manual `/concierge` |
| Trade UI workflow | `apps/web/app/trade/page.tsx` | `apps/web/components/concierge/concierge-screen.tsx`, `apps/web/lib/types/trade-ui.ts` | smoke + manual `/trade` |
| Appraisal UI + export | `apps/web/components/appraisal/appraisal-screen.tsx` | `apps/web/app/appraisal/page.tsx`, `apps/web/lib/appraisal/client.ts` | manual `/appraisal` + route curl |
| Chat API orchestration | `apps/web/app/api/chat/route.ts` | `apps/web/lib/chat/router.ts`, `apps/web/lib/chat/handlers/` | smoke suite + targeted curl |
| Recommendation endpoint | `apps/web/app/api/recommend/route.ts` | `apps/web/lib/recommend/pipeline.ts`, `apps/web/lib/filters/` | `qa:e2e-smoke` recommendation cases |
| Supabase inventory query | `apps/web/lib/inventory/list.ts` | `apps/web/lib/supabase/admin.ts`, `apps/web/lib/recommend/pipeline.ts` | inventory page + smoke |
| Session persistence | `apps/web/lib/chat/session-store.ts` | `apps/web/lib/chat/session-repo.ts`, `packages/db/migrations/20260223_chat_sessions.sql` | session curl sequence + DB check |
| Prompt layering | `apps/web/lib/prompts/recommendation-stack.ts` | `apps/web/lib/prompts/layers.ts`, `apps/web/lib/chat/prompt-builder.ts`, `docs/prompts/` | smoke report `prompt_layer_preview` + artifacts |
| Role/auth policy | `apps/web/lib/auth/policy.ts` | `apps/web/lib/auth/request-role.ts`, `apps/web/app/api/ui-role/route.ts` | cookie mismatch curl checks |
| Debug/QA traces | `apps/web/lib/qa/` | `apps/web/app/api/debug/trace/route.ts`, `scripts/e2e-smoke.mjs` | `docs/testing/e2e-smoke-report.*` |
| Inventory browse page | `apps/web/app/inventory/page.tsx` | `apps/web/lib/inventory/list.ts` | manual `/inventory` filters |

## Change Rules

1. Route file changes should stay thin and push logic into `apps/web/lib/*`.
2. Any role/permission behavior change must update:
   - `docs/design/role-capability-matrix.md`
3. Any prompt-layer change must update:
   - `docs/prompts/*` and smoke trace expectations.
4. Any session-shape change must update:
   - `docs/master-context.md`

## Lockfile Policy

- Workspace package manager: npm.
- Canonical lockfile: `package-lock.json`.
- Do not commit `apps/web/package-lock.json`.
