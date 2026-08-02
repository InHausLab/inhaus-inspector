// InHaus Inspector - Main Application
import { PHOTO_WORKER_URL } from './config.js?v=225';
import { getInspection, setInspection, getScreen, setScreen, getSyncStatus, setSyncStatus, isDirty, setDirty, getLastSaveText, setLastSaveText, getLastLocalSaveAt, setLastLocalSaveAt, getLastSuccessfulCloudSyncAt, setLastSuccessfulCloudSyncAt, getLastCheckpointAttemptAt, setLastCheckpointAttemptAt, getLastCheckpointSucceededAt, setLastCheckpointSucceededAt, getBestCloudSyncAt, saveActivePosition, loadActivePosition, clearActivePosition } from './state.js?v=225';
import { initStorage, saveNow, scheduleSave } from './storage.js?v=225';
import { buildExportJSON, stripPhotosFromExport } from './inspection.js?v=225';
import { cloudFetch, updateSyncStatus, showUploadBanner, uploadPhotoImmediate, addToPhotoRetryQueue, queuePhotoForBackgroundUpload, retryFailedPhotos, sendInspectionToCloud, checkpointToCloud, getCheckpointBackoffMs, submitInspection } from './sync.js?v=225';
import { STEP_FIELDS, PHASES, buildStepList, getStepData, getEquipmentFields, validateEquipment, validateStep, warnStep } from './steps.js?v=225';
import { initScreens, render } from './screens.js?v=225';
import { initAppFeedback } from './feedback.js?v=225';
import { deletePhotoFromSupabase } from './supabase-photos.js?v=225';

