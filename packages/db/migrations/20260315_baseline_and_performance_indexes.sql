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
