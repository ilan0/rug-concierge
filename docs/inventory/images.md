# Rug Images

Runtime image model for inventory and intake.

## Storage

- Bucket: `rug-images`
- `rug_images.path` stores object keys only (no full URL)
- Path convention:
  - `TENANT_UUID/RUG_UUID/front.jpg`
  - `TENANT_UUID/RUG_UUID/detail-1.jpg`

Public URLs are generated at runtime with Supabase storage API.

## `rug_images` Runtime Fields

- `tenant_id`
- `rug_id`
- `path`
- `is_primary`
- `sort_order`

## Selection Behavior (Current MVP)

- Runtime queries `rug_images` by `tenant_id` + rug IDs.
- Expected data shape is one primary image row per rug.
- If multiple valid rows exist for a rug, first valid row returned is used.
- If no valid image row exists, UI falls back to placeholder.

## Intake Interaction

`POST /api/inventory/intake` writes:
- storage object to `rug-images`
- one `rug_images` row with `is_primary=true`, `sort_order=0`

On downstream failure, intake performs compensating cleanup to avoid orphan rows/files.
