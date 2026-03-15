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
