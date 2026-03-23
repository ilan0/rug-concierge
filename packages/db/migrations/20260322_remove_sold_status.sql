BEGIN;

-- Retire the sold status from the live app contract.
UPDATE public.rugs
SET status = 'on_hold'
WHERE status = 'sold';

ALTER TABLE public.rugs
  DROP CONSTRAINT IF EXISTS rugs_status_valid;

ALTER TABLE public.rugs
  ADD CONSTRAINT rugs_status_valid
  CHECK (status IN ('available', 'on_hold'));

COMMIT;
