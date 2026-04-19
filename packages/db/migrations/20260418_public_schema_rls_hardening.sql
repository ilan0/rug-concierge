begin;

-- Harden public application tables so only the server-side service role can
-- access them directly. The web app already uses the admin client and does
-- not depend on anon/authenticated grants for these tables.

alter table public.chat_messages enable row level security;
alter table public.chat_sessions enable row level security;
alter table public.inventory_enrichment_jobs enable row level security;
alter table public.rug_images enable row level security;
alter table public.rugs enable row level security;
alter table public.tenants enable row level security;

revoke all privileges on table public.chat_messages from public, anon, authenticated;
revoke all privileges on table public.chat_sessions from public, anon, authenticated;
revoke all privileges on table public.inventory_enrichment_jobs from public, anon, authenticated;
revoke all privileges on table public.rug_images from public, anon, authenticated;
revoke all privileges on table public.rugs from public, anon, authenticated;
revoke all privileges on table public.tenants from public, anon, authenticated;

grant select, insert, update, delete on table public.chat_messages to service_role;
grant select, insert, update, delete on table public.chat_sessions to service_role;
grant select, insert, update, delete on table public.inventory_enrichment_jobs to service_role;
grant select, insert, update, delete on table public.rug_images to service_role;
grant select, insert, update, delete on table public.rugs to service_role;
grant select, insert, update, delete on table public.tenants to service_role;

drop policy if exists service_role_chat_messages_all on public.chat_messages;
create policy service_role_chat_messages_all
  on public.chat_messages
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists service_role_chat_sessions_all on public.chat_sessions;
create policy service_role_chat_sessions_all
  on public.chat_sessions
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists service_role_inventory_enrichment_jobs_all on public.inventory_enrichment_jobs;
create policy service_role_inventory_enrichment_jobs_all
  on public.inventory_enrichment_jobs
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists service_role_rug_images_all on public.rug_images;
create policy service_role_rug_images_all
  on public.rug_images
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists service_role_rugs_all on public.rugs;
create policy service_role_rugs_all
  on public.rugs
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists service_role_tenants_all on public.tenants;
create policy service_role_tenants_all
  on public.tenants
  for all
  to service_role
  using (true)
  with check (true);

revoke execute on function public.claim_inventory_enrichment_jobs(integer, text) from public, anon, authenticated;
grant execute on function public.claim_inventory_enrichment_jobs(integer, text) to service_role;

alter default privileges in schema public
  revoke all on tables from public, anon, authenticated;

alter default privileges in schema public
  grant select, insert, update, delete on tables to service_role;

alter default privileges in schema public
  revoke execute on functions from public, anon, authenticated;

alter default privileges in schema public
  grant execute on functions to service_role;

commit;
