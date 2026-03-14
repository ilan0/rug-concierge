# Inventory Images

Current image model used by intake, recommendation, and inventory detail APIs.

## Storage Contract

- bucket: `rug-images`
- DB stores object keys in `rug_images.path` (not full URLs)
- runtime builds public URLs with shared helper logic (`rugImagePathToPublicUrl`)

## DB Contract (`rug_images`)

- required fields: `tenant_id`, `rug_id`, `path`
- expected cardinality: one image row per rug (`rug_id` unique)

## Write Paths

`POST /api/inventory/intake`:
- uploads image to storage
- inserts one `rug_images` row
- on downstream failure, performs best-effort cleanup

`scripts/seed-demo-rugs.ts`:
- uploads demo images to storage
- inserts one `rug_images` row per seeded demo rug
- idempotent by `rugs.stock_id`

## Read Paths

- recommendation pipeline fetches primary image URLs by tenant + rug IDs
- retail detail (`/api/rugs/[id]`) fetches image URL for one rug
- staff detail routes fetch image URL similarly

Candidates with missing image URLs are dropped from recommendation responses.
