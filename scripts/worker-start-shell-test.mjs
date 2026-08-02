#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { generateKeyPairSync } from 'node:crypto';

if (!globalThis.atob) {
  globalThis.atob = value => Buffer.from(String(value), 'base64').toString('binary');
}
if (!globalThis.btoa) {
  globalThis.btoa = value => Buffer.from(String(value), 'binary').toString('base64');
}

const workerPath = resolve('workers/inhaus-photo-worker/src/index.js');
const workerSource = await readFile(workerPath, 'utf8');
const workerModuleUrl = `data:text/javascript;base64,${Buffer.from(workerSource).toString('base64')}`;
const worker = (await import(workerModuleUrl)).default;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function makeServiceAccount() {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return {
    client_email: 'worker-test@inhaus.test',
    private_key: privateKey.export({ type: 'pkcs8', format: 'pem' })
  };
}

function baseEnv(overrides = {}) {
  return {
    SUPABASE_URL: 'https://supabase.test',
    SUPABASE_BUCKET: 'inspection-photos',
    SUPABASE_SERVICE_KEY: 'service-key',
    UPLOAD_SECRET: 'upload-secret',
    REVIEW_ACCESS_TOKEN: 'review-token',
    REVIEW_ADMIN_TOKEN: 'admin-token',
    GOOGLE_SERVICE_ACCOUNT: JSON.stringify(makeServiceAccount()),
    ASSESSMENTS_FOLDER_ID: 'assessments-root',
    REPORT_TRACKER_SHEET_ID: 'tracker-sheet',
    ...overrides
  };
}

function trackerValues() {
  const header = Array(41).fill('');
  header[0] = 'Overall Status';
  header[1] = 'Assessment #';
  header[2] = 'Assessment Type';
  header[3] = 'Name';
  header[4] = 'Assessment Date';
  header[5] = 'Address';
  header[6] = 'Service Location';
  header[7] = 'Client ID';
  header[8] = 'Home ID';
  header[9] = 'Report ID';
  header[10] = 'Inspector App ID';
  header[40] = 'Google Drive Folder';

  const prior = Array(41).fill('');
  prior[0] = 'Done';
  prior[1] = '017';
  prior[10] = 'INH-20260701-PRIOR';

  return [
    [],
    [],
    [],
    [],
    [],
    [],
    header,
    prior
  ];
}

function cloneSheetValues(values) {
  return (values || []).map(row => Array.isArray(row) ? row.slice() : []);
}

function columnIndexFromLetters(letters) {
  return String(letters || '').split('').reduce((total, char) => {
    const code = char.toUpperCase().charCodeAt(0);
    if (code < 65 || code > 90) return total;
    return (total * 26) + (code - 64);
  }, 0);
}

function applySheetValueUpdate(values, update) {
  const match = String(update.range || '').match(/!([A-Z]+)(\d+)$/);
  if (!match) return;
  const startCol = columnIndexFromLetters(match[1]) - 1;
  const startRow = Number(match[2]) - 1;
  const rows = Array.isArray(update.values) ? update.values : [];
  rows.forEach((rowValues, rowOffset) => {
    const rowIndex = startRow + rowOffset;
    if (!values[rowIndex]) values[rowIndex] = [];
    (Array.isArray(rowValues) ? rowValues : []).forEach((value, colOffset) => {
      values[rowIndex][startCol + colOffset] = value;
    });
  });
}

function sheetRowsForTab(state, tabName) {
  const write = (state.sheetValueWrites || []).find(update => String(update.range || '').startsWith(`'${tabName}'!`));
  return write && Array.isArray(write.values) ? write.values : [];
}

function sheetDataRowsForTab(state, tabName) {
  return sheetRowsForTab(state, tabName).slice(1);
}

function hasSheetCellValue(state, tabName, expectedValue) {
  return sheetRowsForTab(state, tabName).some(row =>
    (Array.isArray(row) ? row : []).some(value => String(value) === String(expectedValue))
  );
}

function hasSheetRowContaining(state, tabName, expectedValues) {
  return sheetRowsForTab(state, tabName).some(row => {
    const rowValues = (Array.isArray(row) ? row : []).map(value => String(value));
    return expectedValues.every(expected => rowValues.includes(String(expected)));
  });
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function makeMockFetch(options = {}) {
  const calls = [];
  const state = {
    reviewRow: options.reviewRow || null,
    trackerValues: cloneSheetValues(options.trackerValues || trackerValues()),
    reviewWrites: [],
    assessmentWrites: [],
    trackerUpdates: [],
    spreadsheetUpdates: [],
    sheetValueWrites: [],
    sheetClears: [],
    driveCreates: [],
    driveSearches: [],
    driveFolderLists: [],
    driveTrashes: [],
    rawUploads: [],
    photoRows: (options.photoRows || []).map(row => ({ ...row })),
    photoMetadataWrites: [],
    photoUpdates: [],
    activityEventWrites: [],
    assessmentReservations: [],
    assessmentRows: (options.assessmentRows || []).map(row => structuredClone(row)),
    inspectionEvents: (options.inspectionEvents || []).map(row => structuredClone(row)),
    inspectionEventWrites: [],
    appFeedbackWrites: [],
    commentRows: (options.commentRows || []).map(row => structuredClone(row)),
    commentWrites: [],
    handoffJobs: (options.handoffJobs || []).map(row => ({ ...row })),
    handoffJobWrites: [],
    handoffJobQueueTransitions: [],
    handoffJobClaims: [],
    handoffArtifacts: (options.handoffArtifacts || []).map(row => ({ ...row })),
    handoffArtifactWrites: [],
    calls
  };

  async function mockFetch(input, init = {}) {
    const url = String(input);
    const method = String(init.method || 'GET').toUpperCase();
    calls.push({ url, method, body: init.body || '' });

    if (url === 'https://oauth2.googleapis.com/token') {
      if (options.failGoogleToken) return jsonResponse({ error: 'forced_token_failure' }, 500);
      return jsonResponse({ access_token: 'google-token' });
    }

    if (url.includes('sheets.googleapis.com') && url.includes('/values:batchUpdate')) {
      const body = JSON.parse(String(init.body || '{}'));
      if (url.includes('/spreadsheets/tracker-sheet/')) {
        state.trackerUpdates.push(...(body.data || []));
        (body.data || []).forEach(update => applySheetValueUpdate(state.trackerValues, update));
        if (typeof options.afterTrackerBatchUpdate === 'function') options.afterTrackerBatchUpdate(state);
      } else {
        if (options.failPackageSheetValueWrite) return jsonResponse({ error: 'forced_sheet_value_failure' }, 500);
        state.sheetValueWrites.push(...(body.data || []));
      }
      return jsonResponse({ totalUpdatedCells: (body.data || []).length });
    }

    if (url.includes('sheets.googleapis.com') && url.includes(':batchUpdate')) {
      const body = JSON.parse(String(init.body || '{}'));
      state.spreadsheetUpdates.push(...(body.requests || []));
      return jsonResponse({ replies: [] });
    }

    if (url.includes('sheets.googleapis.com') && url.includes('/values:batchClear')) {
      const body = JSON.parse(String(init.body || '{}'));
      state.sheetClears.push(...(body.ranges || []));
      return jsonResponse({});
    }

    if (url.includes('sheets.googleapis.com') && url.includes('/values/') && method === 'GET') {
      return jsonResponse({ values: state.trackerValues });
    }

    if (url.includes('sheets.googleapis.com/v4/spreadsheets/') && method === 'GET') {
      return jsonResponse({
        sheets: [{ properties: { sheetId: 0, title: 'Sheet1' } }]
      });
    }

    if (url.includes('/storage/v1/object/upload/sign/inspection-photos/') && method === 'POST') {
      return jsonResponse({
        signedUrl: '/storage/v1/object/upload/sign/inspection-photos/signed-photo.jpg?token=signed-token'
      });
    }

    if (url.includes('www.googleapis.com/drive/v3/files') && method === 'GET') {
      const requestUrl = new URL(url);
      const q = requestUrl.searchParams.get('q') || '';
      const parentMatch = q.match(/'([^']+)' in parents/);
      const nameMatch = q.match(/name='([^']+)'/);
      const mimeMatch = q.match(/mimeType='([^']+)'/);
      if (nameMatch) {
        state.driveSearches.push({ parentId: parentMatch ? parentMatch[1] : '', name: nameMatch[1], mimeType: mimeMatch ? mimeMatch[1] : '' });
      } else {
        state.driveFolderLists.push({ parentId: parentMatch ? parentMatch[1] : '' });
      }
      const existingFiles = (options.existingDriveFiles || []).filter(file => {
        if (parentMatch && file.parentId !== parentMatch[1]) return false;
        if (nameMatch && file.name !== nameMatch[1]) return false;
        if (mimeMatch && file.mimeType !== mimeMatch[1]) return false;
        return true;
      }).map(file => ({
        id: file.id,
        name: file.name,
        mimeType: file.mimeType,
        webViewLink: file.webViewLink || `https://drive.google.com/file/d/${file.id}/view`
      }));
      return jsonResponse({ files: existingFiles });
    }

    if (url.includes('www.googleapis.com/drive/v3/files/') && method === 'PATCH') {
      const fileId = decodeURIComponent(url.split('/files/')[1].split('?')[0]);
      const body = JSON.parse(String(init.body || '{}'));
      state.driveTrashes.push({ fileId, ...body });
      return jsonResponse({ id: fileId, trashed: body.trashed === true });
    }

    if (url.includes('www.googleapis.com/upload/drive/v3/files') && (method === 'POST' || method === 'PATCH')) {
      const id = `drive-upload-${state.rawUploads.length + 1}`;
      const file = { id, name: `upload-${state.rawUploads.length + 1}`, webViewLink: `https://drive.google.com/file/d/${id}/view` };
      const bodyText = init.body && typeof init.body.text === 'function'
        ? await init.body.text()
        : String(init.body || '');
      if (options.failPhotoDriveUpload && /\bContent-Type:\s*image\/jpeg\b/i.test(bodyText)) {
        return jsonResponse({ error: 'forced_photo_upload_failure' }, 500);
      }
      state.rawUploads.push({ url, method, bodyText });
      return jsonResponse(file);
    }

    if (url.includes('www.googleapis.com/drive/v3/files') && method === 'POST') {
      const body = JSON.parse(String(init.body || '{}'));
      const safeName = String(body.name || 'folder').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
      const id = `drive-${safeName || state.driveCreates.length + 1}`;
      const folder = { id, name: body.name, mimeType: body.mimeType, webViewLink: `https://drive.google.com/drive/folders/${id}` };
      state.driveCreates.push(folder);
      return jsonResponse(folder);
    }

    if (url.includes('/rest/v1/review_data') && method === 'GET') {
      return jsonResponse(state.reviewRow ? [state.reviewRow] : []);
    }

    if (url.includes('/rest/v1/review_data') && method === 'POST') {
      const body = JSON.parse(String(init.body || '{}'));
      state.reviewWrites.push(body);
      state.reviewRow = {
        inspection_id: body.inspection_id,
        field_data: body.field_data,
        updated_at: body.updated_at
      };
      return jsonResponse([]);
    }

    if (url.includes('/rest/v1/rpc/reserve_assessment_shell') && method === 'POST') {
      if (options.failAssessmentReservation) return jsonResponse({ error: 'forced_reservation_failure' }, 500);
      const body = JSON.parse(String(init.body || '{}'));
      const inspectionId = String(body.p_inspection_id || '');
      const existing = state.assessmentReservations.find(row => row.inspection_id === inspectionId);
      if (existing) return jsonResponse([existing]);
      const assessmentNumber = Number(options.assessmentReservationNumber || (18 + state.assessmentReservations.length));
      const row = {
        reservation_id: `reservation-${inspectionId || assessmentNumber}`,
        inspection_id: inspectionId,
        assessment_number: assessmentNumber,
        assessment_number_display: String(assessmentNumber).padStart(3, '0'),
        reservation_status: 'reserved',
        created_at: '2026-08-01T14:55:00.000Z',
        updated_at: '2026-08-01T14:55:00.000Z'
      };
      state.assessmentReservations.push(row);
      return jsonResponse([row]);
    }

    if (url.includes('/rest/v1/rpc/claim_due_handoff_jobs') && method === 'POST') {
      const body = JSON.parse(String(init.body || '{}'));
      const limit = Math.max(1, Math.min(25, Number(body.p_limit || 10) || 10));
      const workerId = String(body.p_worker_id || 'cloudflare_worker');
      const now = Date.now();
      const staleLockMs = 15 * 60 * 1000;
      const dueRows = state.handoffJobs
        .filter(row => {
          const status = String(row.status || '').replace(/[\s-]+/g, '_');
          if (!['queued', 'running', 'waiting_on_export_adapter', 'repairing', 'failed'].includes(status)) return false;
          if (row.next_run_at && Date.parse(row.next_run_at) > now) return false;
          if (row.locked_at && Date.parse(row.locked_at) > now - staleLockMs) return false;
          return true;
        })
        .sort((a, b) => String(a.updated_at || '').localeCompare(String(b.updated_at || '')))
        .slice(0, limit);
      const claimedAt = new Date().toISOString();
      dueRows.forEach(row => {
        row.locked_at = claimedAt;
        row.locked_by = workerId;
        row.updated_at = claimedAt;
      });
      state.handoffJobClaims.push({ limit, workerId, rows: dueRows.map(row => row.job_key) });
      return jsonResponse(dueRows);
    }

    if (url.includes('/rest/v1/handoff_jobs') && method === 'GET') {
      const requestUrl = new URL(url);
      const inspectionFilter = requestUrl.searchParams.get('inspection_id') || '';
      let rows = state.handoffJobs.slice();
      const inspectionMatch = inspectionFilter.match(/^eq\.(.+)$/);
      if (inspectionMatch) {
        rows = rows.filter(row => String(row.inspection_id || '') === inspectionMatch[1]);
      }
      return jsonResponse(rows);
    }

    if (url.includes('/rest/v1/handoff_jobs') && method === 'PATCH') {
      const body = JSON.parse(String(init.body || '{}'));
      const requestUrl = new URL(url);
      const jobKeyFilter = requestUrl.searchParams.get('job_key') || '';
      const jobKeyMatch = jobKeyFilter.match(/^eq\.(.+)$/);
      const updatedAtFilter = requestUrl.searchParams.get('updated_at') || '';
      const updatedAtMatch = updatedAtFilter.match(/^eq\.(.+)$/);
      const statusFilter = requestUrl.searchParams.get('status') || '';
      const statusMatch = statusFilter.match(/^eq\.(.+)$/);
      const lockFilter = requestUrl.searchParams.get('or') || '';
      const staleMatch = lockFilter.match(/locked_at\.lt\.([^,)]+)/);
      const staleBefore = staleMatch ? Date.parse(staleMatch[1]) : 0;
      const rows = state.handoffJobs.filter(row => {
        if (jobKeyMatch && row.job_key !== jobKeyMatch[1]) return false;
        if (updatedAtMatch && row.updated_at !== updatedAtMatch[1]) return false;
        if (statusMatch && row.status !== statusMatch[1]) return false;
        if (!lockFilter) return true;
        return !row.locked_at || (staleBefore && Date.parse(row.locked_at) < staleBefore);
      });
      rows.forEach(row => Object.assign(row, body));
      if (updatedAtFilter || (statusFilter && !lockFilter)) {
        state.handoffJobQueueTransitions.push({ jobKeyFilter, updatedAtFilter, statusFilter, matched: rows.length });
      }
      return jsonResponse(rows);
    }

    if (url.includes('/rest/v1/handoff_jobs') && method === 'POST') {
      const body = JSON.parse(String(init.body || '{}'));
      const row = {
        id: body.id || `job-${body.job_key || state.handoffJobs.length + 1}`,
        created_at: body.created_at || '2026-08-01T15:00:00.000Z',
        ...body
      };
      const index = state.handoffJobs.findIndex(existing => existing.job_key === row.job_key);
      const prefer = new Headers(init.headers || {}).get('Prefer') || '';
      if (index >= 0 && prefer.includes('resolution=ignore-duplicates')) {
        return jsonResponse([]);
      }
      if (index >= 0) {
        state.handoffJobs[index] = { ...state.handoffJobs[index], ...row };
      } else {
        state.handoffJobs.push(row);
      }
      state.handoffJobWrites.push(row);
      return jsonResponse([row]);
    }

    if (url.includes('/rest/v1/handoff_artifacts') && method === 'POST') {
      const body = JSON.parse(String(init.body || '[]'));
      const rows = (Array.isArray(body) ? body : [body]).map((row, index) => ({
        id: row.id || `artifact-${state.handoffArtifacts.length + index + 1}`,
        created_at: row.created_at || '2026-08-01T15:00:00.000Z',
        ...row
      }));
      rows.forEach(row => {
        const existingIndex = state.handoffArtifacts.findIndex(existing =>
          existing.job_id === row.job_id && existing.artifact_key === row.artifact_key
        );
        if (existingIndex >= 0) {
          state.handoffArtifacts[existingIndex] = { ...state.handoffArtifacts[existingIndex], ...row };
        } else {
          state.handoffArtifacts.push(row);
        }
      });
      state.handoffArtifactWrites.push(...rows);
      return jsonResponse(rows);
    }

    if (url.includes('/rest/v1/inspector_photo_uploads') && method === 'GET') {
      return jsonResponse(state.photoRows);
    }

    if (url.includes('/rest/v1/inspector_photo_uploads') && method === 'DELETE') {
      if (options.failPhotoMetadataDelete) return jsonResponse({ error: 'forced_delete_failure' }, 403);
      return new Response(null, { status: 204 });
    }

    if (url.endsWith('/rest/v1/inspector_photo_uploads') && method === 'POST') {
      const body = JSON.parse(String(init.body || '{}'));
      state.photoMetadataWrites.push(body);
      return jsonResponse([]);
    }

    if (url.includes('/rest/v1/inspector_photo_uploads') && method === 'PATCH') {
      const body = JSON.parse(String(init.body || '{}'));
      const requestUrl = new URL(url);
      const photoIdMatch = String(requestUrl.searchParams.get('photo_id') || '').match(/^eq\.(.+)$/);
      const inspectionIdMatch = String(requestUrl.searchParams.get('inspection_id') || '').match(/^eq\.(.+)$/);
      state.photoRows.forEach(row => {
        if (photoIdMatch && row.photo_id !== photoIdMatch[1]) return;
        if (inspectionIdMatch && row.inspection_id !== inspectionIdMatch[1]) return;
        Object.assign(row, body);
      });
      state.photoUpdates.push(body);
      return jsonResponse([]);
    }

    if (url.includes('/rest/v1/review_activity_events') && method === 'POST') {
      const body = JSON.parse(String(init.body || '{}'));
      const row = {
        id: `activity-${state.activityEventWrites.length + 1}`,
        created_at: '2026-08-01T15:00:00.000Z',
        ...body
      };
      state.activityEventWrites.push(row);
      return jsonResponse([row]);
    }

    if (url.includes('/storage/v1/object/inspection-photos/') && method === 'GET') {
      return new Response(new Blob(['image-data'], { type: 'image/jpeg' }), {
        status: 200,
        headers: { 'Content-Type': 'image/jpeg' }
      });
    }

    if (url.includes('/storage/v1/object/inspection-photos') && method === 'DELETE') {
      return new Response(null, { status: 200 });
    }

    if (url.includes('/storage/v1/object/list/inspection-photos') && method === 'POST') {
      return jsonResponse((options.storedPhotoNames || []).map(name => ({ name })));
    }

    if (url.includes('/rest/v1/ihl_assessments') && method === 'POST') {
      const body = JSON.parse(String(init.body || '{}'));
      state.assessmentWrites.push(body);
      const index = state.assessmentRows.findIndex(row => row.inspection_id === body.inspection_id);
      const saved = index >= 0 ? { ...state.assessmentRows[index], ...body } : { ...body };
      if (index >= 0) state.assessmentRows[index] = saved;
      else state.assessmentRows.push(saved);
      return jsonResponse([saved]);
    }

    if (url.includes('/rest/v1/ihl_assessments') && method === 'GET') {
      const requestUrl = new URL(url);
      const inspectionFilter = requestUrl.searchParams.get('inspection_id') || '';
      const inspectionMatch = inspectionFilter.match(/^eq\.(.+)$/);
      const rows = inspectionMatch
        ? state.assessmentRows.filter(row => String(row.inspection_id || '') === inspectionMatch[1])
        : state.assessmentRows;
      return jsonResponse(rows);
    }

    if (url.includes('/rest/v1/inspection_sync_events') && method === 'POST') {
      const body = JSON.parse(String(init.body || '{}'));
      const existing = state.inspectionEvents.find(row => row.event_key === body.event_key);
      if (!existing) state.inspectionEvents.push({ ...body, created_at: body.created_at || new Date().toISOString() });
      state.inspectionEventWrites.push(body);
      return jsonResponse([]);
    }

    if (url.includes('/rest/v1/inspection_sync_events') && method === 'GET') {
      const requestUrl = new URL(url);
      const inspectionFilter = requestUrl.searchParams.get('inspection_id') || '';
      const inspectionMatch = inspectionFilter.match(/^eq\.(.+)$/);
      const rows = inspectionMatch
        ? state.inspectionEvents.filter(row => String(row.inspection_id || '') === inspectionMatch[1])
        : state.inspectionEvents;
      return jsonResponse(rows.slice().sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || ''))));
    }

    if (url.includes('/rest/v1/app_feedback') && method === 'POST') {
      const body = JSON.parse(String(init.body || '{}'));
      state.appFeedbackWrites.push(body);
      return jsonResponse([]);
    }

    if (url.includes('/rest/v1/company_comment_library') && method === 'GET') {
      const requestUrl = new URL(url);
      const normalizedFilter = requestUrl.searchParams.get('normalized_text') || '';
      const commentFilter = requestUrl.searchParams.get('comment_id') || '';
      let rows = state.commentRows.slice();
      const normalizedMatch = normalizedFilter.match(/^eq\.(.+)$/);
      const commentMatch = commentFilter.match(/^eq\.(.+)$/);
      if (normalizedMatch) rows = rows.filter(row => row.normalized_text === normalizedMatch[1]);
      if (commentMatch) rows = rows.filter(row => row.comment_id === commentMatch[1]);
      return jsonResponse(rows);
    }

    if (url.includes('/rest/v1/company_comment_library') && method === 'POST') {
      const body = JSON.parse(String(init.body || '{}'));
      const index = state.commentRows.findIndex(row => row.comment_id === body.comment_id);
      const saved = index >= 0 ? { ...state.commentRows[index], ...body } : { ...body };
      if (index >= 0) state.commentRows[index] = saved;
      else state.commentRows.push(saved);
      state.commentWrites.push(saved);
      return jsonResponse([saved]);
    }

    throw new Error(`unhandled fetch: ${method} ${url}`);
  }

  return { mockFetch, state };
}

