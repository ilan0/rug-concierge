begin;

create extension if not exists pgcrypto;

alter table public.rugs
  add column if not exists enrichment_status text not null default 'processing',
  add column if not exists review_reason_code text null;

alter table public.rugs
  drop constraint if exists rugs_enrichment_status_valid;

alter table public.rugs
  add constraint rugs_enrichment_status_valid
  check (enrichment_status in ('processing', 'ready', 'needs_review'));

alter table public.rugs
  drop constraint if exists rugs_review_reason_code_valid;

alter table public.rugs
  add constraint rugs_review_reason_code_valid
  check (
    review_reason_code is null
    or review_reason_code in ('ANALYSIS_INCOMPLETE', 'ANALYSIS_FAILED')
  );

alter table public.rug_images
  add column if not exists image_sha256 text null;

update public.rug_images
set image_sha256 = encode(digest(concat_ws(':', tenant_id, rug_id::text, path), 'sha256'), 'hex')
where image_sha256 is null or length(trim(image_sha256)) = 0;

alter table public.rug_images
  alter column image_sha256 set not null;

drop index if exists public.rug_images_tenant_image_sha256_unique;

create unique index if not exists rug_images_tenant_image_sha256_unique
  on public.rug_images using btree (tenant_id, image_sha256);

create table if not exists public.inventory_enrichment_jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  rug_id uuid not null references public.rugs(id) on delete cascade,
  state text not null default 'queued',
  attempt_count integer not null default 0,
  max_attempts integer not null default 3,
  next_attempt_at timestamptz null,
  last_error text null,
  locked_at timestamptz null,
  lock_owner text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inventory_enrichment_jobs_state_valid
    check (
      state in (
        'queued',
        'retry_scheduled',
        'processing',
        'completed',
        'needs_review'
      )
    ),
  constraint inventory_enrichment_jobs_attempt_bounds
    check (attempt_count >= 0 and max_attempts >= 1 and attempt_count <= max_attempts)
);

create unique index if not exists inventory_enrichment_jobs_one_per_rug
  on public.inventory_enrichment_jobs using btree (rug_id);

create index if not exists idx_inventory_enrichment_jobs_state_next_attempt
  on public.inventory_enrichment_jobs using btree (state, next_attempt_at, created_at);

create index if not exists idx_inventory_enrichment_jobs_tenant_state_next_attempt
  on public.inventory_enrichment_jobs using btree (tenant_id, state, next_attempt_at, created_at);

create or replace function public.claim_inventory_enrichment_jobs(
  claim_limit integer,
  worker_id text
)
returns setof public.inventory_enrichment_jobs
language plpgsql
as $$
declare
  effective_limit integer := greatest(1, least(coalesce(claim_limit, 1), 50));
  effective_worker text := coalesce(nullif(trim(worker_id), ''), 'worker');
begin
  return query
  with candidates as (
    select j.id
    from public.inventory_enrichment_jobs j
    where (
      j.state = 'queued'
      or (j.state = 'retry_scheduled' and coalesce(j.next_attempt_at, now()) <= now())
      or (
        j.state = 'processing'
        and coalesce(j.locked_at, j.updated_at, j.created_at) <= now() - interval '10 minutes'
      )
    )
    order by coalesce(j.next_attempt_at, j.created_at) asc, j.created_at asc
    limit effective_limit
    for update skip locked
  ),
  claimed as (
    update public.inventory_enrichment_jobs target
    set
      state = 'processing',
      locked_at = now(),
      lock_owner = effective_worker,
      updated_at = now()
    where target.id in (select id from candidates)
    returning target.*
  )
  select * from claimed;
end;
$$;

comment on column public.rugs.enrichment_status is
  'AI enrichment lifecycle for intake records: processing, ready, needs_review.';

comment on column public.rugs.review_reason_code is
  'Reason code for needs_review records (ANALYSIS_INCOMPLETE, ANALYSIS_FAILED).';

comment on column public.rug_images.image_sha256 is
  'SHA-256 hash of uploaded image bytes for exact duplicate detection within tenant.';

comment on table public.inventory_enrichment_jobs is
  'Durable queue for async inventory vision enrichment processing.';

commit;
