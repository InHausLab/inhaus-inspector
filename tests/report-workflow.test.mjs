import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const worker = readFileSync(new URL('../workers/inhaus-photo-worker/src/index.js', import.meta.url), 'utf8');
const sync = readFileSync(new URL('../sync.js', import.meta.url), 'utf8');
const photoClient = readFileSync(new URL('../supabase-photos.js', import.meta.url), 'utf8');

test('photo metadata survives the stripped binary payload', () => {
  assert.match(sync, /mainPayload\.photoManifest = allPhotos\.map/);
});

test('Drive mirror requires the assessment folder and targets Technician Photos', () => {
  assert.match(worker, /if \(!driveFolderId\) throw new Error\('missing_drive_folder_id'\)/);
  assert.match(worker, /getOrCreateDriveFolder\(accessToken, driveFolderId, 'Technician Photos'\)/);
  assert.match(photoClient, /if \(!payload\.driveFolderId\) throw new Error\('Missing assessment Drive folder/);
  assert.match(photoClient, /photoFolderId/);
});

test('final verification requires the real assessment row and Drive mirror readiness', () => {
  assert.match(worker, /const assessmentExists = await assessmentExistsForInspection\(env, inspectionId\)/);
  assert.match(sync, /status\.reviewPortalReady !== true/);
  assert.match(sync, /Drive photo package is not ready/);
});

test('Drive mirror supports hundred-photo homes without a false complete receipt', () => {
  assert.match(photoClient, /const MAX_BATCHES = 50/);
  assert.match(photoClient, /Drive mirror still has photos pending/);
});

test('Drive filenames use inspection context instead of slot identifiers', () => {
  assert.match(worker, /safeDriveNamePart\(row\.room_name/);
  assert.match(worker, /safeDriveNamePart\(row\.caption/);
  assert.doesNotMatch(worker, /`slot-\$\{row\.slot\}`/);
});
