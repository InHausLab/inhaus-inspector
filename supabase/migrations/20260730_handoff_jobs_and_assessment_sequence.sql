-- InHaus handoff reliability schema
-- Apply before deploying the Worker that uses these tables.
-- Seed assessment_number_sequence from a freshly verified tracker max before
-- enabling real inspection start-shell requests.

create extension if not exists pgcrypto;

create sequence if not exists public.assessment_number_sequence
  as integer
  minvalue 1
  start with 1
  increment by 1
  cache 1;

create table if not exists public.assessment_number_reservations (
  id uuid primary key default gen_random_uuid(),
  inspection_id text not null unique,
  assessment_number integer not null unique default nextval('public.assessment_number_sequence'),
  assessment_number_display text generated always as (lpad(assessment_number::text, 3, '0')) stored,
  reservation_status text not null default 'reserved'
    check (reservation_status in ('reserved', 'in_progress', 'submitted', 'cancelled')),
  client_name text,
  property_address text,
  inspector_name text,
  inspection_date date,
  requested_by text,
  source_system text not null default 'cloudflare_worker',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists assessment_number_reservations_status_idx
  on public.assessment_number_reservations (reservation_status, created_at);

create table if not exists public.handoff_jobs (
  id uuid primary key default gen_random_uuid(),
  job_key text not null unique,
  inspection_id text not null,
  is_test boolean not null default false,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'waiting_on_export_adapter', 'repairing', 'ready', 'failed', 'cancelled')),
  requested_by text,
  requested_at timestamptz not null default now(),
  attempt_count integer not null default 0,
  last_error text,
  last_run_at timestamptz,
  next_run_at timestamptz,
  locked_at timestamptz,
  locked_by text,
  started_at timestamptz,
  finished_at timestamptz,
  payload jsonb not null default '{}'::jsonb,
  receipt jsonb,
  worker_version text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists handoff_jobs_due_idx
  on public.handoff_jobs (status, next_run_at, updated_at);

create index if not exists handoff_jobs_inspection_idx
  on public.handoff_jobs (inspection_id, created_at desc);

create index if not exists handoff_jobs_lock_idx
  on public.handoff_jobs (locked_at, updated_at);

