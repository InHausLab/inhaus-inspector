#!/usr/bin/env node

const baseUrl = String(process.argv[2] || 'https://inhaus-photo-worker.inhauslab.workers.dev').replace(/\/+$/, '');
const runStartShell = process.argv.includes('--start-shell-test');
const runHandoff = process.argv.includes('--handoff-test');
const runRunner = process.argv.includes('--runner-test');
const runActivity = process.argv.includes('--activity-test');
const expectedWorkerVersion = process.env.EXPECTED_WORKER_VERSION || 'handoff-w9';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function readJson(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`invalid_json:${response.status}:${text.slice(0, 200)}`);
  }
}

async function smokeHealth() {
  const response = await fetch(`${baseUrl}/health`);
  const data = await readJson(response);
  assert(response.ok, `health_not_ok:${response.status}:${JSON.stringify(data).slice(0, 200)}`);
  assert(data.service === 'inhaus-photo-worker', 'health service mismatch');
  assert(data.version, 'health missing version');
  assert(data.version === expectedWorkerVersion, `health version mismatch: expected ${expectedWorkerVersion}, got ${data.version}`);
  assert(Array.isArray(data.routes) && data.routes.includes('POST /start-inspection-shell'), 'health missing start-shell route');
  assert(Array.isArray(data.routes) && data.routes.includes('POST /handoff-jobs'), 'health missing handoff job route');
  assert(Array.isArray(data.routes) && data.routes.includes('POST /handoff-jobs/run'), 'health missing handoff runner route');
  assert(Array.isArray(data.routes) && data.routes.includes('POST /review-activity-events'), 'health missing review activity event route');
  assert(data.dependencies && data.dependencies.supabaseUrl === true, 'health missing Supabase URL dependency');
  assert(data.dependencies && data.dependencies.supabaseBucket === true, 'health missing Supabase bucket dependency');
  assert(data.dependencies && data.dependencies.reviewAccessToken === true, 'health missing review access token dependency');
  assert(data.dependencies && data.dependencies.assessmentsFolderId === true, 'health missing assessments folder config');
  assert(data.dependencies && data.dependencies.reportTrackerSheetId === true, 'health missing tracker sheet config');
  console.log(`PASS health ${data.version}`);
}

async function smokeTrainingStartShell() {
  const sharedSecret = process.env.WORKER_UPLOAD_SECRET || process.env.UPLOAD_SECRET || '';
  assert(sharedSecret, 'WORKER_UPLOAD_SECRET or UPLOAD_SECRET env var is required for --start-shell-test');
  const inspectionId = `INH-TRAINING-SMOKE-${Date.now()}`;
  const response = await fetch(`${baseUrl}/start-inspection-shell`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sharedSecret,
      inspectionId,
      inspectionType: 'Test / Training',
      clientName: 'Worker Smoke Test',
      propertyAddress: '1 Smoke Test Way, Basalt CO',
      inspectorName: 'Automated Smoke',
      inspectionDate: new Date().toISOString().slice(0, 10),
      startedAt: new Date().toISOString()
    })
  });
  const data = await readJson(response);
  assert(response.ok, `start_shell_not_ok:${response.status}:${JSON.stringify(data).slice(0, 200)}`);
  assert(data.status === 'ready', 'training smoke shell is not ready');
  assert(data.shellStatus === 'ready', 'training smoke shell status mismatch');
  assert(data.isTestTraining === true, 'training smoke is not marked test/training');
  assert(data.assessmentNumber === '', 'training smoke assigned a real assessment number');
  assert(data.trackerStatus === 'skipped_test_training', 'training smoke tracker status mismatch');
  assert(data.folderUrl, 'training smoke missing test folder URL');
  console.log(`PASS training start-shell ${inspectionId}`);
}

