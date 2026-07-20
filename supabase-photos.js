// InHaus Inspector — Worker-signed photo upload client
//
// Photos still upload as already-compressed JPEG blobs, but the browser no
// longer writes to Supabase with the publishable key. It asks the InHaus
// Cloudflare Worker for a short-lived signed upload URL, then PUTs the binary
// bytes to that URL. The Worker owns service-role Supabase writes and Drive
// mirroring.

import { PHOTO_WORKER_URL, PHOTO_UPLOAD_SECRET } from './config.js?v=175';

async function fetchWithTimeout(url, options, timeoutMs, label) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, Object.assign({}, options || {}, { signal: controller.signal }));
  } catch (err) {
    if (err && err.name === 'AbortError') {
      throw new Error((label || 'Photo request') + ' timed out. Keep the app open and retry.');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function dataUrlToBlob(dataUrl) {
  const comma = dataUrl.indexOf(',');
  const head = dataUrl.slice(0, comma);
  const body = dataUrl.slice(comma + 1);
  const mime = (head.match(/data:([^;]+)/) || [])[1] || 'image/jpeg';
  const isBase64 = /;base64/i.test(head);
  const binary = isBase64 ? atob(body) : decodeURIComponent(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

function storagePathFor(inspectionId, photoId) {
  const safeInspection = String(inspectionId || 'unknown').replace(/[^A-Za-z0-9_-]/g, '_');
  const safePhoto = String(photoId || 'photo').replace(/[^A-Za-z0-9_-]/g, '_');
  return `${safeInspection}/${safePhoto}.jpg`;
}

function workerUrl(path) {
  if (!PHOTO_WORKER_URL) throw new Error('Photo Worker not configured');
  return PHOTO_WORKER_URL.replace(/\/+$/, '') + path;
}

async function parseJsonResponse(resp, context) {
  const text = await resp.text().catch(() => '');
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {};
  }
  if (!resp.ok) {
    throw new Error(context + ' ' + resp.status + ': ' + (data.error || text).slice(0, 200));
  }
  return data;
}

async function requestSignedUpload(photo, storagePath) {
  const resp = await fetchWithTimeout(workerUrl('/sign'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      inspectionId: photo.inspectionId,
      photoId: photo.photoId,
      roomName: photo.roomName || '',
      stepName: photo.stepName || '',
      caption: photo.caption || '',
      slot: photo.assignedSlot || photo.slot || '',
      storagePath,
      sharedSecret: PHOTO_UPLOAD_SECRET
    })
  }, 30000, 'Photo sign request');
  const data = await parseJsonResponse(resp, 'Photo sign failed');
  if (!data.signedUrl) throw new Error('Photo sign failed: missing signedUrl');
  return data;
}

export async function uploadPhotoToSupabase(photo) {
  if (!photo || !photo.dataUrl || photo.dataUrl === '__uploaded__') throw new Error('No image data');
  if (!photo.inspectionId || !photo.photoId) throw new Error('Missing inspectionId/photoId');

  const blob = dataUrlToBlob(photo.dataUrl);
  const storagePath = storagePathFor(photo.inspectionId, photo.photoId);
  const signed = await requestSignedUpload(photo, storagePath);
  const path = signed.storagePath || storagePath;

  const upload = await fetchWithTimeout(signed.signedUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': 'image/jpeg',
      'x-upsert': 'true'
    },
    body: blob
  }, 120000, 'Photo upload');

  if (!upload.ok) {
    const detail = await upload.text().catch(() => '');
    const alreadyExists = upload.status === 409 ||
      /"statusCode"\s*:\s*"409"|duplicate|already exists/i.test(detail);
    if (!alreadyExists) {
      throw new Error(`Signed photo upload ${upload.status}: ${detail.slice(0, 200)}`);
    }
  }

  return { storagePath: path };
}

export async function updatePhotoMetadata(photo, inspectionId) {
  if (!photo || !photo.photoId || !inspectionId) throw new Error('Missing photo metadata identifiers');
  const resp = await fetchWithTimeout(workerUrl('/metadata'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      inspectionId,
      photoId: photo.photoId,
      roomName: photo.roomName || '',
      stepName: photo.stepName || '',
      caption: photo.caption || '',
      slot: photo.assignedSlot || photo.slot || '',
      sharedSecret: PHOTO_UPLOAD_SECRET
    })
  }, 30000, 'Photo metadata update');
  return parseJsonResponse(resp, 'Photo metadata update failed');
}

export async function mirrorPhotosToDrive(payload) {
  if (!payload || !payload.inspectionId) throw new Error('Missing inspectionId for Drive mirror');

  // The Worker batches 14 photos per invocation to stay under CF's 50 subrequest limit.
  // Loop until hasMore is false (all photos mirrored).
  let totalMirrored = 0;
  let folderId = payload.driveFolderId || '';
  let folderName = '';
  const MAX_BATCHES = 20; // safety cap (20 × 14 = 280 photos max)
  let batch = 0;

  while (batch < MAX_BATCHES) {
    batch++;
    const resp = await fetchWithTimeout(workerUrl('/mirror'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        inspectionId: payload.inspectionId,
        inspectionName: payload.inspectionName || '',
        driveFolderId: folderId,
        sharedSecret: PHOTO_UPLOAD_SECRET
      })
    }, 90000, 'Drive photo mirror');
    const result = await parseJsonResponse(resp, 'Drive mirror failed');
    totalMirrored += (result.mirrored || 0);
    if (result.folderId) folderId = result.folderId;
    if (result.folderName) folderName = result.folderName;
    if (!result.hasMore) break;
  }

  return { mirrored: totalMirrored, skipped: 0, hasMore: false, folderId, folderName };
}

// Check which photos for an inspection are already confirmed in Supabase.
// Returns a Set of photoIds. Used by sync.js to skip re-uploading after a crash.
export async function checkSupabaseConfirmed(inspectionId) {
  if (!inspectionId) return [];
  try {
    const resp = await fetchWithTimeout(workerUrl('/confirmed'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inspectionId, sharedSecret: PHOTO_UPLOAD_SECRET })
    }, 30000, 'Photo confirmation');
    const result = await parseJsonResponse(resp, 'confirmed check failed');
    return Array.isArray(result.photoIds) ? result.photoIds : [];
  } catch (e) {
    console.warn('checkSupabaseConfirmed failed:', e && e.message);
    return [];
  }
}

// Final-submit proof. The Worker checks the authoritative assessment table and
// Supabase Storage, rather than trusting browser flags or upload responses.
export async function verifyInspectionStatus(inspectionId, expectedPhotoIds) {
  if (!inspectionId) throw new Error('Missing inspectionId for final verification');
  const resp = await fetchWithTimeout(workerUrl('/inspection-status'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      inspectionId,
      expectedPhotoIds: Array.isArray(expectedPhotoIds) ? expectedPhotoIds : [],
      sharedSecret: PHOTO_UPLOAD_SECRET
    })
  }, 45000, 'Final photo verification');
  return await parseJsonResponse(resp, 'Final verification failed');
}
