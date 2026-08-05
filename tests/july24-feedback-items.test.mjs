import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const steps = readFileSync(new URL('../steps.js', import.meta.url), 'utf8');
const screens = readFileSync(new URL('../screens.js', import.meta.url), 'utf8');
const ui = readFileSync(new URL('../ui.js', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

test('precheck lets the inspector select or unselect tests on site', () => {
  assert.match(screens, /Select or unselect tests for this inspection/);
  assert.match(screens, /No tests are selected\. Select any test the office missed/);
  assert.match(screens, /ctx\.inspection\.requiredTests/);
});

test('Boulder Blue location uses the inspection floor selector', () => {
  assert.match(steps, /type: 'inspection-level-select', label: 'Boulder Blue Test Location'/);
  assert.match(ui, /case 'inspection-level-select'/);
  assert.match(ui, /\['Basement'\]/);
  assert.match(ui, /\['First Floor', 'Second Floor', 'Third Floor', 'Fourth Floor', 'Fifth Floor'\]/);
});

test('Radon setup does not create an artificial room inspection', () => {
  assert.doesNotMatch(steps, /\|\| \[\{ name: 'Radon - Room 1' \}\]/);
  assert.doesNotMatch(screens, /Radon - Room 1/);
  assert.doesNotMatch(screens, /Add Another Radon Area/);
  assert.match(steps, /phase: 'supplementary'.*legacyLowest: true/);
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

test('mobile navigation keeps the active phase and room controls visible', () => {
  assert.match(screens, /className: 'bottom-nav' \+ \(isDevMode\(\) \? ' dev-bottom-nav' : ''\)/);
  assert.match(styles, /\.bottom-nav\.dev-bottom-nav > \*/);
  assert.match(screens, /activeButton\.offsetLeft - \(\(subNav\.clientWidth - activeButton\.offsetWidth\) \/ 2\)/);
  assert.match(ui, /activeDot\.offsetLeft - \(\(bar\.clientWidth - activeDot\.offsetWidth\) \/ 2\)/);
});
