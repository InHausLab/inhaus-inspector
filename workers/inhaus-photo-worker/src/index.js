const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-worker-token',
  'Access-Control-Max-Age': '86400'
};

const JSON_HEADERS = {
  ...CORS_HEADERS,
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store, no-cache, must-revalidate',
  'Pragma': 'no-cache'
};

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive';
const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const GOOGLE_SCOPES = `${DRIVE_SCOPE} ${SHEETS_SCOPE}`;
const DRIVE_FOLDER_MIME = 'application/vnd.google-apps.folder';
const DRIVE_SPREADSHEET_MIME = 'application/vnd.google-apps.spreadsheet';
const DRIVE_SHORTCUT_MIME = 'application/vnd.google-apps.shortcut';
const TRACKER_TAB_REPORT = 'Report Tracker';
const FEEDBACK_TRACKER_TAB = 'Things to Fix';
const TRACKER_DATA_START = 8;
const TEST_ASSESSMENTS_FOLDER_NAME = '_Test Assessments';
const HANDOFF_RECEIPT_SCHEMA_VERSION = 'handoff-receipt-v2';
const HANDOFF_PHOTO_COPY_LIMIT_DEFAULT = 5;
const HANDOFF_RUNNER_LIMIT_DEFAULT = 5;
const HANDOFF_RETRY_BASE_DELAY_MS = 2 * 60 * 1000;
const HANDOFF_RETRY_MAX_DELAY_MS = 60 * 60 * 1000;
const DIRECT_HANDOFF_LOCK_STALE_MS = 2 * 60 * 1000;
const ASSESSMENT_NUMBER_SOURCE_SUPABASE = 'supabase_sequence';
const ASSESSMENT_NUMBER_SOURCE_TRACKER = 'tracker_sequence_fallback';
const WORKER_VERSION = 'handoff-w32';
const REVIEW_MUTATION_MAX_ATTEMPTS = 16;
const SHEET_CELL_SAFE_CHARS = 45000;

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });

    try {
      const url = new URL(request.url);
      if (url.pathname === '/health' && request.method === 'GET') return await handleHealth(env);
      if (url.pathname === '/sign' && request.method === 'POST') return await handleSign(request, env);
      if (url.pathname === '/start-inspection-shell' && request.method === 'POST') return await handleStartInspectionShell(request, env);
      if (url.pathname === '/inspections/save' && request.method === 'POST') return await handleInspectionSave(request, env);
      if (url.pathname === '/inspections/team-merge' && request.method === 'POST') return await handleInspectionTeamMerge(request, env);
      if (url.pathname === '/inspections' && request.method === 'GET') return await handleInspectionList(request, url, env);
      if (url.pathname === '/inspections/active' && request.method === 'GET') return await handleActiveInspections(request, url, env);
      if (url.pathname.startsWith('/inspections/') && request.method === 'GET') return await handleInspectionGet(request, url, env);
      if (url.pathname === '/app-feedback' && request.method === 'POST') return await handleAppFeedback(request, env);
      if (url.pathname === '/comment-library' && request.method === 'GET') return await handleCommentLibraryGet(request, url, env);
      if (url.pathname === '/comment-library/candidates' && request.method === 'POST') return await handleCommentLibraryCandidate(request, env);
      if (url.pathname === '/comment-library/admin' && request.method === 'POST') return await handleCommentLibraryAdmin(request, env);
      if (url.pathname === '/handoff-jobs' && request.method === 'POST') return await handleHandoffJob(request, env, ctx);
      if (url.pathname === '/handoff-jobs/run' && request.method === 'POST') return await handleHandoffJobRunner(request, env, ctx);
      if (url.pathname.startsWith('/handoff-jobs/') && request.method === 'GET') return await handleHandoffJobStatus(request, url, env);
      if (url.pathname === '/handoff' && request.method === 'POST') return await handleHandoffJob(request, env, ctx);
      if (url.pathname === '/metadata' && request.method === 'POST') return await handleMetadataUpdate(request, env);
      if (url.pathname === '/mirror' && request.method === 'POST') return await handleMirror(request, env);
      if (url.pathname === '/confirmed' && request.method === 'POST') return await handleConfirmed(request, env);
      if (url.pathname === '/inspection-status' && request.method === 'POST') return await handleInspectionStatus(request, env);
      if (url.pathname === '/inspection-photos' && request.method === 'GET') return await handleInspectionPhotos(url, env);
      if (url.pathname === '/delete' && request.method === 'POST') return await handleDelete(request, env);
      if (url.pathname === '/delete-review-photo' && request.method === 'POST') return await handleReviewPhotoDelete(request, env);
      if (url.pathname === '/photo' && request.method === 'GET') return await handleReviewPhoto(url, env);
      if (url.pathname === '/save-review' && request.method === 'POST') return await handleSaveReview(request, env);
      if (url.pathname === '/review-unlock' && request.method === 'POST') return await handleReviewUnlock(request, env);
      if (url.pathname === '/review-activity-events' && request.method === 'POST') return await handleReviewActivityEvent(request, env);
      if (url.pathname === '/get-review' && request.method === 'GET') return await handleGetReview(request, url, env);
      if (url.pathname === '/submit-smoke' && request.method === 'GET') return await handleSubmitSmoke(request, url, env);
      return json({ error: 'not_found' }, 404);
    } catch (err) {
      const status = Number(err && err.statusCode);
      return json(
        { error: err && err.message ? err.message : String(err) },
        Number.isInteger(status) && status >= 400 && status <= 599 ? status : 500
      );
    }
  },

  async scheduled(event, env, ctx) {
    if (ctx && typeof ctx.waitUntil === 'function') {
      ctx.waitUntil(runDueHandoffJobs(env, { limit: HANDOFF_RUNNER_LIMIT_DEFAULT, requestedBy: 'scheduled-worker' }));
    } else {
      await runDueHandoffJobs(env, { limit: HANDOFF_RUNNER_LIMIT_DEFAULT, requestedBy: 'scheduled-worker' });
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

  return json({ signedUrl, storagePath });
}

async function handleHealth(env) {
  return json({
    status: 'ok',
    service: 'inhaus-photo-worker',
    version: WORKER_VERSION,
    routes: [
      'GET /health',
      'POST /sign',
      'POST /start-inspection-shell',
      'POST /inspections/save',
      'POST /inspections/team-merge',
      'GET /inspections',
      'GET /inspections/active',
      'GET /inspections/:inspectionId',
      'POST /app-feedback',
      'GET /comment-library',
      'POST /comment-library/candidates',
      'POST /comment-library/admin',
      'POST /handoff-jobs',
      'POST /handoff-jobs/run',
      'GET /handoff-jobs/:inspectionId',
      'POST /handoff',
      'POST /metadata',
      'POST /mirror',
      'POST /confirmed',
      'POST /inspection-status',
      'GET /inspection-photos',
      'GET /photo',
      'POST /save-review',
      'POST /review-unlock',
      'POST /review-activity-events',
      'GET /get-review',
      'GET /submit-smoke'
    ],
    dependencies: {
      supabaseUrl: !!env.SUPABASE_URL,
      supabaseBucket: !!env.SUPABASE_BUCKET,
      supabaseServiceKey: !!env.SUPABASE_SERVICE_KEY,
      reviewAccessToken: !!env.REVIEW_ACCESS_TOKEN,
      googleServiceAccount: !!env.GOOGLE_SERVICE_ACCOUNT,
      assessmentsFolderId: !!env.ASSESSMENTS_FOLDER_ID,
      reportTrackerSheetId: !!env.REPORT_TRACKER_SHEET_ID,
      feedbackTrackerSheetId: !!env.FEEDBACK_TRACKER_SHEET_ID,
      feedbackFolderId: !!env.FEEDBACK_FOLDER_ID,
      handoffJobStore: 'supabase_handoff_jobs',
      handoffArtifactStore: 'supabase_handoff_artifacts',
      handoffJobClaim: 'rpc_claim_due_handoff_jobs',
      assessmentNumberSource: String(env.ASSESSMENT_NUMBER_SOURCE || ASSESSMENT_NUMBER_SOURCE_SUPABASE),
      trackerSequenceFallbackAllowed: allowTrackerSequenceFallback(env),
      runnerToken: !!env.HANDOFF_RUNNER_TOKEN
    },
    capabilities: {
      inspectionCloudApi: true,
      teamFieldMerge: true,
      companyCommentLibrary: true,
      appFeedback: !!env.FEEDBACK_TRACKER_SHEET_ID && !!env.FEEDBACK_FOLDER_ID && !!env.GOOGLE_SERVICE_ACCOUNT,
      recoveryAudit: true
    }
  });
}

async function handleAppFeedback(request, env) {
  requireEnv(env, [
    'SUPABASE_URL',
    'SUPABASE_SERVICE_KEY',
    'UPLOAD_SECRET',
    'GOOGLE_SERVICE_ACCOUNT',
    'FEEDBACK_TRACKER_SHEET_ID',
    'FEEDBACK_FOLDER_ID'
  ]);
  const body = await readJson(request);
  validateSharedSecret(body, env);
  const feedback = isPlainObject(body.feedback) ? cleanInspectionPayload(body.feedback) : {};
  const feedbackId = cleanReviewKey(feedback.feedbackId || `APP-FEEDBACK-${crypto.randomUUID()}`, 'feedbackId');
  const context = isPlainObject(feedback.context) ? feedback.context : {};
  const inspectionId = String(feedback.inspectionId || context.inspectionId || '').trim() || null;
  feedback.feedbackId = feedbackId;
  const params = new URLSearchParams();
  params.set('on_conflict', 'feedback_id');
  const response = await fetch(normalizeSupabaseUrl(env, `/rest/v1/app_feedback?${params}`), {
    method: 'POST',
    headers: serviceHeaders(env, {
      'Content-Type': 'application/json',
      'Prefer': 'resolution=ignore-duplicates,return=minimal'
    }),
    body: JSON.stringify({
      feedback_id: feedbackId,
      inspection_id: inspectionId,
      status: 'new',
      payload: feedback,
      updated_at: new Date().toISOString()
    })
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`app_feedback_save_failed:${response.status}:${text.slice(0, 200)}`);

  let trackerMirror = null;
  try {
    trackerMirror = await mirrorAppFeedbackToTracker(env, feedback);
  } catch (err) {
    trackerMirror = {
      mirrored: false,
      error: err && err.message ? err.message : String(err)
    };
  }
  await updateAppFeedbackMirrorState(env, feedbackId, feedback, trackerMirror);
  return json({
    status: 'ok',
    saved: true,
    feedbackId,
    trackerMirrored: trackerMirror.mirrored === true,
    trackerRow: trackerMirror.row || 0,
    trackerUrl: trackerMirror.trackerUrl || '',
    trackerError: trackerMirror.error || ''
  });
}

async function mirrorAppFeedbackToTracker(env, feedback) {
  const accessToken = await getGoogleAccessToken(env);
  const spreadsheetId = String(env.FEEDBACK_TRACKER_SHEET_ID || '').trim();
  const values = await getSheetValues(accessToken, spreadsheetId, feedbackSheetRange('A:P'));
  const feedbackId = String(feedback.feedbackId || '').trim();
  let row = findFeedbackTrackerRow(values, feedbackId);
  const existing = row ? (values[row - 1] || []) : [];
  const filesByName = await listDriveFolderFilesByName(accessToken, env.FEEDBACK_FOLDER_ID);
  const screenshotUrl = existing[10] || await ensureFeedbackAttachment(
    accessToken,
    env.FEEDBACK_FOLDER_ID,
    filesByName,
    feedbackId,
    'screenshot',
    feedback.screenshotName,
    feedback.screenshotDataUrl
  );
  const voiceUrl = existing[11] || await ensureFeedbackAttachment(
    accessToken,
    env.FEEDBACK_FOLDER_ID,
    filesByName,
    feedbackId,
    'voice',
    '',
    feedback.voiceDataUrl,
    feedback.voiceMimeType
  );
  if (!row) row = findNextFeedbackTrackerRow(values);

  const context = isPlainObject(feedback.context) ? feedback.context : {};
  const trackerValues = [[
    feedback.submittedAt || new Date().toISOString(),
    feedbackId,
    existing[2] || 'New',
    context.inspectorName || feedback.inspectorName || '',
    context.inspectionId || feedback.inspectionId || '',
    context.propertyAddress || feedback.propertyAddress || '',
    context.appVersion || '',
    context.screen || '',
    context.stepIndex === undefined || context.stepIndex === null ? '' : context.stepIndex,
    feedback.note || '',
    screenshotUrl,
    voiceUrl,
    context.pageUrl || '',
    context.userAgent || '',
    context.online === true ? 'Yes' : (context.online === false ? 'No' : ''),
    existing[15] || ''
  ]];
  await batchUpdateSheetValues(accessToken, spreadsheetId, [{
    range: feedbackSheetRange(`A${row}:P${row}`),
    values: trackerValues
  }]);
  return {
    mirrored: true,
    row,
    screenshotUrl,
    voiceUrl,
    trackerUrl: `https://docs.google.com/spreadsheets/d/${encodeURIComponent(spreadsheetId)}/edit#range=A${row}`,
    mirroredAt: new Date().toISOString(),
    error: ''
  };
}

async function updateAppFeedbackMirrorState(env, feedbackId, feedback, mirror) {
  const context = isPlainObject(feedback.context) ? feedback.context : {};
  const payload = structuredClone(feedback);
  payload.system = {
    ...(isPlainObject(payload.system) ? payload.system : {}),
    trackerMirror: {
      mirrored: mirror.mirrored === true,
      row: mirror.row || 0,
      trackerUrl: mirror.trackerUrl || '',
      screenshotUrl: mirror.screenshotUrl || '',
      voiceUrl: mirror.voiceUrl || '',
      mirroredAt: mirror.mirroredAt || '',
      error: mirror.error || ''
    }
  };
  const params = new URLSearchParams();
  params.set('feedback_id', `eq.${feedbackId}`);
  const response = await fetch(normalizeSupabaseUrl(env, `/rest/v1/app_feedback?${params}`), {
    method: 'PATCH',
    headers: serviceHeaders(env, {
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal'
    }),
    body: JSON.stringify({
      inspection_id: String(feedback.inspectionId || context.inspectionId || '').trim() || null,
      payload,
      updated_at: new Date().toISOString()
    })
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`app_feedback_mirror_state_failed:${response.status}:${text.slice(0, 200)}`);
}

function findFeedbackTrackerRow(values, feedbackId) {
  if (!feedbackId) return 0;
  for (let index = 1; index < values.length; index += 1) {
    if (String((values[index] || [])[1] || '').trim() === feedbackId) return index + 1;
  }
  return 0;
}

function findNextFeedbackTrackerRow(values) {
  for (let index = 1; index < values.length; index += 1) {
    if (!String((values[index] || [])[1] || '').trim()) return index + 1;
  }
  return Math.max(2, values.length + 1);
}

function feedbackSheetRange(a1Range) {
  return `'${String(FEEDBACK_TRACKER_TAB).replace(/'/g, "''")}'!${a1Range}`;
}

async function ensureFeedbackAttachment(accessToken, folderId, filesByName, feedbackId, kind, originalName, dataUrl, mimeHint) {
  if (!dataUrl) return '';
  const attachment = dataUrlToBlob(dataUrl, mimeHint);
  const fileName = feedbackAttachmentName(feedbackId, kind, originalName, attachment.type);
  const existing = filesByName.get(fileName);
  if (existing) return existing.webViewLink || `https://drive.google.com/file/d/${encodeURIComponent(existing.id)}/view`;
  const uploaded = await uploadDriveBlob(accessToken, folderId, fileName, attachment, attachment.type);
  filesByName.set(fileName, uploaded);
  return uploaded.webViewLink || `https://drive.google.com/file/d/${encodeURIComponent(uploaded.id)}/view`;
}

function feedbackAttachmentName(feedbackId, kind, _originalName, mimeType) {
  const extension = feedbackMimeExtension(mimeType);
  return `${feedbackId} - ${kind}${extension}`;
}

function feedbackMimeExtension(mimeType) {
  const normalized = String(mimeType || '').toLowerCase();
  if (normalized.includes('png')) return '.png';
  if (normalized.includes('jpeg') || normalized.includes('jpg')) return '.jpg';
  if (normalized.includes('webm')) return '.webm';
  if (normalized.includes('mpeg')) return '.mp3';
  if (normalized.includes('mp4') || normalized.includes('m4a')) return '.m4a';
  if (normalized.includes('wav')) return '.wav';
  return '.bin';
}

function dataUrlToBlob(dataUrl, mimeHint) {
  const match = String(dataUrl || '').match(/^data:([^;,]+)?(;base64)?,(.*)$/s);
  if (!match) throw new Error('invalid_feedback_attachment');
  const mimeType = match[1] || mimeHint || 'application/octet-stream';
  const binary = match[2] ? atob(match[3]) : decodeURIComponent(match[3]);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: mimeType });
}

async function handleCommentLibraryGet(request, url, env) {
  requireEnv(env, ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'REVIEW_ACCESS_TOKEN']);
  if (!isReviewAuthorized(request, url.searchParams.get('token'), env)) return json({ status: 'error', message: 'Unauthorized' }, 401);
  const rows = await getCommentLibraryRows(env);
  const comments = rows.filter(row => row.status === 'approved').map(commentLibraryApiItem);
  return json({ status: 'ok', libraryVersion: 1, comments });
}

async function handleCommentLibraryCandidate(request, env) {
  requireEnv(env, ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'UPLOAD_SECRET']);
  const body = await readJson(request);
  validateSharedSecret(body, env);
  const incoming = isPlainObject(body.comment) ? body.comment : {};
  const cleanedText = String(incoming.cleanedText || '').trim().replace(/\s+/g, ' ');
  if (!cleanedText) throw new Error('missing_cleaned_comment');
  const normalizedText = normalizeLibraryComment(cleanedText);
  const rows = await getCommentLibraryRows(env, normalizedText);
  const approved = rows.find(row => row.status === 'approved');
  if (approved) return json({ status: 'ok', comment: commentLibraryApiItem(approved), alreadyApproved: true });
  const existing = rows.find(row => row.status === 'pending_review');
  const commentId = cleanReviewKey(existing && existing.comment_id || incoming.commentId || `company-comment-${crypto.randomUUID()}`, 'commentId');
  const now = new Date().toISOString();
  const saved = await upsertCommentLibraryRow(env, {
    comment_id: commentId,
    normalized_text: normalizedText,
    cleaned_text: cleanedText,
    severity: String(incoming.severity || 'Observation').slice(0, 80),
    report_section: String(incoming.reportSection || '').slice(0, 200) || null,
    status: 'pending_review',
    submitted_by: String(incoming.submittedBy || '').slice(0, 160) || null,
    submitted_at: incoming.submittedAt || now,
    source_inspection_id: String(body.inspectionId || '').slice(0, 160) || null,
    source_finding_id: String(incoming.sourceFindingId || '').slice(0, 160) || null,
    updated_at: now
  });
  return json({ status: 'ok', comment: commentLibraryApiItem(saved), pendingReview: true });
}

async function handleCommentLibraryAdmin(request, env) {
  requireEnv(env, ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'REVIEW_ADMIN_TOKEN']);
  const body = await readJson(request);
  if (!body.adminToken || String(body.adminToken) !== String(env.REVIEW_ADMIN_TOKEN)) return json({ status: 'error', message: 'Invalid admin token' }, 401);
  const command = String(body.command || '');
  if (command === 'list') {
    const rows = await getCommentLibraryRows(env);
    return json({
      status: 'ok',
      libraryVersion: 1,
      library: {
        version: 1,
        comments: rows.filter(row => row.status === 'approved').map(commentLibraryApiItem),
        candidates: rows.filter(row => row.status === 'pending_review').map(commentLibraryApiItem),
        updatedAt: rows.reduce((latest, row) => String(row.updated_at || '') > latest ? String(row.updated_at || '') : latest, '')
      }
    });
  }
  const commentId = cleanReviewKey(body.commentId, 'commentId');
  const row = await getCommentLibraryRowById(env, commentId);
  if (!row) return json({ status: 'error', message: 'Comment not found' }, 404);
  const now = new Date().toISOString();
  let patch;
  if (command === 'approve') {
    const cleanedText = String(body.cleanedText || row.cleaned_text || '').trim().replace(/\s+/g, ' ');
    if (!cleanedText) throw new Error('approved_wording_required');
    patch = {
      ...row,
      normalized_text: normalizeLibraryComment(cleanedText),
      cleaned_text: cleanedText,
      severity: String(body.severity || row.severity || 'Observation').slice(0, 80),
      report_section: String(body.reportSection || row.report_section || '').slice(0, 200) || null,
      status: 'approved',
      approved_by: String(body.approvedBy || 'InHaus Admin').slice(0, 160),
      approved_at: now,
      updated_at: now
    };
  } else if (command === 'update') {
    if (row.status !== 'approved') throw new Error('only_approved_comments_can_be_updated');
    const cleanedText = String(body.cleanedText || row.cleaned_text || '').trim().replace(/\s+/g, ' ');
    patch = {
      ...row,
      normalized_text: normalizeLibraryComment(cleanedText),
      cleaned_text: cleanedText,
      severity: String(body.severity || row.severity || 'Observation').slice(0, 80),
      report_section: String(body.reportSection || row.report_section || '').slice(0, 200) || null,
      updated_at: now
    };
  } else if (command === 'archive') {
    patch = { ...row, status: 'archived', archived_at: now, updated_at: now };
  } else {
    throw new Error('unsupported_library_command');
  }
  const saved = await upsertCommentLibraryRow(env, patch);
  return json({ status: 'ok', comment: commentLibraryApiItem(saved) });
}

