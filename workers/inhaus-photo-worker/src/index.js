const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400'
};

const JSON_HEADERS = {
  ...CORS_HEADERS,
  'Content-Type': 'application/json; charset=utf-8'
};

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive';
const DRIVE_FOLDER_MIME = 'application/vnd.google-apps.folder';

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });

    try {
      const url = new URL(request.url);
      if (url.pathname === '/sign' && request.method === 'POST') return await handleSign(request, env);
      if (url.pathname === '/mirror' && request.method === 'POST') return await handleMirror(request, env);
      if (url.pathname === '/confirmed' && request.method === 'POST') return await handleConfirmed(request, env);
      if (url.pathname === '/inspection-status' && request.method === 'POST') return await handleInspectionStatus(request, env);
      if (url.pathname === '/photo' && request.method === 'GET') return await handleReviewPhoto(url, env);
      return json({ error: 'not_found' }, 404);
    } catch (err) {
      return json({ error: err && err.message ? err.message : String(err) }, 500);
    }
  }
};

async function handleSign(request, env) {
  requireEnv(env, ['SUPABASE_URL', 'SUPABASE_BUCKET', 'SUPABASE_SERVICE_KEY', 'UPLOAD_SECRET']);
  const body = await readJson(request);
  validateSharedSecret(body, env);

  const inspectionId = cleanId(body.inspectionId, 'inspectionId');
  const photoId = cleanId(body.photoId, 'photoId');
  const storagePath = storagePathFor(inspectionId, photoId);
  const signedUrl = await createSignedUploadUrl(env, storagePath);

  await recordPhotoMetadata(env, {
    photo_id: photoId,
    inspection_id: inspectionId,
    room_name: String(body.roomName || ''),
    step_name: String(body.stepName || ''),
    caption: String(body.caption || ''),
    slot: normalizeSlot(body.slot),
    storage_path: storagePath,
    source_system: 'inspector_app_worker'
  });

  // Ensure an ihl_assessments row exists before verifyFinalSync checks for it.
  // This handles inspections started with "Start New Inspection" that bypass the
  // office-prepare flow. Apps Script will upsert richer data on final submit;
  // this guarantees the row exists so the Worker verification gate never fails.
  await upsertAssessmentRecord(env, {
    inspection_id: inspectionId,
    assessment_num: inspectionId,
    inspector_name: String(body.inspectorName || ''),
    inspection_date: String(body.inspectionDate || new Date().toISOString().slice(0, 10)),
    status: 'in-progress'
  });

  return json({ signedUrl, storagePath });
}

// Review-portal image delivery. Drive files in the Shared Drive cannot always
// be made public, so serve the durable private Supabase object after validating
// the per-inspection review token already present in the portal URL.
async function handleReviewPhoto(url, env) {
  requireEnv(env, ['SUPABASE_URL', 'SUPABASE_BUCKET', 'SUPABASE_SERVICE_KEY']);
  const inspectionId = cleanId(url.searchParams.get('inspectionId'), 'inspectionId');
  const photoId = cleanId(url.searchParams.get('photoId'), 'photoId');
  const token = String(url.searchParams.get('token') || '');
  if (!token || token !== inspectionId.toLowerCase()) throw new Error('unauthorized');

  const params = new URLSearchParams();
  params.set('inspection_id', `eq.${inspectionId}`);
  params.set('photo_id', `eq.${photoId}`);
  params.set('select', 'storage_path');
  params.set('limit', '1');
  const metadataResponse = await fetch(
    normalizeSupabaseUrl(env, `/rest/v1/inspector_photo_uploads?${params}`),
    { headers: serviceHeaders(env) }
  );
  const metadataText = await metadataResponse.text();
  if (!metadataResponse.ok) {
    throw new Error(`photo_lookup_failed:${metadataResponse.status}:${metadataText.slice(0, 120)}`);
  }
  const rows = metadataText ? JSON.parse(metadataText) : [];
  if (!Array.isArray(rows) || !rows.length || !rows[0].storage_path) {
    return json({ error: 'photo_not_found' }, 404);
  }

  const photo = await downloadSupabaseObject(env, rows[0].storage_path);
  return new Response(photo, {
    status: 200,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': photo.type || 'image/jpeg',
      'Cache-Control': 'private, max-age=3600',
      'X-Content-Type-Options': 'nosniff'
    }
  });
}

