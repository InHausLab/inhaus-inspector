import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const activeFiles = [
  '../config.js',
  '../sync.js',
  '../supabase-photos.js',
  '../app.js',
  '../screens.js',
  '../storage.js',
  '../inspection.js',
  '../feedback.js',
  '../comment-library.js',
  '../comment-library-admin.js',
  '../preflight.js',
  '../readiness/readiness.js',
  '../mission-control/index.html',
  '../reports/report.js'
];
const activeSource = activeFiles
  .map(path => readFileSync(new URL(path, import.meta.url), 'utf8'))
  .join('\n');
const releaseGraphFiles = [
  '../index.html',
  '../cache-reset.html',
  '../service-worker.js',
  '../app.js',
  '../screens.js',
  '../sync.js',
  '../ui.js',
  '../steps.js',
  '../config.js',
  '../storage.js',
  '../fields.js',
  '../inspection.js',
  '../findings.js',
  '../photo-routing.js',
  '../comment-library.js',
  '../feedback.js',
  '../comment-library-admin.js',
  '../db.js',
  '../state.js',
  '../supabase-photos.js'
];
const releaseGraphSource = releaseGraphFiles
  .map(path => readFileSync(new URL(path, import.meta.url), 'utf8'))
  .join('\n');

test('all deployed app tools use the Worker and contain no Apps Script endpoint', () => {
  assert.doesNotMatch(activeSource, /script\.google\.com/);
  assert.doesNotMatch(activeSource, /(?:const|let|var)\s+(?:GOOGLE_SCRIPT_URL|APPS_SCRIPT_URL|REPORT_REVIEW_API_URL|REPORT_BRIDGE_API_URL)\b/);
  assert.match(activeSource, /inhaus-photo-worker\.inhauslab\.workers\.dev/);
  assert.match(activeSource, /\/inspections\/active/);
  assert.match(activeSource, /\/inspections\/save/);
  assert.match(activeSource, /\/get-review/);
  assert.doesNotMatch(activeSource, /workerUrl\('\/mirror'\)|mirrorSupabasePhotosToDrive|mirrorPhotosToDrive/);
  assert.doesNotMatch(activeSource, /Sync to Drive|Not synced to Drive|uploaded to Google Drive/);
  assert.doesNotMatch(activeSource, /Synced to Drive|Syncing to Drive/);
  assert.match(activeSource, /Backed up to cloud/);
  assert.match(activeSource, /Backing up to cloud/);
});

test('deployed module graph uses one release cache version', () => {
  assert.doesNotMatch(releaseGraphSource, /\?v=(?!233\b)\d+/);
  assert.match(releaseGraphSource, /\?v=233/);
  assert.match(releaseGraphSource, /inhaus-v234/);
  assert.match(releaseGraphSource, /LATEST_VERSION = '233'/);
});
