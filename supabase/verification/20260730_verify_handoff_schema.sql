-- InHaus W7 handoff schema verification
--
-- Run this entire file in one SQL session after applying:
--   supabase/migrations/20260730_handoff_jobs_and_assessment_sequence.sql
--
-- The script opens a transaction, performs reversible table/claim smoke tests,
-- then rolls back. It intentionally does not call reserve_assessment_shell:
-- PostgreSQL sequence increments do not roll back and would consume a real number.

begin;

select
  'assessment_number_sequence' as check_name,
  to_regclass('public.assessment_number_sequence') is not null as ok;

select
  'assessment_number_reservations' as check_name,
  to_regclass('public.assessment_number_reservations') is not null as ok;

select
  'handoff_jobs' as check_name,
  to_regclass('public.handoff_jobs') is not null as ok;

select
  'handoff_artifacts' as check_name,
  to_regclass('public.handoff_artifacts') is not null as ok;

select
  'review_activity_events' as check_name,
  to_regclass('public.review_activity_events') is not null as ok;

select
  'inspection_sync_events' as check_name,
  to_regclass('public.inspection_sync_events') is not null as ok;

select
  'app_feedback' as check_name,
  to_regclass('public.app_feedback') is not null as ok;

select
  'company_comment_library' as check_name,
  to_regclass('public.company_comment_library') is not null as ok;

select
  'handoff_tables_rls' as check_name,
  bool_and(c.relrowsecurity) as ok
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in (
    'assessment_number_reservations',
    'handoff_jobs',
    'handoff_artifacts',
    'review_activity_events',
    'inspection_sync_events',
    'app_feedback',
    'company_comment_library'
  );

select
  'handoff_rpc_permissions' as check_name,
  not has_function_privilege('anon', 'public.reserve_assessment_shell(text,text,text,text,date,text,jsonb)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.reserve_assessment_shell(text,text,text,text,date,text,jsonb)', 'EXECUTE')
    and has_function_privilege('service_role', 'public.reserve_assessment_shell(text,text,text,text,date,text,jsonb)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.claim_due_handoff_jobs(integer,text)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.claim_due_handoff_jobs(integer,text)', 'EXECUTE')
    and has_function_privilege('service_role', 'public.claim_due_handoff_jobs(integer,text)', 'EXECUTE') as ok;

insert into public.review_activity_events (
  inspection_id,
  actor,
  event_type,
  event_payload
)
values (
  'INH-TRAINING-SCHEMA-SMOKE',
  'schema-verification',
  'save',
  jsonb_build_object(
    'verification',
    true,
    'valueMeta',
    jsonb_build_object('type', 'text', 'size', 12)
  )
);

select
  'review_activity_events_insert' as check_name,
  count(*) = 1 as ok
from public.review_activity_events
where inspection_id = 'INH-TRAINING-SCHEMA-SMOKE'
  and event_type = 'save';

insert into public.inspection_sync_events (
  event_key,
  inspection_id,
  event_type,
  source_device,
  payload
)
values (
  'INH-TRAINING-SCHEMA-SMOKE:checkpoint-1',
  'INH-TRAINING-SCHEMA-SMOKE',
  'checkpoint',
  'schema-verification',
  jsonb_build_object('inspectionId', 'INH-TRAINING-SCHEMA-SMOKE')
);

select
  'inspection_sync_events_insert' as check_name,
  count(*) = 1 as ok
from public.inspection_sync_events
where inspection_id = 'INH-TRAINING-SCHEMA-SMOKE';

select
  'reserve_assessment_shell' as check_name,
  exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'reserve_assessment_shell'
  ) as ok;

select
  'claim_due_handoff_jobs' as check_name,
  exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'claim_due_handoff_jobs'
  ) as ok;

insert into public.handoff_jobs (
  job_key,
  inspection_id,
  is_test,
  status,
  requested_by,
  payload
)
values (
  'handoff_INH-TRAINING-SCHEMA-SMOKE',
  'INH-TRAINING-SCHEMA-SMOKE',
  true,
  'queued',
  'schema-verification',
  jsonb_build_object('verification', true)
);

select
  job_key,
  inspection_id,
  is_test,
  status,
  locked_by,
  locked_at is not null as claimed
from public.claim_due_handoff_jobs(1, 'schema-verification');

select
  'claimed_once' as check_name,
  count(*) = 0 as ok
from public.claim_due_handoff_jobs(1, 'schema-verification-second-call');

rollback;
