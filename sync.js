// InHaus Inspector - Sync & Upload Logic
import { GOOGLE_SCRIPT_URL, SYNC_SECRET } from './config.js';
import { getInspection, getSyncStatus, setSyncStatus, setLastSaveText,
         getLastSuccessfulCloudSyncAt, setLastSuccessfulCloudSyncAt,
         getLastCheckpointAttemptAt, setLastCheckpointAttemptAt,
         getLastCheckpointSucceededAt, setLastCheckpointSucceededAt } from './state.js';
import { scheduleSave } from './storage.js';
import { buildExportJSON, stripPhotosFromExport, extractAllPhotosFromExport } from './inspection.js';

// Wrapper: always injects the sync secret into the JSON body so Apps Script
// can authenticate the request without CORS-breaking custom headers.
export async function scriptFetch(payload) {
  const body = Object.assign({}, payload, { '_apiKey': SYNC_SECRET });
  const resp = await fetch(GOOGLE_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify(body)
  });
  if (!resp.ok) throw new Error('HTTP ' + resp.status);
  return resp.json();
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
      saveEl.onclick = function() { checkpointToCloud(); updateSyncStatus('syncing'); };
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
      banner.onclick = function() { banner.remove(); checkpointToCloud(); updateSyncStatus('syncing'); };
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
  if (!GOOGLE_SCRIPT_URL || !inspectionId) return;
  if (!photo.dataUrl || photo.dataUrl === '__uploaded__') return;
  const originalDataUrl = photo.dataUrl;

  const payload = {
    photoUploadOnly: true,
    inspectionId: inspectionId,
    clientName: clientName || '',
    propertyAddress: propertyAddress || '',
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
    return scriptFetch(payload);
  }

  try {
    const result = await doUpload();
    const returnedPhoto = result && result.photos && result.photos[0];
    const confirmedDriveUrl = returnedPhoto && returnedPhoto.driveUrl;

    if (result && result.photosUploaded > 0 && confirmedDriveUrl) {
      // SAFE TO CLEAR: Drive confirmed receipt AND returned a retrievable URL
      photo.driveUrl = confirmedDriveUrl;
      photo.driveId  = returnedPhoto.driveId || '';
      photo._driveConfirmed = true;
      photo._uploaded = true;
      photo.dataUrl = '__uploaded__'; // only cleared AFTER driveUrl is stored
      scheduleSave();
      updateSyncStatus('checkpoint');
    } else if (result && result.photosUploaded > 0 && !confirmedDriveUrl) {
      // Drive uploaded but didn't return a URL — keep dataUrl, mark for investigation
      // Photo is safe on device until we can confirm it's retrievable
      console.warn('Photo uploaded but no driveUrl returned — retaining local copy', photo.photoId);
      photo._uploadFailed = true;
      photo._uploadWarning = 'no_drive_url';
      addToPhotoRetryQueue(photo);
    } else {
      // Drive returned OK but 0 photos — keep for retry
      console.warn('Photo upload returned 0 — keeping in IndexedDB for retry', photo.photoId);
      photo._uploadFailed = true;
      addToPhotoRetryQueue(photo);
    }
  } catch(e) {
    // Network failure or any error — restore dataUrl and keep for retry
    console.warn('Photo upload failed, keeping in IndexedDB:', e.message, photo.photoId);
    photo.dataUrl = originalDataUrl;
    photo._uploadFailed = true;
    addToPhotoRetryQueue(photo);
  }
}

export function addToPhotoRetryQueue(photo) {
  const inspection = getInspection();
  if (!inspection) return;
  if (!inspection._photoRetryQueue) inspection._photoRetryQueue = [];
  const already = inspection._photoRetryQueue.find(function(p) { return p.photoId === photo.photoId; });
  if (!already) inspection._photoRetryQueue.push(photo);
  scheduleSave();
}

export async function retryFailedPhotos() {
  const inspection = getInspection();
  if (!inspection || !GOOGLE_SCRIPT_URL || !navigator.onLine) return;
  const queue = (inspection._photoRetryQueue || []).filter(function(p) { return p.dataUrl && p.dataUrl !== '__uploaded__'; });
  if (!queue.length) return;

  updateSyncStatus('syncing');
  let confirmed = 0;
  for (const photo of queue) {
    try {
      await uploadPhotoImmediate(photo, inspection.inspectionId, inspection.clientName, inspection.propertyAddress);
      if (photo._driveConfirmed) {
        inspection._photoRetryQueue = (inspection._photoRetryQueue || []).filter(function(p) { return p.photoId !== photo.photoId; });
        confirmed++;
      }
    } catch(e) { /* keep in queue */ }
  }
  if (confirmed > 0) scheduleSave();
}

