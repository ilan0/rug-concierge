# Morning Report — Overnight Mission

Generated: 2026-02-26

## Scope Completed

- Stabilized backend chat mode semantics with explicit coarse vs fine mode.
- Hardened router predictability and ambiguity detection.
- Improved general chat flow quality (clarification behavior, context hygiene, follow-up handling).
- Upgraded concierge UX clarity (fine-mode badges, constraint bar/actions, auto-scroll + jump, retry UX).

## Files Touched

### Backend + Types
- `/Users/ilannabatkhorian/Documents/rug-concierge/apps/web/app/api/chat/route.ts`
- `/Users/ilannabatkhorian/Documents/rug-concierge/apps/web/lib/chat/router.ts`
- `/Users/ilannabatkhorian/Documents/rug-concierge/apps/web/lib/chat/types.ts`
- `/Users/ilannabatkhorian/Documents/rug-concierge/apps/web/lib/chat/prompt-builder.ts`
- `/Users/ilannabatkhorian/Documents/rug-concierge/apps/web/lib/chat/handlers/general-chat.ts`
- `/Users/ilannabatkhorian/Documents/rug-concierge/apps/web/lib/ai/general-chat.ts`
- `/Users/ilannabatkhorian/Documents/rug-concierge/apps/web/lib/prompts/general-chat-stack.ts`
- `/Users/ilannabatkhorian/Documents/rug-concierge/apps/web/lib/prompts/layers.ts`
- `/Users/ilannabatkhorian/Documents/rug-concierge/apps/web/lib/prompts/layer-ids.ts`
- `/Users/ilannabatkhorian/Documents/rug-concierge/apps/web/lib/types/chat-ui.ts`

### Frontend UX
- `/Users/ilannabatkhorian/Documents/rug-concierge/apps/web/components/concierge/use-concierge-controller.ts`
- `/Users/ilannabatkhorian/Documents/rug-concierge/apps/web/components/concierge/chat-thread.tsx`
- `/Users/ilannabatkhorian/Documents/rug-concierge/apps/web/components/concierge/message-composer.tsx`
- `/Users/ilannabatkhorian/Documents/rug-concierge/apps/web/components/concierge/concierge-screen.tsx`
- `/Users/ilannabatkhorian/Documents/rug-concierge/apps/web/components/concierge/operator-drawer.tsx`
- `/Users/ilannabatkhorian/Documents/rug-concierge/apps/web/components/concierge/types.ts`
- `/Users/ilannabatkhorian/Documents/rug-concierge/apps/web/components/concierge/utils.ts`
- `/Users/ilannabatkhorian/Documents/rug-concierge/apps/web/app/globals.css`

### Testing + Docs
- `/Users/ilannabatkhorian/Documents/rug-concierge/scripts/e2e-smoke.mjs`
- `/Users/ilannabatkhorian/Documents/rug-concierge/docs/prompts/general-chat.md`
- `/Users/ilannabatkhorian/Documents/rug-concierge/docs/master-context.md`
- `/Users/ilannabatkhorian/Documents/rug-concierge/docs/design/chat-orchestration.md`

## What Changed

1. `/api/chat` now returns both:
   - `mode` (coarse route mode)
   - `fine_mode` (turn outcome mode)

2. Router now uses explicit ordered rule table with precedence constant:
   - `ROUTE_RULE_PRECEDENCE` in `router.ts`.
   - Ambiguity now only triggers on constraint-only text lacking intent verbs.

3. General-chat clarification behavior:
   - Removed fixed route-level clarification string.
   - Clarification now model-generated via general-chat handler, with deterministic fallback follow-up question.

4. General-chat context hygiene:
   - Structured-state context prompt block is conditionally included (active hard constraints and/or trade/project context only).

5. UI now consumes and renders fine mode:
   - Assistant turn badges reflect `fine_mode`.

6. Follow-up question is no longer dropped:
   - Rendered as “Suggested Next Step” under assistant messages when present.

7. Constraint visibility/actions:
   - Added Active Constraints bar.
   - Added quick actions (text-intent based): `clear budget`, `clear size`, `start over constraints`.

8. Chat UX reliability:
   - Auto-scroll with sticky behavior.
   - “Jump to latest” pill appears when user scrolls up.
   - Retry button appears on send errors.

9. CSS primitives added:
   - `.ui-badge`
   - `.ui-pill`
   - `.ui-btn--primary`
   - `.ui-btn--ghost`
   - `.ui-card`

## Validation Results

- `npm --workspace apps/web run lint` ✅
- `npm --workspace apps/web run build` ✅
- `SMOKE_TENANT_ID=0a175457-6194-4ae9-bf4e-1a785d754c4b npm run qa:e2e-smoke` ✅ (21/21)
- `SMOKE_TENANT_ID=0a175457-6194-4ae9-bf4e-1a785d754c4b npm run qa:demo-rehearsal` ✅ (7/7)

## Known Risks

1. Fine-mode semantics are now richer; any client relying only on coarse mode should remain compatible, but third-party consumers should migrate to `fine_mode` for precise UI behavior.
2. Clarification quality is now model-dependent for ambiguous constraint-only turns; fallback is present but still less nuanced than model response.
3. New auto-scroll behavior depends on container height/scroll on all viewport sizes; verify on smaller laptop/mobile widths.

## Manual Verify First Thing

1. Retail flow:
   - Ask: “show me 8x10 under $2500” -> recommendation.
   - Ask: “is 8x10 good for living room?” -> general chat fine mode.
   - Use “Clear budget” chip and confirm constraint bar updates.

2. Constraint-only ambiguity:
   - Ask: “8x10 under $2500” and confirm fine-mode badge `clarifying question`.

3. Staff review controls:
   - In recommendation context, click Regenerate and confirm recommendation coarse mode + valid fine mode.

4. Developer debug:
   - `/concierge?debug=1`, send one general and one recommendation turn.
   - Confirm traces still load and routing rule id is visible.

5. Appraisal path:
   - Staff appraisal generate remains functional.
   - Retail appraisal remains blocked.
