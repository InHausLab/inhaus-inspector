// InHaus Inspector - Sync & Upload Logic
import { PHOTO_WORKER_URL, PHOTO_UPLOAD_SECRET, FIELD_RESUME_TOKEN } from './config.js?v=240';
import { uploadPhotoToSupabase, verifyInspectionStatus } from './supabase-photos.js?v=240';
import { getInspection, getSyncStatus, setSyncStatus, setLastSaveText,
         getLastSuccessfulCloudSyncAt, setLastSuccessfulCloudSyncAt,
         getLastCheckpointAttemptAt, setLastCheckpointAttemptAt,
         getLastCheckpointSucceededAt, setLastCheckpointSucceededAt,
         getBestCloudSyncAt } from './state.js?v=240';
import { scheduleSave } from './storage.js?v=240';
import { buildExportJSON, stripPhotosFromExport, extractAllPhotosFromExport } from './inspection.js?v=240';
import { ensureInspectionWorkspace, mergeRemoteInspection } from './findings.js?v=240';

const PHOTO_BACKGROUND_RETRY_LIMIT = 4;
const PHOTO_RETRY_BACKOFF_MS = 5 * 60 * 1000;
const CLOUD_POST_TIMEOUT_MS = 45000;
const CLOUD_GET_TIMEOUT_MS = 30000;
const CLOUD_LIST_TIMEOUT_MS = 15000;
let _photoRetryTimer = null;
let _photoRetryDueAt = 0;
let _photoRetryInProgress = false;
let _lastAutomaticPhotoRetryAt = 0;

async function fetchWithTimeout(url, options, timeoutMs, label) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, Object.assign({}, options || {}, { signal: controller.signal }));
  } catch (err) {
    if (err && err.name === 'AbortError') {
      throw new Error((label || 'Cloud request') + ' timed out. Check the connection and retry.');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function cloudRouteForPayload(payload) {
  if (payload?.photoUploadOnly) throw new Error('The retired Apps Script photo path is disabled.');
  if (payload?.action === 'startInspectionShell') return '/start-inspection-shell';
  if (payload?.action === 'teamMerge') return '/inspections/team-merge';
  if (payload?.action === 'appFeedback') return '/app-feedback';
  if (payload?.action === 'commentLibraryCandidate') return '/comment-library/candidates';
  if (payload?.action === 'commentLibraryAdmin') return '/comment-library/admin';
  return '/inspections/save';
}

export async function cloudFetch(payload) {
  if (!PHOTO_WORKER_URL || !PHOTO_UPLOAD_SECRET) throw new Error('Cloud inspection service is not configured.');
  const route = cloudRouteForPayload(payload);
  const body = Object.assign({}, payload, { sharedSecret: PHOTO_UPLOAD_SECRET });
  const resp = await fetchWithTimeout(PHOTO_WORKER_URL + route, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }, CLOUD_POST_TIMEOUT_MS, 'Cloud save');
  const responseText = await resp.text();
  let data;
  try {
    data = JSON.parse(responseText);
  } catch (err) {
    throw new Error('Cloud service returned invalid JSON.');
  }
  if (!resp.ok || !data || data.status === 'error' || data.error) {
    throw new Error((data && (data.message || data.error)) || 'Cloud save failed with HTTP ' + resp.status + '.');
  }
  return data;
}

function photoNeedsUpload(photo) {
  if (!photo) return false;
  if (photo._driveConfirmed === true || photo._uploaded === true || photo.storagePath || getPhotoDriveLink(photo)) return false;
  const imageData = photo.imageData || photo.dataUrl || '';
  return !!(imageData && imageData !== '__uploaded__');
}

function driveUrlFromId(driveId) {
  return driveId ? 'https://drive.google.com/file/d/' + encodeURIComponent(driveId) + '/view' : '';
}

function getPhotoDriveLink(photo) {
  if (!photo) return '';
  return photo.driveUrl || driveUrlFromId(photo.driveId);
}

function driveFolderUrlFromId(folderId) {
  return folderId ? 'https://drive.google.com/drive/folders/' + encodeURIComponent(folderId) : '';
}

function payloadFingerprint(payload) {
  let text = '';
  try {
    text = JSON.stringify(payload || {});
  } catch (err) {
    text = String(Date.now());
  }
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
  }
  return text.length + ':' + (hash >>> 0).toString(36);
}

function getKnownDriveFolderId(inspection, exportData) {
  return (inspection && (inspection._driveFolderId || inspection.driveFolderId || inspection.folderId)) ||
    (exportData && (exportData.driveFolderId || exportData.folderId)) ||
    '';
}

function rememberDriveResult(result, fingerprint, source) {
  const inspection = getInspection();
  if (!inspection || !result) return;
  const folderId = result.folderId || result.driveFolderId || '';
  const folderUrl = result.folderUrl || result.driveFolderUrl || driveFolderUrlFromId(folderId);
  if (folderId) {
    inspection._driveFolderId = folderId;
    inspection.driveFolderId = folderId;
  }
  if (folderUrl) {
    inspection._driveFolderUrl = folderUrl;
    inspection.driveFolderUrl = folderUrl;
  }
  if (result.spreadsheetId) inspection._spreadsheetId = result.spreadsheetId;
  if (result.spreadsheetUrl) inspection._spreadsheetUrl = result.spreadsheetUrl;
  if (result.technicianPhotosFolderId) {
    inspection._technicianPhotoFolderId = result.technicianPhotosFolderId;
  }
  if (result.assessmentNumber) {
    inspection._assessmentNumber = result.assessmentNumber;
    inspection.assessmentNumber = result.assessmentNumber;
  }
  if (result.trackerRow) {
    inspection._trackerRow = result.trackerRow;
    inspection.trackerRow = result.trackerRow;
  }
  if (result.trackerUrl) {
    inspection._trackerUrl = result.trackerUrl;
    inspection.trackerUrl = result.trackerUrl;
  }
  if (result.trackerStatus) {
    inspection._trackerStatus = result.trackerStatus;
    inspection.trackerStatus = result.trackerStatus;
  }
  if (fingerprint) inspection._lastMainPayloadFingerprint = fingerprint;
  inspection._dataSyncedToDrive = true;
  inspection._driveMetadataSource = source || inspection._driveMetadataSource || 'sync';
  inspection._driveMetadataUpdatedAt = new Date().toISOString();
  scheduleSave();
}

