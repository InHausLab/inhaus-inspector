// InHaus Inspector - Sync & Upload Logic
import { GOOGLE_SCRIPT_URL, SYNC_SECRET, LEGACY_SYNC_SECRET, FIELD_RESUME_TOKEN, USE_SUPABASE_PHOTOS } from './config.js?v=167';
import { uploadPhotoToSupabase, mirrorPhotosToDrive, verifyInspectionStatus } from './supabase-photos.js?v=167';
import { getInspection, getSyncStatus, setSyncStatus, setLastSaveText,
         getLastSuccessfulCloudSyncAt, setLastSuccessfulCloudSyncAt,
         getLastCheckpointAttemptAt, setLastCheckpointAttemptAt,
         getLastCheckpointSucceededAt, setLastCheckpointSucceededAt,
         getBestCloudSyncAt } from './state.js?v=167';
import { scheduleSave } from './storage.js?v=167';
import { buildExportJSON, stripPhotosFromExport, extractAllPhotosFromExport } from './inspection.js?v=167';
import { ensureInspectionWorkspace, mergeRemoteInspection } from './findings.js?v=167';

// Wrapper: always injects the sync secret into the JSON body so Apps Script
// can authenticate the request without CORS-breaking custom headers.
let _workingSyncSecret = null;
const PHOTO_UPLOAD_BATCH_SIZE = 3;
const PHOTO_BACKGROUND_RETRY_LIMIT = 4;
let _photoRetryTimer = null;
let _photoRetryDueAt = 0;
let _photoRetryInProgress = false;
let _bulkPhotoUploadInProgress = false;

function getSyncSecretsToTry() {
  const secrets = [];
  [_workingSyncSecret, SYNC_SECRET, LEGACY_SYNC_SECRET].forEach(function(secret) {
    if (secret && !secrets.includes(secret)) secrets.push(secret);
  });
  return secrets;
}

async function postWithSyncSecret(payload, secret) {
  const body = Object.assign({}, payload, { 'x-sync-secret': secret });
  const resp = await fetch(GOOGLE_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify(body)
  });
  if (!resp.ok) throw new Error('HTTP ' + resp.status);
  const responseText = await resp.text();
  let data;
  try {
    data = JSON.parse(responseText);
  } catch (err) {
    const looksLikeHtml = /^\s*</.test(responseText);
    throw new Error(
      looksLikeHtml
        ? 'Apps Script returned an HTML page instead of JSON. The deployment URL may be expired or inaccessible.'
        : 'Apps Script returned invalid JSON.'
    );
  }
  if (!data || typeof data !== 'object') {
    throw new Error('Apps Script returned an invalid response.');
  }
  return data;
}

export async function scriptFetch(payload) {
  let lastUnauthorized = 'Unauthorized';
  for (const secret of getSyncSecretsToTry()) {
    const data = await postWithSyncSecret(payload, secret);
    if (data.status === 'error') {
      const message = data.message || 'Apps Script error';
      if (message.toLowerCase().includes('unauthorized')) {
        lastUnauthorized = message;
        continue;
      }
      _workingSyncSecret = secret;
      throw new Error(message);
    }
    if (data.status !== 'ok') {
      _workingSyncSecret = secret;
      throw new Error(data.message || 'Apps Script did not confirm the save.');
    }
    _workingSyncSecret = secret;
    return data;
  }
  throw new Error(lastUnauthorized);
}

