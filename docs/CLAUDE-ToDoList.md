# Codebase Audit — Findings & To-Do List

Generated from full read-only audit (Phases 1–9). Items grouped by severity. Check off as fixed.

---

## 🔴 Critical

- [ ] **[C-1] Add auth guard to `/api/session/reset`**
  Anyone who knows a `session_id` + `tenant_id` can delete that session's DB records. No staff cookie check, no ownership verification.
  `apps/web/app/api/session/reset/route.ts`

- [ ] **[C-2] Fix `image_sha256` migration backfill**
  The migration backfills `image_sha256` using a hash of path metadata strings — not the actual image bytes. The app hashes raw uploaded bytes at intake time. These two schemes will never match, meaning every pre-migration image can be re-uploaded without triggering duplicate detection.
  `packages/db/migrations/20260318_inventory_enrichment_jobs_and_review_state.sql` (lines 29–31)

---

## 🟡 Warning

- [ ] **[W-1] Deduplicate `isLikelyMissingColumnError`**
  Identical function defined in both `lib/inventory/rug-record.ts:172` and `lib/recommend/pipeline.ts:801`. `list.ts` imports from `rug-record.ts` correctly; `pipeline.ts` has its own copy that can silently diverge.

- [ ] **[W-2] Deduplicate `TRADE_STYLE_ALIASES` and `PATTERN_STYLE_WORDS`**
  Both arrays are copy-pasted verbatim between `lib/inventory/title-builder.ts` and `lib/inventory/vision-enrichment.ts`. If one is updated without the other, enrichment output won't parse cleanly into titles.

- [ ] **[W-3] Reconcile `CANONICAL_STYLE_NAMES` (12 entries) with `TRADE_STYLE_ALIASES` (29 entries)**
  Serapi, Kashan, Isfahan, Tabriz, Kerman, Khotan, Mahal, Agra and others are recognized by the title builder but absent from `lib/inventory/style-normalization.ts`. The `resolveStyleValue` cascade used in the recommendation pipeline will not canonicalize these known trade names.

- [ ] **[W-4] Fix `staffOverridesSchema` origin field type**
  `staffOverridesSchema` accepts any freeform string for `origin`; `aiStructuredFieldsSchema` constrains it to the `RugOrigin` enum. `resolveEffectiveFields` takes the staff override at face value, so a freeform origin can produce values outside the canonical enum — causing downstream inconsistencies in recommendation filtering and title construction.
  `apps/web/lib/inventory/schemas.ts`

- [ ] **[W-5] Fix `detailToDraft` null field defaults in staff modal**
  When `age_category` is null it defaults to `"new"` and when `mood` is null it defaults to `"traditional"`. A staff member editing a rug with genuinely unknown age/mood will see these pre-filled and may save incorrect values without noticing.
  `apps/web/components/inventory/staff-rug-detail-modal.tsx`

- [ ] **[W-6] Consider adding retry before `ANALYSIS_INCOMPLETE` failure**
  When `requestVisionEnrichment` returns a result but `buildTradeTitle` returns null, `processOneJob` immediately sets the rug to `needs_review / ANALYSIS_INCOMPLETE` on the first attempt — no retries attempted. A transient model quality issue that misses origin or style permanently fails the rug on attempt 1.
  `apps/web/lib/inventory/enrichment-jobs.ts`

- [ ] **[W-7] Add DB index on `(tenant_id, enrichment_status)` for `rugs` table**
  `enrichment_status` was added to `rugs` with no index. Filtering the inventory by `needs_review` status will full-scan the tenant's rugs. Existing indexes cover `(tenant_id, status, ...)` but not `enrichment_status`.
  `packages/db/migrations/20260318_inventory_enrichment_jobs_and_review_state.sql`

- [ ] **[W-8] Fix `buildPromptLayers` hardcoding `hasChatMemoryContext: true`**
  Always asserts memory context is present even for fresh sessions with no memory content. Currently inert (result is trace-only), but risks injecting spurious memory prompt sections if this path is ever wired to actual prompt construction.
  `apps/web/lib/chat/prompt-builder.ts:22`

- [ ] **[W-9] Fix `"care"` substring matching in router and memory**
  `isGeneralAdviceOrEducation` in `lib/chat/router.ts` and `PRACTICAL_TERMS` in `lib/chat/memory.ts` both match on the substring `"care"`. Messages like `"I don't care about the pattern"` are mis-routed as general advice and stored as practical memory instead of being treated as constraint signals.