function isTestTrainingInspection(inspection) {
  if (!inspection) return false;
  if (inspection.is_test === true || inspection.isTest === true || inspection.testTraining === true || inspection.isTestTraining === true) return true;
  const explicit = [
    inspection.inspectionType,
    inspection.assessmentType,
    inspection.assessmentPurpose,
    inspection.inspectionMode,
    inspection.reportType
  ].filter(Boolean).join(' ');
  if (/test|training|practice|demo/i.test(explicit)) return true;
  return /(^|\b)(test|training|practice|demo)(\b|$)/i.test([
    inspection.inspectionId,
    inspection.clientName,
    inspection.propertyAddress
  ].filter(Boolean).join(' '));
}

function shellReceiptIsReady(inspection) {
  if (!inspection) return false;
  if (isTestTrainingInspection(inspection)) {
    return inspection._startInspectionShellStatus === 'skipped_test_training' ||
      inspection._startInspectionShellReceipt?.status === 'skipped_test_training' ||
      !!(
        inspection._startInspectionShellStatus === 'ready' &&
        (inspection.driveFolderId || inspection._driveFolderId || inspection.folderId)
      );
  }
  return !!(
    inspection._startInspectionShellStatus === 'ready' &&
    (inspection.driveFolderId || inspection._driveFolderId || inspection.folderId) &&
    (inspection.trackerRow || inspection._trackerRow) &&
    (inspection.trackerUrl || inspection._trackerUrl) &&
    (inspection.assessmentNumber || inspection._assessmentNumber)
  );
}

function rememberStartInspectionShellResult(result) {
  const inspection = getInspection();
  if (!inspection || !result) return;
  const receiptStatus = (
    result.shellStatus ||
    result.actionStatus ||
    (result.status && result.status !== 'ok' ? result.status : '') ||
    (result.isTestTraining ? 'skipped_test_training' : 'ready')
  );
  inspection._startInspectionShellReceipt = result;
  inspection._startInspectionShellStatus = receiptStatus;
  inspection._startInspectionShellUpdatedAt = result.updatedAt || new Date().toISOString();
  inspection._startInspectionShellError = result.error || '';
  if (result.isTestTraining === true) {
    inspection.isTestTraining = true;
    inspection.isTest = true;
    inspection.is_test = true;
  }
  rememberDriveResult(result, '', 'start-inspection-shell');
}

function attachKnownShellMetadata(exportData) {
  const inspection = getInspection();
  if (!inspection || !exportData) return exportData;
  const folderId = inspection.driveFolderId || inspection._driveFolderId || inspection.folderId || exportData.folderId || exportData.driveFolderId || '';
  const folderUrl = inspection.driveFolderUrl || inspection._driveFolderUrl || inspection.folderUrl || exportData.folderUrl || exportData.driveFolderUrl || driveFolderUrlFromId(folderId);
  exportData.assessmentNumber = inspection.assessmentNumber || inspection._assessmentNumber || exportData.assessmentNumber || '';
  exportData.folderId = folderId;
  exportData.driveFolderId = folderId;
  exportData.folderUrl = folderUrl;
  exportData.driveFolderUrl = folderUrl;
  exportData.trackerRow = inspection.trackerRow || inspection._trackerRow || exportData.trackerRow || '';
  exportData.trackerUrl = inspection.trackerUrl || inspection._trackerUrl || exportData.trackerUrl || '';
  exportData.trackerStatus = inspection.trackerStatus || inspection._trackerStatus || exportData.trackerStatus || '';
  exportData.startInspectionShell = inspection._startInspectionShellReceipt || exportData.startInspectionShell || null;
  if (isTestTrainingInspection(inspection) || exportData.startInspectionShell?.isTestTraining === true) {
    exportData.isTestTraining = true;
    exportData.isTest = true;
    exportData.is_test = true;
    exportData.assessmentType = 'Test / Training';
  }
  return exportData;
}

export async function ensureStartInspectionShell(stepList, options = {}) {
  const inspection = getInspection();
  if (!inspection) return { ok: false, skipped: true, message: 'No active inspection' };
  if (shellReceiptIsReady(inspection) && !options.force) {
    return { ok: true, cached: true, receipt: inspection._startInspectionShellReceipt || null };
  }
  if (!navigator.onLine) {
    inspection._startInspectionShellStatus = 'failed';
    inspection._startInspectionShellError = 'Offline';
    inspection._startInspectionShellFailedAt = new Date().toISOString();
    scheduleSave();
    return { ok: false, message: 'Offline' };
  }

  const exportData = buildExportJSON(Array.isArray(stepList) ? stepList : []);
  const payload = stripPhotosFromExport(exportData);
  payload.action = 'startInspectionShell';
  payload.requestedBy = 'inspector-app';
  payload.startedAt = payload.startedAt || inspection.startedAt || new Date().toISOString();
  updateSyncStatus('syncing', 'creating assessment shell');
  try {
    const result = await cloudFetch(payload);
    rememberStartInspectionShellResult(result);
    setLastCheckpointSucceededAt(Date.now());
    updateSyncStatus('checkpoint', 'assessment shell ready');
    scheduleSave({ markDirty: false });
    return { ok: true, receipt: result };
  } catch (err) {
    const message = err && err.message ? err.message : String(err || 'Start inspection shell failed');
    inspection._startInspectionShellStatus = 'failed';
    inspection._startInspectionShellError = message;
    inspection._startInspectionShellFailedAt = new Date().toISOString();
    scheduleSave();
    updateSyncStatus('failed', message);
    return { ok: false, message };
  }
}