async function getCommentLibraryRows(env, normalizedText = '') {
  const params = new URLSearchParams();
  params.set('select', '*');
  if (normalizedText) params.set('normalized_text', `eq.${normalizedText}`);
  params.set('order', 'updated_at.desc');
  const response = await fetch(normalizeSupabaseUrl(env, `/rest/v1/company_comment_library?${params}`), { headers: serviceHeaders(env) });
  const text = await response.text();
  if (!response.ok) throw new Error(`comment_library_get_failed:${response.status}:${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : [];
}

async function getCommentLibraryRowById(env, commentId) {
  const params = new URLSearchParams();
  params.set('comment_id', `eq.${commentId}`);
  params.set('select', '*');
  params.set('limit', '1');
  const response = await fetch(normalizeSupabaseUrl(env, `/rest/v1/company_comment_library?${params}`), { headers: serviceHeaders(env) });
  const text = await response.text();
  if (!response.ok) throw new Error(`comment_library_get_failed:${response.status}:${text.slice(0, 200)}`);
  const rows = text ? JSON.parse(text) : [];
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

async function upsertCommentLibraryRow(env, row) {
  const params = new URLSearchParams();
  params.set('on_conflict', 'comment_id');
  const response = await fetch(normalizeSupabaseUrl(env, `/rest/v1/company_comment_library?${params}`), {
    method: 'POST',
    headers: serviceHeaders(env, {
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates,return=representation'
    }),
    body: JSON.stringify(row)
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`comment_library_save_failed:${response.status}:${text.slice(0, 200)}`);
  const rows = text ? JSON.parse(text) : [];
  return Array.isArray(rows) && rows.length ? rows[0] : row;
}

function commentLibraryApiItem(row) {
  return {
    commentId: row.comment_id,
    cleanedText: row.cleaned_text,
    severity: row.severity || 'Observation',
    reportSection: row.report_section || '',
    status: row.status,
    submittedBy: row.submitted_by || '',
    submittedAt: row.submitted_at || '',
    sourceInspectionId: row.source_inspection_id || '',
    sourceFindingId: row.source_finding_id || '',
    approvedBy: row.approved_by || '',
    approvedAt: row.approved_at || '',
    archivedAt: row.archived_at || '',
    updatedAt: row.updated_at || ''
  };
}

function normalizeLibraryComment(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

async function handleInspectionSave(request, env) {
  requireEnv(env, ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'UPLOAD_SECRET']);
  const body = await readJson(request);
  validateSharedSecret(body, env);
  const source = cleanInspectionPayload(body.inspection || body);
  const inspectionId = cleanId(source.inspectionId || source.id, 'inspectionId');
  source.inspectionId = inspectionId;
  source.id = source.id || inspectionId;
  const shell = await getStartInspectionShellState(env, inspectionId);
  assertAssessmentClassificationMatchesShell(shell, source);
  await recordInspectionSyncEvent(env, inspectionId, source, {
    eventType: body.eventType || (body.final === true ? 'final' : 'checkpoint'),
    sourceDevice: inspectionSourceDevice(source)
  });
  const row = await saveInspectionAssessment(env, source, null, shell);
  return json(inspectionSaveReceipt(source, row, shell));
}

async function handleInspectionTeamMerge(request, env) {
  requireEnv(env, ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'UPLOAD_SECRET']);
  const body = await readJson(request);
  validateSharedSecret(body, env);
  const incoming = cleanInspectionPayload(body.inspection || body);
  const incomingResume = isPlainObject(incoming.resumeData) ? incoming.resumeData : incoming;
  const inspectionId = cleanId(incomingResume.inspectionId || incoming.inspectionId || body.inspectionId, 'inspectionId');
  incoming.inspectionId = inspectionId;
  incoming.id = incoming.id || inspectionId;
  const shell = await getStartInspectionShellState(env, inspectionId);
  assertAssessmentClassificationMatchesShell(shell, incoming);
  await recordInspectionSyncEvent(env, inspectionId, incoming, {
    eventType: 'team_merge',
    sourceDevice: inspectionSourceDevice(incomingResume)
  });

  const existingRow = await getAssessmentRow(env, inspectionId);
  const events = await getInspectionSyncEvents(env, inspectionId);
  let merged = existingRow && isPlainObject(existingRow.raw_jsonb) ? structuredClone(existingRow.raw_jsonb) : {};
  for (const event of events) {
    if (isPlainObject(event.payload)) merged = mergeInspectionExports(merged, event.payload);
  }
  merged.inspectionId = inspectionId;
  merged.id = merged.id || inspectionId;
  const mergedResume = isPlainObject(merged.resumeData) ? merged.resumeData : merged;
  mergedResume.inspectionId = inspectionId;
  mergedResume.id = mergedResume.id || inspectionId;
  mergedResume._serverMergedAt = new Date().toISOString();
  if (isPlainObject(mergedResume.collaboration)) {
    mergedResume.collaboration.serverMergedAt = mergedResume._serverMergedAt;
  }
  merged.resumeData = mergedResume;
  await saveInspectionAssessment(env, merged, existingRow, shell);
  return json({
    status: 'ok',
    merged: true,
    inspectionId,
    inspection: mergedResume,
    resumeData: mergedResume,
    serverMergedAt: mergedResume._serverMergedAt
  });
}

async function handleActiveInspections(request, url, env) {
  requireEnv(env, ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'REVIEW_ACCESS_TOKEN']);
  if (!isReviewAuthorized(request, url.searchParams.get('token'), env)) return json({ status: 'error', message: 'Unauthorized' }, 401);
  const params = new URLSearchParams();
  params.set('select', 'inspection_id,status,drive_folder_id,assessment_folder_url,raw_jsonb');
  params.set('order', 'inspection_id.desc');
  params.set('limit', '75');
  const rows = await getAssessmentRows(env, params);
  const inspections = rows.map(activeInspectionListEntry).filter(Boolean);
  return json({
    status: 'ok',
    generatedAt: new Date().toISOString(),
    mode: 'active',
    count: inspections.length,
    inspections
  });
}

async function handleInspectionList(request, url, env) {
  requireEnv(env, ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'REVIEW_ACCESS_TOKEN']);
  if (!isReviewAuthorized(request, url.searchParams.get('token'), env)) {
    return json({ status: 'error', message: 'Unauthorized' }, 401);
  }
  const params = new URLSearchParams();
  params.set('select', 'inspection_id,assessment_num,report_id,status,drive_folder_id,assessment_folder_url,inspection_date,raw_jsonb');
  params.set('order', 'inspection_date.desc.nullslast,inspection_id.desc');
  const [assessmentRows, reviewRows] = await Promise.all([
    getAllAssessmentRows(env, params),
    getReviewRows(env)
  ]);
  const reviewsByInspection = new Map(reviewRows.map(row => [String(row.inspection_id || ''), row]));
  const inspections = assessmentRows
    .map(row => portalInspectionListEntry(row, reviewsByInspection.get(String(row.inspection_id || ''))))
    .filter(Boolean);
  return json({
    status: 'ok',
    generatedAt: new Date().toISOString(),
    count: inspections.length,
    inspections
  });
}

async function handleInspectionGet(request, url, env) {
  requireEnv(env, ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'REVIEW_ACCESS_TOKEN']);
  const inspectionId = cleanId(decodeURIComponent(url.pathname.slice('/inspections/'.length)), 'inspectionId');
  const token = String(url.searchParams.get('token') || '');
  if (!isReviewAuthorized(request, token, env)) return json({ status: 'error', message: 'Unauthorized' }, 401);
  const row = await getAssessmentRow(env, inspectionId);
  if (!row) return json({ status: 'error', message: `Inspection not found: ${inspectionId}` }, 404);
  const events = await getInspectionSyncEvents(env, inspectionId);
  let inspection = isPlainObject(row.raw_jsonb) ? structuredClone(row.raw_jsonb) : {};
  for (const event of events) {
    if (isPlainObject(event.payload)) inspection = mergeInspectionExports(inspection, event.payload);
  }
  inspection = applyInspectionPhotoTombstones(inspection, inspection.photoTombstones);
  inspection.inspectionId = inspection.inspectionId || inspectionId;
  inspection.id = inspection.id || inspectionId;
  inspection.status = row.status || inspection.status || '';
  inspection.folderId = inspection.folderId || inspection.driveFolderId || row.drive_folder_id || '';
  inspection.driveFolderId = inspection.driveFolderId || inspection.folderId || row.drive_folder_id || '';
  inspection.folderUrl = inspection.folderUrl || inspection.driveFolderUrl || row.assessment_folder_url || '';
  inspection.driveFolderUrl = inspection.driveFolderUrl || inspection.folderUrl || row.assessment_folder_url || '';
  return json({ status: 'ok', inspection });
}

function cleanInspectionPayload(value) {
  const source = isPlainObject(value) ? structuredClone(value) : {};
  delete source.sharedSecret;
  delete source['x-sync-secret'];
  delete source.token;
  delete source.action;
  return source;
}

function inspectionSourceDevice(source) {
  const collaboration = isPlainObject(source && source.collaboration) ? source.collaboration : {};
  return String(source && (source.deviceId || source._deviceId) || collaboration.deviceId || collaboration.currentDeviceId || '').slice(0, 160);
}

async function recordInspectionSyncEvent(env, inspectionId, payload, options = {}) {
  const eventHash = await sha256Hex(stableStringify(payload));
  const eventKey = `${inspectionId}:${eventHash}`;
  const params = new URLSearchParams();
  params.set('on_conflict', 'event_key');
  const response = await fetch(normalizeSupabaseUrl(env, `/rest/v1/inspection_sync_events?${params}`), {
    method: 'POST',
    headers: serviceHeaders(env, {
      'Content-Type': 'application/json',
      'Prefer': 'resolution=ignore-duplicates,return=minimal'
    }),
    body: JSON.stringify({
      event_key: eventKey,
      inspection_id: inspectionId,
      event_type: String(options.eventType || 'checkpoint').slice(0, 80),
      source_device: String(options.sourceDevice || '').slice(0, 160) || null,
      payload
    })
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`inspection_event_save_failed:${response.status}:${text.slice(0, 200)}`);
  return eventKey;
}

async function getInspectionSyncEvents(env, inspectionId) {
  const params = new URLSearchParams();
  params.set('inspection_id', `eq.${inspectionId}`);
  params.set('select', 'event_key,event_type,source_device,payload,created_at');
  params.set('order', 'created_at.asc');
  params.set('limit', '1000');
  const response = await fetch(normalizeSupabaseUrl(env, `/rest/v1/inspection_sync_events?${params}`), {
    headers: serviceHeaders(env)
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`inspection_events_get_failed:${response.status}:${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : [];
}

async function getAssessmentRows(env, params) {
  const response = await fetch(normalizeSupabaseUrl(env, `/rest/v1/ihl_assessments?${params}`), {
    headers: serviceHeaders(env)
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`assessment_get_failed:${response.status}:${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : [];
}

async function getAllAssessmentRows(env, baseParams) {
  const rows = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const params = new URLSearchParams(baseParams);
    params.set('limit', String(pageSize));
    params.set('offset', String(offset));
    const page = await getAssessmentRows(env, params);
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

async function getAssessmentRow(env, inspectionId) {
  const params = new URLSearchParams();
  params.set('inspection_id', `eq.${inspectionId}`);
  params.set('select', 'inspection_id,assessment_num,report_id,status,drive_folder_id,assessment_folder_url,raw_jsonb');
  params.set('limit', '1');
  const rows = await getAssessmentRows(env, params);
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

async function saveInspectionAssessment(env, source, knownRow = null, knownShell = null) {
  const inspectionId = cleanId(source.inspectionId || source.id, 'inspectionId');
  const row = knownRow || await getAssessmentRow(env, inspectionId);
  const shell = knownShell || await getStartInspectionShellState(env, inspectionId);
  const lockedClassification = shellAssessmentClassification(shell);
  if (lockedClassification) {
    source = withAssessmentClassification(source, lockedClassification);
  }
  const resume = isPlainObject(source.resumeData) ? source.resumeData : source;
  const payloadShell = isPlainObject(source.startInspectionShell) ? source.startInspectionShell : null;
  const isTestTraining = lockedClassification === 'test' ||
    isTestTrainingInspection(source) ||
    isTestTrainingInspection(resume) ||
    isTestTrainingInspection(shell) ||
    isTestTrainingInspection(payloadShell);
  const assessmentNumber = firstNonEmpty(
    row && row.assessment_num,
    source.assessmentNumber,
    source.assessmentNum,
    shell && shell.assessmentNumber,
    isTestTraining ? inspectionId : ''
  );
  if (!assessmentNumber) throw new Error('missing_assessment_number_reservation');
  const status = normalizeAssessmentStatus(
    source.reviewStatus || resume.reviewStatus || source.status || resume.status || (row && row.status) || 'In Progress'
  );
  const payload = {
    inspection_id: inspectionId,
    assessment_num: String(assessmentNumber),
    report_id: firstNonEmpty(source.reportId, source.report_id, row && row.report_id) || null,
    inspector_name: firstNonEmpty(source.inspectorName, resume.inspectorName) || null,
    inspection_date: String(firstNonEmpty(source.inspectionDate, resume.inspectionDate) || '').slice(0, 10) || null,
    status,
    drive_folder_id: firstNonEmpty(source.folderId, source.driveFolderId, shell && shell.folderId, row && row.drive_folder_id) || null,
    assessment_folder_url: firstNonEmpty(source.folderUrl, source.driveFolderUrl, shell && shell.folderUrl, row && row.assessment_folder_url) || null,
    water_source: firstNonEmpty(source.waterSource, resume.waterSource) || null,
    occupancy: firstNonEmpty(source.occupancyDuringInspection, resume.occupancyDuringInspection) || null,
    weather_conditions: firstNonEmpty(source.weatherConditions, resume.weatherConditions) || null,
    client_concerns: firstNonEmpty(source.clientConcerns, resume.clientConcerns) || null,
    known_problem_areas: firstNonEmpty(source.knownProblemAreas, resume.knownProblemAreas) || null,
    pets: firstNonEmpty(source.pets, resume.pets) || null,
    smoking_vaping: firstNonEmpty(source.smokingVaping, resume.smokingVaping) || null,
    stove_type: firstNonEmpty(source.stoveType, resume.stoveType) || null,
    fireplace: firstNonEmpty(source.fireplace, resume.fireplace) || null,
    carpeted_rooms: firstNonEmpty(source.carpetedRooms, resume.carpetedRooms) || null,
    started_at: firstNonEmpty(source.startedAt, resume.startedAt) || null,
    ended_at: firstNonEmpty(source.endedAt, resume.endedAt) || null,
    completed_at: firstNonEmpty(source.completedAt, resume.completedAt) || null,
    app_version: firstNonEmpty(source.appVersion, resume.appVersion) || null,
    payload_version: firstNonEmpty(source.payloadVersion, resume.payloadVersion) || null,
    raw_jsonb: applyInspectionPhotoTombstones(source, source.photoTombstones || resume.photoTombstones),
    source_system: isTestTraining ? 'worker_test_training' : 'worker_inspection_api',
    source_id: inspectionId
  };
  const params = new URLSearchParams();
  params.set('on_conflict', 'inspection_id');
  const response = await fetch(normalizeSupabaseUrl(env, `/rest/v1/ihl_assessments?${params}`), {
    method: 'POST',
    headers: serviceHeaders(env, {
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates,return=representation'
    }),
    body: JSON.stringify(payload)
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`assessment_save_failed:${response.status}:${text.slice(0, 200)}`);
  const rows = text ? JSON.parse(text) : [];
  return Array.isArray(rows) && rows.length ? rows[0] : { ...row, ...payload };
}

function normalizeAssessmentStatus(value) {
  const raw = String(value || '').trim();
  if (/^prepared$/i.test(raw)) return 'prepared';
  if (/field active|in[-\s]?progress/i.test(raw)) return 'In Progress';
  if (/report complete/i.test(raw)) return 'Report Complete';
  if (/submitted to tanner/i.test(raw)) return 'Submitted to Tanner';
  if (/in review/i.test(raw)) return 'In Review';
  if (/synced|needs review|completed|complete/i.test(raw)) return 'Synced';
  return raw || 'In Progress';
}

function inspectionSaveReceipt(source, row, shell) {
  return {
    status: 'ok',
    saved: true,
    inspectionId: source.inspectionId,
    assessmentNumber: String((row && row.assessment_num) || (shell && shell.assessmentNumber) || ''),
    folderId: firstNonEmpty(source.folderId, source.driveFolderId, shell && shell.folderId, row && row.drive_folder_id),
    folderUrl: firstNonEmpty(source.folderUrl, source.driveFolderUrl, shell && shell.folderUrl, row && row.assessment_folder_url),
    trackerRow: firstNonEmpty(source.trackerRow, shell && shell.trackerRow),
    trackerUrl: firstNonEmpty(source.trackerUrl, shell && shell.trackerUrl),
    trackerStatus: firstNonEmpty(source.trackerStatus, shell && shell.trackerStatus),
    updatedAt: new Date().toISOString()
  };
}

function activeInspectionListEntry(row) {
  const source = row && isPlainObject(row.raw_jsonb) ? row.raw_jsonb : {};
  const resume = isPlainObject(source.resumeData) ? source.resumeData : {};
  const statusText = String(source.reviewStatus || source.status || row.status || '').trim();
  const status = /prepared/i.test(statusText)
    ? 'prepared'
    : (/field active|in[-\s]?progress/i.test(statusText) ? 'Field Active' : '');
  const hasResumeData = !!(
    resume &&
    (resume.inspectionId || resume.id) &&
    isPlainObject(resume.stepData)
  );
  if (!status || !hasResumeData) return null;
  const inspectionId = source.inspectionId || resume.inspectionId || row.inspection_id;
  return {
    inspectionId,
    id: source.id || inspectionId,
    clientName: source.clientName || resume.clientName || '',
    propertyAddress: source.propertyAddress || resume.propertyAddress || '',
    inspectionDate: source.inspectionDate || resume.inspectionDate || '',
    inspectorName: source.inspectorName || resume.inspectorName || '',
    status,
    hasResumeData: true,
    photoCount: Number(source.photoCount || (Array.isArray(source.photoManifest) ? source.photoManifest.length : 0)),
    folderId: source.folderId || source.driveFolderId || row.drive_folder_id || '',
    folderUrl: source.folderUrl || source.driveFolderUrl || row.assessment_folder_url || '',
    preparedAt: resume.preparedAt || source.preparedAt || '',
    startedAt: resume.startedAt || source.startedAt || '',
    updatedAt: resume.updatedAt || source.updatedAt || '',
    lastUpdated: resume.updatedAt || source.updatedAt || source.completedAt || source.endedAt || source.syncedAt || '',
    reviewToken: String(inspectionId || '').toLowerCase()
  };
}

function portalInspectionListEntry(row, reviewRow) {
  if (!row || !row.inspection_id) return null;
  const source = isPlainObject(row.raw_jsonb) ? row.raw_jsonb : {};
  const resume = isPlainObject(source.resumeData) ? source.resumeData : {};
  const review = reviewRow && isPlainObject(reviewRow.field_data) ? reviewRow.field_data : {};
  const submission = isPlainObject(review.submission) ? review.submission : {};
  const inspectionId = String(source.inspectionId || resume.inspectionId || row.inspection_id);
  const sourcePhotos = Array.isArray(source.photos)
    ? source.photos
    : (Array.isArray(resume.photos) ? resume.photos : []);
  const manifest = Array.isArray(source.photoManifest)
    ? source.photoManifest
    : (Array.isArray(resume.photoManifest) ? resume.photoManifest : []);
  return {
    inspectionId,
    id: source.id || resume.id || inspectionId,
    assessmentNumber: String(row.assessment_num || source.assessmentNumber || ''),
    clientName: firstNonEmpty(source.clientName, resume.clientName),
    propertyAddress: firstNonEmpty(source.propertyAddress, resume.propertyAddress),
    inspectionDate: firstNonEmpty(source.inspectionDate, resume.inspectionDate, row.inspection_date),
    inspectorName: firstNonEmpty(source.inspectorName, resume.inspectorName),
    status: firstNonEmpty(submission.status, review.status, source.reviewStatus, source.status, resume.status, row.status, 'In Progress'),
    photoCount: Number(source.photoCount || resume.photoCount || manifest.length || sourcePhotos.length || 0),
    missingCount: Number(review.missingCount || source.missingCount || resume.missingCount || 0),
    folderId: firstNonEmpty(source.folderId, source.driveFolderId, row.drive_folder_id),
    folderUrl: firstNonEmpty(source.folderUrl, source.driveFolderUrl, row.assessment_folder_url),
    lastUpdated: firstNonEmpty(reviewRow && reviewRow.updated_at, resume.updatedAt, source.updatedAt, source.completedAt, source.endedAt, source.syncedAt),
    reviewToken: inspectionId.toLowerCase()
  };
}

function mergeInspectionExports(remoteExport, incomingExport) {
  const remote = isPlainObject(remoteExport) ? remoteExport : {};
  const incoming = isPlainObject(incomingExport) ? incomingExport : {};
  const remoteResume = isPlainObject(remote.resumeData) ? remote.resumeData : remote;
  const incomingResume = isPlainObject(incoming.resumeData) ? incoming.resumeData : incoming;
  const mergedResume = mergeInspectionRecords(remoteResume, incomingResume);
  const merged = { ...structuredClone(remote), ...structuredClone(incoming) };
  merged.resumeData = mergedResume;
  merged.findings = structuredClone(mergedResume.findings || []);
  merged.commentLibrary = structuredClone(mergedResume.commentLibrary || []);
  merged.collaboration = structuredClone(mergedResume.collaboration || {});
  merged.auditTrail = structuredClone(mergedResume.auditTrail || []);
  merged.photoTombstones = structuredClone(mergedResume.photoTombstones || {});
  return applyInspectionPhotoTombstones(merged, merged.photoTombstones);
}

function mergeInspectionRecords(remote, incoming) {
  remote = isPlainObject(remote) ? remote : {};
  incoming = isPlainObject(incoming) ? incoming : {};
  const merged = { ...structuredClone(remote), ...structuredClone(incoming) };
  const stepData = {};
  const stepIds = new Set([...Object.keys(remote.stepData || {}), ...Object.keys(incoming.stepData || {})]);
  for (const stepId of stepIds) stepData[stepId] = mergeInspectionStep(remote.stepData && remote.stepData[stepId], incoming.stepData && incoming.stepData[stepId]);
  merged.stepData = stepData;
  merged.findings = mergeById(remote.findings, incoming.findings, 'findingId');
  merged.sparePhotos = mergeInspectionPhotos(remote.sparePhotos, incoming.sparePhotos);
  merged.commentLibrary = mergeCommentLibrary(remote.commentLibrary, incoming.commentLibrary);
  merged.auditTrail = mergeById(remote.auditTrail, incoming.auditTrail, 'auditId', 500);
  merged.photoTombstones = { ...structuredClone(remote.photoTombstones || {}) };
  for (const [photoId, candidate] of Object.entries(incoming.photoTombstones || {})) {
    const current = merged.photoTombstones[photoId];
    if (!current || timeValue(candidate.updatedAt) >= timeValue(current.updatedAt)) merged.photoTombstones[photoId] = structuredClone(candidate);
  }
  const remoteCollaboration = isPlainObject(remote.collaboration) ? remote.collaboration : {};
  const incomingCollaboration = isPlainObject(incoming.collaboration) ? incoming.collaboration : {};
  const collaboration = { ...structuredClone(remoteCollaboration), ...structuredClone(incomingCollaboration) };
  collaboration.enabled = !!(remoteCollaboration.enabled || incomingCollaboration.enabled);
  collaboration.members = mergeById(remoteCollaboration.members, incomingCollaboration.members, 'memberId');
  collaboration.activity = mergeById(remoteCollaboration.activity, incomingCollaboration.activity, 'activityId', 100);
  collaboration.assignments = mergeTimestampMap(remoteCollaboration.assignments, incomingCollaboration.assignments);
  collaboration.presence = mergeTimestampMap(remoteCollaboration.presence, incomingCollaboration.presence);
  collaboration.serverMergedAt = new Date().toISOString();
  merged.collaboration = collaboration;
  merged._serverMergedAt = collaboration.serverMergedAt;
  return applyInspectionPhotoTombstones(merged, merged.photoTombstones);
}

function applyInspectionPhotoTombstones(value, tombstones) {
  const source = isPlainObject(tombstones) ? tombstones : {};
  const deletedPhotoIds = new Set(
    Object.entries(source)
      .filter(([, item]) => String(item && item.status || '').toLowerCase() === 'deleted')
      .map(([photoId]) => photoId)
  );
  if (!deletedPhotoIds.size || !value || typeof value !== 'object') return value;

  const visit = candidate => {
    if (Array.isArray(candidate)) {
      return candidate
        .filter(item => !(item && item.photoId && deletedPhotoIds.has(item.photoId)))
        .map(visit);
    }
    if (!isPlainObject(candidate)) return candidate;
    for (const [key, child] of Object.entries(candidate)) {
      if (key === 'photoTombstones') continue;
      candidate[key] = visit(child);
    }
    return candidate;
  };

  return visit(structuredClone(value));
}

function mergeInspectionStep(remoteStep, incomingStep) {
  const remote = isPlainObject(remoteStep) ? remoteStep : {};
  const incoming = isPlainObject(incomingStep) ? incomingStep : {};
  const incomingNewer = timeValue(incoming._updatedAt) >= timeValue(remote._updatedAt);
  const merged = { ...structuredClone(incomingNewer ? remote : incoming), ...structuredClone(incomingNewer ? incoming : remote) };
  const remoteUpdates = isPlainObject(remote._fieldUpdates) ? remote._fieldUpdates : {};
  const incomingUpdates = isPlainObject(incoming._fieldUpdates) ? incoming._fieldUpdates : {};
  const mergedUpdates = { ...structuredClone(remoteUpdates) };
  const keys = new Set([...Object.keys(remote), ...Object.keys(incoming)]);
  for (const key of keys) {
    if (key === '_fieldUpdates') continue;
    const remoteValue = remote[key];
    const incomingValue = incoming[key];
    if (looksLikePhotoArray(remoteValue) || looksLikePhotoArray(incomingValue)) {
      merged[key] = mergeInspectionPhotos(remoteValue, incomingValue);
      continue;
    }
    const remoteMeta = remoteUpdates[key];
    const incomingMeta = incomingUpdates[key];
    if (remoteMeta || incomingMeta) {
      const useIncoming = timeValue(incomingMeta && incomingMeta.updatedAt) >= timeValue(remoteMeta && remoteMeta.updatedAt);
      const chosen = useIncoming ? incomingValue : remoteValue;
      if (chosen === undefined) delete merged[key];
      else merged[key] = structuredClone(chosen);
      if (useIncoming && incomingMeta) mergedUpdates[key] = structuredClone(incomingMeta);
    }
  }
  merged._fieldUpdates = mergedUpdates;
  return merged;
}

function mergeInspectionPhotos(remotePhotos, incomingPhotos) {
  const byId = new Map();
  for (const photo of [...(Array.isArray(remotePhotos) ? remotePhotos : []), ...(Array.isArray(incomingPhotos) ? incomingPhotos : [])]) {
    if (!photo || !photo.photoId) continue;
    const current = byId.get(photo.photoId);
    if (!current) {
      byId.set(photo.photoId, structuredClone(photo));
      continue;
    }
    const useIncoming = timeValue(photo.updatedAt || photo.timestamp) >= timeValue(current.updatedAt || current.timestamp);
    const newer = useIncoming ? photo : current;
    const older = useIncoming ? current : photo;
    byId.set(photo.photoId, {
      ...structuredClone(older),
      ...structuredClone(newer),
      dataUrl: newer.dataUrl || older.dataUrl,
      thumbnailDataUrl: newer.thumbnailDataUrl || older.thumbnailDataUrl,
      originalDataUrl: newer.originalDataUrl || older.originalDataUrl
    });
  }
  return [...byId.values()];
}

function mergeById(remoteItems, incomingItems, idKey, limit = 0) {
  const byId = new Map();
  for (const item of [...(Array.isArray(remoteItems) ? remoteItems : []), ...(Array.isArray(incomingItems) ? incomingItems : [])]) {
    const id = item && item[idKey];
    if (!id) continue;
    const current = byId.get(id);
    if (!current || timeValue(item.updatedAt || item.createdAt) >= timeValue(current.updatedAt || current.createdAt)) byId.set(id, structuredClone(item));
  }
  const values = [...byId.values()].sort((a, b) => timeValue(b.createdAt || b.updatedAt) - timeValue(a.createdAt || a.updatedAt));
  return limit ? values.slice(0, limit) : values;
}

function mergeCommentLibrary(remoteItems, incomingItems) {
  const byText = new Map();
  for (const item of [...(Array.isArray(remoteItems) ? remoteItems : []), ...(Array.isArray(incomingItems) ? incomingItems : [])]) {
    const key = String(item && (item.cleanedText || item.text) || '').trim().replace(/\s+/g, ' ').toLowerCase();
    if (!key) continue;
    const current = byText.get(key);
    if (!current || timeValue(item.updatedAt || item.approvedAt) >= timeValue(current.updatedAt || current.approvedAt)) byText.set(key, structuredClone(item));
  }
  return [...byText.values()];
}

function mergeTimestampMap(remoteMap, incomingMap) {
  const merged = { ...structuredClone(isPlainObject(remoteMap) ? remoteMap : {}) };
  for (const [key, candidate] of Object.entries(isPlainObject(incomingMap) ? incomingMap : {})) {
    const current = merged[key];
    if (!current || timeValue(candidate && candidate.updatedAt) >= timeValue(current && current.updatedAt)) merged[key] = structuredClone(candidate);
  }
  return merged;
}

function looksLikePhotoArray(value) {
  return Array.isArray(value) && value.some(item => item && item.photoId);
}

function timeValue(value) {
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? parsed : 0;
}

async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(String(value || ''));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function handleStartInspectionShell(request, env) {
  requireEnv(env, ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'UPLOAD_SECRET', 'GOOGLE_SERVICE_ACCOUNT']);
  const body = await readJson(request);
  validateSharedSecret(body, env);

  const inspectionId = cleanId(body.inspectionId || body.id, 'inspectionId');
  const requestedClassification = requireExplicitAssessmentClassification(body);
  const existing = await getStartInspectionShellState(env, inspectionId);
  assertAssessmentClassificationMatchesShell(existing, body);
  if (startInspectionShellIsReady(existing)) {
    if (existing.isTestTraining === true && existing.folderId) {
      return json({ ...existing, cached: true });
    }
    if (existing.isTestTraining !== true && existing.folderId && existing.trackerRow && existing.trackerUrl) {
      return json({ ...existing, cached: true });
    }
  }
  if (requestedClassification === 'test') {
    const accessToken = await getGoogleAccessToken(env);
    const receipt = await ensureTestHandoffShell(env, accessToken, { ...body, inspectionId });
    await upsertAssessmentShellRecord(env, { ...body, inspectionId }, receipt);
    await saveStartInspectionShellState(env, inspectionId, receipt);
    return json(receipt);
  }

  const trackerSheetId = String(env.REPORT_TRACKER_SHEET_ID || body.reportTrackerSheetId || '').trim();
  if (!trackerSheetId) throw new Error('missing_report_tracker_sheet_id');
  const assessmentsFolderId = String(env.ASSESSMENTS_FOLDER_ID || body.sharedDriveFolderId || body.driveFolderId || '').trim();
  if (!assessmentsFolderId) throw new Error('missing_assessments_folder_id');

  const accessToken = await getGoogleAccessToken(env);
  const trackerContext = await getTrackerContext(accessToken, trackerSheetId);
  const inspectionColumn = trackerContext.columns.inhId || 10;
  const existingTrackerRow = findTrackerRowByInspectionIdValues(trackerContext.values, inspectionColumn, inspectionId);
  const reservation = await resolveAssessmentNumberReservation(env, body, trackerContext, existingTrackerRow);
  const assessmentNumber = reservation.assessmentNumber;
  const folderName = generateAssessmentFolderName(assessmentNumber, body);
  const folder = await getOrCreateDriveFolder(accessToken, assessmentsFolderId, folderName);
  const photosFolder = await getOrCreateDriveFolder(accessToken, folder.id, assessmentSubfolderName('Photos', body));
  const cocsFolder = await getOrCreateDriveFolder(accessToken, folder.id, assessmentSubfolderName('COCs', body));
  const backupFolder = await getOrCreateDriveFolder(accessToken, folder.id, assessmentSubfolderName('Backup', body));
  const trackerResult = await upsertReportTrackerRow(accessToken, trackerSheetId, trackerContext, body, {
    folder,
    assessmentNumber,
    existingTrackerRow
  });
  await verifyTrackerReservation(accessToken, trackerSheetId, inspectionId, assessmentNumber, trackerResult.row);

  const now = new Date().toISOString();
  const receipt = {
    status: 'ready',
    shellStatus: 'ready',
    isTestTraining: false,
    inspectionId,
    assessmentNumber,
    assessmentNumberSource: reservation.source,
    assessmentReservationId: reservation.reservationId || '',
    folderId: folder.id,
    folderUrl: driveFolderUrl(folder),
    folderName,
    photosFolderId: photosFolder.id,
    photosFolderUrl: driveFolderUrl(photosFolder),
    technicianPhotosFolderId: photosFolder.id,
    technicianPhotosFolderUrl: driveFolderUrl(photosFolder),
    cocsFolderId: cocsFolder.id,
    cocsFolderUrl: driveFolderUrl(cocsFolder),
    backupFolderId: backupFolder.id,
    backupFolderUrl: driveFolderUrl(backupFolder),
    trackerRow: trackerResult.row,
    trackerUrl: trackerResult.url,
    trackerStatus: trackerResult.status,
    createdAt: existing && existing.createdAt ? existing.createdAt : now,
    updatedAt: now,
    workerVersion: WORKER_VERSION,
    error: ''
  };

  await upsertAssessmentShellRecord(env, body, receipt);
  await saveStartInspectionShellState(env, inspectionId, receipt);
  return json(receipt);
}

async function handleHandoffJob(request, env, ctx) {
  requireEnv(env, ['SUPABASE_URL', 'SUPABASE_BUCKET', 'SUPABASE_SERVICE_KEY', 'REVIEW_ACCESS_TOKEN', 'GOOGLE_SERVICE_ACCOUNT']);
  const body = await readJson(request);
  if (!isReviewAuthorized(request, body.token, env)) return json({ error: 'unauthorized' }, 401);

  const inspectionId = cleanId(body.inspectionId || body.id, 'inspectionId');
  const row = await getReviewRow(env, inspectionId);
  const storedFieldData = row && isPlainObject(row.field_data) ? structuredClone(row.field_data) : {};
  const suppliedFieldData = isPlainObject(body.reviewedData) ? structuredClone(body.reviewedData) : {};
  const fieldData = {
    ...storedFieldData,
    ...suppliedFieldData,
    system: {
      ...(isPlainObject(storedFieldData.system) ? storedFieldData.system : {}),
      ...(isPlainObject(suppliedFieldData.system) ? suppliedFieldData.system : {})
    }
  };
  const system = isPlainObject(fieldData.system) ? fieldData.system : {};
  const assessmentRow = await getAssessmentRow(env, inspectionId);
  const canonicalSource = buildCanonicalAssessmentSource(assessmentRow);
  const receiptExpectations = {
    expectedRoomCount: Array.isArray(canonicalSource.rooms) ? canonicalSource.rooms.length : 0
  };
  const existingReceipt = getReadyHandoffReceipt(fieldData, receiptExpectations);
  if (body.forceFullRepair !== true && existingReceipt) {
    const cachedJob = {
      jobId: handoffJobId(inspectionId),
      inspectionId,
      status: 'ready',
      requestedBy: body.requestedBy || 'review-portal',
      requestedAt: existingReceipt.createdAt || existingReceipt.updatedAt || new Date().toISOString(),
      isTestTraining: existingReceipt.isTestTraining === true,
      attemptCount: Number(system.handoffJob && system.handoffJob.attemptCount) || 1,
      lastError: '',
      finishedAt: existingReceipt.updatedAt || '',
      artifactReceipt: existingReceipt
    };
    await upsertDurableHandoffJob(env, inspectionId, cachedJob, existingReceipt);
    return json({ ...cachedJob, reviewPortalData: existingReceipt, cached: true });
  }

  const durableJob = await getDurableHandoffJob(env, inspectionId);
  const durableReceipt = durableJob && isPlainObject(durableJob.receipt) ? durableJob.receipt : null;
  if (body.forceFullRepair !== true && durableReceipt && isReadyHandoffReceipt(durableReceipt, receiptExpectations)) {
    const cachedJob = durableJobToPublicJob(durableJob);
    return json({
      ...cachedJob,
      status: 'ready',
      artifactReceipt: durableReceipt,
      reviewPortalData: durableReceipt,
      cached: true
    });
  }
  if (isFreshDirectHandoffLock(durableJob)) {
    const activeJob = durableJobToPublicJob(durableJob);
    return json({
      ...activeJob,
      artifactReceipt: durableReceipt,
      reviewPortalData: durableReceipt,
      cached: false,
      inFlight: true
    }, 202);
  }

  const now = new Date().toISOString();
  const previousJob = isPlainObject(system.handoffJob) ? system.handoffJob : {};
  const runningJob = {
    jobId: previousJob.jobId || handoffJobId(inspectionId),
    inspectionId,
    requestedBy: body.requestedBy || 'review-portal',
    requestedAt: previousJob.requestedAt || now,
    isTestTraining: isTestTrainingInspection({ ...fieldData, ...body }),
    status: previousJob.status === 'failed' ? 'repairing' : 'running',
    attemptCount: (Number(previousJob.attemptCount) || 0) + 1,
    lastError: '',
    startedAt: now,
    finishedAt: '',
    submitAttempt: isPlainObject(body.submitAttempt) ? body.submitAttempt : null,
    artifactReceipt: null
  };
  if (body.runInline !== true) {
    const queuedJob = {
      ...runningJob,
      status: 'queued',
      lockedAt: '',
      lockedBy: ''
    };
    await saveHandoffRequestFieldData(env, inspectionId, fieldData);
    const queued = await queueDurableHandoffJob(env, inspectionId, queuedJob, durableReceipt, durableJob);
    if (!queued.acquired) {
      const activeJob = durableJobToPublicJob(queued.row) || queuedJob;
      const activeReceipt = queued.row && isPlainObject(queued.row.receipt) ? queued.row.receipt : durableReceipt;
      if (activeReceipt && isReadyHandoffReceipt(activeReceipt, receiptExpectations)) {
        return json({
          ...activeJob,
          status: 'ready',
          artifactReceipt: activeReceipt,
          reviewPortalData: activeReceipt,
          cached: true
        });
      }
      return json({
        ...activeJob,
        artifactReceipt: activeReceipt,
        reviewPortalData: activeReceipt,
        cached: false,
        queued: activeJob.status === 'queued',
        inFlight: activeJob.status !== 'queued'
      }, 202);
    }
    return json({
      ...queuedJob,
      status: 'queued',
      artifactReceipt: durableReceipt,
      reviewPortalData: durableReceipt,
      queued: true
    }, 202);
  }
  const claim = await claimDirectHandoffJob(env, inspectionId, runningJob, body.forceFullRepair === true);
  if (!claim.acquired) {
    const existingJob = durableJobToPublicJob(claim.row) || runningJob;
    const activeReceipt = isPlainObject(claim.row && claim.row.receipt) ? claim.row.receipt : null;
    if (activeReceipt && isReadyHandoffReceipt(activeReceipt, receiptExpectations)) {
      return json({
        ...existingJob,
        status: 'ready',
        artifactReceipt: activeReceipt,
        reviewPortalData: activeReceipt,
        cached: true
      });
    }
    return json({
      ...existingJob,
      artifactReceipt: activeReceipt,
      reviewPortalData: activeReceipt,
      cached: false,
      inFlight: true
    }, 202);
  }

  const claimedJob = {
    ...runningJob,
    durableJobId: claim.row.id || '',
    lockedAt: claim.row.locked_at || '',
    lockedBy: claim.row.locked_by || ''
  };
  await saveHandoffJobState(env, inspectionId, fieldData, claimedJob, null, { preferProvidedFieldData: true });

  if (body.background === true && ctx && typeof ctx.waitUntil === 'function') {
    ctx.waitUntil(processHandoffJobBatch(env, inspectionId, body, claimedJob));
    return json({ ...claimedJob, status: 'queued', background: true }, 202);
  }

  const result = await processHandoffJobBatch(env, inspectionId, body, claimedJob);
  return json(
    { ...result.job, reviewPortalData: result.receipt, error: result.error || '' },
    result.ready ? 200 : (result.pending ? 202 : 500)
  );
}

async function handleHandoffJobRunner(request, env, ctx) {
  requireEnv(env, ['SUPABASE_URL', 'SUPABASE_BUCKET', 'SUPABASE_SERVICE_KEY', 'REVIEW_ACCESS_TOKEN', 'GOOGLE_SERVICE_ACCOUNT']);
  const body = await readJson(request);
  if (!isRunnerAuthorized(request, body, env)) return json({ error: 'unauthorized' }, 401);

  const inspectionId = body.inspectionId || body.id ? cleanId(body.inspectionId || body.id, 'inspectionId') : '';
  if (inspectionId) {
    const durableJob = await getDurableHandoffJob(env, inspectionId);
    const reviewRow = await getReviewRow(env, inspectionId);
    const reviewFieldData = reviewRow && isPlainObject(reviewRow.field_data) ? reviewRow.field_data : {};
    const reviewSystem = isPlainObject(reviewFieldData.system) ? reviewFieldData.system : {};
    const reviewJob = isPlainObject(reviewSystem.handoffJob) ? reviewSystem.handoffJob : {};
    const assessmentRow = await getAssessmentRow(env, inspectionId);
    const canonicalSource = buildCanonicalAssessmentSource(assessmentRow);
    const receiptExpectations = {
      expectedRoomCount: Array.isArray(canonicalSource.rooms) ? canonicalSource.rooms.length : 0
    };
    const durableReceipt = durableJob && isPlainObject(durableJob.receipt)
      ? durableJob.receipt
      : (isPlainObject(reviewSystem.tannerHandoff) ? reviewSystem.tannerHandoff : null);
    if (body.forceFullRepair !== true && durableReceipt && isReadyHandoffReceipt(durableReceipt, receiptExpectations)) {
      return json({
        processed: 1,
        results: [{
          ...publicHandoffRunResult({
            job: durableJobToPublicJob(durableJob),
            receipt: durableReceipt,
            ready: true,
            pending: false,
            failed: false
          }),
          cached: true
        }]
      });
    }
    const durablePublicJob = durableJobToPublicJob(durableJob) || {};
    const previousJob = {
      ...reviewJob,
      ...durablePublicJob,
      attemptCount: Math.max(Number(reviewJob.attemptCount) || 0, Number(durablePublicJob.attemptCount) || 0)
    };
    const runnerJob = {
      ...previousJob,
      jobId: previousJob.jobId || handoffJobId(inspectionId),
      inspectionId,
      requestedBy: body.requestedBy || 'handoff-runner',
      requestedAt: previousJob.requestedAt || new Date().toISOString(),
      status: previousJob.status === 'failed' ? 'repairing' : 'running',
      attemptCount: (Number(previousJob.attemptCount) || 0) + 1,
      artifactReceipt: durableReceipt
    };
    const claim = await claimDirectHandoffJob(env, inspectionId, runnerJob, body.forceFullRepair === true);
    if (!claim.acquired) {
      return json({
        processed: 0,
        inFlight: true,
        results: [{
          inspectionId,
          status: 'running',
          ready: false,
          pending: true,
          failed: false,
          attemptCount: Number(previousJob.attemptCount || 0),
          error: ''
        }]
      }, 202);
    }
    const claimedJob = {
      ...runnerJob,
      durableJobId: claim.row.id || '',
      lockedAt: claim.row.locked_at || '',
      lockedBy: claim.row.locked_by || ''
    };
    const result = await processHandoffJobBatch(env, inspectionId, {
      ...body,
      requestedBy: body.requestedBy || 'handoff-runner'
    }, claimedJob);
    return json(
      { processed: 1, results: [publicHandoffRunResult(result)] },
      result.ready ? 200 : (result.pending ? 202 : 500)
    );
  }

  if (body.background === true && ctx && typeof ctx.waitUntil === 'function') {
    ctx.waitUntil(runDueHandoffJobs(env, {
      limit: Number(body.limit || HANDOFF_RUNNER_LIMIT_DEFAULT),
      requestedBy: body.requestedBy || 'handoff-runner'
    }));
    return json({ queued: true, background: true }, 202);
  }

  const result = await runDueHandoffJobs(env, {
    limit: Number(body.limit || HANDOFF_RUNNER_LIMIT_DEFAULT),
    requestedBy: body.requestedBy || 'handoff-runner'
  });
  return json(result, result.failedCount ? 207 : 200);
}

async function handleHandoffJobStatus(request, url, env) {
  requireEnv(env, ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'REVIEW_ACCESS_TOKEN']);
  if (!isReviewAuthorized(request, url.searchParams.get('token'), env)) return json({ error: 'unauthorized' }, 401);

  const pathPart = decodeURIComponent(url.pathname.replace(/^\/handoff-jobs\/?/, '')).trim();
  const inspectionId = cleanId(url.searchParams.get('inspectionId') || pathPart.replace(/^handoff_/, '').replace(/_.+$/, ''), 'inspectionId');
  const durableJob = await getDurableHandoffJob(env, inspectionId);
  const row = await getReviewRow(env, inspectionId);
  const fieldData = row && isPlainObject(row.field_data) ? row.field_data : {};
  const system = isPlainObject(fieldData.system) ? fieldData.system : {};
  const reviewJob = isPlainObject(system.handoffJob) ? system.handoffJob : null;
  const job = durableJob ? durableJobToPublicJob(durableJob) : reviewJob;
  const receipt = durableJob && isPlainObject(durableJob.receipt)
    ? durableJob.receipt
    : getHandoffReceiptFromFieldData(fieldData);
  return json({
    inspectionId,
    job,
    artifactReceipt: receipt,
    reviewPortalData: receipt,
    updatedAt: row && row.updated_at ? row.updated_at : null
  });
}

async function processHandoffJobBatch(env, inspectionId, body = {}, seedJob = null) {
  let fieldData = {};
  try {
    const durableJob = await getDurableHandoffJob(env, inspectionId);
    const row = await getReviewRow(env, inspectionId);
    fieldData = row && isPlainObject(row.field_data) ? structuredClone(row.field_data) : {};
    const system = isPlainObject(fieldData.system) ? fieldData.system : {};
    const previousJob = isPlainObject(system.handoffJob) ? system.handoffJob : {};
    const now = new Date().toISOString();
    const durablePublicJob = durableJob ? durableJobToPublicJob(durableJob) : {};
    const baseJob = isPlainObject(seedJob) ? seedJob : {
      jobId: durablePublicJob.jobId || previousJob.jobId || handoffJobId(inspectionId),
      inspectionId,
      requestedBy: body.requestedBy || durablePublicJob.requestedBy || previousJob.requestedBy || 'handoff-runner',
      requestedAt: durablePublicJob.requestedAt || previousJob.requestedAt || now,
      attemptCount: Number(durablePublicJob.attemptCount || previousJob.attemptCount) || 0,
      submitAttempt: previousJob.submitAttempt || (durableJob && durableJob.payload && durableJob.payload.submitAttempt) || null
    };
    const previousAttemptCount = Math.max(
      Number(baseJob.attemptCount) || 0,
      Number(durablePublicJob.attemptCount) || 0,
      Number(previousJob.attemptCount) || 0
    );
    const attemptCount = isPlainObject(seedJob) ? previousAttemptCount : previousAttemptCount + 1;
    const activeJob = {
      ...baseJob,
      status: baseJob.status === 'queued' ? 'running' : (baseJob.status || 'running'),
      attemptCount,
      startedAt: now,
      lastRunAt: now,
      nextRunAt: '',
      lastError: ''
    };

    const accessToken = await getGoogleAccessToken(env);
    const receipt = await createOrRepairTannerHandoff(env, accessToken, inspectionId, fieldData, body);
    const ready = isReadyHandoffReceipt(receipt);
    const pending = !ready && receipt.status === 'running';
    const finishedAt = new Date().toISOString();
    const nextRunAt = ready ? '' : getNextHandoffRunAt(activeJob.attemptCount, finishedAt, pending);
    receipt.attemptCount = activeJob.attemptCount;
    receipt.lastRunAt = activeJob.lastRunAt;
    receipt.nextRunAt = nextRunAt;
    const finishedJob = {
      ...activeJob,
      status: ready ? 'ready' : (pending ? 'running' : 'failed'),
      lastError: ready || pending ? '' : (receipt.error || 'handoff_receipt_incomplete'),
      finishedAt: pending ? '' : finishedAt,
      nextRunAt,
      lockedAt: '',
      lockedBy: '',
      artifactReceipt: receipt
    };
    await saveHandoffJobState(env, inspectionId, fieldData, finishedJob, receipt);
    return { job: finishedJob, receipt, ready, pending, failed: !ready && !pending, error: finishedJob.lastError || '' };
  } catch (err) {
    const failedAt = new Date().toISOString();
    const system = isPlainObject(fieldData.system) ? fieldData.system : {};
    const previousJob = isPlainObject(system.handoffJob) ? system.handoffJob : {};
    const previousAttemptCount = Math.max(
      Number(seedJob && seedJob.attemptCount) || 0,
      Number(previousJob.attemptCount) || 0
    );
    const attemptCount = isPlainObject(seedJob) ? previousAttemptCount : previousAttemptCount + 1;
    const partialReceipt = buildPartialFailedHandoffReceipt(fieldData);
    const failedReceipt = {
      ...partialReceipt,
      status: 'failed',
      inspectionId,
      isTestTraining: isTestTrainingInspection({ ...fieldData, ...body }),
      error: err && err.message ? err.message : String(err),
      attemptCount,
      lastRunAt: failedAt,
      nextRunAt: getNextHandoffRunAt(attemptCount, failedAt, false),
      updatedAt: failedAt,
      workerVersion: WORKER_VERSION,
      schemaVersion: HANDOFF_RECEIPT_SCHEMA_VERSION
    };
    const failedJob = {
      ...(isPlainObject(seedJob) ? seedJob : {}),
      jobId: (seedJob && seedJob.jobId) || handoffJobId(inspectionId),
      inspectionId,
      requestedBy: body.requestedBy || (seedJob && seedJob.requestedBy) || 'handoff-runner',
      status: 'failed',
      attemptCount,
      lastError: failedReceipt.error,
      lastRunAt: failedAt,
      nextRunAt: failedReceipt.nextRunAt,
      finishedAt: failedAt,
      lockedAt: '',
      lockedBy: '',
      artifactReceipt: failedReceipt
    };
    await saveHandoffJobState(env, inspectionId, fieldData, failedJob, failedReceipt);
    return { job: failedJob, receipt: failedReceipt, ready: false, pending: false, failed: true, error: failedReceipt.error };
  }
}

async function runDueHandoffJobs(env, options = {}) {
  const limit = Math.max(1, Math.min(25, Number(options.limit || HANDOFF_RUNNER_LIMIT_DEFAULT) || HANDOFF_RUNNER_LIMIT_DEFAULT));
  const rows = await listDueHandoffRows(env, limit);
  const results = [];
  for (const row of rows) {
    const inspectionId = cleanId(row.inspection_id, 'inspectionId');
    const result = await processHandoffJobBatch(env, inspectionId, {
      requestedBy: options.requestedBy || 'handoff-runner'
    }, null);
    results.push(publicHandoffRunResult(result));
  }
  return {
    processed: results.length,
    readyCount: results.filter(result => result.status === 'ready').length,
    pendingCount: results.filter(result => result.status === 'running' || result.status === 'queued').length,
    failedCount: results.filter(result => result.status === 'failed').length,
    results
  };
}

async function listDueHandoffRows(env, limit) {
  const durableRows = await listDueDurableHandoffRows(env, limit);
  if (durableRows.length) return durableRows;
  return [];
}

async function listDueDurableHandoffRows(env, limit) {
  const claimLimit = Math.max(1, Math.min(25, Number(limit) || HANDOFF_RUNNER_LIMIT_DEFAULT));
  const res = await fetch(normalizeSupabaseUrl(env, '/rest/v1/rpc/claim_due_handoff_jobs'), {
    method: 'POST',
    headers: serviceHeaders(env, {
      'Content-Type': 'application/json'
    }),
    body: JSON.stringify({
      p_limit: claimLimit,
      p_worker_id: WORKER_VERSION
    })
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`handoff_due_claim_failed:${res.status}:${text.slice(0, 200)}`);
  const rows = text ? JSON.parse(text) : [];
  return (Array.isArray(rows) ? rows : []).filter(isDueDurableHandoffRow).slice(0, limit);
}

function isDueDurableHandoffRow(row) {
  const jobStatus = normalizeHandoffJobStatus(row && row.status);
  const receipt = row && isPlainObject(row.receipt) ? row.receipt : {};
  const receiptStatus = String(receipt.status || '').trim().toLowerCase().replace(/[\s_]+/g, '-');
  const nextRunAt = (row && row.next_run_at) || receipt.nextRunAt || '';
  if (nextRunAt && Date.parse(nextRunAt) > Date.now()) return false;
  if (['queued', 'running', 'repairing', 'waiting_on_export_adapter'].includes(jobStatus)) return true;
  if (jobStatus === 'failed' && nextRunAt) return true;
  return receiptStatus === 'running' || Number(receipt && receipt.photoFolderPendingCount || 0) > 0;
}

function getNextHandoffRunAt(attemptCount, fromIso, isPending) {
  const attempt = Math.max(1, Number(attemptCount) || 1);
  const base = Date.parse(fromIso) || Date.now();
  const multiplier = isPending ? 1 : Math.min(16, Math.pow(2, Math.max(0, attempt - 1)));
  const delayMs = Math.min(HANDOFF_RETRY_MAX_DELAY_MS, HANDOFF_RETRY_BASE_DELAY_MS * multiplier);
  return new Date(base + delayMs).toISOString();
}

function publicHandoffRunResult(result) {
  const receipt = result && result.receipt ? result.receipt : {};
  return {
    inspectionId: receipt.inspectionId || (result && result.job && result.job.inspectionId) || '',
    status: receipt.status || (result && result.job && result.job.status) || '',
    ready: result && result.ready === true,
    pending: result && result.pending === true,
    failed: result && result.failed === true,
    folderUrl: receipt.folderUrl || '',
    spreadsheetUrl: receipt.spreadsheetUrl || '',
    rawJsonUrl: receipt.rawJsonUrl || '',
    trackerUrl: receipt.trackerUrl || '',
    photoFolderAlreadyPackagedCount: Number(receipt.photoFolderAlreadyPackagedCount || 0),
    photoFolderCopiedCount: Number(receipt.photoFolderCopiedCount || 0),
    photoFolderLinkedCount: Number(receipt.photoFolderLinkedCount || 0),
    photoFolderPendingCount: Number(receipt.photoFolderPendingCount || 0),
    photoFolderFailedCount: Number(receipt.photoFolderFailedCount || receipt.technicianPhotoFailedCount || 0),
    attemptCount: Number(result && result.job && result.job.attemptCount || 0),
    nextRunAt: (result && result.job && result.job.nextRunAt) || receipt.nextRunAt || '',
    error: result && result.error || receipt.error || ''
  };
}

function isRunnerAuthorized(request, body, env) {
  if (isReviewAuthorized(request, body && body.token, env)) return true;
  const configured = String(env.HANDOFF_RUNNER_TOKEN || '').trim();
  if (!configured) return false;
  const authorization = String(request.headers.get('Authorization') || '');
  const bearerToken = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
  const provided = bearerToken || String((body && (body.runnerToken || body.handoffRunnerToken)) || '');
  return provided === configured;
}

async function handleMetadataUpdate(request, env) {
  requireEnv(env, ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'UPLOAD_SECRET']);
  const body = await readJson(request);
  validateSharedSecret(body, env);

  const inspectionId = cleanId(body.inspectionId, 'inspectionId');
  const photoId = cleanId(body.photoId, 'photoId');
  const updated = await updatePhotoMetadata(env, inspectionId, photoId, {
    room_name: String(body.roomName || ''),
    step_name: String(body.stepName || ''),
    caption: String(body.caption || ''),
    slot: normalizeSlot(body.slot)
  });

  return json({ updated: true, inspectionId, photoId, photo: updated });
}

async function handleDelete(request, env) {
  requireEnv(env, ['SUPABASE_URL', 'SUPABASE_BUCKET', 'SUPABASE_SERVICE_KEY', 'UPLOAD_SECRET']);
  const body = await readJson(request);
  validateSharedSecret(body, env);
  const inspectionId = cleanId(body.inspectionId, 'inspectionId');
  const photoId = cleanId(body.photoId, 'photoId');
  return await deletePhotoRecord(env, inspectionId, photoId);
}

async function handleReviewPhotoDelete(request, env) {
  requireEnv(env, ['SUPABASE_URL', 'SUPABASE_BUCKET', 'SUPABASE_SERVICE_KEY', 'REVIEW_ACCESS_TOKEN']);
  const body = await readJson(request);
  if (!isReviewAuthorized(request, body.token, env)) return json({ error: 'unauthorized' }, 401);
  const inspectionId = cleanId(body.inspectionId, 'inspectionId');
  const photoId = cleanId(body.photoId, 'photoId');
  return await deletePhotoRecord(env, inspectionId, photoId);
}

async function deletePhotoRecord(env, inspectionId, photoId) {
  const storagePath = storagePathFor(inspectionId, photoId);
  const photoRows = await getPhotoRowsForDelete(env, inspectionId, photoId);
  const existingDriveUrl = String(photoRows[0] && photoRows[0].drive_url || '');

  const objectResponse = await fetch(normalizeSupabaseUrl(env, `/storage/v1/object/${encodeURIComponent(env.SUPABASE_BUCKET)}`), {
    method: 'DELETE',
    headers: serviceHeaders(env, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ prefixes: [storagePath] })
  });
  if (!objectResponse.ok && objectResponse.status !== 404) {
    throw new Error(`photo_storage_delete_failed:${objectResponse.status}:${(await objectResponse.text()).slice(0, 120)}`);
  }

  const params = new URLSearchParams();
  params.set('inspection_id', `eq.${inspectionId}`);
  params.set('photo_id', `eq.${photoId}`);
  const metadataResponse = await fetch(normalizeSupabaseUrl(env, `/rest/v1/inspector_photo_uploads?${params}`), {
    method: 'DELETE', headers: serviceHeaders(env)
  });
  let metadata = 'deleted';
  if (!metadataResponse.ok) {
    // Production intentionally grants UPDATE but not DELETE on this table.
    // Tombstone the existing row without a schema change, then exclude it from
    // every read/mirror/confirmation query below.
    const tombstoneResponse = await fetch(normalizeSupabaseUrl(env, `/rest/v1/inspector_photo_uploads?${params}`), {
      method: 'PATCH',
      headers: serviceHeaders(env, { 'Content-Type': 'application/json', 'Prefer': 'return=minimal' }),
      body: JSON.stringify({ source_system: 'deleted', drive_url: null, caption: '', room_name: '', step_name: '', slot: null })
    });
    if (!tombstoneResponse.ok) {
      throw new Error(`photo_metadata_tombstone_failed:${tombstoneResponse.status}:${(await tombstoneResponse.text()).slice(0, 120)}`);
    }
    metadata = 'tombstoned';
  }

  let driveCleanup = { deletedCount: 0, matchedFileIds: [] };
  let driveDeleteWarning = '';
  try {
    driveCleanup = await deleteManagedDrivePhotoCopies(env, inspectionId, photoId, existingDriveUrl);
  } catch (err) {
    driveDeleteWarning = err && err.message ? err.message : String(err);
  }

  return json({
    deleted: true,
    metadata,
    inspectionId,
    photoId,
    driveDeletedCount: driveCleanup.deletedCount,
    driveDeleteWarning
  });
}

async function getPhotoRowsForDelete(env, inspectionId, photoId) {
  const params = new URLSearchParams();
  params.set('inspection_id', `eq.${inspectionId}`);
  params.set('photo_id', `eq.${photoId}`);
  params.set('select', 'photo_id,drive_url');
  params.set('limit', '10');
  const response = await fetch(normalizeSupabaseUrl(env, `/rest/v1/inspector_photo_uploads?${params}`), {
    headers: serviceHeaders(env)
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`photo_delete_lookup_failed:${response.status}:${text.slice(0, 120)}`);
  const rows = text ? JSON.parse(text) : [];
  return Array.isArray(rows) ? rows : [];
}

async function deleteManagedDrivePhotoCopies(env, inspectionId, photoId, driveUrl) {
  if (!env.GOOGLE_SERVICE_ACCOUNT) return { deletedCount: 0, matchedFileIds: [] };
  const shell = await getStartInspectionShellState(env, inspectionId);
  const photosFolderId = firstNonEmpty(
    shell && shell.photosFolderId,
    shell && shell.technicianPhotosFolderId
  );
  const accessToken = await getGoogleAccessToken(env);
  const matchedFileIds = new Set();
  const directDriveId = extractDriveFileId(driveUrl);

  if (photosFolderId) {
    const filesByName = await listDriveFolderFilesByName(accessToken, photosFolderId);
    const expectedSuffix = ` - ${photoId}.jpg`;
    for (const file of filesByName.values()) {
      const name = String(file && file.name || '');
      if (
        file.id === directDriveId ||
        name === `${photoId}.jpg` ||
        name.endsWith(expectedSuffix)
      ) matchedFileIds.add(file.id);
    }
  }

  for (const fileId of matchedFileIds) await trashDriveFile(accessToken, fileId);
  return { deletedCount: matchedFileIds.size, matchedFileIds: Array.from(matchedFileIds) };
}

async function trashDriveFile(accessToken, fileId) {
  const response = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?supportsAllDrives=true&fields=id,trashed`,
    {
      method: 'PATCH',
      headers: driveHeaders(accessToken, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ trashed: true })
    }
  );
  const text = await response.text();
  if (!response.ok) throw new Error(`drive_photo_delete_failed:${response.status}:${text.slice(0, 120)}`);
}

async function handleInspectionPhotos(url, env) {
  requireEnv(env, ['SUPABASE_URL', 'SUPABASE_BUCKET', 'SUPABASE_SERVICE_KEY']);
  const inspectionId = cleanId(url.searchParams.get('inspectionId'), 'inspectionId');
  const token = String(url.searchParams.get('token') || '');
  if (!token || token !== inspectionId.toLowerCase()) throw new Error('unauthorized');
  const params = new URLSearchParams();
  params.set('inspection_id', `eq.${inspectionId}`);
  params.set('source_system', 'neq.deleted');
  params.set('select', 'photo_id,room_name,step_name,caption,slot,storage_path,drive_url,created_at');
  params.set('order', 'created_at.asc');
  const response = await fetch(normalizeSupabaseUrl(env, `/rest/v1/inspector_photo_uploads?${params}`), { headers: serviceHeaders(env) });
  const text = await response.text();
  if (!response.ok) throw new Error(`photo_list_failed:${response.status}:${text.slice(0, 120)}`);
  const rows = text ? JSON.parse(text) : [];
  return json({ photos: rows.map(row => ({
    photoId: row.photo_id,
    roomName: row.room_name || '',
    stepName: row.step_name || '',
    caption: row.caption || '',
    slot: row.slot || '',
    storagePath: row.storage_path || '',
    driveUrl: row.drive_url || '',
    timestamp: row.created_at || '',
    url: `${url.origin}/photo?inspectionId=${encodeURIComponent(inspectionId)}&photoId=${encodeURIComponent(row.photo_id)}&token=${encodeURIComponent(inspectionId.toLowerCase())}`
  })) });
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
  params.set('source_system', 'neq.deleted');
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
  const driveFolderId = String(body.driveFolderId || '').trim();
  if (!driveFolderId) throw new Error('missing_drive_folder_id');
  const allRows = await getUnmirroredPhotoRows(env, inspectionId);
  if (!allRows.length) {
    return json({
      mirrored: 0,
      skipped: 0,
      hasMore: false,
      folderId: driveFolderId,
      driveFolderId,
      photoFolderId: String(body.photoFolderId || '')
    });
  }

  // CF Workers have a 50 subrequest limit per invocation. Each photo currently
  // costs four subrequests (Supabase download + Drive upload + Drive permission
  // + Supabase metadata update), in addition to auth/folder/query overhead.
  // Keep this deliberately small: Google Drive uploads can follow redirects,
  // and every redirect also consumes a Worker subrequest.
  const BATCH_SIZE = 3;
  const rows = allRows.slice(0, BATCH_SIZE);
  const hasMore = allRows.length > BATCH_SIZE;

  const accessToken = await getGoogleAccessToken(env);
  const photoFolder = body.photoFolderId
    ? { id: String(body.photoFolderId), name: 'Technician Photos' }
    : await getOrCreateDriveFolder(accessToken, driveFolderId, 'Technician Photos');

  const results = [];
  for (const row of rows) {
    const storagePath = row.storage_path || storagePathFor(row.inspection_id || inspectionId, row.photo_id);
    const fileBlob = await downloadSupabaseObject(env, storagePath);
    const fileName = fileNameForPhoto(row);
    const driveFile = await uploadDriveFile(accessToken, photoFolder.id, fileName, fileBlob);
    await setDriveFilePublic(accessToken, driveFile.id);
    const driveUrl = `https://drive.google.com/file/d/${encodeURIComponent(driveFile.id)}/view`;
    await updatePhotoDriveUrl(env, row.photo_id, row.inspection_id || inspectionId, driveUrl);
    results.push({ photoId: row.photo_id, driveUrl });
  }

  return json({
    mirrored: results.length,
    skipped: 0,
    hasMore,
    remaining: allRows.length - rows.length,
    folderId: driveFolderId,
    driveFolderId,
    photoFolderId: photoFolder.id,
    photoFolderName: photoFolder.name,
    photos: results
  });
}

// Review edits use the same global review token as the portal
// reads, but keep that value in a Worker secret so Supabase's service key is
// never exposed to the browser. Only the Worker can access review_data.
async function handleSaveReview(request, env) {
  requireEnv(env, ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'REVIEW_ACCESS_TOKEN']);
  const body = await readJson(request);
  if (!isReviewAuthorized(request, body.token, env)) return json({ error: 'unauthorized' }, 401);

  const inspectionId = cleanId(body.inspectionId, 'inspectionId');
  const field = body.field && typeof body.field === 'object' ? body.field : null;
  if (!field) return json({ error: 'missing_field' }, 400);

  const stepId = cleanReviewKey(field.stepId, 'stepId');
  const fieldKey = cleanReviewKey(field.key, 'fieldKey');
  const savedReview = await mutateReviewDataWithRetry(env, inspectionId, fieldData => {
    const markInReview = body.markInReview === true && !isTerminalReviewStatus(fieldData);
    if (stepId === 'summary' || stepId === 'post') {
      fieldData[fieldKey] = field.value;
      if (isPlainObject(fieldData[stepId])) {
        delete fieldData[stepId][fieldKey];
        if (!Object.keys(fieldData[stepId]).length) delete fieldData[stepId];
      }
    } else {
      if (!isPlainObject(fieldData[stepId])) fieldData[stepId] = {};
      fieldData[stepId][fieldKey] = field.value;
    }
    if (markInReview) fieldData.status = 'In Review';
    return fieldData;
  }, 'review_save_failed');
  const fieldData = savedReview.fieldData;
  const explicitReviewStatus = stepId === 'summary' && fieldKey === 'status' &&
    /^(in review|submitted to tanner|report complete)$/i.test(String(field.value || '').trim())
    ? String(field.value).trim()
    : '';
  const shouldMarkInReview = body.markInReview === true && !isTerminalReviewStatus(fieldData);
  const requestedReviewStatus = explicitReviewStatus || (shouldMarkInReview ? 'In Review' : '');
  const reviewStatus = requestedReviewStatus
    ? await setAssessmentReviewStatus(env, inspectionId, requestedReviewStatus)
    : '';
  return json({
    saved: true,
    inspectionId,
    fieldData,
    updatedAt: savedReview.updatedAt,
    reviewStatus
  });
}

function isTerminalReviewStatus(fieldData) {
  const submission = isPlainObject(fieldData && fieldData.submission) ? fieldData.submission : {};
  const raw = firstNonEmpty(submission.status, fieldData && fieldData.status);
  return /submitted to tanner|report complete/i.test(String(raw || ''));
}

async function setAssessmentReviewStatus(env, inspectionId, status) {
  const current = await getAssessmentRow(env, inspectionId);
  if (!current) throw new Error('assessment_not_found_for_review_status');
  if (/submitted to tanner|report complete/i.test(String(current.status || ''))) {
    return current.status;
  }
  const params = new URLSearchParams();
  params.set('inspection_id', `eq.${inspectionId}`);
  const response = await fetch(normalizeSupabaseUrl(env, `/rest/v1/ihl_assessments?${params}`), {
    method: 'PATCH',
    headers: serviceHeaders(env, {
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    }),
    body: JSON.stringify({ status })
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`assessment_review_status_failed:${response.status}:${text.slice(0, 200)}`);
  const rows = text ? JSON.parse(text) : [];
  return Array.isArray(rows) && rows.length ? rows[0].status : status;
}

async function handleReviewUnlock(request, env) {
  requireEnv(env, ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'REVIEW_ACCESS_TOKEN', 'REVIEW_ADMIN_TOKEN']);
  const body = await readJson(request);
  if (!isReviewAuthorized(request, body.token, env)) return json({ error: 'unauthorized' }, 401);
  if (!body.adminToken || String(body.adminToken) !== String(env.REVIEW_ADMIN_TOKEN)) {
    return json({ error: 'invalid_admin_token' }, 401);
  }

  const inspectionId = cleanId(body.inspectionId || body.id, 'inspectionId');
  const unlockedAt = new Date().toISOString();
  await mutateReviewDataWithRetry(env, inspectionId, fieldData => {
    fieldData.submission = {
      ...(isPlainObject(fieldData.submission) ? fieldData.submission : {}),
      status: 'In Review',
      unlockedAt
    };
    fieldData.status = 'In Review';
    return fieldData;
  }, 'review_unlock_save_failed');

  const assessmentParams = new URLSearchParams();
  assessmentParams.set('inspection_id', `eq.${inspectionId}`);
  const assessmentResponse = await fetch(normalizeSupabaseUrl(env, `/rest/v1/ihl_assessments?${assessmentParams}`), {
    method: 'PATCH',
    headers: serviceHeaders(env, {
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal'
    }),
    body: JSON.stringify({ status: 'In Review' })
  });
  const assessmentText = await assessmentResponse.text();
  if (!assessmentResponse.ok) {
    throw new Error(`assessment_unlock_save_failed:${assessmentResponse.status}:${assessmentText.slice(0, 200)}`);
  }

  return json({
    status: 'ok',
    unlocked: true,
    inspectionId,
    reviewStatus: 'In Review',
    unlockedAt
  });
}

async function handleSubmitSmoke(request, url, env) {
  requireEnv(env, ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'REVIEW_ACCESS_TOKEN']);
  if (!isReviewAuthorized(request, url.searchParams.get('token'), env)) {
    return json({ error: 'unauthorized' }, 401);
  }
  const inspectionId = cleanId(url.searchParams.get('inspectionId') || 'INH-READINESS-PROBE', 'inspectionId');
  return json({
    status: 'ok',
    smoke: true,
    authorized: true,
    statusChanged: false,
    emailSent: false,
    inspectionId,
    backend: 'cloudflare-worker',
    workerVersion: WORKER_VERSION
  });
}

