import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const worker = readFileSync(new URL('../workers/inhaus-photo-worker/src/index.js', import.meta.url), 'utf8');
const sync = readFileSync(new URL('../sync.js', import.meta.url), 'utf8');
const photoClient = readFileSync(new URL('../supabase-photos.js', import.meta.url), 'utf8');

test('photo metadata survives the stripped binary payload', () => {
  assert.match(sync, /mainPayload\.photoManifest = allPhotos\.map/);
});

test('Drive photo packaging belongs to the retryable Worker handoff', () => {
  assert.match(worker, /async function createOrRepairPhotoPackage/);
  assert.match(worker, /photoFolderPendingCount/);
  assert.match(worker, /nextRunAt/);
  assert.doesNotMatch(sync, /mirrorSupabasePhotosToDrive|mirrorPhotosToDrive/);
  assert.doesNotMatch(photoClient, /workerUrl\('\/mirror'\)/);
});

test('final app verification requires the real assessment row and Supabase originals', () => {
  assert.match(worker, /const assessmentExists = await assessmentExistsForInspection\(env, inspectionId\)/);
  assert.match(sync, /status\.complete !== true \|\| status\.assessmentExists !== true/);
  assert.match(sync, /Cloud verification failed:/);
  assert.doesNotMatch(sync, /status\.reviewPortalReady !== true/);
  assert.doesNotMatch(sync, /Drive photo package is not ready/);
});

test('hundred-photo homes are packaged in resumable Worker batches', () => {
  assert.match(worker, /HANDOFF_PHOTO_COPY_LIMIT_DEFAULT = 5/);
  assert.match(worker, /pendingCount \+= 1/);
  assert.match(worker, /receipt\.status = 'running'/);
});

test('Drive filenames use inspection context instead of slot identifiers', () => {
  assert.match(worker, /safeDriveNamePart\(row\.room_name/);
  assert.match(worker, /safeDriveNamePart\(row\.caption/);
  assert.doesNotMatch(worker, /`slot-\$\{row\.slot\}`/);
});
