# Rug Images (MVP)

Rug images are read from Supabase Storage bucket `rug-images` and mapped from `rug_images` table rows.

## Table Expectations

- Table: `rug_images`
- Required columns used by runtime:
  - `tenant_id`
  - `rug_id`
  - `path`
  - `is_primary`
  - `sort_order`
  - `created_at`

Runtime always filters by `tenant_id` and by target `rug_id` list.

## Path Convention

Store only object keys in `rug_images.path` (not full URLs), for example:

- `TENANT_UUID/RUG_UUID/front.jpg`
- `TENANT_UUID/RUG_UUID/detail-1.jpg`

Public URLs are generated at runtime with Supabase `storage.from("rug-images").getPublicUrl(path)`.

## Primary Image Selection

Per rug, the selected image is the first by this priority:

1. `is_primary DESC`
2. `sort_order ASC`
3. `created_at ASC`

If no image row exists (or URL cannot be generated), UI falls back to a placeholder.