create table if not exists public.handoff_artifacts (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.handoff_jobs(id) on delete cascade,
  inspection_id text not null,
  artifact_key text not null,
  artifact_type text not null,
  artifact_id text,
  artifact_url text,
  status text not null default 'ready'
    check (status in ('queued', 'running', 'ready', 'failed', 'skipped')),
  checksum text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists handoff_artifacts_unique_artifact_idx
  on public.handoff_artifacts (job_id, artifact_key);

create table if not exists public.review_activity_events (
  id uuid primary key default gen_random_uuid(),
  inspection_id text not null,
  actor text,
  event_type text not null,
  event_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists review_activity_events_inspection_idx
  on public.review_activity_events (inspection_id, created_at desc);

create table if not exists public.inspection_sync_events (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique,
  inspection_id text not null,
  event_type text not null default 'checkpoint',
  source_device text,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists inspection_sync_events_inspection_idx
  on public.inspection_sync_events (inspection_id, created_at asc);

create table if not exists public.app_feedback (
  feedback_id text primary key,
  inspection_id text,
  status text not null default 'new'
    check (status in ('new', 'reviewing', 'planned', 'resolved', 'archived')),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists app_feedback_status_idx
  on public.app_feedback (status, created_at desc);

create table if not exists public.company_comment_library (
  comment_id text primary key,
  normalized_text text not null,
  cleaned_text text not null,
  severity text,
  report_section text,
  status text not null default 'pending_review'
    check (status in ('pending_review', 'approved', 'archived')),
  submitted_by text,
  submitted_at timestamptz,
  source_inspection_id text,
  source_finding_id text,
  approved_by text,
  approved_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists company_comment_library_status_idx
  on public.company_comment_library (status, updated_at desc);

create index if not exists company_comment_library_text_idx
  on public.company_comment_library (normalized_text);

create or replace function public.reserve_assessment_shell(
  p_inspection_id text,
  p_client_name text default null,
  p_property_address text default null,
  p_inspector_name text default null,
  p_inspection_date date default null,
  p_requested_by text default 'cloudflare_worker',
  p_metadata jsonb default '{}'::jsonb
)
returns table (
  reservation_id uuid,
  inspection_id text,
  assessment_number integer,
  assessment_number_display text,
  reservation_status text,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if nullif(trim(p_inspection_id), '') is null then
    raise exception 'missing_inspection_id';
  end if;

  insert into public.assessment_number_reservations (
    inspection_id,
    client_name,
    property_address,
    inspector_name,
    inspection_date,
    requested_by,
    metadata
  )
  values (
    trim(p_inspection_id),
    nullif(trim(coalesce(p_client_name, '')), ''),
    nullif(trim(coalesce(p_property_address, '')), ''),
    nullif(trim(coalesce(p_inspector_name, '')), ''),
    p_inspection_date,
    nullif(trim(coalesce(p_requested_by, '')), ''),
    coalesce(p_metadata, '{}'::jsonb)
  )
  on conflict (inspection_id) do update set
    client_name = coalesce(excluded.client_name, assessment_number_reservations.client_name),
    property_address = coalesce(excluded.property_address, assessment_number_reservations.property_address),
    inspector_name = coalesce(excluded.inspector_name, assessment_number_reservations.inspector_name),
    inspection_date = coalesce(excluded.inspection_date, assessment_number_reservations.inspection_date),
    requested_by = coalesce(excluded.requested_by, assessment_number_reservations.requested_by),
    metadata = assessment_number_reservations.metadata || excluded.metadata,
    updated_at = now();

  return query
  select
    r.id,
    r.inspection_id,
    r.assessment_number,
    lpad(r.assessment_number::text, 3, '0') as assessment_number_display,
    r.reservation_status,
    r.created_at,
    r.updated_at
  from public.assessment_number_reservations r
  where r.inspection_id = trim(p_inspection_id);
end;
$$;

create or replace function public.claim_due_handoff_jobs(
  p_limit integer default 10,
  p_worker_id text default 'cloudflare_worker'
)
returns setof public.handoff_jobs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return query
  with due_jobs as (
    select j.id
    from public.handoff_jobs j
    where j.status in ('queued', 'running', 'waiting_on_export_adapter', 'repairing', 'failed')
      and (j.next_run_at is null or j.next_run_at <= now())
      and (j.locked_at is null or j.locked_at < now() - interval '15 minutes')
    order by j.updated_at asc
    limit greatest(1, least(coalesce(p_limit, 10), 25))
    for update skip locked
  )
  update public.handoff_jobs j
  set
    locked_at = now(),
    locked_by = coalesce(nullif(trim(p_worker_id), ''), 'cloudflare_worker'),
    updated_at = now()
  from due_jobs
  where j.id = due_jobs.id
  returning j.*;
end;
$$;

alter table public.assessment_number_reservations enable row level security;
alter table public.handoff_jobs enable row level security;
alter table public.handoff_artifacts enable row level security;
alter table public.review_activity_events enable row level security;
alter table public.inspection_sync_events enable row level security;
alter table public.app_feedback enable row level security;
alter table public.company_comment_library enable row level security;

revoke all on table public.assessment_number_reservations from public, anon, authenticated;
revoke all on table public.handoff_jobs from public, anon, authenticated;
revoke all on table public.handoff_artifacts from public, anon, authenticated;
revoke all on table public.review_activity_events from public, anon, authenticated;
revoke all on table public.inspection_sync_events from public, anon, authenticated;
revoke all on table public.app_feedback from public, anon, authenticated;
revoke all on table public.company_comment_library from public, anon, authenticated;
grant all on table public.assessment_number_reservations to service_role;
grant all on table public.handoff_jobs to service_role;
grant all on table public.handoff_artifacts to service_role;
grant all on table public.review_activity_events to service_role;
grant all on table public.inspection_sync_events to service_role;
grant all on table public.app_feedback to service_role;
grant all on table public.company_comment_library to service_role;

revoke all on sequence public.assessment_number_sequence from public, anon, authenticated;
grant usage, select on sequence public.assessment_number_sequence to service_role;

revoke all on function public.reserve_assessment_shell(text, text, text, text, date, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.reserve_assessment_shell(text, text, text, text, date, text, jsonb)
  to service_role;
revoke all on function public.claim_due_handoff_jobs(integer, text)
  from public, anon, authenticated;
grant execute on function public.claim_due_handoff_jobs(integer, text)
  to service_role;

comment on sequence public.assessment_number_sequence is
  'DB-backed assessment number sequence. Seed from current Report Tracker max before live use.';

comment on table public.assessment_number_reservations is
  'One row per real inspection assessment-number reservation. This is the collision-prevention source, not the tracker.';

comment on table public.handoff_jobs is
  'Durable async handoff job store for Drive/Sheets/tracker/report package creation.';

comment on table public.handoff_artifacts is
  'Generated artifacts and receipt links for each handoff job.';

comment on table public.inspection_sync_events is
  'Immutable inspection checkpoints used to recover concurrent team edits and audit cloud saves.';

comment on table public.app_feedback is
  'Inspector-submitted app feedback stored outside Apps Script.';

comment on table public.company_comment_library is
  'Approved and pending reusable report comments stored outside Apps Script.';

comment on function public.claim_due_handoff_jobs(integer, text) is
  'Atomically claims due handoff jobs with row locks so concurrent runners do not process the same package.';
