import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  getArrivalFields,
  getExteriorFields,
  getUtilityFields,
  getWaterSampleFields,
  validateStep
} from '../steps.js';

const ui = readFileSync(new URL('../ui.js', import.meta.url), 'utf8');
const inspection = readFileSync(new URL('../inspection.js', import.meta.url), 'utf8');

test('sample label scanners retain managed high-resolution report photos', () => {
  assert.match(ui, /const photoKey = f\.photoKey \|\| \(dataKey \+ '_photos'\)/);
  assert.match(ui, /await savePhotoRecordToVault\(capturedPhoto/);
  assert.match(ui, /queuePhotoForBackgroundUpload\(capturedPhoto\)/);
  assert.match(ui, /data\[photoKey\] = \[capturedPhoto\]/);
  assert.match(ui, /compressImage\(file\)/);

  const boulder = getArrivalFields().find(field => field?.dataKey === 'boulderBlueSampleId');
  assert.equal(boulder?.type, 'sample-id-scanner');
  assert.equal(boulder?.photoKey, '_boulderBlueLabelPhotos');
  assert.equal(boulder?.photoRequired, true);

  const waterScanners = getWaterSampleFields()
    .filter(field => field?.type === 'sample-id-scanner')
    .map(field => field.dataKey);
  assert.deepEqual(waterScanners, ['waterSampleId', 'microplasticsSampleId', 'pfasSampleId']);
});

test('exterior step requires an explicit issue decision and a correctly routed photo', () => {
  const missing = validateStep({ id: 'exterior', type: 'exterior' }, {});
  assert.deepEqual(missing, [
    'Were any exterior issues found? is required',
    'Exterior Assessment Photo * is required'
  ]);

  const yesMissing = validateStep({ id: 'exterior', type: 'exterior' }, {
    exteriorIssuesFound: 'Yes',
    _exteriorAssessmentPhotos: [{ photoId: 'exterior-photo' }]
  });
  assert.deepEqual(yesMissing, ['Describe the exterior issues found is required']);

  const noIssues = validateStep({ id: 'exterior', type: 'exterior' }, {
    exteriorIssuesFound: 'No',
    _exteriorAssessmentPhotos: [{ photoId: 'exterior-photo' }]
  });
  assert.deepEqual(noIssues, []);
});

test('heating, cooling, and ventilation remain visible and required without forced HVAC', () => {
  const fields = getUtilityFields();
  const heating = fields.find(field => field?.key === 'heatingType');
  const cooling = fields.find(field => field?.key === 'acType');
  const ventilation = fields.find(field => field?.key === 'ventilationType');
  assert.equal(heating?.showIf, undefined);
  assert.equal(cooling?.showIf, undefined);
  assert.equal(ventilation?.showIf, undefined);
  assert.equal(heating?.required, true);
  assert.equal(cooling?.required, true);
  assert.equal(ventilation?.required, true);

  const missing = validateStep({ id: 'utility', type: 'utility' }, { forcedHVAC: 'No' });
  assert.deepEqual(missing, [
    'Heating Source Type is required',
    'Air Conditioning Source Type is required',
    'Ventilation Type is required'
  ]);
});

test('app export projects Tanner system fields into one report-facing shape', () => {
  for (const key of ['waterFiltration', 'waterSoftener', 'heating', 'ac', 'airFiltration', 'otherAirCleaning', 'radonMitigation', 'stoveVentilation']) {
    assert.match(inspection, new RegExp(`${key}:`));
  }
  assert.match(inspection, /exp\.ventilation = exp\.ventilationReadable/);
});
