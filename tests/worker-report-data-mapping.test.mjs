import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  buildAssessmentContextMarkdown,
  buildCanonicalHandoffFieldData,
  buildInspectionRoomDetailRows,
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
    status: 'In Review',
    submission: { status: 'Submitted to Tanner' },
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
  assert.equal(values.get('Review Status'), 'Submitted to Tanner');
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

test('room note export ignores collaboration field metadata', () => {
  const canonicalSource = {
    rooms: [{ stepId: 'kitchen-appliance', roomName: 'Kitchen Inspection' }],
    stepData: {
      'kitchen-appliance': {
        notes: '',
        _fieldUpdates: {
          notes: {
            deviceId: 'device-test',
            updatedAt: '2026-09-01T20:38:16.751Z',
            updatedBy: 'TJ'
          }
        }
      }
    }
  };
  const fieldData = buildCanonicalHandoffFieldData(
    {
      rooms: [{
        stepId: 'kitchen-appliance',
        roomName: 'Kitchen Inspection',
        inspectorNotes: 'Actual kitchen note from Tanner.'
      }]
    },
    {
      ...canonicalSource,
      submission: { status: 'Submitted to Tanner' }
    },
    canonicalSource
  );
  const rows = buildInspectionRoomDetailRows(fieldData);
  assert.equal(rows[1][4], 'Actual kitchen note from Tanner.');
  assert.doesNotMatch(String(rows[1][4]), /deviceId|updatedAt/);
  assert.equal(fieldData.rooms[0].inspectorNotes, 'Actual kitchen note from Tanner.');
});

test('metadata-only note lookup stays blank instead of exporting audit JSON', () => {
  const rows = buildInspectionRoomDetailRows({
    rooms: [{ stepId: 'kitchen-appliance', roomName: 'Kitchen Inspection' }],
    system: {
      inspectionRecovery: {
        rooms: [{ stepId: 'kitchen-appliance', roomName: 'Kitchen Inspection' }],
        stepData: {
          'kitchen-appliance': {
            notes: '',
            _fieldUpdates: {
              notes: { deviceId: 'device-test', updatedAt: '2026-09-01T20:38:16.751Z' }
            }
          }
        }
      }
    }
  });
  assert.equal(rows[1][4], '');
});

test('context prefers terminal review status over a stale submit attempt', () => {
  const context = buildAssessmentContextMarkdown(
    { assessmentNumber: '', folderId: 'folder' },
    {
      inspectionId: 'INH-STATUS-TEST',
      inspectionType: 'Test / Training',
      isTestTraining: true,
      submitAttempt: { status: 'In Review' },
      submission: { status: 'Submitted to Tanner' }
    },
    {
      status: 'In Review',
      submission: { status: 'Submitted to Tanner' },
      rooms: [],
      system: { inspectionRecovery: {} }
    },
    [],
    { spreadsheetUrl: 'https://example.com/inspection' },
    { spreadsheetUrl: 'https://example.com/review' },
    { rawJsonUrl: 'https://example.com/raw' }
  );
  assert.match(context, /Review status at export:\*\* Submitted to Tanner/);
  assert.doesNotMatch(context, /Review status at export:\*\* In Review/);
});

test('ready artifact reuse requires matching review-content checksums', () => {
  assert.match(workerSource, /artifactInputsMatch/);
  assert.match(
    workerSource,
    /isCurrentHandoffReceipt\(previousReceipt\)[\s\S]*?artifactInputsMatch[\s\S]*?previousReceipt\.spreadsheetId/
  );
  assert.match(workerSource, /reviewDataHash: stableHash\(handoffArtifactReviewData\(handoffFieldData\)\)/);
});