function getLocalPhotoMap(inspection) {
  const map = new Map();
  visitLocalInspectionPhotos(inspection, function(photo) {
    if (photo && photo.photoId && !map.has(photo.photoId)) map.set(photo.photoId, photo);
  });
  return map;
}

function queueUnconfirmedLocalPhotos(inspection, exportedPhotos, warning) {
  if (!inspection || !Array.isArray(exportedPhotos) || !exportedPhotos.length) return;
  const localPhotos = getLocalPhotoMap(inspection);
  exportedPhotos.forEach(function(exportedPhoto) {
    const localPhoto = exportedPhoto && exportedPhoto.photoId ? localPhotos.get(exportedPhoto.photoId) : null;
    if (!localPhoto) return;
    localPhoto._uploadFailed = true;
    localPhoto._uploadWarning = warning || 'not_confirmed';
    addToPhotoRetryQueue(localPhoto);
  });
}

function visitLocalInspectionPhotos(inspection, callback) {
  if (!inspection) return;
  if (inspection.stepData) {
    Object.values(inspection.stepData).forEach(function(stepData) {
      Object.values(stepData || {}).forEach(function(v) {
        if (Array.isArray(v) && v.length && v[0] && typeof v[0].photoId === 'string') {
          v.forEach(callback);
        }
      });
    });
  }
  if (Array.isArray(inspection.sparePhotos)) {
    inspection.sparePhotos.forEach(callback);
  }
}

function markConfirmedLocalPhotos(inspection, confirmedPhotos) {
  visitLocalInspectionPhotos(inspection, function(photo) {
    if (!photo || !photo.photoId || !confirmedPhotos.has(photo.photoId)) return;
    const confirmed = confirmedPhotos.get(photo.photoId);
    if (confirmed.driveUrl) photo.driveUrl = confirmed.driveUrl;
    if (confirmed.driveId) photo.driveId = confirmed.driveId;
    photo._driveConfirmed = true;
    photo._uploaded = true;
    // Keep the local image copy. Workspace Drive sharing can be restricted even
    // when the file itself was saved, and photos are too important to discard.
    photo._uploadFailed = false;
    photo._uploadWarning = '';
    if (window.DB && window.DB.updatePhoto) {
      window.DB.updatePhoto(photo.photoId, {
        driveUrl: photo.driveUrl || '',
        driveId: photo.driveId || '',
        uploadState: 'uploaded'
      });
    }
  });
  if (Array.isArray(inspection._photoRetryQueue)) {
    inspection._photoRetryQueue = inspection._photoRetryQueue.filter(function(photo) {
      return !photo || !photo.photoId || !confirmedPhotos.has(photo.photoId);
    });
  }
}

// ── Sync Status Indicator (Change 2) ──────────────────────
// States: local | synced | syncing | checkpoint | failed | offline | final-failed
export function updateSyncStatus(state, detail) {
  setSyncStatus(state);
  var LABELS = {
    local: 'Saved locally',
    synced: 'Backed up to cloud ✓',
    syncing: 'Backing up to cloud…',
    checkpoint: 'Checkpoint saved ✓',
    failed: 'Sync failed — tap to retry',
    offline: 'Offline — saving locally',
    'final-failed': 'FINAL SYNC FAILED — do not leave'
  };
  var COLORS = {
    local: '#6b7280',
    synced: '#16a34a',
    syncing: '#2563eb',
    checkpoint: '#16a34a',
    failed: '#dc2626',
    offline: '#d97706',
    'final-failed': '#7f1d1d'
  };
  var bestSync = Math.max(getLastSuccessfulCloudSyncAt() || 0, getLastCheckpointSucceededAt() || 0);
  var timeAgo = '';
  if (state === 'local' || state === 'synced') {
    if (bestSync) {
      var min = Math.round((Date.now() - bestSync) / 60000);
      if (min >= 1) timeAgo = ' (' + min + ' min ago)';
    }
  } else if (state === 'failed') {
    if (bestSync) {
      var minFailed = Math.round((Date.now() - bestSync) / 60000);
      timeAgo = ' — last backup ' + (minFailed < 1 ? 'just now' : minFailed + ' min ago');
    } else {
      timeAgo = ' — no backup yet';
    }
  }
  var fullText = (LABELS[state] || state) + timeAgo + (detail ? ' — ' + detail : '');
  setLastSaveText(fullText);
  var saveEl = document.getElementById('save-status');
  if (saveEl) {
    saveEl.textContent = fullText;
    saveEl.style.color = COLORS[state] || '';
    if (state === 'failed') {
      saveEl.style.cursor = 'pointer';
      saveEl.onclick = function() { updateSyncStatus('syncing'); checkpointToCloud(); };
    } else {
      saveEl.style.cursor = '';
      saveEl.onclick = null;
    }
  }
  // Persistent overlay banner for critical errors
  var banner = document.getElementById('sync-status-banner');
  if (state === 'failed' || state === 'final-failed') {
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'sync-status-banner';
      banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99997;padding:10px 12px;font-size:14px;font-weight:700;text-align:center;touch-action:manipulation;';
      document.body.appendChild(banner);
    }
    banner.style.background = COLORS[state];
    banner.style.color = '#fff';
    banner.textContent = fullText;
    if (state === 'failed') {
      banner.style.cursor = 'pointer';
      banner.onclick = function() { banner.remove(); updateSyncStatus('syncing'); checkpointToCloud(); };
    } else {
      banner.style.cursor = 'default';
      banner.onclick = null;
    }
  } else if (banner) {
    banner.remove();
  }
  // Fade checkpoint → grey after 10s
  if (state === 'checkpoint') {
    setTimeout(function() { if (getSyncStatus() === 'checkpoint') updateSyncStatus('local'); }, 10000);
  }
}