async function callWorker(path, body, env, mockFetch, options = {}) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockFetch;
  try {
    const requestBody = path === '/handoff-jobs' && !Object.prototype.hasOwnProperty.call(body || {}, 'runInline')
      ? { ...(body || {}), runInline: true }
      : body;
    const request = new Request(`https://worker.test${path}`, {
      method: options.method || 'POST',
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      body: JSON.stringify(requestBody)
    });
    const response = await worker.fetch(request, env, options.ctx);
    const data = await response.json();
    return { response, data };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function callWorkerGet(path, env, mockFetch, headers = {}) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockFetch;
  try {
    const response = await worker.fetch(new Request(`https://worker.test${path}`, {
      method: 'GET',
      headers
    }), env);
    const data = await response.json();
    return { response, data };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function testHealthRoute() {
  const env = baseEnv();
  const response = await worker.fetch(new Request('https://worker.test/health'), env);
  const data = await response.json();
  assert(response.status === 200, 'health returns 200');
  assert(data.version === 'handoff-w22', 'health exposes Worker version');
  assert(response.headers.get('cache-control')?.includes('no-store'), 'Worker JSON responses prevent stale API caching');
  assert(data.dependencies.assessmentsFolderId === true, 'health checks assessment folder config');
  assert(data.dependencies.reportTrackerSheetId === true, 'health checks tracker sheet config');
  assert(data.dependencies.supabaseBucket === true, 'health checks Supabase bucket config');
  assert(data.dependencies.reviewAccessToken === true, 'health checks review access token config');
  assert(data.dependencies.assessmentNumberSource === 'supabase_sequence', 'health exposes DB-backed assessment-number source');
  assert(data.dependencies.trackerSequenceFallbackAllowed === false, 'health shows tracker fallback is blocked by default');
  assert(data.routes.includes('POST /handoff-jobs'), 'health exposes handoff job route');
  assert(data.routes.includes('POST /review-activity-events'), 'health exposes review activity event route');
  assert(data.capabilities.inspectionCloudApi === true, 'health exposes inspection cloud API capability');
  assert(data.capabilities.appFeedback === true, 'health exposes app feedback capability');
}

async function testCorsAllowsWorkerTokenHeader() {
  const response = await worker.fetch(new Request('https://worker.test/handoff-jobs', {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://inhauslab.github.io',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type,authorization,x-worker-token'
    }
  }), baseEnv());
  const allowed = response.headers.get('Access-Control-Allow-Headers') || '';
  assert(response.status === 204, 'CORS preflight returns 204');
  assert(/x-worker-token/i.test(allowed), 'CORS allows x-worker-token header');
}

async function testReviewActivityEventWritesMetadataOnly() {
  const { mockFetch, state } = makeMockFetch();
  const { response, data } = await callWorker('/review-activity-events', {
    inspectionId: 'INH-20260801-ACT01',
    token: 'review-token',
    actor: 'Tanner',
    eventType: 'save',
    eventPayload: {
      type: 'save',
      reviewerName: 'Tanner',
      section: 'Rooms & Observations',
      fieldKey: 'inspectorNotes',
      value: 'private typed room note',
      note: 'another private note',
      currentValue: 'private current value',
      oldValue: 'private old value',
      RoomNotes: 'private room notes',
      nested: {
        caption: 'private nested caption',
        valueMeta: { type: 'text', size: 12 }
      },
      changes: [
        { fieldKey: 'caption', newValue: 'private new caption' },
        { fieldKey: 'status', valueMeta: { type: 'boolean', size: 1 } }
      ],
      valueMeta: { type: 'text', size: 24 }
    }
  }, baseEnv(), mockFetch, { headers: { Authorization: 'Bearer review-token' } });

  assert(response.status === 200, 'review activity event returns 200');
  assert(data.saved === true, 'review activity event reports saved');
  assert(state.activityEventWrites.length === 1, 'review activity event writes Supabase row');
  const row = state.activityEventWrites[0];
  assert(row.inspection_id === 'INH-20260801-ACT01', 'review activity event keeps inspection ID');
  assert(row.actor === 'Tanner', 'review activity event keeps reviewer name');
  assert(row.event_type === 'save', 'review activity event keeps event type');
  assert(row.event_payload.fieldKey === 'inspectorNotes', 'review activity event keeps field key');
  assert(row.event_payload.valueMeta.size === 24, 'review activity event keeps value metadata');
  assert(row.event_payload.value === undefined, 'review activity event strips typed value');
  assert(row.event_payload.note === undefined, 'review activity event strips note text');
  assert(row.event_payload.currentValue === undefined, 'review activity event strips current value text');
  assert(row.event_payload.oldValue === undefined, 'review activity event strips old value text');
  assert(row.event_payload.RoomNotes === undefined, 'review activity event strips case-insensitive room notes');
  assert(row.event_payload.nested.caption === undefined, 'review activity event strips nested captions');
  assert(row.event_payload.nested.valueMeta.size === 12, 'review activity event keeps nested value metadata');
  assert(row.event_payload.changes[0].newValue === undefined, 'review activity event strips array nested new values');
  assert(row.event_payload.changes[1].valueMeta.size === 1, 'review activity event keeps array nested value metadata');
}

async function testAppFeedbackUsesSupabaseStore() {
  const { mockFetch, state } = makeMockFetch();
  const { response, data } = await callWorker('/app-feedback', {
    sharedSecret: 'upload-secret',
    feedback: {
      feedbackId: 'APP-FEEDBACK-001',
      inspectionId: 'INH-20260801-FEEDBACK01',
      note: 'Cloud list should load faster',
      screen: 'cloud-resume'
    }
  }, baseEnv(), mockFetch);

  assert(response.status === 200, 'app feedback returns 200');
  assert(data.status === 'ok' && data.saved === true, 'app feedback returns save confirmation');
  assert(state.appFeedbackWrites.length === 1, 'app feedback writes one Supabase row');
  assert(state.appFeedbackWrites[0].feedback_id === 'APP-FEEDBACK-001', 'app feedback keeps stable ID');
  assert(state.appFeedbackWrites[0].payload.note === 'Cloud list should load faster', 'app feedback keeps user note');
  assert(state.appFeedbackWrites[0].payload.sharedSecret === undefined, 'app feedback never stores shared secret');
}

async function testCommentLibraryCandidateAndAdminFlow() {
  const { mockFetch, state } = makeMockFetch();
  const candidateResult = await callWorker('/comment-library/candidates', {
    sharedSecret: 'upload-secret',
    inspectionId: 'INH-20260801-COMMENT01',
    comment: {
      commentId: 'comment-001',
      cleanedText: '  Seal the visible plumbing gap.  ',
      severity: 'Maintenance',
      submittedBy: 'David Kline'
    }
  }, baseEnv(), mockFetch);

  assert(candidateResult.response.status === 200, 'comment candidate returns 200');
  assert(candidateResult.data.pendingReview === true, 'comment candidate enters pending review');
  assert(state.commentWrites.length === 1, 'comment candidate writes one Supabase row');
  assert(state.commentWrites[0].normalized_text === 'seal the visible plumbing gap.', 'comment candidate normalizes duplicate key');

  const adminResult = await callWorker('/comment-library/admin', {
    adminToken: 'admin-token',
    command: 'approve',
    commentId: 'comment-001',
    cleanedText: 'Seal the visible plumbing gap.',
    severity: 'Maintenance',
    approvedBy: 'Tanner'
  }, baseEnv(), mockFetch);
  assert(adminResult.response.status === 200, 'comment approval returns 200');
  assert(adminResult.data.comment.status === 'approved', 'comment approval changes status');

  const libraryResult = await callWorkerGet('/comment-library?token=review-token', baseEnv(), mockFetch);
  assert(libraryResult.response.status === 200, 'comment library returns 200');
  assert(libraryResult.data.comments.length === 1, 'comment library returns approved comments only');
  assert(libraryResult.data.comments[0].commentId === 'comment-001', 'comment library returns approved comment');
}

async function testSignRouteDoesNotCreateAssessmentParentRow() {
  const { mockFetch, state } = makeMockFetch();
  const { response, data } = await callWorker('/sign', {
    sharedSecret: 'upload-secret',
    inspectionId: 'INH-20260801-PHOTOONLY01',
    photoId: 'photo-1',
    roomName: 'Kitchen',
    stepName: 'ATP Before',
    caption: 'Before photo',
    slot: 1,
    inspectionType: 'Test / Training',
    inspectorName: 'David Kline',
    inspectionDate: '2026-08-01'
  }, baseEnv(), mockFetch);

  assert(response.status === 200, 'sign route returns 200');
  assert(data.signedUrl.includes('/storage/v1/object/upload/sign/inspection-photos/'), 'sign route returns signed upload URL');
  assert(data.storagePath === 'INH-20260801-PHOTOONLY01/photo-1.jpg', 'sign route returns deterministic storage path');
  assert(state.photoMetadataWrites.length === 1, 'sign route writes photo metadata');
  assert(state.photoMetadataWrites[0].inspection_id === 'INH-20260801-PHOTOONLY01', 'photo metadata keeps inspection ID');
  assert(state.photoMetadataWrites[0].photo_id === 'photo-1', 'photo metadata keeps photo ID');
  assert(state.assessmentReservations.length === 0, 'sign route does not reserve an assessment number');
  assert(state.assessmentWrites.length === 0, 'sign route does not create ihl_assessments parent rows');
  assert(state.driveCreates.length === 0, 'sign route does not create Drive folders');
  assert(state.trackerUpdates.length === 0, 'sign route does not write tracker rows');
}

async function testTrainingCreatesTestArtifactsOnly() {
  const { mockFetch, state } = makeMockFetch();
  const { response, data } = await callWorker('/start-inspection-shell', {
    sharedSecret: 'upload-secret',
    inspectionId: 'INH-TRAINING-001',
    inspectionType: 'Test / Training',
    clientName: 'Training Client',
    propertyAddress: '1 Practice Way, Basalt CO',
    inspectionDate: '2026-08-01'
  }, baseEnv(), mockFetch);

  assert(response.status === 200, 'training start-shell returns 200');
  assert(data.status === 'ready', 'training route returns ready status');
  assert(data.shellStatus === 'ready', 'training route returns ready shell status');
  assert(data.isTestTraining === true, 'training route marks receipt as test/training');
  assert(data.assessmentNumber === '', 'training route does not assign a real assessment number');
  assert(state.assessmentReservations.length === 0, 'training route does not reserve an assessment number');
  assert(state.driveCreates.length === 5, 'training route creates test root, assessment folder, and three subfolders');
  assert(state.driveCreates.some(folder => folder.name === '_Test Assessments'), 'training route creates or reuses test root');
  assert(state.driveCreates.some(folder => folder.name === 'TEST – 2026-08-01 – Client – 1 Practice Way'), 'training route creates named test assessment folder');
  assert(state.driveCreates.some(folder => folder.name === 'Photos - Client (1 Practice Way)'), 'training route creates Photos subfolder');
  assert(state.driveCreates.some(folder => folder.name === 'COCs - Client'), 'training route creates COCs subfolder');
  assert(state.driveCreates.some(folder => folder.name === 'Backup - Client'), 'training route creates Backup subfolder');
  assert(state.trackerUpdates.length === 0, 'training route does not write tracker rows');
  assert(state.assessmentWrites.length === 1, 'training route writes cloud assessment parent row');
  assert(state.assessmentWrites[0].inspection_id === 'INH-TRAINING-001', 'training parent row matches inspection ID');
  assert(state.assessmentWrites[0].assessment_num === 'INH-TRAINING-001', 'training parent row uses inspection ID instead of a real number');
  assert(state.reviewWrites.length === 1, 'training route saves ready receipt');
}

async function testInspectionSaveCreatesDurableCheckpoint() {
  const { mockFetch, state } = makeMockFetch({
    assessmentRows: [{
      inspection_id: 'INH-20260801-SAVE01',
      assessment_num: '018',
      status: 'In Progress',
      drive_folder_id: 'drive-assessment',
      assessment_folder_url: 'https://drive.google.com/drive/folders/drive-assessment',
      raw_jsonb: {}
    }]
  });
  const { response, data } = await callWorker('/inspections/save', {
    sharedSecret: 'upload-secret',
    inspectionId: 'INH-20260801-SAVE01',
    clientName: 'Save Client',
    propertyAddress: '10 Main St, Basalt CO',
    inspectorName: 'David Kline',
    inspectionDate: '2026-08-01',
    status: 'in-progress',
    resumeData: {
      inspectionId: 'INH-20260801-SAVE01',
      clientName: 'Save Client',
      status: 'in-progress',
      stepData: { kitchen: { notes: 'Dry at sink' } }
    }
  }, baseEnv(), mockFetch);

  assert(response.status === 200, 'inspection save returns 200');
  assert(data.status === 'ok' && data.saved === true, 'inspection save returns confirmed receipt');
  assert(data.assessmentNumber === '018', 'inspection save preserves reserved assessment number');
  assert(data.folderId === 'drive-assessment', 'inspection save preserves assessment folder');
  assert(state.inspectionEventWrites.length === 1, 'inspection save writes one durable checkpoint event');
  assert(state.assessmentWrites.length === 1, 'inspection save updates the canonical assessment row');
  assert(state.assessmentWrites[0].raw_jsonb.resumeData.stepData.kitchen.notes === 'Dry at sink', 'inspection save stores complete resume data');
}

async function testActiveInspectionListUsesCanonicalSupabaseRows() {
  const prepared = {
    inspectionId: 'INH-20260801-PREP01',
    clientName: 'Prepared Client',
    propertyAddress: '11 Main St, Basalt CO',
    inspectionDate: '2026-08-01',
    inspectorName: 'David Kline',
    status: 'prepared',
    resumeData: {
      inspectionId: 'INH-20260801-PREP01',
      clientName: 'Prepared Client',
      propertyAddress: '11 Main St, Basalt CO',
      status: 'prepared',
      stepData: {}
    }
  };
  const { mockFetch } = makeMockFetch({
    assessmentRows: [
      { inspection_id: 'INH-20260801-PREP01', status: 'prepared', drive_folder_id: 'drive-prep', raw_jsonb: prepared },
      { inspection_id: 'INH-20260701-DONE01', status: 'Needs Review', raw_jsonb: { inspectionId: 'INH-20260701-DONE01', status: 'completed', resumeData: { inspectionId: 'INH-20260701-DONE01', stepData: {} } } },
      { inspection_id: 'INH-20260701-BROKEN01', status: 'In Progress', raw_jsonb: { inspectionId: 'INH-20260701-BROKEN01', status: 'in-progress' } }
    ]
  });
  const { response, data } = await callWorkerGet('/inspections/active?token=review-token', baseEnv(), mockFetch);

  assert(response.status === 200, 'active inspection list returns 200');
  assert(data.status === 'ok', 'active inspection list returns app-compatible status');
  assert(data.count === 1, 'active list excludes completed and unusable rows');
  assert(data.inspections[0].inspectionId === 'INH-20260801-PREP01', 'active list returns prepared inspection');
  assert(data.inspections[0].folderId === 'drive-prep', 'active list returns folder metadata');
}

async function testInspectionOpenRecoversConcurrentTeamEvents() {
  const base = {
    inspectionId: 'INH-20260801-TEAM01',
    status: 'in-progress',
    resumeData: {
      inspectionId: 'INH-20260801-TEAM01',
      status: 'in-progress',
      stepData: {}
    }
  };
  const deviceA = {
    inspectionId: 'INH-20260801-TEAM01',
    resumeData: {
      inspectionId: 'INH-20260801-TEAM01',
      stepData: {
        kitchen: {
          notes: 'Device A kitchen note',
          _fieldUpdates: { notes: { updatedAt: '2026-08-01T15:01:00.000Z' } }
        }
      }
    }
  };
  const deviceB = {
    inspectionId: 'INH-20260801-TEAM01',
    resumeData: {
      inspectionId: 'INH-20260801-TEAM01',
      stepData: {
        bedroom: {
          notes: 'Device B bedroom note',
          _fieldUpdates: { notes: { updatedAt: '2026-08-01T15:02:00.000Z' } }
        }
      }
    }
  };
  const { mockFetch } = makeMockFetch({
    assessmentRows: [{ inspection_id: 'INH-20260801-TEAM01', assessment_num: '019', status: 'In Progress', raw_jsonb: base }],
    inspectionEvents: [
      { event_key: 'team-a', inspection_id: 'INH-20260801-TEAM01', payload: deviceA, created_at: '2026-08-01T15:01:00.000Z' },
      { event_key: 'team-b', inspection_id: 'INH-20260801-TEAM01', payload: deviceB, created_at: '2026-08-01T15:02:00.000Z' }
    ]
  });
  const { response, data } = await callWorkerGet('/inspections/INH-20260801-TEAM01?token=review-token', baseEnv(), mockFetch);

  assert(response.status === 200, 'inspection open returns 200');
  assert(data.inspection.resumeData.stepData.kitchen.notes === 'Device A kitchen note', 'inspection open recovers device A update');
  assert(data.inspection.resumeData.stepData.bedroom.notes === 'Device B bedroom note', 'inspection open recovers device B update');
}

async function testInspectionOpenAppliesPhotoTombstones() {
  const stalePhoto = {
    photoId: 'p-deleted01',
    roomName: 'Bedroom 1',
    stepName: 'Photos',
    timestamp: '2026-08-01T15:00:00.000Z'
  };
  const base = {
    inspectionId: 'INH-20260801-TOMB01',
    status: 'completed',
    resumeData: {
      inspectionId: 'INH-20260801-TOMB01',
      status: 'completed',
      stepData: { bedroom1: { _photos: [stalePhoto] } },
      photoTombstones: {}
    }
  };
  const deletionEvent = {
    inspectionId: 'INH-20260801-TOMB01',
    resumeData: {
      inspectionId: 'INH-20260801-TOMB01',
      status: 'completed',
      stepData: { bedroom1: { _photos: [] } },
      photoTombstones: {
        'p-deleted01': { status: 'deleted', updatedAt: '2026-08-01T15:05:00.000Z' }
      }
    }
  };
  const { mockFetch } = makeMockFetch({
    assessmentRows: [{ inspection_id: 'INH-20260801-TOMB01', assessment_num: '021', status: 'Synced', raw_jsonb: base }],
    inspectionEvents: [
      { event_key: 'delete-photo', inspection_id: 'INH-20260801-TOMB01', payload: deletionEvent, created_at: '2026-08-01T15:05:00.000Z' }
    ]
  });
  const { response, data } = await callWorkerGet('/inspections/INH-20260801-TOMB01?token=review-token', baseEnv(), mockFetch);

  assert(response.status === 200, 'inspection tombstone open returns 200');
  assert(data.inspection.resumeData.stepData.bedroom1._photos.length === 0, 'deleted photo is removed while replaying inspection events');
  assert(data.inspection.resumeData.photoTombstones['p-deleted01'].status === 'deleted', 'photo tombstone remains in the canonical source record');
}

async function testPhotoDeleteRemovesManagedDriveCopy() {
  const photoId = 'p-delete-drive01';
  const driveFileId = 'drive-photo-delete01';
  const { mockFetch, state } = makeMockFetch({
    reviewRow: {
      inspection_id: 'INH-20260801-DEL01',
      field_data: {
        system: {
          startInspectionShell: {
            photosFolderId: 'drive-photos'
          }
        }
      },
      updated_at: '2026-08-01T15:00:00.000Z'
    },
    photoRows: [{
      inspection_id: 'INH-20260801-DEL01',
      photo_id: photoId,
      drive_url: `https://drive.google.com/file/d/${driveFileId}/view`
    }],
    existingDriveFiles: [{
      id: driveFileId,
      parentId: 'drive-photos',
      name: `Bedroom 1 - Overview - ${photoId}.jpg`,
      mimeType: 'image/jpeg'
    }]
  });
  const { response, data } = await callWorker('/delete', {
    sharedSecret: 'upload-secret',
    inspectionId: 'INH-20260801-DEL01',
    photoId
  }, baseEnv(), mockFetch);

  assert(response.status === 200, 'photo delete returns 200');
  assert(data.deleted === true, 'photo delete confirms deletion');
  assert(data.driveDeletedCount === 1, 'photo delete confirms one managed Drive copy removed');
  assert(state.driveTrashes.length === 1, 'photo delete trashes the Drive file');
  assert(state.driveTrashes[0].fileId === driveFileId, 'photo delete targets the matching Drive file');
}

async function testPhotoDeleteDoesNotRemoveDriveFileOutsideManagedFolder() {
  const photoId = 'p-delete-outside01';
  const driveFileId = 'drive-photo-outside01';
  const { mockFetch, state } = makeMockFetch({
    reviewRow: {
      inspection_id: 'INH-20260801-DEL02',
      field_data: {
        system: {
          startInspectionShell: {
            photosFolderId: 'drive-photos'
          }
        }
      },
      updated_at: '2026-08-01T15:00:00.000Z'
    },
    photoRows: [{
      inspection_id: 'INH-20260801-DEL02',
      photo_id: photoId,
      drive_url: `https://drive.google.com/file/d/${driveFileId}/view`
    }],
    existingDriveFiles: [{
      id: driveFileId,
      parentId: 'unrelated-folder',
      name: `Bedroom 1 - Overview - ${photoId}.jpg`,
      mimeType: 'image/jpeg'
    }]
  });
  const { response, data } = await callWorker('/delete', {
    sharedSecret: 'upload-secret',
    inspectionId: 'INH-20260801-DEL02',
    photoId
  }, baseEnv(), mockFetch);

  assert(response.status === 200, 'photo delete outside managed folder returns 200');
  assert(data.driveDeletedCount === 0, 'photo outside managed folder is not counted as deleted');
  assert(state.driveTrashes.length === 0, 'photo outside managed folder is not trashed');
}

async function testTeamMergePersistsEventBeforeCanonicalUpdate() {
  const { mockFetch, state } = makeMockFetch({
    assessmentRows: [{
      inspection_id: 'INH-20260801-TEAM02',
      assessment_num: '020',
      status: 'In Progress',
      raw_jsonb: {
        inspectionId: 'INH-20260801-TEAM02',
        resumeData: { inspectionId: 'INH-20260801-TEAM02', status: 'in-progress', stepData: {} }
      }
    }]
  });
  const { response, data } = await callWorker('/inspections/team-merge', {
    sharedSecret: 'upload-secret',
    inspection: {
      inspectionId: 'INH-20260801-TEAM02',
      resumeData: {
        inspectionId: 'INH-20260801-TEAM02',
        status: 'in-progress',
        deviceId: 'phone-b',
        stepData: {
          blueRoom: {
            noIssuesFound: true,
            _fieldUpdates: { noIssuesFound: { updatedAt: '2026-08-01T15:03:00.000Z' } }
          }
        }
      }
    }
  }, baseEnv(), mockFetch);

  assert(response.status === 200, 'team merge returns 200');
  assert(data.status === 'ok' && data.merged === true, 'team merge returns confirmed receipt');
  assert(data.resumeData.stepData.blueRoom.noIssuesFound === true, 'team merge returns merged device update');
  assert(state.inspectionEventWrites.length === 1, 'team merge writes immutable event before canonical row');
  assert(state.assessmentWrites.length === 1, 'team merge updates canonical assessment row');
}

async function testRealInspectionWithTrainingAddressDoesNotSkipShell() {
  const { mockFetch, state } = makeMockFetch();
  const { response, data } = await callWorker('/start-inspection-shell', {
    sharedSecret: 'upload-secret',
    inspectionId: 'INH-20260801-REALTRAIN',
    inspectionType: 'Real Assessment',
    clientName: 'Casey Example',
    propertyAddress: '88 Training Way, Basalt CO',
    inspectorName: 'David Kline',
    inspectionDate: '2026-08-01',
    startedAt: '2026-08-01T15:00:00.000Z'
  }, baseEnv(), mockFetch);

  assert(response.status === 200, 'real inspection with training address returns 200');
  assert(data.status === 'ready', 'real inspection with training address creates shell');
  assert(data.isTestTraining !== true, 'real inspection with training address is not marked test/training');
  assert(state.driveCreates.length === 4, 'real inspection with training address creates Drive shell');
  assert(state.trackerUpdates.length > 0, 'real inspection with training address writes tracker row');
  assert(state.assessmentWrites.length === 1, 'real inspection with training address writes assessment parent row');
}

async function testRealStartShellCreatesReceipt() {
  const { mockFetch, state } = makeMockFetch();
  const { response, data } = await callWorker('/start-inspection-shell', {
    sharedSecret: 'upload-secret',
    inspectionId: 'INH-20260801-REAL01',
    inspectionType: 'Real Assessment',
    clientName: 'Alex Example',
    propertyAddress: '123 Main St, Basalt CO',
    inspectorName: 'David Kline',
    customerId: 'C-001',
    homeId: 'H-001',
    reportId: 'R-001',
    inspectionDate: '2026-08-01',
    startedAt: '2026-08-01T15:00:00.000Z'
  }, baseEnv(), mockFetch);

  assert(response.status === 200, 'real start-shell returns 200');
  assert(data.status === 'ready', 'real start-shell returns ready');
  assert(data.assessmentNumber === '018', 'assessment number comes from Supabase reservation');
  assert(data.assessmentNumberSource === 'supabase_sequence', 'start-shell records DB-backed assessment number source');
  assert(state.assessmentReservations.length === 1, 'real start-shell reserves assessment number in Supabase');
  assert(data.folderName === '018 – 2026-08-01 – Example – 123 Main St', 'folder naming matches Tanner spec');
  assert(data.trackerRow === 9, 'tracker writes into next blank row');
  assert(data.trackerStatus === 'In Progress', 'tracker status is In Progress');
  assert(state.driveCreates.length === 4, 'creates assessment plus three subfolders');
  assert(state.driveCreates.some(folder => folder.name === 'Photos - Example (123 Main St)'), 'creates Photos subfolder');
  assert(state.driveCreates.some(folder => folder.name === 'COCs - Example'), 'creates COCs subfolder');
  assert(state.driveCreates.some(folder => folder.name === 'Backup - Example'), 'creates Backup subfolder');
  assert(state.trackerUpdates.some(update => update.range === "'Report Tracker'!A9"), 'writes column A tracker status');
  assert(state.trackerUpdates.some(update => update.range === "'Report Tracker'!B9" && update.values[0][0] === '018'), 'writes assessment number');
  assert(state.trackerUpdates.some(update => update.range === "'Report Tracker'!C9" && update.values[0][0] === 'Real Assessment'), 'writes assessment type in C');
  assert(state.trackerUpdates.some(update => update.range === "'Report Tracker'!D9" && update.values[0][0] === 'Alex Example'), 'writes client name in D');
  assert(state.trackerUpdates.some(update => update.range === "'Report Tracker'!E9" && update.values[0][0] === '2026-08-01'), 'writes assessment date in E');
  assert(state.trackerUpdates.some(update => update.range === "'Report Tracker'!F9" && update.values[0][0] === '123 Main St, Basalt CO'), 'writes address in F');
  assert(state.trackerUpdates.some(update => update.range === "'Report Tracker'!G9" && update.values[0][0] === 'CO'), 'writes service location in G');
  assert(state.trackerUpdates.some(update => update.range === "'Report Tracker'!H9" && update.values[0][0] === 'C-001'), 'writes client ID in H');
  assert(state.trackerUpdates.some(update => update.range === "'Report Tracker'!I9" && update.values[0][0] === 'H-001'), 'writes home ID in I');
  assert(state.trackerUpdates.some(update => update.range === "'Report Tracker'!J9" && update.values[0][0] === 'R-001'), 'writes report ID in J');
  assert(state.trackerUpdates.some(update => update.range === "'Report Tracker'!K9" && update.values[0][0] === 'INH-20260801-REAL01'), 'writes inspector app ID in K');
  assert(state.trackerUpdates.some(update => update.range === "'Report Tracker'!AO9"), 'writes folder link in AO');
  assert(state.assessmentWrites.length === 1, 'writes ihl_assessments parent row');
  assert(state.assessmentWrites[0].inspection_id === 'INH-20260801-REAL01', 'assessment parent row matches inspection ID');
  assert(state.assessmentWrites[0].assessment_num === '018', 'assessment parent row matches reserved assessment number');
  assert(state.assessmentWrites[0].drive_folder_id, 'assessment parent row stores Drive folder ID');
  assert(state.reviewWrites.length === 1, 'saves start-shell receipt to review storage');
  assert(state.reviewWrites[0].field_data.assessmentNumberSource === 'supabase_sequence', 'review storage records DB-backed assessment source');
}

async function testStartShellDetectsTrackerReservationConflict() {
  const { mockFetch, state } = makeMockFetch({
    afterTrackerBatchUpdate(currentState) {
      if (currentState.trackerValues[8]) currentState.trackerValues[8][10] = 'INH-20260801-OTHER';
    }
  });
  const { response, data } = await callWorker('/start-inspection-shell', {
    sharedSecret: 'upload-secret',
    inspectionId: 'INH-20260801-RACE01',
    inspectionType: 'Real Assessment',
    clientName: 'Race Example',
    propertyAddress: '500 Concurrent Way, Basalt CO',
    inspectorName: 'David Kline',
    inspectionDate: '2026-08-01',
    startedAt: '2026-08-01T15:00:00.000Z'
  }, baseEnv(), mockFetch);

  assert(response.status === 500, 'start-shell conflict returns 500');
  assert(/tracker_reservation_missing/.test(data.error || ''), 'start-shell conflict reports tracker reservation failure');
  assert(state.trackerUpdates.length > 0, 'conflict test attempted tracker write');
  assert(state.assessmentWrites.length === 0, 'conflict does not save assessment parent receipt');
  assert(state.reviewWrites.length === 0, 'conflict does not save ready start-shell receipt');
}

async function testStartShellRequiresSupabaseReservationByDefault() {
  const { mockFetch, state } = makeMockFetch({ failAssessmentReservation: true });
  const { response, data } = await callWorker('/start-inspection-shell', {
    sharedSecret: 'upload-secret',
    inspectionId: 'INH-20260801-NODB01',
    inspectionType: 'Real Assessment',
    clientName: 'No Db Example',
    propertyAddress: '700 Sequence Way, Basalt CO',
    inspectorName: 'David Kline',
    inspectionDate: '2026-08-01'
  }, baseEnv(), mockFetch);

  assert(response.status === 500, 'missing DB reservation returns 500 by default');
  assert(/assessment_number_reservation_failed/.test(data.error || ''), 'failure explains assessment-number reservation');
  assert(state.driveCreates.length === 0, 'DB reservation failure does not create Drive folders');
  assert(state.trackerUpdates.length === 0, 'DB reservation failure does not write tracker rows');
  assert(state.assessmentWrites.length === 0, 'DB reservation failure does not write assessment parent row');
  assert(state.reviewWrites.length === 0, 'DB reservation failure does not save ready start-shell receipt');
}

async function testStartShellRejectsSingleEnvTrackerSequenceFallback() {
  const { mockFetch, state } = makeMockFetch({ failAssessmentReservation: true });
  const { response, data } = await callWorker('/start-inspection-shell', {
    sharedSecret: 'upload-secret',
    inspectionId: 'INH-20260801-FALLBACK00',
    inspectionType: 'Real Assessment',
    clientName: 'Unsafe Fallback Example',
    propertyAddress: '700 Single Flip Way, Basalt CO',
    inspectorName: 'David Kline',
    inspectionDate: '2026-08-01'
  }, baseEnv({ ALLOW_TRACKER_SEQUENCE_FALLBACK: 'true' }), mockFetch);

  assert(response.status === 500, 'single fallback env var still fails closed');
  assert(/assessment_number_reservation_failed/.test(data.error || ''), 'single fallback failure explains assessment-number reservation');
  assert(state.driveCreates.length === 0, 'single fallback env var does not create Drive folders');
  assert(state.trackerUpdates.length === 0, 'single fallback env var does not write tracker rows');
  assert(state.assessmentWrites.length === 0, 'single fallback env var does not write assessment parent row');
  assert(state.reviewWrites.length === 0, 'single fallback env var does not save start-shell receipt');
}

async function testStartShellAllowsApprovedTrackerSequenceFallback() {
  const { mockFetch, state } = makeMockFetch({ failAssessmentReservation: true });
  const { response, data } = await callWorker('/start-inspection-shell', {
    sharedSecret: 'upload-secret',
    inspectionId: 'INH-20260801-FALLBACK01',
    inspectionType: 'Real Assessment',
    clientName: 'Approved Fallback Example',
    propertyAddress: '701 Sequence Way, Basalt CO',
    inspectorName: 'David Kline',
    inspectionDate: '2026-08-01'
  }, baseEnv({
    ALLOW_TRACKER_SEQUENCE_FALLBACK: 'true',
    TRACKER_SEQUENCE_FALLBACK_DECISION: 'approved'
  }), mockFetch);

  assert(response.status === 200, 'approved tracker fallback returns 200');
  assert(data.assessmentNumber === '018', 'approved fallback can use tracker sequence');
  assert(data.assessmentNumberSource === 'tracker_sequence_fallback', 'approved fallback source is recorded on receipt');
  assert(state.trackerUpdates.length > 0, 'approved fallback writes tracker row');
  assert(state.assessmentWrites.length === 1, 'approved fallback writes assessment parent row');
  assert(state.assessmentWrites[0].assessment_num === '018', 'approved fallback parent row records tracker-derived number');
  assert(state.reviewWrites.length === 1, 'approved fallback saves start-shell receipt');
}

async function testExistingReceiptIsReused() {
  const existingReceipt = {
    status: 'ready',
    inspectionId: 'INH-20260801-REAL02',
    assessmentNumber: '019',
    folderId: 'drive-existing',
    folderUrl: 'https://drive.google.com/drive/folders/drive-existing',
    trackerRow: 10,
    trackerUrl: 'https://docs.google.com/spreadsheets/d/tracker/edit#range=A10',
    trackerStatus: 'In Progress'
  };
  const { mockFetch, state } = makeMockFetch({
    reviewRow: {
      inspection_id: 'INH-20260801-REAL02',
      field_data: {
        system: {
          startInspectionShell: existingReceipt
        }
      },
      updated_at: '2026-08-01T15:00:00.000Z'
    }
  });
  const { response, data } = await callWorker('/start-inspection-shell', {
    sharedSecret: 'upload-secret',
    inspectionId: 'INH-20260801-REAL02',
    inspectionType: 'Real Assessment',
    clientName: 'Alex Example',
    propertyAddress: '123 Main St, Basalt CO',
    inspectionDate: '2026-08-01'
  }, baseEnv(), mockFetch);

  assert(response.status === 200, 'existing receipt returns 200');
  assert(data.cached === true, 'existing receipt is returned from cache');
  assert(data.folderId === 'drive-existing', 'existing folder is reused');
  assert(state.driveCreates.length === 0, 'cached receipt does not create Drive folders');
  assert(state.trackerUpdates.length === 0, 'cached receipt does not write tracker');
  assert(state.assessmentWrites.length === 0, 'cached receipt does not write assessment row');
}

async function testHandoffJobCreatesPackageReceipt() {
  const shellReceipt = {
    status: 'ready',
    inspectionId: 'INH-20260801-HAND01',
    assessmentNumber: '018',
    folderId: 'drive-assessment',
    folderUrl: 'https://drive.google.com/drive/folders/drive-assessment',
    photosFolderId: 'drive-photos',
    photosFolderUrl: 'https://drive.google.com/drive/folders/drive-photos',
    cocsFolderId: 'drive-cocs',
    cocsFolderUrl: 'https://drive.google.com/drive/folders/drive-cocs',
    backupFolderId: 'drive-backup',
    backupFolderUrl: 'https://drive.google.com/drive/folders/drive-backup',
    trackerRow: 9,
    trackerUrl: 'https://docs.google.com/spreadsheets/d/tracker-sheet/edit#range=A9',
    trackerStatus: 'In Progress'
  };
  const fieldData = {
    clientName: 'Alex Example',
    propertyAddress: '123 Main St, Basalt CO',
    inspectionDate: '2026-08-01',
    inspectorName: 'David Kline',
    obs_1_note: 'Example observation',
    obs_1_location: 'Kitchen',
    obs_1_photoIds: ['photo-1'],
    obs_2_note: 'Second observation',
    obs_3_note: 'Third observation',
    obs_4_note: 'Fourth observation',
    obs_5_note: 'Fifth observation',
    obs_6_note: 'Sixth observation',
    actionTaken_1_desc: 'Cleaned test surface',
    actionTaken_1_photoIds: ['photo-2'],
    followUp_3_desc: 'Example follow up',
    followUp_3_timeframe: '6 months',
    followUp_3_photoIds: ['photo-1', 'photo-2'],
    testsConfirmed: { pfas: true, waterPanel: true },
    rooms: [{ name: 'Kitchen', inspectorNotes: 'Observed staining.', photoIds: ['photo-1'] }],
    system: { startInspectionShell: shellReceipt }
  };
  const { mockFetch, state } = makeMockFetch({
    assessmentRows: [{
      inspection_id: 'INH-20260801-HAND01',
      assessment_num: '018',
      status: 'In Review',
      drive_folder_id: 'drive-assessment',
      assessment_folder_url: 'https://drive.google.com/drive/folders/drive-assessment',
      raw_jsonb: {
        inspectionId: 'INH-20260801-HAND01',
        rooms: [{ name: 'Kitchen', inspectorNotes: 'Canonical assessment note.', photoIds: ['photo-1'] }]
      }
    }],
    reviewRow: {
      inspection_id: 'INH-20260801-HAND01',
      field_data: fieldData,
      updated_at: '2026-08-01T15:00:00.000Z'
    },
    photoRows: [
      {
        photo_id: 'photo-1',
        inspection_id: 'INH-20260801-HAND01',
        room_name: 'Kitchen',
        step_name: 'ATP Before',
        caption: 'Before photo',
        slot: 1,
        storage_path: 'INH-20260801-HAND01/photo-1.jpg',
        drive_url: 'https://drive.google.com/file/d/drive-photo-1/view',
        created_at: '2026-08-01T15:10:00.000Z'
      },
      {
        photo_id: 'photo-2',
        inspection_id: 'INH-20260801-HAND01',
        room_name: 'Kitchen',
        step_name: 'ATP After',
        caption: 'After photo',
        slot: 2,
        storage_path: 'INH-20260801-HAND01/photo-2.jpg',
        drive_url: 'https://drive.google.com/file/d/drive-photo-2/view',
        created_at: '2026-08-01T15:11:00.000Z'
      }
    ]
  });
  const { response, data } = await callWorker('/handoff-jobs', {
    inspectionId: 'INH-20260801-HAND01',
    requestedBy: 'review-portal'
  }, baseEnv(), mockFetch, { headers: { Authorization: 'Bearer review-token' } });

  assert(response.status === 200, 'handoff job returns 200 when receipt is ready');
  assert(data.status === 'ready', 'handoff job is ready');
  assert(data.artifactReceipt.status === 'ready', 'artifact receipt is ready');
  assert(data.artifactReceipt.spreadsheetId, 'receipt has Review Portal Data spreadsheet');
  assert(data.artifactReceipt.inspectionSpreadsheetId, 'receipt has InHaus Inspection spreadsheet');
  assert(data.artifactReceipt.contextFileId, 'receipt has assessment context file');
  assert(data.artifactReceipt.rawJsonUrl, 'receipt has raw JSON backup');
  assert(data.artifactReceipt.photoLogCount === 2, 'receipt counts photo log rows');
  assert(data.artifactReceipt.roomDetailCount === 1, 'receipt counts room detail rows');
  assert(
    hasSheetRowContaining(state, 'Room Details', ['Kitchen', 'Canonical assessment note.']),
    `room details use canonical assessment data over stale review rooms: ${JSON.stringify(sheetRowsForTab(state, 'Room Details'))}`
  );
  assert(data.artifactReceipt.photoFolderLinkedCount === 2, 'receipt links existing Drive photos');
  assert(data.artifactReceipt.photoFolderOperationLimit === 5, 'receipt records conservative default photo operation batch limit');
  assert(state.calls.length < 50, `handoff stays below Cloudflare's 50-subrequest limit: ${state.calls.length}`);
  assert(state.driveFolderLists.some(list => list.parentId === 'drive-photos'), 'lists Photos folder once for package repair');
  assert(state.trackerUpdates.length === 0, 'handoff reuses existing start-shell tracker row');
  assert(state.assessmentWrites.length === 0, 'handoff does not rewrite assessment row when shell exists');
  assert(state.sheetValueWrites.some(update => String(update.range).includes('Raw Review Data')), 'writes Raw Review Data tab');
  assert(state.sheetValueWrites.some(update => String(update.range).includes('Photo Log')), 'writes Photo Log tab');
  assert(state.sheetValueWrites.some(update => String(update.range).includes('Raw App Data')), 'writes Raw App Data tab');
  assert(state.sheetValueWrites.some(update => String(update.range).includes('Air Data')), 'writes Air Data tab');
  assert(hasSheetCellValue(state, 'Summary', 'INHAUS LAB — INSPECTION DATA'), 'writes InHaus Inspection summary');
  assert(sheetDataRowsForTab(state, 'Raw Review Data').length === Object.keys(fieldData).length, 'raw tab has one row for every field_data key');
  assert(hasSheetRowContaining(state, 'Raw Review Data', ['obs_2_note', 'Second observation', 'string']), 'raw tab includes obs_2_note');
  assert(hasSheetRowContaining(state, 'Raw Review Data', ['obs_6_note', 'Sixth observation', 'string']), 'raw tab includes obs_6_note');
  assert(hasSheetRowContaining(state, 'Raw Review Data', ['actionTaken_1_desc', 'Cleaned test surface', 'string']), 'raw tab includes actionTaken_1_desc');
  assert(hasSheetRowContaining(state, 'Raw Review Data', ['followUp_3_desc', 'Example follow up', 'string']), 'raw tab includes followUp_3_desc');
  assert(hasSheetRowContaining(state, 'Raw Review Data', ['testsConfirmed', JSON.stringify(fieldData.testsConfirmed), 'json']), 'raw tab serializes nested objects');
  assert(hasSheetRowContaining(state, 'Review Portal Data', ['Dynamic Review', 'obs_6_note', 'Sixth observation']), 'formatted tab includes dynamic observation rows');
  assert(hasSheetRowContaining(state, 'Review Portal Data', ['Dynamic Review', 'actionTaken_1_desc', 'Cleaned test surface']), 'formatted tab includes dynamic action rows');
  assert(hasSheetRowContaining(state, 'Review Portal Data', ['Dynamic Review', 'followUp_3_timeframe', '6 months']), 'formatted tab includes dynamic follow-up rows');
  assert(sheetDataRowsForTab(state, 'Photo Log').length === 2, 'photo log has one row per photo');
  assert(hasSheetRowContaining(state, 'Photo Log', ['photo-1', 'Kitchen', 'ATP Before', 'Before photo', 'https://drive.google.com/file/d/drive-photo-1/view']), 'photo log includes first photo details');
  assert(hasSheetRowContaining(state, 'Photo Log', ['photo-2', 'Kitchen', 'ATP After', 'After photo', 'https://drive.google.com/file/d/drive-photo-2/view']), 'photo log includes second photo details');
  assert(hasSheetRowContaining(state, 'Room Details', ['Kitchen', 'Canonical assessment note.', 'photo-1, photo-2']), 'room details include canonical inspector notes and every assigned room photo ID');
  assert(state.rawUploads.length === 2, 'writes raw JSON backup and assessment context files');
  const rawJsonUpload = state.rawUploads.find(upload => upload.bodyText.includes('"obs_6_note": "Sixth observation"'));
  const contextUpload = state.rawUploads.find(upload => upload.bodyText.includes('# _context.md'));
  assert(rawJsonUpload, 'raw JSON backup includes late observation key');
  assert(rawJsonUpload.bodyText.includes('"actionTaken_1_desc": "Cleaned test surface"'), 'raw JSON backup includes action-taken key');
  assert(rawJsonUpload.bodyText.includes('"followUp_3_photoIds"'), 'raw JSON backup includes follow-up photo IDs');
  assert(contextUpload, 'assessment context file has the expected heading');
  assert(contextUpload.bodyText.includes('## Files'), 'assessment context links Tanner package files');
  assert(state.reviewWrites.length >= 2, 'saves running and final handoff states');
  assert(state.handoffJobWrites.length >= 2, 'writes running and final durable handoff job states');
  assert(state.handoffJobs.find(row => row.job_key === 'handoff_INH-20260801-HAND01').status === 'ready', 'durable handoff job is ready');
  assert(state.handoffArtifacts.some(row => row.artifact_key === 'assessment_folder'), 'durable artifacts include assessment folder');
  assert(state.handoffArtifacts.some(row => row.artifact_key === 'review_portal_data_spreadsheet'), 'durable artifacts include review data spreadsheet');
  assert(state.handoffArtifacts.some(row => row.artifact_key === 'inhaus_inspection_spreadsheet'), 'durable artifacts include InHaus Inspection spreadsheet');
  assert(state.handoffArtifacts.some(row => row.artifact_key === 'assessment_context'), 'durable artifacts include assessment context');
  assert(state.handoffArtifacts.find(row => row.artifact_key === 'review_portal_data_spreadsheet').metadata.roomDetailCount === 1, 'durable spreadsheet artifact records room detail count');
  assert(state.handoffArtifacts.some(row => row.artifact_key === 'raw_review_data'), 'durable artifacts include raw review data backup');
  assert(state.handoffArtifacts.some(row => row.artifact_key === 'photos_folder'), 'durable artifacts include photos folder');
  assert(state.handoffArtifacts.find(row => row.artifact_key === 'photos_folder').status === 'ready', 'complete photo artifact is ready');
  assert(state.handoffArtifacts.some(row => row.artifact_key === 'tracker_row'), 'durable artifacts include tracker row');
  const finalWrite = state.reviewWrites[state.reviewWrites.length - 1];
  assert(finalWrite.field_data.system.tannerHandoff.status === 'ready', 'final review storage has handoff receipt');
}

async function testHandoffJobCachedReceiptDoesNotDuplicateWork() {
  const receipt = {
    status: 'ready',
    inspectionId: 'INH-20260801-HAND02',
    isTestTraining: false,
    folderId: 'drive-assessment',
    folderUrl: 'https://drive.google.com/drive/folders/drive-assessment',
    photosFolderId: 'drive-photos',
    photosFolderUrl: 'https://drive.google.com/drive/folders/drive-photos',
    spreadsheetId: 'drive-sheet',
    spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/drive-sheet/edit',
    inspectionSpreadsheetId: 'drive-inspection-sheet',
    inspectionSpreadsheetUrl: 'https://docs.google.com/spreadsheets/d/drive-inspection-sheet/edit',
    contextFileId: 'drive-context',
    contextFileUrl: 'https://drive.google.com/file/d/drive-context/view',
    rawAppKeyCount: 10,
    rawJsonUrl: 'https://drive.google.com/file/d/raw/view',
    trackerRow: 10,
    trackerUrl: 'https://docs.google.com/spreadsheets/d/tracker-sheet/edit#range=A10',
    trackerStatus: 'In Progress',
    photoFolderFailedCount: 0,
    photoFolderPendingCount: 0,
    updatedAt: '2026-08-01T15:30:00.000Z'
  };
  const { mockFetch, state } = makeMockFetch({
    reviewRow: {
      inspection_id: 'INH-20260801-HAND02',
      field_data: { system: { tannerHandoff: receipt } },
      updated_at: '2026-08-01T15:30:00.000Z'
    }
  });
  const { response, data } = await callWorker('/handoff-jobs', {
    inspectionId: 'INH-20260801-HAND02'
  }, baseEnv(), mockFetch, { headers: { Authorization: 'Bearer review-token' } });

  assert(response.status === 200, 'cached handoff returns 200');
  assert(data.cached === true, 'cached handoff is marked cached');
  assert(state.driveCreates.length === 0, 'cached handoff does not create Drive artifacts');
  assert(state.sheetValueWrites.length === 0, 'cached handoff does not rewrite sheets');
  assert(state.reviewWrites.length === 0, 'cached handoff does not rewrite review storage');
  assert(state.handoffJobWrites.length === 1, 'cached handoff backfills durable job row');
  assert(state.handoffArtifacts.some(row => row.artifact_key === 'assessment_folder'), 'cached handoff backfills durable artifacts');
}

async function testHandoffJobSheetFailureSavesFailedReceipt() {
  const shellReceipt = {
    status: 'ready',
    inspectionId: 'INH-20260801-SHEETFAIL01',
    assessmentNumber: '018',
    folderId: 'drive-assessment',
    folderUrl: 'https://drive.google.com/drive/folders/drive-assessment',
    photosFolderId: 'drive-photos',
    photosFolderUrl: 'https://drive.google.com/drive/folders/drive-photos',
    cocsFolderId: 'drive-cocs',
    cocsFolderUrl: 'https://drive.google.com/drive/folders/drive-cocs',
    backupFolderId: 'drive-backup',
    backupFolderUrl: 'https://drive.google.com/drive/folders/drive-backup',
    trackerRow: 9,
    trackerUrl: 'https://docs.google.com/spreadsheets/d/tracker-sheet/edit#range=A9',
    trackerStatus: 'In Progress'
  };
  const { mockFetch, state } = makeMockFetch({
    failPackageSheetValueWrite: true,
    reviewRow: {
      inspection_id: 'INH-20260801-SHEETFAIL01',
      field_data: {
        clientName: 'Alex Example',
        propertyAddress: '123 Main St, Basalt CO',
        inspectionDate: '2026-08-01',
        inspectorName: 'David Kline',
        obs_1_note: 'Example observation',
        system: { startInspectionShell: shellReceipt }
      },
      updated_at: '2026-08-01T15:00:00.000Z'
    },
    photoRows: []
  });
  const { response, data } = await callWorker('/handoff-jobs', {
    inspectionId: 'INH-20260801-SHEETFAIL01',
    requestedBy: 'review-portal'
  }, baseEnv(), mockFetch, { headers: { Authorization: 'Bearer review-token' } });

  const finalWrite = state.reviewWrites[state.reviewWrites.length - 1];
  const finalReceipt = finalWrite.field_data.system.tannerHandoff;
  const durableJob = state.handoffJobs.find(row => row.job_key === 'handoff_INH-20260801-SHEETFAIL01');
  assert(response.status === 500, 'package sheet write failure returns 500');
  assert(data.status === 'failed', 'package sheet write failure reports failed job');
  assert(finalReceipt.status === 'failed', 'package sheet write failure saves failed receipt');
  assert(finalReceipt.error.includes('sheet_batch_update_failed:500'), 'failed receipt records sheet write error');
  assert(finalReceipt.folderUrl === shellReceipt.folderUrl, 'failed package receipt preserves assessment folder link');
  assert(finalReceipt.photosFolderUrl === shellReceipt.photosFolderUrl, 'failed package receipt preserves photos folder link');
  assert(finalReceipt.trackerUrl === shellReceipt.trackerUrl, 'failed package receipt preserves tracker link');
  assert(!state.reviewWrites.some(write => write.field_data.system.tannerHandoff && write.field_data.system.tannerHandoff.status === 'ready'), 'package sheet write failure never saves ready receipt');
  assert(durableJob.status === 'failed', 'package sheet write failure saves failed durable job');
  assert(durableJob.receipt.status === 'failed', 'failed durable job stores failed receipt');
  assert(state.handoffArtifacts.some(row => row.artifact_key === 'assessment_folder'), 'failed package receipt still records known assessment folder artifact');
  assert(state.handoffArtifacts.some(row => row.artifact_key === 'photos_folder'), 'failed package receipt still records known photos folder artifact');
  assert(state.handoffArtifacts.some(row => row.artifact_key === 'tracker_row'), 'failed package receipt still records known tracker artifact');
  assert(durableJob.next_run_at, 'failed durable job schedules retry');
}

async function testHandoffJobStatusReadsDurableJob() {
  const receipt = {
    status: 'running',
    inspectionId: 'INH-20260801-DURABLE01',
    isTestTraining: false,
    folderId: 'drive-assessment',
    folderUrl: 'https://drive.google.com/drive/folders/drive-assessment',
    photosFolderId: 'drive-photos',
    photosFolderUrl: 'https://drive.google.com/drive/folders/drive-photos',
    spreadsheetId: 'drive-sheet',
    spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/drive-sheet/edit',
    rawJsonUrl: 'https://drive.google.com/file/d/raw/view',
    trackerRow: 9,
    trackerUrl: 'https://docs.google.com/spreadsheets/d/tracker-sheet/edit#range=A9',
    trackerStatus: 'In Progress',
    photoFolderPendingCount: 1,
    nextRunAt: '2026-08-01T15:40:00.000Z'
  };
  const { mockFetch } = makeMockFetch({
    reviewRow: {
      inspection_id: 'INH-20260801-DURABLE01',
      field_data: {
        system: {
          handoffJob: { jobId: 'old-review-mirror', status: 'failed', attemptCount: 99 }
        }
      },
      updated_at: '2026-08-01T15:00:00.000Z'
    },
    handoffJobs: [{
      id: 'job-durable01',
      job_key: 'handoff_INH-20260801-DURABLE01',
      inspection_id: 'INH-20260801-DURABLE01',
      status: 'running',
      attempt_count: 2,
      next_run_at: receipt.nextRunAt,
      requested_by: 'review-portal',
      requested_at: '2026-08-01T15:00:00.000Z',
      payload: {},
      receipt,
      updated_at: '2026-08-01T15:10:00.000Z'
    }]
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockFetch;
  try {
    const response = await worker.fetch(new Request('https://worker.test/handoff-jobs/INH-20260801-DURABLE01?token=review-token', {
      method: 'GET',
      headers: { Authorization: 'Bearer review-token' }
    }), baseEnv());
    const data = await response.json();
    assert(response.status === 200, 'handoff status returns 200');
    assert(data.job.durableJobId === 'job-durable01', 'handoff status reads durable job row');
    assert(data.job.attemptCount === 2, 'handoff status uses durable attempt count');
    assert(data.artifactReceipt.nextRunAt === receipt.nextRunAt, 'handoff status uses durable receipt');
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function testTrainingHandoffCreatesTestPackageOnly() {
  const { mockFetch, state } = makeMockFetch({
    reviewRow: {
      inspection_id: 'INH-TRAINING-HAND01',
      field_data: {
        clientName: 'Training Client',
        propertyAddress: '1 Practice Way, Basalt CO',
        inspectionDate: '2026-08-01',
        inspectionType: 'Test / Training',
        isTestTraining: true,
        system: {}
      },
      updated_at: '2026-08-01T15:00:00.000Z'
    },
    photoRows: []
  });
  const { response, data } = await callWorker('/handoff-jobs', {
    inspectionId: 'INH-TRAINING-HAND01',
    requestedBy: 'review-portal'
  }, baseEnv(), mockFetch, { headers: { Authorization: 'Bearer review-token' } });

  assert(response.status === 200, 'training handoff returns 200');
  assert(data.artifactReceipt.isTestTraining === true, 'training receipt is marked test/training');
  assert(data.artifactReceipt.trackerStatus === 'skipped_test_training', 'training receipt skips tracker');
  assert(state.driveCreates.some(file => file.name === '_Test Assessments'), 'creates or reuses test assessments folder');
  assert(state.driveCreates.some(file => String(file.name).startsWith('TEST – 2026-08-01')), 'creates test assessment folder');
  assert(state.trackerUpdates.length === 0, 'training handoff does not write tracker rows');
  assert(state.assessmentWrites.length === 0, 'training handoff does not write ihl_assessments');
  assert(state.handoffJobWrites[0].is_test === true, 'training handoff initial durable job is marked test/training');
  assert(state.handoffJobs.find(row => row.job_key === 'handoff_INH-TRAINING-HAND01').is_test === true, 'training handoff durable job is marked test/training');
}

async function testTrainingHandoffRepairsMissingRecoveryRoomsInOriginalShell() {
  const shellReceipt = {
    status: 'ready',
    shellStatus: 'ready',
    isTestTraining: true,
    inspectionId: 'INH-TRAINING-HAND02',
    folderId: 'drive-test-shell',
    folderUrl: 'https://drive.google.com/drive/folders/drive-test-shell',
    folderName: 'TEST - Original Client',
    photosFolderId: 'drive-test-photos',
    photosFolderUrl: 'https://drive.google.com/drive/folders/drive-test-photos',
    cocsFolderId: 'drive-test-cocs',
    cocsFolderUrl: 'https://drive.google.com/drive/folders/drive-test-cocs',
    backupFolderId: 'drive-test-backup',
    backupFolderUrl: 'https://drive.google.com/drive/folders/drive-test-backup',
    trackerStatus: 'skipped_test_training'
  };
  const incompleteReceipt = {
    status: 'ready',
    isTestTraining: true,
    folderId: 'drive-duplicate-shell',
    folderUrl: 'https://drive.google.com/drive/folders/drive-duplicate-shell',
    photosFolderId: 'drive-duplicate-photos',
    photosFolderUrl: 'https://drive.google.com/drive/folders/drive-duplicate-photos',
    cocsFolderId: 'drive-duplicate-cocs',
    cocsFolderUrl: 'https://drive.google.com/drive/folders/drive-duplicate-cocs',
    backupFolderId: 'drive-duplicate-backup',
    backupFolderUrl: 'https://drive.google.com/drive/folders/drive-duplicate-backup',
    spreadsheetId: 'drive-incomplete-sheet',
    spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/drive-incomplete-sheet/edit',
    rawJsonUrl: 'https://drive.google.com/file/d/drive-incomplete-raw/view',
    trackerStatus: 'skipped_test_training',
    rawReviewKeyCount: 10,
    formattedReviewRowCount: 4,
    photoLogCount: 0,
    roomDetailCount: 0
  };
  const { mockFetch, state } = makeMockFetch({
    reviewRow: {
      inspection_id: 'INH-TRAINING-HAND02',
      field_data: {
        clientName: 'Original Client Reviewed',
        propertyAddress: '2 Practice Way, Basalt CO',
        inspectionDate: '2026-08-01',
        inspectionType: 'Test / Training',
        isTestTraining: true,
        'bedroom-0': { inspectorNotes: 'Reviewed bedroom note.' },
        'bathroom-0': { noIssuesFound: true },
        system: {
          startInspectionShell: shellReceipt,
          tannerHandoff: incompleteReceipt,
          inspectionRecovery: {
            inspectionId: 'INH-TRAINING-HAND02',
            rooms: [
              { stepId: 'bedroom-0', roomName: 'Bedroom', notes: 'Source bedroom note.' },
              { stepId: 'bathroom-0', roomName: 'Bathroom' }
            ]
          }
        },
        reviewPortalData: incompleteReceipt
      },
      updated_at: '2026-08-01T15:00:00.000Z'
    },
    photoRows: []
  });
  const { response, data } = await callWorker('/handoff-jobs', {
    inspectionId: 'INH-TRAINING-HAND02',
    requestedBy: 'review-portal',
    reviewedData: { system: { reviewOnlyFlag: true } }
  }, baseEnv(), mockFetch, { headers: { Authorization: 'Bearer review-token' } });

  assert(response.status === 200, 'training recovery-room repair returns 200');
  assert(data.artifactReceipt.status === 'ready', 'repaired receipt is ready');
  assert(data.artifactReceipt.folderId === 'drive-test-shell', 'training handoff reuses the original start-shell folder');
  assert(data.artifactReceipt.sourceRoomCount === 2, 'receipt records two preserved source rooms');
  assert(data.artifactReceipt.roomDetailCount === 2, 'receipt records two Room Details rows');
  assert(data.artifactReceipt.staticArtifactsReused === false, 'incomplete static artifacts are rebuilt');
  assert(!state.driveCreates.some(file => file.name === '_Test Assessments'), 'repair does not create a second test root');
  assert(!state.driveCreates.some(file => String(file.name).startsWith('TEST – 2026-08-01')), 'repair does not create a second assessment folder');
  assert(hasSheetRowContaining(state, 'Room Details', ['Bedroom', 'Reviewed bedroom note.']), 'Room Details uses the reviewed bedroom note');
  assert(hasSheetRowContaining(state, 'Room Details', ['Bathroom', 'TRUE']), 'Room Details includes the no-issues review outcome');
}

async function testHandoffDoesNotDuplicateAlreadyCopiedPhoto() {
  const shellReceipt = {
    status: 'ready',
    inspectionId: 'INH-20260801-HAND03',
    assessmentNumber: '018',
    folderId: 'drive-assessment',
    folderUrl: 'https://drive.google.com/drive/folders/drive-assessment',
    photosFolderId: 'drive-photos',
    photosFolderUrl: 'https://drive.google.com/drive/folders/drive-photos',
    backupFolderId: 'drive-backup',
    backupFolderUrl: 'https://drive.google.com/drive/folders/drive-backup',
    trackerRow: 9,
    trackerUrl: 'https://docs.google.com/spreadsheets/d/tracker-sheet/edit#range=A9',
    trackerStatus: 'In Progress'
  };
  const copiedName = 'Kitchen - ATP Before - Before photo - photo-1.jpg';
  const { mockFetch, state } = makeMockFetch({
    existingDriveFiles: [
      { parentId: 'drive-photos', id: 'already-copied-photo', name: copiedName, mimeType: 'image/jpeg' }
    ],
    reviewRow: {
      inspection_id: 'INH-20260801-HAND03',
      field_data: {
        clientName: 'Alex Example',
        propertyAddress: '123 Main St, Basalt CO',
        inspectionDate: '2026-08-01',
        inspectorName: 'David Kline',
        system: { startInspectionShell: shellReceipt }
      },
      updated_at: '2026-08-01T15:00:00.000Z'
    },
    photoRows: [
      {
        photo_id: 'photo-1',
        inspection_id: 'INH-20260801-HAND03',
        room_name: 'Kitchen',
        step_name: 'ATP Before',
        caption: 'Before photo',
        slot: 1,
        storage_path: 'INH-20260801-HAND03/photo-1.jpg',
        drive_url: 'https://drive.google.com/file/d/already-copied-photo/view',
        created_at: '2026-08-01T15:10:00.000Z'
      }
    ]
  });
  const { response, data } = await callWorker('/handoff-jobs', {
    inspectionId: 'INH-20260801-HAND03',
    requestedBy: 'review-portal'
  }, baseEnv(), mockFetch, { headers: { Authorization: 'Bearer review-token' } });

  assert(response.status === 200, 'handoff with already copied photo returns 200');
  assert(data.artifactReceipt.photoFolderAlreadyPackagedCount === 1, 'existing copied photo counts as already packaged');
  assert(!state.driveCreates.some(file => file.name === copiedName && file.mimeType === 'application/vnd.google-apps.shortcut'), 'does not add shortcut next to already copied photo');
}

async function testHandoffWithRemainingPhotosStaysRunning() {
  const shellReceipt = {
    status: 'ready',
    inspectionId: 'INH-20260801-HAND04',
    assessmentNumber: '018',
    folderId: 'drive-assessment',
    folderUrl: 'https://drive.google.com/drive/folders/drive-assessment',
    photosFolderId: 'drive-photos',
    photosFolderUrl: 'https://drive.google.com/drive/folders/drive-photos',
    backupFolderId: 'drive-backup',
    backupFolderUrl: 'https://drive.google.com/drive/folders/drive-backup',
    trackerRow: 9,
    trackerUrl: 'https://docs.google.com/spreadsheets/d/tracker-sheet/edit#range=A9',
    trackerStatus: 'In Progress'
  };
  const { mockFetch, state } = makeMockFetch({
    reviewRow: {
      inspection_id: 'INH-20260801-HAND04',
      field_data: {
        clientName: 'Alex Example',
        propertyAddress: '123 Main St, Basalt CO',
        inspectionDate: '2026-08-01',
        inspectorName: 'David Kline',
        system: { startInspectionShell: shellReceipt }
      },
      updated_at: '2026-08-01T15:00:00.000Z'
    },
    photoRows: [
      {
        photo_id: 'photo-1',
        inspection_id: 'INH-20260801-HAND04',
        room_name: 'Kitchen',
        step_name: 'ATP Before',
        caption: 'Before photo',
        slot: 1,
        storage_path: 'INH-20260801-HAND04/photo-1.jpg',
        drive_url: '',
        created_at: '2026-08-01T15:10:00.000Z'
      },
      {
        photo_id: 'photo-2',
        inspection_id: 'INH-20260801-HAND04',
        room_name: 'Kitchen',
        step_name: 'ATP After',
        caption: 'After photo',
        slot: 2,
        storage_path: 'INH-20260801-HAND04/photo-2.jpg',
        drive_url: '',
        created_at: '2026-08-01T15:11:00.000Z'
      }
    ]
  });
  const { response, data } = await callWorker('/handoff-jobs', {
    inspectionId: 'INH-20260801-HAND04',
    requestedBy: 'review-portal',
    photoCopyLimit: 1
  }, baseEnv(), mockFetch, { headers: { Authorization: 'Bearer review-token' } });

  assert(response.status === 202, 'handoff with remaining photos returns 202');
  assert(data.status === 'running', 'handoff job stays running while photos remain');
  assert(data.artifactReceipt.status === 'running', 'receipt stays running while photos remain');
  assert(data.artifactReceipt.photoFolderCopiedCount === 1, 'copies one photo within limit');
  assert(data.artifactReceipt.photoFolderPendingCount === 1, 'tracks remaining photo as pending');
  assert(data.artifactReceipt.photoFolderOperationLimit === 1, 'receipt records per-run operation limit');
  assert(data.artifactReceipt.photoFolderOperationCount === 1, 'receipt records operations performed this run');
  assert(state.photoUpdates.length === 1, 'updates drive URL for copied photo');
  assert(state.handoffJobs.find(row => row.job_key === 'handoff_INH-20260801-HAND04').status === 'running', 'durable job stays running while photos remain');
  assert(state.handoffArtifacts.find(row => row.artifact_key === 'photos_folder').status === 'running', 'pending photo artifact stays running');
}

async function testHandoffHandlesLargePhotoBatchWithoutFalseCompletion() {
  const shellReceipt = {
    status: 'ready',
    inspectionId: 'INH-20260801-BIGPHOTO01',
    assessmentNumber: '018',
    folderId: 'drive-assessment',
    folderUrl: 'https://drive.google.com/drive/folders/drive-assessment',
    photosFolderId: 'drive-photos',
    photosFolderUrl: 'https://drive.google.com/drive/folders/drive-photos',
    backupFolderId: 'drive-backup',
    backupFolderUrl: 'https://drive.google.com/drive/folders/drive-backup',
    trackerRow: 9,
    trackerUrl: 'https://docs.google.com/spreadsheets/d/tracker-sheet/edit#range=A9',
    trackerStatus: 'In Progress'
  };
  const photoRows = Array.from({ length: 105 }, (_, index) => {
    const photoNumber = index + 1;
    return {
      photo_id: `photo-${photoNumber}`,
      inspection_id: 'INH-20260801-BIGPHOTO01',
      room_name: photoNumber % 2 ? 'Kitchen' : 'Mechanical Room',
      step_name: photoNumber % 2 ? 'ATP Before' : 'HVAC',
      caption: `High-res evidence ${photoNumber}`,
      slot: photoNumber,
      storage_path: `INH-20260801-BIGPHOTO01/photo-${photoNumber}.jpg`,
      drive_url: '',
      created_at: `2026-08-01T15:${String(photoNumber % 60).padStart(2, '0')}:00.000Z`
    };
  });
  const { mockFetch, state } = makeMockFetch({
    reviewRow: {
      inspection_id: 'INH-20260801-BIGPHOTO01',
      field_data: {
        clientName: 'Alex Example',
        propertyAddress: '123 Main St, Basalt CO',
        inspectionDate: '2026-08-01',
        inspectorName: 'David Kline',
        system: { startInspectionShell: shellReceipt }
      },
      updated_at: '2026-08-01T15:00:00.000Z'
    },
    photoRows
  });
  const { response, data } = await callWorker('/handoff-jobs', {
    inspectionId: 'INH-20260801-BIGPHOTO01',
    requestedBy: 'review-portal',
    photoCopyLimit: 100
  }, baseEnv(), mockFetch, { headers: { Authorization: 'Bearer review-token' } });

  assert(response.status === 202, 'large photo handoff returns 202 while batch remains');
  assert(data.status === 'running', 'large photo handoff stays running instead of falsely completing');
  assert(data.artifactReceipt.photoFolderCopiedCount === 100, 'large photo handoff copies exactly the operation cap');
  assert(data.artifactReceipt.photoFolderPendingCount === 5, 'large photo handoff records remaining high-res photos as pending');
  assert(data.artifactReceipt.photoFolderOperationLimit === 100, 'large photo handoff records high-volume operation limit');
  assert(data.artifactReceipt.photoFolderOperationCount === 100, 'large photo handoff records high-volume operation count');
  const imageUploads = state.rawUploads.filter(upload => /\bContent-Type:\s*image\/jpeg\b/i.test(upload.bodyText || ''));
  assert(imageUploads.length === 100, 'large photo handoff uploads 100 high-res originals to Drive');
  assert(state.photoUpdates.length === 100, 'large photo handoff writes Drive URLs for copied originals');
  assert(state.handoffJobs.find(row => row.job_key === 'handoff_INH-20260801-BIGPHOTO01').status === 'running', 'large photo durable job stays running');
  assert(state.handoffArtifacts.find(row => row.artifact_key === 'photos_folder').status === 'running', 'large photo artifact stays running');
}

async function testHandoffPhotoCopyFailureSavesFailedArtifact() {
  const shellReceipt = {
    status: 'ready',
    inspectionId: 'INH-20260801-PHOTOFAIL01',
    assessmentNumber: '018',
    folderId: 'drive-assessment',
    folderUrl: 'https://drive.google.com/drive/folders/drive-assessment',
    photosFolderId: 'drive-photos',
    photosFolderUrl: 'https://drive.google.com/drive/folders/drive-photos',
    backupFolderId: 'drive-backup',
    backupFolderUrl: 'https://drive.google.com/drive/folders/drive-backup',
    trackerRow: 9,
    trackerUrl: 'https://docs.google.com/spreadsheets/d/tracker-sheet/edit#range=A9',
    trackerStatus: 'In Progress'
  };
  const { mockFetch, state } = makeMockFetch({
    failPhotoDriveUpload: true,
    reviewRow: {
      inspection_id: 'INH-20260801-PHOTOFAIL01',
      field_data: {
        clientName: 'Alex Example',
        propertyAddress: '123 Main St, Basalt CO',
        inspectionDate: '2026-08-01',
        inspectorName: 'David Kline',
        system: { startInspectionShell: shellReceipt }
      },
      updated_at: '2026-08-01T15:00:00.000Z'
    },
    photoRows: [
      {
        photo_id: 'photo-1',
        inspection_id: 'INH-20260801-PHOTOFAIL01',
        room_name: 'Kitchen',
        step_name: 'ATP Before',
        caption: 'Before photo',
        slot: 1,
        storage_path: 'INH-20260801-PHOTOFAIL01/photo-1.jpg',
        drive_url: '',
        created_at: '2026-08-01T15:10:00.000Z'
      }
    ]
  });
  const { response, data } = await callWorker('/handoff-jobs', {
    inspectionId: 'INH-20260801-PHOTOFAIL01',
    requestedBy: 'review-portal'
  }, baseEnv(), mockFetch, { headers: { Authorization: 'Bearer review-token' } });

  const durableJob = state.handoffJobs.find(row => row.job_key === 'handoff_INH-20260801-PHOTOFAIL01');
  const photoArtifact = state.handoffArtifacts.find(row => row.artifact_key === 'photos_folder');
  assert(response.status === 500, 'photo copy failure returns 500');
  assert(data.status === 'failed', 'photo copy failure reports failed job');
  assert(data.artifactReceipt.photoFolderFailedCount === 1, 'photo copy failure increments failed count');
  assert(data.artifactReceipt.error.includes('drive_upload_failed:500'), 'photo copy failure records Drive upload error');
  assert(durableJob.status === 'failed', 'photo copy failure saves failed durable job');
  assert(photoArtifact.status === 'failed', 'failed photo artifact is failed');
  assert(photoArtifact.metadata.failed === 1, 'failed photo artifact records failed count');
  assert(state.photoUpdates.length === 0, 'failed photo upload does not write a Drive URL');
}

async function testBackgroundHandoffQueuesWaitUntil() {
  const shellReceipt = {
    status: 'ready',
    inspectionId: 'INH-20260801-BG01',
    assessmentNumber: '018',
    folderId: 'drive-assessment',
    folderUrl: 'https://drive.google.com/drive/folders/drive-assessment',
    photosFolderId: 'drive-photos',
    photosFolderUrl: 'https://drive.google.com/drive/folders/drive-photos',
    backupFolderId: 'drive-backup',
    backupFolderUrl: 'https://drive.google.com/drive/folders/drive-backup',
    trackerRow: 9,
    trackerUrl: 'https://docs.google.com/spreadsheets/d/tracker-sheet/edit#range=A9',
    trackerStatus: 'In Progress'
  };
  const waitUntilPromises = [];
  const ctx = { waitUntil(promise) { waitUntilPromises.push(promise); } };
  const { mockFetch, state } = makeMockFetch({
    reviewRow: {
      inspection_id: 'INH-20260801-BG01',
      field_data: {
        clientName: 'Alex Example',
        propertyAddress: '123 Main St, Basalt CO',
        inspectionDate: '2026-08-01',
        inspectorName: 'David Kline',
        system: { startInspectionShell: shellReceipt }
      },
      updated_at: '2026-08-01T15:00:00.000Z'
    },
    photoRows: []
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockFetch;
  let response;
  let data;
  try {
    const request = new Request('https://worker.test/handoff-jobs', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer review-token'
      },
      body: JSON.stringify({
        inspectionId: 'INH-20260801-BG01',
        requestedBy: 'review-portal-submit',
        background: true
      })
    });
    response = await worker.fetch(request, baseEnv(), ctx);
    data = await response.json();
    assert(response.status === 202, 'background handoff returns 202');
    assert(data.status === 'queued', 'background handoff is queued');
    assert(waitUntilPromises.length === 0, 'queued handoff does not risk long work in waitUntil');
  } finally {
    globalThis.fetch = originalFetch;
  }

  const run = await callWorker('/handoff-jobs/run', {
    inspectionId: 'INH-20260801-BG01',
    token: 'review-token'
  }, baseEnv(), mockFetch, { headers: { Authorization: 'Bearer review-token' } });
  assert(run.response.status === 200, 'runner completes a queued background handoff');
  assert(state.reviewRow.field_data.system.tannerHandoff.status === 'ready', 'runner writes ready handoff receipt');
  assert(state.handoffJobs.find(row => row.job_key === 'handoff_INH-20260801-BG01').status === 'ready', 'runner writes ready durable job');
}

async function testManualRunnerProcessesDueJobAndReusesStaticArtifacts() {
  const shellReceipt = {
    status: 'ready',
    inspectionId: 'INH-20260801-RUN01',
    assessmentNumber: '018',
    folderId: 'drive-assessment',
    folderUrl: 'https://drive.google.com/drive/folders/drive-assessment',
    photosFolderId: 'drive-photos',
    photosFolderUrl: 'https://drive.google.com/drive/folders/drive-photos',
    backupFolderId: 'drive-backup',
    backupFolderUrl: 'https://drive.google.com/drive/folders/drive-backup',
    trackerRow: 9,
    trackerUrl: 'https://docs.google.com/spreadsheets/d/tracker-sheet/edit#range=A9',
    trackerStatus: 'In Progress'
  };
  const runningReceipt = {
    status: 'running',
    inspectionId: 'INH-20260801-RUN01',
    isTestTraining: false,
    folderId: 'drive-assessment',
    folderUrl: 'https://drive.google.com/drive/folders/drive-assessment',
    photosFolderId: 'drive-photos',
    photosFolderUrl: 'https://drive.google.com/drive/folders/drive-photos',
    spreadsheetId: 'drive-sheet',
    spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/drive-sheet/edit',
    inspectionSpreadsheetId: 'drive-inspection-sheet',
    inspectionSpreadsheetUrl: 'https://docs.google.com/spreadsheets/d/drive-inspection-sheet/edit',
    contextFileId: 'drive-context',
    contextFileUrl: 'https://drive.google.com/file/d/drive-context/view',
    rawAppKeyCount: 10,
    rawJsonUrl: 'https://drive.google.com/file/d/raw/view',
    trackerRow: 9,
    trackerUrl: 'https://docs.google.com/spreadsheets/d/tracker-sheet/edit#range=A9',
    trackerStatus: 'In Progress',
    photoFolderPendingCount: 1,
    photoFolderFailedCount: 0,
    sourcePhotoCount: 1,
    photoDriveUrlCount: 1,
    photoLogCount: 1,
    rawReviewKeyCount: 6,
    formattedReviewRowCount: 4,
    appRoomDetailCount: 0
  };
  const { mockFetch, state } = makeMockFetch({
    reviewRow: {
      inspection_id: 'INH-20260801-RUN01',
      field_data: {
        clientName: 'Alex Example',
        propertyAddress: '123 Main St, Basalt CO',
        inspectionDate: '2026-08-01',
        inspectorName: 'David Kline',
        system: {
          startInspectionShell: shellReceipt,
          handoffJob: { jobId: 'handoff_INH-20260801-RUN01', status: 'running', attemptCount: 1 },
          tannerHandoff: runningReceipt
        },
        reviewPortalData: runningReceipt
      },
      updated_at: '2026-08-01T15:00:00.000Z'
    },
    photoRows: [
      {
        photo_id: 'photo-1',
        inspection_id: 'INH-20260801-RUN01',
        room_name: 'Kitchen',
        step_name: 'ATP Before',
        caption: 'Before photo',
        slot: 1,
        storage_path: 'INH-20260801-RUN01/photo-1.jpg',
        drive_url: 'https://drive.google.com/file/d/drive-photo-1/view',
        created_at: '2026-08-01T15:10:00.000Z'
      }
    ]
  });
  const { response, data } = await callWorker('/handoff-jobs/run', {
    inspectionId: 'INH-20260801-RUN01',
    token: 'review-token'
  }, baseEnv(), mockFetch, { headers: { Authorization: 'Bearer review-token' } });

  assert(response.status === 200, 'manual runner returns 200 when ready');
  assert(data.processed === 1, 'manual runner processes one job');
  assert(data.results[0].status === 'ready', 'manual runner result is ready');
  assert(
    state.reviewRow.field_data.system.tannerHandoff.staticArtifactsReused === true,
    `manual runner reuses static artifacts: ${JSON.stringify(state.reviewRow.field_data.system.tannerHandoff)}`
  );
  assert(state.sheetValueWrites.length === 0, 'manual runner does not rewrite spreadsheet tabs when artifacts are reused');
  assert(state.rawUploads.length === 0, 'manual runner does not rewrite raw backup when artifacts are reused');
}

async function testScheduledRunnerProcessesPendingJob() {
  const shellReceipt = {
    status: 'ready',
    inspectionId: 'INH-20260801-SCHED01',
    assessmentNumber: '018',
    folderId: 'drive-assessment',
    folderUrl: 'https://drive.google.com/drive/folders/drive-assessment',
    photosFolderId: 'drive-photos',
    photosFolderUrl: 'https://drive.google.com/drive/folders/drive-photos',
    backupFolderId: 'drive-backup',
    backupFolderUrl: 'https://drive.google.com/drive/folders/drive-backup',
    trackerRow: 9,
    trackerUrl: 'https://docs.google.com/spreadsheets/d/tracker-sheet/edit#range=A9',
    trackerStatus: 'In Progress'
  };
  const runningReceipt = {
    status: 'running',
    inspectionId: 'INH-20260801-SCHED01',
    isTestTraining: false,
    folderId: 'drive-assessment',
    folderUrl: 'https://drive.google.com/drive/folders/drive-assessment',
    photosFolderId: 'drive-photos',
    photosFolderUrl: 'https://drive.google.com/drive/folders/drive-photos',
    spreadsheetId: 'drive-sheet',
    spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/drive-sheet/edit',
    rawJsonUrl: 'https://drive.google.com/file/d/raw/view',
    trackerRow: 9,
    trackerUrl: 'https://docs.google.com/spreadsheets/d/tracker-sheet/edit#range=A9',
    trackerStatus: 'In Progress',
    photoFolderPendingCount: 1
  };
  const waitUntilPromises = [];
  const ctx = { waitUntil(promise) { waitUntilPromises.push(promise); } };
  const { mockFetch, state } = makeMockFetch({
    reviewRow: {
      inspection_id: 'INH-20260801-SCHED01',
      field_data: {
        clientName: 'Alex Example',
        propertyAddress: '123 Main St, Basalt CO',
        inspectionDate: '2026-08-01',
        inspectorName: 'David Kline',
        system: {
          startInspectionShell: shellReceipt,
          handoffJob: { jobId: 'handoff_INH-20260801-SCHED01', status: 'running', attemptCount: 1 },
          tannerHandoff: runningReceipt
        },
        reviewPortalData: runningReceipt
      },
      updated_at: '2026-08-01T15:00:00.000Z'
    },
    handoffJobs: [{
      id: 'job-sched01',
      job_key: 'handoff_INH-20260801-SCHED01',
      inspection_id: 'INH-20260801-SCHED01',
      status: 'running',
      attempt_count: 1,
      next_run_at: '',
      requested_by: 'review-portal',
      requested_at: '2026-08-01T15:00:00.000Z',
      payload: {},
      receipt: runningReceipt,
      updated_at: '2026-08-01T15:00:00.000Z'
    }],
    photoRows: [
      {
        photo_id: 'photo-1',
        inspection_id: 'INH-20260801-SCHED01',
        room_name: 'Kitchen',
        step_name: 'ATP Before',
        caption: 'Before photo',
        slot: 1,
        storage_path: 'INH-20260801-SCHED01/photo-1.jpg',
        drive_url: 'https://drive.google.com/file/d/drive-photo-1/view',
        created_at: '2026-08-01T15:10:00.000Z'
      }
    ]
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockFetch;
  try {
    await worker.scheduled({ scheduledTime: Date.now() }, baseEnv(), ctx);
    assert(waitUntilPromises.length === 1, 'scheduled runner registers waitUntil work');
    await Promise.all(waitUntilPromises);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert(state.reviewRow.field_data.system.tannerHandoff.status === 'ready', 'scheduled runner advances pending handoff');
  assert(state.handoffJobs.find(row => row.job_key === 'handoff_INH-20260801-SCHED01').status === 'ready', 'scheduled runner updates durable job');
  assert(state.handoffJobClaims.length === 1, 'scheduled runner claims due durable jobs');
  assert(state.handoffJobClaims[0].rows.includes('handoff_INH-20260801-SCHED01'), 'scheduled runner claim includes pending job');
  assert(!state.handoffJobs.find(row => row.job_key === 'handoff_INH-20260801-SCHED01').locked_at, 'scheduled runner releases durable job lock after save');
}

async function testInspectionStatusIncludesHandoffReceipt() {
  const handoffReceipt = {
    status: 'ready',
    inspectionId: 'INH-20260801-STAT01',
    isTestTraining: false,
    folderId: 'drive-assessment',
    folderUrl: 'https://drive.google.com/drive/folders/drive-assessment',
    photosFolderId: 'drive-photos',
    photosFolderUrl: 'https://drive.google.com/drive/folders/drive-photos',
    spreadsheetId: 'drive-sheet',
    spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/drive-sheet/edit',
    inspectionSpreadsheetId: 'drive-inspection-sheet',
    inspectionSpreadsheetUrl: 'https://docs.google.com/spreadsheets/d/drive-inspection-sheet/edit',
    contextFileId: 'drive-context',
    contextFileUrl: 'https://drive.google.com/file/d/drive-context/view',
    rawAppKeyCount: 10,
    rawJsonUrl: 'https://drive.google.com/file/d/raw/view',
    trackerRow: 9,
    trackerUrl: 'https://docs.google.com/spreadsheets/d/tracker-sheet/edit#range=A9',
    trackerStatus: 'In Progress',
    photoFolderFailedCount: 0,
    photoFolderPendingCount: 0,
    attemptCount: 2,
    lastRunAt: '2026-08-01T15:20:00.000Z',
    nextRunAt: '',
    updatedAt: '2026-08-01T15:30:00.000Z'
  };
  const { mockFetch } = makeMockFetch({
    assessmentRows: [
      { inspection_id: 'INH-20260801-STAT01' }
    ],
    storedPhotoNames: ['photo-1.jpg'],
    reviewRow: {
      inspection_id: 'INH-20260801-STAT01',
      field_data: {
        system: { tannerHandoff: handoffReceipt }
      },
      updated_at: '2026-08-01T15:30:00.000Z'
    },
    photoRows: [
      {
        photo_id: 'photo-1',
        inspection_id: 'INH-20260801-STAT01',
        storage_path: 'INH-20260801-STAT01/photo-1.jpg',
        drive_url: 'https://drive.google.com/file/d/drive-photo-1/view'
      }
    ]
  });
  const { response, data } = await callWorker('/inspection-status', {
    sharedSecret: 'upload-secret',
    inspectionId: 'INH-20260801-STAT01',
    expectedPhotoIds: ['photo-1']
  }, baseEnv(), mockFetch);

  assert(response.status === 200, 'inspection status returns 200');
  assert(data.complete === true, 'inspection status reports source photo storage complete');
  assert(data.reviewPortalReady === true, 'inspection status reports review photo mirror ready');
  assert(data.handoff && data.handoff.ready === true, 'inspection status includes ready handoff receipt');
  assert(data.handoff.folderUrl === handoffReceipt.folderUrl, 'inspection status includes handoff folder URL');
  assert(data.handoff.spreadsheetUrl === handoffReceipt.spreadsheetUrl, 'inspection status includes handoff sheet URL');
  assert(data.handoff.trackerUrl === handoffReceipt.trackerUrl, 'inspection status includes handoff tracker URL');
  assert(data.handoff.rawReviewDataUrl === handoffReceipt.rawJsonUrl, 'inspection status includes handoff raw backup URL');
  assert(data.handoff.attemptCount === handoffReceipt.attemptCount, 'inspection status includes handoff attempt count');
  assert(data.handoff.lastRunAt === handoffReceipt.lastRunAt, 'inspection status includes handoff last run time');
  assert(data.handoff.nextRunAt === handoffReceipt.nextRunAt, 'inspection status includes handoff next run time');
}

async function testRunnerFailureSchedulesBackoff() {
  const { mockFetch, state } = makeMockFetch({
    failGoogleToken: true,
    reviewRow: {
      inspection_id: 'INH-20260801-FAIL01',
      field_data: {
        clientName: 'Alex Example',
        propertyAddress: '123 Main St, Basalt CO',
        inspectionDate: '2026-08-01',
        inspectionType: 'Real Assessment',
        system: {
          handoffJob: {
            jobId: 'handoff_INH-20260801-FAIL01',
            status: 'running',
            attemptCount: 2
          }
        }
      },
      updated_at: '2026-08-01T15:00:00.000Z'
    },
    photoRows: []
  });
  const { response, data } = await callWorker('/handoff-jobs/run', {
    inspectionId: 'INH-20260801-FAIL01',
    token: 'review-token'
  }, baseEnv(), mockFetch, { headers: { Authorization: 'Bearer review-token' } });

  const job = state.reviewRow.field_data.system.handoffJob;
  const receipt = state.reviewRow.field_data.system.tannerHandoff;
  assert(response.status === 500, 'failed manual runner returns 500');
  assert(data.results[0].status === 'failed', 'failed runner reports failed status');
  assert(job.status === 'failed', 'failed runner saves failed job state');
  assert(job.attemptCount === 3, 'failed runner increments attempt count');
  assert(job.nextRunAt && Date.parse(job.nextRunAt) > Date.parse(job.lastRunAt), 'failed runner schedules next retry');
  assert(receipt.attemptCount === job.attemptCount, 'failed receipt carries attempt count');
  assert(receipt.lastRunAt === job.lastRunAt, 'failed receipt carries last run time');
  assert(receipt.nextRunAt === job.nextRunAt, 'failed receipt carries next retry time');
  assert(state.reviewRow.field_data.handoffAttemptCount === job.attemptCount, 'failed runner saves attempt count on field data');
  assert(state.reviewRow.field_data.handoffNextRunAt === job.nextRunAt, 'failed runner saves next retry time on field data');
  const durableJob = state.handoffJobs.find(row => row.job_key === 'handoff_INH-20260801-FAIL01');
  assert(durableJob.status === 'failed', 'failed runner saves failed durable job');
  assert(durableJob.next_run_at === job.nextRunAt, 'failed durable job carries next retry time');
}

async function testDueRunnerSkipsFutureBackoff() {
  const future = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  const runningReceipt = {
    status: 'running',
    inspectionId: 'INH-20260801-FUTURE01',
    folderId: 'drive-assessment',
    folderUrl: 'https://drive.google.com/drive/folders/drive-assessment',
    photosFolderId: 'drive-photos',
    photosFolderUrl: 'https://drive.google.com/drive/folders/drive-photos',
    spreadsheetId: 'drive-sheet',
    spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/drive-sheet/edit',
    rawJsonUrl: 'https://drive.google.com/file/d/raw/view',
    trackerRow: 9,
    trackerUrl: 'https://docs.google.com/spreadsheets/d/tracker-sheet/edit#range=A9',
    trackerStatus: 'In Progress',
    photoFolderPendingCount: 1,
    nextRunAt: future
  };
  const { mockFetch, state } = makeMockFetch({
    reviewRow: {
      inspection_id: 'INH-20260801-FUTURE01',
      field_data: {
        system: {
          handoffJob: {
            jobId: 'handoff_INH-20260801-FUTURE01',
            status: 'running',
            attemptCount: 4,
            nextRunAt: future
          },
          tannerHandoff: runningReceipt
        },
        reviewPortalData: runningReceipt
      },
      updated_at: '2026-08-01T15:00:00.000Z'
    },
    handoffJobs: [{
      id: 'job-future01',
      job_key: 'handoff_INH-20260801-FUTURE01',
      inspection_id: 'INH-20260801-FUTURE01',
      status: 'running',
      attempt_count: 4,
      next_run_at: future,
      requested_by: 'review-portal',
      requested_at: '2026-08-01T15:00:00.000Z',
      payload: {},
      receipt: runningReceipt,
      updated_at: '2026-08-01T15:00:00.000Z'
    }],
    photoRows: []
  });
  const { response, data } = await callWorker('/handoff-jobs/run', {
    token: 'review-token',
    limit: 5
  }, baseEnv(), mockFetch, { headers: { Authorization: 'Bearer review-token' } });

  assert(response.status === 200, 'due runner returns 200 when nothing is due');
  assert(data.processed === 0, 'due runner skips jobs with future nextRunAt');
  assert(state.handoffJobClaims.length === 1, 'due runner still uses durable claim path');
  assert(state.handoffJobClaims[0].rows.length === 0, 'future backoff job is not claimed');
  assert(state.reviewWrites.length === 0, 'future backoff skip does not rewrite review storage');
  assert(state.driveCreates.length === 0, 'future backoff skip does not touch Drive');
}

async function testDueRunnerSkipsActivelyLockedJob() {
  const lockedAt = new Date().toISOString();
  const runningReceipt = {
    status: 'running',
    inspectionId: 'INH-20260801-LOCK01',
    folderId: 'drive-assessment',
    folderUrl: 'https://drive.google.com/drive/folders/drive-assessment',
    photosFolderId: 'drive-photos',
    photosFolderUrl: 'https://drive.google.com/drive/folders/drive-photos',
    spreadsheetId: 'drive-sheet',
    spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/drive-sheet/edit',
    rawJsonUrl: 'https://drive.google.com/file/d/raw/view',
    trackerRow: 9,
    trackerUrl: 'https://docs.google.com/spreadsheets/d/tracker-sheet/edit#range=A9',
    trackerStatus: 'In Progress',
    photoFolderPendingCount: 1
  };
  const { mockFetch, state } = makeMockFetch({
    reviewRow: {
      inspection_id: 'INH-20260801-LOCK01',
      field_data: {
        system: {
          handoffJob: {
            jobId: 'handoff_INH-20260801-LOCK01',
            status: 'running',
            attemptCount: 2
          },
          tannerHandoff: runningReceipt
        },
        reviewPortalData: runningReceipt
      },
      updated_at: '2026-08-01T15:00:00.000Z'
    },
    handoffJobs: [{
      id: 'job-lock01',
      job_key: 'handoff_INH-20260801-LOCK01',
      inspection_id: 'INH-20260801-LOCK01',
      status: 'running',
      attempt_count: 2,
      next_run_at: '',
      locked_at: lockedAt,
      locked_by: 'handoff-w8',
      requested_by: 'review-portal',
      requested_at: '2026-08-01T15:00:00.000Z',
      payload: {},
      receipt: runningReceipt,
      updated_at: '2026-08-01T15:00:00.000Z'
    }],
    photoRows: []
  });
  const { response, data } = await callWorker('/handoff-jobs/run', {
    token: 'review-token',
    limit: 5
  }, baseEnv(), mockFetch, { headers: { Authorization: 'Bearer review-token' } });

  assert(response.status === 200, 'due runner returns 200 when locked job is skipped');
  assert(data.processed === 0, 'due runner skips actively locked job');
  assert(state.handoffJobClaims.length === 1, 'locked skip still uses durable claim path');
  assert(state.handoffJobClaims[0].rows.length === 0, 'actively locked job is not claimed');
  assert(state.reviewWrites.length === 0, 'locked skip does not rewrite review storage');
  assert(state.driveCreates.length === 0, 'locked skip does not touch Drive');
}

async function testDueRunnerRetriesFailedAfterBackoff() {
  const past = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const failedReceipt = {
    status: 'failed',
    inspectionId: 'INH-TRAINING-RETRY01',
    isTestTraining: true,
    trackerStatus: 'skipped_test_training',
    error: 'forced earlier failure',
    nextRunAt: past
  };
  const { mockFetch, state } = makeMockFetch({
    reviewRow: {
      inspection_id: 'INH-TRAINING-RETRY01',
      field_data: {
        clientName: 'Training Retry',
        propertyAddress: '9 Retry Way, Basalt CO',
        inspectionDate: '2026-08-01',
        inspectionType: 'Test / Training',
        isTestTraining: true,
        system: {
          handoffJob: {
            jobId: 'handoff_INH-TRAINING-RETRY01',
            status: 'failed',
            attemptCount: 2,
            nextRunAt: past
          },
          tannerHandoff: failedReceipt
        },
        reviewPortalData: failedReceipt
      },
      updated_at: '2026-08-01T15:00:00.000Z'
    },
    handoffJobs: [{
      id: 'job-retry01',
      job_key: 'handoff_INH-TRAINING-RETRY01',
      inspection_id: 'INH-TRAINING-RETRY01',
      is_test: true,
      status: 'failed',
      attempt_count: 2,
      next_run_at: past,
      requested_by: 'review-portal',
      requested_at: '2026-08-01T15:00:00.000Z',
      payload: {},
      receipt: failedReceipt,
      updated_at: '2026-08-01T15:00:00.000Z'
    }],
    photoRows: []
  });
  const { response, data } = await callWorker('/handoff-jobs/run', {
    token: 'review-token',
    limit: 5
  }, baseEnv(), mockFetch, { headers: { Authorization: 'Bearer review-token' } });

  const job = state.reviewRow.field_data.system.handoffJob;
  const receipt = state.reviewRow.field_data.system.tannerHandoff;
  assert(response.status === 200, 'due runner retry returns 200 after repair');
  assert(data.processed === 1, 'due runner processes failed job after backoff');
  assert(data.results[0].status === 'ready', 'due runner retry repairs failed job');
  assert(job.attemptCount === 3, 'due runner retry increments attempt count');
  assert(receipt.status === 'ready', 'due runner retry saves ready receipt');
  assert(receipt.trackerStatus === 'skipped_test_training', 'due runner retry keeps test/training tracker skip');
  assert(state.handoffJobClaims[0].rows.includes('handoff_INH-TRAINING-RETRY01'), 'due runner retry claims failed durable job');
  assert(state.handoffJobs.find(row => row.job_key === 'handoff_INH-TRAINING-RETRY01').status === 'ready', 'due runner retry updates durable job');
}

async function testDirectDuplicateHandoffReturnsInFlightWithoutDuplicateWork() {
  const lockedAt = new Date().toISOString();
  const runningReceipt = {
    status: 'running',
    inspectionId: 'INH-TRAINING-DUPLICATE01',
    isTestTraining: true,
    trackerStatus: 'skipped_test_training',
    photoFolderPendingCount: 80
  };
  const { mockFetch, state } = makeMockFetch({
    reviewRow: {
      inspection_id: 'INH-TRAINING-DUPLICATE01',
      field_data: {
        clientName: 'Duplicate Submit Test',
        inspectionType: 'Test / Training',
        isTestTraining: true,
        system: {
          handoffJob: {
            jobId: 'handoff_INH-TRAINING-DUPLICATE01',
            status: 'running',
            attemptCount: 1,
            lockedAt,
            lockedBy: 'handoff-w13:first-request'
          }
        }
      },
      updated_at: lockedAt
    },
    handoffJobs: [{
      id: 'job-duplicate01',
      job_key: 'handoff_INH-TRAINING-DUPLICATE01',
      inspection_id: 'INH-TRAINING-DUPLICATE01',
      is_test: true,
      status: 'running',
      attempt_count: 1,
      locked_at: lockedAt,
      locked_by: 'handoff-w13:first-request',
      requested_by: 'review-portal',
      requested_at: lockedAt,
      payload: {},
      receipt: runningReceipt,
      updated_at: lockedAt
    }],
    photoRows: []
  });
  const { response, data } = await callWorker('/handoff-jobs', {
    inspectionId: 'INH-TRAINING-DUPLICATE01',
    requestedBy: 'second-device'
  }, baseEnv(), mockFetch, { headers: { Authorization: 'Bearer review-token' } });

  assert(response.status === 202, 'duplicate direct handoff returns accepted while first request runs');
  assert(data.inFlight === true, 'duplicate direct handoff is marked in flight');
  assert(data.artifactReceipt.photoFolderPendingCount === 80, 'duplicate response returns current receipt');
  assert(state.driveCreates.length === 0, 'duplicate direct handoff does not create Drive artifacts');
  assert(state.sheetValueWrites.length === 0, 'duplicate direct handoff does not write spreadsheets');
  assert(state.reviewWrites.length === 0, 'duplicate direct handoff does not overwrite review state');
}

async function testProductionHandoffQueuesBeforeRunnerBuildsPackage() {
  const shellReceipt = {
    status: 'ready',
    shellStatus: 'ready',
    isTestTraining: true,
    inspectionId: 'INH-TRAINING-QUEUE01',
    folderId: 'drive-queue-shell',
    folderUrl: 'https://drive.google.com/drive/folders/drive-queue-shell',
    photosFolderId: 'drive-queue-photos',
    photosFolderUrl: 'https://drive.google.com/drive/folders/drive-queue-photos',
    cocsFolderId: 'drive-queue-cocs',
    cocsFolderUrl: 'https://drive.google.com/drive/folders/drive-queue-cocs',
    backupFolderId: 'drive-queue-backup',
    backupFolderUrl: 'https://drive.google.com/drive/folders/drive-queue-backup',
    trackerStatus: 'skipped_test_training'
  };
  const { mockFetch, state } = makeMockFetch({
    reviewRow: {
      inspection_id: 'INH-TRAINING-QUEUE01',
      field_data: {
        clientName: 'Queued Package Test',
        propertyAddress: '14 Queue Way, Basalt CO',
        inspectionDate: '2026-08-01',
        inspectionType: 'Test / Training',
        isTestTraining: true,
        rooms: [{ stepId: 'bedroom-0', roomName: 'Bedroom', notes: 'Queued runner note.' }],
        system: { startInspectionShell: shellReceipt }
      },
      updated_at: '2026-08-01T15:00:00.000Z'
    },
    photoRows: []
  });
  const queued = await callWorker('/handoff-jobs', {
    inspectionId: 'INH-TRAINING-QUEUE01',
    requestedBy: 'review-portal',
    runInline: false,
    reviewedData: {
      rooms: [
        { stepId: 'bedroom-0', roomName: 'Bedroom', notes: 'Current portal bedroom note.' },
        { stepId: 'office-0', roomName: 'Office', notes: 'Current portal office note.' }
      ]
    }
  }, baseEnv(), mockFetch, { headers: { Authorization: 'Bearer review-token' } });

  assert(queued.response.status === 202, 'production handoff submit returns queued');
  assert(queued.data.queued === true, 'production handoff response is marked queued');
  assert(state.driveCreates.length === 0, 'queue request does not build Drive artifacts inline');
  assert(!state.handoffJobs[0].locked_at, 'queued job is left unlocked for the runner');

  const run = await callWorker('/handoff-jobs/run', {
    inspectionId: 'INH-TRAINING-QUEUE01',
    token: 'review-token',
    requestedBy: 'portal-runner'
  }, baseEnv(), mockFetch, { headers: { Authorization: 'Bearer review-token' } });

  assert(run.response.status === 200, 'claimed runner completes the queued package');
  assert(run.data.results[0].ready === true, 'claimed runner returns a ready package');
  assert(state.reviewRow.field_data.system.tannerHandoff.roomDetailCount === 2, 'runner packages the current reviewed rooms supplied at queue time');
  assert(state.handoffJobs.find(row => row.job_key === 'handoff_INH-TRAINING-QUEUE01').status === 'ready', 'runner saves ready durable state');
  assert(!state.handoffJobs.find(row => row.job_key === 'handoff_INH-TRAINING-QUEUE01').locked_at, 'runner releases the direct lock');
}

async function testLegacyReadyReceiptQueuesWithCompareAndSet() {
  const updatedAt = '2026-08-01T15:00:00.000Z';
  const legacyReceipt = {
    status: 'ready',
    inspectionId: 'INH-TRAINING-LEGACY01',
    isTestTraining: true,
    folderId: 'drive-legacy-shell',
    folderUrl: 'https://drive.google.com/drive/folders/drive-legacy-shell',
    photosFolderId: 'drive-legacy-photos',
    photosFolderUrl: 'https://drive.google.com/drive/folders/drive-legacy-photos',
    backupFolderId: 'drive-legacy-backup',
    backupFolderUrl: 'https://drive.google.com/drive/folders/drive-legacy-backup',
    spreadsheetId: 'sheet-legacy',
    spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/sheet-legacy/edit',
    rawJsonUrl: 'https://drive.google.com/file/d/raw-legacy/view',
    trackerStatus: 'skipped_test_training',
    sourcePhotoCount: 1,
    photoLogCount: 1,
    sourceRoomCount: 1,
    roomDetailCount: 1,
    photoFolderPendingCount: 0,
    photoFolderFailedCount: 0,
    workerVersion: 'handoff-w15'
  };
  const shellReceipt = {
    status: 'ready',
    shellStatus: 'ready',
    inspectionId: 'INH-TRAINING-LEGACY01',
    isTestTraining: true,
    folderId: legacyReceipt.folderId,
    folderUrl: legacyReceipt.folderUrl,
    photosFolderId: legacyReceipt.photosFolderId,
    photosFolderUrl: legacyReceipt.photosFolderUrl,
    backupFolderId: legacyReceipt.backupFolderId,
    backupFolderUrl: legacyReceipt.backupFolderUrl,
    trackerStatus: 'skipped_test_training'
  };
  const { mockFetch, state } = makeMockFetch({
    assessmentRows: [{
      inspection_id: 'INH-TRAINING-LEGACY01',
      assessment_num: 'INH-TRAINING-LEGACY01',
      status: 'In Review',
      drive_folder_id: legacyReceipt.folderId,
      assessment_folder_url: legacyReceipt.folderUrl,
      raw_jsonb: {
        inspectionId: 'INH-TRAINING-LEGACY01',
        isTestTraining: true,
        rooms: [
          { stepId: 'bedroom-0', roomName: 'Bedroom', notes: 'Canonical bedroom.' },
          { stepId: 'office-0', roomName: 'Office', notes: 'Canonical office.' }
        ]
      }
    }],
    reviewRow: {
      inspection_id: 'INH-TRAINING-LEGACY01',
      field_data: {
        clientName: 'Legacy Receipt Repair',
        inspectionType: 'Test / Training',
        isTestTraining: true,
        rooms: [{ stepId: 'bedroom-0', roomName: 'Bedroom', notes: 'Legacy receipt repair.' }],
        system: {
          startInspectionShell: shellReceipt,
          tannerHandoff: legacyReceipt
        },
        reviewPortalData: legacyReceipt
      },
      updated_at: updatedAt
    },
    handoffJobs: [{
      id: 'job-legacy01',
      job_key: 'handoff_INH-TRAINING-LEGACY01',
      inspection_id: 'INH-TRAINING-LEGACY01',
      is_test: true,
      status: 'ready',
      requested_by: 'review-portal',
      requested_at: updatedAt,
      attempt_count: 1,
      receipt: legacyReceipt,
      updated_at: updatedAt
    }]
  });

  const queued = await callWorker('/handoff-jobs', {
    inspectionId: 'INH-TRAINING-LEGACY01',
    requestedBy: 'review-portal',
    runInline: false
  }, baseEnv(), mockFetch, { headers: { Authorization: 'Bearer review-token' } });

  assert(queued.response.status === 202, 'legacy receipt repair is queued');
  assert(queued.data.queued === true, 'legacy receipt repair response is marked queued');
  assert(state.handoffJobQueueTransitions.length === 1, 'legacy receipt repair uses one conditional queue transition');
  assert(state.handoffJobQueueTransitions[0].updatedAtFilter === `eq.${updatedAt}`, 'queue transition compares the durable updated timestamp');
  assert(state.handoffJobQueueTransitions[0].matched === 1, 'queue transition acquires the observed durable row');
  assert(state.handoffJobs[0].status === 'queued', 'legacy durable job becomes queued');
  assert(state.handoffJobs[0].receipt.workerVersion === 'handoff-w15', 'queue keeps the prior receipt until the runner replaces it');

  const run = await callWorker('/handoff-jobs/run', {
    inspectionId: 'INH-TRAINING-LEGACY01',
    token: 'review-token',
    requestedBy: 'portal-runner'
  }, baseEnv(), mockFetch, { headers: { Authorization: 'Bearer review-token' } });

  assert(run.response.status === 200, 'runner repairs a stale ready receipt');
  assert(run.data.results[0].ready === true, 'runner returns the repaired package as ready');
  assert(state.reviewRow.field_data.system.tannerHandoff.roomDetailCount === 2, 'runner rebuilds every canonical assessment room');
  assert(state.reviewRow.field_data.system.tannerHandoff.workerVersion === 'handoff-w22', 'runner replaces the stale receipt with the current Worker receipt');
}

async function testFinalPhotoBatchRefreshesPhotoLogDriveUrls() {
  const shellReceipt = {
    status: 'ready',
    shellStatus: 'ready',
    isTestTraining: true,
    inspectionId: 'INH-TRAINING-PHOTOLOG01',
    folderId: 'drive-photolog-shell',
    folderUrl: 'https://drive.google.com/drive/folders/drive-photolog-shell',
    photosFolderId: 'drive-photolog-photos',
    photosFolderUrl: 'https://drive.google.com/drive/folders/drive-photolog-photos',
    cocsFolderId: 'drive-photolog-cocs',
    cocsFolderUrl: 'https://drive.google.com/drive/folders/drive-photolog-cocs',
    backupFolderId: 'drive-photolog-backup',
    backupFolderUrl: 'https://drive.google.com/drive/folders/drive-photolog-backup',
    trackerStatus: 'skipped_test_training'
  };
  const { mockFetch, state } = makeMockFetch({
    reviewRow: {
      inspection_id: 'INH-TRAINING-PHOTOLOG01',
      field_data: {
        clientName: 'Photo Log Refresh Test',
        inspectionType: 'Test / Training',
        isTestTraining: true,
        rooms: [{ stepId: 'kitchen-0', roomName: 'Kitchen', notes: 'Photo log test.' }],
        system: { startInspectionShell: shellReceipt }
      },
      updated_at: '2026-08-01T15:00:00.000Z'
    },
    photoRows: [{
      photo_id: 'photo-refresh-1',
      inspection_id: 'INH-TRAINING-PHOTOLOG01',
      room_name: 'Kitchen',
      step_name: 'Photos',
      caption: 'Refresh this URL',
      slot: 1,
      storage_path: 'INH-TRAINING-PHOTOLOG01/photo-refresh-1.jpg',
      drive_url: '',
      created_at: '2026-08-01T15:00:00.000Z'
    }]
  });
  const { response, data } = await callWorker('/handoff-jobs', {
    inspectionId: 'INH-TRAINING-PHOTOLOG01',
    requestedBy: 'review-portal'
  }, baseEnv(), mockFetch, { headers: { Authorization: 'Bearer review-token' } });

  const photoLogWrites = state.sheetValueWrites.filter(update => String(update.range || '').startsWith("'Photo Log'!"));
  const finalPhotoLog = photoLogWrites[photoLogWrites.length - 1]?.values || [];
  assert(response.status === 200, 'final photo batch returns ready');
  assert(data.artifactReceipt.photoDriveUrlCount === 1, 'ready receipt counts every photo Drive URL');
  assert(photoLogWrites.length >= 2, 'final photo batch refreshes the Photo Log after copying');
  assert(String(finalPhotoLog[1]?.[6] || '').includes('drive.google.com/file/d/'), 'final Photo Log contains the copied photo Drive URL');
  assert(String(finalPhotoLog[1]?.[7] || '').includes('token=inh-training-photolog01'), 'final Photo Log review URL includes its inspection token');
}

const tests = [
  testHealthRoute,
  testCorsAllowsWorkerTokenHeader,
  testReviewActivityEventWritesMetadataOnly,
  testAppFeedbackUsesSupabaseStore,
  testCommentLibraryCandidateAndAdminFlow,
  testSignRouteDoesNotCreateAssessmentParentRow,
  testTrainingCreatesTestArtifactsOnly,
  testInspectionSaveCreatesDurableCheckpoint,
  testActiveInspectionListUsesCanonicalSupabaseRows,
  testInspectionOpenRecoversConcurrentTeamEvents,
  testInspectionOpenAppliesPhotoTombstones,
  testPhotoDeleteRemovesManagedDriveCopy,
  testPhotoDeleteDoesNotRemoveDriveFileOutsideManagedFolder,
  testTeamMergePersistsEventBeforeCanonicalUpdate,
  testRealInspectionWithTrainingAddressDoesNotSkipShell,
  testRealStartShellCreatesReceipt,
  testStartShellDetectsTrackerReservationConflict,
  testStartShellRequiresSupabaseReservationByDefault,
  testStartShellRejectsSingleEnvTrackerSequenceFallback,
  testStartShellAllowsApprovedTrackerSequenceFallback,
  testExistingReceiptIsReused,
  testHandoffJobCreatesPackageReceipt,
  testHandoffJobCachedReceiptDoesNotDuplicateWork,
  testHandoffJobSheetFailureSavesFailedReceipt,
  testHandoffJobStatusReadsDurableJob,
  testTrainingHandoffCreatesTestPackageOnly,
  testTrainingHandoffRepairsMissingRecoveryRoomsInOriginalShell,
  testHandoffDoesNotDuplicateAlreadyCopiedPhoto,
  testHandoffWithRemainingPhotosStaysRunning,
  testHandoffHandlesLargePhotoBatchWithoutFalseCompletion,
  testHandoffPhotoCopyFailureSavesFailedArtifact,
  testBackgroundHandoffQueuesWaitUntil,
  testManualRunnerProcessesDueJobAndReusesStaticArtifacts,
  testScheduledRunnerProcessesPendingJob,
  testInspectionStatusIncludesHandoffReceipt,
  testRunnerFailureSchedulesBackoff,
  testDueRunnerSkipsFutureBackoff,
  testDueRunnerSkipsActivelyLockedJob,
  testDueRunnerRetriesFailedAfterBackoff,
  testDirectDuplicateHandoffReturnsInFlightWithoutDuplicateWork,
  testProductionHandoffQueuesBeforeRunnerBuildsPackage,
  testLegacyReadyReceiptQueuesWithCompareAndSet,
  testFinalPhotoBatchRefreshesPhotoLogDriveUrls
];

for (const test of tests) {
  await test();
  console.log(`PASS ${test.name}`);
}

console.log(`Worker start-shell tests passed: ${tests.length}/${tests.length}`);
