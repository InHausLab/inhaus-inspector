// InHaus Inspector — Supabase photo upload client
//
// Uploads the already-compressed JPEG straight to Supabase Storage as a binary
// file, bypassing the base64 → Apps Script → Drive pipeline. A photo is "safe"
// the moment this resolves. Photo metadata is recorded in the app-owned
// `inspector_photo_uploads` staging table (isolated from Tanner's ihl_* schema;
// he reconciles it into ihl_photos later).
//
// See: drafts/photo-pipeline-supabase-rebuild-plan-20260704.md
// No SDK / no build step — plain fetch against the Supabase REST API.
//
// Auth: the publishable/anon key is sent as the `apikey` header. Calls are kept
// deliberately simple (no x-upsert, no return=representation) so they need only
// the INSERT policies configured on the bucket and staging table — nothing that
// would require broader SELECT/UPDATE read access via the public key.

import { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_BUCKET } from './config.js?v=147';

// Convert a data: URL (what compressImage produces) into a binary Blob without
// re-encoding. The data URL already holds the compressed JPEG bytes.
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

// One folder per inspection, one object per photoId. Deterministic path means a
// retry targets the same object — so an "already exists" response is success.
function storagePathFor(inspectionId, photoId) {
  const safeInspection = String(inspectionId || 'unknown').replace(/[^A-Za-z0-9_-]/g, '_');
  const safePhoto = String(photoId || 'photo').replace(/[^A-Za-z0-9_-]/g, '_');
  return `${safeInspection}/${safePhoto}.jpg`;
}

// Upload one photo. Resolves with { storagePath } on success; throws on failure
// so the caller can keep the local copy and retry.
export async function uploadPhotoToSupabase(photo) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) throw new Error('Supabase not configured');
  if (!photo || !photo.dataUrl || photo.dataUrl === '__uploaded__') throw new Error('No image data');
  if (!photo.inspectionId || !photo.photoId) throw new Error('Missing inspectionId/photoId');

  const blob = dataUrlToBlob(photo.dataUrl);
  const path = storagePathFor(photo.inspectionId, photo.photoId);
  const url = `${SUPABASE_URL}/storage/v1/object/${SUPABASE_BUCKET}/${path}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Content-Type': 'image/jpeg'
    },
    body: blob
  });

  // "Duplicate" = a prior attempt already stored this exact object. The photo is
  // safe; treat it as success (idempotent retry). NOTE: Supabase Storage returns
  // HTTP 400 with a body of {"statusCode":"409","error":"Duplicate"} for this — the
  // 409 is in the body, not the HTTP status — so we must inspect the body.
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    const alreadyExists = res.status === 409 ||
      /"statusCode"\s*:\s*"409"|duplicate|already exists/i.test(detail);
    if (!alreadyExists) {
      throw new Error(`Supabase upload ${res.status}: ${detail.slice(0, 200)}`);
    }
  }

  // Best-effort metadata row. The photo is already safe in storage, so a failure
  // here must never fail the upload (the lesson from the Apps Script "Photo Log").
  recordPhotoMetadata(photo, path).catch(err =>
    console.warn('Supabase photo metadata insert failed (non-fatal):', err && err.message));

  return { storagePath: path };
}

async function recordPhotoMetadata(photo, path) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/inspector_photo_uploads`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal'
    },
    body: JSON.stringify({
      photo_id: photo.photoId,
      inspection_id: photo.inspectionId,
      room_name: photo.roomName || '',
      step_name: photo.stepName || '',
      caption: photo.caption || '',
      slot: photo.assignedSlot || photo.slot || '',
      storage_path: path,
      source_system: 'inspector_app'
    })
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`metadata ${res.status}: ${detail.slice(0, 200)}`);
  }
}
