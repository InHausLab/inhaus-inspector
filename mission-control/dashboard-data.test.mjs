import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { selectLatestPhotos, extractFollowUps } = require('./dashboard-data.js');

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
