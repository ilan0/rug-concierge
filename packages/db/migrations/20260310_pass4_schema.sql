begin;

alter table public.rugs
  alter column intake_label drop not null;

alter table public.rugs
  add column if not exists ai_structured_fields jsonb null,
  add column if not exists stock_id text null;

comment on column public.rugs.intake_label is
  'AI-generated label from vision intake. NULL until AI processing completes.';

comment on column public.rugs.ai_structured_fields is
  'AI-extracted key-value fields from rug photo. NULL until AI processing completes.';

comment on column public.rugs.stock_id is
  'Optional staff-inputted inventory stock ID. NULL if not provided at intake.';

commit;
