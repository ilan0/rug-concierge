BEGIN;

-- Normalize legacy status values to current app contract.
UPDATE public.rugs
SET status = 'on_hold'
WHERE status IN ('hold', 'offfloor');

ALTER TABLE public.rugs
  DROP CONSTRAINT IF EXISTS rugs_status_valid;

ALTER TABLE public.rugs
  ADD CONSTRAINT rugs_status_valid
  CHECK (status IN ('available', 'on_hold', 'sold'));

-- Remove legacy rug catalog columns no longer used by runtime.
ALTER TABLE public.rugs
  DROP COLUMN IF EXISTS size_label,
  DROP COLUMN IF EXISTS shape,
  DROP COLUMN IF EXISTS title,
  DROP COLUMN IF EXISTS internal_notes,
  DROP COLUMN IF EXISTS construction,
  DROP COLUMN IF EXISTS foundation,
  DROP COLUMN IF EXISTS pile_material,
  DROP COLUMN IF EXISTS origin_country,
  DROP COLUMN IF EXISTS region,
  DROP COLUMN IF EXISTS age_category,
  DROP COLUMN IF EXISTS approx_age_years,
  DROP COLUMN IF EXISTS condition,
  DROP COLUMN IF EXISTS primary_color,
  DROP COLUMN IF EXISTS secondary_colors,
  DROP COLUMN IF EXISTS traffic_rating,
  DROP COLUMN IF EXISTS ai_suggestions,
  DROP COLUMN IF EXISTS ai_suggestions_updated_at,
  DROP COLUMN IF EXISTS enrichment_state,
  DROP COLUMN IF EXISTS completeness_score,
  DROP COLUMN IF EXISTS custom_fields,
  DROP COLUMN IF EXISTS hashtags;

-- Simplify rug_images to one storage path per rug.
ALTER TABLE public.rug_images
  DROP COLUMN IF EXISTS caption,
  DROP COLUMN IF EXISTS is_primary,
  DROP COLUMN IF EXISTS sort_order;

DROP INDEX IF EXISTS public.rug_images_one_primary_per_rug;
DROP INDEX IF EXISTS public.rug_images_sort_idx;
DROP INDEX IF EXISTS public.rug_images_rug_path_unique;

CREATE UNIQUE INDEX IF NOT EXISTS rug_images_one_per_rug
  ON public.rug_images USING btree (rug_id);

COMMIT;
