import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.localStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {}
};
globalThis.sessionStorage = globalThis.localStorage;

const {
  isContinuableCloudInspection,
  isReviewableCloudInspection,
  cloudReviewUrl
} = await import('../screens.js');

test('active cloud continue list excludes completed review inspections by default', () => {
  assert.equal(isContinuableCloudInspection({ status: 'prepared' }), true);
  assert.equal(isContinuableCloudInspection({ status: 'Field Active' }), true);
  assert.equal(isContinuableCloudInspection({ status: 'completed' }), false);
  assert.equal(isContinuableCloudInspection({ status: 'Submitted to Tanner' }), false);
});

test('completed cloud statuses open read-only review instead of field continuation', () => {
  assert.equal(isReviewableCloudInspection({ status: 'needs review' }), true);
  assert.equal(isReviewableCloudInspection({ status: 'Report Complete' }), true);
  assert.equal(isReviewableCloudInspection({ status: 'field active' }), false);
});

test('completed cloud review URL targets the requested inspection', () => {
  const url = new URL(cloudReviewUrl({ inspectionId: 'INH-TEST-123' }));
  assert.equal(url.origin + url.pathname, 'https://inhauslab.github.io/inhaus-review/review.html');
  assert.equal(url.searchParams.get('id'), 'INH-TEST-123');
  assert.ok(url.searchParams.get('token'));
});
