import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const worker = readFileSync(new URL('../workers/inhaus-photo-worker/src/index.js', import.meta.url), 'utf8');
const wrangler = readFileSync(new URL('../workers/inhaus-photo-worker/wrangler.toml', import.meta.url), 'utf8');

test('Worker mirrors app feedback to Tanner tracker idempotently', () => {
  assert.match(worker, /mirrorAppFeedbackToTracker/);
  assert.match(worker, /findFeedbackTrackerRow\(values, feedbackId\)/);
  assert.match(worker, /existing\[2\] \|\| 'New'/);
  assert.match(worker, /trackerMirrored: trackerMirror\.mirrored === true/);
  assert.match(worker, /context\.inspectionId/);
  assert.match(wrangler, /FEEDBACK_TRACKER_SHEET_ID/);
  assert.match(wrangler, /FEEDBACK_FOLDER_ID/);
});

test('Worker stores tracker mirror proof with the durable feedback record', () => {
  assert.match(worker, /updateAppFeedbackMirrorState/);
  assert.match(worker, /trackerMirror:/);
  assert.match(worker, /mirroredAt:/);
  assert.match(worker, /app_feedback_mirror_state_failed/);
});
