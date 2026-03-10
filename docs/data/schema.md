# Data Schema (Runtime Contract)

This doc describes the schema required by the current runtime.

## Multi-Tenant Rule

Inventory-backed tables are scoped by `tenant_id`.
All inventory queries must include tenant scope.

## Core Tables

### `tenants`

- `id`
- `name`
- `settings` (JSON)

### `rugs`

Runtime fields:
- `id`
- `tenant_id`
- `intake_label`
- `status` (`available`, `sold`, `on_hold`)
- `width_total_in`
- `length_total_in`
- `ai_description` (nullable)
- `contextual_blurb` (nullable)

Compatibility fields may still exist in DB but are not used by current runtime.

### `rug_images`

Runtime-used fields:
- `tenant_id`
- `rug_id`
- `path` (storage object key)
- `is_primary`
- `sort_order`

### `chat_sessions`

- `session_id`
- `tenant_id` (nullable for non-inventory chat)
- `role`
- `session_data` (JSONB)
- `created_at`
- `updated_at`

### `chat_messages`

- `id`
- `session_id`
- `tenant_id`
- `role` (`user`, `assistant`)
- `mode` (`general_chat`, `recommendation`)
- `content`
- `metadata` (JSONB)
- `created_at`

## Storage

Supabase bucket:
- `rug-images`

Object key format:
- `{TENANT_UUID}/{RUG_UUID}/primary-{timestamp}.{ext}`
