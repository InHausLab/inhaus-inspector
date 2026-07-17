// InHaus Inspector — Worker-signed photo upload client
//
// Photos still upload as already-compressed JPEG blobs, but the browser no
// longer writes to Supabase with the publishable key. It asks the InHaus
// Cloudflare Worker for a short-lived signed upload URL, then PUTs the binary
// bytes to that URL. The Worker owns service-role Supabase writes and Drive
// mirroring.

import { PHOTO_WORKER_URL, PHOTO_UPLOAD_SECRET } from './config.js?v=152';

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
  const resp = await fetch(workerUrl('/sign'), {
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
  });
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

  const upload = await fetch(signed.signedUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': 'image/jpeg',
      'x-upsert': 'true'
    },
    body: blob
  });

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

export async function mirrorPhotosToDrive(payload) {
  if (!payload || !payload.inspectionId) throw new Error('Missing inspectionId for Drive mirror');
  const resp = await fetch(workerUrl('/mirror'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      inspectionId: payload.inspectionId,
      inspectionName: payload.inspectionName || '',
      driveFolderId: payload.driveFolderId || '',
      sharedSecret: PHOTO_UPLOAD_SECRET
    })
  });
  return await parseJsonResponse(resp, 'Drive mirror failed');
}
