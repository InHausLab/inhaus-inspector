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
    assert.equal(result.reviewStatus, 'Needs Review');
    assert.deepEqual(requests.map(item => item.method), ['GET', 'POST', 'PATCH']);
    assert.match(requests[1].body, /Needs Review/);
    assert.match(requests[2].body, /Needs Review/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