async function handleReviewActivityEvent(request, env) {
  requireEnv(env, ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'REVIEW_ACCESS_TOKEN']);
  const body = await readJson(request);
  if (!isReviewAuthorized(request, body.token, env)) return json({ error: 'unauthorized' }, 401);

  const event = body.event && typeof body.event === 'object' ? body.event : {};
  const inspectionId = cleanId(body.inspectionId || event.inspectionId, 'inspectionId');
  const eventType = cleanActivityText(body.eventType || body.type || event.type || 'activity', 'eventType', 80);
  const actor = cleanActivityText(body.actor || body.reviewerName || event.reviewerName || event.actorName || '', 'actor', 120, true);
  const payload = sanitizeActivityPayload(body.eventPayload || event || {});

  const response = await fetch(normalizeSupabaseUrl(env, '/rest/v1/review_activity_events'), {
    method: 'POST',
    headers: serviceHeaders(env, {
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    }),
    body: JSON.stringify({
      inspection_id: inspectionId,
      actor,
      event_type: eventType,
      event_payload: payload
    })
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`review_activity_event_save_failed:${response.status}:${text.slice(0, 200)}`);
  const rows = text ? JSON.parse(text) : [];
  const saved = Array.isArray(rows) && rows.length ? rows[0] : null;
  return json({
    saved: true,
    inspectionId,
    eventType,
    eventId: saved && saved.id ? saved.id : ''
  });
}