// ── Google Drive Upload ─────────────────────────────────────
export function showUploadBanner(type, msg) {
  const old = document.getElementById('upload-banner');
  if (old) old.remove();
  const banner = UI.el('div', { id: 'upload-banner', className: 'upload-banner upload-' + type });
  banner.textContent = msg;
  document.body.appendChild(banner);
  if (type === 'success') setTimeout(() => { if (banner.parentNode) banner.remove(); }, 5000);
}

// ── Real-time single-photo upload ─────────────────────────
export async function uploadPhotoImmediate(photo, inspectionId, clientName, propertyAddress) {
  if (!PHOTO_WORKER_URL || !inspectionId) return false;
  const inspection = getInspection();
  let originalDataUrl = photo.dataUrl;
  if (!originalDataUrl || originalDataUrl === '__uploaded__') {
    if (photo.photoId && window.DB && window.DB.getPhoto) {
      try {
        const vaulted = await window.DB.getPhoto(photo.photoId);
        if (vaulted && vaulted.dataUrl) {
          originalDataUrl = vaulted.dataUrl;
          photo.dataUrl = originalDataUrl;
          photo.thumbnailDataUrl = photo.thumbnailDataUrl || vaulted.thumbnailDataUrl || '';
          photo._vaultRecovered = true;
        }
      } catch (vaultErr) {
        console.warn('Photo vault lookup failed:', vaultErr);
      }
    }
    if (!originalDataUrl || originalDataUrl === '__uploaded__') return !!(photo.driveUrl || photo.driveId);
  }

  return await storePhotoInSupabase(photo, inspectionId, originalDataUrl);
}

// Phase 2 photo path: upload one photo to Supabase and update local state to
// match the existing UI's expectations. Sets _driveConfirmed so the current
// final-submit/receipt UI counts it as "safe" without touching screens.js yet.
async function storePhotoInSupabase(photo, inspectionId, originalDataUrl) {
  try {
    const { storagePath } = await uploadPhotoToSupabase({
      photoId: photo.photoId,
      inspectionId: inspectionId,
      dataUrl: originalDataUrl,
      roomName: photo.roomName || '',
      stepName: photo.stepName || '',
      caption: photo.caption || '',
      assignedSlot: photo.assignedSlot || photo.slot || ''
    });
    photo.storagePath = storagePath;
    photo._storedConfirmed = true;
    photo._driveConfirmed = true; // bridge: existing UI treats this as "confirmed/safe"
    photo._uploaded = true;
    photo._uploadFailed = false;
    if (window.DB && window.DB.updatePhoto) {
      window.DB.updatePhoto(photo.photoId, { storagePath: storagePath, uploadState: 'stored' });
    }
    scheduleSave();
    updateSyncStatus('checkpoint');
    return true;
  } catch (e) {
    console.warn('Supabase photo upload failed, keeping local for retry:', e && e.message, photo.photoId);
    photo.dataUrl = originalDataUrl;
    photo._uploadFailed = true;
    addToPhotoRetryQueue(photo);
    return false;
  }
}

export function addToPhotoRetryQueue(photo) {
  const inspection = getInspection();
  if (!inspection) return;
  if (!inspection._photoRetryQueue) inspection._photoRetryQueue = [];
  const already = inspection._photoRetryQueue.find(function(p) { return p.photoId === photo.photoId; });
  if (!already) inspection._photoRetryQueue.push(photo);
  scheduleSave();
  schedulePhotoRetry(PHOTO_RETRY_BACKOFF_MS);
}

export function queuePhotoForBackgroundUpload(photo) {
  addToPhotoRetryQueue(photo);
  schedulePhotoRetry(PHOTO_RETRY_BACKOFF_MS);
}

export function schedulePhotoRetry(delayMs) {
  if (!navigator.onLine) return;
  const earliestRetryAt = _lastAutomaticPhotoRetryAt + PHOTO_RETRY_BACKOFF_MS;
  const dueAt = Math.max(Date.now() + Math.max(0, delayMs || 0), earliestRetryAt);
  if (_photoRetryTimer && _photoRetryDueAt <= dueAt) return;
  if (_photoRetryTimer) clearTimeout(_photoRetryTimer);
  _photoRetryDueAt = dueAt;
  _photoRetryTimer = setTimeout(function() {
    _photoRetryTimer = null;
    _photoRetryDueAt = 0;
    if (navigator.onLine) retryFailedPhotos({ automatic: true, limit: PHOTO_BACKGROUND_RETRY_LIMIT, quiet: true });
  }, Math.max(0, dueAt - Date.now()));
}

