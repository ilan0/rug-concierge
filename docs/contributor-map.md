# Contributor Map (Where to Edit)

Use this map first when you start a task. Goal: find the right files in under 15 minutes.

## Entry Docs

1. `/Users/ilannabatkhorian/Documents/rug-concierge/docs/master-context.md`
2. `/Users/ilannabatkhorian/Documents/rug-concierge/docs/design/chat-orchestration.md`
3. `/Users/ilannabatkhorian/Documents/rug-concierge/docs/design/concierge-flow.md`

## Feature Areas

| Feature Area | Edit Here First | Supporting Files | Validate With |
| --- | --- | --- | --- |
| UI shell + navigation | `/Users/ilannabatkhorian/Documents/rug-concierge/apps/web/components/shell/workspace-nav.tsx` | `/Users/ilannabatkhorian/Documents/rug-concierge/apps/web/app/page.tsx`, `/Users/ilannabatkhorian/Documents/rug-concierge/apps/web/app/globals.css` | manual route check + `npm --workspace apps/web run build` |
| Concierge UI (retail) | `/Users/ilannabatkhorian/Documents/rug-concierge/apps/web/components/concierge/concierge-screen.tsx` | `/Users/ilannabatkhorian/Documents/rug-concierge/apps/web/components/concierge/use-concierge-controller.ts`, `/Users/ilannabatkhorian/Documents/rug-concierge/apps/web/components/concierge/*` | `npm run qa:e2e-smoke -- --case \"chat\"` + manual `/concierge` |
| Trade UI workflow | `/Users/ilannabatkhorian/Documents/rug-concierge/apps/web/app/trade/page.tsx` | `/Users/ilannabatkhorian/Documents/rug-concierge/apps/web/components/concierge/concierge-screen.tsx`, `/Users/ilannabatkhorian/Documents/rug-concierge/apps/web/lib/types/trade-ui.ts` | smoke + manual `/trade` |
| Appraisal UI + export | `/Users/ilannabatkhorian/Documents/rug-concierge/apps/web/components/appraisal/appraisal-screen.tsx` | `/Users/ilannabatkhorian/Documents/rug-concierge/apps/web/app/appraisal/page.tsx`, `/Users/ilannabatkhorian/Documents/rug-concierge/apps/web/lib/appraisal/client.ts` | manual `/appraisal` + route curl |
| Chat API orchestration | `/Users/ilannabatkhorian/Documents/rug-concierge/apps/web/app/api/chat/route.ts` | `/Users/ilannabatkhorian/Documents/rug-concierge/apps/web/lib/chat/router.ts`, `/Users/ilannabatkhorian/Documents/rug-concierge/apps/web/lib/chat/handlers/*` | smoke suite + targeted curl |
| Recommendation endpoint | `/Users/ilannabatkhorian/Documents/rug-concierge/apps/web/app/api/recommend/route.ts` | `/Users/ilannabatkhorian/Documents/rug-concierge/apps/web/lib/recommend/pipeline.ts`, `/Users/ilannabatkhorian/Documents/rug-concierge/apps/web/lib/filters/*` | `qa:e2e-smoke` recommendation cases |
| Supabase candidate query | `/Users/ilannabatkhorian/Documents/rug-concierge/apps/web/lib/supabase/inventory.ts` | `/Users/ilannabatkhorian/Documents/rug-concierge/apps/web/lib/supabase/admin.ts`, `/Users/ilannabatkhorian/Documents/rug-concierge/apps/web/lib/inventory/list.ts` | inventory page + smoke |
| Session persistence | `/Users/ilannabatkhorian/Documents/rug-concierge/apps/web/lib/chat/session-store.ts` | `/Users/ilannabatkhorian/Documents/rug-concierge/apps/web/lib/chat/session-repo.ts`, `/Users/ilannabatkhorian/Documents/rug-concierge/packages/db/migrations/20260223_chat_sessions.sql` | session curl sequence + DB check |
| Prompt layering | `/Users/ilannabatkhorian/Documents/rug-concierge/apps/web/lib/prompts/recommendation-stack.ts` | `/Users/ilannabatkhorian/Documents/rug-concierge/apps/web/lib/prompts/layers.ts`, `/Users/ilannabatkhorian/Documents/rug-concierge/apps/web/lib/chat/prompt-builder.ts`, `/Users/ilannabatkhorian/Documents/rug-concierge/docs/prompts/*` | smoke report `prompt_layer_preview` + artifacts |
| Role/auth policy | `/Users/ilannabatkhorian/Documents/rug-concierge/apps/web/lib/auth/policy.ts` | `/Users/ilannabatkhorian/Documents/rug-concierge/apps/web/lib/auth/request-role.ts`, `/Users/ilannabatkhorian/Documents/rug-concierge/apps/web/app/api/ui-role/route.ts` | cookie mismatch curl checks |
| Debug/QA traces | `/Users/ilannabatkhorian/Documents/rug-concierge/apps/web/lib/qa/*` | `/Users/ilannabatkhorian/Documents/rug-concierge/apps/web/app/api/debug/trace/route.ts`, `/Users/ilannabatkhorian/Documents/rug-concierge/scripts/e2e-smoke.mjs` | `docs/testing/e2e-smoke-report.*` |
| Inventory browse page | `/Users/ilannabatkhorian/Documents/rug-concierge/apps/web/app/inventory/page.tsx` | `/Users/ilannabatkhorian/Documents/rug-concierge/apps/web/lib/inventory/list.ts` | manual `/inventory` filters |

## Change Rules

1. Route file changes should stay thin and push logic into `apps/web/lib/*`.
2. Any role/permission behavior change must update:
   - `/Users/ilannabatkhorian/Documents/rug-concierge/docs/design/role-capability-matrix.md`
3. Any prompt-layer change must update:
   - `/Users/ilannabatkhorian/Documents/rug-concierge/docs/prompts/*` and smoke trace expectations.
4. Any session-shape change must update:
   - `/Users/ilannabatkhorian/Documents/rug-concierge/docs/master-context.md`

## Lockfile Policy

- Workspace package manager: npm.
- Canonical lockfile: `/Users/ilannabatkhorian/Documents/rug-concierge/package-lock.json`.
- Do not commit `/Users/ilannabatkhorian/Documents/rug-concierge/apps/web/package-lock.json`.
