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
