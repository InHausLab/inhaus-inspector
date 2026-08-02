import test from 'node:test';
import assert from 'node:assert/strict';

import worker from '../workers/inhaus-photo-worker/src/index.js';

const ENV = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_KEY: 'service-key',
  REVIEW_ACCESS_TOKEN: 'review-token',
  REVIEW_ADMIN_TOKEN: 'admin-token'
};

function reviewRequest(path, options = {}) {
  return new Request(`https://worker.test${path}`, {
    ...options,
    headers: {
      Authorization: 'Bearer review-token',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {})
    }
  });
}

test('inspection detail rejects the old inspection-id token shortcut', async () => {
  const response = await worker.fetch(new Request(
    'https://worker.test/inspections/INH-TEST-123?token=inh-test-123'
  ), ENV);
  assert.equal(response.status, 401);
});

test('submit smoke is authorized and non-mutating', async () => {
  const originalFetch = globalThis.fetch;
  let networkCalls = 0;
  globalThis.fetch = async () => {
    networkCalls += 1;
    throw new Error('submit smoke must not call a dependency');
  };
  try {
    const response = await worker.fetch(reviewRequest(
      '/submit-smoke?inspectionId=INH-READINESS-PROBE'
    ), ENV);
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.smoke, true);
    assert.equal(result.authorized, true);
    assert.equal(result.statusChanged, false);
    assert.equal(result.emailSent, false);
    assert.equal(result.backend, 'cloudflare-worker');
    assert.equal(networkCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('portal inspection inventory merges assessment and review status', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async url => {
    const requestUrl = String(url);
    if (requestUrl.includes('/rest/v1/ihl_assessments?')) {
      return Response.json([{
        inspection_id: 'INH-TEST-123',
        assessment_num: '321',
        report_id: null,
        status: 'In Progress',
        drive_folder_id: 'folder-1',
        assessment_folder_url: 'https://drive.test/folder-1',
        inspection_date: '2026-08-01',
        raw_jsonb: {
          inspectionId: 'INH-TEST-123',
          clientName: 'Test Client',
          propertyAddress: '123 Test Rd',
          inspectorName: 'Inspector',
          photoCount: 4
        }
      }]);
    }
    if (requestUrl.includes('/rest/v1/review_data?')) {
      return Response.json([{
        inspection_id: 'INH-TEST-123',
        field_data: { submission: { status: 'Submitted to Tanner' } },
        updated_at: '2026-08-01T18:00:00.000Z'
      }]);
    }
    throw new Error(`unexpected request: ${requestUrl}`);
  };
  try {
    const response = await worker.fetch(reviewRequest('/inspections'), ENV);
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.count, 1);
    assert.equal(result.inspections[0].inspectionId, 'INH-TEST-123');
    assert.equal(result.inspections[0].status, 'Submitted to Tanner');
    assert.equal(result.inspections[0].photoCount, 4);
    assert.equal(result.inspections[0].assessmentNumber, '321');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('admin unlock updates review storage and assessment status', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options = {}) => {
    const requestUrl = String(url);
    const method = options.method || 'GET';
    requests.push({ requestUrl, method, body: options.body || '' });
    if (method === 'GET' && requestUrl.includes('/rest/v1/review_data?')) {
      return Response.json([{
        inspection_id: 'INH-TEST-123',
        field_data: { submission: { status: 'Submitted to Tanner' } },
        updated_at: '2026-08-01T18:00:00.000Z'
      }]);
    }
    if (method === 'PATCH' && requestUrl.includes('/rest/v1/review_data?')) {
      const payload = JSON.parse(options.body);
      return Response.json([{
        inspection_id: 'INH-TEST-123',
        field_data: payload.field_data,
        updated_at: payload.updated_at
      }]);
    }
    return new Response(null, { status: 204 });
  };
  try {
    const response = await worker.fetch(reviewRequest('/review-unlock', {
      method: 'POST',
      body: JSON.stringify({ inspectionId: 'INH-TEST-123', adminToken: 'admin-token' })
    }), ENV);
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.unlocked, true);
    assert.equal(result.reviewStatus, 'In Review');
    assert.deepEqual(requests.map(item => item.method), ['GET', 'PATCH', 'PATCH']);
    assert.match(requests[1].body, /In Review/);
    assert.match(requests[2].body, /In Review/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('review field save moves a synced assessment to In Review', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options = {}) => {
    const requestUrl = String(url);
    const method = options.method || 'GET';
    requests.push({ requestUrl, method, body: options.body || '' });
    if (method === 'GET' && requestUrl.includes('/rest/v1/review_data?')) {
      return Response.json([{ inspection_id: 'INH-TEST-123', field_data: {}, updated_at: null }]);
    }
    if (method === 'PATCH' && requestUrl.includes('/rest/v1/review_data?')) {
      const payload = JSON.parse(options.body);
      return Response.json([{
        inspection_id: 'INH-TEST-123',
        field_data: payload.field_data,
        updated_at: payload.updated_at
      }]);
    }
    if (method === 'GET' && requestUrl.includes('/rest/v1/ihl_assessments?')) {
      return Response.json([{ inspection_id: 'INH-TEST-123', status: 'Synced', raw_jsonb: {} }]);
    }
    if (method === 'PATCH' && requestUrl.includes('/rest/v1/ihl_assessments?')) {
      return Response.json([{ inspection_id: 'INH-TEST-123', status: 'In Review' }]);
    }
    throw new Error(`unexpected request: ${requestUrl}`);
  };
  try {
    const response = await worker.fetch(reviewRequest('/save-review', {
      method: 'POST',
      body: JSON.stringify({
        inspectionId: 'INH-TEST-123',
        markInReview: true,
        field: { stepId: 'bedroom-1', key: 'notes', value: 'Reviewed note' }
      })
    }), ENV);
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.reviewStatus, 'In Review');
    assert.equal(result.fieldData.status, 'In Review');
    assert.deepEqual(requests.map(item => item.method), ['GET', 'PATCH', 'GET', 'PATCH']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('submitted review status updates the assessment inventory status', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options = {}) => {
    const requestUrl = String(url);
    const method = options.method || 'GET';
    requests.push({ requestUrl, method, body: options.body || '' });
    if (method === 'GET' && requestUrl.includes('/rest/v1/review_data?')) {
      return Response.json([{ inspection_id: 'INH-TEST-123', field_data: { status: 'In Review' }, updated_at: null }]);
    }
    if (method === 'PATCH' && requestUrl.includes('/rest/v1/review_data?')) {
      const payload = JSON.parse(options.body);
      return Response.json([{
        inspection_id: 'INH-TEST-123',
        field_data: payload.field_data,
        updated_at: payload.updated_at
      }]);
    }
    if (method === 'GET' && requestUrl.includes('/rest/v1/ihl_assessments?')) {
      return Response.json([{ inspection_id: 'INH-TEST-123', status: 'In Review', raw_jsonb: {} }]);
    }
    if (method === 'PATCH' && requestUrl.includes('/rest/v1/ihl_assessments?')) {
      assert.match(options.body, /Submitted to Tanner/);
      return Response.json([{ inspection_id: 'INH-TEST-123', status: 'Submitted to Tanner' }]);
    }
    throw new Error(`unexpected request: ${requestUrl}`);
  };
  try {
    const response = await worker.fetch(reviewRequest('/save-review', {
      method: 'POST',
      body: JSON.stringify({
        inspectionId: 'INH-TEST-123',
        field: { stepId: 'summary', key: 'status', value: 'Submitted to Tanner' }
      })
    }), ENV);
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.reviewStatus, 'Submitted to Tanner');
    assert.equal(result.fieldData.status, 'Submitted to Tanner');
    assert.deepEqual(requests.map(item => item.method), ['GET', 'PATCH', 'GET', 'PATCH']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('parallel review field saves survive optimistic conflict retries', async () => {
  const originalFetch = globalThis.fetch;
  let reviewRow = {
    inspection_id: 'INH-RACE-TEST',
    field_data: {},
    updated_at: '2026-08-01T20:00:00.000Z'
  };
  let initialReadCount = 0;
  let releaseInitialReads;
  const initialReadBarrier = new Promise(resolve => { releaseInitialReads = resolve; });
  let conflictCount = 0;

  globalThis.fetch = async (url, options = {}) => {
    const requestUrl = String(url);
    const method = options.method || 'GET';
    if (!requestUrl.includes('/rest/v1/review_data?')) {
      throw new Error(`unexpected request: ${requestUrl}`);
    }
    if (method === 'GET') {
      const snapshot = structuredClone(reviewRow);
      initialReadCount += 1;
      if (initialReadCount === 8) releaseInitialReads();
      await initialReadBarrier;
      return Response.json([snapshot]);
    }
    if (method === 'PATCH') {
      const requestParams = new URL(requestUrl).searchParams;
      const expectedUpdatedAt = String(requestParams.get('updated_at') || '').replace(/^eq\./, '');
      if (expectedUpdatedAt !== reviewRow.updated_at) {
        conflictCount += 1;
        return Response.json([]);
      }
      const payload = JSON.parse(options.body);
      reviewRow = {
        inspection_id: reviewRow.inspection_id,
        field_data: payload.field_data,
        updated_at: payload.updated_at
      };
      return Response.json([structuredClone(reviewRow)]);
    }
    throw new Error(`unexpected method: ${method}`);
  };

  try {
    const responses = await Promise.all(Array.from({ length: 8 }, (_, index) => worker.fetch(reviewRequest('/save-review', {
      method: 'POST',
      body: JSON.stringify({
        inspectionId: 'INH-RACE-TEST',
        field: { stepId: 'race-check', key: `field${index + 1}`, value: `value${index + 1}` }
      })
    }), ENV)));
    assert.deepEqual(responses.map(response => response.status), Array(8).fill(200));
    assert.equal(Object.keys(reviewRow.field_data['race-check']).length, 8);
    assert.ok(conflictCount > 0, 'the test must force at least one write conflict');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('parallel first review saves survive a concurrent row insert', async () => {
  const originalFetch = globalThis.fetch;
  let reviewRow = null;
  let initialReadCount = 0;
  let releaseInitialReads;
  const initialReadBarrier = new Promise(resolve => { releaseInitialReads = resolve; });
  let insertConflictCount = 0;

  globalThis.fetch = async (url, options = {}) => {
    const requestUrl = String(url);
    const method = options.method || 'GET';
    if (!requestUrl.includes('/rest/v1/review_data?')) {
      throw new Error(`unexpected request: ${requestUrl}`);
    }
    if (method === 'GET') {
      const snapshot = reviewRow ? structuredClone(reviewRow) : null;
      initialReadCount += 1;
      if (initialReadCount === 4) releaseInitialReads();
      await initialReadBarrier;
      return Response.json(snapshot ? [snapshot] : []);
    }
    if (method === 'POST') {
      if (reviewRow) {
        insertConflictCount += 1;
        return Response.json({ code: '23505', message: 'duplicate key' }, { status: 409 });
      }
      const payload = JSON.parse(options.body);
      reviewRow = structuredClone(payload);
      return Response.json([structuredClone(reviewRow)]);
    }
    if (method === 'PATCH') {
      const requestParams = new URL(requestUrl).searchParams;
      const expectedUpdatedAt = String(requestParams.get('updated_at') || '').replace(/^eq\./, '');
      if (!reviewRow || expectedUpdatedAt !== reviewRow.updated_at) return Response.json([]);
      const payload = JSON.parse(options.body);
      reviewRow = {
        inspection_id: reviewRow.inspection_id,
        field_data: payload.field_data,
        updated_at: payload.updated_at
      };
      return Response.json([structuredClone(reviewRow)]);
    }
    throw new Error(`unexpected method: ${method}`);
  };

  try {
    const responses = await Promise.all(Array.from({ length: 4 }, (_, index) => worker.fetch(reviewRequest('/save-review', {
      method: 'POST',
      body: JSON.stringify({
        inspectionId: 'INH-FIRST-RACE',
        field: { stepId: 'first-save', key: `field${index + 1}`, value: `value${index + 1}` }
      })
    }), ENV)));
    assert.deepEqual(responses.map(response => response.status), Array(4).fill(200));
    assert.equal(Object.keys(reviewRow.field_data['first-save']).length, 4);
    assert.ok(insertConflictCount > 0, 'the test must force a concurrent insert conflict');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
