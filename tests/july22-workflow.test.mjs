import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildStepList,
  deriveRequiredTests,
  getStepFields,
  getWaterSampleFields
} from '../steps.js';
import { observationFields } from '../fields.js';

function inspection(overrides = {}) {
  return {
    inspectionId: 'INH-JULY22-TEST',
    numberOfBedrooms: '3',
    numberOfBathrooms: '3',
    stepData: {},
    dynamicRooms: { lowest: [], additional: [] },
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

test('Radon setup is not a room and meaningful legacy room data remains editable', () => {
  const newSteps = buildStepList(inspection());
  assert.equal(newSteps.some(step => step.id.startsWith('lowest-room-')), false);

  const emptyLegacySteps = buildStepList(inspection({
    dynamicRooms: { lowest: [{ name: 'Radon - Room 1' }], additional: [] },
    stepData: { 'lowest-room-0': { _photos: [], qtrakReading: { value: null, status: '' } } }
  }));
  assert.equal(emptyLegacySteps.some(step => step.id === 'lowest-room-0'), false);

  const legacySteps = buildStepList(inspection({
    dynamicRooms: { lowest: [{ name: 'Radon - Room 1' }], additional: [] },
    stepData: { 'lowest-room-0': { notes: 'Legacy lower-level observation' } }
  }));
  const legacyRoom = legacySteps.find(step => step.id === 'lowest-room-0');
  assert.equal(legacyRoom?.phase, 'supplementary');
  assert.equal(legacyRoom?.name, 'Lower Level Room');
  assert.equal(getStepFields(legacyRoom).some(field => field?.key === 'roomName'), true);
});

test('Utility Room appears after the room walkthrough and before wrap-up', () => {
  const steps = buildStepList(inspection({
    dynamicRooms: {
      lowest: [{ name: 'Lowest Level — Room 1' }],
      additional: [{ name: 'Living Room' }, { name: 'Laundry Room' }]
    }
  }));
  const utilityIndex = steps.findIndex(step => step.id === 'utility');
  const kitchenAirIndex = steps.findIndex(step => step.id === 'kitchen-air');
  const lastAdditionalIndex = Math.max(...steps
    .map((step, index) => step.type === 'additional-room' ? index : -1));
  const debriefIndex = steps.findIndex(step => step.id === 'debrief');

  assert.ok(utilityIndex > kitchenAirIndex);
  assert.ok(utilityIndex > lastAdditionalIndex);
  assert.ok(utilityIndex < debriefIndex);
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
