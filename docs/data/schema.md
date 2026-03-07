# Data Schema (Runtime Contract View)

This doc describes the data shape expected by current runtime code.
It is a practical contract, not a full migration history.

## Multi-Tenant Rule

Business tables are tenant scoped via `tenant_id`.
Inventory-backed APIs must never cross tenant boundaries.

## Core Tables

### `tenants`

- `id`
- `name`
- `settings` (JSON)

### `trade_clients`

- `id`
- `tenant_id`
- `name`
- `company`
- `contact_info`
- `preferences` (JSON; soft signals only)

### `rugs`

Runtime-required fields:
- `id`
- `tenant_id`
- `intake_label`
- `status` (`available`, `sold`, `on_hold`)
- `width_ft`, `width_in`, `length_ft`, `length_in`
- `width_total_in`, `length_total_in`
- `price` (nullable)
- `sale_price` (nullable)

Optional enrichment fields:
- `sku`
- `style`
- `origin_country`
- `palette`
- `pattern`
- `condition`
- `best_for`
- `hashtags`
- `public_description`
- `internal_notes`
- `custom_fields`

Intake V1 write defaults:
- `status = "available"`
- `price = null`
- `sale_price = null`

### `rug_images`

Runtime-used fields:
- `tenant_id`
- `rug_id`
- `path` (storage object key, not full URL)
- `is_primary`
- `sort_order`

### `appraisals`

- `id`
- `tenant_id`
- `rug_id` (nullable for customer-owned rugs)
- `status` (`draft`, `finalized`, plus workflow statuses)
- appraisal context/payload fields used by appraisal APIs

### `chat_sessions`

- `session_id`
- `tenant_id` (nullable in limited non-tenant flows)
- `role`
- `session_data` (JSONB)
- `created_at`, `updated_at`

### `chat_messages`

- `id`
- `session_id`
- `tenant_id`
- `role` (`user` or `assistant`)
- `mode`
- `content`
- `metadata` (JSONB)
- `created_at`

## Storage

- Supabase bucket: `rug-images`
- Object key convention: `TENANT_UUID/RUG_UUID/<filename>`
- Public URL generated at runtime from bucket + key
