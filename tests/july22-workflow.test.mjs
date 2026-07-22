import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildStepList,
  deriveRequiredTests,
  getWaterSampleFields
} from '../steps.js';
import { observationFields } from '../fields.js';

function inspection(overrides = {}) {
  return {
    inspectionId: 'INH-JULY22-TEST',
    numberOfBedrooms: '3',
    numberOfBathrooms: '3',
    stepData: {},
    dynamicRooms: { lowest: [{ name: 'Lowest Level — Room 1' }], additional: [] },
    ...overrides
  };
}

test('new step lists omit Main Living Area and retain Primary Bathroom naming', () => {
  const insp = inspection({ stepData: { 'living-area': { notes: 'legacy data remains preserved' } } });
  const steps = buildStepList(insp);

  assert.equal(steps.some(step => step.id === 'living-area'), false);
  assert.equal(steps.find(step => step.id === 'bathroom-2')?.name, 'Primary Bathroom');
  assert.equal(insp.stepData['living-area'].notes, 'legacy data remains preserved');
});

test('required tests combine explicit office selections with prepared kit choices', () => {
  const required = deriveRequiredTests(inspection({
    requiredTests: ['Radon monitor', 'ATP surface testing'],
    stepData: {
      'device-setup': { pfasSetup: 'Yes' },
      'water-sample': {
        waterPanelPlanned: 'Requested — collect on site',
        microplasticsStatus: 'Requested — collect on site'
      }
    }
  }));

  assert.deepEqual(required, [
    'Water panel',
    'PFAS water test',
    'Microplastics water test',
    'Radon monitor',
    'ATP surface testing'
  ]);
});

test('water collection captures filtered versus unfiltered sample type', () => {
  const sampleType = getWaterSampleFields().find(field => field?.key === 'waterSampleType');
  assert.ok(sampleType);
  assert.deepEqual(sampleType.choices, ['Unfiltered', 'Filtered', 'Both filtered and unfiltered']);
  assert.deepEqual(sampleType.showIf, { key: 'waterPanelCollected', value: 'Yes' });
});

test('phone observation fields no longer render voice review checkbox', () => {
  assert.equal(observationFields().some(field => field?.key === 'voiceReviewed'), false);
});
