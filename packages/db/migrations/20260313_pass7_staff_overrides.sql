begin;

alter table public.rugs
  add column if not exists staff_overrides jsonb default null;

comment on column public.rugs.staff_overrides is
  'Staff corrections over AI fields. Shape: StaffOverrides. Never written by enrichment pipeline.';

commit;