export async function retryFailedPhotos(options) {
  const opts = options || {};
  const inspection = getInspection();
  if (!inspection || !PHOTO_WORKER_URL || !navigator.onLine) return { total: 0, completed: 0, confirmed: 0, remaining: 0 };
  if (_photoRetryInProgress) return { total: 0, completed: 0, confirmed: 0, remaining: (inspection._photoRetryQueue || []).filter(photoNeedsUpload).length };
  const queue = (inspection._photoRetryQueue || []).filter(photoNeedsUpload);
  if (!queue.length) return { total: 0, completed: 0, confirmed: 0, remaining: 0 };
  if (opts.automatic) {
    const retryIn = PHOTO_RETRY_BACKOFF_MS - (Date.now() - _lastAutomaticPhotoRetryAt);
    if (retryIn > 0) {
      schedulePhotoRetry(retryIn);
      return { total: queue.length, completed: 0, confirmed: 0, remaining: queue.length };
    }
    _lastAutomaticPhotoRetryAt = Date.now();
  }

  _photoRetryInProgress = true;
  const limit = Number.isFinite(opts.limit) ? opts.limit : queue.length;
  const batch = queue.slice(0, Math.max(1, limit));
  if (!opts.quiet) updateSyncStatus('syncing');
  let confirmed = 0;
  let completed = 0;
  try {
    for (const photo of batch) {
      try {
        await uploadPhotoImmediate(photo, inspection.inspectionId, inspection.clientName, inspection.propertyAddress);
        if (photo._driveConfirmed) {
          inspection._photoRetryQueue = (inspection._photoRetryQueue || []).filter(function(p) { return p.photoId !== photo.photoId; });
          confirmed++;
        }
      } catch(e) { /* keep in queue */ }
      completed++;
      if (typeof opts.onProgress === 'function') {
        opts.onProgress({ total: batch.length, completed, confirmed });
      }
    }
  } finally {
    _photoRetryInProgress = false;
  }
  if (confirmed > 0) {
    scheduleSave();
    updateSyncStatus('checkpoint', 'photos +' + confirmed);
  }
  const remaining = (inspection._photoRetryQueue || []).filter(photoNeedsUpload).length;
  if (remaining > 0) schedulePhotoRetry(PHOTO_RETRY_BACKOFF_MS);
  return { total: batch.length, completed, confirmed, remaining };
}

// Phase 2 final-submit path: ensure every photo is stored in Supabase (upload any
// not yet confirmed). Replaces the Apps Script batch/folder-lookup loop. Final
// submit becomes a receipt — photos mostly upload on capture; this flushes the rest.
async function uploadPhotosViaSupabase(photosToUpload, exportData, inspection) {
  const inspectionId = exportData.inspectionId;
  const localMap = getLocalPhotoMap(inspection);

  // Preflight: ask Supabase which photos are already confirmed for this inspection.
  // This handles the case where the app crashed after upload but before marking local
  // state as __uploaded__ — avoids redundant re-uploads and unblocks submit.
  const supabaseConfirmed = new Set();
  try {
    const { checkSupabaseConfirmed } = await import('./supabase-photos.js?v=240');
    const confirmedIds = await checkSupabaseConfirmed(inspectionId);
    confirmedIds.forEach(id => supabaseConfirmed.add(id));
    if (supabaseConfirmed.size > 0) {
      console.log('[sync] Supabase preflight: ' + supabaseConfirmed.size + ' photos already confirmed, skipping re-upload');
    }
  } catch (e) {
    console.warn('[sync] Supabase preflight check failed (non-fatal):', e && e.message);
  }

  // Build the upload set from the export AND the photo vault. Pixels can live ONLY
  // in the vault (e.g. after an iOS local-save hiccup) where the export misses them,
  // so the vault is the source of truth for "every photo that still needs uploading".
  const byId = new Map();
  (photosToUpload || []).forEach(p => { if (p && p.photoId) byId.set(p.photoId, p); });
  const vaultState = new Map();
  try {
    if (window.DB && window.DB.getPhotosForInspection) {
      const vault = await window.DB.getPhotosForInspection(inspectionId);
      vault.forEach(v => {
        if (!v || !v.photoId) return;
        vaultState.set(v.photoId, v.uploadState || '');
        const hasPixels = v.dataUrl && v.dataUrl !== '__uploaded__';
        if (byId.has(v.photoId)) {
          const ex = byId.get(v.photoId);
          if (!ex.imageData && !ex.dataUrl && hasPixels) ex.imageData = v.dataUrl;
        } else if (hasPixels && v.uploadState !== 'stored' && v.uploadState !== 'uploaded') {
          byId.set(v.photoId, { photoId: v.photoId, imageData: v.dataUrl, roomName: v.roomName || '', stepName: v.stepName || '', caption: v.caption || '' });
        }
      });
    }
  } catch (e) { /* vault read is best-effort */ }

  const all = Array.from(byId.values());
  const confirmedMap = new Map();
  const failed = [];
  let confirmed = 0;
  let attempted = 0;
  for (let i = 0; i < all.length; i++) {
    const exported = all[i];
    const vs = vaultState.get(exported.photoId);
    // Already stored in Supabase — count it, don't re-upload (avoids duplicate rows).
    if (vs === 'stored' || vs === 'uploaded' || (exported && (exported._driveConfirmed || exported.storagePath)) || supabaseConfirmed.has(exported.photoId)) {
      confirmed++;
      if (exported.photoId) confirmedMap.set(exported.photoId, { driveId: '' });
      continue;
    }
    const live = exported.photoId ? localMap.get(exported.photoId) : null;
    const photo = live || exported;
    // uploadPhotoImmediate reads `dataUrl`; export/vault photos carry pixels in `imageData`.
    if ((!photo.dataUrl || photo.dataUrl === '__uploaded__') && exported.imageData) {
      photo.dataUrl = exported.imageData;
    }
    attempted++;
    updateSyncStatus('syncing', 'photos ' + attempted);
    showUploadBanner('pending', 'Saving photo ' + attempted + '…');
    let ok = false;
    try {
      ok = await uploadPhotoImmediate(photo, inspectionId, exportData.clientName, exportData.propertyAddress);
    } catch (e) { ok = false; }
    if (ok) { confirmed++; if (exported.photoId) confirmedMap.set(exported.photoId, { driveId: '' }); }
    else failed.push(exported);
  }
  // Mark confirmed across all live copies + the vault so the receipt is accurate.
  if (confirmedMap.size > 0 && inspection) markConfirmedLocalPhotos(inspection, confirmedMap);
  if (inspection) scheduleSave();
  if (failed.length > 0) {
    queueUnconfirmedLocalPhotos(inspection, failed, 'supabase_upload_failed');
    throw new Error('Photo upload incomplete: saved ' + confirmed + ' of ' + all.length + ' photos to Supabase');
  }
  if (all.length > 0) showUploadBanner('success', 'All ' + all.length + ' photo' + (all.length === 1 ? '' : 's') + ' saved');
}