- [ ] **[W-10] Implement `toPriceUsd()` and `toImageCaption()` or remove from AI payload**
  Both functions always return `null` and are included in every recommendation payload sent to OpenAI. `price_usd` and `primary_image_caption` AI context fields are permanently dead.
  `apps/web/lib/ai/recommend.ts:276` and `:287`

- [ ] **[W-11] Make `parseStaffRugDetail` return null instead of throw on missing `effective_fields`**
  If the API response is missing `effective_fields` (API bug, stale cache, future schema change), this function throws an uncaught error rather than a typed failure, crashing the staff modal.
  `apps/web/lib/inventory/staff-client.ts`

- [ ] **[W-12] Fix `readiness()` fallback for null `enrichment_status`**
  For pre-migration rows with null `enrichment_status`, the fallback infers `ready` if a label exists and `processing` otherwise. Any pre-migration rug with a label that was never AI-enriched will be misclassified as `ready`.
  `apps/web/components/inventory/inventory-table-client.tsx`

- [ ] **[W-13] Replace CRON_SECRET plain string equality check with timing-safe comparison**
  `isAuthorizedRequest` uses `===` rather than a constant-time comparison. Practical risk is low in this server context but it is not timing-safe by design.
  `apps/web/app/api/inventory/enrichment/worker/route.ts:31`

- [ ] **[W-14] Add test for `needs_review_incomplete` outcome**
  `tests/enrichment-jobs.test.ts` covers retry scheduling, max-retry exhaustion, missing image, and missing rug — but has no test for the path where `requestVisionEnrichment` returns a result and `buildTradeTitle` returns null, producing the `needs_review_incomplete` outcome.

---

## 🔵 Cleanup

- [ ] **[CL-1] Remove or update `autoNamed` badge regex**
  Pattern `/^rug\s+[a-f0-9-]{6,}$/i` was written for old-style `"Rug <uuid>"` labels. `buildTradeTitle` now generates trade vocabulary titles and the fallback is `"Untitled Rug"` — neither matches. The "auto-named" badge UI state will never render.
  `apps/web/components/inventory/inventory-table-client.tsx`

- [ ] **[CL-2] Rename `toStaffInventoryRugDetail` or add a comment**
  Function name implies staff-only context but is also used in the fully public `/api/rugs/[id]/route.ts`. No data leak, but the naming will mislead future maintainers.

- [ ] **[CL-3] Pass `supabase` explicitly in intake route's `enqueueInventoryEnrichmentJob` call**
  The intake route omits `supabase` (falls back to module-level `supabaseAdmin`). The re-enrich route and `setRugProcessingState` both pass it explicitly. Minor inconsistency in calling convention.
  `apps/web/app/api/inventory/intake/route.ts`

- [ ] **[CL-4] Replace `window.location.reload()` after delete in staff modal**
  Full browser reload after successful delete. Should use Next.js router refresh or local state removal.
  `apps/web/components/inventory/staff-rug-detail-modal.tsx`

- [ ] **[CL-5] Replace `window.location.replace()` for filter changes with Next.js router navigation**
  Full page navigation instead of `router.push()` / `router.replace()`. Bypasses Next.js client-side routing.
  `apps/web/components/inventory/inventory-controls-client.tsx`

- [ ] **[CL-6] Remove deprecated `mq.addListener` fallback**
  `addListener`/`removeListener` are deprecated in all modern browsers. The `.addEventListener` branch is correctly preferred; the deprecated fallback can be removed.
  `apps/web/components/concierge/concierge-screen.tsx:59`
  `apps/web/components/inventory/inventory-controls-client.tsx`

- [ ] **[CL-7] Remove dead `useIntroSpacer = false` variable**
  Always `false`, used only in a class expression that always evaluates to `false`. The spacer div is never rendered.
  `apps/web/components/concierge/concierge-screen.tsx:111`

- [ ] **[CL-8] Route pipeline `console.warn` through trace system**
  `console.warn("[recommendation] Candidates dropped: missing primary image", {...})` fires in production. Should route through the existing trace system rather than raw `console.warn`.
  `apps/web/lib/recommend/pipeline.ts:640`

- [ ] **[CL-9] Make `resolveEffectiveFields` callers handle null label explicitly**
  The `"Untitled Rug"` hardcoded fallback hides a null label from callers, allowing it to surface in recommendation context and concierge chat. Callers should handle null explicitly.
  `apps/web/lib/inventory/resolve-fields.ts`

- [ ] **[CL-10] Document that `buildPromptLayers` in `general-chat.ts` is trace-only**
  The result of `buildPromptLayers` is captured and logged to traces but does not drive the actual prompt sent to OpenAI. This should be documented so future authors don't assume it controls prompt construction.
  `apps/web/lib/chat/handlers/general-chat.ts`
