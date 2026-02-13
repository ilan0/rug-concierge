# System Overview (v1)

This document provides a high-level view of how the system is structured
and how data flows through the application.

The goal is clarity, not exhaustiveness.

---

## Architecture Summary

- **Single codebase**
- **Single Supabase database**
- **Multi-tenant via `tenant_id`**
- **AI behavior controlled by layered prompts**
- **Primary AI workflows: recommendations and appraisals**
- **Backend-first chat routing (mode is chosen by backend before AI task execution)**

---

## Chat Entry & Mode Routing

All user chat enters through backend first.

Backend responsibilities:
- determine whether the message is `general_chat` or `recommendation`
- request clarification when intent is ambiguous
- enforce hard constraints and inventory grounding for recommendation mode

AI responsibilities:
- in general chat: provide informational freeform responses
- in recommendation mode: rank and explain only within backend-provided inventory candidates

---

## AI Prompt Layers

AI behavior is controlled by layered prompts, each with a clear role:

1. **System Prompt**
   - Defines identity and trust
   - Used in all AI calls

2. **Task Prompt**
   - Defines what the AI is doing (recommendation or appraisal)

3. **Context Blocks**
   - Injected data for the task (inventory, trade preferences, appraisal fields)

4. **Structured Output Add-on (when required)**
   - Enforces JSON-only output when the UI needs deterministic structure

---

## AI Modes

### A) General Chat (Freeform)

Used when the user is not selecting inventory.

Prompts used:
- docs/prompts/system.md

Output:
- plain text

---

### B) Concierge Recommendations (Structured)

Used when the user is trying to find rugs from inventory.

Prompts used (in order):
- docs/prompts/system.md
- docs/prompts/recommendation.md
- Optional: trade client context
- Inventory context (hard-coded JSON now; DB results later)
- docs/prompts/recommendation-structured-output.md

Output:
- JSON only (assistant_message + rug cards)

Inventory context is pre-filtered by hard constraints.
See `docs/design/concierge-flow.md` for constraints and no-match logic.

---

### C) Appraisal Draft Mode (Internal)

Used by owner/staff only.

Prompts used:
- docs/prompts/system.md
- Appraisal Draft Prompt (TBD)
- Appraisal context
- Optional rug context
- Structured output add-on (if used)

Output:
- Draft text + metadata (always reviewed before finalization)

---

### Trade Clients (Designers)

Trade clients are context, not a separate mode:
- preferences are injected as a context block
- they influence ranking and phrasing
- they do not change output structure

---

## Data Layer (Supabase / Postgres)

### Multi-Tenant Design
- One shared database
- All business-owned tables include `tenant_id`
  - `rugs`
  - `rug_images`
  - `trade_clients`
  - `appraisals`
- Row Level Security (RLS) is intended to enforce tenant isolation
- Cross-tenant access should be impossible once policies are fully in place

This allows:
- fast onboarding of new rug businesses
- schema consistency
- scalable SaaS deployment

---

## Inventory Design Philosophy

Inventory is the foundation of the product.
AI quality depends on inventory quality.

### Inventory Intake (Fast Path)
Uploading a rug must be simple and fast:
- SKU (arbitrary per store)
- Size
- One-line description
- Optional hashtags, photos, (& all other fields)

This supports rapid inventory movement and non-technical staff.

### Inventory Enrichment (Later / Optional)
Additional fields can be filled later for:
- appraisals
- designer requests
- high-value sales

Optional enrichment includes:
- materials
- construction
- condition
- origin / style
- AI-assisted photo enrichment (suggestions only, owner-approved, PAID FEATURE)

### Inventory Tables
- `rugs` — primary inventory record
- `rug_images` — photos, ordered per rug

Both tables:
- are tenant-scoped
- allow optional/custom fields
- support incomplete data safely

---

## Stack & Deployment

- **Frontend + Backend (TBD):** Next.js (App Router) + TypeScript
- **Styling (TBD):** Tailwind CSS + shadcn/ui
- **Auth / DB / Storage:** Supabase
- **Hosting (TBD):** Vercel
- **Repo:** Single monorepo

---

## Design Principles

- AI behavior is predictable and conservative
- Inventory is the source of truth
- Structured output is used only when the UI depends on it
- Prompts define behavior, data defines reality
- No premature optimization or over-design

This document intentionally stays high-level.
Details live in individual prompt and schema docs.