function getExpectedPhotoIds(photos, inspection) {
  const ids = [];
  function addPhoto(photo) {
    const photoId = String(photo && photo.photoId || '').trim();
    if (!photoId) throw new Error('A captured photo is missing its photo ID. Re-open the inspection before retrying.');
    if (!ids.includes(photoId)) ids.push(photoId);
  }
  (photos || []).forEach(addPhoto);
  visitLocalInspectionPhotos(inspection, addPhoto);
  return ids;
}

async function verifyFinalSync(exportData, allPhotos, inspection) {
  updateSyncStatus('syncing', 'verifying');
  showUploadBanner('pending', 'Verifying cloud save…');
  const expectedPhotoIds = getExpectedPhotoIds(allPhotos, inspection);
  const status = await verifyInspectionStatus(exportData.inspectionId, expectedPhotoIds);
  if (!status || status.complete !== true || status.assessmentExists !== true) {
    const missingCount = Array.isArray(status && status.missingPhotoIds) ? status.missingPhotoIds.length : expectedPhotoIds.length;
    if (!status || status.assessmentExists !== true) {
      throw new Error('Cloud verification failed: the assessment record is missing.');
    }
    throw new Error('Cloud verification failed: ' + missingCount + ' photo' + (missingCount === 1 ? '' : 's') + ' missing from storage.');
  }
  return status;
}
export async function sendInspectionToCloud(exportData) {
  attachKnownShellMetadata(exportData);
  const inspection = getInspection();
  // Always strip photos from main payload - send data first, then photos separately
  const allPhotos = extractAllPhotosFromExport(exportData);
  const mainPayload = stripPhotosFromExport(exportData);
  // Keep lightweight photo metadata in the main save so the handoff can build a
  // complete Photo Log even though binary photo data now travels through Supabase.
  mainPayload.photoManifest = allPhotos.map(function(photo) {
    return {
      photoId: photo.photoId || '',
      roomName: photo.roomName || '',
      stepName: photo.stepName || '',
      caption: photo.caption || '',
      timestamp: photo.timestamp || ''
    };
  });
  const mainPayloadFingerprint = payloadFingerprint(mainPayload);
  const photosToUpload = allPhotos.filter(photoNeedsUpload);

  // Always resend inspection JSON during final submit/retry. The Worker/Supabase
  // write is idempotent, so a confirmed server round-trip is safer than local flags.
  const mainResult = await cloudFetch(mainPayload);
  rememberDriveResult(mainResult, mainPayloadFingerprint, 'main-sync');

  // The vault flush catches photos whose pixels did not make it into the export.
  await uploadPhotosViaSupabase(photosToUpload, exportData, inspection);
  const verified = await verifyFinalSync(exportData, allPhotos, inspection);
  if (inspection) {
    inspection._lastServerVerification = verified;
    inspection._lastServerVerifiedAt = new Date().toISOString();
    scheduleSave({ markDirty: false });
  }
}

async function fetchCloudInspectionJson(url, context, timeoutMs) {
  const resp = await fetchWithTimeout(url.toString(), {
    method: 'GET',
    cache: 'no-store',
    headers: { Accept: 'application/json' }
  }, timeoutMs || CLOUD_GET_TIMEOUT_MS, context);
  const text = await resp.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error(context + ' returned an invalid response.');
  }
  if (!resp.ok || !data || data.status !== 'ok') {
    throw new Error((data && data.message) || context + ' failed.');
  }
  return data;
}

let _bridgeCapabilities = null;
export function normalizeBridgeCapabilities(data) {
  if (!data || typeof data !== 'object') return {};
  const nested = data.capabilities && typeof data.capabilities === 'object'
    ? data.capabilities
    : {};
  return Object.assign({}, data, nested);
}

async function loadBridgeCapabilities() {
  if (_bridgeCapabilities) return _bridgeCapabilities;
  try {
    const url = new URL(PHOTO_WORKER_URL + '/health');
    url.searchParams.set('token', FIELD_RESUME_TOKEN);
    const data = await fetchCloudInspectionJson(url, 'Cloud capabilities');
    // Production currently returns teamFieldMerge at the top level while older
    // deployments wrapped capabilities under `capabilities`. Accept both so
    // team devices always use the server's field-level merge route.
    _bridgeCapabilities = normalizeBridgeCapabilities(data);
  } catch (err) {
    _bridgeCapabilities = {};
  }
  return _bridgeCapabilities;
}

export async function listCloudInspections() {
  if (!PHOTO_WORKER_URL) throw new Error('Cloud inspection service is not configured.');
  const url = new URL(PHOTO_WORKER_URL + '/inspections/active');
  url.searchParams.set('token', FIELD_RESUME_TOKEN);
  const data = await fetchCloudInspectionJson(url, 'Active cloud inspection list', CLOUD_LIST_TIMEOUT_MS);
  return Array.isArray(data.inspections) ? data.inspections : [];
}

