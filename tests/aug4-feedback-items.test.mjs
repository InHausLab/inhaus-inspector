import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  getArrivalFields,
  getDeviceSetupFields,
  getUtilityFields,
  getWaterSampleFields,
  validateStep
} from '../steps.js';

const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const screens = readFileSync(new URL('../screens.js', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
const sync = readFileSync(new URL('../sync.js', import.meta.url), 'utf8');
const ui = readFileSync(new URL('../ui.js', import.meta.url), 'utf8');

function visibleField(field) {
  if (!field) return field;
  const copy = { ...field };
  delete copy.showIf;
  return copy;
}

test('Boulder Blue setup requires a placement photo', () => {
  const field = getArrivalFields().find(item => item?.photoKey === '_boulderBluePlacementPhotos');
  assert.ok(field);
  assert.equal(field.required, true);
  assert.equal(field.stepName, 'Boulder Blue Fan Placement');
});

test('PFAS setup and collection share one sample identifier', () => {
  const setupScanners = getDeviceSetupFields()
    .map(visibleField)
    .filter(field => field?.type === 'sample-id-scanner');
  assert.deepEqual(setupScanners.map(field => field.dataKey), ['pfasSampleId']);
  assert.match(screens, /deviceData\.pfasSampleId = pfasId/);
  assert.match(screens, /waterData\.pfasSampleId = pfasId/);
  assert.doesNotMatch(screens, /dataKey: 'pfasKitNum', label: 'PFAS Kit #'/);
});

test('Safe Home premium water test is named explicitly at preparation and collection', () => {
  const fields = getWaterSampleFields();
  assert.ok(fields.some(field => field?.label === 'Safe Home Premium Water Test'));
  assert.ok(fields.some(field => field?.dataKey === 'waterSampleId' && field?.label === 'Safe Home Premium Water Sample ID'));
  assert.match(screens, /Safe Home Premium Water Kit \/ Sample ID/);
});

test('selected heating and cooling systems each require their own photo', () => {
  const group = getUtilityFields()
    .map(visibleField)
    .find(field => field?.type === 'conditional-fields');
  assert.ok(group);
  const gas = group.fields.find(field => field?.showIf?.value === 'Natural Gas Furnace');
  const miniSplit = group.fields.find(field => field?.showIf?.value === 'Ductless Mini-Split System');
  assert.equal(gas?.photoKey, '_heatingSystemPhotos');
  assert.equal(gas?.required, true);
  assert.equal(miniSplit?.photoKey, '_coolingSystemPhotos');
  assert.equal(miniSplit?.required, true);

  const missing = validateStep({ id: 'utility', type: 'utility' }, {
    forcedHVAC: 'Yes',
    heatingType: 'Natural Gas Furnace',
    acType: 'Ductless Mini-Split System'
  });
  assert.deepEqual(missing, [
    'Natural Gas Furnace Photos * is required',
    'Ductless Mini-Split System Photos * is required'
  ]);
});

test('annotation editor stays above the fixed mobile navigation and exposes undo', () => {
  assert.match(styles, /\.annot-overlay[\s\S]*?z-index:\s*20000/);
  assert.match(ui, /undoBtn\.textContent = '\\u21a9 Undo'/);
  assert.match(ui, /annotations\.pop\(\)/);
});

test('final review automatically uploads pending photos with visible progress and retry', () => {
  assert.match(app, /async function uploadPendingInspectionPhotos/);
  assert.match(app, /window\.uploadPendingInspectionPhotos = uploadPendingInspectionPhotos/);
  assert.match(sync, /opts\.onProgress\(\{ total: batch\.length, completed, confirmed \}\)/);
  assert.match(screens, /Uploading ' \+ progress\.completed \+ ' of ' \+ progress\.total/);
  assert.match(screens, /Keep this screen open/);
  assert.match(screens, /runPendingPhotoUpload\(\)/);
});

test('HVAC scanner names the system selected by the inspector', () => {
  assert.match(ui, /Selected systems: ' \+ systems\.join\(' • '\)/);
  assert.match(ui, /step1Title\.textContent = 'Photo: ' \+ primary \+ ' Data Tag'/);
  assert.match(screens, /scanner\.refreshSelectedSystems\(\)/);
});
