import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';

const require = createRequire(import.meta.url);
const { selectLatestPhotos, extractFollowUps, fetchJsonWithRetry, mapWithConcurrency } = require('./dashboard-data.js');

test('selectLatestPhotos returns the 12 newest photos in descending timestamp order', () => {
  const photos = Array.from({ length: 13 }, (_, index) => ({
    photoId: `photo-${index + 1}`,
    timestamp: `2026-09-${String(index + 1).padStart(2, '0')}T12:00:00.000Z`
  }));

  const latest = selectLatestPhotos(photos);

  assert.equal(latest.length, 12);
  assert.deepEqual(
    latest.map(photo => photo.photoId),
    ['photo-13', 'photo-12', 'photo-11', 'photo-10', 'photo-9', 'photo-8', 'photo-7', 'photo-6', 'photo-5', 'photo-4', 'photo-3', 'photo-2']
  );
});

test('extractFollowUps returns every populated follow-up newest first', () => {
  const stepData = {};
  for (let index = 1; index <= 13; index += 1) {
    stepData[`room-${index}`] = {
      roomName: `Room ${index}`,
      followUpNeeded: 'Yes',
      followUpNote: `Action ${index}`,
      _fieldUpdates: {
        followUpNote: { updatedAt: `2026-09-${String(index).padStart(2, '0')}T09:30:00.000Z` }
      }
    };
  }

  const followUps = extractFollowUps({ resumeData: { stepData } }, []);

  assert.equal(followUps.length, 13);
  assert.equal(followUps[0].room, 'Room 13');
  assert.equal(followUps[0].text, 'Action 13');
  assert.equal(followUps[12].room, 'Room 1');
});

test('extractFollowUps includes recorded time and resolves associated follow-up photos', () => {
  const photos = [
    {
      photoId: 'follow-photo-1',
      timestamp: '2026-09-16T14:05:00.000Z',
      url: 'https://example.test/follow-photo-1.jpg',
      roomName: 'Utility Room'
    }
  ];
  const inspection = {
    resumeData: {
      stepData: {
        utility: {
          roomName: 'Utility Room',
          followUpNeeded: 'Yes',
          followUpTimeframe: '3 months',
          followUpNote: 'Confirm the repaired drain remains dry.',
          _fieldUpdates: {
            followUpNote: { updatedAt: '2026-09-16T14:04:00.000Z' }
          },
          _followUpPhotos: [
            { photoId: 'follow-photo-1', timestamp: '2026-09-16T14:05:00.000Z' }
          ]
        }
      }
    }
  };

  const followUps = extractFollowUps(inspection, photos);

  assert.deepEqual(followUps, [{
    stepId: 'utility',
    room: 'Utility Room',
    text: 'Confirm the repaired drain remains dry.',
    timeframe: '3 months',
    recordedAt: '2026-09-16T14:05:00.000Z',
    associatedPhotos: [photos[0]]
  }]);
});

test('extractFollowUps ignores later unrelated room edits when follow-up timestamps exist', () => {
  const inspection = {
    stepData: {
      utility: {
        roomName: 'Utility Room',
        followUpNeeded: 'Yes',
        followUpNote: 'Earlier follow-up',
        _fieldUpdates: {
          followUpNote: { updatedAt: '2026-09-16T10:00:00.000Z' }
        },
        _updatedAt: '2026-09-16T12:00:00.000Z'
      },
      kitchen: {
        roomName: 'Kitchen',
        followUpNeeded: 'Yes',
        followUpNote: 'Later follow-up',
        _fieldUpdates: {
          followUpNote: { updatedAt: '2026-09-16T11:00:00.000Z' }
        },
        _updatedAt: '2026-09-16T11:00:00.000Z'
      }
    }
  };

  const followUps = extractFollowUps(inspection, []);

  assert.equal(followUps[0].room, 'Kitchen');
  assert.equal(followUps[1].recordedAt, '2026-09-16T10:00:00.000Z');
});

test('fetchJsonWithRetry recovers when a live-data endpoint returns transient 503 responses', async () => {
  let requestCount = 0;
  const server = createServer((request, response) => {
    requestCount += 1;
    if (requestCount < 3) {
      response.writeHead(503, { 'Content-Type': 'text/html' });
      response.end('<!doctype html><title>Service unavailable</title>');
      return;
    }
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ status: 'ok', inspections: [{ inspectionId: 'INH-TEST' }] }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));

  try {
    const address = server.address();
    const result = await fetchJsonWithRetry(
      `http://127.0.0.1:${address.port}/inspections/active`,
      {},
      { attempts: 3, baseDelayMs: 0 }
    );

    assert.equal(requestCount, 3);
    assert.deepEqual(result, { status: 'ok', inspections: [{ inspectionId: 'INH-TEST' }] });
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test('fetchJsonWithRetry aborts a hung attempt and retries it', async () => {
  let requestCount = 0;
  const server = createServer((request, response) => {
    requestCount += 1;
    if (requestCount === 1) {
      setTimeout(() => {
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ status: 'ok', recovered: false }));
      }, 80);
      return;
    }
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ status: 'ok', recovered: true }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));

  try {
    const address = server.address();
    const result = await fetchJsonWithRetry(
      `http://127.0.0.1:${address.port}/inspections/active`,
      {},
      { attempts: 2, baseDelayMs: 0, timeoutMs: 25 }
    );

    assert.equal(requestCount, 2);
    assert.deepEqual(result, { status: 'ok', recovered: true });
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test('mapWithConcurrency preserves inspection order while limiting simultaneous hydration', async () => {
  let active = 0;
  let maximumActive = 0;
  const inspections = [1, 2, 3, 4, 5, 6, 7];

  const hydrated = await mapWithConcurrency(inspections, async inspection => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    await new Promise(resolve => setTimeout(resolve, 5));
    active -= 1;
    return inspection * 10;
  }, 3);

  assert.deepEqual(hydrated, [10, 20, 30, 40, 50, 60, 70]);
  assert.equal(maximumActive, 3);
});
