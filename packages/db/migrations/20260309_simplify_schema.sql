-- Add AI-generated fields to rugs table
ALTER TABLE public.rugs
  ADD COLUMN IF NOT EXISTS ai_description TEXT,
  ADD COLUMN IF NOT EXISTS contextual_blurb TEXT;

COMMENT ON COLUMN public.rugs.ai_description IS 'AI-generated description from GPT-4o vision during intake. NULL until async vision call completes.';
COMMENT ON COLUMN public.rugs.contextual_blurb IS 'AI-generated contextual info for the rug detail popup. Cached after first generation via /api/rugs/[id].';

-- Note: Old columns (price, sale_price, style, palette, pattern, best_for, public_description, sku)
-- are NOT dropped here. They are deprecated in code but retained for data safety.
-- Drop them in a future cleanup migration after confirming no data loss risk.