// NOTE: Photos are uploaded to Drive as private files.
// The Apps Script must call setSharing(ANYONE_WITH_LINK, VIEW) on each file
// for the review portal to display them. This is a known workaround - see issue tracker.
export async function sendToGoogleScript(exportData) {
  const inspection = getInspection();
  // Always strip photos from main payload - send data first, then photos separately
  const mainPayload = stripPhotosFromExport(exportData);
  const allPhotos = extractAllPhotosFromExport(exportData);

  await scriptFetch(mainPayload);

  if (allPhotos.length > 0) {
    const photoPayload = {
      photoUploadOnly: true,
      inspectionId: exportData.inspectionId,
      clientName: exportData.clientName,
      propertyAddress: exportData.propertyAddress,
      photos: allPhotos
    };
    showUploadBanner('pending', 'Uploading photos\u2026');
    try {
      const photoResult = await scriptFetch(photoPayload);
      if (photoResult && photoResult.photosUploaded > 0 && inspection) {
        // Mark all remaining local photos as confirmed in Drive
        function markAllPhotosConfirmed(photoArr) {
          if (!Array.isArray(photoArr)) return;
          photoArr.forEach(function(p) {
            if (p && p.dataUrl && p.dataUrl !== '__uploaded__') {
              p._driveConfirmed = true;
              p._uploaded = true;
              p.dataUrl = '__uploaded__';
            }
          });
        }
        if (inspection.stepData) {
          Object.values(inspection.stepData).forEach(function(stepData) {
            Object.values(stepData).forEach(function(v) {
              if (Array.isArray(v) && v.length && v[0] && typeof v[0].photoId === 'string') {
                markAllPhotosConfirmed(v);
              }
            });
          });
        }
        if (inspection.sparePhotos) markAllPhotosConfirmed(inspection.sparePhotos);
        inspection._photoRetryQueue = [];
        scheduleSave();
      }
    } catch(e) {
      console.warn('Photo bulk upload error:', e.message);
    }
  }
}

// ── Step Checkpoint Sync ────────────────────────────
// Fire-and-forget backup after each step completes.
// Silent on failure - close-out export is still the authoritative save.
let _checkpointFailCount = 0;

export async function checkpointToCloud(stepList) {
  const inspection = getInspection();
  if (!inspection || !GOOGLE_SCRIPT_URL || !navigator.onLine) return;
  setLastCheckpointAttemptAt(Date.now()); // Change 1
  try {
    const exportData = buildExportJSON(stepList);
    const payload = stripPhotosFromExport(exportData);
    payload._checkpoint = true;
    updateSyncStatus('syncing'); // Change 2
    await scriptFetch(payload);
    setLastCheckpointSucceededAt(Date.now()); // Change 1
    _checkpointFailCount = 0; // reset on success
    updateSyncStatus('checkpoint'); // Change 2
  } catch (e) {
    console.log('Checkpoint sync skipped:', e);
    _checkpointFailCount++;
    updateSyncStatus('failed'); // Change 2
    // After 3 consecutive failures show a modal — data is not backed up
    if (_checkpointFailCount >= 3) {
      const lastOk = getLastCheckpointSucceededAt ? getLastCheckpointSucceededAt() : null;
      const minAgo = lastOk ? Math.round((Date.now() - lastOk) / 60000) : null;
      const msg = 'Your inspection data is NOT being backed up to the cloud.\n\n' +
        (minAgo !== null ? 'Last successful backup: ' + minAgo + ' min ago.\n\n' : 'No successful backup yet.\n\n') +
        'Keep this app open and on screen. Do not force-close your browser.\n\nTap OK to retry.';
      if (confirm(msg)) { checkpointToCloud(stepList); }
    }
  }
}

export async function submitInspection(exportData) {
  if (!GOOGLE_SCRIPT_URL) return true;
  updateSyncStatus('syncing'); // Change 2
  showUploadBanner('pending', 'Uploading to Google Drive\u2026');
  try {
    await sendToGoogleScript(exportData);
    await DB.removeFromQueue(exportData.inspectionId);
    setLastSuccessfulCloudSyncAt(Date.now()); // Change 1
    updateSyncStatus('synced'); // Change 2
    showUploadBanner('success', '\u2713 Saved to Google Drive');
    // Auto-disable Dev Mode after successful final sync
    if (localStorage.getItem('inhausDevMode') === 'true') {
      localStorage.setItem('inhausDevMode', 'false');
      console.log('Dev Mode auto-disabled after successful final sync');
    }
    return true;
  } catch (e) {
    console.log('Upload failed, queuing for retry:', e);
    await DB.queueUpload(exportData);
    updateSyncStatus('failed'); // Change 2
    showUploadBanner('pending', 'Saved locally \u2014 will upload when online');
    return false;
  }
}