async function smokeTrainingHandoff() {
  const reviewToken = process.env.WORKER_REVIEW_TOKEN || process.env.REVIEW_ACCESS_TOKEN || '';
  assert(reviewToken, 'WORKER_REVIEW_TOKEN or REVIEW_ACCESS_TOKEN env var is required for --handoff-test');
  const inspectionId = `INH-TRAINING-HANDOFF-${Date.now()}`;
  const response = await fetch(`${baseUrl}/handoff-jobs`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${reviewToken}`
    },
    body: JSON.stringify({
      inspectionId,
      requestedBy: 'worker-live-smoke',
      reviewedData: {
        clientName: 'Worker Handoff Smoke',
        propertyAddress: '1 Smoke Test Way, Basalt CO',
        inspectionDate: new Date().toISOString().slice(0, 10),
        inspectionType: 'Test / Training',
        isTestTraining: true
      }
    })
  });
  const data = await readJson(response);
  assert(response.ok, `handoff_not_ok:${response.status}:${JSON.stringify(data).slice(0, 300)}`);
  const receipt = data.artifactReceipt || data.reviewPortalData || {};
  assert(receipt.status === 'ready', 'handoff smoke receipt not ready');
  assert(receipt.isTestTraining === true, 'handoff smoke is not marked test/training');
  assert(receipt.trackerStatus === 'skipped_test_training', 'handoff smoke should skip tracker');
  assert(receipt.folderUrl, 'handoff smoke missing folder URL');
  assert(receipt.spreadsheetUrl, 'handoff smoke missing spreadsheet URL');
  assert(receipt.rawJsonUrl || receipt.rawReviewDataUrl, 'handoff smoke missing raw backup URL');
  console.log(`PASS training handoff ${inspectionId}`);
  return inspectionId;
}

async function smokeHandoffRunner(inspectionId) {
  const reviewToken = process.env.WORKER_REVIEW_TOKEN || process.env.REVIEW_ACCESS_TOKEN || '';
  assert(reviewToken, 'WORKER_REVIEW_TOKEN or REVIEW_ACCESS_TOKEN env var is required for --runner-test');
  assert(inspectionId, '--runner-test requires a smoke handoff inspection id');
  const response = await fetch(`${baseUrl}/handoff-jobs/run`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${reviewToken}`
    },
    body: JSON.stringify({
      inspectionId,
      requestedBy: 'worker-live-smoke-runner'
    })
  });
  const data = await readJson(response);
  assert(response.ok, `runner_not_ok:${response.status}:${JSON.stringify(data).slice(0, 300)}`);
  assert(data.processed === 1, 'runner smoke did not process one job');
  assert(Array.isArray(data.results) && data.results[0] && data.results[0].status === 'ready', 'runner smoke result not ready');
  console.log(`PASS handoff runner ${inspectionId}`);
}

async function smokeReviewActivityEvent() {
  const reviewToken = process.env.WORKER_REVIEW_TOKEN || process.env.REVIEW_ACCESS_TOKEN || '';
  assert(reviewToken, 'WORKER_REVIEW_TOKEN or REVIEW_ACCESS_TOKEN env var is required for --activity-test');
  const inspectionId = `INH-TRAINING-ACTIVITY-${Date.now()}`;
  const response = await fetch(`${baseUrl}/review-activity-events`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${reviewToken}`
    },
    body: JSON.stringify({
      inspectionId,
      actor: 'worker-live-smoke',
      eventType: 'save',
      eventPayload: {
        source: 'worker-live-smoke',
        section: 'smoke',
        fieldKey: 'smokeField',
        valueMeta: { type: 'text', size: 24 },
        value: 'raw smoke value should be stripped by Worker sanitizer',
        note: 'raw smoke note should be stripped by Worker sanitizer'
      }
    })
  });
  const data = await readJson(response);
  assert(response.ok, `activity_not_ok:${response.status}:${JSON.stringify(data).slice(0, 300)}`);
  assert(data.saved === true, 'activity smoke did not save event');
  assert(data.inspectionId === inspectionId, 'activity smoke inspection id mismatch');
  assert(data.eventType === 'save', 'activity smoke event type mismatch');
  console.log(`PASS review activity event ${inspectionId}`);
}

await smokeHealth();
if (runStartShell) await smokeTrainingStartShell();
let handoffInspectionId = '';
if (runHandoff || runRunner) handoffInspectionId = await smokeTrainingHandoff();
if (runRunner) await smokeHandoffRunner(handoffInspectionId);
if (runActivity) await smokeReviewActivityEvent();
console.log('Worker live smoke passed');
