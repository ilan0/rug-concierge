# Schema (MVP)

## tenants
Represents a rug business.

- `id`
- `name`
- `settings` (JSON)
  - branding (logo, letterhead refs)
  - trade defaults (workflow preferences, optional)
- Used for multi-tenancy and isolation

---

## profiles
Maps authenticated users to a tenant.

- `id`
- `user_id` (auth)
- `tenant_id`
- `role` (v1: internal / public)

---

## trade_clients
Designers and repeat trade buyers.

- `id`
- `tenant_id`
- `name`
- `company`
- `contact_info`
- `preferences` (JSON)
  - workflow & presentation preferences
  - NOT personal aesthetic taste
- Used for continuity and efficiency, not filtering

---

## rugs
One row per physical rug in inventory.

Required:
- `id`
- `tenant_id`
- `intake_label`
- `status` (available, sold, on_hold)
- `width_ft`, `width_in`
- `length_ft`, `length_in`
- `width_total_in`
- `length_total_in`
- `price`
- `sale_price` (optional)

Optional / enrichable:
- `style`
- `origin_country`
- `palette`
- `pattern`
- `condition`
- `best_for` (soft guidance only)
- hashtags (text[])
- `public_description`
- `internal_notes`
- `custom_fields` (JSON)

Designed for fast intake + later enrichment.

---

## rug_images
Image metadata for rugs.

- `id`
- `tenant_id`
- `rug_id`
- `storage_path`
- `sort_order`
- `is_primary`

Actual image files live in Supabase Storage.

---

## appraisals
Appraisal drafts and finals.

- `id`
- `tenant_id`
- `rug_id` (nullable for customer-owned rugs)
- `customer_info`
- `description_text`
- `appraised_value`
- `status` (draft, finalized)
- `custom_fields` (JSON)

Used internally only. AI generates drafts; staff approves final.

---

## Notes
- All business-owned tables include `tenant_id`
- RLS enforces isolation
- No schema assumes complete data
- AI operates only on explicit fields