begin;

alter table public.rug_images
  add column if not exists original_path text null,
  add column if not exists enhancement_status text not null default 'not_started',
  add column if not exists enhancement_model text null,
  add column if not exists enhanced_at timestamptz null,
  add column if not exists enhancement_error text null;

update public.rug_images
set original_path = path
where (original_path is null or length(trim(original_path)) = 0)
  and path is not null
  and length(trim(path)) > 0;

alter table public.rug_images
  drop constraint if exists rug_images_enhancement_status_valid;

alter table public.rug_images
  add constraint rug_images_enhancement_status_valid
  check (enhancement_status in ('not_started', 'processing', 'ready', 'failed'));

create index if not exists idx_rug_images_tenant_enhancement_status_created
  on public.rug_images using btree (tenant_id, enhancement_status, created_at);

alter table public.rugs
  drop constraint if exists rugs_review_reason_code_valid;

alter table public.rugs
  add constraint rugs_review_reason_code_valid
  check (
    review_reason_code is null
    or review_reason_code in (
      'ANALYSIS_INCOMPLETE',
      'ANALYSIS_FAILED',
      'NON_RUG_DETECTED',
      'IMAGE_ENHANCEMENT_FAILED'
    )
  );

comment on column public.rug_images.original_path is
  'Supabase Storage path for the original uploaded intake photo kept as backup after path is swapped to the enhanced display image.';

comment on column public.rug_images.enhancement_status is
  'Image enhancement lifecycle: not_started, processing, ready, failed.';

comment on column public.rug_images.enhancement_model is
  'Model used to generate the current enhanced display image.';

comment on column public.rug_images.enhanced_at is
  'Timestamp when the current enhanced display image was written to path.';

comment on column public.rug_images.enhancement_error is
  'Last enhancement failure message for operator debugging.';

comment on column public.rugs.review_reason_code is
  'Reason code for needs_review records (ANALYSIS_INCOMPLETE, ANALYSIS_FAILED, NON_RUG_DETECTED, IMAGE_ENHANCEMENT_FAILED).';

commit;