async function handleMirror(request, env) {
  requireEnv(env, ['SUPABASE_URL', 'SUPABASE_BUCKET', 'SUPABASE_SERVICE_KEY', 'UPLOAD_SECRET', 'GOOGLE_SERVICE_ACCOUNT', 'DRIVE_FOLDER_ID']);
  const body = await readJson(request);
  validateSharedSecret(body, env);

  const inspectionId = cleanId(body.inspectionId, 'inspectionId');
  const inspectionName = String(body.inspectionName || body.folderName || inspectionId).trim();
  const allRows = await getUnmirroredPhotoRows(env, inspectionId);
  if (!allRows.length) return json({ mirrored: 0, skipped: 0, hasMore: false, folderId: body.driveFolderId || '' });

  // CF Workers have a 50 subrequest limit per invocation.
  // Each photo costs 3 subrequests (Supabase download + Drive upload + Drive permission).
  // Cap at 14 photos per call (~42 subrequests) and return hasMore so the app can loop.
  const BATCH_SIZE = 14;
  const rows = allRows.slice(0, BATCH_SIZE);
  const hasMore = allRows.length > BATCH_SIZE;

  const accessToken = await getGoogleAccessToken(env);
  const folder = body.driveFolderId
    ? { id: String(body.driveFolderId), name: inspectionName }
    : await getOrCreateDriveFolder(accessToken, env.DRIVE_FOLDER_ID, inspectionName);

  const results = [];
  for (const row of rows) {
    const storagePath = row.storage_path || storagePathFor(row.inspection_id || inspectionId, row.photo_id);
    const fileBlob = await downloadSupabaseObject(env, storagePath);
    const fileName = fileNameForPhoto(row);
    const driveFile = await uploadDriveFile(accessToken, folder.id, fileName, fileBlob);
    await setDriveFilePublic(accessToken, driveFile.id);
    const driveUrl = `https://drive.google.com/file/d/${encodeURIComponent(driveFile.id)}/view`;
    await updatePhotoDriveUrl(env, row.photo_id, row.inspection_id || inspectionId, driveUrl);
    results.push({ photoId: row.photo_id, driveUrl });
  }

  return json({ mirrored: results.length, skipped: 0, hasMore, remaining: allRows.length - rows.length, folderId: folder.id, folderName: folder.name, photos: results });
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    throw new Error('invalid_json');
  }
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: JSON_HEADERS });
}

function requireEnv(env, names) {
  const missing = names.filter(name => !env[name]);
  if (missing.length) throw new Error(`missing_env:${missing.join(',')}`);
}

function validateSharedSecret(body, env) {
  if (!body || body.sharedSecret !== env.UPLOAD_SECRET) {
    throw new Error('unauthorized');
  }
}

function cleanId(value, fieldName) {
  const text = String(value || '').trim();
  if (!text) throw new Error(`missing_${fieldName}`);
  if (!/^[A-Za-z0-9_-]+$/.test(text)) throw new Error(`invalid_${fieldName}`);
  return text;
}

function storagePathFor(inspectionId, photoId) {
  return `${inspectionId}/${photoId}.jpg`;
}

function encodePath(path) {
  return String(path).split('/').map(encodeURIComponent).join('/');
}

function normalizeSupabaseUrl(env, path) {
  return `${String(env.SUPABASE_URL).replace(/\/+$/, '')}${path}`;
}

async function createSignedUploadUrl(env, storagePath) {
  const endpoint = normalizeSupabaseUrl(
    env,
    `/storage/v1/object/upload/sign/${encodeURIComponent(env.SUPABASE_BUCKET)}/${encodePath(storagePath)}`
  );
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: serviceHeaders(env, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ upsert: true })
  });
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {};
  }
  if (!res.ok) throw new Error(`signed_url_failed:${res.status}:${text.slice(0, 200)}`);

  let signedUrl = data.signedUrl || data.signedURL || data.signed_url || data.url || '';
  if (!signedUrl && data.token) {
    signedUrl = `/storage/v1/object/upload/sign/${encodeURIComponent(env.SUPABASE_BUCKET)}/${encodePath(storagePath)}?token=${encodeURIComponent(data.token)}`;
  }
  if (!signedUrl) throw new Error('signed_url_missing');
  if (signedUrl.startsWith('/')) {
    const relativePath = signedUrl.startsWith('/storage/v1/') ? signedUrl : `/storage/v1${signedUrl}`;
    signedUrl = normalizeSupabaseUrl(env, relativePath);
  }
  return signedUrl;
}

