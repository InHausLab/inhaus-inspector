import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(
  new URL('../supabase/migrations/20260730_handoff_jobs_and_assessment_sequence.sql', import.meta.url),
  'utf8'
);
const reservationFix = readFileSync(
  new URL('../supabase/migrations/20260802_fix_assessment_reservation_conflict.sql', import.meta.url),
  'utf8'
);
const verification = readFileSync(
  new URL('../supabase/verification/20260730_verify_handoff_schema.sql', import.meta.url),
  'utf8'
);

test('handoff security-definer functions use fixed search paths', () => {
  const securityDefinerCount = (migration.match(/security definer/gi) || []).length;
  const fixedSearchPathCount = (migration.match(/set search_path = public, pg_temp/gi) || []).length;
  assert.equal(securityDefinerCount, 2);
  assert.equal(fixedSearchPathCount, securityDefinerCount);
});

test('handoff tables and RPCs are restricted to service role', () => {
  assert.match(migration, /alter table public\.handoff_jobs enable row level security/);
  assert.match(migration, /alter table public\.handoff_artifacts enable row level security/);
  assert.match(migration, /alter table public\.inspection_sync_events enable row level security/);
  assert.match(migration, /alter table public\.app_feedback enable row level security/);
  assert.match(migration, /alter table public\.company_comment_library enable row level security/);
  assert.match(migration, /revoke all on table public\.handoff_jobs from public, anon, authenticated/);
  assert.match(migration, /grant all on table public\.handoff_jobs to service_role/);
  assert.match(migration, /revoke all on table public\.inspection_sync_events from public, anon, authenticated/);
  assert.match(migration, /grant all on table public\.inspection_sync_events to service_role/);
  assert.match(migration, /revoke all on table public\.app_feedback from public, anon, authenticated/);
  assert.match(migration, /grant all on table public\.app_feedback to service_role/);
  assert.match(migration, /revoke all on table public\.company_comment_library from public, anon, authenticated/);
  assert.match(migration, /grant all on table public\.company_comment_library to service_role/);
  assert.match(migration, /revoke all on function public\.reserve_assessment_shell[\s\S]*from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.reserve_assessment_shell[\s\S]*to service_role/);
  assert.match(migration, /revoke all on function public\.claim_due_handoff_jobs[\s\S]*from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.claim_due_handoff_jobs[\s\S]*to service_role/);
});

test('assessment reservation upsert names its conflict constraint explicitly', () => {
  assert.match(migration, /on conflict on constraint assessment_number_reservations_inspection_id_key/i);
  assert.match(reservationFix, /on conflict on constraint assessment_number_reservations_inspection_id_key/i);
  assert.doesNotMatch(reservationFix, /^\s*on conflict\s*\(inspection_id\)/im);
});

test('live schema verification checks RLS and RPC permissions', () => {
  assert.match(verification, /handoff_tables_rls/);
  assert.match(verification, /handoff_rpc_permissions/);
  assert.match(verification, /has_function_privilege\('service_role'/);
  assert.match(verification, /not has_function_privilege\('anon'/);
  assert.doesNotMatch(verification, /from public\.reserve_assessment_shell\(/i);
  assert.match(verification, /sequence increments do not roll back/i);
});

test('Worker exposes portal routes and no Apps Script endpoint', () => {
  const workerSource = readFileSync(
    new URL('../workers/inhaus-photo-worker/src/index.js', import.meta.url),
    'utf8'
  );
  assert.match(workerSource, /GET \/inspections/);
  assert.match(workerSource, /POST \/review-unlock/);
  assert.match(workerSource, /GET \/submit-smoke/);
  assert.match(workerSource, /async function handleInspectionList/);
  assert.match(workerSource, /async function handleReviewUnlock/);
  assert.match(workerSource, /async function handleSubmitSmoke/);
  assert.doesNotMatch(workerSource, /script\.google\.com/);
});
