-- Pass 4: AI-first intake schema

-- 0) Pre-check current intake_label nullability
SELECT column_name, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'rugs'
  AND column_name = 'intake_label';

BEGIN;

-- 1) intake_label becomes nullable (only if currently NOT NULL)
DO $$
DECLARE
  v_is_nullable text;
BEGIN
  SELECT c.is_nullable
  INTO v_is_nullable
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
    AND c.table_name = 'rugs'
    AND c.column_name = 'intake_label';

  IF v_is_nullable = 'NO' THEN
    EXECUTE 'ALTER TABLE public.rugs ALTER COLUMN intake_label DROP NOT NULL';
  END IF;
END $$;

COMMENT ON COLUMN public.rugs.intake_label IS
  'AI-generated label from vision intake. NULL until AI processing completes.';

-- 2) ai_structured_fields (JSONB from AI extraction)
ALTER TABLE public.rugs
  ADD COLUMN IF NOT EXISTS ai_structured_fields JSONB NULL;

COMMENT ON COLUMN public.rugs.ai_structured_fields IS
  'AI-extracted key-value fields from rug photo. NULL until AI processing completes.';

-- 3) stock_id (optional staff-entered stock/SKU id)
ALTER TABLE public.rugs
  ADD COLUMN IF NOT EXISTS stock_id TEXT NULL;

COMMENT ON COLUMN public.rugs.stock_id IS
  'Optional staff-inputted inventory stock ID. NULL if not provided at intake.';

COMMIT;

-- 4) Verification
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'rugs'
ORDER BY ordinal_position;