async function upsertAssessmentRecord(env, payload) {
  // Best-effort: create a minimal ihl_assessments row if one does not exist.
  // Uses ON CONFLICT DO NOTHING so existing rows (from prepare flow or Apps Script)
  // are never overwritten. Failures are non-fatal — Apps Script will write the row
  // on final submit regardless.
  try {
    const res = await fetch(normalizeSupabaseUrl(env, '/rest/v1/ihl_assessments'), {
      method: 'POST',
      headers: serviceHeaders(env, {
        'Content-Type': 'application/json',
        'Prefer': 'resolution=ignore-duplicates,return=minimal'
      }),
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      if (!/duplicate key|23505/i.test(detail)) {
        console.warn('upsertAssessmentRecord non-fatal:', res.status, detail.slice(0, 200));
      }
    }
  } catch (e) {
    console.warn('upsertAssessmentRecord non-fatal:', e && e.message);
  }
}

async function recordPhotoMetadata(env, payload) {
  const body = { ...payload };
  if (body.slot === null) delete body.slot;

  const res = await fetch(normalizeSupabaseUrl(env, '/rest/v1/inspector_photo_uploads'), {
    method: 'POST',
    headers: serviceHeaders(env, {
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal'
    }),
    body: JSON.stringify(body)
  });
  if (res.ok) return;

  const detail = await res.text().catch(() => '');
  if (/duplicate key|23505/i.test(detail)) return;
  throw new Error(`metadata_failed:${res.status}:${detail.slice(0, 200)}`);
}

async function getUnmirroredPhotoRows(env, inspectionId) {
  const params = new URLSearchParams();
  params.set('inspection_id', `eq.${inspectionId}`);
  params.set('drive_url', 'is.null');
  params.set('select', 'photo_id,inspection_id,room_name,step_name,caption,slot,storage_path,drive_url');

  const res = await fetch(normalizeSupabaseUrl(env, `/rest/v1/inspector_photo_uploads?${params}`), {
    headers: serviceHeaders(env)
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`photo_query_failed:${res.status}:${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : [];
}

async function downloadSupabaseObject(env, storagePath) {
  const res = await fetch(
    normalizeSupabaseUrl(env, `/storage/v1/object/${encodeURIComponent(env.SUPABASE_BUCKET)}/${encodePath(storagePath)}`),
    { headers: serviceHeaders(env) }
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`storage_download_failed:${res.status}:${storagePath}:${detail.slice(0, 120)}`);
  }
  return await res.blob();
}

async function updatePhotoDriveUrl(env, photoId, inspectionId, driveUrl) {
  const params = new URLSearchParams();
  params.set('photo_id', `eq.${photoId}`);
  params.set('inspection_id', `eq.${inspectionId}`);
  const res = await fetch(normalizeSupabaseUrl(env, `/rest/v1/inspector_photo_uploads?${params}`), {
    method: 'PATCH',
    headers: serviceHeaders(env, {
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal'
    }),
    body: JSON.stringify({ drive_url: driveUrl })
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`drive_url_update_failed:${res.status}:${detail.slice(0, 200)}`);
  }
}

function serviceHeaders(env, extra = {}) {
  return {
    apikey: env.SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
    ...extra
  };
}

function normalizeSlot(value) {
  const number = Number(value);
  return Number.isInteger(number) ? number : null;
}

function fileNameForPhoto(row) {
  const pieces = [row.slot ? `slot-${row.slot}` : '', row.photo_id || 'photo'].filter(Boolean);
  return `${pieces.join('-')}.jpg`;
}

async function getGoogleAccessToken(env) {
  const account = parseServiceAccount(env.GOOGLE_SERVICE_ACCOUNT);
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = {
    iss: account.client_email,
    scope: DRIVE_SCOPE,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600
  };
  const signingInput = `${base64UrlJson(header)}.${base64UrlJson(claims)}`;
  const key = await importPrivateKey(account.private_key);
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(signingInput));
  const assertion = `${signingInput}.${base64UrlBytes(signature)}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion
    })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new Error(`google_auth_failed:${res.status}:${JSON.stringify(data).slice(0, 200)}`);
  }
  return data.access_token;
}