export async function loadCloudInspection(inspectionId) {
  if (!PHOTO_WORKER_URL) throw new Error('Cloud inspection service is not configured.');
  if (!inspectionId) throw new Error('Missing inspection ID.');
  const url = new URL(PHOTO_WORKER_URL + '/inspections/' + encodeURIComponent(inspectionId));
  url.searchParams.set('token', FIELD_RESUME_TOKEN);
  const data = await fetchCloudInspectionJson(url, 'Cloud inspection');
  if (!data.inspection) throw new Error('Cloud inspection data is missing.');
  return data.inspection;
}

// ── Step Checkpoint Sync ────────────────────────────
// Fire-and-forget backup after each step completes.
// Silent on failure - close-out export is still the authoritative save.
let _checkpointFailCount = 0;
let _lastCheckpointStepList = [];
let _lastBackupModalShownAt = 0;
let _checkpointBackoffMs = 0; // 0 = no backoff active

export function getCheckpointBackoffMs() {
  return _checkpointBackoffMs;
}

export async function checkpointToCloud(stepList) {
  const inspection = getInspection();
  if (!inspection || !PHOTO_WORKER_URL) return;
  if (!navigator.onLine) {
    updateSyncStatus('offline');
    return;
  }
  if (Array.isArray(stepList)) _lastCheckpointStepList = stepList;
  setLastCheckpointAttemptAt(Date.now()); // Change 1
  try {
    ensureInspectionWorkspace(inspection);
    const shellResult = await ensureStartInspectionShell(Array.isArray(stepList) ? stepList : _lastCheckpointStepList);
    if (!shellResult || shellResult.ok !== true) {
      throw new Error('Assessment shell is not ready: ' + (shellResult?.message || 'folder/tracker receipt missing'));
    }
    let usedServerTeamMerge = false;
    if (inspection.collaboration?.enabled && inspection.inspectionId) {
      const capabilities = await loadBridgeCapabilities();
      if (capabilities.teamFieldMerge === true) {
        const teamExport = buildExportJSON(Array.isArray(stepList) ? stepList : _lastCheckpointStepList);
        attachKnownShellMetadata(teamExport);
        const teamPayload = stripPhotosFromExport(teamExport);
        teamPayload._checkpoint = true;
        updateSyncStatus('syncing');
        const teamResult = await cloudFetch({
          action: 'teamMerge',
          token: FIELD_RESUME_TOKEN,
          inspection: teamPayload
        });
        if (teamResult.inspection) mergeRemoteInspection(inspection, teamResult.inspection);
        if (teamResult.resumeData) mergeRemoteInspection(inspection, teamResult.resumeData);
        scheduleSave({ markDirty: false });
        usedServerTeamMerge = true;
      } else {
        try {
          const cloudRecord = await loadCloudInspection(inspection.inspectionId);
          if (cloudRecord?.resumeData) {
            mergeRemoteInspection(inspection, cloudRecord.resumeData);
            scheduleSave({ markDirty: false });
          }
        } catch (mergeErr) {
          // A newly prepared inspection may not exist in the review API yet.
          // Continue with the local checkpoint; the next team sync will merge it.
          console.warn('Team merge pull skipped:', mergeErr);
        }
      }
    }
    if (usedServerTeamMerge) {
      setLastCheckpointSucceededAt(Date.now());
      _checkpointFailCount = 0;
      _checkpointBackoffMs = 0;
      updateSyncStatus('checkpoint');
      schedulePhotoRetry(PHOTO_RETRY_BACKOFF_MS);
      window.dispatchEvent(new CustomEvent('inhaus-checkpoint-success'));
      return true;
    }
    const exportData = buildExportJSON(Array.isArray(stepList) ? stepList : _lastCheckpointStepList);
    attachKnownShellMetadata(exportData);
    const payload = stripPhotosFromExport(exportData);
    payload._checkpoint = true;
    updateSyncStatus('syncing'); // Change 2
    const result = await cloudFetch(payload);
    rememberDriveResult(result, payloadFingerprint(payload), 'checkpoint');
    setLastCheckpointSucceededAt(Date.now()); // Change 1
    scheduleSave({ markDirty: false });
    _checkpointFailCount = 0; // reset on success
    _checkpointBackoffMs = 0;
    updateSyncStatus('checkpoint'); // Change 2
    schedulePhotoRetry(PHOTO_RETRY_BACKOFF_MS);
    window.dispatchEvent(new CustomEvent('inhaus-checkpoint-success'));
    return true;
  } catch (e) {
    console.log('Checkpoint sync skipped:', e);
    _checkpointFailCount++;
    const errorMsg = e && e.message ? e.message : String(e || 'Unknown error');
    updateSyncStatus('failed', errorMsg); // Change 2

    // Exponential backoff: 2min → 5min → 10min
    if (_checkpointFailCount === 1) _checkpointBackoffMs = 120000;
    else if (_checkpointFailCount === 2) _checkpointBackoffMs = 300000;
    else _checkpointBackoffMs = 600000;

    // Only show the modal if:
    // 1. It has been 30+ minutes since last successful backup
    // 2. It has been 10+ minutes since we last showed it
    // 3. The error was a server rejection (not a network timeout)
    const isNetworkTimeout = errorMsg.includes('timed out') || errorMsg.includes('AbortError') ||
      errorMsg.includes('Failed to fetch') || errorMsg.includes('NetworkError') || errorMsg.includes('timeout');
    const lastOk = getBestCloudSyncAt ? getBestCloudSyncAt() : null;
    const minSinceBackup = lastOk ? Math.round((Date.now() - lastOk) / 60000) : null;
    const minSinceModal = Math.round((Date.now() - _lastBackupModalShownAt) / 60000);
    const backupOverdue = minSinceBackup === null || minSinceBackup >= 30;
    const modalCooledDown = (Date.now() - _lastBackupModalShownAt) > 600000; // 10 min cooldown

    if (!isNetworkTimeout && backupOverdue && modalCooledDown) {
      _lastBackupModalShownAt = Date.now();
      const minAgo = minSinceBackup !== null ? 'Last successful backup: ' + minSinceBackup + ' min ago.\n\n' : 'No successful backup yet.\n\n';
      const msg = 'Your inspection data is NOT being backed up to the cloud.\n\n' +
        minAgo +
        'Last error: ' + errorMsg + '\n\n' +
        'Keep this app open and on screen. Do not force-close your browser.\n\nTap OK to retry.';
      if (confirm(msg)) { checkpointToCloud(stepList); }
    }
    return false;
  }
}

