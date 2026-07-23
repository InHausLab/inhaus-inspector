import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.localStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {}
};
globalThis.sessionStorage = globalThis.localStorage;

const {
  rapidCaptureCreatesFinding,
  rapidCapturePhotoRouting
} = await import('../screens.js');

test('photo-only rapid capture stays unassigned for later organization', () => {
  assert.deepEqual(rapidCapturePhotoRouting('', ''), {
    roomName: '',
    stepName: '',
    placementSource: 'rapid_capture_unassigned',
    routingStatus: 'needs_placement'
  });
  assert.equal(rapidCaptureCreatesFinding(''), false);
  assert.equal(rapidCaptureCreatesFinding('   '), false);
});

test('optional room context keeps rapid photos automatically organized', () => {
  assert.deepEqual(rapidCapturePhotoRouting('Primary Bedroom', 'Room Assessment'), {
    roomName: 'Primary Bedroom',
    stepName: 'Room Assessment',
    placementSource: 'rapid_capture_context',
    routingStatus: 'auto'
  });
  assert.equal(rapidCaptureCreatesFinding('Visible staining at north wall'), true);
});
