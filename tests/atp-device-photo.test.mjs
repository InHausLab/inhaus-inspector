import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const stepsSource = fs.readFileSync(new URL('../steps.js', import.meta.url), 'utf8');
const uiSource = fs.readFileSync(new URL('../ui.js', import.meta.url), 'utf8');

test('ATP before and after readers retain managed report photos', () => {
  assert.match(stepsSource, /photoKey:\s*'_atpBeforePhotos'/);
  assert.match(stepsSource, /photoKey:\s*'_atpAfterPhotos'/);
  assert.match(stepsSource, /photoRole:\s*'ATP Before'/);
  assert.match(stepsSource, /photoRole:\s*'ATP After'/);
  assert.match(uiSource, /await savePhotoRecordToVault\(retainedPhoto/);
  assert.match(uiSource, /data\[photoKey\]\s*=\s*\[retainedPhoto\]/);
  assert.match(uiSource, /queuePhotoForBackgroundUpload\(retainedPhoto\)/);
});

test('ATP AI readings fill existing RLU and Pass-Fail fields without replacing inspector confirmation', () => {
  assert.match(stepsSource, /dataKey:\s*'atpPreRLU'[\s\S]*statusKey:\s*'atpPreStatus'/);
  assert.match(stepsSource, /dataKey:\s*'atpPostRLU'[\s\S]*statusKey:\s*'atpPostStatus'/);
  assert.match(uiSource, /data\[statusKey\]\s*=\s*value\s*<\s*100\s*\?\s*'Pass'\s*:\s*'Fail'/);
  assert.match(uiSource, /Confirm reading \\u2014 correct if needed/);
  assert.match(uiSource, /confirmInp\.addEventListener\('input'/);
});

test('ATP photos remain required even when AI cannot read the device', () => {
  assert.match(stepsSource, /ATP Before device photo is required/);
  assert.match(stepsSource, /ATP After device photo is required/);
  assert.match(uiSource, /Photo retained; AI could not read the display/);
  assert.match(uiSource, /Photo retained; AI read failed/);
});

test('ATP photo metadata preserves report routing and AI audit details', () => {
  assert.match(uiSource, /stepName:\s*f\.stepName\s*\|\|\s*photoRole/);
  assert.match(uiSource, /photoKey,/);
  assert.match(uiSource, /photoRole,/);
  assert.match(uiSource, /retainedPhoto\.aiAtpReading\s*=\s*value/);
  assert.match(uiSource, /retainedPhoto\.aiAtpDisplayText/);
  assert.match(uiSource, /retainedPhoto\.aiAtpReadAt/);
});
