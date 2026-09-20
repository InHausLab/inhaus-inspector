import test from 'node:test';
import assert from 'node:assert/strict';

import worker from '../workers/inhaus-photo-worker/src/index.js';

const ENV = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_BUCKET: 'inspection-photos',
  SUPABASE_SERVICE_KEY: 'service-key',
  UPLOAD_SECRET: 'upload-secret'
};

test('sign route rejects an empty unauthenticated request before parsing JSON', async () => {
  const response = await worker.fetch(new Request('https://worker.test/sign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }), ENV);

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: 'unauthorized' });
});
