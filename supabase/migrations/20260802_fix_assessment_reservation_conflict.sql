-- Fix PL/pgSQL output-column ambiguity in the assessment reservation upsert.
-- The prior ON CONFLICT (inspection_id) target could resolve to either the
-- function's output variable or the table column and fail with SQLSTATE 42702.

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
  on conflict on constraint assessment_number_reservations_inspection_id_key do update set
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

revoke all on function public.reserve_assessment_shell(text, text, text, text, date, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.reserve_assessment_shell(text, text, text, text, date, text, jsonb)
  to service_role;
