import test from 'node:test';
import assert from 'node:assert/strict';

import {
  flattenInspectionCheckpoints,
  mergeRemoteInspection,
  setInspectorIdentity,
  hasConfirmedInspectorIdentity,
  getInspectorIdentity
} from '../findings.js';
import { buildResumeData } from '../inspection.js';
import { normalizeBridgeCapabilities } from '../sync.js';

function storageMock() {
  const values = new Map();
  return {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key)
  };
}

globalThis.localStorage = storageMock();
globalThis.sessionStorage = storageMock();

test('flattens a partial outer checkpoint without losing the complete inner steps', () => {
  const inspection = {
    inspectionId: 'INH-TEST',
    status: 'in-progress',
    stepData: {},
    resumeData: {
      inspectionId: 'INH-TEST',
      stepData: {
        exterior: { answer: 'outer-new-value', _updatedAt: '2026-07-22T20:00:00Z' }
      },
      resumeData: {
        inspectionId: 'INH-TEST',
        stepData: {
          exterior: { answer: 'inner-old-value', _updatedAt: '2026-07-22T19:00:00Z' },
          utility: { answer: 'complete-inner-step' }
        },
        findings: [{ findingId: 'finding-1', updatedAt: '2026-07-22T19:00:00Z' }]
      }
    }
  };

  const flattened = flattenInspectionCheckpoints(inspection);
  assert.equal(flattened.stepData.exterior.answer, 'outer-new-value');
  assert.equal(flattened.stepData.utility.answer, 'complete-inner-step');
  assert.equal(flattened.findings.length, 1);
  assert.equal(Object.hasOwn(flattened, 'resumeData'), false);
});

test('merges simultaneous inspectors by field timestamp and preserves both sections', () => {
  const local = {
    inspectionId: 'INH-TEAM',
    inspectorName: 'Dave',
    stepData: {
      exterior: {
        condition: 'local newer',
        _updatedAt: '2026-07-22T20:00:00Z',
        _fieldUpdates: { condition: { updatedAt: '2026-07-22T20:00:00Z' } }
      }
    },
    findings: [],
    collaboration: { enabled: true, members: [], assignments: {}, activity: [], presence: {} }
  };
  const remote = {
    inspectionId: 'INH-TEAM',
    inspectorName: 'Dave',
    stepData: {
      exterior: {
        condition: 'remote older',
        _updatedAt: '2026-07-22T19:00:00Z',
        _fieldUpdates: { condition: { updatedAt: '2026-07-22T19:00:00Z' } }
      },
      'water-sample': {
        collected: 'Yes',
        _updatedAt: '2026-07-22T20:05:00Z',
        _fieldUpdates: { collected: { updatedAt: '2026-07-22T20:05:00Z' } }
      }
    },
    findings: [],
    collaboration: { enabled: true, members: [], assignments: {}, activity: [], presence: {} }
  };

  const merged = mergeRemoteInspection(local, remote);
  assert.equal(merged.stepData.exterior.condition, 'local newer');
  assert.equal(merged.stepData['water-sample'].collected, 'Yes');
});

test('requires and records an explicit team identity for the current browser session', () => {
  const inspection = {
    inspectionId: 'INH-IDENTITY',
    inspectorName: 'Dave',
    findings: [],
    commentLibrary: [],
    auditTrail: [],
    collaboration: {
      enabled: true,
      members: [
        { memberId: 'dave', name: 'Dave', role: 'Lead' },
        { memberId: 'matt', name: 'Matt', role: 'Inspector' }
      ],
      assignments: {},
      activity: [],
      presence: {}
    }
  };

  assert.equal(hasConfirmedInspectorIdentity(inspection), false);
  setInspectorIdentity(inspection, 'matt');
  assert.equal(hasConfirmedInspectorIdentity(inspection), true);
  assert.equal(getInspectorIdentity(inspection).name, 'Matt');
});

test('accepts both live top-level and legacy nested capability responses', () => {
  assert.equal(normalizeBridgeCapabilities({ status: 'ok', teamFieldMerge: true }).teamFieldMerge, true);
  assert.equal(normalizeBridgeCapabilities({ status: 'ok', capabilities: { teamFieldMerge: true } }).teamFieldMerge, true);
});

test('new resume checkpoints are flat, versioned, and include a recovery receipt', () => {
  const resume = buildResumeData({
    inspectionId: 'INH-RECEIPT',
    stepData: {
      exterior: { answer: 'Yes', _photos: [{ photoId: 'photo-1', dataUrl: 'data:image/jpeg;base64,abc' }] },
      utility: { answer: 'No' }
    },
    findings: [],
    resumeData: { stepData: { stale: { answer: 'must not be nested' } } }
  });

  assert.equal(resume.resumeSchemaVersion, 2);
  assert.equal(Object.hasOwn(resume, 'resumeData'), false);
  assert.equal(resume.checkpointReceipt.stepCount, 2);
  assert.equal(resume.checkpointReceipt.uniquePhotoCount, 1);
  assert.match(resume.checkpointReceipt.checkpointId, /^INH-RECEIPT-/);
  assert.equal(resume.stepData.exterior._photos[0].dataUrl, undefined);
});