function photoNeedsUpload(photo) {
  if (!photo) return false;
  if (photo._driveConfirmed === true || photo._uploaded === true || getPhotoDriveLink(photo)) return false;
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

function getUploadedCount(uploadResult) {
  const raw = uploadResult && (
    uploadResult.photosUploaded ||
    uploadResult.uploaded ||
    uploadResult.uploadedCount ||
    uploadResult.count
  );
  const count = Number(raw);
  return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
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

function addUniqueLookupKey(keys, value) {
  const key = String(value || '').trim();
  if (key && !keys.includes(key)) keys.push(key);
}

function getClientLastName(fullName) {
  const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : '';
}

function getPhotoFolderLookupKeys(inspection, exportData) {
  const keys = [];
  addUniqueLookupKey(keys, inspection && inspection._photoFolderLookupId);
  addUniqueLookupKey(keys, exportData && exportData.inspectionId);
  addUniqueLookupKey(keys, exportData && exportData.propertyAddress);
  addUniqueLookupKey(keys, getClientLastName(exportData && exportData.clientName));
  addUniqueLookupKey(keys, exportData && exportData.clientName);
  return keys;
}

function isInspectionFolderNotFoundError(err) {
  const message = err && err.message ? err.message : String(err || '');
  return /Inspection folder not found/i.test(message);
}

function isPhotoLogAlreadyExistsError(err) {
  const message = err && err.message ? err.message : String(err || '');
  return /sheet with the name\s+"?Photo Log"?\s+already exists/i.test(message);
}

function syntheticConfirmedPhotoResult(photos, inspectionId, warning) {
  const requestedPhotos = Array.isArray(photos) ? photos : [];
  return {
    photosUploaded: requestedPhotos.length,
    inspectionId: inspectionId || '',
    warning: warning || '',
    photos: requestedPhotos.map(function(photo) {
      return {
        photoId: photo && photo.photoId ? photo.photoId : '',
        room: photo && photo.roomName ? photo.roomName : '',
        step: photo && photo.stepName ? photo.stepName : '',
        caption: photo && photo.caption ? photo.caption : '',
        driveUrl: '',
        driveId: ''
      };
    })
  };
}

async function uploadPhotoBatchWithFolderFallback(basePayload, lookupKeys) {
  let lastFolderError = null;
  const keys = lookupKeys.length ? lookupKeys : [basePayload.inspectionId];
  for (const lookupKey of keys) {
    try {
      const payload = Object.assign({}, basePayload, { inspectionId: lookupKey });
      const result = await scriptFetch(payload);
      return { result: result, lookupKey: lookupKey };
    } catch (err) {
      if (!isInspectionFolderNotFoundError(err)) throw err;
      lastFolderError = err;
    }
  }
  throw lastFolderError || new Error('Inspection folder not found');
}

function getKnownDriveFolderUrl(inspection, exportData) {
  return (inspection && (inspection._driveFolderUrl || inspection.driveFolderUrl || inspection.folderUrl)) ||
    (exportData && (exportData.driveFolderUrl || exportData.folderUrl)) ||
    driveFolderUrlFromId(getKnownDriveFolderId(inspection, exportData));
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
  if (fingerprint) inspection._lastMainPayloadFingerprint = fingerprint;
  inspection._dataSyncedToDrive = true;
  inspection._driveMetadataSource = source || inspection._driveMetadataSource || 'sync';
  inspection._driveMetadataUpdatedAt = new Date().toISOString();
  scheduleSave();
}

async function recoverDriveMetadataFromReviewApi(inspectionId, fingerprint) {
  if (!GOOGLE_SCRIPT_URL || !inspectionId) return false;
  const inspection = getInspection();
  if (getKnownDriveFolderId(inspection)) return true;

  try {
    const url = new URL(GOOGLE_SCRIPT_URL);
    url.searchParams.set('action', 'get');
    url.searchParams.set('id', inspectionId);
    url.searchParams.set('token', String(inspectionId).toLowerCase());
    const resp = await fetch(url.toString(), { method: 'GET', cache: 'no-store' });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const data = await resp.json();
    if (!data || data.status === 'error') throw new Error((data && data.message) || 'review lookup failed');
    const remote = data.inspection || {};
    const folderId = remote.folderId || remote.driveFolderId || remote.drive_folder_id || '';
    if (!folderId) return false;
    rememberDriveResult({
      folderId: folderId,
      folderUrl: remote.folderUrl || remote.assessmentFolderUrl || driveFolderUrlFromId(folderId),
      spreadsheetId: remote.spreadsheetId || '',
      spreadsheetUrl: remote.spreadsheetUrl || ''
    }, fingerprint, 'review-api');
    return true;
  } catch (err) {
    console.warn('Existing Drive folder lookup failed:', err);
    return false;
  }
}

function getConfirmedPhotoMap(uploadResult, requestedPhotos) {
  const confirmed = new Map();
  const returnedPhotos = Array.isArray(uploadResult && uploadResult.photos) ? uploadResult.photos : [];
  returnedPhotos.forEach(function(p, idx) {
    const driveUrl = getPhotoDriveLink(p);
    const photoId = (p && p.photoId) || (requestedPhotos && requestedPhotos[idx] && requestedPhotos[idx].photoId);
    if (photoId && driveUrl) {
      confirmed.set(photoId, {
        driveUrl: driveUrl,
        driveId: p.driveId || ''
      });
    }
  });
  const uploadedCount = Math.min(getUploadedCount(uploadResult), (requestedPhotos || []).length);
  for (let idx = 0; idx < uploadedCount; idx++) {
    const returnedPhoto = returnedPhotos[idx] || {};
    const requestedPhoto = requestedPhotos && requestedPhotos[idx];
    const photoId = (returnedPhoto && returnedPhoto.photoId) || (requestedPhoto && requestedPhoto.photoId);
    if (photoId && !confirmed.has(photoId)) {
      confirmed.set(photoId, {
        driveUrl: getPhotoDriveLink(returnedPhoto) || '',
        driveId: (returnedPhoto && returnedPhoto.driveId) || ''
      });
    }
  }
  return confirmed;
}

function normalizePhotoForUpload(photo) {
  if (!photo) return photo;
  const imageData = photo.imageData || photo.dataUrl || '';
  return Object.assign({}, photo, { imageData: imageData });
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
    synced: 'Synced to Drive ✓',
    syncing: 'Syncing to Drive…',
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
// NOTE: Photos are uploaded to Drive as private files.
// The Apps Script must call setSharing(ANYONE_WITH_LINK, VIEW) on each file
// for the review portal to display them. This is a known workaround - see issue tracker.
export async function uploadPhotoImmediate(photo, inspectionId, clientName, propertyAddress) {
  if (!GOOGLE_SCRIPT_URL || !inspectionId) return false;
  const inspection = getInspection();
  const knownFolderId = getKnownDriveFolderId(inspection);
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

  // Phase 2: route photos straight to Supabase Storage as binary, bypassing the
  // base64 → Apps Script → Drive path entirely. Flag-gated; off by default.
  if (USE_SUPABASE_PHOTOS) {
    return await storePhotoInSupabase(photo, inspectionId, originalDataUrl);
  }

  // [RETIRED] If we reach here, USE_SUPABASE_PHOTOS is false — should not happen in production.
  console.warn('[RETIRED] Apps Script photo path triggered — should not happen with USE_SUPABASE_PHOTOS=true');

  const payload = {
    photoUploadOnly: true,
    inspectionId: inspectionId,
    sourceInspectionId: inspectionId,
    clientName: clientName || '',
    propertyAddress: propertyAddress || '',
    folderId: knownFolderId,
    driveFolderId: knownFolderId,
    folderUrl: getKnownDriveFolderUrl(inspection),
    photos: [{
      photoId: photo.photoId || '',
      roomName: photo.roomName || '',
      stepName: photo.stepName || '',
      imageData: originalDataUrl || '',
      caption: photo.caption || '',
      assignedSlot: photo.assignedSlot || ''
    }]
  };

  async function doUpload() {
    const uploadResult = await uploadPhotoBatchWithFolderFallback(
      payload,
      getPhotoFolderLookupKeys(inspection, {
        inspectionId: inspectionId,
        clientName: clientName || '',
        propertyAddress: propertyAddress || ''
      })
    );
    if (inspection && uploadResult.lookupKey && uploadResult.lookupKey !== inspectionId) {
      inspection._photoFolderLookupId = uploadResult.lookupKey;
    }
    return uploadResult.result;
  }

  try {
    const result = await doUpload();
    rememberDriveResult(result, inspection && inspection._lastMainPayloadFingerprint, 'photo-upload');
    const returnedPhoto = result && result.photos && result.photos[0];
    const confirmedDriveUrl = getPhotoDriveLink(returnedPhoto);
    const uploadedCount = getUploadedCount(result);

    if (uploadedCount > 0) {
      // Drive confirmed receipt. Keep the local copy in case Drive sharing is restricted.
      if (confirmedDriveUrl) photo.driveUrl = confirmedDriveUrl;
      if (returnedPhoto && returnedPhoto.driveId) photo.driveId = returnedPhoto.driveId;
      photo._driveConfirmed = true;
      photo._uploaded = true;
      if (window.DB && window.DB.updatePhoto) {
        window.DB.updatePhoto(photo.photoId, {
          driveUrl: photo.driveUrl || '',
          driveId: photo.driveId || '',
          uploadState: 'uploaded'
        });
      }
      scheduleSave();
      updateSyncStatus('checkpoint');
      return true;
    } else {
      // Drive returned OK but 0 photos — keep for retry
      console.warn('Photo upload returned 0 — keeping in IndexedDB for retry', photo.photoId);
      photo._uploadFailed = true;
      addToPhotoRetryQueue(photo);
      return false;
    }
  } catch(e) {
    if (isPhotoLogAlreadyExistsError(e)) {
      console.warn('Photo uploaded but Photo Log append collided; marking confirmed:', photo.photoId);
      photo._driveConfirmed = true;
      photo._uploaded = true;
      photo._uploadFailed = false;
      photo._uploadWarning = 'photo_log_already_exists';
      if (window.DB && window.DB.updatePhoto) {
        window.DB.updatePhoto(photo.photoId, {
          driveUrl: photo.driveUrl || '',
          driveId: photo.driveId || '',
          uploadState: 'uploaded'
        });
      }
      scheduleSave();
      updateSyncStatus('checkpoint');
      return true;
    }
    // Network failure or any error — restore dataUrl and keep for retry
    console.warn('Photo upload failed, keeping in IndexedDB:', e.message, photo.photoId);
    photo.dataUrl = originalDataUrl;
    photo._uploadFailed = true;
    addToPhotoRetryQueue(photo);
    return false;
  }
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
  schedulePhotoRetry(60000);
}

export function queuePhotoForBackgroundUpload(photo) {
  addToPhotoRetryQueue(photo);
  schedulePhotoRetry(1000);
}

export function schedulePhotoRetry(delayMs) {
  const dueAt = Date.now() + Math.max(0, delayMs || 0);
  if (_photoRetryTimer && _photoRetryDueAt <= dueAt) return;
  if (_photoRetryTimer) clearTimeout(_photoRetryTimer);
  _photoRetryDueAt = dueAt;
  _photoRetryTimer = setTimeout(function() {
    _photoRetryTimer = null;
    _photoRetryDueAt = 0;
    retryFailedPhotos({ limit: PHOTO_BACKGROUND_RETRY_LIMIT, quiet: true });
  }, Math.max(0, dueAt - Date.now()));
}

export async function retryFailedPhotos(options) {
  const opts = options || {};
  const inspection = getInspection();
  if (!inspection || !GOOGLE_SCRIPT_URL || !navigator.onLine) return;
  if (_photoRetryInProgress || _bulkPhotoUploadInProgress) return;
  const queue = (inspection._photoRetryQueue || []).filter(photoNeedsUpload);
  if (!queue.length) return;

  _photoRetryInProgress = true;
  const limit = Number.isFinite(opts.limit) ? opts.limit : queue.length;
  const batch = queue.slice(0, Math.max(1, limit));
  if (!opts.quiet) updateSyncStatus('syncing');
  let confirmed = 0;
  try {
    for (const photo of batch) {
      try {
        await uploadPhotoImmediate(photo, inspection.inspectionId, inspection.clientName, inspection.propertyAddress);
        if (photo._driveConfirmed) {
          inspection._photoRetryQueue = (inspection._photoRetryQueue || []).filter(function(p) { return p.photoId !== photo.photoId; });
          confirmed++;
        }
      } catch(e) { /* keep in queue */ }
    }
  } finally {
    _photoRetryInProgress = false;
  }
  if (confirmed > 0) {
    scheduleSave();
    updateSyncStatus('checkpoint', 'photos +' + confirmed);
  }
  if ((inspection._photoRetryQueue || []).length > 0) schedulePhotoRetry(60000);
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
    const { checkSupabaseConfirmed } = await import('./supabase-photos.js?v=167');
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

function getMirrorInspectionName(exportData, inspection) {
  return (inspection && (inspection.inspectionName || inspection.folderName || inspection.assessmentName)) ||
    exportData.inspectionName ||
    exportData.folderName ||
    exportData.assessmentName ||
    [exportData.clientName, exportData.propertyAddress].filter(Boolean).join(' - ') ||
    exportData.inspectionId ||
    '';
}

async function mirrorSupabasePhotosToDrive(exportData, inspection) {
  showUploadBanner('pending', 'Mirroring photos to Drive…');
  const result = await mirrorPhotosToDrive({
    inspectionId: exportData.inspectionId,
    inspectionName: getMirrorInspectionName(exportData, inspection),
    driveFolderId: getKnownDriveFolderId(inspection, exportData)
  });
  if (result && result.mirrored > 0) {
    showUploadBanner('success', 'Mirrored ' + result.mirrored + ' photo' + (result.mirrored === 1 ? '' : 's') + ' to Drive');
  }
  return result;
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

// NOTE: Photos are uploaded to Drive as private files.
// The Apps Script must call setSharing(ANYONE_WITH_LINK, VIEW) on each file
// for the review portal to display them. This is a known workaround - see issue tracker.
export async function sendToGoogleScript(exportData) {
  const inspection = getInspection();
  // Always strip photos from main payload - send data first, then photos separately
  const mainPayload = stripPhotosFromExport(exportData);
  const mainPayloadFingerprint = payloadFingerprint(mainPayload);
  const allPhotos = extractAllPhotosFromExport(exportData);
  const photosToUpload = allPhotos.filter(photoNeedsUpload);

  if (photosToUpload.length > 0 && !USE_SUPABASE_PHOTOS) {
    // [RETIRED] Guard: this block should never run when USE_SUPABASE_PHOTOS=true.
    console.warn('[RETIRED] Apps Script photo path triggered — should not happen with USE_SUPABASE_PHOTOS=true');
    await recoverDriveMetadataFromReviewApi(exportData.inspectionId, mainPayloadFingerprint);
  }

  // Always resend inspection JSON during final submit/retry. Local sync flags can
  // survive a stale or retired deployment and falsely claim the server has the
  // assessment. The Apps Script folder/sheet path and Supabase write are
  // idempotent, so a confirmed server round-trip is safer than trusting local state.
  const mainResult = await scriptFetch(mainPayload);
  rememberDriveResult(mainResult, mainPayloadFingerprint, 'main-sync');

  if (USE_SUPABASE_PHOTOS) {
    // Always run — the flush pulls from the vault too, so it catches photos whose
    // pixels never made it into the export.
    await uploadPhotosViaSupabase(photosToUpload, exportData, inspection);
    await mirrorSupabasePhotosToDrive(exportData, inspection);
    const verified = await verifyFinalSync(exportData, allPhotos, inspection);
    if (inspection) {
      inspection._lastServerVerification = verified;
      inspection._lastServerVerifiedAt = new Date().toISOString();
      scheduleSave();
    }
  } else if (photosToUpload.length > 0) {
    // [RETIRED] Guard: this block should never run when USE_SUPABASE_PHOTOS=true.
    console.warn('[RETIRED] Apps Script photo path triggered — should not happen with USE_SUPABASE_PHOTOS=true');
    showUploadBanner('pending', 'Uploading ' + photosToUpload.length + ' photo' + (photosToUpload.length === 1 ? '' : 's') + '\u2026');
    let confirmedCount = 0;
    const missingPhotos = [];
    let workingPhotoFolderLookupId = inspection && inspection._photoFolderLookupId;
    _bulkPhotoUploadInProgress = true;
    try {
      for (let start = 0; start < photosToUpload.length; start += PHOTO_UPLOAD_BATCH_SIZE) {
        const batch = photosToUpload
          .slice(start, start + PHOTO_UPLOAD_BATCH_SIZE)
          .map(normalizePhotoForUpload);
        const end = start + batch.length;
        updateSyncStatus('syncing', 'photos ' + end + '/' + photosToUpload.length);
        showUploadBanner(
          'pending',
          'Uploading photos ' + (start + 1) + '-' + end + ' of ' + photosToUpload.length + '\u2026'
        );

        const batchFolderId = getKnownDriveFolderId(inspection, exportData);
        const photoPayload = {
          photoUploadOnly: true,
          inspectionId: exportData.inspectionId,
          sourceInspectionId: exportData.inspectionId,
          clientName: exportData.clientName,
          propertyAddress: exportData.propertyAddress,
          folderId: batchFolderId,
          driveFolderId: batchFolderId,
          folderUrl: getKnownDriveFolderUrl(inspection, exportData),
          photos: batch
        };
        const folderLookupKeys = getPhotoFolderLookupKeys(inspection, exportData);
        if (workingPhotoFolderLookupId) {
          folderLookupKeys.sort(function(a, b) {
            if (a === workingPhotoFolderLookupId) return -1;
            if (b === workingPhotoFolderLookupId) return 1;
            return 0;
          });
        }

        let photoResult;
        try {
          const uploadResult = await uploadPhotoBatchWithFolderFallback(photoPayload, folderLookupKeys);
          photoResult = uploadResult.result;
          workingPhotoFolderLookupId = uploadResult.lookupKey;
          if (inspection && workingPhotoFolderLookupId && workingPhotoFolderLookupId !== exportData.inspectionId) {
            inspection._photoFolderLookupId = workingPhotoFolderLookupId;
          }
        } catch (err) {
          if (isPhotoLogAlreadyExistsError(err)) {
            console.warn('Photo batch uploaded but Photo Log append collided; marking batch confirmed:', err.message);
            photoResult = syntheticConfirmedPhotoResult(
              batch,
              exportData.inspectionId,
              'photo_log_already_exists'
            );
          } else {
            const remaining = photosToUpload.slice(start);
            queueUnconfirmedLocalPhotos(inspection, remaining, err && err.message ? err.message : 'upload_failed');
            throw new Error(
              'Photo upload failed after confirming ' +
              confirmedCount +
              ' of ' + photosToUpload.length + ' photos: ' +
              (err && err.message ? err.message : String(err))
            );
          }
        }

        rememberDriveResult(photoResult, mainPayloadFingerprint, 'photo-upload');
        const confirmedPhotos = getConfirmedPhotoMap(photoResult, batch);
        if (confirmedPhotos.size > 0 && inspection) {
          markConfirmedLocalPhotos(inspection, confirmedPhotos);
          confirmedCount += confirmedPhotos.size;
          scheduleSave();
        }

        const batchMissing = batch.filter(function(photo) {
          return !photo.photoId || !confirmedPhotos.has(photo.photoId);
        });
        if (batchMissing.length > 0) {
          queueUnconfirmedLocalPhotos(inspection, batchMissing, 'not_confirmed_in_drive');
          missingPhotos.push.apply(missingPhotos, batchMissing);
        }

        await new Promise(function(resolve) { setTimeout(resolve, 150); });
      }
    } finally {
      _bulkPhotoUploadInProgress = false;
    }

    if (missingPhotos.length > 0) {
      throw new Error(
        'Photo upload incomplete: confirmed ' +
        (photosToUpload.length - missingPhotos.length) +
        ' of ' + photosToUpload.length + ' photos in Drive'
      );
    }
    if (inspection) scheduleSave();
  }
}

async function fetchCloudInspectionJson(url, context) {
  const resp = await fetch(url.toString(), {
    method: 'GET',
    cache: 'no-store',
    headers: { Accept: 'application/json' }
  });
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
async function loadBridgeCapabilities() {
  if (_bridgeCapabilities) return _bridgeCapabilities;
  try {
    const url = new URL(GOOGLE_SCRIPT_URL);
    url.searchParams.set('action', 'capabilities');
    url.searchParams.set('token', FIELD_RESUME_TOKEN);
    const data = await fetchCloudInspectionJson(url, 'Cloud capabilities');
    _bridgeCapabilities = data.capabilities || {};
  } catch (err) {
    _bridgeCapabilities = {};
  }
  return _bridgeCapabilities;
}

export async function listCloudInspections() {
  if (!GOOGLE_SCRIPT_URL) throw new Error('Cloud inspection service is not configured.');
  const url = new URL(GOOGLE_SCRIPT_URL);
  url.searchParams.set('action', 'list');
  url.searchParams.set('token', FIELD_RESUME_TOKEN);
  const data = await fetchCloudInspectionJson(url, 'Cloud inspection list');
  return Array.isArray(data.inspections) ? data.inspections : [];
}

export async function loadCloudInspection(inspectionId) {
  if (!GOOGLE_SCRIPT_URL) throw new Error('Cloud inspection service is not configured.');
  if (!inspectionId) throw new Error('Missing inspection ID.');
  const url = new URL(GOOGLE_SCRIPT_URL);
  url.searchParams.set('action', 'get');
  url.searchParams.set('id', inspectionId);
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

export async function checkpointToCloud(stepList) {
  const inspection = getInspection();
  if (!inspection || !GOOGLE_SCRIPT_URL) return;
  if (!navigator.onLine) {
    updateSyncStatus('offline');
    return;
  }
  if (Array.isArray(stepList)) _lastCheckpointStepList = stepList;
  setLastCheckpointAttemptAt(Date.now()); // Change 1
  try {
    ensureInspectionWorkspace(inspection);
    let usedServerTeamMerge = false;
    if (inspection.collaboration?.enabled && inspection.inspectionId) {
      const capabilities = await loadBridgeCapabilities();
      if (capabilities.teamFieldMerge === true) {
        const teamExport = buildExportJSON(Array.isArray(stepList) ? stepList : _lastCheckpointStepList);
        const teamPayload = stripPhotosFromExport(teamExport);
        teamPayload._checkpoint = true;
        updateSyncStatus('syncing');
        const teamResult = await scriptFetch({
          action: 'teamMerge',
          token: FIELD_RESUME_TOKEN,
          inspection: teamPayload
        });
        if (teamResult.inspection) mergeRemoteInspection(inspection, teamResult.inspection);
        if (teamResult.resumeData) mergeRemoteInspection(inspection, teamResult.resumeData);
        scheduleSave();
        usedServerTeamMerge = true;
      } else {
        try {
          const cloudRecord = await loadCloudInspection(inspection.inspectionId);
          if (cloudRecord?.resumeData) {
            mergeRemoteInspection(inspection, cloudRecord.resumeData);
            scheduleSave();
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
      updateSyncStatus('checkpoint');
      schedulePhotoRetry(1000);
      return true;
    }
    const exportData = buildExportJSON(Array.isArray(stepList) ? stepList : _lastCheckpointStepList);
    const payload = stripPhotosFromExport(exportData);
    payload._checkpoint = true;
    updateSyncStatus('syncing'); // Change 2
    const result = await scriptFetch(payload);
    rememberDriveResult(result, payloadFingerprint(payload), 'checkpoint');
    setLastCheckpointSucceededAt(Date.now()); // Change 1
    scheduleSave();
    _checkpointFailCount = 0; // reset on success
    updateSyncStatus('checkpoint'); // Change 2
    schedulePhotoRetry(1000);
    return true;
  } catch (e) {
    console.log('Checkpoint sync skipped:', e);
    _checkpointFailCount++;
    const errorMsg = e && e.message ? e.message : String(e || 'Unknown error');
    updateSyncStatus('failed', errorMsg); // Change 2
    // After 3 consecutive failures show a modal — data is not backed up
    if (_checkpointFailCount >= 3) {
      const lastOk = getBestCloudSyncAt ? getBestCloudSyncAt() : null;
      const minAgo = lastOk ? Math.round((Date.now() - lastOk) / 60000) : null;
      const msg = 'Your inspection data is NOT being backed up to the cloud.\n\n' +
        (minAgo !== null ? 'Last successful backup: ' + minAgo + ' min ago.\n\n' : 'No successful backup yet.\n\n') +
        'Last error: ' + errorMsg + '\n\n' +
        'Keep this app open and on screen. Do not force-close your browser.\n\nTap OK to retry.';
      if (confirm(msg)) { checkpointToCloud(stepList); }
    }
    return false;
  }
}

export async function submitInspection(exportData) {
  if (!GOOGLE_SCRIPT_URL) return true;
  updateSyncStatus('syncing'); // Change 2
  showUploadBanner('pending', 'Saving assessment to cloud\u2026');
  try {
    const activeInspection = getInspection();
    if (activeInspection?.collaboration?.enabled && activeInspection.inspectionId) {
      try {
        const cloudRecord = await loadCloudInspection(activeInspection.inspectionId);
        if (cloudRecord?.resumeData) {
          mergeRemoteInspection(activeInspection, cloudRecord.resumeData);
          scheduleSave();
          exportData = buildExportJSON(_lastCheckpointStepList);
        }
      } catch (mergeErr) {
        console.warn('Final team merge pull skipped:', mergeErr);
      }
    }
    await sendToGoogleScript(exportData);
    await window.DB.removeFromQueue(exportData.inspectionId);
    setLastSuccessfulCloudSyncAt(Date.now()); // Change 1
    const inspection = getInspection();
    if (inspection) {
      inspection._lastFinalSyncError = '';
      scheduleSave();
    }
    updateSyncStatus('synced'); // Change 2
    showUploadBanner('success', '\u2713 Cloud save verified');
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
