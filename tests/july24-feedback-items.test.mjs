import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const steps = readFileSync(new URL('../steps.js', import.meta.url), 'utf8');
const screens = readFileSync(new URL('../screens.js', import.meta.url), 'utf8');
const ui = readFileSync(new URL('../ui.js', import.meta.url), 'utf8');

test('precheck lets the inspector add or remove tests on site', () => {
  assert.match(screens, /Add or remove tests for this inspection/);
  assert.match(screens, /No tests are selected\. Add any test the office missed/);
  assert.match(screens, /ctx\.inspection\.requiredTests/);
});

test('Boulder Blue location uses the inspection room selector', () => {
  assert.match(steps, /type: 'inspection-room-select', label: 'Boulder Blue Test Location'/);
  assert.match(ui, /case 'inspection-room-select'/);
  assert.match(ui, /\['Kitchen', 'Utility Room', 'Attic', 'Crawl Space'\]/);
});

test('Q-Trak room defaults to the current room without overwriting saved data', () => {
  assert.match(screens, /hasQtrakLocation && !String\(data\.qtrakLocation \|\| ''\)\.trim\(\)/);
  assert.match(screens, /step\.type === 'kitchen-air'/);
  assert.match(screens, /data\.roomName \|\| data\._roomName \|\| step\.name/);
});

test('under-sink duplicate photo pair and reason-for-inclusion field are removed', () => {
  assert.doesNotMatch(steps, /remediation-photo-pair', key: 'underSink'/);
  assert.doesNotMatch(steps, /textarea\('reasonForInclusion'/);
});

test('shipping tracking numbers can be scanned from a label and corrected', () => {
  assert.match(steps, /scanLabel: 'Scan tracking label'/);
  assert.match(steps, /Preserve every letter and digit exactly/);
  assert.match(ui, /const scanPrompt = f\.prompt/);
  assert.match(ui, /renderField\(subField, data/);
});
