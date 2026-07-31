import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const localStore = new Map();
globalThis.localStorage = {
  getItem: key => localStore.has(key) ? localStore.get(key) : null,
  setItem: (key, value) => localStore.set(key, String(value)),
  removeItem: key => localStore.delete(key),
  clear: () => localStore.clear()
};
globalThis.sessionStorage = globalThis.localStorage;

const {
  isContinuableCloudInspection,
  isReviewableCloudInspection,
  cloudReviewUrl,
  hideCloudInspectionForPhone,
  restoreCloudInspectionForPhone,
  isCloudInspectionHiddenForPhone
} = await import('../screens.js');

const screensSource = readFileSync(new URL('../screens.js', import.meta.url), 'utf8');
const syncSource = readFileSync(new URL('../sync.js', import.meta.url), 'utf8');

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

test('phone cloud continue can open a prepared inspection directly by ID', () => {
  assert.match(screensSource, /Open prepared inspection/);
  assert.match(screensSource, /openCloudInspectionById/);
  assert.match(screensSource, /loadCloudInspection\(id\)/);
  assert.match(screensSource, /direct inspection ID lookup is the fastest backup path/);
});

test('phone cloud list uses the fast active-only endpoint', () => {
  assert.match(syncSource, /CLOUD_LIST_TIMEOUT_MS = 15000/);
  assert.match(syncSource, /url\.searchParams\.set\('action', 'listActive'\)/);
  assert.match(syncSource, /listCloudInspections[\s\S]*CLOUD_LIST_TIMEOUT_MS/);
  assert.doesNotMatch(screensSource, /Show Completed Review History/);
});

test('phone cloud list can hide old active inspections without deleting cloud data', () => {
  localStorage.clear();
  const oldItem = { inspectionId: 'INH-OLD-123', status: 'Field Active' };
  assert.equal(isCloudInspectionHiddenForPhone(oldItem), false);
  hideCloudInspectionForPhone(oldItem);
  assert.equal(isCloudInspectionHiddenForPhone(oldItem), true);
  restoreCloudInspectionForPhone(oldItem);
  assert.equal(isCloudInspectionHiddenForPhone(oldItem), false);
  assert.match(screensSource, /Hide from This Phone/);
  assert.match(screensSource, /Show Hidden Inspections/);
  assert.doesNotMatch(screensSource, /deleteCloudInspection/);
});

test('office preparation requires a start-shell receipt before phone handoff', () => {
  assert.match(syncSource, /export async function ensureStartInspectionShell/);
  assert.match(syncSource, /payload\.action = 'startInspectionShell'/);
  assert.match(syncSource, /Assessment shell is not ready/);
  assert.match(screensSource, /ensureStartInspectionShell\(ctx\.stepList, \{ force: !isEdit \}\)/);
  assert.match(screensSource, /Do not send this to the phone yet/);
});

test('test training preparation still creates a cloud pickup shell', () => {
  const start = syncSource.indexOf('export async function ensureStartInspectionShell');
  const end = syncSource.indexOf('async function recoverDriveMetadataFromReviewApi', start);
  const ensureShell = syncSource.slice(start, end);
  assert.match(ensureShell, /payload\.action = 'startInspectionShell'/);
  assert.doesNotMatch(ensureShell, /return \{ ok: true, skipped: true/);
  assert.match(syncSource, /inspection\._startInspectionShellStatus === 'ready'[\s\S]*inspection\.driveFolderId/);
});
