BEGIN;

ALTER TABLE public.rugs
  DROP COLUMN IF EXISTS contextual_blurb;

COMMIT;