export async function submitInspection(exportData, stepList) {
  if (!PHOTO_WORKER_URL) return true;
  updateSyncStatus('syncing'); // Change 2
  showUploadBanner('pending', 'Saving assessment to cloud\u2026');
  try {
    const activeInspection = getInspection();
    const shellResult = await ensureStartInspectionShell([], { force: false });
    if (!shellResult || shellResult.ok !== true) {
      throw new Error('Assessment shell is not ready: ' + (shellResult?.message || 'folder/tracker receipt missing'));
    }
    attachKnownShellMetadata(exportData);
    if (activeInspection?.collaboration?.enabled && activeInspection.inspectionId) {
      try {
        const cloudRecord = await loadCloudInspection(activeInspection.inspectionId);
        if (cloudRecord?.resumeData) {
          mergeRemoteInspection(activeInspection, cloudRecord.resumeData);
          scheduleSave();
          const currentStepList = Array.isArray(stepList) && stepList.length
            ? stepList
            : _lastCheckpointStepList;
          if (currentStepList.length) exportData = buildExportJSON(currentStepList);
        }
      } catch (mergeErr) {
        console.warn('Final team merge pull skipped:', mergeErr);
      }
    }
    await sendInspectionToCloud(exportData);
    const handoffJob = await requestTannerHandoff(exportData);
    await window.DB.removeFromQueue(exportData.inspectionId);
    setLastSuccessfulCloudSyncAt(Date.now()); // Change 1
    const inspection = getInspection();
    if (inspection) {
      inspection._lastFinalSyncError = '';
      inspection._handoffJob = handoffJob;
      inspection._handoffRequestedAt = new Date().toISOString();
      scheduleSave();
    }
    updateSyncStatus('synced'); // Change 2
    const handoffStatus = String(handoffJob.status || '').toLowerCase();
    showUploadBanner('success', handoffStatus === 'ready'
      ? '\u2713 Tanner package ready'
      : '\u2713 Cloud save verified; Tanner package queued');
    // Auto-disable Dev Mode after successful final sync
    if (localStorage.getItem('inhausDevMode') === 'true') {
      localStorage.setItem('inhausDevMode', 'false');
      console.log('Dev Mode auto-disabled after successful final sync');
    }
    return true;
  } catch (e) {
    console.log('Upload failed, queuing for retry:', e);
    const inspection = getInspection();
    if (inspection) {
      inspection._lastFinalSyncError = e && e.message ? e.message : String(e || 'Unknown upload error');
      scheduleSave();
    }
    await window.DB.queueUpload(exportData);
    const isOffline = navigator.onLine === false;
    updateSyncStatus(isOffline ? 'offline' : 'final-failed'); // Change 2
    showUploadBanner(
      isOffline ? 'pending' : 'error',
      isOffline
        ? 'Offline \u2014 saved locally. Keep the app open and reconnect to upload.'
        : 'Upload failed \u2014 saved locally. Tap Submit to retry. Error: ' +
          (e && e.message ? e.message : 'Unknown sync error')
    );
    return false;
  }
}

async function requestTannerHandoff(exportData) {
  const inspectionId = String(exportData && exportData.inspectionId || '').trim();
  if (!inspectionId) throw new Error('Tanner package request is missing the inspection ID.');
  const activeInspection = getInspection() || {};
  const isTestTraining = isTestTrainingInspection(activeInspection) || isTestTrainingInspection(exportData);
  const response = await fetchWithTimeout(PHOTO_WORKER_URL + '/handoff-jobs', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + FIELD_RESUME_TOKEN
    },
    body: JSON.stringify({
      inspectionId,
      requestedBy: 'inspector-app-final-submit',
      runInline: false,
      reviewedData: {
        assessmentType: isTestTraining ? 'Test / Training' : (exportData.assessmentType || ''),
        isTestTraining,
        clientName: exportData.clientName || '',
        propertyAddress: exportData.propertyAddress || '',
        inspectionDate: exportData.inspectionDate || '',
        inspectorName: exportData.inspectorName || ''
      },
      submitAttempt: {
        requestedAt: new Date().toISOString(),
        completedAt: exportData.completedAt || exportData.endedAt || '',
        expectedPhotoCount: extractAllPhotosFromExport(exportData).length
      }
    })
  }, CLOUD_POST_TIMEOUT_MS, 'Tanner package request');
  const responseText = await response.text();
  let data;
  try {
    data = JSON.parse(responseText);
  } catch (err) {
    throw new Error('Tanner package service returned invalid JSON.');
  }
  if (!response.ok || !data || data.error) {
    throw new Error((data && (data.message || data.error)) ||
      'Tanner package request failed with HTTP ' + response.status + '.');
  }
  const status = String(data.status || '').trim().toLowerCase();
  if (!['queued', 'running', 'repairing', 'ready', 'complete', 'completed'].includes(status)) {
    throw new Error('Tanner package request was not accepted: ' + (status || 'missing status'));
  }
  return data;
}
