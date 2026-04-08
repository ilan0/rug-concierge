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
