// InHaus Inspector - Main Application
import { GOOGLE_SCRIPT_URL, SYNC_SECRET, SHARED_DRIVE_FOLDER_ID, VISION_PROXY_URL } from './config.js';
import { getInspection, setInspection, getScreen, setScreen, getSyncStatus, setSyncStatus, isDirty, setDirty, getLastSaveText, setLastSaveText, getLastLocalSaveAt, setLastLocalSaveAt, getLastSuccessfulCloudSyncAt, setLastSuccessfulCloudSyncAt, getLastCheckpointAttemptAt, setLastCheckpointAttemptAt, getLastCheckpointSucceededAt, setLastCheckpointSucceededAt } from './state.js';
import { initStorage, saveNow, scheduleSave, backupToLocalStorage } from './storage.js';
import { buildExportJSON, extractAllPhotosFromExport, stripPhotosFromExport } from './inspection.js';
import { scriptFetch, updateSyncStatus, showUploadBanner, uploadPhotoImmediate, addToPhotoRetryQueue, retryFailedPhotos, sendToGoogleScript, checkpointToCloud, submitInspection } from './sync.js';
import { STEP_FIELDS, PHASES, buildStepList, getStepData, getEquipmentFields, validateEquipment, validateStep, warnStep } from './steps.js';
import { initScreens, render } from './screens.js';

