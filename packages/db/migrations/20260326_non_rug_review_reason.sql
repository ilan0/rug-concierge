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
