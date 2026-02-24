-- Chat session persistence for backend-owned conversation state.
-- This keeps recommendation/trade/project/review context durable across restarts.

create extension if not exists pgcrypto;

create table if not exists public.chat_sessions (
  session_id text primary key,
  tenant_id text null,
  role text not null,
  session_data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_chat_sessions_tenant_updated
  on public.chat_sessions (tenant_id, updated_at desc);

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  session_id text not null references public.chat_sessions(session_id) on delete cascade,
  tenant_id text null,
  role text not null check (role in ('user', 'assistant')),
  mode text null check (mode in ('general_chat', 'recommendation', 'appraisal')),
  content text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_chat_messages_session_created
  on public.chat_messages (session_id, created_at);

create index if not exists idx_chat_messages_tenant_created
  on public.chat_messages (tenant_id, created_at);