(function () {
  'use strict';

  // scriptFetch → moved to sync.js

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
  // screen moved to state.js
  let _truckCheck = {};
  // saveTimeout moved to storage.js
  // lastSaveText moved to state.js

  // Sync state timestamps moved to state.js
  // lastSuccessfulCloudSyncAt, lastCheckpointAttemptAt, lastCheckpointSucceededAt → state.js
  let _finalSyncTriggeredId = null;      // tracks which inspection triggered final sync

  const root = document.getElementById('app');

  // ── ID Generator ───────────────────────────────────────────
  function genId() {
    const d = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    return 'INH-' + d + '-' + Math.random().toString(36).substring(2, 8).toUpperCase();
  }

  // buildStepList, STEP_FIELDS, PHASES, validateEquipment, validateStep, warnStep, getStepData → moved to steps.js

  // ── Add Dynamic Room ───────────────────────────────────────
  function addDynamicRoom(section, namePrefix) {
    if (!inspection.dynamicRooms) inspection.dynamicRooms = {};
    if (!inspection.dynamicRooms[section]) inspection.dynamicRooms[section] = [];

    const arr = inspection.dynamicRooms[section];
    const idx = arr.length;
    const defaultPrefix = section === 'lowest' ? 'Lowest Level - Room ' : 'Additional Room ';
    const prefix = namePrefix || defaultPrefix;
    const count = namePrefix ? arr.filter(r => r.name && r.name.startsWith(namePrefix)).length + 1 : idx + 1;
    arr.push({ name: prefix + ' ' + count });

    stepList = buildStepList(inspection);
    const newStepId = section === 'lowest' ? 'lowest-room-' + idx : 'additional-' + idx;
    const newIdx = stepList.findIndex(s => s.id === newStepId);
    if (newIdx >= 0) currentStepIdx = newIdx;

    saveNow().then(() => { render(); window.scrollTo(0, 0); });
  }

  // showUploadBanner, uploadPhotoImmediate, addToPhotoRetryQueue, retryFailedPhotos,
  // sendToGoogleScript, checkpointToCloud, submitInspection → moved to sync.js
  window.uploadPhotoImmediate = uploadPhotoImmediate;

  // ── Final Sync (Changes 3 & 4) ─────────────────────────────
  async function triggerFinalSync() {
    showFinalSyncOverlay('syncing');
    // Retry any individually-queued photos before the main sync
    await retryFailedPhotos();

    // ── PHOTO INTEGRITY GATE ──────────────────────────────────────
    // Any photo with neither a driveUrl nor a local dataUrl is LOST.
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

    try {
      const exportData = buildExportJSON(stepList);
      const success = await submitInspection(exportData);
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
      showFinalSyncOverlay('failed', null);
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
        '<strong>Photos pending upload:</strong> ' + r.photosExpected + '<br>' +
        '<strong>Photos already uploaded:</strong> ' + r.photosUploaded + '<br>' +
        (r.photosUnconfirmed > 0 ? '<span style="color:#ff6b6b;">\u26a0\ufe0f ' + r.photosUnconfirmed + ' photo' + (r.photosUnconfirmed === 1 ? '' : 's') + ' not confirmed in Drive \u2014 tap Retry</span><br>' : '') +
        '<strong>Drive folder:</strong> ' + r.driveFolderId + '<br>' +
        '<strong>App version:</strong> ' + r.appVersion +
        '</div></div>';
    }

    if (state === 'syncing') {
      overlay.style.background = 'rgba(0,0,0,0.88)';
      overlay.innerHTML = '<div style="font-size:2.5rem;margin-bottom:16px;">⏳</div>' +
        '<div style="color:#fff;font-size:1.3rem;font-weight:800;text-align:center;">Final sync in progress…</div>' +
        '<div style="color:#ccc;font-size:0.95rem;margin-top:8px;text-align:center;">Do not close the app</div>';
      // NOT dismissable while syncing

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
      // Hard block — photos are lost (no local data, no Drive URL)
      overlay.style.background = '#7f1d1d';
      overlay.style.color = '#fff';
      var lostCount = receipt && receipt.lostPhotos ? receipt.lostPhotos.length : 0;
      overlay.innerHTML = '📸' +
        '<div style="font-size:1.4rem;font-weight:800;text-align:center;margin-bottom:8px;">PHOTO ERROR — DO NOT CLOSE APP</div>' +
        '<div style="color:#fca5a5;font-size:0.95rem;margin-bottom:16px;text-align:center;">' +
          lostCount + ' photo' + (lostCount === 1 ? '' : 's') + ' cannot be found on device or in Drive.<br>' +
          'Do NOT close this app. Call Matt now.' +
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
      var retryBtn = document.createElement('button');
      retryBtn.type = 'button';
      retryBtn.style.cssText = 'background:#fff;color:#7f1d1d;border:none;border-radius:10px;padding:14px 36px;font-size:1rem;font-weight:800;cursor:pointer;margin-top:8px;touch-action:manipulation;font-family:inherit;';
      retryBtn.textContent = 'Tap to Retry';
      retryBtn.onclick = function() { overlay.remove(); triggerFinalSync(); };
      overlay.appendChild(retryBtn);
    }

    document.body.appendChild(overlay);
    return overlay;
  }

  // ── Photo integrity audit — runs before any final sync —————————————————
  // Rule: every photo must have EITHER a driveUrl (safe in Drive)
  //       OR a non-empty dataUrl (safe on device).
  // Any photo with neither is LOST and must block the sync with a hard error.
  function auditPhotos(insp) {
    const lost = [];
    const pending = []; // have dataUrl but not yet uploaded
    function checkArr(arr, context) {
      if (!Array.isArray(arr)) return;
      arr.forEach(function(p) {
        if (!p || !p.photoId) return;
        const hasDrive = p.driveUrl && p.driveUrl.length > 0;
        const hasLocal = p.dataUrl && p.dataUrl !== '__uploaded__';
        if (!hasDrive && !hasLocal) {
          lost.push({ photoId: p.photoId, context, caption: p.caption || '', roomName: p.roomName || '' });
        } else if (!hasDrive && hasLocal) {
          pending.push({ photoId: p.photoId, context });
        }
      });
    }
    if (insp && insp.stepData) {
      Object.entries(insp.stepData).forEach(function([stepId, stepData]) {
        Object.values(stepData || {}).forEach(function(v) {
          if (Array.isArray(v) && v.length && v[0] && typeof v[0].photoId === 'string') {
            checkArr(v, stepId);
          }
        });
      });
    }
    if (insp && insp.sparePhotos) checkArr(insp.sparePhotos, 'spare');
    return { lost, pending };
  }

  // Change 4: Final sync receipt
  function buildSyncReceipt(exportData, success) {
    var allPhotos = extractAllPhotosFromExport(exportData);
    var photosUploaded = 0;
    if (inspection && inspection.stepData) {
      Object.values(inspection.stepData).forEach(function(stepData) {
        Object.values(stepData).forEach(function(v) {
          if (Array.isArray(v) && v.length && v[0] && typeof v[0].photoId === 'string') {
            photosUploaded += v.filter(function(p) { return p._uploaded === true || p.dataUrl === '__uploaded__'; }).length;
          }
        });
      });
    }
    if (inspection && inspection.sparePhotos) {
      photosUploaded += inspection.sparePhotos.filter(function(p) { return p._uploaded === true || p.dataUrl === '__uploaded__'; }).length;
    }
    var photosUnconfirmed = inspection ? (inspection._photoRetryQueue || []).filter(function(p) { return p.dataUrl && p.dataUrl !== '__uploaded__'; }).length : 0;
    return {
      inspectionId: (exportData && exportData.inspectionId) || (inspection && inspection.inspectionId),
      timestamp: new Date().toLocaleString('en-US', { timeZone: 'America/Denver' }),
      roomCount: (exportData && exportData.rooms ? exportData.rooms.length : 0),
      photosExpected: allPhotos.length,
      photosUploaded: photosUploaded,
      photosUnconfirmed: photosUnconfirmed,
      driveFolderId: (exportData && exportData.driveFolderId) || 'pending',
      appVersion: 'v98',
      success: success
    };
  }



  async function retryQueuedUploads() {
    if (!GOOGLE_SCRIPT_URL || !navigator.onLine) return;
    const queue = await DB.getQueue();
    for (const item of queue) {
      try {
        await sendToGoogleScript(item);
        await DB.removeFromQueue(item.inspectionId);
      } catch (e) { break; }
    }
  }

  window.addEventListener('online', () => { retryQueuedUploads(); retryFailedPhotos(); });


  // Render/screen functions → moved to screens.js

  // buildExportJSON, cleanStepData → moved to inspection.js

  // ── Init ───────────────────────────────────────────────────
  initStorage({ onSyncStatusChange: updateSyncStatus });
  initScreens({
    get inspection() { return inspection; },
    set inspection(v) { inspection = v; },
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
    render,
    startAutoSave,
    stopAutoSave
  });

  window.addEventListener('online', () => {
    const badge = document.querySelector('.online-badge');
    if (badge) { badge.textContent = ''; badge.className = 'online-badge online'; }
  });
  window.addEventListener('offline', () => {
    const badge = document.querySelector('.online-badge');
    if (badge) { badge.textContent = '\u25cf Offline'; badge.className = 'online-badge offline'; }
    updateSyncStatus('offline'); // Change 2
  });

  // Service worker intentionally disabled — was causing Safari freeze on cache update

  retryQueuedUploads();
  render();

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
        banner.textContent = '\u26a0\ufe0f Storage ' + Math.round(pct) + '% full \u2014 go to Review and tap Sync to Drive now';
      }
      // Change 5: time-based warning - not synced to Drive in 30+ min
      const THIRTY_MIN = 30 * 60 * 1000;
      const notSynced = getLastSuccessfulCloudSyncAt() === null || (Date.now() - getLastSuccessfulCloudSyncAt()) > THIRTY_MIN;
      if (notSynced && inspection && getScreen() === 'step') {
        let syncWarn = document.getElementById('sync-age-warning');
        if (!syncWarn) {
          syncWarn = document.createElement('div');
          syncWarn.id = 'sync-age-warning';
          syncWarn.style.cssText = 'position:fixed;bottom:80px;left:0;right:0;background:#d97706;color:#fff;font-size:13px;font-weight:600;text-align:center;padding:8px 12px;z-index:9990;cursor:pointer;';
          syncWarn.addEventListener('click', () => { syncWarn.remove(); checkpointToCloud(stepList); updateSyncStatus('syncing'); });
          document.body.appendChild(syncWarn);
        }
        syncWarn.textContent = '\u26a0\ufe0f Not synced to Drive in 30+ min \u2014 tap Sync now to protect your data';
      } else {
        const existing = document.getElementById('sync-age-warning');
        if (existing) existing.remove();
      }
    } catch(e) { /* quota check not critical */ }
  }
  checkStorageQuota();
  setInterval(checkStorageQuota, 60000); // check every minute

  // ── Auto-save & auto-checkpoint (started/stopped with inspection lifecycle) ──
  let _autoSaveInterval = null;
  let _autoCheckpointInterval = null;

  function startAutoSave() {
    stopAutoSave();
    _autoSaveInterval = setInterval(() => {
      if (inspection) saveNow();
    }, 30000);
    _autoCheckpointInterval = setInterval(() => {
      if (inspection) { checkpointToCloud(stepList); backupToLocalStorage(); }
    }, 60000);
  }

  function stopAutoSave() {
    if (_autoSaveInterval) { clearInterval(_autoSaveInterval); _autoSaveInterval = null; }
    if (_autoCheckpointInterval) { clearInterval(_autoCheckpointInterval); _autoCheckpointInterval = null; }
  }

  // Change 2: Update "X min ago" text in sync status every 30s
  setInterval(() => {
    if (getSyncStatus() === 'local' || getSyncStatus() === 'synced') {
      const bestSync = Math.max(getLastSuccessfulCloudSyncAt() || 0, getLastCheckpointSucceededAt() || 0);
      if (bestSync) {
        updateSyncStatus(getSyncStatus());
      }
    }
  }, 30000);

})();
