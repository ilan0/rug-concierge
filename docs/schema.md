# Schema (MVP)

## tenants
Stores rug businesses. Includes settings JSON for branding/config.

## profiles
Maps auth user -> tenant_id.

## rugs
One row per physical rug. Required fields: tenant_id, intake_label, width/length, status.

## rug_images
Metadata for rug photos; actual files stored in Supabase Storage.