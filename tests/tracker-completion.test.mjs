import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const screens = readFileSync(new URL('../screens.js', import.meta.url), 'utf8');
const ui = readFileSync(new URL('../ui.js', import.meta.url), 'utf8');
const feedback = readFileSync(new URL('../feedback.js', import.meta.url), 'utf8');
const fields = readFileSync(new URL('../fields.js', import.meta.url), 'utf8');

test('redundant in-app microphone is disabled on every platform', () => {
  assert.match(ui, /function micBtn\(\) \{[\s\S]*?return null;\s*\}/);
  assert.doesNotMatch(ui, /className: 'mic-btn'/);
});

test('Priority Lab links are removed from the inspector workflow', () => {
  assert.doesNotMatch(fields, /Open Priority Lab/);
  assert.doesNotMatch(fields, /app\.prioritylaboratory\.com/);
});

test('finding review starts with the inspector wording in the editable field', () => {
  assert.match(screens, /cleaned\.value = finding\.cleanedComment \|\| finding\.rawComment \|\| '';/);
  assert.match(screens, /updateFinding\(ctx\.inspection, finding\.findingId, \{ cleanedComment: cleaned\.value \}\);/);
  assert.doesNotMatch(screens, /Copy Original to Edit/);
});

test('local photo backup is understandable and can restore detached photos', () => {
  assert.match(screens, /Local Photo Backup/);
  assert.match(screens, /Restore to Photos/);
  assert.match(screens, /openInspectionWorkspace\('recovery', 'review'\)/);
});

test('app feedback points Tanner to the shared tracker', () => {
  assert.match(feedback, /shared Things to Fix tracker that Tanner monitors/);
  assert.match(feedback, /Saved in the shared Things to Fix tracker for Tanner/);
  assert.doesNotMatch(feedback, /Send to Matt/);
});
