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

---

## Data Layer (Supabase / Postgres)

### Multi-Tenant Design
- One shared database
- All business-owned tables include `tenant_id`
  - `rugs`
  - `rug_images`
  - `trade_clients`
  - `appraisals`
- Row Level Security (RLS) enforces tenant isolation
- No cross-tenant data access is possible

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
- Optional photos

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
- AI-assisted photo enrichment (suggestions only, owner-approved)

### Inventory Tables
- `rugs` — primary inventory record
- `rug_images` — photos, ordered per rug

Both tables:
- are tenant-scoped
- allow optional/custom fields
- support incomplete data safely

---

## Stack & Deployment

- ?? **Frontend + Backend:** Next.js (App Router) + TypeScript
- ?? **Styling:** Tailwind CSS + shadcn/ui
- **Auth / DB / Storage:** Supabase
- ?? **Hosting:** Vercel
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