async function handleGetReview(request, url, env) {
  requireEnv(env, ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'REVIEW_ACCESS_TOKEN']);
  if (!isReviewAuthorized(request, url.searchParams.get('token'), env)) {
    return json({ error: 'unauthorized' }, 401);
  }

  const inspectionId = cleanId(url.searchParams.get('inspectionId'), 'inspectionId');
  const row = await getReviewRow(env, inspectionId);
  return json({
    inspectionId,
    fieldData: row && isPlainObject(row.field_data) ? row.field_data : {},
    updatedAt: row && row.updated_at ? row.updated_at : null
  });
}

async function getReviewRow(env, inspectionId) {
  const params = new URLSearchParams();
  params.set('inspection_id', `eq.${inspectionId}`);
  params.set('select', 'inspection_id,field_data,updated_at');
  params.set('limit', '1');
  const response = await fetch(normalizeSupabaseUrl(env, `/rest/v1/review_data?${params}`), {
    headers: serviceHeaders(env)
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`review_get_failed:${response.status}:${text.slice(0, 200)}`);
  const rows = text ? JSON.parse(text) : [];
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

function nextReviewMutationTimestamp(currentUpdatedAt) {
  const currentMs = Date.parse(String(currentUpdatedAt || ''));
  const nextMs = Number.isFinite(currentMs)
    ? Math.max(Date.now(), currentMs + 1)
    : Date.now();
  return new Date(nextMs).toISOString();
}

async function mutateReviewDataWithRetry(env, inspectionId, mutator, errorPrefix) {
  for (let attempt = 1; attempt <= REVIEW_MUTATION_MAX_ATTEMPTS; attempt += 1) {
    const current = await getReviewRow(env, inspectionId);
    const fieldData = current && isPlainObject(current.field_data)
      ? structuredClone(current.field_data)
      : {};
    const mutated = await mutator(fieldData, { attempt, current });
    const nextFieldData = isPlainObject(mutated) ? mutated : fieldData;
    const updatedAt = nextReviewMutationTimestamp(current && current.updated_at);
    const params = new URLSearchParams();
    params.set('select', 'inspection_id,field_data,updated_at');

    let response;
    if (current) {
      params.set('inspection_id', `eq.${inspectionId}`);
      params.set('updated_at', current.updated_at ? `eq.${current.updated_at}` : 'is.null');
      response = await fetch(normalizeSupabaseUrl(env, `/rest/v1/review_data?${params}`), {
        method: 'PATCH',
        headers: serviceHeaders(env, {
          'Content-Type': 'application/json',
          'Prefer': 'return=representation'
        }),
        body: JSON.stringify({ field_data: nextFieldData, updated_at: updatedAt })
      });
    } else {
      response = await fetch(normalizeSupabaseUrl(env, `/rest/v1/review_data?${params}`), {
        method: 'POST',
        headers: serviceHeaders(env, {
          'Content-Type': 'application/json',
          'Prefer': 'return=representation'
        }),
        body: JSON.stringify({
          inspection_id: inspectionId,
          field_data: nextFieldData,
          updated_at: updatedAt
        })
      });
    }

    const text = await response.text();
    if (!response.ok) {
      const insertConflict = !current && (response.status === 409 || /23505|duplicate key/i.test(text));
      if (insertConflict) continue;
      throw new Error(`${errorPrefix}:${response.status}:${text.slice(0, 200)}`);
    }
    const rows = text ? JSON.parse(text) : [];
    if (Array.isArray(rows) && rows.length) {
      const saved = rows[0];
      return {
        fieldData: isPlainObject(saved.field_data) ? saved.field_data : nextFieldData,
        updatedAt: saved.updated_at || updatedAt,
        attempt
      };
    }
  }
  throw new Error(`${errorPrefix}:conflict_after_${REVIEW_MUTATION_MAX_ATTEMPTS}_attempts`);
}

async function getReviewRows(env) {
  const rows = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const params = new URLSearchParams();
    params.set('select', 'inspection_id,field_data,updated_at');
    params.set('order', 'updated_at.desc');
    params.set('limit', String(pageSize));
    params.set('offset', String(offset));
    const response = await fetch(normalizeSupabaseUrl(env, `/rest/v1/review_data?${params}`), {
      headers: serviceHeaders(env)
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`review_list_failed:${response.status}:${text.slice(0, 200)}`);
    const page = text ? JSON.parse(text) : [];
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

async function getStartInspectionShellState(env, inspectionId) {
  const row = await getReviewRow(env, inspectionId);
  const fieldData = row && isPlainObject(row.field_data) ? row.field_data : {};
  const system = isPlainObject(fieldData.system) ? fieldData.system : {};
  return isPlainObject(system.startInspectionShell) ? system.startInspectionShell : null;
}

async function saveStartInspectionShellState(env, inspectionId, receipt) {
  const cleanReceipt = {
    ...(isPlainObject(receipt) ? receipt : {}),
    updatedAt: (receipt && receipt.updatedAt) || new Date().toISOString(),
    error: (receipt && receipt.error) || ''
  };
  await mutateReviewDataWithRetry(env, inspectionId, fieldData => {
    const system = isPlainObject(fieldData.system) ? structuredClone(fieldData.system) : {};
    system.startInspectionShell = cleanReceipt;
    fieldData.system = system;
    fieldData.assessmentNumber = cleanReceipt.assessmentNumber || fieldData.assessmentNumber || '';
    fieldData.assessmentNumberSource = cleanReceipt.assessmentNumberSource || fieldData.assessmentNumberSource || '';
    fieldData.assessmentReservationId = cleanReceipt.assessmentReservationId || fieldData.assessmentReservationId || '';
    fieldData.folderId = cleanReceipt.folderId || fieldData.folderId || '';
    fieldData.folderUrl = cleanReceipt.folderUrl || fieldData.folderUrl || '';
    fieldData.driveFolderId = cleanReceipt.folderId || fieldData.driveFolderId || '';
    fieldData.driveFolderUrl = cleanReceipt.folderUrl || fieldData.driveFolderUrl || '';
    fieldData.trackerRow = cleanReceipt.trackerRow || fieldData.trackerRow || '';
    fieldData.trackerUrl = cleanReceipt.trackerUrl || fieldData.trackerUrl || '';
    fieldData.trackerRowUrl = cleanReceipt.trackerUrl || fieldData.trackerRowUrl || '';
    fieldData.trackerStatus = cleanReceipt.trackerStatus || fieldData.trackerStatus || '';
    fieldData.startInspectionShellStatus = cleanReceipt.status || fieldData.startInspectionShellStatus || '';
    fieldData.startInspectionShellUpdatedAt = cleanReceipt.updatedAt;
    fieldData.lastStartInspectionShellError = cleanReceipt.error || '';
    fieldData.isTestTraining = cleanReceipt.isTestTraining === true;
    return fieldData;
  }, 'start_shell_save_failed');
}

async function upsertAssessmentShellRecord(env, source, receipt) {
  if (!source || !receipt) return;
  const inspectionId = cleanId(source.inspectionId || source.id, 'inspectionId');
  const payload = {
    inspection_id: inspectionId,
    assessment_num: receipt.isTestTraining === true ? inspectionId : (receipt.assessmentNumber || null),
    report_id: null,
    inspector_name: String(source.inspectorName || source.inspector || '') || null,
    inspection_date: String(source.inspectionDate || '').slice(0, 10) || null,
    status: 'In Progress',
    drive_folder_id: receipt.folderId || null,
    assessment_folder_url: receipt.folderUrl || null,
    water_source: source.waterSource || null,
    occupancy: source.occupancyDuringInspection || null,
    weather_conditions: source.weatherConditions || null,
    client_concerns: source.clientConcerns || null,
    known_problem_areas: source.knownProblemAreas || null,
    pets: source.pets || null,
    smoking_vaping: source.smokingVaping || null,
    stove_type: source.stoveType || null,
    fireplace: source.fireplace || null,
    carpeted_rooms: source.carpetedRooms || null,
    started_at: source.startedAt || new Date().toISOString(),
    ended_at: source.endedAt || null,
    completed_at: source.completedAt || null,
    app_version: source.appVersion || null,
    completion_score: null,
    completion_grade: null,
    same_day_bonus: false,
    payload_version: source.payloadVersion || null,
    raw_jsonb: source,
    source_system: 'worker_start_shell',
    source_id: inspectionId
  };
  const params = new URLSearchParams();
  params.set('on_conflict', 'inspection_id');
  const res = await fetch(normalizeSupabaseUrl(env, `/rest/v1/ihl_assessments?${params}`), {
    method: 'POST',
    headers: serviceHeaders(env, {
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates,return=minimal'
    }),
    body: JSON.stringify(payload)
  });
  const text = await res.text().catch(() => '');
  if (!res.ok) throw new Error(`assessment_shell_upsert_failed:${res.status}:${text.slice(0, 200)}`);
}

function handoffJobId(inspectionId) {
  return `handoff_${inspectionId}`;
}

function getHandoffReceiptFromFieldData(fieldData = {}) {
  const system = isPlainObject(fieldData.system) ? fieldData.system : {};
  const candidates = [
    system.tannerHandoff,
    fieldData.reviewPortalData,
    fieldData.tannerHandoff
  ];
  return candidates.find(candidate => candidate && isPlainObject(candidate)) || null;
}

function getReadyHandoffReceipt(fieldData = {}, expectations = {}) {
  const receipt = getHandoffReceiptFromFieldData(fieldData);
  const expectedRoomCount = Number(expectations.expectedRoomCount || getHandoffRoomRecords(fieldData).length || 0);
  return receipt && isReadyHandoffReceipt(receipt, { ...expectations, expectedRoomCount }) ? receipt : null;
}

function buildPartialFailedHandoffReceipt(fieldData = {}) {
  const system = isPlainObject(fieldData.system) ? fieldData.system : {};
  const shell = isPlainObject(system.startInspectionShell) ? system.startInspectionShell : {};
  const receipt = getHandoffReceiptFromFieldData(fieldData) || {};
  const partial = {};
  const set = (key, ...values) => {
    const value = firstNonEmpty(...values);
    if (value !== '') partial[key] = value;
  };
  set('assessmentNumber', receipt.assessmentNumber, shell.assessmentNumber);
  set('folderId', receipt.folderId, receipt.assessmentFolderId, shell.folderId, shell.assessmentFolderId);
  set('folderUrl', receipt.folderUrl, receipt.assessmentFolderUrl, shell.folderUrl, shell.assessmentFolderUrl);
  set('folderName', receipt.folderName, shell.folderName);
  set('technicianPhotosFolderId', receipt.technicianPhotosFolderId, receipt.photosFolderId, shell.photosFolderId, shell.technicianPhotosFolderId);
  set('technicianPhotosFolderUrl', receipt.technicianPhotosFolderUrl, receipt.photosFolderUrl, shell.photosFolderUrl, shell.technicianPhotosFolderUrl);
  set('photosFolderId', receipt.photosFolderId, receipt.technicianPhotosFolderId, shell.photosFolderId, shell.technicianPhotosFolderId);
  set('photosFolderUrl', receipt.photosFolderUrl, receipt.technicianPhotosFolderUrl, shell.photosFolderUrl, shell.technicianPhotosFolderUrl);
  set('cocsFolderId', receipt.cocsFolderId, shell.cocsFolderId);
  set('cocsFolderUrl', receipt.cocsFolderUrl, shell.cocsFolderUrl);
  set('backupFolderId', receipt.backupFolderId, shell.backupFolderId);
  set('backupFolderUrl', receipt.backupFolderUrl, shell.backupFolderUrl);
  set('spreadsheetId', receipt.spreadsheetId, receipt.reviewPortalDataSpreadsheetId);
  set('spreadsheetUrl', receipt.spreadsheetUrl, receipt.reviewPortalDataSpreadsheetUrl, receipt.reviewPortalDataUrl);
  set('reviewPortalDataSpreadsheetId', receipt.reviewPortalDataSpreadsheetId, receipt.spreadsheetId);
  set('reviewPortalDataSpreadsheetUrl', receipt.reviewPortalDataSpreadsheetUrl, receipt.spreadsheetUrl, receipt.reviewPortalDataUrl);
  set('inspectionSpreadsheetId', receipt.inspectionSpreadsheetId, receipt.appInspectionSpreadsheetId);
  set('inspectionSpreadsheetUrl', receipt.inspectionSpreadsheetUrl, receipt.appInspectionSpreadsheetUrl);
  set('appInspectionSpreadsheetId', receipt.appInspectionSpreadsheetId, receipt.inspectionSpreadsheetId);
  set('appInspectionSpreadsheetUrl', receipt.appInspectionSpreadsheetUrl, receipt.inspectionSpreadsheetUrl);
  set('contextFileId', receipt.contextFileId);
  set('contextFileUrl', receipt.contextFileUrl);
  set('rawReviewDataUrl', receipt.rawReviewDataUrl, receipt.rawJsonUrl);
  set('rawJsonUrl', receipt.rawJsonUrl, receipt.rawReviewDataUrl);
  set('rawJsonId', receipt.rawJsonId);
  set('trackerRow', receipt.trackerRow, shell.trackerRow);
  set('trackerUrl', receipt.trackerUrl, receipt.trackerRowUrl, shell.trackerUrl, shell.trackerRowUrl);
  set('trackerRowUrl', receipt.trackerRowUrl, receipt.trackerUrl, shell.trackerRowUrl, shell.trackerUrl);
  set('trackerStatus', receipt.trackerStatus, shell.trackerStatus);
  return partial;
}

function isReadyHandoffReceipt(receipt = {}, expectations = {}) {
  if (!receipt || !isPlainObject(receipt)) return false;
  const status = String(receipt.status || '').trim().toLowerCase().replace(/[\s_]+/g, '-');
  const trackerStatus = String(receipt.trackerStatus || '').trim().toLowerCase().replace(/[\s_]+/g, '-');
  const isTestTraining = receipt.isTestTraining === true || trackerStatus === 'skipped-test-training';
  if (!['ready', 'complete', 'completed', 'success', 'succeeded'].includes(status)) return false;
  if (!(receipt.folderUrl || receipt.folderId)) return false;
  if (!(receipt.photosFolderUrl || receipt.photosFolderId || receipt.technicianPhotosFolderUrl || receipt.technicianPhotosFolderId)) return false;
  if (!(receipt.spreadsheetUrl || receipt.spreadsheetId)) return false;
  if (!(receipt.inspectionSpreadsheetUrl || receipt.inspectionSpreadsheetId || receipt.appInspectionSpreadsheetUrl || receipt.appInspectionSpreadsheetId)) return false;
  if (!(receipt.contextFileUrl || receipt.contextFileId)) return false;
  if (!(receipt.rawJsonUrl || receipt.rawReviewDataUrl)) return false;
  if (!isTestTraining && !(receipt.trackerUrl || receipt.trackerRow || receipt.trackerRowUrl)) return false;
  if (Number(receipt.photoFolderFailedCount || receipt.technicianPhotoFailedCount || 0) > 0) return false;
  if (Number(receipt.photoFolderPendingCount || 0) > 0) return false;
  const counts = isPlainObject(receipt.counts) ? receipt.counts : {};
  const expectedRoomCount = Number(expectations.expectedRoomCount || receipt.sourceRoomCount || counts.sourceRoomCount || 0);
  const expectedPhotoCount = Number(expectations.expectedPhotoCount || receipt.sourcePhotoCount || counts.sourcePhotoCount || 0);
  const roomDetailCount = Number(receipt.roomDetailCount || counts.roomDetailCount || 0);
  const appRoomDetailCount = Number(receipt.appRoomDetailCount || counts.appRoomDetailCount || 0);
  const rawAppKeyCount = Number(receipt.rawAppKeyCount || counts.rawAppKeyCount || 0);
  const photoLogCount = Number(receipt.photoLogCount || counts.photoLogCount || 0);
  const photoDriveUrlCount = Number(receipt.photoDriveUrlCount || counts.photoDriveUrlCount || 0);
  if (expectedRoomCount > 0 && roomDetailCount < expectedRoomCount) return false;
  if (expectedRoomCount > 0 && appRoomDetailCount < expectedRoomCount) return false;
  if (rawAppKeyCount <= 0) return false;
  if (expectedPhotoCount > 0 && photoLogCount < expectedPhotoCount) return false;
  if (expectedPhotoCount > 0 && photoDriveUrlCount < expectedPhotoCount) return false;
  return true;
}

async function createOrRepairTannerHandoff(env, accessToken, inspectionId, fieldData, body) {
  const assessmentRow = await getAssessmentRow(env, inspectionId);
  const canonicalSource = buildCanonicalAssessmentSource(assessmentRow);
  const source = buildHandoffSource(inspectionId, fieldData, body, canonicalSource);
  const handoffFieldData = buildCanonicalHandoffFieldData(fieldData, source, canonicalSource);
  fieldData.rooms = handoffFieldData.rooms;
  fieldData.system = handoffFieldData.system;
  const previousReceipt = getHandoffReceiptFromFieldData(fieldData) || {};
  const sourceShell = isPlainObject(source.system?.startInspectionShell)
    ? source.system.startInspectionShell
    : (isPlainObject(source.startInspectionShell)
        ? source.startInspectionShell
        : (isPlainObject(previousReceipt) ? previousReceipt : null));
  const classification = assertAssessmentClassificationMatchesShell(sourceShell, source) ||
    requireExplicitAssessmentClassification(source);
  const isTestTraining = classification === 'test';
  const sourceRoomCount = getHandoffRoomRecords(handoffFieldData).length;
  const previousCounts = isPlainObject(previousReceipt.counts) ? previousReceipt.counts : {};
  const previousRoomDetailCount = Number(previousReceipt.roomDetailCount || previousCounts.roomDetailCount || 0);
  const previousAppRoomDetailCount = Number(previousReceipt.appRoomDetailCount || previousCounts.appRoomDetailCount || 0);
  const previousPhotoDriveUrlCount = Number(previousReceipt.photoDriveUrlCount || previousCounts.photoDriveUrlCount || 0);
  const canReuseStaticArtifacts = !!(body.forceFullRepair !== true &&
    previousReceipt.spreadsheetId &&
    previousReceipt.spreadsheetUrl &&
    (previousReceipt.rawJsonUrl || previousReceipt.rawReviewDataUrl) &&
    (sourceRoomCount === 0 || previousRoomDetailCount >= sourceRoomCount));
  const canReuseRootArtifacts = !!(canReuseStaticArtifacts &&
    (previousReceipt.inspectionSpreadsheetId || previousReceipt.appInspectionSpreadsheetId) &&
    (previousReceipt.inspectionSpreadsheetUrl || previousReceipt.appInspectionSpreadsheetUrl) &&
    previousReceipt.contextFileId &&
    previousReceipt.contextFileUrl &&
    (sourceRoomCount === 0 || previousAppRoomDetailCount >= sourceRoomCount));
  const shell = isTestTraining
    ? await ensureTestHandoffShell(env, accessToken, source)
    : await ensureRealHandoffShell(env, accessToken, source, fieldData);
  const photoRows = await getPhotoManifestRows(env, inspectionId);
  let spreadsheet = canReuseStaticArtifacts
    ? {
        spreadsheetId: previousReceipt.spreadsheetId,
        spreadsheetUrl: previousReceipt.spreadsheetUrl,
        rawReviewKeyCount: Number(previousReceipt.rawReviewKeyCount || previousCounts.rawReviewKeyCount || 0),
        formattedReviewRowCount: Number(previousReceipt.formattedReviewRowCount || previousCounts.formattedReviewRowCount || 0),
        photoLogCount: Number(previousReceipt.photoLogCount || previousCounts.photoLogCount || photoRows.length),
        roomDetailCount: Number(previousReceipt.roomDetailCount || previousCounts.roomDetailCount || 0)
      }
    : await createOrUpdateReviewDataSpreadsheet(accessToken, shell.folderId, source, handoffFieldData, photoRows);
  const rawBackup = canReuseStaticArtifacts
    ? {
        rawJsonId: previousReceipt.rawJsonId || '',
        rawJsonUrl: previousReceipt.rawJsonUrl || previousReceipt.rawReviewDataUrl
      }
    : await createRawReviewDataBackup(accessToken, shell.backupFolderId, source, handoffFieldData);
  const photoPackage = await createOrRepairPhotoPackage(env, accessToken, shell.photosFolderId, photoRows, {
    copyLimit: Number(body.photoCopyLimit || env.HANDOFF_PHOTO_COPY_LIMIT || HANDOFF_PHOTO_COPY_LIMIT_DEFAULT)
  });
  const finalizedPhotoRows = await getPhotoManifestRows(env, inspectionId);
  const photoDriveUrlCount = finalizedPhotoRows.filter(row => !!row.drive_url).length;
  if (
    photoPackage.pendingCount === 0 &&
    photoPackage.failedCount === 0 &&
    (photoRows.some(row => !row.drive_url) || previousPhotoDriveUrlCount < photoDriveUrlCount)
  ) {
    spreadsheet = await createOrUpdateReviewDataSpreadsheet(
      accessToken,
      shell.folderId,
      source,
      handoffFieldData,
      finalizedPhotoRows
    );
  }
  const inspectionSpreadsheet = canReuseRootArtifacts
    ? {
        spreadsheetId: previousReceipt.inspectionSpreadsheetId || previousReceipt.appInspectionSpreadsheetId,
        spreadsheetUrl: previousReceipt.inspectionSpreadsheetUrl || previousReceipt.appInspectionSpreadsheetUrl,
        roomDetailCount: previousAppRoomDetailCount,
        rawAppKeyCount: Number(previousReceipt.rawAppKeyCount || previousCounts.rawAppKeyCount || 0)
      }
    : await createOrUpdateInspectionSpreadsheet(
        accessToken,
        shell.folderId,
        source,
        handoffFieldData,
        finalizedPhotoRows
      );
  const contextFile = canReuseRootArtifacts
    ? {
        contextFileId: previousReceipt.contextFileId,
        contextFileUrl: previousReceipt.contextFileUrl
      }
    : await createOrUpdateAssessmentContext(
        accessToken,
        shell,
        source,
        handoffFieldData,
        finalizedPhotoRows,
        inspectionSpreadsheet,
        spreadsheet,
        rawBackup
      );
  const now = new Date().toISOString();
  const receipt = {
    status: 'ready',
    inspectionId,
    assessmentNumber: shell.assessmentNumber || '',
    isTestTraining,
    folderId: shell.folderId,
    folderUrl: shell.folderUrl,
    folderName: shell.folderName || '',
    technicianPhotosFolderId: shell.photosFolderId,
    technicianPhotosFolderUrl: shell.photosFolderUrl,
    photosFolderId: shell.photosFolderId,
    photosFolderUrl: shell.photosFolderUrl,
    cocsFolderId: shell.cocsFolderId || '',
    cocsFolderUrl: shell.cocsFolderUrl || '',
    backupFolderId: shell.backupFolderId || '',
    backupFolderUrl: shell.backupFolderUrl || '',
    spreadsheetId: spreadsheet.spreadsheetId,
    spreadsheetUrl: spreadsheet.spreadsheetUrl,
    reviewPortalDataSpreadsheetId: spreadsheet.spreadsheetId,
    reviewPortalDataSpreadsheetUrl: spreadsheet.spreadsheetUrl,
    inspectionSpreadsheetId: inspectionSpreadsheet.spreadsheetId,
    inspectionSpreadsheetUrl: inspectionSpreadsheet.spreadsheetUrl,
    appInspectionSpreadsheetId: inspectionSpreadsheet.spreadsheetId,
    appInspectionSpreadsheetUrl: inspectionSpreadsheet.spreadsheetUrl,
    contextFileId: contextFile.contextFileId,
    contextFileUrl: contextFile.contextFileUrl,
    rawReviewDataUrl: rawBackup.rawJsonUrl,
    rawJsonUrl: rawBackup.rawJsonUrl,
    rawJsonId: rawBackup.rawJsonId,
    trackerRow: shell.trackerRow || '',
    trackerUrl: shell.trackerUrl || '',
    trackerRowUrl: shell.trackerUrl || '',
    trackerStatus: shell.trackerStatus || (isTestTraining ? 'skipped_test_training' : ''),
    reportTemplateId: '',
    reportTemplateUrl: '',
    notification: {
      status: 'not_sent',
      sentAt: '',
      channel: ''
    },
    counts: {
      sourcePhotoCount: photoRows.length,
      photoDriveUrlCount,
      photoManifestCount: photoRows.length,
      photoLogCount: spreadsheet.photoLogCount,
      photoFolderAlreadyPackagedCount: photoPackage.alreadyPackagedCount,
      photoFolderCopiedCount: photoPackage.copiedCount,
      photoFolderLinkedCount: photoPackage.linkedCount,
      photoFolderSkippedCount: photoPackage.skippedCount,
      photoFolderFailedCount: photoPackage.failedCount,
      photoFolderPendingCount: photoPackage.pendingCount,
      photoFolderOperationLimit: photoPackage.operationLimit,
      photoFolderOperationCount: photoPackage.operationCount,
      rawReviewKeyCount: spreadsheet.rawReviewKeyCount,
      formattedReviewRowCount: spreadsheet.formattedReviewRowCount,
      roomDetailCount: spreadsheet.roomDetailCount,
      appRoomDetailCount: inspectionSpreadsheet.roomDetailCount,
      rawAppKeyCount: inspectionSpreadsheet.rawAppKeyCount,
      sourceRoomCount
    },
    sourcePhotoCount: photoRows.length,
    photoDriveUrlCount,
    photoManifestCount: photoRows.length,
    photoLogCount: spreadsheet.photoLogCount,
    photoFolderAlreadyPackagedCount: photoPackage.alreadyPackagedCount,
    photoFolderCopiedCount: photoPackage.copiedCount,
    photoFolderLinkedCount: photoPackage.linkedCount,
    photoFolderSkippedCount: photoPackage.skippedCount,
    photoFolderFailedCount: photoPackage.failedCount,
    photoFolderPendingCount: photoPackage.pendingCount,
    photoFolderOperationLimit: photoPackage.operationLimit,
    photoFolderOperationCount: photoPackage.operationCount,
    technicianPhotoFailedCount: photoPackage.failedCount,
    rawReviewKeyCount: spreadsheet.rawReviewKeyCount,
    formattedReviewRowCount: spreadsheet.formattedReviewRowCount,
    roomDetailCount: spreadsheet.roomDetailCount,
    appRoomDetailCount: inspectionSpreadsheet.roomDetailCount,
    rawAppKeyCount: inspectionSpreadsheet.rawAppKeyCount,
    sourceRoomCount,
    checksums: {
      sourceSnapshotHash: stableHash(handoffFieldData.system && handoffFieldData.system.inspectionRecovery),
      reviewDataHash: stableHash(handoffFieldData),
      photoManifestHash: stableHash(photoRows)
    },
    createdAt: now,
    staticArtifactsReused: canReuseStaticArtifacts,
    rootArtifactsReused: canReuseRootArtifacts,
    updatedAt: now,
    workerVersion: WORKER_VERSION,
    appsScriptVersion: '',
    schemaVersion: HANDOFF_RECEIPT_SCHEMA_VERSION,
    error: photoPackage.error || ''
  };
  const receiptExpectations = { expectedRoomCount: sourceRoomCount, expectedPhotoCount: photoRows.length };
  if (!isReadyHandoffReceipt(receipt, receiptExpectations) && photoPackage.pendingCount > 0 && photoPackage.failedCount === 0) {
    receipt.status = 'running';
    receipt.error = `photo copy pending:${photoPackage.pendingCount}`;
  } else if (!isReadyHandoffReceipt(receipt, receiptExpectations)) {
    receipt.status = 'failed';
    if (!receipt.error) {
      receipt.error = sourceRoomCount > spreadsheet.roomDetailCount
        ? `room_detail_rows_incomplete:${spreadsheet.roomDetailCount}/${sourceRoomCount}`
        : getHandoffReceiptMissingReason(receipt);
    }
  }
  return receipt;
}

async function ensureRealHandoffShell(env, accessToken, source, fieldData) {
  const system = isPlainObject(fieldData.system) ? fieldData.system : {};
  const existing = isPlainObject(system.startInspectionShell) ? system.startInspectionShell : null;
  if (existing && existing.status === 'ready' && existing.folderId && existing.trackerRow && existing.trackerUrl) {
    const folder = driveFileFromReceipt(existing.folderId, existing.folderUrl, existing.folderName);
    const photosFolder = existing.photosFolderId || existing.technicianPhotosFolderId
      ? driveFileFromReceipt(existing.photosFolderId || existing.technicianPhotosFolderId, existing.photosFolderUrl || existing.technicianPhotosFolderUrl)
      : await getOrCreateDriveFolder(accessToken, folder.id, assessmentSubfolderName('Photos', source));
    const cocsFolder = existing.cocsFolderId
      ? driveFileFromReceipt(existing.cocsFolderId, existing.cocsFolderUrl)
      : await getOrCreateDriveFolder(accessToken, folder.id, assessmentSubfolderName('COCs', source));
    const backupFolder = existing.backupFolderId
      ? driveFileFromReceipt(existing.backupFolderId, existing.backupFolderUrl)
      : await getOrCreateDriveFolder(accessToken, folder.id, assessmentSubfolderName('Backup', source));
    return {
      ...existing,
      folderId: folder.id,
      folderUrl: driveFolderUrl(folder),
      photosFolderId: photosFolder.id,
      photosFolderUrl: driveFolderUrl(photosFolder),
      cocsFolderId: cocsFolder.id,
      cocsFolderUrl: driveFolderUrl(cocsFolder),
      backupFolderId: backupFolder.id,
      backupFolderUrl: driveFolderUrl(backupFolder)
    };
  }

  const trackerSheetId = String(env.REPORT_TRACKER_SHEET_ID || source.reportTrackerSheetId || '').trim();
  if (!trackerSheetId) throw new Error('missing_report_tracker_sheet_id');
  const assessmentsFolderId = String(env.ASSESSMENTS_FOLDER_ID || source.sharedDriveFolderId || source.driveFolderId || '').trim();
  if (!assessmentsFolderId) throw new Error('missing_assessments_folder_id');

  const trackerContext = await getTrackerContext(accessToken, trackerSheetId);
  const existingTrackerRow = findTrackerRowByInspectionIdValues(trackerContext.values, trackerContext.columns.inhId || 10, source.inspectionId);
  const reservation = await resolveAssessmentNumberReservation(env, source, trackerContext, existingTrackerRow);
  const assessmentNumber = reservation.assessmentNumber;
  const folderName = generateAssessmentFolderName(assessmentNumber, source);
  const folder = await getOrCreateDriveFolder(accessToken, assessmentsFolderId, folderName);
  const photosFolder = await getOrCreateDriveFolder(accessToken, folder.id, assessmentSubfolderName('Photos', source));
  const cocsFolder = await getOrCreateDriveFolder(accessToken, folder.id, assessmentSubfolderName('COCs', source));
  const backupFolder = await getOrCreateDriveFolder(accessToken, folder.id, assessmentSubfolderName('Backup', source));
  const trackerResult = await upsertReportTrackerRow(accessToken, trackerSheetId, trackerContext, source, {
    folder,
    assessmentNumber,
    existingTrackerRow
  });
  await verifyTrackerReservation(accessToken, trackerSheetId, source.inspectionId, assessmentNumber, trackerResult.row);
  const receipt = {
    status: 'ready',
    shellStatus: 'ready',
    isTestTraining: false,
    inspectionId: source.inspectionId,
    assessmentNumber,
    assessmentNumberSource: reservation.source,
    assessmentReservationId: reservation.reservationId || '',
    folderId: folder.id,
    folderUrl: driveFolderUrl(folder),
    folderName,
    photosFolderId: photosFolder.id,
    photosFolderUrl: driveFolderUrl(photosFolder),
    technicianPhotosFolderId: photosFolder.id,
    technicianPhotosFolderUrl: driveFolderUrl(photosFolder),
    cocsFolderId: cocsFolder.id,
    cocsFolderUrl: driveFolderUrl(cocsFolder),
    backupFolderId: backupFolder.id,
    backupFolderUrl: driveFolderUrl(backupFolder),
    trackerRow: trackerResult.row,
    trackerUrl: trackerResult.url,
    trackerStatus: trackerResult.status,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    workerVersion: WORKER_VERSION,
    error: ''
  };
  await upsertAssessmentShellRecord(env, source, receipt);
  await saveStartInspectionShellState(env, source.inspectionId, receipt);
  return receipt;
}

async function ensureTestHandoffShell(env, accessToken, source) {
  const existing = isPlainObject(source.system?.startInspectionShell)
    ? source.system.startInspectionShell
    : (isPlainObject(source.startInspectionShell) ? source.startInspectionShell : null);
  if (existing && existing.status === 'ready' && existing.folderId) {
    const folder = driveFileFromReceipt(existing.folderId, existing.folderUrl, existing.folderName);
    const photosFolder = existing.photosFolderId || existing.technicianPhotosFolderId
      ? driveFileFromReceipt(existing.photosFolderId || existing.technicianPhotosFolderId, existing.photosFolderUrl || existing.technicianPhotosFolderUrl)
      : await getOrCreateDriveFolder(accessToken, folder.id, assessmentSubfolderName('Photos', source));
    const cocsFolder = existing.cocsFolderId
      ? driveFileFromReceipt(existing.cocsFolderId, existing.cocsFolderUrl)
      : await getOrCreateDriveFolder(accessToken, folder.id, assessmentSubfolderName('COCs', source));
    const backupFolder = existing.backupFolderId
      ? driveFileFromReceipt(existing.backupFolderId, existing.backupFolderUrl)
      : await getOrCreateDriveFolder(accessToken, folder.id, assessmentSubfolderName('Backup', source));
    return {
      ...existing,
      status: 'ready',
      shellStatus: 'ready',
      isTestTraining: true,
      assessmentNumber: '',
      assessmentNumberSource: 'skipped_test_training',
      folderId: folder.id,
      folderUrl: driveFolderUrl(folder),
      photosFolderId: photosFolder.id,
      photosFolderUrl: driveFolderUrl(photosFolder),
      technicianPhotosFolderId: photosFolder.id,
      technicianPhotosFolderUrl: driveFolderUrl(photosFolder),
      cocsFolderId: cocsFolder.id,
      cocsFolderUrl: driveFolderUrl(cocsFolder),
      backupFolderId: backupFolder.id,
      backupFolderUrl: driveFolderUrl(backupFolder),
      trackerRow: '',
      trackerUrl: '',
      trackerStatus: 'skipped_test_training',
      updatedAt: new Date().toISOString(),
      workerVersion: WORKER_VERSION,
      error: ''
    };
  }
  const assessmentsFolderId = String(env.ASSESSMENTS_FOLDER_ID || source.sharedDriveFolderId || source.driveFolderId || '').trim();
  if (!assessmentsFolderId) throw new Error('missing_assessments_folder_id');
  const testRoot = await getOrCreateDriveFolder(accessToken, assessmentsFolderId, TEST_ASSESSMENTS_FOLDER_NAME);
  const folderName = generateTestAssessmentFolderName(source);
  const folder = await getOrCreateDriveFolder(accessToken, testRoot.id, folderName);
  const photosFolder = await getOrCreateDriveFolder(accessToken, folder.id, assessmentSubfolderName('Photos', source));
  const cocsFolder = await getOrCreateDriveFolder(accessToken, folder.id, assessmentSubfolderName('COCs', source));
  const backupFolder = await getOrCreateDriveFolder(accessToken, folder.id, assessmentSubfolderName('Backup', source));
  return {
    status: 'ready',
    shellStatus: 'ready',
    isTestTraining: true,
    inspectionId: source.inspectionId,
    assessmentNumber: '',
    assessmentNumberSource: 'skipped_test_training',
    assessmentReservationId: '',
    folderId: folder.id,
    folderUrl: driveFolderUrl(folder),
    folderName,
    photosFolderId: photosFolder.id,
    photosFolderUrl: driveFolderUrl(photosFolder),
    technicianPhotosFolderId: photosFolder.id,
    technicianPhotosFolderUrl: driveFolderUrl(photosFolder),
    cocsFolderId: cocsFolder.id,
    cocsFolderUrl: driveFolderUrl(cocsFolder),
    backupFolderId: backupFolder.id,
    backupFolderUrl: driveFolderUrl(backupFolder),
    trackerRow: '',
    trackerUrl: '',
    trackerStatus: 'skipped_test_training',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    workerVersion: WORKER_VERSION,
    error: ''
  };
}

function buildCanonicalAssessmentSource(assessmentRow) {
  const raw = assessmentRow && isPlainObject(assessmentRow.raw_jsonb)
    ? structuredClone(assessmentRow.raw_jsonb)
    : {};
  const resume = isPlainObject(raw.resumeData) ? structuredClone(raw.resumeData) : {};
  const source = { ...resume, ...raw };
  source.stepData = {
    ...(isPlainObject(resume.stepData) ? resume.stepData : {}),
    ...(isPlainObject(raw.stepData) ? raw.stepData : {})
  };
  source.rooms = Array.isArray(raw.rooms) && raw.rooms.length
    ? structuredClone(raw.rooms)
    : (Array.isArray(resume.rooms) ? structuredClone(resume.rooms) : []);
  delete source.resumeData;
  return source;
}

function buildCanonicalHandoffFieldData(fieldData, source, canonicalSource) {
  const current = isPlainObject(fieldData) ? structuredClone(fieldData) : {};
  const system = isPlainObject(current.system) ? structuredClone(current.system) : {};
  const recovery = isPlainObject(system.inspectionRecovery) ? system.inspectionRecovery : {};
  const canonicalRecovery = {
    ...structuredClone(recovery),
    ...structuredClone(canonicalSource),
    rooms: Array.isArray(source.rooms) ? structuredClone(source.rooms) : [],
    stepData: isPlainObject(source.stepData) ? structuredClone(source.stepData) : {}
  };
  current.rooms = canonicalRecovery.rooms;
  current.system = { ...system, inspectionRecovery: canonicalRecovery };
  return current;
}

function buildHandoffSource(inspectionId, fieldData, body, canonicalSource = {}) {
  const recovery = fieldData.system && isPlainObject(fieldData.system.inspectionRecovery)
    ? fieldData.system.inspectionRecovery
    : {};
  const reviewedData = isPlainObject(body.reviewedData) ? body.reviewedData : {};
  const source = {
    ...recovery,
    ...canonicalSource,
    ...fieldData,
    ...reviewedData,
    ...body,
    inspectionId
  };
  source.rooms = Array.isArray(canonicalSource.rooms) && canonicalSource.rooms.length
    ? structuredClone(canonicalSource.rooms)
    : (Array.isArray(fieldData.rooms) && fieldData.rooms.length
        ? structuredClone(fieldData.rooms)
        : (Array.isArray(reviewedData.rooms) && reviewedData.rooms.length
            ? structuredClone(reviewedData.rooms)
            : (Array.isArray(body.rooms) && body.rooms.length
                ? structuredClone(body.rooms)
                : (Array.isArray(recovery.rooms) ? structuredClone(recovery.rooms) : []))));
  source.stepData = {
    ...(isPlainObject(recovery.stepData) ? recovery.stepData : {}),
    ...(isPlainObject(canonicalSource.stepData) ? canonicalSource.stepData : {})
  };
  source.system = {
    ...(isPlainObject(fieldData.system) ? fieldData.system : {}),
    ...(isPlainObject(reviewedData.system) ? reviewedData.system : {}),
    ...(isPlainObject(body.system) ? body.system : {})
  };
  source.clientName = firstNonEmpty(body.clientName, reviewedData.clientName, fieldData.clientName, recovery.clientName, fieldData.client);
  source.propertyAddress = firstNonEmpty(body.propertyAddress, reviewedData.propertyAddress, fieldData.propertyAddress, recovery.propertyAddress, fieldData.address);
  source.inspectorName = firstNonEmpty(body.inspectorName, reviewedData.inspectorName, fieldData.inspectorName, recovery.inspectorName, fieldData.inspector);
  source.inspectionDate = firstNonEmpty(body.inspectionDate, reviewedData.inspectionDate, fieldData.inspectionDate, recovery.inspectionDate, fieldData.date);
  source.inspectionType = firstNonEmpty(body.inspectionType, reviewedData.inspectionType, fieldData.inspectionType, recovery.inspectionType);
  source.isTestTraining = body.isTestTraining === true || body.is_test === true || reviewedData.isTestTraining === true || reviewedData.is_test === true || fieldData.isTestTraining === true || fieldData.is_test === true;
  return source;
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (value === false || value === 0) return value;
    if (value !== undefined && value !== null && String(value).trim() !== '') return value;
  }
  return '';
}

function stableHash(value) {
  if (value === undefined || value === null || value === '') return '';
  const text = stableStringify(value);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function driveFileFromReceipt(id, url, name = '') {
  return { id, name, webViewLink: url || (id ? `https://drive.google.com/drive/folders/${encodeURIComponent(id)}` : '') };
}

function generateTestAssessmentFolderName(source) {
  const lastName = getClientLastName(source.clientName);
  const street = getStreetAddressForFolder(source) || source.inspectionId || 'Unknown';
  const date = normalizeInspectionDate(source.inspectionDate || source.startedAt);
  return `TEST – ${date} – ${lastName} – ${street}`;
}

function getHandoffReceiptMissingReason(receipt = {}) {
  const missing = [];
  if (!(receipt.folderUrl || receipt.folderId)) missing.push('assessment folder');
  if (!(receipt.photosFolderUrl || receipt.photosFolderId || receipt.technicianPhotosFolderUrl || receipt.technicianPhotosFolderId)) missing.push('photos folder');
  if (!(receipt.spreadsheetUrl || receipt.spreadsheetId)) missing.push('review data spreadsheet');
  if (!(receipt.inspectionSpreadsheetUrl || receipt.inspectionSpreadsheetId || receipt.appInspectionSpreadsheetUrl || receipt.appInspectionSpreadsheetId)) missing.push('InHaus inspection spreadsheet');
  if (!(receipt.contextFileUrl || receipt.contextFileId)) missing.push('assessment context');
  if (Number(receipt.rawAppKeyCount || receipt.counts?.rawAppKeyCount || 0) <= 0) missing.push('raw app data rows');
  if (!(receipt.rawJsonUrl || receipt.rawReviewDataUrl)) missing.push('raw backup');
  if (!receipt.isTestTraining && !(receipt.trackerUrl || receipt.trackerRow || receipt.trackerRowUrl)) missing.push('tracker row');
  if (Number(receipt.photoFolderFailedCount || receipt.technicianPhotoFailedCount || 0) > 0) missing.push('photo copy failures');
  if (Number(receipt.photoFolderPendingCount || 0) > 0) missing.push('photo copy pending');
  return missing.length ? `missing:${missing.join(', ')}` : '';
}

function normalizeHandoffJobStatus(status) {
  const normalized = String(status || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (normalized === 'waiting_on_export_adapter') return normalized;
  if (['queued', 'running', 'repairing', 'ready', 'failed', 'cancelled'].includes(normalized)) return normalized;
  return normalized || 'queued';
}

function emptyToNull(value) {
  return value === undefined || value === null || value === '' ? null : value;
}

function isFreshDirectHandoffLock(row) {
  if (!row || !row.locked_at) return false;
  const lockedAt = Date.parse(row.locked_at);
  return Number.isFinite(lockedAt) && lockedAt > Date.now() - DIRECT_HANDOFF_LOCK_STALE_MS;
}

function durableJobToPublicJob(row) {
  if (!row || !isPlainObject(row)) return null;
  return {
    durableJobId: row.id || '',
    jobId: row.job_key || '',
    inspectionId: row.inspection_id || '',
    status: row.status || '',
    requestedBy: row.requested_by || '',
    requestedAt: row.requested_at || '',
    attemptCount: Number(row.attempt_count || 0),
    lastError: row.last_error || '',
    lastRunAt: row.last_run_at || '',
    nextRunAt: row.next_run_at || '',
    lockedAt: row.locked_at || '',
    lockedBy: row.locked_by || '',
    startedAt: row.started_at || '',
    finishedAt: row.finished_at || '',
    artifactReceipt: isPlainObject(row.receipt) ? row.receipt : null
  };
}

async function getDurableHandoffJob(env, inspectionId) {
  const params = new URLSearchParams();
  params.set('inspection_id', `eq.${inspectionId}`);
  params.set('select', 'id,job_key,inspection_id,is_test,status,requested_by,requested_at,attempt_count,last_error,last_run_at,next_run_at,locked_at,locked_by,started_at,finished_at,payload,receipt,worker_version,created_at,updated_at');
  params.set('order', 'updated_at.desc');
  params.set('limit', '1');
  const response = await fetch(normalizeSupabaseUrl(env, `/rest/v1/handoff_jobs?${params}`), {
    headers: serviceHeaders(env)
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`handoff_job_get_failed:${response.status}:${text.slice(0, 200)}`);
  const rows = text ? JSON.parse(text) : [];
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

function buildDurableHandoffJobPayload(inspectionId, job, receipt) {
  const cleanJob = isPlainObject(job) ? job : {};
  const cleanReceipt = isPlainObject(receipt) ? receipt : (isPlainObject(cleanJob.artifactReceipt) ? cleanJob.artifactReceipt : null);
  const now = new Date().toISOString();
  return {
    job_key: cleanJob.jobId || handoffJobId(inspectionId),
    inspection_id: inspectionId,
    is_test: cleanJob.isTestTraining === true || (cleanReceipt ? cleanReceipt.isTestTraining === true : false),
    status: normalizeHandoffJobStatus(cleanJob.status || (cleanReceipt && cleanReceipt.status) || 'queued'),
    requested_by: cleanJob.requestedBy || 'worker',
    requested_at: emptyToNull(cleanJob.requestedAt) || now,
    attempt_count: Number(cleanJob.attemptCount || 0),
    last_error: cleanJob.lastError || (cleanReceipt && cleanReceipt.error) || null,
    last_run_at: emptyToNull(cleanJob.lastRunAt || cleanReceipt && cleanReceipt.lastRunAt),
    next_run_at: emptyToNull(cleanJob.nextRunAt || cleanReceipt && cleanReceipt.nextRunAt),
    locked_at: emptyToNull(cleanJob.lockedAt),
    locked_by: emptyToNull(cleanJob.lockedBy),
    started_at: emptyToNull(cleanJob.startedAt),
    finished_at: emptyToNull(cleanJob.finishedAt),
    payload: {
      submitAttempt: cleanJob.submitAttempt || null,
      isTestTraining: cleanJob.isTestTraining === true,
      source: 'cloudflare_worker',
      workerVersion: WORKER_VERSION
    },
    receipt: cleanReceipt || null,
    worker_version: WORKER_VERSION,
    updated_at: now
  };
}

async function claimDirectHandoffJob(env, inspectionId, job, allowReadyRepair = false) {
  const now = new Date().toISOString();
  const lockId = `${WORKER_VERSION}:${crypto.randomUUID()}`;
  const claimedJob = {
    ...(isPlainObject(job) ? job : {}),
    status: 'running',
    lockedAt: now,
    lockedBy: lockId
  };
  const payload = buildDurableHandoffJobPayload(inspectionId, claimedJob, null);
  const insertParams = new URLSearchParams();
  insertParams.set('on_conflict', 'job_key');
  const insertResponse = await fetch(normalizeSupabaseUrl(env, `/rest/v1/handoff_jobs?${insertParams}`), {
    method: 'POST',
    headers: serviceHeaders(env, {
      'Content-Type': 'application/json',
      'Prefer': 'resolution=ignore-duplicates,return=representation'
    }),
    body: JSON.stringify(payload)
  });
  const insertText = await insertResponse.text();
  if (!insertResponse.ok) throw new Error(`handoff_job_claim_insert_failed:${insertResponse.status}:${insertText.slice(0, 200)}`);
  const insertedRows = insertText ? JSON.parse(insertText) : [];
  if (Array.isArray(insertedRows) && insertedRows.length) {
    return { acquired: true, row: insertedRows[0] };
  }

  const staleBefore = new Date(Date.now() - DIRECT_HANDOFF_LOCK_STALE_MS).toISOString();
  const patchParams = new URLSearchParams();
  patchParams.set('job_key', `eq.${handoffJobId(inspectionId)}`);
  patchParams.set('status', allowReadyRepair
    ? 'in.(queued,running,waiting_on_export_adapter,repairing,ready,failed)'
    : 'in.(queued,running,waiting_on_export_adapter,repairing,failed)');
  patchParams.set('or', `(locked_at.is.null,locked_at.lt.${staleBefore})`);
  const patchResponse = await fetch(normalizeSupabaseUrl(env, `/rest/v1/handoff_jobs?${patchParams}`), {
    method: 'PATCH',
    headers: serviceHeaders(env, {
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    }),
    body: JSON.stringify({
      status: 'running',
      requested_by: claimedJob.requestedBy || 'worker',
      requested_at: claimedJob.requestedAt || now,
      locked_at: now,
      locked_by: lockId,
      started_at: now,
      finished_at: null,
      last_error: null,
      updated_at: now,
      worker_version: WORKER_VERSION
    })
  });
  const patchText = await patchResponse.text();
  if (!patchResponse.ok) throw new Error(`handoff_job_claim_patch_failed:${patchResponse.status}:${patchText.slice(0, 200)}`);
  const patchedRows = patchText ? JSON.parse(patchText) : [];
  if (Array.isArray(patchedRows) && patchedRows.length) {
    return { acquired: true, row: patchedRows[0] };
  }

  return { acquired: false, row: await getDurableHandoffJob(env, inspectionId) };
}

async function queueDurableHandoffJob(env, inspectionId, job, receipt, observedRow) {
  const queuedJob = {
    ...(isPlainObject(job) ? job : {}),
    status: 'queued',
    lockedAt: '',
    lockedBy: ''
  };
  const payload = buildDurableHandoffJobPayload(inspectionId, queuedJob, receipt);

  if (!observedRow) {
    const params = new URLSearchParams();
    params.set('on_conflict', 'job_key');
    const response = await fetch(normalizeSupabaseUrl(env, `/rest/v1/handoff_jobs?${params}`), {
      method: 'POST',
      headers: serviceHeaders(env, {
        'Content-Type': 'application/json',
        'Prefer': 'resolution=ignore-duplicates,return=representation'
      }),
      body: JSON.stringify(payload)
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`handoff_job_queue_insert_failed:${response.status}:${text.slice(0, 200)}`);
    const rows = text ? JSON.parse(text) : [];
    if (Array.isArray(rows) && rows.length) return { acquired: true, row: rows[0] };
    return { acquired: false, row: await getDurableHandoffJob(env, inspectionId) };
  }

  const params = new URLSearchParams();
  params.set('job_key', `eq.${handoffJobId(inspectionId)}`);
  if (observedRow.updated_at) params.set('updated_at', `eq.${observedRow.updated_at}`);
  else params.set('status', `eq.${normalizeHandoffJobStatus(observedRow.status)}`);
  const response = await fetch(normalizeSupabaseUrl(env, `/rest/v1/handoff_jobs?${params}`), {
    method: 'PATCH',
    headers: serviceHeaders(env, {
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    }),
    body: JSON.stringify(payload)
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`handoff_job_queue_patch_failed:${response.status}:${text.slice(0, 200)}`);
  const rows = text ? JSON.parse(text) : [];
  if (Array.isArray(rows) && rows.length) return { acquired: true, row: rows[0] };
  return { acquired: false, row: await getDurableHandoffJob(env, inspectionId) };
}

async function upsertDurableHandoffJob(env, inspectionId, job, receipt) {
  const cleanReceipt = isPlainObject(receipt) ? receipt : (isPlainObject(job && job.artifactReceipt) ? job.artifactReceipt : null);
  const payload = buildDurableHandoffJobPayload(inspectionId, job, receipt);
  const params = new URLSearchParams();
  params.set('on_conflict', 'job_key');
  const response = await fetch(normalizeSupabaseUrl(env, `/rest/v1/handoff_jobs?${params}`), {
    method: 'POST',
    headers: serviceHeaders(env, {
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates,return=representation'
    }),
    body: JSON.stringify(payload)
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`handoff_job_upsert_failed:${response.status}:${text.slice(0, 200)}`);
  const rows = text ? JSON.parse(text) : [];
  const saved = Array.isArray(rows) && rows.length ? rows[0] : null;
  if (!saved || !saved.id) throw new Error('handoff_job_upsert_missing_id');
  if (cleanReceipt) await upsertHandoffArtifacts(env, inspectionId, saved, cleanReceipt);
  return saved;
}

function handoffArtifactRows(inspectionId, jobRow, receipt) {
  const rows = [];
  const add = (artifactKey, artifactType, artifactId, artifactUrl, status = 'ready', metadata = {}) => {
    if (!artifactId && !artifactUrl) return;
    rows.push({
      job_id: jobRow.id,
      inspection_id: inspectionId,
      artifact_key: artifactKey,
      artifact_type: artifactType,
      artifact_id: String(artifactId || ''),
      artifact_url: String(artifactUrl || ''),
      status,
      checksum: metadata.checksum || null,
      metadata,
      updated_at: new Date().toISOString()
    });
  };
  const photoFailedCount = Number(receipt.photoFolderFailedCount || receipt.technicianPhotoFailedCount || 0);
  const photoPendingCount = Number(receipt.photoFolderPendingCount || 0);
  const photoArtifactStatus = photoFailedCount > 0 ? 'failed' : (photoPendingCount > 0 ? 'running' : 'ready');
  add('assessment_folder', 'drive_folder', receipt.folderId, receipt.folderUrl, 'ready', { name: receipt.folderName || '' });
  add('photos_folder', 'drive_folder', receipt.photosFolderId || receipt.technicianPhotosFolderId, receipt.photosFolderUrl || receipt.technicianPhotosFolderUrl, photoArtifactStatus, {
    copied: Number(receipt.photoFolderCopiedCount || receipt.technicianPhotoCopyCount || 0),
    existing: Number(receipt.photoFolderAlreadyPackagedCount || receipt.technicianPhotoExistingCount || 0),
    linked: Number(receipt.photoFolderLinkedCount || 0),
    pending: photoPendingCount,
    failed: photoFailedCount
  });
  add('review_portal_data_spreadsheet', 'google_sheet', receipt.spreadsheetId, receipt.spreadsheetUrl, 'ready', {
    rawKeyCount: Number(receipt.rawKeyCount || receipt.rawReviewKeyCount || 0),
    formattedReviewRowCount: Number(receipt.formattedReviewRowCount || 0),
    photoLogCount: Number(receipt.photoLogCount || 0),
    roomDetailCount: Number(receipt.roomDetailCount || 0)
  });
  add(
    'inhaus_inspection_spreadsheet',
    'google_sheet',
    receipt.inspectionSpreadsheetId || receipt.appInspectionSpreadsheetId,
    receipt.inspectionSpreadsheetUrl || receipt.appInspectionSpreadsheetUrl,
    'ready',
    {
      roomDetailCount: Number(receipt.appRoomDetailCount || receipt.counts?.appRoomDetailCount || 0),
      rawAppKeyCount: Number(receipt.rawAppKeyCount || receipt.counts?.rawAppKeyCount || 0)
    }
  );
  add('assessment_context', 'markdown', receipt.contextFileId, receipt.contextFileUrl, 'ready');
  add('raw_review_data', 'raw_json_backup', receipt.rawJsonId || '', receipt.rawJsonUrl || receipt.rawReviewDataUrl, 'ready', {
    rawKeyCount: Number(receipt.rawKeyCount || receipt.rawReviewKeyCount || 0)
  });
  add('tracker_row', 'tracker_row', receipt.trackerRow || '', receipt.trackerUrl || receipt.trackerRowUrl, receipt.isTestTraining ? 'skipped' : 'ready', {
    trackerStatus: receipt.trackerStatus || ''
  });
  add('cocs_folder', 'drive_folder', receipt.cocsFolderId, receipt.cocsFolderUrl);
  add('backup_folder', 'drive_folder', receipt.backupFolderId, receipt.backupFolderUrl);
  return rows;
}

async function upsertHandoffArtifacts(env, inspectionId, jobRow, receipt) {
  const rows = handoffArtifactRows(inspectionId, jobRow, receipt);
  if (!rows.length) return [];
  const params = new URLSearchParams();
  params.set('on_conflict', 'job_id,artifact_key');
  const response = await fetch(normalizeSupabaseUrl(env, `/rest/v1/handoff_artifacts?${params}`), {
    method: 'POST',
    headers: serviceHeaders(env, {
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates,return=representation'
    }),
    body: JSON.stringify(rows)
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`handoff_artifacts_upsert_failed:${response.status}:${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : [];
}

async function saveHandoffJobState(env, inspectionId, fieldData, job, receipt, options = {}) {
  const provided = isPlainObject(fieldData) ? structuredClone(fieldData) : {};
  const preferProvided = options.preferProvidedFieldData === true;
  await upsertDurableHandoffJob(env, inspectionId, job, receipt);

  await mutateReviewDataWithRetry(env, inspectionId, currentFieldData => {
    const current = isPlainObject(currentFieldData) ? structuredClone(currentFieldData) : {};
    const nextFieldData = preferProvided
      ? { ...current, ...provided }
      : { ...provided, ...current };
    const providedSystem = isPlainObject(provided.system) ? provided.system : {};
    const currentSystem = isPlainObject(current.system) ? current.system : {};
    const system = preferProvided
      ? { ...currentSystem, ...providedSystem }
      : { ...providedSystem, ...currentSystem };
    system.handoffJob = {
      ...(isPlainObject(job) ? job : {}),
      artifactReceipt: receipt || (job && job.artifactReceipt) || null
    };
    if (receipt) system.tannerHandoff = receipt;
    nextFieldData.system = system;
    if (receipt) {
      nextFieldData.reviewPortalData = receipt;
      nextFieldData.folderId = receipt.folderId || nextFieldData.folderId || '';
      nextFieldData.folderUrl = receipt.folderUrl || nextFieldData.folderUrl || '';
      nextFieldData.assessmentFolderId = receipt.folderId || nextFieldData.assessmentFolderId || '';
      nextFieldData.assessmentFolderUrl = receipt.folderUrl || nextFieldData.assessmentFolderUrl || '';
      nextFieldData.reviewPortalDataSpreadsheetId = receipt.spreadsheetId || nextFieldData.reviewPortalDataSpreadsheetId || '';
      nextFieldData.reviewPortalDataSpreadsheetUrl = receipt.spreadsheetUrl || nextFieldData.reviewPortalDataSpreadsheetUrl || '';
      nextFieldData.reviewPortalDataUrl = receipt.spreadsheetUrl || nextFieldData.reviewPortalDataUrl || '';
      nextFieldData.rawReviewDataUrl = receipt.rawJsonUrl || receipt.rawReviewDataUrl || nextFieldData.rawReviewDataUrl || '';
      nextFieldData.rawReviewDataJsonUrl = receipt.rawJsonUrl || receipt.rawReviewDataUrl || nextFieldData.rawReviewDataJsonUrl || '';
      nextFieldData.technicianPhotosFolderId = receipt.technicianPhotosFolderId || receipt.photosFolderId || nextFieldData.technicianPhotosFolderId || '';
      nextFieldData.technicianPhotosFolderUrl = receipt.technicianPhotosFolderUrl || receipt.photosFolderUrl || nextFieldData.technicianPhotosFolderUrl || '';
      nextFieldData.photosFolderId = receipt.photosFolderId || receipt.technicianPhotosFolderId || nextFieldData.photosFolderId || '';
      nextFieldData.photosFolderUrl = receipt.photosFolderUrl || receipt.technicianPhotosFolderUrl || nextFieldData.photosFolderUrl || '';
      nextFieldData.cocsFolderId = receipt.cocsFolderId || nextFieldData.cocsFolderId || '';
      nextFieldData.cocsFolderUrl = receipt.cocsFolderUrl || nextFieldData.cocsFolderUrl || '';
      nextFieldData.backupFolderId = receipt.backupFolderId || nextFieldData.backupFolderId || '';
      nextFieldData.backupFolderUrl = receipt.backupFolderUrl || nextFieldData.backupFolderUrl || '';
      nextFieldData.trackerRow = receipt.trackerRow || nextFieldData.trackerRow || '';
      nextFieldData.trackerUrl = receipt.trackerUrl || nextFieldData.trackerUrl || '';
      nextFieldData.trackerRowUrl = receipt.trackerUrl || nextFieldData.trackerRowUrl || '';
      nextFieldData.trackerStatus = receipt.trackerStatus || nextFieldData.trackerStatus || '';
      nextFieldData.handoffStatus = receipt.status || nextFieldData.handoffStatus || '';
      nextFieldData.handoffUpdatedAt = receipt.updatedAt || new Date().toISOString();
      nextFieldData.lastHandoffError = receipt.error || '';
      nextFieldData.handoffAttemptCount = receipt.attemptCount || nextFieldData.handoffAttemptCount || '';
      nextFieldData.handoffLastRunAt = receipt.lastRunAt || nextFieldData.handoffLastRunAt || '';
      nextFieldData.handoffNextRunAt = receipt.nextRunAt || '';
      nextFieldData.isTestTraining = receipt.isTestTraining === true;
    }
    return nextFieldData;
  }, 'handoff_state_save_failed');
}

async function saveHandoffRequestFieldData(env, inspectionId, fieldData) {
  const provided = isPlainObject(fieldData) ? structuredClone(fieldData) : {};
  await mutateReviewDataWithRetry(env, inspectionId, currentFieldData => {
    const current = isPlainObject(currentFieldData) ? structuredClone(currentFieldData) : {};
    const providedSystem = isPlainObject(provided.system) ? provided.system : {};
    const currentSystem = isPlainObject(current.system) ? current.system : {};
    const system = { ...currentSystem, ...providedSystem };
    if (currentSystem.handoffJob) system.handoffJob = currentSystem.handoffJob;
    if (currentSystem.tannerHandoff) system.tannerHandoff = currentSystem.tannerHandoff;
    return { ...current, ...provided, system };
  }, 'handoff_request_save_failed');
}

async function getTrackerContext(accessToken, spreadsheetId) {
  const values = await getSheetValues(accessToken, spreadsheetId, sheetRange('A:AO'));
  return {
    spreadsheetId,
    values,
    headers: getTrackerHeaderMap(values),
    columns: getTrackerColumnsFromValues(values)
  };
}

async function getSheetValues(accessToken, spreadsheetId, range) {
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?majorDimension=ROWS`, {
    headers: driveHeaders(accessToken)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`sheet_values_failed:${res.status}:${JSON.stringify(data).slice(0, 200)}`);
  return Array.isArray(data.values) ? data.values : [];
}

async function batchUpdateSheetValues(accessToken, spreadsheetId, updates) {
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values:batchUpdate`, {
    method: 'POST',
    headers: driveHeaders(accessToken, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      valueInputOption: 'USER_ENTERED',
      data: updates
    })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`sheet_batch_update_failed:${res.status}:${JSON.stringify(data).slice(0, 200)}`);
  return data;
}

function getTrackerHeaderMap(values) {
  const map = { exact: {}, normalized: {} };
  (values || []).slice(0, Math.max(1, TRACKER_DATA_START - 1)).forEach(function(row) {
    (row || []).forEach(function(value, index) {
      const exact = String(value || '').trim();
      if (!exact) return;
      const col = index + 1;
      if (!map.exact[exact]) map.exact[exact] = col;
      const normalized = normalizeTrackerHeader(exact);
      if (normalized && !map.normalized[normalized]) map.normalized[normalized] = col;
    });
  });
  return map;
}

function normalizeTrackerHeader(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function findTrackerColumn(headerMap, labels, fallbackCol) {
  for (const label of labels) {
    const exact = String(label || '').trim();
    if (headerMap.exact[exact]) return headerMap.exact[exact];
    const normalized = normalizeTrackerHeader(exact);
    if (headerMap.normalized[normalized]) return headerMap.normalized[normalized];
  }
  return fallbackCol || 0;
}

function getTrackerColumnsFromValues(values) {
  const headers = getTrackerHeaderMap(values);
  return {
    trackerStatus: findTrackerColumn(headers, ['Overall Status', 'Status'], 1),
    assessment: findTrackerColumn(headers, ['Assessment #', 'Assessment No', 'Assessment Number', 'Assessment'], 2),
    assessmentType: findTrackerColumn(headers, ['Assessment Type', 'Type'], 3),
    client: findTrackerColumn(headers, ['Name', 'Client Name', 'Client', 'Customer', 'Customer Name'], 4),
    date: findTrackerColumn(headers, ['Assessment Date', 'Inspection Date', 'Date'], 5),
    address: findTrackerColumn(headers, ['Address', 'Property Address', 'Street Address'], 6),
    serviceLocation: findTrackerColumn(headers, ['Service Location', 'Location'], 7),
    customerId: findTrackerColumn(headers, ['Client ID', 'C-ID', 'Customer ID', 'Customer Id', 'CID'], 8),
    homeId: findTrackerColumn(headers, ['Home ID', 'H-ID', 'HID'], 9),
    reportId: findTrackerColumn(headers, ['Report ID', 'RPT-ID', 'RPT ID', 'Report'], 10),
    inhId: findTrackerColumn(headers, ['Inspector App ID', 'INH-ID', 'INH ID', 'Inspection ID', 'InspectionId'], 11),
    folder: findTrackerColumn(headers, ['Google Drive Folder', 'Assessment Folder', 'Folder Link', 'Drive Folder', 'Folder URL', 'Folder'], 41)
  };
}

function inferServiceLocationForTracker(source) {
  const explicit = String(
    (source && (source.serviceLocation || source.market || source.region || source.location)) ||
    ''
  ).trim().toUpperCase();
  if (explicit === 'MSP' || explicit === 'CO') return explicit;

  const text = String(
    (source && (source.propertyAddress || source.address || source.city || source.state || '')) ||
    ''
  ).toUpperCase();
  if (/\b(MN|MINNESOTA|MINNEAPOLIS|ST PAUL|SAINT PAUL|EDEN PRAIRIE|MSP)\b/.test(text)) return 'MSP';
  return 'CO';
}

function findNextAvailableTrackerRow(values) {
  for (let index = TRACKER_DATA_START - 1; index < values.length; index += 1) {
    const row = values[index] || [];
    const hasAnyValue = row.slice(0, 11).some(function(cell) {
      return String(cell || '').trim() !== '';
    });
    if (!hasAnyValue) return index + 1;
  }
  return Math.max(values.length + 1, TRACKER_DATA_START);
}

function findTrackerRowByInspectionIdValues(values, col, inspectionId) {
  if (!col || !inspectionId) return 0;
  for (let index = TRACKER_DATA_START - 1; index < values.length; index += 1) {
    if (String((values[index] || [])[col - 1] || '').trim() === String(inspectionId).trim()) {
      return index + 1;
    }
  }
  return 0;
}

function getTrackerCell(values, row, col) {
  return String(((values[row - 1] || [])[col - 1]) || '').trim();
}

async function resolveAssessmentNumberReservation(env, source, trackerContext, existingTrackerRow) {
  const existingAssessmentNumber = existingTrackerRow
    ? getTrackerCell(trackerContext.values, existingTrackerRow, trackerContext.columns.assessment || 2)
    : '';
  if (existingAssessmentNumber) {
    return {
      assessmentNumber: existingAssessmentNumber,
      source: 'existing_tracker_row',
      reservationId: ''
    };
  }

  try {
    return await reserveAssessmentNumberFromSupabase(env, source);
  } catch (err) {
    if (!allowTrackerSequenceFallback(env)) {
      throw err;
    }
    return {
      assessmentNumber: getNextAssessmentNumberFromTracker(trackerContext.values),
      source: ASSESSMENT_NUMBER_SOURCE_TRACKER,
      reservationId: '',
      fallbackError: err && err.message ? err.message : String(err)
    };
  }
}

async function reserveAssessmentNumberFromSupabase(env, source) {
  const inspectionId = cleanId(source.inspectionId || source.id, 'inspectionId');
  const inspectionDate = String(source.inspectionDate || source.startedAt || '').slice(0, 10) || null;
  const params = new URLSearchParams();
  params.set('on_conflict', 'inspection_id');
  params.set('select', 'id,inspection_id,assessment_number,assessment_number_display,reservation_status,created_at,updated_at');
  const response = await fetch(normalizeSupabaseUrl(env, `/rest/v1/assessment_number_reservations?${params}`), {
    method: 'POST',
    headers: serviceHeaders(env, {
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates,return=representation'
    }),
    body: JSON.stringify({
      inspection_id: inspectionId,
      client_name: source.clientName || source.ownerName || null,
      property_address: source.propertyAddress || source.address || null,
      inspector_name: source.inspectorName || source.inspector || null,
      inspection_date: inspectionDate,
      requested_by: 'cloudflare_worker_start_shell',
      metadata: {
        workerVersion: WORKER_VERSION,
        source: 'start-inspection-shell'
      },
      updated_at: new Date().toISOString()
    })
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`assessment_number_reservation_failed:${response.status}:${text.slice(0, 200)}`);
  }
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!isPlainObject(row)) {
    throw new Error('assessment_number_reservation_empty');
  }
  const assessmentNumber = row.assessment_number_display || formatAssessmentNumber(row.assessment_number);
  if (!assessmentNumber) {
    throw new Error('assessment_number_reservation_missing_number');
  }
  return {
    assessmentNumber,
    source: ASSESSMENT_NUMBER_SOURCE_SUPABASE,
    reservationId: row.id || row.reservation_id || '',
    reservationStatus: row.reservation_status || ''
  };
}

function allowTrackerSequenceFallback(env) {
  const fallbackRequested = String(env.ALLOW_TRACKER_SEQUENCE_FALLBACK || '').trim().toLowerCase() === 'true';
  const fallbackDecision = String(env.TRACKER_SEQUENCE_FALLBACK_DECISION || '').trim().toLowerCase();
  return fallbackRequested && fallbackDecision === 'approved';
}

function formatAssessmentNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return '';
  return String(Math.trunc(number)).padStart(3, '0');
}

function getNextAssessmentNumberFromTracker(values) {
  let highest = -1;
  for (let index = TRACKER_DATA_START - 1; index < values.length; index += 1) {
    const cell = String((values[index] || [])[1] || '').trim();
    if (!cell || cell === 'N/A' || /^TEST/i.test(cell) || /^TRAIN/i.test(cell)) continue;
    const num = parseInt(cell, 10);
    if (!Number.isNaN(num) && num > highest) highest = num;
  }
  if (highest < 0) throw new Error('no_numeric_assessment_numbers_found_in_tracker');
  return String(highest + 1).padStart(3, '0');
}

async function upsertReportTrackerRow(accessToken, trackerSheetId, trackerContext, source, artifacts) {
  const inspectionId = cleanId(source.inspectionId || source.id, 'inspectionId');
  const columns = trackerContext.columns;
  const row = artifacts.existingTrackerRow ||
    findTrackerRowByInspectionIdValues(trackerContext.values, columns.inhId, inspectionId) ||
    findNextAvailableTrackerRow(trackerContext.values);
  const folderUrl = driveFolderUrl(artifacts.folder);
  const trackerStatus = 'In Progress';
  const inspectionDate = String(source.inspectionDate || source.startedAt || '').slice(0, 10);
  const folderFormula = trackerFormula(folderUrl, 'Assessment Folder');
  const updates = [];
  addTrackerUpdate(updates, row, columns.trackerStatus, trackerStatus);
  addTrackerUpdate(updates, row, columns.assessment, artifacts.assessmentNumber);
  addTrackerUpdate(updates, row, columns.assessmentType, source.assessmentType || source.inspectionType || 'Home Health Assessment');
  addTrackerUpdate(updates, row, columns.client, source.clientName || '');
  addTrackerUpdate(updates, row, columns.date, inspectionDate);
  addTrackerUpdate(updates, row, columns.address, source.propertyAddress || source.address || '');
  addTrackerUpdate(updates, row, columns.serviceLocation, inferServiceLocationForTracker(source));
  addTrackerUpdate(updates, row, columns.customerId, source.customerId || source.cId || source.cid || '');
  addTrackerUpdate(updates, row, columns.homeId, source.homeId || source.hId || source.hid || '');
  addTrackerUpdate(updates, row, columns.reportId, source.reportId || source.rptId || source.rpt_id || '');
  addTrackerUpdate(updates, row, columns.inhId, inspectionId);
  addTrackerUpdate(updates, row, columns.folder, folderFormula);
  await batchUpdateSheetValues(accessToken, trackerSheetId, updates);
  return {
    row,
    url: `https://docs.google.com/spreadsheets/d/${encodeURIComponent(trackerSheetId)}/edit#range=A${row}`,
    status: trackerStatus
  };
}

async function verifyTrackerReservation(accessToken, trackerSheetId, inspectionId, assessmentNumber, expectedRow) {
  const refreshed = await getTrackerContext(accessToken, trackerSheetId);
  const columns = refreshed.columns;
  const inhColumn = columns.inhId || 10;
  const assessmentColumn = columns.assessment || 2;
  const row = findTrackerRowByInspectionIdValues(refreshed.values, inhColumn, inspectionId);
  if (!row) throw new Error(`tracker_reservation_missing:${inspectionId}`);
  if (expectedRow && Number(row) !== Number(expectedRow)) {
    throw new Error(`tracker_reservation_row_mismatch:${inspectionId}:expected_${expectedRow}:found_${row}`);
  }
  const savedAssessmentNumber = getTrackerCell(refreshed.values, row, assessmentColumn);
  if (savedAssessmentNumber !== String(assessmentNumber)) {
    throw new Error(`tracker_reservation_number_mismatch:${inspectionId}:expected_${assessmentNumber}:found_${savedAssessmentNumber || 'blank'}`);
  }
  const conflictingRows = [];
  for (let index = TRACKER_DATA_START - 1; index < refreshed.values.length; index += 1) {
    const trackerRow = index + 1;
    if (trackerRow === row) continue;
    const candidateNumber = getTrackerCell(refreshed.values, trackerRow, assessmentColumn);
    if (candidateNumber !== String(assessmentNumber)) continue;
    const candidateInspectionId = getTrackerCell(refreshed.values, trackerRow, inhColumn);
    if (candidateInspectionId && candidateInspectionId !== inspectionId) conflictingRows.push(trackerRow);
  }
  if (conflictingRows.length) {
    throw new Error(`tracker_assessment_number_conflict:${assessmentNumber}:rows_${conflictingRows.join('_')}`);
  }
  return { row, assessmentNumber: savedAssessmentNumber };
}

function addTrackerUpdate(updates, row, col, value) {
  if (!col || value === undefined || value === null || value === '') return;
  updates.push({
    range: sheetRange(`${columnLetter(col)}${row}`),
    values: [[value]]
  });
}

function sheetRange(a1Range) {
  return `'${String(TRACKER_TAB_REPORT).replace(/'/g, "''")}'!${a1Range}`;
}

function trackerFormula(url, label) {
  if (!url) return '';
  return `=HYPERLINK("${String(url).replace(/"/g, '""')}","${String(label || 'Open').replace(/"/g, '""')}")`;
}

function columnLetter(col) {
  let number = Number(col);
  let letters = '';
  while (number > 0) {
    const rem = (number - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    number = Math.floor((number - 1) / 26);
  }
  return letters;
}

function isTestTrainingInspection(source) {
  if (!source) return false;
  if (source.is_test === true || source.isTest === true || source.isTestTraining === true) return true;
  const explicit = [
    source.inspectionType,
    source.assessmentType
  ].filter(Boolean).join(' ');
  return /(^|\b)(test|training|practice|demo)(\b|$)/i.test(explicit);
}

function explicitAssessmentClassification(source) {
  if (!isPlainObject(source)) return '';
  const candidates = [source];
  if (isPlainObject(source.resumeData)) candidates.push(source.resumeData);
  if (candidates.some(candidate => isTestTrainingInspection(candidate))) return 'test';
  const explicitTypes = candidates.flatMap(candidate => [
    candidate.assessmentType,
    candidate.inspectionType
  ]).map(value => String(value || '').trim().toLowerCase()).filter(Boolean);
  return explicitTypes.some(value => value === 'home health assessment' || value === 'real assessment') ? 'real' : '';
}

function requireExplicitAssessmentClassification(source) {
  const classification = explicitAssessmentClassification(source);
  if (classification) return classification;
  const error = new Error('assessment_type_required:choose_home_health_assessment_or_test_training');
  error.statusCode = 400;
  throw error;
}

function normalizeClassificationStatus(value) {
  return String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function startInspectionShellIsReady(shell) {
  if (!isPlainObject(shell)) return false;
  const status = normalizeClassificationStatus(shell.shellStatus || shell.status || '');
  return status === 'ready' || status === 'skipped_test_training';
}

function shellAssessmentClassification(shell) {
  if (!startInspectionShellIsReady(shell)) return '';
  if (shell.isTestTraining === true || normalizeClassificationStatus(shell.trackerStatus) === 'skipped_test_training') {
    return 'test';
  }
  return 'real';
}

function assessmentClassificationLabel(classification) {
  return classification === 'test' ? 'Test / Training' : 'Home Health Assessment';
}

function assertAssessmentClassificationMatchesShell(shell, source) {
  const locked = shellAssessmentClassification(shell);
  const requested = explicitAssessmentClassification(source);
  if (!locked || !requested || locked === requested) return locked || requested;
  const error = new Error(
    `assessment_type_locked_after_shell:expected_${locked}:received_${requested}`
  );
  error.statusCode = 409;
  throw error;
}

function withAssessmentClassification(source, classification) {
  const normalized = isPlainObject(source) ? structuredClone(source) : {};
  const isTestTraining = classification === 'test';
  const apply = target => {
    if (!isPlainObject(target)) return;
    target.assessmentType = assessmentClassificationLabel(classification);
    target.isTestTraining = isTestTraining;
    target.isTest = isTestTraining;
    target.is_test = isTestTraining;
    target.testTraining = isTestTraining;
  };
  apply(normalized);
  apply(normalized.resumeData);
  return normalized;
}

function generateAssessmentFolderName(assessmentNumber, source) {
  const lastName = getClientLastName(source.clientName);
  const street = getStreetAddressForFolder(source) || source.inspectionId || source.id || 'Unknown';
  const date = normalizeInspectionDate(source.inspectionDate || source.startedAt);
  return `${assessmentNumber} – ${date} – ${lastName} – ${street}`;
}

function assessmentSubfolderName(prefix, source) {
  const lastName = getClientLastName(source && source.clientName);
  const street = getStreetAddressForFolder(source || {});
  return `${prefix} - ${lastName}${prefix === 'Photos' && street ? ` (${street})` : ''}`;
}

function getClientLastName(fullName) {
  const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : 'Unknown';
}

function getStreetAddressForFolder(source) {
  const address = String((source && (source.propertyAddress || source.address)) || '').trim();
  if (!address) return '';
  return address.split(',')[0].trim();
}

function normalizeInspectionDate(value) {
  const text = String(value || '').trim();
  const match = text.match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : new Date().toISOString().slice(0, 10);
}

function driveFolderUrl(folder) {
  if (!folder) return '';
  return folder.webViewLink || (folder.id ? `https://drive.google.com/drive/folders/${encodeURIComponent(folder.id)}` : '');
}

function isReviewAuthorized(request, fallbackToken, env) {
  const authorization = String(request.headers.get('Authorization') || '');
  const bearerToken = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
  const provided = bearerToken || String(fallbackToken || '');
  return !!provided && provided === String(env.REVIEW_ACCESS_TOKEN || '');
}

function cleanReviewKey(value, fieldName) {
  const text = String(value || '').trim();
  if (!text) throw new Error(`missing_${fieldName}`);
  if (text.length > 160 || !/^[A-Za-z0-9_.:-]+$/.test(text)) throw new Error(`invalid_${fieldName}`);
  return text;
}

function cleanActivityText(value, fieldName, maxLength = 120, allowBlank = false) {
  const text = String(value || '').trim();
  if (!text && !allowBlank) throw new Error(`missing_${fieldName}`);
  return text.slice(0, maxLength);
}

function sanitizeActivityPayload(payload) {
  const source = isPlainObject(payload) ? payload : {};
  const blocked = new Set([
    'token',
    'sharedsecret',
    '_syncSecret',
    '_syncsecret',
    'value',
    'rawvalue',
    'oldvalue',
    'previousvalue',
    'currentvalue',
    'newvalue',
    'fieldvalue',
    'inputvalue',
    'text',
    'rawtext',
    'note',
    'notes',
    'roomnote',
    'roomnotes',
    'inspectornote',
    'inspectornotes',
    'tannernote',
    'tannernotes',
    'caption',
    'description',
    'body',
    'content',
    'comment',
    'comments',
    'message',
    'transcript'
  ]);
  const clean = {};
  Object.entries(source).forEach(([key, value]) => {
    if (blocked.has(String(key).toLowerCase())) return;
    if (value === undefined) return;
    if (typeof value === 'string') clean[key] = value.slice(0, 240);
    else if (typeof value === 'number' || typeof value === 'boolean' || value === null) clean[key] = value;
    else if (Array.isArray(value)) clean[key] = value.slice(0, 20).map(item => {
      if (typeof item === 'string') return item.slice(0, 120);
      if (isPlainObject(item)) return sanitizeActivityPayload(item);
      return item;
    });
    else if (isPlainObject(value)) clean[key] = sanitizeActivityPayload(value);
  });
  return clean;
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
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

async function updatePhotoMetadata(env, inspectionId, photoId, payload) {
  const body = { ...payload };
  if (body.slot === null) body.slot = null;
  const params = new URLSearchParams();
  params.set('inspection_id', `eq.${inspectionId}`);
  params.set('photo_id', `eq.${photoId}`);
  const res = await fetch(normalizeSupabaseUrl(env, `/rest/v1/inspector_photo_uploads?${params}`), {
    method: 'PATCH',
    headers: serviceHeaders(env, {
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    }),
    body: JSON.stringify(body)
  });
  const detail = await res.text().catch(() => '');
  if (!res.ok) throw new Error(`metadata_update_failed:${res.status}:${detail.slice(0, 200)}`);
  const rows = detail ? JSON.parse(detail) : [];
  if (!Array.isArray(rows) || !rows.length) throw new Error('metadata_not_found');
  return rows[0];
}

async function getUnmirroredPhotoRows(env, inspectionId) {
  const params = new URLSearchParams();
  params.set('inspection_id', `eq.${inspectionId}`);
  params.set('drive_url', 'is.null');
  params.set('source_system', 'neq.deleted');
  params.set('select', 'photo_id,inspection_id,room_name,step_name,caption,slot,storage_path,drive_url,created_at');

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
  const room = safeDriveNamePart(row.room_name, 55) || 'Unassigned';
  const step = safeDriveNamePart(row.step_name, 45);
  const caption = safeDriveNamePart(row.caption, 70) || 'Photo';
  const pieces = [room];
  if (step && step.toLowerCase() !== 'photos' && step.toLowerCase() !== room.toLowerCase()) pieces.push(step);
  pieces.push(caption, row.photo_id || 'photo');
  return `${pieces.join(' - ')}.jpg`;
}

function safeDriveNamePart(value, maxLength) {
  return String(value || '')
    .replace(/[\u0000-\u001f/\\:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

async function getGoogleAccessToken(env) {
  const account = parseServiceAccount(env.GOOGLE_SERVICE_ACCOUNT);
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = {
    iss: account.client_email,
    scope: GOOGLE_SCOPES,
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

async function createOrUpdateReviewDataSpreadsheet(accessToken, folderId, source, fieldData, photoRows) {
  const title = reviewSpreadsheetTitle(source);
  const spreadsheet = await getOrCreateDriveFile(accessToken, folderId, title, DRIVE_SPREADSHEET_MIME);
  await ensureSpreadsheetTabs(accessToken, spreadsheet.id, ['Review Portal Data', 'Raw Review Data', 'Photo Log', 'Room Details']);

  const formattedRows = buildFormattedReviewRows(fieldData);
  const rawRows = buildRawReviewRows(fieldData);
  const photoLogRows = buildPhotoLogRows(photoRows);
  const roomRows = buildRoomDetailRows(fieldData, photoRows);
  await clearSheetTabs(accessToken, spreadsheet.id, ['Review Portal Data', 'Raw Review Data', 'Photo Log', 'Room Details']);
  await writeSheetValueSets(accessToken, spreadsheet.id, [
    { tab: 'Review Portal Data', rows: formattedRows },
    { tab: 'Raw Review Data', rows: rawRows },
    { tab: 'Photo Log', rows: photoLogRows },
    { tab: 'Room Details', rows: roomRows }
  ]);

  return {
    spreadsheetId: spreadsheet.id,
    spreadsheetUrl: spreadsheet.webViewLink || `https://docs.google.com/spreadsheets/d/${encodeURIComponent(spreadsheet.id)}/edit`,
    rawReviewKeyCount: Object.keys(fieldData || {}).length,
    formattedReviewRowCount: Math.max(0, formattedRows.length - 1),
    photoLogCount: Math.max(0, photoLogRows.length - 1),
    roomDetailCount: Math.max(0, roomRows.length - 1)
  };
}

function reviewSpreadsheetTitle(source) {
  const lastName = getClientLastName(source.clientName);
  return `Review Portal Data — ${lastName} — ${source.inspectionId || source.id || 'inspection'}`;
}

async function getOrCreateDriveFile(accessToken, parentId, name, mimeType) {
  const existing = await findDriveFile(accessToken, parentId, name, mimeType);
  if (existing) return existing;
  const res = await fetch('https://www.googleapis.com/drive/v3/files?supportsAllDrives=true&fields=id,name,webViewLink', {
    method: 'POST',
    headers: driveHeaders(accessToken, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ name, mimeType, parents: [parentId] })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`drive_file_create_failed:${res.status}:${JSON.stringify(data).slice(0, 200)}`);
  return data;
}

async function findDriveFile(accessToken, parentId, name, mimeType) {
  const params = new URLSearchParams();
  const mimeFilter = mimeType ? ` and mimeType='${escapeDriveQuery(mimeType)}'` : '';
  params.set('q', `'${escapeDriveQuery(parentId)}' in parents${mimeFilter} and name='${escapeDriveQuery(name)}' and trashed=false`);
  params.set('fields', 'files(id,name,webViewLink,mimeType)');
  params.set('pageSize', '10');
  params.set('supportsAllDrives', 'true');
  params.set('includeItemsFromAllDrives', 'true');
  params.set('corpora', 'allDrives');

  const res = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, {
    headers: driveHeaders(accessToken)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`drive_file_search_failed:${res.status}:${JSON.stringify(data).slice(0, 200)}`);
  return Array.isArray(data.files) && data.files.length ? data.files[0] : null;
}

async function ensureSpreadsheetTabs(accessToken, spreadsheetId, desiredTabs) {
  const sheets = await getSpreadsheetSheets(accessToken, spreadsheetId);
  const byTitle = new Map(sheets.map(sheet => [sheet.title, sheet]));
  const requests = [];
  const firstSheet = sheets[0] || null;
  if (!byTitle.has(desiredTabs[0]) && firstSheet && /^Sheet\d*$/i.test(firstSheet.title || '')) {
    requests.push({
      updateSheetProperties: {
        properties: { sheetId: firstSheet.sheetId, title: desiredTabs[0] },
        fields: 'title'
      }
    });
    byTitle.set(desiredTabs[0], { ...firstSheet, title: desiredTabs[0] });
  }
  desiredTabs.forEach(function(title) {
    if (!byTitle.has(title)) {
      requests.push({ addSheet: { properties: { title } } });
    }
  });
  if (requests.length) await batchUpdateSpreadsheet(accessToken, spreadsheetId, requests);
}

async function getSpreadsheetSheets(accessToken, spreadsheetId) {
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=sheets(properties(sheetId,title))`, {
    headers: driveHeaders(accessToken)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`spreadsheet_get_failed:${res.status}:${JSON.stringify(data).slice(0, 200)}`);
  return Array.isArray(data.sheets)
    ? data.sheets.map(sheet => sheet.properties || {}).filter(sheet => sheet.title)
    : [];
}

async function batchUpdateSpreadsheet(accessToken, spreadsheetId, requests) {
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}:batchUpdate`, {
    method: 'POST',
    headers: driveHeaders(accessToken, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ requests })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`spreadsheet_batch_update_failed:${res.status}:${JSON.stringify(data).slice(0, 200)}`);
  return data;
}

async function clearSheetTabs(accessToken, spreadsheetId, tabs) {
  const ranges = (tabs || []).map(tab => `'${String(tab).replace(/'/g, "''")}'!A:Z`);
  if (!ranges.length) return;
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values:batchClear`, {
    method: 'POST',
    headers: driveHeaders(accessToken, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ ranges })
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(`sheet_clear_failed:${res.status}:${JSON.stringify(data).slice(0, 200)}`);
  }
}

async function writeSheetValueSets(accessToken, spreadsheetId, sets) {
  const data = sets
    .filter(set => Array.isArray(set.rows) && set.rows.length)
    .map(set => ({
      range: `'${String(set.tab).replace(/'/g, "''")}'!A1`,
      values: set.rows
    }));
  if (!data.length) return;
  await batchUpdateSheetValues(accessToken, spreadsheetId, data);
}

function buildRawReviewRows(fieldData) {
  const rows = [['Key', 'Value', 'Type']];
  Object.keys(fieldData || {}).sort().forEach(function(key) {
    const serialized = serializeReviewValue(fieldData[key]);
    const chunks = splitSpreadsheetCellText(serialized.value);
    chunks.forEach(function(chunk, index) {
      rows.push([
        key,
        chunk,
        chunks.length > 1 ? `${serialized.type} part ${index + 1}/${chunks.length}` : serialized.type
      ]);
    });
  });
  return rows;
}

function splitSpreadsheetCellText(value, limit = SHEET_CELL_SAFE_CHARS) {
  const text = value === undefined || value === null ? '' : String(value);
  const safeLimit = Math.max(2, Math.min(Number(limit) || SHEET_CELL_SAFE_CHARS, SHEET_CELL_SAFE_CHARS));
  if (text.length <= safeLimit) return [text];

  const chunks = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + safeLimit, text.length);
    if (end < text.length) {
      const before = text.charCodeAt(end - 1);
      const after = text.charCodeAt(end);
      if (before >= 0xD800 && before <= 0xDBFF && after >= 0xDC00 && after <= 0xDFFF) end--;
    }
    chunks.push(text.slice(start, end));
    start = end;
  }
  return chunks;
}

function serializeReviewValue(value) {
  if (Array.isArray(value)) {
    const primitive = value.every(item => item === null || ['string', 'number', 'boolean'].includes(typeof item));
    return {
      value: primitive ? value.map(item => String(item ?? '')).join(', ') : JSON.stringify(value),
      type: primitive ? 'list' : 'json'
    };
  }
  if (isPlainObject(value)) return { value: JSON.stringify(value), type: 'json' };
  if (typeof value === 'boolean') return { value: value ? 'TRUE' : 'FALSE', type: 'boolean' };
  if (typeof value === 'number') return { value: String(value), type: 'number' };
  return { value: value === undefined || value === null ? '' : String(value), type: 'string' };
}

function buildFormattedReviewRows(fieldData) {
  const rows = [['Section', 'Key', 'Value']];
  const summaryKeys = [
    'clientName', 'propertyAddress', 'inspectionDate', 'inspectorName', 'inspectionType',
    'waterSource', 'waterFiltration', 'heating', 'ac', 'ventilation', 'weather',
    'clientConcerns', 'knownProblemAreas', 'reportBuilderNotes', 'followUpPlan'
  ];
  summaryKeys.forEach(function(key) {
    if (fieldData && fieldData[key] !== undefined && fieldData[key] !== null && String(fieldData[key]).trim() !== '') {
      appendFormattedReviewRows(rows, 'Summary', key, serializeReviewValue(fieldData[key]).value);
    }
  });
  Object.keys(fieldData || {}).sort().forEach(function(key) {
    if (/^(obs|actionTaken|followUp)_\d+_/i.test(key)) {
      appendFormattedReviewRows(rows, 'Dynamic Review', key, serializeReviewValue(fieldData[key]).value);
    }
  });
  const system = isPlainObject(fieldData.system) ? fieldData.system : {};
  if (system.inspectionRecovery) {
    rows.push([
      'System',
      'inspectionRecovery',
      `Complete source snapshot is preserved in Raw Review Data and the raw JSON backup (${JSON.stringify(system.inspectionRecovery).length} characters).`
    ]);
  }
  if (system.startInspectionShell) {
    appendFormattedReviewRows(rows, 'System', 'startInspectionShell', JSON.stringify(system.startInspectionShell));
  }
  return rows;
}

function appendFormattedReviewRows(rows, section, key, value) {
  const chunks = splitSpreadsheetCellText(value);
  chunks.forEach(function(chunk, index) {
    rows.push([
      section,
      chunks.length > 1 ? `${key} [part ${index + 1}/${chunks.length}]` : key,
      chunk
    ]);
  });
}

function buildPhotoLogRows(photoRows) {
  const rows = [['Photo ID', 'Room', 'Step', 'Caption', 'Slot', 'Storage Path', 'Drive URL', 'Review URL', 'Created At']];
  (photoRows || []).forEach(function(row) {
    rows.push([
      row.photo_id || '',
      row.room_name || '',
      row.step_name || '',
      row.caption || '',
      row.slot === undefined || row.slot === null ? '' : String(row.slot),
      row.storage_path || '',
      row.drive_url || '',
      row.photo_id && row.inspection_id ? `https://inhaus-photo-worker.inhauslab.workers.dev/photo?inspectionId=${encodeURIComponent(row.inspection_id)}&photoId=${encodeURIComponent(row.photo_id)}&token=${encodeURIComponent(String(row.inspection_id).toLowerCase())}` : '',
      row.created_at || ''
    ]);
  });
  return rows;
}

function getHandoffInspectionRecovery(fieldData = {}) {
  const system = isPlainObject(fieldData.system) ? fieldData.system : {};
  return isPlainObject(system.inspectionRecovery)
    ? system.inspectionRecovery
    : (isPlainObject(fieldData.inspectionRecovery) ? fieldData.inspectionRecovery : {});
}

function getHandoffRoomRecords(fieldData = {}) {
  if (Array.isArray(fieldData.rooms)) return fieldData.rooms;
  const recovery = getHandoffInspectionRecovery(fieldData);
  return Array.isArray(recovery.rooms) ? recovery.rooms : [];
}

function buildRoomDetailRows(fieldData, photoRows = []) {
  const rows = [['Room', 'Notes', 'No Issues', 'Follow Up', 'Photos']];
  const rooms = getHandoffRoomRecords(fieldData);
  rooms.forEach(function(room) {
    if (!isPlainObject(room)) return;
    const stepId = firstNonEmpty(room.stepId, room.id);
    const reviewedRoom = stepId && isPlainObject(fieldData[stepId]) ? fieldData[stepId] : {};
    const roomName = firstNonEmpty(room.name, room.roomName, room.label, stepId);
    const photoIds = []
      .concat(Array.isArray(room.photoIds) ? room.photoIds : [])
      .concat(Array.isArray(room.photos) ? room.photos.map(photo => isPlainObject(photo) ? (photo.id || photo.photoId || photo.photo_id || '') : photo) : [])
      .concat((photoRows || [])
        .filter(photo => String(photo.room_name || '').trim().toLowerCase() === String(roomName || '').trim().toLowerCase())
        .map(photo => photo.photo_id || ''))
      .filter(Boolean);
    const followUp = firstNonEmpty(
      reviewedRoom.followUp,
      reviewedRoom.followUpPlan,
      room.followUp,
      room.followUpPlan,
      [reviewedRoom.recheckIn ? `Recheck in: ${reviewedRoom.recheckIn}` : '', reviewedRoom.watchFor ? `Watch for: ${reviewedRoom.watchFor}` : ''].filter(Boolean).join(' · ')
    );
    rows.push([
      roomName,
      firstNonEmpty(reviewedRoom.polishedInspectorNotes, reviewedRoom.inspectorNotes, room.inspectorNotes, room.notes, room.polishedInspectorNotes),
      reviewedRoom.noIssuesFound === true || reviewedRoom.noIssues === true || room.noIssuesFound === true || room.noIssues === true ? 'TRUE' : '',
      followUp,
      Array.from(new Set(photoIds)).join(', ')
    ]);
  });
  return rows;
}

async function createOrUpdateInspectionSpreadsheet(accessToken, folderId, source, fieldData, photoRows) {
  const title = inspectionSpreadsheetTitle(source);
  const spreadsheet = await getOrCreateDriveFile(accessToken, folderId, title, DRIVE_SPREADSHEET_MIME);
  const tabs = ['Summary', 'Air Data', 'Room Details', 'CSV Output', 'Follow-Up Items', 'Raw App Data'];
  await ensureSpreadsheetTabs(accessToken, spreadsheet.id, tabs);

  const summaryRows = buildInspectionSummaryRows(source, fieldData);
  const airRows = buildInspectionAirDataRows(fieldData);
  const roomRows = buildInspectionRoomDetailRows(fieldData, photoRows);
  const csvRows = buildInspectionCsvRows(source, fieldData, photoRows);
  const followUpRows = buildInspectionFollowUpRows(fieldData);
  const rawRows = buildRawAppRows(fieldData);
  await clearSheetTabs(accessToken, spreadsheet.id, tabs);
  await writeSheetValueSets(accessToken, spreadsheet.id, [
    { tab: 'Summary', rows: summaryRows },
    { tab: 'Air Data', rows: airRows },
    { tab: 'Room Details', rows: roomRows },
    { tab: 'CSV Output', rows: csvRows },
    { tab: 'Follow-Up Items', rows: followUpRows },
    { tab: 'Raw App Data', rows: rawRows }
  ]);

  return {
    spreadsheetId: spreadsheet.id,
    spreadsheetUrl: spreadsheet.webViewLink || `https://docs.google.com/spreadsheets/d/${encodeURIComponent(spreadsheet.id)}/edit`,
    roomDetailCount: Math.max(0, roomRows.length - 1),
    airDataCount: Math.max(0, airRows.length - 1),
    followUpCount: Math.max(0, followUpRows.length - 1),
    rawAppKeyCount: Math.max(0, rawRows.length - 1)
  };
}

function inspectionSpreadsheetTitle(source) {
  const lastName = getClientLastName(source.clientName);
  return `InHaus Inspection — ${source.inspectionId || source.id || 'inspection'}_${lastName}`;
}

function buildInspectionSummaryRows(source, fieldData) {
  const recovery = getHandoffInspectionRecovery(fieldData);
  const record = { ...recovery, ...source };
  const rows = [
    ['INHAUS LAB — INSPECTION DATA', ''],
    ['', ''],
    ['BASIC INFORMATION', ''],
    ['Inspection ID', firstNonEmpty(record.inspectionId, record.id)],
    ['Inspector', firstNonEmpty(record.inspectorName, record.inspector)],
    ['Inspection Date', firstNonEmpty(record.inspectionDate, record.date)],
    ['Client', firstNonEmpty(record.clientName, record.client)],
    ['Property Address', firstNonEmpty(record.propertyAddress, record.address)],
    ['Inspection Type', firstNonEmpty(record.inspectionType, record.assessmentType)],
    ['', ''],
    ['PROPERTY DETAILS', ''],
    ['Residence Type', exportValue(record, ['residenceType', 'propertyType', 'homeType'])],
    ['Year Built', exportValue(record, ['yearBuilt', 'propertyYearBuilt'])],
    ['Square Feet', exportValue(record, ['squareFeet', 'sqFt', 'propertySquareFeet'])],
    ['Bedrooms', exportValue(record, ['numberOfBedrooms', 'bedrooms'])],
    ['Bathrooms', exportValue(record, ['numberOfBathrooms', 'bathrooms'])],
    ['Levels', exportValue(record, ['numberOfLevels', 'levels'])],
    ['Basement', exportValue(record, ['basement', 'hasBasement'])],
    ['Carpeted Rooms', exportValue(record, ['carpetedRooms', 'carpet'])],
    ['Water Source', exportValue(record, ['waterSource'])],
    ['', ''],
    ['SYSTEMS / SITE CONDITIONS', ''],
    ['Water Filtration', exportValue(record, ['waterFiltration', 'filtration'])],
    ['Water Softener', exportValue(record, ['waterSoftener', 'softener'])],
    ['Heating', exportValue(record, ['heating', 'heatingSystem'])],
    ['Air Conditioning', exportValue(record, ['ac', 'airConditioning'])],
    ['Ventilation', exportValue(record, ['ventilation'])],
    ['Weather', exportValue(record, ['weather', 'weatherConditions'])],
    ['Occupancy', exportValue(record, ['occupancy', 'occupied'])],
    ['Client Concerns', firstNonEmpty(fieldData.clientConcerns, exportValue(record, ['clientConcerns']))],
    ['Known Problem Areas', firstNonEmpty(fieldData.knownProblemAreas, exportValue(record, ['knownProblemAreas']))]
  ];
  return rows.map(row => row.map(spreadsheetCellValue));
}

function buildInspectionAirDataRows(fieldData) {
  const recovery = getHandoffInspectionRecovery(fieldData);
  const rows = [['Room', 'PM2.5', 'PM10', 'TVOCs', 'Formaldehyde', 'CO', 'CO2', 'Ozone']];
  getHandoffRoomRecords(fieldData).forEach(function(room) {
    if (!isPlainObject(room)) return;
    const data = roomExportData(room, recovery);
    rows.push([
      roomDisplayName(room),
      exportValue(data, ['pm25', 'pm2_5', 'pm2.5', 'qtrakPm25']),
      exportValue(data, ['pm10', 'qtrakPm10']),
      exportValue(data, ['tvoc', 'tvocs', 'qtrakTvoc']),
      exportValue(data, ['formaldehyde', 'hcho', 'qtrakFormaldehyde']),
      exportValue(data, ['co', 'carbonMonoxide', 'qtrakCo']),
      exportValue(data, ['co2', 'carbonDioxide', 'qtrakCo2']),
      exportValue(data, ['ozone', 'o3'])
    ].map(spreadsheetCellValue));
  });
  return rows;
}

function buildInspectionRoomDetailRows(fieldData, photoRows = []) {
  const recovery = getHandoffInspectionRecovery(fieldData);
  const rows = [['Room', 'Type', 'Level', 'Observations', 'Notes', 'Breeze Done', 'Spore Trap ID', 'FLIR Done', 'FLIR Concerns', 'Q-Trak Captured', 'Q-Trak Location', 'Follow-Up', 'Photo IDs']];
  getHandoffRoomRecords(fieldData).forEach(function(room) {
    if (!isPlainObject(room)) return;
    const data = roomExportData(room, recovery);
    const stepId = firstNonEmpty(room.stepId, room.id);
    const reviewedRoom = stepId && isPlainObject(fieldData[stepId]) ? fieldData[stepId] : {};
    const photoIds = roomPhotoIds(room, photoRows);
    rows.push([
      roomDisplayName(room),
      firstNonEmpty(room.type, room.roomType, room.roomCategory, exportValue(data, ['roomType', 'type'])),
      firstNonEmpty(room.level, room.floor, exportValue(data, ['level', 'floor'])),
      firstNonEmpty(exportValue(data, ['observations', 'observation', 'finding', 'findings']), reviewedRoom.observations),
      firstNonEmpty(reviewedRoom.polishedInspectorNotes, reviewedRoom.inspectorNotes, exportValue(data, ['inspectorNotes', 'notes', 'roomNotes'])),
      exportValue(data, ['breezeDone']),
      exportValue(data, ['sporeTrapId', 'sporeTrapID', 'breezeSampleId', 'breezeSampleID']),
      exportValue(data, ['flirDone']),
      exportValue(data, ['flirConcerns']),
      exportValue(data, ['qtrakCaptured']),
      exportValue(data, ['qtrakLocation']),
      firstNonEmpty(reviewedRoom.followUpPlan, reviewedRoom.followUp, exportValue(data, ['followUpNote', 'followUpPlan', 'watchFor'])),
      photoIds.join(', ')
    ].map(spreadsheetCellValue));
  });
  return rows;
}

function buildInspectionCsvRows(source, fieldData, photoRows = []) {
  const recovery = getHandoffInspectionRecovery(fieldData);
  const record = { ...recovery, ...source };
  const rooms = getHandoffRoomRecords(fieldData);
  const headers = [
    'Inspection ID', 'Inspector', 'Inspection Date', 'Client', 'Property Address', 'Inspection Type',
    'Residence Type', 'Year Built', 'Square Feet', 'Bedrooms', 'Bathrooms', 'Levels', 'Basement',
    'Water Source', 'Water Filtration', 'Heating', 'Air Conditioning', 'Ventilation', 'Weather',
    'Client Concerns', 'Known Problem Areas', 'Room Count', 'Photo Count'
  ];
  const values = [
    firstNonEmpty(record.inspectionId, record.id),
    firstNonEmpty(record.inspectorName, record.inspector),
    firstNonEmpty(record.inspectionDate, record.date),
    firstNonEmpty(record.clientName, record.client),
    firstNonEmpty(record.propertyAddress, record.address),
    firstNonEmpty(record.inspectionType, record.assessmentType),
    exportValue(record, ['residenceType', 'propertyType', 'homeType']),
    exportValue(record, ['yearBuilt', 'propertyYearBuilt']),
    exportValue(record, ['squareFeet', 'sqFt', 'propertySquareFeet']),
    exportValue(record, ['numberOfBedrooms', 'bedrooms']),
    exportValue(record, ['numberOfBathrooms', 'bathrooms']),
    exportValue(record, ['numberOfLevels', 'levels']),
    exportValue(record, ['basement', 'hasBasement']),
    exportValue(record, ['waterSource']),
    exportValue(record, ['waterFiltration', 'filtration']),
    exportValue(record, ['heating', 'heatingSystem']),
    exportValue(record, ['ac', 'airConditioning']),
    exportValue(record, ['ventilation']),
    exportValue(record, ['weather', 'weatherConditions']),
    firstNonEmpty(fieldData.clientConcerns, exportValue(record, ['clientConcerns'])),
    firstNonEmpty(fieldData.knownProblemAreas, exportValue(record, ['knownProblemAreas'])),
    rooms.length,
    (photoRows || []).length
  ];
  return [headers, values.map(spreadsheetCellValue)];
}

function buildInspectionFollowUpRows(fieldData) {
  const recovery = getHandoffInspectionRecovery(fieldData);
  const rows = [['Room', 'Re-check In', 'What to Watch For', 'Photo IDs']];
  getHandoffRoomRecords(fieldData).forEach(function(room) {
    if (!isPlainObject(room)) return;
    const data = roomExportData(room, recovery);
    const stepId = firstNonEmpty(room.stepId, room.id);
    const reviewedRoom = stepId && isPlainObject(fieldData[stepId]) ? fieldData[stepId] : {};
    const needed = firstNonEmpty(reviewedRoom.followUpNeeded, exportValue(data, ['followUpNeeded']));
    const timeframe = firstNonEmpty(reviewedRoom.followUpTimeframe, reviewedRoom.recheckIn, exportValue(data, ['followUpTimeframe', 'recheckIn']));
    const note = firstNonEmpty(reviewedRoom.followUpNote, reviewedRoom.watchFor, reviewedRoom.followUpPlan, exportValue(data, ['followUpNote', 'watchFor', 'followUpPlan']));
    const photoIds = [].concat(
      Array.isArray(reviewedRoom.followUpPhotoIds) ? reviewedRoom.followUpPhotoIds : [],
      Array.isArray(data._followUpPhotos) ? data._followUpPhotos : []
    ).map(item => isPlainObject(item) ? firstNonEmpty(item.id, item.photoId, item.photo_id) : item).filter(Boolean);
    if (!isAffirmativeValue(needed) && !timeframe && !note && !photoIds.length) return;
    rows.push([roomDisplayName(room), timeframe, note, Array.from(new Set(photoIds)).join(', ')].map(spreadsheetCellValue));
  });
  return rows;
}

function buildRawAppRows(fieldData) {
  const recovery = getHandoffInspectionRecovery(fieldData);
  const rows = [['Key', 'Value', 'Type']];
  Object.keys(recovery || {}).sort().forEach(function(key) {
    const serialized = serializeReviewValue(recovery[key]);
    const chunks = splitSpreadsheetCellText(serialized.value);
    chunks.forEach(function(chunk, index) {
      rows.push([
        key,
        chunk,
        chunks.length > 1 ? `${serialized.type} part ${index + 1}/${chunks.length}` : serialized.type
      ]);
    });
  });
  return rows;
}

function roomExportData(room, recovery) {
  const stepId = firstNonEmpty(room.stepId, room.id);
  const stepData = isPlainObject(recovery.stepData) && stepId && isPlainObject(recovery.stepData[stepId])
    ? recovery.stepData[stepId]
    : {};
  return { ...room, ...stepData };
}

function roomDisplayName(room) {
  return firstNonEmpty(room.roomName, room.name, room.label, room.stepId, room.id, 'Room');
}

function roomPhotoIds(room, photoRows) {
  const roomName = String(roomDisplayName(room)).trim().toLowerCase();
  return Array.from(new Set([].concat(
    Array.isArray(room.photoIds) ? room.photoIds : [],
    Array.isArray(room.photos) ? room.photos.map(photo => isPlainObject(photo) ? firstNonEmpty(photo.id, photo.photoId, photo.photo_id) : photo) : [],
    (photoRows || []).filter(photo => String(photo.room_name || '').trim().toLowerCase() === roomName).map(photo => photo.photo_id || '')
  ).filter(Boolean)));
}

function exportValue(record, keys) {
  const wanted = new Set((keys || []).map(normalizeExportKey));
  const found = findExportValue(record, wanted);
  return found === undefined ? '' : spreadsheetCellValue(found);
}

function findExportValue(value, wanted, depth = 0, seen = new Set()) {
  if (!value || typeof value !== 'object' || depth > 3 || seen.has(value)) return undefined;
  seen.add(value);
  for (const [key, child] of Object.entries(value)) {
    if (wanted.has(normalizeExportKey(key)) && child !== undefined && child !== null && String(child).trim() !== '') return child;
  }
  for (const child of Object.values(value)) {
    if (!child || typeof child !== 'object') continue;
    const found = findExportValue(child, wanted, depth + 1, seen);
    if (found !== undefined) return found;
  }
  return undefined;
}

function normalizeExportKey(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function spreadsheetCellValue(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (Array.isArray(value)) return value.map(item => spreadsheetCellValue(item)).join(', ');
  if (isPlainObject(value)) return JSON.stringify(value);
  return value;
}

function isAffirmativeValue(value) {
  return value === true || /^(yes|true|recommended|required)$/i.test(String(value || '').trim());
}

async function createOrUpdateAssessmentContext(accessToken, shell, source, fieldData, photoRows, inspectionSpreadsheet, reviewSpreadsheet, rawBackup) {
  const content = buildAssessmentContextMarkdown(shell, source, fieldData, photoRows, inspectionSpreadsheet, reviewSpreadsheet, rawBackup);
  const file = await createOrUpdateDriveTextFile(accessToken, shell.folderId, '_context.md', content, 'text/markdown');
  return {
    contextFileId: file.id,
    contextFileUrl: file.webViewLink || `https://drive.google.com/file/d/${encodeURIComponent(file.id)}/view`
  };
}

function buildAssessmentContextMarkdown(shell, source, fieldData, photoRows, inspectionSpreadsheet, reviewSpreadsheet, rawBackup) {
  const recovery = getHandoffInspectionRecovery(fieldData);
  const rooms = getHandoffRoomRecords(fieldData);
  const assessmentLabel = shell.assessmentNumber ? `Assessment ${shell.assessmentNumber}` : 'Test / Training Assessment';
  const clientName = firstNonEmpty(source.clientName, recovery.clientName, 'Unknown client');
  const propertyAddress = firstNonEmpty(source.propertyAddress, recovery.propertyAddress, 'Unknown address');
  const status = firstNonEmpty(fieldData.status, source.status, source.reviewStatus, 'In Progress');
  const sampleLines = collectAssessmentContextValues({ ...recovery, ...fieldData }, function(path) {
    if (/(_fieldUpdates|auditTrail|collaboration|findings|photoManifest|photoTombstones)/i.test(path)) return false;
    const leaf = path.split('.').pop() || '';
    if (/^(deviceId|updatedById|memberId|stepId|findingId|photoId|checkpointId|reservationId)$/i.test(leaf)) return false;
    return /^testsConfirmed\./i.test(path) ||
      /(?:sample|specimen|kit|monitor).*(?:id|number|num)$/i.test(leaf) ||
      (/(?:result|status)$/i.test(leaf) && /(radon|pfas|microplastic|breeze|boulder|qtrak|omni|water)/i.test(path));
  });
  const roomLines = rooms.map(function(room) {
    const data = roomExportData(room, recovery);
    const note = exportValue(data, ['inspectorNotes', 'notes', 'roomNotes', 'observations', 'observation']);
    const noIssues = isAffirmativeValue(exportValue(data, ['noIssuesFound', 'noIssues']));
    const detail = note || (noIssues ? 'No issues found; intentionally left blank.' : 'No room note recorded.');
    return `- **${markdownText(roomDisplayName(room))}:** ${markdownText(detail)}`;
  });
  const lines = [
    `# _context.md — ${markdownText(assessmentLabel)} — ${markdownText(clientName)} — ${markdownText(propertyAddress)}`,
    '',
    `Last updated: ${new Date().toISOString()}`,
    `Source: InHaus Inspector and Review Portal (${markdownText(source.inspectionId || source.id || '')})`,
    '',
    '---',
    '',
    '## Status',
    '',
    '- **Handoff package:** Ready',
    `- **Review status at export:** ${markdownText(status)}`,
    `- **Inspection date:** ${markdownText(firstNonEmpty(source.inspectionDate, recovery.inspectionDate, 'Not recorded'))}`,
    `- **Inspector:** ${markdownText(firstNonEmpty(source.inspectorName, recovery.inspectorName, 'Not recorded'))}`,
    `- **Package type:** ${source.isTestTraining === true || source.isTest === true || source.is_test === true ? 'Test / Training' : 'Real assessment'}`,
    '',
    '## Background',
    '',
    `- **Client:** ${markdownText(clientName)}`,
    `- **Property:** ${markdownText(propertyAddress)}`,
    `- **Client concerns:** ${markdownText(firstNonEmpty(fieldData.clientConcerns, recovery.clientConcerns, 'Not recorded'))}`,
    `- **Known problem areas:** ${markdownText(firstNonEmpty(fieldData.knownProblemAreas, recovery.knownProblemAreas, 'Not recorded'))}`,
    '',
    '## Test Results and Sample IDs',
    '',
    ...(sampleLines.length ? sampleLines.map(item => `- **${markdownText(item.path)}:** ${markdownText(item.value)}`) : ['- No test result or sample ID recorded.']),
    '',
    '## Rooms',
    '',
    ...(roomLines.length ? roomLines : ['- No rooms recorded.']),
    '',
    '## Review Notes',
    '',
    `- **Report builder notes:** ${markdownText(firstNonEmpty(fieldData.reportBuilderNotes, 'Not recorded'))}`,
    `- **Client follow-up plan:** ${markdownText(firstNonEmpty(fieldData.followUpPlan, 'Not recorded'))}`,
    '',
    '## Files',
    '',
    `- [InHaus Inspection spreadsheet](${inspectionSpreadsheet.spreadsheetUrl})`,
    `- [Review Portal Data spreadsheet](${reviewSpreadsheet.spreadsheetUrl})`,
    `- [Photos folder](${shell.photosFolderUrl}) — ${(photoRows || []).length} photo${(photoRows || []).length === 1 ? '' : 's'}`,
    `- [COCs folder](${shell.cocsFolderUrl})`,
    `- [Backup folder](${shell.backupFolderUrl})`,
    `- [Raw review JSON backup](${rawBackup.rawJsonUrl})`,
    ''
  ];
  return lines.join('\n');
}

function collectAssessmentContextValues(value, matcher, path = '', depth = 0, rows = [], seen = new Set()) {
  if (!value || typeof value !== 'object' || depth > 4 || seen.has(value)) return rows;
  seen.add(value);
  Object.entries(value).forEach(function([key, child]) {
    const nextPath = path ? `${path}.${key}` : key;
    if (child === undefined || child === null || child === '') return;
    if ((typeof child !== 'object' || child instanceof Date) && matcher(nextPath)) {
      rows.push({ path: nextPath, value: spreadsheetCellValue(child) });
      return;
    }
    if (typeof child === 'object') collectAssessmentContextValues(child, matcher, nextPath, depth + 1, rows, seen);
  });
  return rows.slice(0, 100);
}

function markdownText(value) {
  return String(spreadsheetCellValue(value) || '').replace(/\r?\n/g, ' ').replace(/([\\`*_{}\[\]()#+.!|>-])/g, '\\$1');
}

async function createRawReviewDataBackup(accessToken, backupFolderId, source, fieldData) {
  const name = `Raw Review Data — ${source.inspectionId} — latest.json`;
  const file = await createOrUpdateDriveTextFile(accessToken, backupFolderId, name, JSON.stringify(fieldData || {}, null, 2), 'application/json');
  return {
    rawJsonId: file.id,
    rawJsonUrl: file.webViewLink || `https://drive.google.com/file/d/${encodeURIComponent(file.id)}/view`
  };
}

async function createOrUpdateDriveTextFile(accessToken, folderId, name, content, mimeType) {
  const existing = await findDriveFile(accessToken, folderId, name, mimeType);
  return await uploadDriveTextFile(accessToken, folderId, name, content, mimeType, existing && existing.id);
}

async function uploadDriveTextFile(accessToken, folderId, name, content, mimeType, existingId = '') {
  const boundary = `inhaus_${crypto.randomUUID().replace(/-/g, '')}`;
  const metadata = existingId
    ? { name, mimeType }
    : { name, mimeType, parents: [folderId] };
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`,
    JSON.stringify(metadata),
    `\r\n--${boundary}\r\nContent-Type: ${mimeType}; charset=UTF-8\r\n\r\n`,
    content,
    `\r\n--${boundary}--`
  ]);
  const endpoint = existingId
    ? `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(existingId)}?uploadType=multipart&supportsAllDrives=true&fields=id,name,webViewLink`
    : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,name,webViewLink';
  const res = await fetch(endpoint, {
    method: existingId ? 'PATCH' : 'POST',
    headers: driveHeaders(accessToken, { 'Content-Type': `multipart/related; boundary=${boundary}` }),
    body
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`drive_text_upload_failed:${res.status}:${JSON.stringify(data).slice(0, 200)}`);
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
  return await uploadDriveBlob(accessToken, folderId, fileName, fileBlob, 'image/jpeg');
}

async function uploadDriveBlob(accessToken, folderId, fileName, fileBlob, mimeType) {
  const boundary = `inhaus_${crypto.randomUUID().replace(/-/g, '')}`;
  const contentType = String(mimeType || fileBlob.type || 'application/octet-stream');
  const metadata = {
    name: fileName,
    parents: [folderId],
    mimeType: contentType
  };
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`,
    JSON.stringify(metadata),
    `\r\n--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`,
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

async function createOrRepairPhotoPackage(env, accessToken, photosFolderId, photoRows, options = {}) {
  const rows = Array.isArray(photoRows) ? photoRows : [];
  const operationLimit = Math.max(0, Number.isFinite(Number(options.copyLimit)) ? Number(options.copyLimit) : HANDOFF_PHOTO_COPY_LIMIT_DEFAULT);
  const existingByName = await listDriveFolderFilesByName(accessToken, photosFolderId);
  let operationCount = 0;
  let copiedCount = 0;
  let linkedCount = 0;
  let alreadyPackagedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;
  let pendingCount = 0;
  const failures = [];

  for (const row of rows) {
    const fileName = fileNameForPhoto(row);
    try {
      const existing = existingByName.get(fileName);
      if (existing) {
        alreadyPackagedCount += 1;
        if (!row.drive_url && existing.webViewLink) {
          await updatePhotoDriveUrl(env, row.photo_id, row.inspection_id, existing.webViewLink);
        }
        continue;
      }
      if (operationCount >= operationLimit) {
        pendingCount += 1;
        continue;
      }
      const existingDriveId = extractDriveFileId(row.drive_url);
      if (existingDriveId) {
        const shortcut = await createDriveShortcut(accessToken, photosFolderId, fileName, existingDriveId);
        existingByName.set(fileName, shortcut);
        linkedCount += 1;
        operationCount += 1;
        continue;
      }
      if (!row.storage_path) {
        failedCount += 1;
        failures.push(`${row.photo_id || 'photo'} missing storage path`);
        continue;
      }
      const blob = await downloadSupabaseObject(env, row.storage_path);
      const driveFile = await uploadDriveFile(accessToken, photosFolderId, fileName, blob);
      const driveUrl = driveFile.webViewLink || `https://drive.google.com/file/d/${encodeURIComponent(driveFile.id)}/view`;
      await updatePhotoDriveUrl(env, row.photo_id, row.inspection_id, driveUrl);
      existingByName.set(fileName, driveFile);
      copiedCount += 1;
      operationCount += 1;
    } catch (err) {
      failedCount += 1;
      failures.push(`${row.photo_id || 'photo'}: ${err && err.message ? err.message : String(err)}`);
    }
  }

  return {
    copiedCount,
    linkedCount,
    alreadyPackagedCount,
    skippedCount,
    failedCount,
    pendingCount,
    operationLimit,
    operationCount,
    error: failures.length ? failures.slice(0, 5).join('; ') : ''
  };
}

async function listDriveFolderFilesByName(accessToken, parentId) {
  const byName = new Map();
  let pageToken = '';
  do {
    const params = new URLSearchParams();
    params.set('q', `'${escapeDriveQuery(parentId)}' in parents and trashed=false`);
    params.set('fields', 'nextPageToken,files(id,name,webViewLink,mimeType)');
    params.set('pageSize', '1000');
    params.set('supportsAllDrives', 'true');
    params.set('includeItemsFromAllDrives', 'true');
    params.set('corpora', 'allDrives');
    if (pageToken) params.set('pageToken', pageToken);
    const res = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, {
      headers: driveHeaders(accessToken)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`drive_folder_list_failed:${res.status}:${JSON.stringify(data).slice(0, 200)}`);
    (Array.isArray(data.files) ? data.files : []).forEach(function(file) {
      if (file && file.name && !byName.has(file.name)) byName.set(file.name, file);
    });
    pageToken = data.nextPageToken || '';
  } while (pageToken);
  return byName;
}

async function createDriveShortcut(accessToken, parentId, name, targetId) {
  const res = await fetch('https://www.googleapis.com/drive/v3/files?supportsAllDrives=true&fields=id,name,webViewLink', {
    method: 'POST',
    headers: driveHeaders(accessToken, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      name,
      mimeType: DRIVE_SHORTCUT_MIME,
      parents: [parentId],
      shortcutDetails: { targetId }
    })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`drive_shortcut_create_failed:${res.status}:${JSON.stringify(data).slice(0, 200)}`);
  return data;
}

function extractDriveFileId(url) {
  const text = String(url || '').trim();
  if (!text) return '';
  const patterns = [
    /\/file\/d\/([^/?#]+)/,
    /\/open\?id=([^&#]+)/,
    /[?&]id=([^&#]+)/,
    /\/uc\?id=([^&#]+)/
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) return decodeURIComponent(match[1]);
  }
  return '';
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
  const queryString = 'inspection_id=eq.' + encodeURIComponent(inspectionId) + '&source_system=neq.deleted&select=photo_id&storage_path=not.is.null';
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

  const [photoRows, storedNames] = await Promise.all([
    getPhotoRowsForInspection(env, inspectionId),
    listStoredPhotoNames(env, inspectionId)
  ]);

  const assessmentExists = await assessmentExistsForInspection(env, inspectionId);

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
  let handoff = null;
  try {
    const reviewRow = await getReviewRow(env, inspectionId);
    const fieldData = reviewRow && isPlainObject(reviewRow.field_data) ? reviewRow.field_data : {};
    handoff = getHandoffReceiptFromFieldData(fieldData);
  } catch {
    handoff = null;
  }

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
    complete,
    handoff: handoff ? {
      status: handoff.status || '',
      folderUrl: handoff.folderUrl || handoff.assessmentFolderUrl || '',
      spreadsheetUrl: handoff.spreadsheetUrl || handoff.reviewPortalDataSpreadsheetUrl || '',
      trackerUrl: handoff.trackerUrl || handoff.trackerRowUrl || '',
      rawReviewDataUrl: handoff.rawJsonUrl || handoff.rawReviewDataUrl || '',
      attemptCount: Number(handoff.attemptCount || 0),
      lastRunAt: handoff.lastRunAt || '',
      nextRunAt: handoff.nextRunAt || '',
      updatedAt: handoff.updatedAt || '',
      ready: isReadyHandoffReceipt(handoff)
    } : null
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
  params.set('source_system', 'neq.deleted');
  params.set('select', 'photo_id,drive_url,storage_path');
  const res = await fetch(normalizeSupabaseUrl(env, `/rest/v1/inspector_photo_uploads?${params}`), {
    headers: serviceHeaders(env)
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`photo_status_failed:${res.status}:${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : [];
}

async function getPhotoManifestRows(env, inspectionId) {
  const params = new URLSearchParams();
  params.set('inspection_id', `eq.${inspectionId}`);
  params.set('source_system', 'neq.deleted');
  params.set('select', 'photo_id,inspection_id,room_name,step_name,caption,slot,storage_path,drive_url,created_at');
  params.set('order', 'created_at.asc');
  const res = await fetch(normalizeSupabaseUrl(env, `/rest/v1/inspector_photo_uploads?${params}`), {
    headers: serviceHeaders(env)
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`photo_manifest_failed:${res.status}:${text.slice(0, 200)}`);
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

export {
  SHEET_CELL_SAFE_CHARS,
  buildFormattedReviewRows,
  buildRawAppRows,
  buildRawReviewRows
};
