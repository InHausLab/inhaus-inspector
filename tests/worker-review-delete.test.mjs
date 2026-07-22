import test from 'node:test';
import assert from 'node:assert/strict';

import worker from '../workers/inhaus-photo-worker/src/index.js';

const ENV = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_BUCKET: 'inspection-photos',
  SUPABASE_SERVICE_KEY: 'service-key',
  REVIEW_ACCESS_TOKEN: 'review-token'
};

test('review photo delete route rejects an invalid review token', async () => {
  const response = await worker.fetch(new Request('https://worker.test/delete-review-photo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer wrong-token' },
    body: JSON.stringify({ inspectionId: 'INH-TEST', photoId: 'photo-1' })
  }), ENV);

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: 'unauthorized' });
});

test('review photo delete route removes storage and metadata when authorized', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), method: options.method || 'GET' });
    return new Response('', { status: 200 });
  };

  try {
    const response = await worker.fetch(new Request('https://worker.test/delete-review-photo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer review-token' },
      body: JSON.stringify({ inspectionId: 'INH-TEST', photoId: 'photo-1' })
    }), ENV);

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      deleted: true,
      metadata: 'deleted',
      inspectionId: 'INH-TEST',
      photoId: 'photo-1'
    });
    assert.deepEqual(requests.map(request => request.method), ['DELETE', 'DELETE']);
    assert.match(requests[0].url, /\/storage\/v1\/object\/inspection-photos$/);
    assert.match(requests[1].url, /\/rest\/v1\/inspector_photo_uploads\?/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
