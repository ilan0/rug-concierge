ALTER TABLE public.rugs
  ADD COLUMN IF NOT EXISTS staff_overrides JSONB DEFAULT NULL;

COMMENT ON COLUMN public.rugs.staff_overrides IS
  'Staff corrections over AI fields. Shape: StaffOverrides. Never written by enrichment pipeline.';
