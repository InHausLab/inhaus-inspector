import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  buildInspectionSummaryRows,
  normalizeInspectionReportData
} from '../workers/inhaus-photo-worker/src/index.js';

const workerSource = fs.readFileSync(
  new URL('../workers/inhaus-photo-worker/src/index.js', import.meta.url),
  'utf8'
);

function ericksonShape() {
  return {
    inspectionId: 'INH-TEST-MAPPING',
    utilityRoom: {
      forcedHVAC: 'No',
      waterFiltrationPresent: 'No',
      waterSofteningPresent: 'Yes',
      waterSoftType: 'Kenmore',
      airFiltrationPresent: 'No',
      otherAirPurifierPresent: 'No',
      radonMitigationPresent: 'No'
    },
    stepData: {
      utility: {
        heatingType: 'Boiler',
        acType: 'No Air Conditioning',
        ventilationType: { bathExhaust: true, ventNone: false }
      },
      'property-details': {
        fireplacePresent: 'Yes',
        fireplace: ['Gas'],
        fireplaceCount: 1
      },
      'kitchen-appliance': {
        stoveType: ['Gas'],
        exhaustVented: 'Ducted (to outside)'
      }
    }
  };
}

test('one canonical mapping projects nested app values for portal and handoff', () => {
  const mapped = normalizeInspectionReportData(ericksonShape());
  assert.equal(mapped.waterFiltration, 'No');
  assert.equal(mapped.waterSoftener, 'Yes — Kenmore');
  assert.equal(mapped.heating, 'Boiler');
  assert.equal(mapped.ac, 'No Air Conditioning');
  assert.equal(mapped.ventilation, 'Bathroom Exhaust Fan(s)');
  assert.equal(mapped.airFiltration, 'No');
  assert.equal(mapped.otherAirCleaning, 'No');
  assert.equal(mapped.radonMitigation, 'No');
  assert.equal(mapped.fireplaceSummary, 'Yes — Gas — 1 total');
  assert.equal(mapped.stoveSummary, 'Gas — Ducted (to outside)');
});

test('inspection spreadsheet summary uses the canonical Tanner fields', () => {
  const mapped = normalizeInspectionReportData(ericksonShape());
  const rows = buildInspectionSummaryRows(mapped, {
    system: { inspectionRecovery: mapped }
  });
  const values = new Map(rows.map(([label, value]) => [label, value]));
  assert.equal(values.get('Water Filtration'), 'No');
  assert.equal(values.get('Water Softener'), 'Yes — Kenmore');
  assert.equal(values.get('Heating'), 'Boiler');
  assert.equal(values.get('Air Filtration / Cleansing'), 'No');
  assert.equal(values.get('Radon Mitigation'), 'No');
  assert.equal(values.get('Fireplace(s)'), 'Yes — Gas — 1 total');
  assert.equal(values.get('Stove Ventilation'), 'Ducted (to outside)');
});

test('ready handoff receipts are checked against the current photo table', () => {
  assert.match(
    workerSource,
    /async function getHandoffReceiptExpectations[\s\S]*?getPhotoRowsForInspection[\s\S]*?expectedPhotoCount: Array\.isArray\(photoRows\) \? photoRows\.length : 0/
  );
  assert.ok(
    [...workerSource.matchAll(/await getHandoffReceiptExpectations\(env, inspectionId, canonicalSource\)/g)].length >= 2
  );
});

test('a forced repair survives the durable queue until its first processing batch', () => {
  assert.match(workerSource, /forceFullRepair: body\.forceFullRepair === true/);
  assert.match(workerSource, /forceFullRepair: cleanJob\.forceFullRepair === true/);
  assert.match(
    workerSource,
    /forceFullRepair: body\.forceFullRepair === true \|\| durableJob\?\.payload\?\.forceFullRepair === true/
  );
  assert.match(
    workerSource,
    /createOrRepairTannerHandoff\(env, accessToken, inspectionId, fieldData, effectiveBody\)/
  );
});