(function () {
  'use strict';

  const { el, renderField, renderProgressBar, renderStatusBar, renderTimersBar, renderCheck, fmtDate, showToast, flashUncheckedItems, updateShowIf } = UI;

  // ── Auto-sync version badge from service worker ────────────
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.ready.then(reg => {
      const swURL = reg.active && reg.active.scriptURL;
      if (swURL) {
        fetch(swURL).then(r => r.text()).then(txt => {
          const m = txt.match(/CACHE_NAME\s*=\s*['"]([^'"]+)['"]/);
          if (m) {
            const v = m[1].replace('inhaus-', '');
            const badge = document.getElementById('version-badge');
            if (badge) badge.textContent = v;
          }
        }).catch(() => {});
      }
    });
  }

  // Field definition helpers, reusable field groups, OBS_TAGS → moved to fields.js
  // Step definitions, STEP_FIELDS, PHASES → moved to steps.js
  // ── State ──────────────────────────────────────────────────
  // inspection is owned by state.js — local alias kept for read-site compatibility
  let inspection = getInspection();
  let stepList = [];
  let currentStepIdx = 0;
  let _inspectionDirty = false;
  let _autoCheckpointInterval = null;
  const AUTO_CHECKPOINT_INTERVAL_MS = 3 * 60 * 1000;
  // screen moved to state.js
  // Load truck check from localStorage (persists across interruptions, expires at midnight)
  const _truckCheckKey = 'inhausTruckCheck_' + new Date().toISOString().slice(0, 10);
  let _truckCheck = JSON.parse(localStorage.getItem(_truckCheckKey) || '{}');
  // saveTimeout moved to storage.js
  // lastSaveText moved to state.js

  // Sync state timestamps moved to state.js
  // lastSuccessfulCloudSyncAt, lastCheckpointAttemptAt, lastCheckpointSucceededAt → state.js
  let _finalSyncTriggeredId = null;      // tracks which inspection triggered final sync

  const root = document.getElementById('app');
  window.deletePhotoFromSupabase = deletePhotoFromSupabase;
  const RESTORABLE_SCREENS = new Set([
    'truck-check', 'intake', 'cloud-resume', 'precheck', 'step',
    'photos', 'rapid-capture', 'findings', 'team', 'my-work', 'recovery'
  ]);

  function clampStepIndex(idx) {
    return Math.max(0, Math.min(Number(idx) || 0, Math.max(stepList.length - 1, 0)));
  }

  function lastWorkingStepIndex(preferredIdx) {
    let idx = clampStepIndex(preferredIdx);
    if (stepList[idx] && stepList[idx].type !== 'review') return idx;
    idx = clampStepIndex(inspection && inspection._lastStepIdx);
    if (stepList[idx] && stepList[idx].type !== 'review') return idx;
    for (let i = stepList.length - 1; i >= 0; i--) {
      if (stepList[i] && stepList[i].type !== 'review') return i;
    }
    return 0;
  }

  function persistActivePosition() {
    if (!inspection) return false;
    let resumeScreen = getScreen();
    let resumeStepIdx = currentStepIdx;
    // Home and Final Review are summary/exit surfaces, not field work positions.
    // Never let them overwrite the inspector's last actual step.
    if (resumeScreen === 'home' || resumeScreen === 'review') {
      resumeScreen = 'step';
      resumeStepIdx = lastWorkingStepIndex(inspection._lastStepIdx);
    } else {
      resumeStepIdx = lastWorkingStepIndex(resumeStepIdx);
    }
    const resumeStep = stepList[resumeStepIdx];
    return saveActivePosition(inspection, resumeStepIdx, resumeScreen, resumeStep && resumeStep.id);
  }

  async function restoreActivePosition(expectedInspectionId) {
    const saved = loadActivePosition();
    if (expectedInspectionId && (!saved || saved.inspectionId !== expectedInspectionId)) return false;
    if (!saved || !window.DB || !window.DB.get) return false;
    try {
      const restored = await window.DB.get(saved.inspectionId);
      if (!restored || restored.status !== 'in-progress' || restored.inspectionId !== saved.inspectionId) {
        clearActivePosition(saved.inspectionId);
        return false;
      }
      inspection = restored;
      setInspection(restored);
      _inspectionDirty = restored._cloudCheckpointDirty === true;
      stepList = buildStepList(restored);
      const stableStepIdx = saved.stepId ? stepList.findIndex(step => step.id === saved.stepId) : -1;
      const savedStepIdx = stableStepIdx >= 0 ? stableStepIdx : saved.stepIdx;
      currentStepIdx = lastWorkingStepIndex(savedStepIdx);
      // Migrate old saved Home/Final Review positions back to the last field step.
      setScreen(RESTORABLE_SCREENS.has(saved.screen) ? saved.screen : 'step');
      persistActivePosition();
      startAutoSave();
      return true;
    } catch (err) {
      console.warn('Could not restore active inspection position:', err);
      return false;
    }
  }

  function markInspectionDirty() {
    if (!inspection) return;
    _inspectionDirty = true;
    inspection._cloudCheckpointDirty = true;
    if (!document.hidden && inspection.status === 'in-progress') startAutoSave();
  }

  async function runAutomaticCheckpoint() {
    if (!inspection || inspection.status !== 'in-progress' || !_inspectionDirty || !navigator.onLine || document.hidden) return false;
    const retryBackoffMs = getCheckpointBackoffMs();
    const lastAttemptAt = getLastCheckpointAttemptAt();
    if (retryBackoffMs && lastAttemptAt && Date.now() - lastAttemptAt < retryBackoffMs) return false;
    const savedInspectionId = inspection.inspectionId;
    const ok = await checkpointToCloud(stepList);
    if (ok && inspection && inspection.inspectionId === savedInspectionId) {
      _inspectionDirty = false;
      inspection._cloudCheckpointDirty = false;
      stopAutoSave();
    }
    return !!ok;
  }

  // ── ID Generator ───────────────────────────────────────────
  function genId() {
    const d = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    return 'INH-' + d + '-' + Math.random().toString(36).substring(2, 8).toUpperCase();
  }

  // buildStepList, STEP_FIELDS, PHASES, validateEquipment, validateStep, warnStep, getStepData → moved to steps.js

  // ── Add Dynamic Room ───────────────────────────────────────
  function addDynamicRoom(section, namePrefix, options) {
    const opts = options || {};
    if (section === 'bedrooms' || section === 'bathrooms') {
      const countKey = section === 'bedrooms' ? 'numberOfBedrooms' : 'numberOfBathrooms';
      const stepPrefix = section === 'bedrooms' ? 'bedroom-' : 'bathroom-';
      const currentCount = Math.max(parseInt(inspection[countKey], 10) || 0, 0);
      inspection[countKey] = String(currentCount + 1);
      const newStepId = stepPrefix + currentCount;
      if (section === 'bathrooms' && opts.relationship) {
        inspection.roomRelationships = inspection.roomRelationships || {};
        inspection.roomRelationships.bathrooms = inspection.roomRelationships.bathrooms || {};
        inspection.roomRelationships.bathrooms[newStepId] = {
          bathroomType: opts.relationship.bathroomType || 'standalone',
          linkedBedroomIds: Array.isArray(opts.relationship.linkedBedroomIds) ? opts.relationship.linkedBedroomIds.slice() : [],
          autoName: opts.relationship.autoName !== false,
          createdAt: new Date().toISOString()
        };
      }
      stepList = buildStepList(inspection);
      const newIdx = stepList.findIndex(step => step.id === newStepId);
      if (newIdx >= 0) currentStepIdx = newIdx;
      saveNow().then(() => { render(); window.scrollTo(0, 0); });
      return newStepId;
    }

    if (!inspection.dynamicRooms) inspection.dynamicRooms = {};
    if (!inspection.dynamicRooms[section]) inspection.dynamicRooms[section] = [];

    const arr = inspection.dynamicRooms[section];
    const idx = arr.length;
    const defaultPrefix = section === 'lowest' ? 'Radon - Room ' : 'Additional Room ';
    const prefix = namePrefix || defaultPrefix;
    const count = namePrefix ? arr.filter(r => r.name && r.name.startsWith(namePrefix)).length + 1 : idx + 1;
    arr.push({ name: prefix + ' ' + count });

    stepList = buildStepList(inspection);
    const newStepId = section === 'lowest' ? 'lowest-room-' + idx : 'additional-' + idx;
    const newIdx = stepList.findIndex(s => s.id === newStepId);
    if (newIdx >= 0) currentStepIdx = newIdx;

    saveNow().then(() => { render(); window.scrollTo(0, 0); });
    return newStepId;
  }

  // showUploadBanner, uploadPhotoImmediate, addToPhotoRetryQueue, retryFailedPhotos,
  // Cloud save, checkpoint, and submit functions live in sync.js.
  window.uploadPhotoImmediate = uploadPhotoImmediate;
  window.retryFailedPhotos = retryFailedPhotos;
  window.queuePhotoForBackgroundUpload = queuePhotoForBackgroundUpload;

  function visitInspectionPhotos(insp, callback) {
    const seen = new Set();
    function walk(obj, path) {
      if (!obj || typeof obj !== 'object' || seen.has(obj)) return;
      seen.add(obj);
      if (Array.isArray(obj)) {
        if (obj.length && obj[0] && typeof obj[0].photoId === 'string') {
          obj.forEach(function(photo, idx) { callback(photo, path + '[' + idx + ']'); });
        } else {
          obj.forEach(function(item, idx) { walk(item, path + '[' + idx + ']'); });
        }
        return;
      }
      Object.keys(obj).forEach(function(key) {
        if (key === '_photoRetryQueue') return;
        walk(obj[key], path ? path + '.' + key : key);
      });
    }
    walk(insp, 'inspection');
  }

  async function hydrateInspectionPhotosFromVault(insp) {
    if (!insp || !window.DB || !window.DB.getPhoto) return { recovered: 0, vaulted: 0 };
    let recovered = 0;
    let vaulted = 0;
    let changed = false;
    const photos = [];
    visitInspectionPhotos(insp, function(photo) { if (photo && photo.photoId) photos.push(photo); });
    for (const photo of photos) {
      try {
        const vaultedPhoto = await window.DB.getPhoto(photo.photoId);
        if (vaultedPhoto) {
          vaulted++;
          if ((!photo.dataUrl || photo.dataUrl === '__uploaded__') && !photo.driveUrl && vaultedPhoto.dataUrl) {
            photo.dataUrl = vaultedPhoto.dataUrl;
            recovered++;
            changed = true;
          }
          if (!photo.thumbnailDataUrl && vaultedPhoto.thumbnailDataUrl) { photo.thumbnailDataUrl = vaultedPhoto.thumbnailDataUrl; changed = true; }
          if (!photo.driveUrl && vaultedPhoto.driveUrl) { photo.driveUrl = vaultedPhoto.driveUrl; changed = true; }
          if (!photo.driveId && vaultedPhoto.driveId) { photo.driveId = vaultedPhoto.driveId; changed = true; }
          photo._vaultSaved = !!vaultedPhoto.dataUrl;
        } else if (photo.dataUrl && photo.dataUrl !== '__uploaded__' && window.DB.savePhoto) {
          await window.DB.savePhoto({
            photoId: photo.photoId,
            inspectionId: insp.inspectionId,
            roomName: photo.roomName || '',
            stepName: photo.stepName || '',
            caption: photo.caption || '',
            timestamp: photo.timestamp || new Date().toISOString(),
            dataUrl: photo.dataUrl,
            thumbnailDataUrl: photo.thumbnailDataUrl || '',
            driveUrl: photo.driveUrl || '',
            driveId: photo.driveId || '',
            uploadState: photo.driveUrl || photo.driveId ? 'uploaded' : 'local'
          });
          photo._vaultSaved = true;
          changed = true;
          vaulted++;
        }
      } catch (err) {
        console.warn('Photo vault hydrate failed:', err);
      }
    }
    if (changed) scheduleSave();
    return { recovered, vaulted };
  }

  // A photo is safely uploaded when cloud storage or a prior Drive artifact confirms it.
  function photoIsCloudConfirmed(p, vaulted) {
    return !!(p && (p._driveConfirmed === true || p._uploaded === true || p.driveUrl || p.driveId || p.storagePath)) ||
           !!(vaulted && (vaulted.driveUrl || vaulted.driveId || vaulted.storagePath ||
              vaulted.uploadState === 'stored' || vaulted.uploadState === 'uploaded'));
  }

  async function getPhotoHealth() {
    const insp = inspection || getInspection();
    if (!insp) return { total: 0, local: 0, cloud: 0, pending: 0, missing: 0, vaultOnly: 0 };
    await hydrateInspectionPhotosFromVault(insp);
    const vaultPhotos = window.DB && window.DB.getPhotosForInspection
      ? await window.DB.getPhotosForInspection(insp.inspectionId)
      : [];
    const vaultMap = new Map(vaultPhotos.map(function(p) { return [p.photoId, p]; }));
    const seen = new Set();
    const result = { total: 0, local: 0, cloud: 0, pending: 0, missing: 0, vaultOnly: 0 };
    visitInspectionPhotos(insp, function(photo) {
      if (!photo || !photo.photoId) return;
      seen.add(photo.photoId);
      result.total++;
      const vaultedPhoto = vaultMap.get(photo.photoId);
      const hasLocal = !!((photo.dataUrl && photo.dataUrl !== '__uploaded__') || (vaultedPhoto && vaultedPhoto.dataUrl));
      const hasCloud = photoIsCloudConfirmed(photo, vaultedPhoto);
      if (hasLocal) result.local++;
      if (hasCloud) result.cloud++;
      if (!hasCloud && hasLocal) result.pending++;
      if (!hasCloud && !hasLocal) result.missing++;
    });
    vaultPhotos.forEach(function(p) {
      if (p && p.photoId && !seen.has(p.photoId) && p.dataUrl) result.vaultOnly++;
    });
    return result;
  }

  function escapeHtml(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function(ch) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch];
    });
  }

  async function exportLocalPhotoBackup() {
    const insp = inspection || getInspection();
    if (!insp || !window.DB || !window.DB.getPhotosForInspection) {
      alert('No inspection photo vault is available yet.');
      return false;
    }
    await withTimeout(hydrateInspectionPhotosFromVault(insp), 15000, 'Photo recovery');
    const photos = await withTimeout(window.DB.getPhotosForInspection(insp.inspectionId), 15000, 'Photo vault read');
    const withImages = photos.filter(function(p) { return p && p.dataUrl; });
    if (!withImages.length) {
      alert('No local photos found in the photo vault for this inspection.');
      return false;
    }
    const html = '<!doctype html><html><head><meta charset="utf-8"><title>InHaus Photo Backup</title>' +
      '<meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;margin:18px;background:#f7f7f4;color:#20311d}.photo{break-inside:avoid;background:white;border:1px solid #dde5d8;border-radius:8px;padding:12px;margin:0 0 14px}img{max-width:100%;height:auto;border-radius:6px}.meta{font-size:13px;color:#51614b;line-height:1.5}</style></head><body>' +
      '<h1>InHaus Photo Backup</h1><p>Inspection: ' + escapeHtml(insp.inspectionId) + '<br>Address: ' + escapeHtml(insp.propertyAddress || '') + '<br>Saved: ' + escapeHtml(new Date().toLocaleString()) + '</p>' +
      withImages.map(function(p, idx) {
        return '<div class="photo"><h2>Photo ' + (idx + 1) + '</h2><div class="meta">' +
          'Room: ' + escapeHtml(p.roomName || '') + '<br>Step: ' + escapeHtml(p.stepName || '') + '<br>Caption: ' + escapeHtml(p.caption || '') + '<br>Taken: ' + escapeHtml(p.timestamp || '') +
          '</div><p><a download="inhaus-' + escapeHtml(p.photoId) + '.jpg" href="' + p.dataUrl + '">Download this photo</a></p><img src="' + p.dataUrl + '"></div>';
      }).join('') + '</body></html>';
    const blob = new Blob([html], { type: 'text/html' });
    const filename = 'inhaus-photo-backup-' + insp.inspectionId + '.html';
    const file = new File([blob], filename, { type: 'text/html' });
    try {
      if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: 'InHaus Photo Backup' });
        return true;
      }
    } catch (shareErr) {
      if (shareErr && shareErr.name === 'AbortError') return false;
      console.warn('Photo backup share failed:', shareErr);
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function() { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
    return true;
  }

  async function runCloudPreflight() {
    const insp = inspection || getInspection();
    if (!insp || !PHOTO_WORKER_URL) return { ok: false, message: 'No active inspection' };
    try {
      updateSyncStatus('syncing', 'cloud check');
      const exportData = buildExportJSON(stepList);
      const payload = stripPhotosFromExport(exportData);
      payload._checkpoint = true;
      payload._preflight = true;
      await cloudFetch(payload);
      setLastCheckpointSucceededAt(Date.now());
      scheduleSave();
      updateSyncStatus('checkpoint', 'cloud ready');
      return { ok: true };
    } catch (err) {
      const message = err && err.message ? err.message : String(err);
      updateSyncStatus('failed', message);
      return { ok: false, message };
    }
  }

  window.getPhotoHealth = getPhotoHealth;
  window.exportLocalPhotoBackup = exportLocalPhotoBackup;
  window.runCloudPreflight = runCloudPreflight;
  window.hydrateInspectionPhotosFromVault = hydrateInspectionPhotosFromVault;

  function withTimeout(promise, ms, label) {
    var timeoutId;
    var timeout = new Promise(function(_, reject) {
      timeoutId = setTimeout(function() {
        reject(new Error((label || 'Operation') + ' timed out'));
      }, ms);
    });
    return Promise.race([promise, timeout]).finally(function() {
      clearTimeout(timeoutId);
    });
  }

  // ── Final Sync (Changes 3 & 4) ─────────────────────────────
  async function triggerFinalSync() {
    showFinalSyncOverlay('syncing');
    let exportData = null;
    try {
      await withTimeout(hydrateInspectionPhotosFromVault(inspection), 15000, 'Photo recovery');
      // Final sync owns photo upload so it can avoid overlapping retry jobs.

      // ── PHOTO INTEGRITY GATE ──────────────────────────────────────
      // Any photo with neither cloud confirmation nor local pixels is lost.
      // Block the sync and show a hard error so the inspector knows.
      const audit = auditPhotos(inspection);
      if (audit.lost.length > 0) {
        var lostDesc = audit.lost.map(function(p) {
          return (p.roomName || p.context) + (p.caption ? ' — ' + p.caption : '');
        }).join('\n');
        showFinalSyncOverlay('photo-error', {
          lostPhotos: audit.lost,
          lostDesc: lostDesc
        });
        return; // do NOT proceed with sync
      }
      // ───────────────────────────────────────────────────────

      exportData = buildExportJSON(stepList);
      const success = await withTimeout(submitInspection(exportData), 600000, 'Final sync');
      const receipt = buildSyncReceipt(exportData, success);
      if (success) {
        setLastSuccessfulCloudSyncAt(Date.now());
        updateSyncStatus('synced');
        showFinalSyncOverlay('success', receipt);
      } else {
        updateSyncStatus('final-failed');
        showFinalSyncOverlay('failed', receipt);
      }
    } catch(e) {
      console.error('triggerFinalSync error:', e);
      updateSyncStatus('final-failed');
      const failedReceipt = buildSyncReceipt(exportData || buildExportJSON(stepList), false);
      failedReceipt.errorMessage = e && e.message ? e.message : String(e || 'Unknown error');
      showFinalSyncOverlay('failed', failedReceipt);
    }
  }

  function showFinalSyncOverlay(state, receipt) {
    var existing = document.getElementById('final-sync-overlay');
    if (existing) existing.remove();

    var overlay = document.createElement('div');
    overlay.id = 'final-sync-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:100000;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px;font-family:inherit;box-sizing:border-box;';

    function receiptCard(r) {
      if (!r) return '';
      return '<div style="background:rgba(255,255,255,0.15);border-radius:12px;padding:16px;margin:12px 0;width:100%;max-width:420px;text-align:left;">' +
        '<div style="color:inherit;font-size:0.85rem;line-height:2;">' +
        '<strong>ID:</strong> ' + (r.inspectionId || '-') + '<br>' +
        '<strong>Time:</strong> ' + r.timestamp + '<br>' +
        '<strong>Rooms:</strong> ' + r.roomCount + '<br>' +
        '<strong>Photos total:</strong> ' + r.photosExpected + '<br>' +
        '<strong>Photos confirmed in cloud:</strong> ' + r.photosUploaded + '<br>' +
        (r.photosUnconfirmed > 0 ? '<span style="color:#ff6b6b;">\u26a0\ufe0f ' + r.photosUnconfirmed + ' photo' + (r.photosUnconfirmed === 1 ? '' : 's') + ' not confirmed \u2014 tap Retry</span><br>' : '') +
        (r.errorMessage ? '<strong>Error:</strong> ' + escapeHtml(r.errorMessage) + '<br>' : '') +
        '<strong>Drive folder:</strong> ' + r.driveFolderId + '<br>' +
        '<strong>App version:</strong> ' + r.appVersion +
        '</div></div>';
    }

    function overlayButton(label, bg, color, onClick) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.style.cssText = 'background:' + bg + ';color:' + color + ';border:none;border-radius:10px;padding:14px 22px;font-size:0.95rem;font-weight:800;cursor:pointer;margin:6px;touch-action:manipulation;font-family:inherit;min-width:138px;';
      btn.textContent = label;
      btn.onclick = onClick;
      return btn;
    }

    function rescueButton(bg, color) {
      return overlayButton('Rescue Photos', bg, color, async function() {
        var btn = this;
        btn.disabled = true;
        btn.textContent = 'Preparing...';
        try {
          var ok = window.exportLocalPhotoBackup ? await window.exportLocalPhotoBackup() : false;
          btn.textContent = ok ? 'Backup Ready' : 'Rescue Photos';
        } catch (err) {
          alert('Photo rescue failed: ' + (err && err.message ? err.message : String(err)));
          btn.textContent = 'Rescue Photos';
        } finally {
          btn.disabled = false;
        }
      });
    }

    if (state === 'syncing') {
      overlay.style.background = 'rgba(0,0,0,0.88)';
      overlay.innerHTML = '<div style="font-size:2.5rem;margin-bottom:16px;">⏳</div>' +
        '<div style="color:#fff;font-size:1.3rem;font-weight:800;text-align:center;">Final sync in progress…</div>' +
        '<div style="color:#ccc;font-size:0.95rem;margin-top:8px;text-align:center;">Do not close the app</div>' +
        '<div id="sync-timeout-msg" style="color:#aaa;font-size:0.85rem;margin-top:16px;text-align:center;display:none;max-width:420px;">Taking longer than expected. You can keep waiting, or dismiss this screen and rescue the local photo backup.</div>' +
        '<div id="sync-timeout-actions" style="display:none;flex-wrap:wrap;justify-content:center;margin-top:12px;width:100%;max-width:420px;"></div>';
      var timeoutActions = overlay.querySelector('#sync-timeout-actions');
      timeoutActions.appendChild(overlayButton('Dismiss to Review', '#fff', '#111827', function() { overlay.remove(); }));
      timeoutActions.appendChild(rescueButton('#f59e0b', '#111827'));
      // Show escape hatch after 45 seconds if still stuck
      setTimeout(function() {
        var msg = document.getElementById('sync-timeout-msg');
        if (msg) msg.style.display = 'block';
        var actions = document.getElementById('sync-timeout-actions');
        if (actions) actions.style.display = 'flex';
      }, 45000);

    } else if (state === 'success') {
      overlay.style.background = '#16a34a';
      overlay.style.color = '#fff';
      overlay.innerHTML = '<div style="font-size:2.5rem;margin-bottom:12px;">✅</div>' +
        '<div style="font-size:1.4rem;font-weight:800;text-align:center;">Final sync complete</div>' +
        '<div style="color:#d1fae5;font-size:0.95rem;margin-top:6px;margin-bottom:4px;text-align:center;">Safe to leave the app</div>' +
        receiptCard(receipt);
      var dismissBtn = document.createElement('button');
      dismissBtn.type = 'button';
      dismissBtn.style.cssText = 'background:#fff;color:#16a34a;border:none;border-radius:10px;padding:14px 36px;font-size:1rem;font-weight:800;cursor:pointer;margin-top:8px;touch-action:manipulation;font-family:inherit;';
      dismissBtn.textContent = 'Dismiss';
      dismissBtn.onclick = function() { overlay.remove(); };
      overlay.appendChild(dismissBtn);

    } else if (state === 'photo-error') {
      // Hard block - photos are lost (no local data or cloud confirmation).
      overlay.style.background = '#7f1d1d';
      overlay.style.color = '#fff';
      var lostCount = receipt && receipt.lostPhotos ? receipt.lostPhotos.length : 0;
      overlay.innerHTML = '📸' +
        '<div style="font-size:1.4rem;font-weight:800;text-align:center;margin-bottom:8px;">PHOTO ERROR — DO NOT CLOSE APP</div>' +
        '<div style="color:#fca5a5;font-size:0.95rem;margin-bottom:16px;text-align:center;">' +
          lostCount + ' photo' + (lostCount === 1 ? '' : 's') + ' cannot be found on the device or in cloud storage.<br>' +
          'Do NOT close this app. Call support now: <a href="tel:+19706183064" style="color:#fff;font-weight:800;">970-618-3064</a>' +
        '</div>' +
        '<div style="background:rgba(0,0,0,0.3);border-radius:8px;padding:12px;width:100%;max-width:420px;font-size:0.82rem;color:#fca5a5;white-space:pre-wrap;">' +
          (receipt && receipt.lostDesc ? receipt.lostDesc : '') +
        '</div>';
      // No dismiss button — inspector must not close the app

    } else { // failed
      overlay.style.background = '#7f1d1d';
      overlay.style.color = '#fff';
      overlay.innerHTML = '<div style="font-size:2.5rem;margin-bottom:12px;">\u274C</div>' +
        '<div style="font-size:1.4rem;font-weight:800;text-align:center;">Final sync FAILED</div>' +
        '<div style="color:#fca5a5;font-size:0.95rem;margin-top:6px;margin-bottom:4px;text-align:center;">Do NOT leave the app yet</div>' +
        receiptCard(receipt);
      var failedActions = document.createElement('div');
      failedActions.style.cssText = 'display:flex;flex-wrap:wrap;justify-content:center;width:100%;max-width:440px;margin-top:8px;';
      failedActions.appendChild(overlayButton('Tap to Retry', '#fff', '#7f1d1d', function() { overlay.remove(); triggerFinalSync(); }));
      failedActions.appendChild(rescueButton('#f59e0b', '#111827'));
      failedActions.appendChild(overlayButton('Dismiss to Review', 'rgba(255,255,255,0.16)', '#fff', function() { overlay.remove(); }));
      overlay.appendChild(failedActions);
    }

    document.body.appendChild(overlay);
    return overlay;
  }

  // ── Photo integrity audit — runs before any final sync —————————————————
  // Rule: every photo must be confirmed in cloud storage or remain recoverable
  // from a non-empty dataUrl on this device.
  // Any photo with neither is LOST and must block the sync with a hard error.
  function auditPhotos(insp) {
    const lost = [];
    const pending = []; // have dataUrl but not yet uploaded
    visitInspectionPhotos(insp, function(p, context) {
      if (!p || !p.photoId) return;
      const hasCloud = photoIsCloudConfirmed(p);
      const hasLocal = p.dataUrl && p.dataUrl !== '__uploaded__';
      if (!hasCloud && !hasLocal) {
        lost.push({ photoId: p.photoId, context, caption: p.caption || '', roomName: p.roomName || '' });
      } else if (!hasCloud && hasLocal) {
        pending.push({ photoId: p.photoId, context });
      }
    });
    return { lost, pending };
  }

  // Change 4: Final sync receipt
  function buildSyncReceipt(exportData, success) {
    var photosExpected = 0;
    var photosUploaded = 0;
    var pendingPhotoIds = new Set();
    if (inspection) visitInspectionPhotos(inspection, function(p) {
      if (!p || !p.photoId) return;
      photosExpected++;
      var hasCloud = photoIsCloudConfirmed(p);
      var hasLocal = !!((p.dataUrl && p.dataUrl !== '__uploaded__') || p._vaultSaved);
      if (hasCloud) photosUploaded++;
      else if (hasLocal) pendingPhotoIds.add(p.photoId);
    });
    if (inspection) {
      (inspection._photoRetryQueue || []).forEach(function(p) {
        if (p && p.photoId && !photoIsCloudConfirmed(p) && p.dataUrl && p.dataUrl !== '__uploaded__') {
          pendingPhotoIds.add(p.photoId);
        }
      });
    }
    var photosUnconfirmed = pendingPhotoIds.size;
    return {
      inspectionId: (exportData && exportData.inspectionId) || (inspection && inspection.inspectionId),
      timestamp: new Date().toLocaleString('en-US', { timeZone: 'America/Denver' }),
      roomCount: (exportData && exportData.rooms ? exportData.rooms.length : 0),
      photosExpected: photosExpected,
      photosUploaded: photosUploaded,
      photosUnconfirmed: photosUnconfirmed,
      driveFolderId: (exportData && (exportData.driveFolderId || exportData.folderId)) ||
        (inspection && (inspection._driveFolderId || inspection.driveFolderId || inspection.folderId)) ||
        'pending',
      errorMessage: success ? '' : ((inspection && inspection._lastFinalSyncError) || ''),
      appVersion: 'v225',
      success: success
    };
  }



  async function retryQueuedUploads() {
    if (!PHOTO_WORKER_URL || !navigator.onLine) return;
    const queue = await window.DB.getQueue();
    for (const item of queue) {
      try {
        await sendInspectionToCloud(item);
        await window.DB.removeFromQueue(item.inspectionId);
      } catch (e) { break; }
    }
  }

  window.addEventListener('online', () => {
    retryQueuedUploads();
    retryFailedPhotos({ automatic: true, limit: 4, quiet: true });
    if (_inspectionDirty) startAutoSave();
  });


  // Render/screen functions → moved to screens.js

  // buildExportJSON, cleanStepData → moved to inspection.js

  // ── Init ───────────────────────────────────────────────────
  initStorage({ onSyncStatusChange: updateSyncStatus, onInspectionDirty: markInspectionDirty });
  initScreens({
    get inspection() { return inspection; },
    set inspection(v) {
      inspection = v;
      _inspectionDirty = !!(v && v._cloudCheckpointDirty === true);
      if (!v) stopAutoSave();
    },
    get stepList() { return stepList; },
    set stepList(v) { stepList = v; },
    get currentStepIdx() { return currentStepIdx; },
    set currentStepIdx(v) { currentStepIdx = v; },
    get _truckCheck() { return _truckCheck; },
    set _truckCheck(v) { _truckCheck = v; },
    get _finalSyncTriggeredId() { return _finalSyncTriggeredId; },
    set _finalSyncTriggeredId(v) { _finalSyncTriggeredId = v; },
    root,
    genId,
    addDynamicRoom,
    triggerFinalSync,
    persistActivePosition,
    restoreActivePosition,
    render,
    startAutoSave,
    stopAutoSave
  });
  initAppFeedback();

  window.addEventListener('online', () => {
    const badge = document.querySelector('.online-badge');
    if (badge) { badge.textContent = ''; badge.className = 'online-badge online'; }
  });
  window.addEventListener('offline', () => {
    const badge = document.querySelector('.online-badge');
    if (badge) { badge.textContent = '\u25cf Offline'; badge.className = 'online-badge offline'; }
    updateSyncStatus('offline'); // Change 2
  });
  window.addEventListener('inhaus-checkpoint-success', () => {
    _inspectionDirty = false;
    if (inspection) inspection._cloudCheckpointDirty = false;
    stopAutoSave();
  });

  window.addEventListener('pagehide', persistActivePosition);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      persistActivePosition();
      stopAutoSave();
    } else if (inspection && inspection.status === 'in-progress' && _inspectionDirty) {
      startAutoSave();
    }
  });

  // Service worker intentionally disabled — was causing Safari freeze on cache update

  restoreActivePosition().finally(() => {
    retryQueuedUploads();
    render();
  });

  // ── Storage quota monitor ──────────────────────────────────
  async function checkStorageQuota() {
    if (!navigator.storage || !navigator.storage.estimate) return;
    try {
      const { usage, quota } = await navigator.storage.estimate();
      const pct = quota > 0 ? (usage / quota) * 100 : 0;
      // Change 5: lowered from 80% to 70%
      if (pct > 70) {
        let banner = document.getElementById('save-error-banner');
        if (!banner) {
          banner = document.createElement('div');
          banner.id = 'save-error-banner';
          banner.style.cssText = 'position:fixed;top:0;left:0;right:0;background:#e67e22;color:#fff;font-size:15px;font-weight:bold;text-align:center;padding:12px;z-index:99999;cursor:pointer;';
          banner.addEventListener('click', () => banner.remove());
          document.body.appendChild(banner);
        }
        banner.textContent = '\u26a0\ufe0f Storage ' + Math.round(pct) + '% full \u2014 go to Review and back up to cloud now';
      }
      // Time-based warning when the inspection has not reached cloud storage recently.
      const THIRTY_MIN = 30 * 60 * 1000;
      const lastSync = getBestCloudSyncAt();
      const notSynced = lastSync === null || (Date.now() - lastSync) > THIRTY_MIN;
      const wasDismissed = sessionStorage.getItem('syncWarnDismissed') === '1';
      // Clear dismissed flag if a successful sync happened after dismissal
      if (wasDismissed && lastSync && lastSync > parseInt(sessionStorage.getItem('syncWarnDismissedAt')||'0')) {
        sessionStorage.removeItem('syncWarnDismissed');
        sessionStorage.removeItem('syncWarnDismissedAt');
      }
      if (notSynced && inspection && getScreen() === 'step' && !sessionStorage.getItem('syncWarnDismissed')) {
        let syncWarn = document.getElementById('sync-age-warning');
        if (!syncWarn) {
          syncWarn = document.createElement('div');
          syncWarn.id = 'sync-age-warning';
          syncWarn.style.cssText = 'position:fixed;bottom:80px;left:0;right:0;background:#d97706;color:#fff;font-size:13px;font-weight:600;text-align:center;padding:8px 12px;z-index:9990;cursor:pointer;';
          syncWarn.addEventListener('click', () => {
            sessionStorage.setItem('syncWarnDismissed', '1');
            sessionStorage.setItem('syncWarnDismissedAt', Date.now().toString());
            syncWarn.remove();
            checkpointToCloud(stepList);
            updateSyncStatus('syncing');
          });
          document.body.appendChild(syncWarn);
        }
        syncWarn.textContent = '\u26a0\ufe0f No cloud backup in 30+ min \u2014 tap to sync now';
      } else if (!notSynced || sessionStorage.getItem('syncWarnDismissed')) {
        const existing = document.getElementById('sync-age-warning');
        if (existing) existing.remove();
      }
    } catch(e) { /* quota check not critical */ }
  }
  checkStorageQuota();
  setInterval(checkStorageQuota, 60000); // check every minute

  // ── Auto-save & auto-checkpoint (started/stopped with inspection lifecycle) ──
  function startAutoSave() {
    if (!inspection || inspection.status !== 'in-progress' || !_inspectionDirty || document.hidden) return;
    if (_autoCheckpointInterval) return;
    _autoCheckpointInterval = setInterval(() => {
      runAutomaticCheckpoint();
    }, AUTO_CHECKPOINT_INTERVAL_MS);
  }

  function stopAutoSave() {
    if (_autoCheckpointInterval) { clearInterval(_autoCheckpointInterval); _autoCheckpointInterval = null; }
  }

  // Change 2: Update "X min ago" text in sync status every 30s
  setInterval(() => {
    if (getSyncStatus() === 'local' || getSyncStatus() === 'synced') {
      const bestSync = getBestCloudSyncAt();
      if (bestSync) {
        updateSyncStatus(getSyncStatus());
      }
    }
  }, 30000);

})();
