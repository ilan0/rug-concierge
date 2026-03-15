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
