create table if not exists public.review_data (
  inspection_id text primary key,
  field_data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint review_data_field_data_is_object
    check (jsonb_typeof(field_data) = 'object')
);

alter table public.review_data enable row level security;

revoke all on table public.review_data from anon, authenticated;
grant select, insert, update on table public.review_data to service_role;

comment on table public.review_data is
  'Reviewer edits persisted by the authenticated InHaus Photo Worker.';
