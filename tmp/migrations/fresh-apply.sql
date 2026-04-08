-- 20260223_chat_sessions.sql
begin;

create extension if not exists pgcrypto;

create table if not exists public.chat_sessions (
  session_id text primary key,
  tenant_id text null,
  role text not null,
  session_data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  session_id text not null references public.chat_sessions(session_id) on delete cascade,
  tenant_id text null,
  role text not null,
  mode text null,
  content text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.chat_messages
  drop constraint if exists chat_messages_mode_check;

alter table public.chat_messages
  add constraint chat_messages_mode_check
  check (mode in ('general_chat', 'recommendation'));

alter table public.chat_messages
  drop constraint if exists chat_messages_role_check;

alter table public.chat_messages
  add constraint chat_messages_role_check
  check (role in ('user', 'assistant'));

create index if not exists idx_chat_sessions_tenant_updated
  on public.chat_sessions using btree (tenant_id, updated_at desc);

create index if not exists idx_chat_messages_session_created
  on public.chat_messages using btree (session_id, created_at);

create index if not exists idx_chat_messages_tenant_created
  on public.chat_messages using btree (tenant_id, created_at);

commit;

-- 20260309_simplify_schema.sql
begin;

create table if not exists public.tenants (
  id text primary key,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.rugs (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  stock_id text null,
  status text not null default 'available',
  width_ft integer not null,
  width_in integer not null,
  length_ft integer not null,
  length_in integer not null,
  width_total_in integer generated always as ((width_ft * 12) + width_in) stored,
  length_total_in integer generated always as ((length_ft * 12) + length_in) stored,
  intake_label text null,
  ai_description text null,
  ai_structured_fields jsonb null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.rug_images (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  rug_id uuid not null references public.rugs(id) on delete cascade,
  path text not null,
  created_at timestamptz not null default now()
);

alter table public.rugs
  drop constraint if exists rugs_status_valid;

alter table public.rugs
  add constraint rugs_status_valid
  check (status in ('available', 'on_hold', 'sold'));

create unique index if not exists rug_images_one_per_rug
  on public.rug_images using btree (rug_id);

commit;

-- 20260310_drop_legacy_features.sql
-- Destructive cleanup for removed legacy features.
-- Drops legacy appraisal and trade artifacts from the public schema.

begin;

-- Drop legacy tables (explicit and prefix-based).
do $$
declare
  r record;
begin
  for r in
    select schemaname, tablename
    from pg_tables
    where schemaname = 'public'
      and (
        tablename = 'appraisals'
        or tablename = 'trade_clients'
        or tablename like 'appraisal_%'
        or tablename like 'trade_%'
      )
  loop
    execute format('drop table if exists %I.%I cascade', r.schemaname, r.tablename);
  end loop;
end $$;

-- Drop legacy functions.
do $$
declare
  r record;
begin
  for r in
    select
      n.nspname as schema_name,
      p.proname as function_name,
      pg_get_function_identity_arguments(p.oid) as function_args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and (
        p.proname like 'appraisal%'
        or p.proname like 'trade%'
      )
  loop
    execute format(
      'drop function if exists %I.%I(%s) cascade',
      r.schema_name,
      r.function_name,
      r.function_args
    );
  end loop;
end $$;

-- Drop legacy custom types (enum/composite/domain).
do $$
declare
  r record;
begin
  for r in
    select n.nspname as schema_name, t.typname as type_name
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
      and t.typtype in ('e', 'c', 'd')
      and (
        t.typname like 'appraisal%'
        or t.typname like 'trade%'
      )
  loop
    execute format('drop type if exists %I.%I cascade', r.schema_name, r.type_name);
  end loop;
end $$;

-- Drop deprecated rug columns no longer used by runtime.
alter table public.rugs
  drop column if exists sku,
  drop column if exists price,
  drop column if exists sale_price,
  drop column if exists price_usd,
  drop column if exists sale_price_usd,
  drop column if exists style,
  drop column if exists palette,
  drop column if exists pattern,
  drop column if exists best_for,
  drop column if exists public_description;

-- Rebuild chat_messages mode constraint to current contract.
do $$
declare
  r record;
begin
  for r in
    select c.conname
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'chat_messages'
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%mode%'
  loop
    execute format('alter table public.chat_messages drop constraint if exists %I', r.conname);
  end loop;
end $$;

alter table public.chat_messages
  add constraint chat_messages_mode_check
  check (mode in ('general_chat', 'recommendation'));

commit;

-- 20260310_pass4_schema.sql
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

-- 20260313_pass7_staff_overrides.sql
begin;

alter table public.rugs
  add column if not exists staff_overrides jsonb default null;

comment on column public.rugs.staff_overrides is
  'Staff corrections over AI fields. Shape: StaffOverrides. Never written by enrichment pipeline.';

commit;

-- 20260314_drop_contextual_blurb.sql
BEGIN;

ALTER TABLE public.rugs
  DROP COLUMN IF EXISTS contextual_blurb;

COMMIT;

-- 20260314_rugs_schema_cleanup.sql
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

-- 20260315_baseline_and_performance_indexes.sql
begin;

create extension if not exists pgcrypto;

create table if not exists public.tenants (
  id text primary key,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.rugs (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  stock_id text null,
  status text not null default 'available',
  width_ft integer not null,
  width_in integer not null,
  length_ft integer not null,
  length_in integer not null,
  width_total_in integer generated always as ((width_ft * 12) + width_in) stored,
  length_total_in integer generated always as ((length_ft * 12) + length_in) stored,
  intake_label text null,
  ai_description text null,
  ai_structured_fields jsonb null,
  staff_overrides jsonb null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.rug_images (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  rug_id uuid not null references public.rugs(id) on delete cascade,
  path text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.chat_sessions (
  session_id text primary key,
  tenant_id text null,
  role text not null,
  session_data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  session_id text not null references public.chat_sessions(session_id) on delete cascade,
  tenant_id text null,
  role text not null,
  mode text null,
  content text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.rugs
  drop constraint if exists rugs_status_valid;

alter table public.rugs
  add constraint rugs_status_valid
  check (status in ('available', 'on_hold', 'sold'));

alter table public.chat_messages
  drop constraint if exists chat_messages_mode_check;

alter table public.chat_messages
  add constraint chat_messages_mode_check
  check (mode in ('general_chat', 'recommendation'));

alter table public.chat_messages
  drop constraint if exists chat_messages_role_check;

alter table public.chat_messages
  add constraint chat_messages_role_check
  check (role in ('user', 'assistant'));

create unique index if not exists rug_images_one_per_rug
  on public.rug_images using btree (rug_id);

create index if not exists idx_rugs_tenant_status_created
  on public.rugs using btree (tenant_id, status, created_at desc, id desc);

create index if not exists idx_rugs_tenant_status_size
  on public.rugs using btree (tenant_id, status, width_total_in, length_total_in);

create index if not exists idx_rugs_tenant_stock
  on public.rugs using btree (tenant_id, stock_id);

create index if not exists idx_chat_sessions_tenant_updated
  on public.chat_sessions using btree (tenant_id, updated_at desc);

create index if not exists idx_chat_messages_session_created
  on public.chat_messages using btree (session_id, created_at);

create index if not exists idx_chat_messages_tenant_created
  on public.chat_messages using btree (tenant_id, created_at);

commit;

-- 20260318_inventory_enrichment_jobs_and_review_state.sql
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

-- 20260322_remove_sold_status.sql
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

-- 20260326_non_rug_review_reason.sql
begin;

alter table public.rugs
  drop constraint if exists rugs_review_reason_code_valid;

alter table public.rugs
  add constraint rugs_review_reason_code_valid
  check (
    review_reason_code is null
    or review_reason_code in (
      'ANALYSIS_INCOMPLETE',
      'ANALYSIS_FAILED',
      'NON_RUG_DETECTED'
    )
  );

commit;

-- 20260408_availability_not_available_contract.sql
begin;

alter table public.inventory_enrichment_jobs
  add column if not exists restore_available_on_ready boolean not null default true;

update public.inventory_enrichment_jobs j
set restore_available_on_ready = coalesce(r.status, 'available') = 'available'
from public.rugs r
where r.id = j.rug_id;

update public.rugs
set status = 'not_available'
where lower(trim(coalesce(status, ''))) in ('on_hold', 'sold', 'hold', 'offfloor');

update public.rugs
set status = 'not_available'
where enrichment_status in ('processing', 'needs_review');

alter table public.rugs
  drop constraint if exists rugs_status_valid;

alter table public.rugs
  add constraint rugs_status_valid
  check (status in ('available', 'not_available'));

comment on column public.inventory_enrichment_jobs.restore_available_on_ready is
  'When true, the worker restores rugs to available after enrichment reaches ready; false preserves manual not_available.';

commit;