function parseServiceAccount(value) {
  const text = String(value || '').trim();
  const jsonText = text.startsWith('{') ? text : atob(text);
  const account = JSON.parse(jsonText);
  if (!account.client_email || !account.private_key) throw new Error('invalid_google_service_account');
  return account;
}

async function importPrivateKey(pem) {
  const base64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s+/g, '');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return await crypto.subtle.importKey(
    'pkcs8',
    bytes.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
}

function base64UrlJson(value) {
  return base64UrlBytes(new TextEncoder().encode(JSON.stringify(value)));
}

function base64UrlBytes(value) {
  const bytes = value instanceof ArrayBuffer ? new Uint8Array(value) : value;
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function getOrCreateDriveFolder(accessToken, parentId, folderName) {
  const existing = await findDriveFolder(accessToken, parentId, folderName);
  if (existing) return existing;

  const res = await fetch('https://www.googleapis.com/drive/v3/files?supportsAllDrives=true&fields=id,name,webViewLink', {
    method: 'POST',
    headers: driveHeaders(accessToken, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      name: folderName,
      mimeType: DRIVE_FOLDER_MIME,
      parents: [parentId]
    })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`drive_folder_create_failed:${res.status}:${JSON.stringify(data).slice(0, 200)}`);
  return data;
}

async function findDriveFolder(accessToken, parentId, folderName) {
  const params = new URLSearchParams();
  params.set('q', `'${escapeDriveQuery(parentId)}' in parents and mimeType='${DRIVE_FOLDER_MIME}' and name='${escapeDriveQuery(folderName)}' and trashed=false`);
  params.set('fields', 'files(id,name,webViewLink)');
  params.set('pageSize', '10');
  params.set('supportsAllDrives', 'true');
  params.set('includeItemsFromAllDrives', 'true');
  params.set('corpora', 'allDrives');

  const res = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, {
    headers: driveHeaders(accessToken)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`drive_folder_search_failed:${res.status}:${JSON.stringify(data).slice(0, 200)}`);
  return Array.isArray(data.files) && data.files.length ? data.files[0] : null;
}

async function uploadDriveFile(accessToken, folderId, fileName, fileBlob) {
  const boundary = `inhaus_${crypto.randomUUID().replace(/-/g, '')}`;
  const metadata = {
    name: fileName,
    parents: [folderId],
    mimeType: 'image/jpeg'
  };
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`,
    JSON.stringify(metadata),
    `\r\n--${boundary}\r\nContent-Type: image/jpeg\r\n\r\n`,
    fileBlob,
    `\r\n--${boundary}--`
  ]);

  const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,name,webViewLink', {
    method: 'POST',
    headers: driveHeaders(accessToken, { 'Content-Type': `multipart/related; boundary=${boundary}` }),
    body
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`drive_upload_failed:${res.status}:${JSON.stringify(data).slice(0, 200)}`);
  return data;
}

async function setDriveFilePublic(accessToken, fileId) {
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/permissions?supportsAllDrives=true`, {
    method: 'POST',
    headers: driveHeaders(accessToken, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ role: 'reader', type: 'anyone' })
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`drive_permission_failed:${res.status}:${detail.slice(0, 200)}`);
  }
}

function driveHeaders(accessToken, extra = {}) {
  return {
    Authorization: `Bearer ${accessToken}`,
    ...extra
  };
}

