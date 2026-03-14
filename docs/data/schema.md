# Runtime Data Schema

This doc lists the fields currently used by runtime code paths.

## Tenant Rule

All inventory-backed tables are tenant scoped. Runtime queries must include `tenant_id`.

## `tenants`

Runtime-required:
- `id`

Commonly present/used:
- `settings` (jsonb)
- `created_at`

## `rugs`

Runtime-required fields:
- `id`
- `tenant_id`
- `stock_id` (nullable)
- `status` (`available`, `on_hold`, `sold`)
- `width_ft`, `width_in`, `length_ft`, `length_in`
- `width_total_in`, `length_total_in` (computed/generated in DB)
- `intake_label` (nullable during processing)
- `ai_description` (nullable)
- `ai_structured_fields` (jsonb nullable)
- `staff_overrides` (jsonb nullable)
- `created_at`, `updated_at`

Removed from runtime:
- `contextual_blurb`

## `rug_images`

Runtime-used fields:
- `id`
- `tenant_id`
- `rug_id`
- `path` (storage object key only)

Current shape expectation:
- one row per rug (`rug_id` unique index)

## `chat_sessions`

Used by runtime chat persistence (`/api/chat`).

- `session_id` (pk)
- `tenant_id` (nullable)
- `role`
- `session_data` (jsonb)
- `created_at`
- `updated_at`

## `chat_messages`

Used by runtime turn history persistence (`/api/chat`).

- `id` (uuid pk)
- `session_id` (fk -> `chat_sessions.session_id`, cascade delete)
- `tenant_id` (nullable)
- `role` (`user`, `assistant`)
- `mode` (`general_chat`, `recommendation`)
- `content`
- `metadata` (jsonb)
- `created_at`

## Storage

Bucket:
- `rug-images`

Object keys used by runtime scripts/routes:
- intake path: `{TENANT_UUID}/{RUG_UUID}/primary-{timestamp}.{ext}`
- demo seed path: `{TENANT_UUID}/{RUG_UUID}/photo.{jpg|png}`

Runtime builds public URLs from `rug_images.path` at read time.