function escapeDriveQuery(value) {
  return String(value || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

// ── /confirmed — return photoIds already stored in Supabase for an inspection ──
async function handleConfirmed(request, env) {
  requireEnv(env, ['SUPABASE_URL', 'SUPABASE_BUCKET', 'SUPABASE_SERVICE_KEY', 'UPLOAD_SECRET']);
  const body = await readJson(request);
  validateSharedSecret(body, env);
  const inspectionId = cleanId(body.inspectionId, 'inspectionId');
  const queryString = 'inspection_id=eq.' + encodeURIComponent(inspectionId) + '&select=photo_id&storage_path=not.is.null';
  const res = await fetch(env.SUPABASE_URL + '/rest/v1/inspector_photo_uploads?' + queryString, {
    headers: {
      'apikey': env.SUPABASE_SERVICE_KEY,
      'Authorization': 'Bearer ' + env.SUPABASE_SERVICE_KEY
    }
  });
  if (!res.ok) throw new Error('supabase_confirmed_failed:' + res.status);
  const rows = await res.json();
  return json({ photoIds: rows.map(r => r.photo_id) });
}

// ── /inspection-status — authoritative final-sync verification ─────────────
// The browser may show "Sync Complete" only when the assessment row exists
// and every photo referenced by the inspection exists in Supabase Storage.
// Drive mirroring is reported separately so callers can distinguish durable
// cloud storage from review-portal readiness.
async function handleInspectionStatus(request, env) {
  requireEnv(env, ['SUPABASE_URL', 'SUPABASE_BUCKET', 'SUPABASE_SERVICE_KEY', 'UPLOAD_SECRET']);
  const body = await readJson(request);
  validateSharedSecret(body, env);

  const inspectionId = cleanId(body.inspectionId, 'inspectionId');
  const expectedPhotoIds = Array.from(new Set(
    (Array.isArray(body.expectedPhotoIds) ? body.expectedPhotoIds : []).map(function(value) {
      return cleanId(value, 'photoId');
    })
  ));

  const [assessmentExists, photoRows, storedNames] = await Promise.all([
    assessmentExistsForInspection(env, inspectionId),
    getPhotoRowsForInspection(env, inspectionId),
    listStoredPhotoNames(env, inspectionId)
  ]);

  const storedPhotoIds = new Set();
  storedNames.forEach(function(name) {
    const match = String(name || '').match(/^(.+)\.jpg$/i);
    if (match) storedPhotoIds.add(match[1]);
  });
  const missingPhotoIds = expectedPhotoIds.filter(function(photoId) {
    return !storedPhotoIds.has(photoId);
  });
  const mirroredPhotoIds = new Set(
    photoRows.filter(function(row) { return !!row.drive_url; }).map(function(row) { return row.photo_id; })
  );
  const missingMirrorPhotoIds = expectedPhotoIds.filter(function(photoId) {
    return !mirroredPhotoIds.has(photoId);
  });
  const complete = assessmentExists && missingPhotoIds.length === 0;

  return json({
    inspectionId,
    assessmentExists,
    expectedPhotos: expectedPhotoIds.length,
    storedPhotos: storedPhotoIds.size,
    databasePhotos: new Set(photoRows.map(function(row) { return row.photo_id; })).size,
    mirroredPhotos: mirroredPhotoIds.size,
    missingPhotoIds,
    missingMirrorPhotoIds,
    reviewPortalReady: complete && missingMirrorPhotoIds.length === 0,
    complete
  });
}

async function assessmentExistsForInspection(env, inspectionId) {
  const params = new URLSearchParams();
  params.set('inspection_id', `eq.${inspectionId}`);
  params.set('select', 'inspection_id');
  params.set('limit', '1');
  const res = await fetch(normalizeSupabaseUrl(env, `/rest/v1/ihl_assessments?${params}`), {
    headers: serviceHeaders(env)
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`assessment_status_failed:${res.status}:${text.slice(0, 200)}`);
  const rows = text ? JSON.parse(text) : [];
  return Array.isArray(rows) && rows.length > 0;
}

async function getPhotoRowsForInspection(env, inspectionId) {
  const params = new URLSearchParams();
  params.set('inspection_id', `eq.${inspectionId}`);
  params.set('select', 'photo_id,drive_url,storage_path');
  const res = await fetch(normalizeSupabaseUrl(env, `/rest/v1/inspector_photo_uploads?${params}`), {
    headers: serviceHeaders(env)
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`photo_status_failed:${res.status}:${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : [];
}

async function listStoredPhotoNames(env, inspectionId) {
  const endpoint = normalizeSupabaseUrl(
    env,
    `/storage/v1/object/list/${encodeURIComponent(env.SUPABASE_BUCKET)}`
  );
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: serviceHeaders(env, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      prefix: `${inspectionId}/`,
      limit: 1000,
      offset: 0,
      sortBy: { column: 'name', order: 'asc' }
    })
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`storage_status_failed:${res.status}:${text.slice(0, 200)}`);
  const rows = text ? JSON.parse(text) : [];
  return Array.isArray(rows) ? rows.map(function(row) { return row.name || ''; }) : [];
}
