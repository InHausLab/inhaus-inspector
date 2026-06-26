// InHaus Inspector - Main Application
import { GOOGLE_SCRIPT_URL, SYNC_SECRET, SHARED_DRIVE_FOLDER_ID, VISION_PROXY_URL } from './config.js';
import { getInspection, setInspection, getScreen, setScreen, getSyncStatus, setSyncStatus, isDirty, setDirty, getLastSaveText, setLastSaveText, getLastLocalSaveAt, setLastLocalSaveAt, getLastSuccessfulCloudSyncAt, setLastSuccessfulCloudSyncAt, getLastCheckpointAttemptAt, setLastCheckpointAttemptAt, getLastCheckpointSucceededAt, setLastCheckpointSucceededAt } from './state.js';
import { initStorage, saveNow, scheduleSave, backupToLocalStorage } from './storage.js';
import { buildExportJSON, extractAllPhotosFromExport, stripPhotosFromExport } from './inspection.js';
import { scriptFetch, updateSyncStatus, showUploadBanner, uploadPhotoImmediate, addToPhotoRetryQueue, retryFailedPhotos, sendToGoogleScript, checkpointToCloud, submitInspection } from './sync.js';
import { STEP_FIELDS, PHASES, buildStepList, getStepData, getEquipmentFields, validateEquipment, validateStep, warnStep } from './steps.js';

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
      appVersion: 'v92',
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

  // ── Room Navigation Drawer ─────────────────────────────────
  function buildRoomDrawer() {
    // Sections match the inspection workflow levels
    // addRooms: array of { label, section, prefix } for add-room buttons at bottom of section
    const DRAWER_GROUPS = [
      { label: 'Setup', phases: ['setup', 'arrival'] },
      { label: 'Exterior', phases: ['exterior'] },
      { label: 'Lowest Level', phases: ['lowest'], addRooms: [
        { label: '+ Add Room', section: 'lowest', prefix: null }
      ]},
      { label: 'Utility Room', phases: ['utility'] },
      { label: 'Upper Level', phases: ['upper', 'rooms'], addRooms: [
        { label: '+ Add Bedroom', section: 'additional', prefix: 'Bedroom' },
        { label: '+ Add Bathroom', section: 'additional', prefix: 'Bathroom' }
      ]},
      { label: 'Main Level', phases: ['main'] },
      { label: 'Additional Rooms', phases: ['supplementary'], addRooms: [
        { label: '+ Add Room', section: 'additional', prefix: null }
      ]},
      { label: 'Wrap-Up', phases: ['wrapup', 'propdetails', 'post', 'review'] }
    ];

    const overlay = el('div', { id: 'room-drawer-overlay', className: 'room-drawer-overlay' });
    const drawer = el('div', { className: 'room-drawer' });

    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    drawer.addEventListener('click', e => e.stopPropagation());

    drawer.appendChild(el('div', { className: 'room-drawer-handle' }));
    drawer.appendChild(el('div', { className: 'room-drawer-title' }, '\uD83D\uDCCD Navigate'));

    const scrollArea = el('div', { className: 'room-drawer-scroll' });

    DRAWER_GROUPS.forEach(group => {
      // All steps in this group's phases - no type restrictions (review included in Wrap-Up)
      const groupSteps = stepList.filter(s => group.phases.includes(s.phase));
      if (!groupSteps.length) return;

      scrollArea.appendChild(el('div', { className: 'room-drawer-group-label' }, group.label));

      groupSteps.forEach(s => {
        const sData = (inspection.stepData && inspection.stepData[s.id]) || {};
        const completed = !!sData._completedAt;
        const visited = !!sData._visited;
        const sIdx = stepList.indexOf(s);
        const isCurrent = sIdx === currentStepIdx;

        const statusText = completed ? '\u2713' : (visited ? '\u25cf' : '');
        const cls = 'room-drawer-item' +
          (isCurrent ? ' room-item-current' : '') +
          (completed ? ' room-item-done' : '') +
          (visited && !completed ? ' room-item-partial' : '');

        const ROOM_NAMED_TYPES = ['bedroom', 'bathroom', 'room-test', 'additional-room'];
        const stepRoomName = ROOM_NAMED_TYPES.includes(s.type) &&
          inspection.stepData && inspection.stepData[s.id] && inspection.stepData[s.id].roomName;
        const displayName = stepRoomName || s.name;

        scrollArea.appendChild(el('div', {
          className: cls,
          onClick: () => {
            currentStepIdx = sIdx;
            overlay.remove();
            render();
            window.scrollTo(0, 0);
          }
        }, [
          el('span', { className: 'room-item-name' }, displayName),
          statusText ? el('span', { className: 'room-item-status' + (completed ? ' status-done' : ' status-partial') }, statusText) : null
        ]));
      });

      // Per-section add-room buttons (Lowest Level, Upper Level, Additional Rooms)
      if (group.addRooms && group.addRooms.length) {
        const addRow = el('div', { className: 'room-drawer-section-add' });
        group.addRooms.forEach(addDef => {
          addRow.appendChild(el('button', {
            type: 'button',
            className: 'room-drawer-add-item-btn',
            onClick: () => {
              overlay.remove();
              addDynamicRoom(addDef.section, addDef.prefix);
            }
          }, addDef.label));
        });
        scrollArea.appendChild(addRow);
      }
    });

    drawer.appendChild(scrollArea);
    overlay.appendChild(drawer);
    return overlay;
  }

  // ── Search ─────────────────────────────────────────────────
  function openSearch() {
    const existing = document.getElementById('search-overlay');
    if (existing) { existing.remove(); return; }

    const searchIndex = [];
    stepList.forEach(s => {
      if (s.type === 'review') return;
      const sIdx = stepList.indexOf(s);
      searchIndex.push({ label: s.name, stepIdx: sIdx, context: '' });
      const fieldGen = STEP_FIELDS[s.type];
      if (fieldGen) {
        fieldGen().forEach(f => {
          if (!f.label || !f.key) return;
          if (['heading', 'info', 'divider', 'photo', 'timer', 'link'].includes(f.type)) return;
          searchIndex.push({ label: f.label, stepIdx: sIdx, context: s.name, key: f.key });
        });
      }
    });

    const overlay = el('div', { id: 'search-overlay', className: 'search-overlay' });
    const panel = el('div', { className: 'search-panel' });

    const inputRow = el('div', { className: 'search-input-row' });
    const inp = el('input', {
      type: 'search', className: 'search-input',
      placeholder: 'Search sections, fields, rooms\u2026',
      autocomplete: 'off', autocorrect: 'off', autocapitalize: 'off'
    });
    const closeBtn = el('button', {
      type: 'button', className: 'search-close-btn',
      onClick: () => overlay.remove()
    }, '\u00d7');
    inputRow.appendChild(el('span', { className: 'search-icon-prefix' }, '\uD83D\uDD0D'));
    inputRow.appendChild(inp);
    inputRow.appendChild(closeBtn);
    panel.appendChild(inputRow);

    const resultsList = el('div', { className: 'search-results-list' });
    panel.appendChild(resultsList);
    overlay.appendChild(panel);
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
    inp.focus();

    let allMatches = [], matchCursor = 0;

    function renderResults(q) {
      resultsList.innerHTML = '';
      allMatches = [];
      matchCursor = 0;
      if (!q.trim()) return;
      const low = q.toLowerCase();
      const seen = new Set();
      searchIndex.forEach(item => {
        const dedupKey = item.key ? 'f-' + item.stepIdx + '-' + item.key : 's-' + item.stepIdx;
        if (seen.has(dedupKey)) return;
        if (item.label.toLowerCase().includes(low) || (item.context && item.context.toLowerCase().includes(low))) {
          seen.add(dedupKey);
          allMatches.push(item);
        }
      });

      if (!allMatches.length) {
        resultsList.appendChild(el('div', { className: 'search-no-results' }, 'No results found'));
        return;
      }

      allMatches.slice(0, 25).forEach(item => {
        resultsList.appendChild(el('div', {
          className: 'search-result-item',
          onClick: () => {
            currentStepIdx = item.stepIdx;
            overlay.remove();
            render();
            window.scrollTo(0, 0);
          }
        }, [
          el('div', { className: 'search-result-label' }, item.label),
          item.context ? el('div', { className: 'search-result-context' }, 'In: ' + item.context) : null
        ]));
      });

      if (allMatches.length > 1) {
        resultsList.appendChild(el('button', {
          type: 'button', className: 'btn btn-primary btn-full search-next-btn',
          onClick: () => {
            matchCursor = (matchCursor + 1) % allMatches.length;
            currentStepIdx = allMatches[matchCursor].stepIdx;
            overlay.remove();
            render();
            window.scrollTo(0, 0);
          }
        }, 'Next \u203a (' + allMatches.length + ' matches)'));
      }
    }

    inp.addEventListener('input', () => renderResults(inp.value));
  }

  // ── Render ─────────────────────────────────────────────────
  function render() {
    window.inspection = inspection; // expose for real-time photo upload in ui.js
    root.innerHTML = ''
    switch (getScreen()) {
      case 'home': renderHome(); break;
      case 'truck-check': renderTruckCheck(); break;
      case 'intake': renderIntake(); break;
      case 'precheck': renderPrecheck(); break;
      case 'step': renderStep(); break;
      case 'review': renderReview(); break;
    }
  }

  // ── App Header (reused on all screens) ─────────────────────
  let _devTapCount = 0, _devTapTimer = null;
  function isDevMode() { return localStorage.getItem('inhausDevMode') === 'true'; }
  function toggleDevMode() {
    const next = !isDevMode();
    localStorage.setItem('inhausDevMode', next ? 'true' : 'false');
    const msg = next ? '\u26a0\ufe0f Dev Mode ON \u2014 Skip buttons active' : 'Dev Mode OFF';
    showToast(msg);
    render();
  }

  function buildAppHeader(subtitle) {
    const header = el('div', { className: 'app-header' });
    const logo = el('div', { className: 'app-logo', style: 'cursor:pointer;', onClick: () => {
      _devTapCount++;
      if (_devTapTimer) clearTimeout(_devTapTimer);
      _devTapTimer = setTimeout(() => { _devTapCount = 0; }, 2000);
      if (_devTapCount >= 5) { _devTapCount = 0; toggleDevMode(); }
    }});
    logo.appendChild(el('img', { src: 'icons/logo.png', alt: 'InHaus Lab' }));
    header.appendChild(logo);
    if (isDevMode()) {
      const banner = el('div', { style: 'background:#ff9900;color:#000;font-size:11px;font-weight:bold;padding:2px 8px;border-radius:4px;' }, '\u26a0\ufe0f DEV');
      header.appendChild(banner);
    }
    header.appendChild(el('p', { className: 'app-subtitle' }, subtitle || 'Field Inspector'));
    return header;
  }

  // ── HOME SCREEN ────────────────────────────────────────────
  function renderHome() {
    const c = el('div', { className: 'screen home-screen' });
    c.appendChild(buildAppHeader());

    c.appendChild(el('button', {
      className: 'btn btn-primary btn-full',
      onClick: () => { setScreen('truck-check'); render(); }
    }, 'New Inspection'));

    // ── Inspector mode toggle ─────────────────────────────────
    const isExp = localStorage.getItem('inhaus_experienced') === 'true';
    const modeBtn = el('button', {
      className: 'btn btn-outline btn-full',
      style: 'margin-top:8px;font-size:0.85rem;color:#5a7a3a;border-color:#c8d8b8;',
      onClick: () => {
        const nowExp = localStorage.getItem('inhaus_experienced') === 'true';
        localStorage.setItem('inhaus_experienced', nowExp ? 'false' : 'true');
        render();
      }
    }, isExp
      ? '\uD83D\uDCCB Process steps collapsed (experienced mode) - tap to show all'
      : '\u2705 Process steps expanded (guided mode) - tap to collapse for experienced inspectors'
    );
    c.appendChild(modeBtn);

    const list = el('div', { className: 'inspection-list' });
    c.appendChild(list);

    DB.getAll().then(all => {
      all.sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
      const inProg = all.filter(x => x.status === 'in-progress');
      const done = all.filter(x => x.status === 'completed');

      if (inProg.length) {
        list.appendChild(el('h2', { className: 'list-heading' }, 'In Progress'));
        inProg.forEach(x => list.appendChild(renderInspCard(x, true)));
      }
      if (done.length) {
        list.appendChild(el('h2', { className: 'list-heading' }, 'Completed'));
        done.forEach(x => list.appendChild(renderInspCard(x, false)));
      }
      if (!all.length) {
        list.appendChild(el('p', { className: 'empty-msg' }, 'No inspections yet. Tap "New Inspection" to begin.'));
      }
    });

    root.appendChild(c);
  }

  function renderInspCard(insp, canResume) {
    return el('div', { className: 'card insp-card' }, [
      el('div', { className: 'card-top' }, [
        el('strong', null, insp.inspectionId),
        el('span', { className: 'badge ' + insp.status }, insp.status === 'completed' ? 'Complete' : 'In Progress')
      ]),
      el('p', null, insp.propertyAddress || 'No address'),
      el('p', { className: 'text-sm' }, (insp.inspectorName || '') + ' \u2022 ' + fmtDate(insp.startedAt)),
      el('div', { className: 'card-actions' }, [
        canResume ? el('button', { className: 'btn btn-primary', onClick: () => resumeInsp(insp.inspectionId) }, 'Resume') : null,
        el('button', { className: 'btn btn-outline', onClick: () => viewInsp(insp.inspectionId) }, 'View'),
        el('button', { className: 'btn btn-danger-outline btn-small', onClick: () => {
          if (confirm('⚠️ Delete this inspection permanently?\n\nAll photos and data will be removed from this device.\n\nOnly delete after confirming your photos have been uploaded to Google Drive.\n\nThis cannot be undone.')) {
            DB.remove(insp.inspectionId).then(() => render());
          }
        }}, 'Delete')
      ])
    ]);
  }

  async function resumeInsp(id) {
    inspection = await DB.get(id); setInspection(inspection);
    if (!inspection) return;
    stepList = buildStepList(inspection);
    const lastVisited = inspection._lastStepIdx || 0;
    currentStepIdx = Math.min(lastVisited, stepList.length - 1);
    setScreen('step');
    render();
  }

  async function viewInsp(id) {
    inspection = await DB.get(id); setInspection(inspection);
    if (!inspection) return;
    stepList = buildStepList(inspection);
    setScreen('review');
    render();
  }

  // ── TRUCK CHECK SCREEN ────────────────────────────────────
  function renderTruckCheck() {
    const SECTIONS = [
      {
        title: 'Air Testing',
        items: [
          { key: 'tc_qtrak',        label: 'Q-Trak 7585 - charged, previous data deleted, rooms configured', required: true },
          { key: 'tc_flir',         label: 'FLIR MR277', required: true },
          { key: 'tc_corentium',    label: 'Airthings Corentium Pro + charging cube', required: true },
          { key: 'tc_breezePump',   label: 'Breeze ET pump + tripod', required: true },
          { key: 'tc_breezeTraps',  label: 'Breeze ST spore traps (6)', required: true },
          { key: 'tc_breezeSwabs',  label: 'Breeze mold swabs (2)', required: true },
          { key: 'tc_boulderFan',   label: 'Boulder Blue fan + filter', required: true }
        ]
      },
      {
        title: 'Water Testing',
        items: [
          { key: 'tc_waterPanel',   label: 'Full panel water test kit (SafeHome)', required: true },
          { key: 'tc_pfas',         label: 'PFAS test kit (Cyclopure)', required: false, asNeeded: true },
          { key: 'tc_microplastic', label: 'Microplastics test kit (Brooks Applied Labs)', required: false, asNeeded: true }
        ]
      },
      {
        title: 'Surface Testing',
        items: [
          { key: 'tc_atpDevice',    label: 'ATP device (SystemSURE Plus)', required: true },
          { key: 'tc_atpSwabs',     label: 'ATP swabs (2) - refrigerated, bring ice pack', required: true }
        ]
      },
      {
        title: 'Other Equipment',
        items: [
          { key: 'tc_dewalt',       label: 'Dewalt vacuum + attachments + bendy light', required: true },
          { key: 'tc_endoscope',    label: 'Endoscope', required: true },
          { key: 'tc_tape',         label: 'Measuring tape', required: true },
          { key: 'tc_cleaning',     label: 'Cleaning supplies', required: true }
        ]
      },
      {
        title: 'Personal / Safety',
        items: [
          { key: 'tc_tarp',         label: 'Tarp (for entryway)', required: true },
          { key: 'tc_shoeCovers',   label: 'Shoe covers', required: true },
          { key: 'tc_n95',          label: 'N95 masks', required: true },
          { key: 'tc_gloves',       label: 'Nitrile gloves', required: true },
          { key: 'tc_sanitizer',    label: 'Hand sanitizer', required: true }
        ]
      },
      {
        title: 'Technology',
        items: [
          { key: 'tc_ipad',         label: 'iPad - fully charged, all apps downloaded', required: true },
          { key: 'tc_airthingsApp', label: 'Airthings app installed', required: true },
          { key: 'tc_airthingsVP',  label: 'Airthings View Plus app installed', required: true }
        ]
      },
      {
        title: 'Shipping Supplies',
        items: [
          { key: 'tc_fedexLabel',   label: 'FedEx prepaid label (Breeze STs)', required: true },
          { key: 'tc_upsLabel',     label: 'UPS label (Boulder Blue)', required: true },
          { key: 'tc_waterLabel',   label: 'Safe Home water panel - prepaid label + package', required: true },
          { key: 'tc_cyclopureLabel', label: 'Cyclopure PFAS - prepaid label + package', required: false, asNeeded: true },
          { key: 'tc_microLabel',     label: 'Microplastics (Brooks Applied Labs) - prepaid label + package', required: false, asNeeded: true }
        ]
      }
    ];

    const allRequired = SECTIONS.flatMap(s => s.items.filter(i => i.required));

    function countChecked() {
      return SECTIONS.flatMap(s => s.items).filter(i => !!_truckCheck[i.key]).length;
    }
    function totalItems() {
      return SECTIONS.flatMap(s => s.items).length;
    }
    function allRequiredChecked() {
      return allRequired.every(i => !!_truckCheck[i.key]);
    }

    const c = el('div', { className: 'screen' });
    c.appendChild(buildAppHeader());

    // Reset / back link
    const resetBar = el('div', { className: 'truck-check-reset-bar' });
    const resetLink = el('button', {
      className: 'btn-link',
      onClick: () => { setScreen('home'); render(); }
    }, '← Back to Home');
    resetBar.appendChild(resetLink);
    c.appendChild(resetBar);

    const card = el('div', { className: 'card' });

    // Header
    card.appendChild(el('h2', { className: 'screen-title' }, '🚛 Loading Truck Checklist'));
    card.appendChild(el('p', { className: 'truck-check-subtitle' }, 'Check off every item before leaving'));

    // Progress counter
    const progressEl = el('div', { className: 'truck-check-progress' }, countChecked() + ' of ' + totalItems() + ' items checked');
    card.appendChild(progressEl);

    // Sections
    SECTIONS.forEach(section => {
      card.appendChild(el('div', { className: 'section-heading' }, section.title));
      section.items.forEach(item => {
        const box = el('div', {
          className: 'check-box' + (_truckCheck[item.key] ? ' checked' : '')
        }, _truckCheck[item.key] ? '\u2713' : '');
        const labelText = item.label + (item.asNeeded ? ' (as needed)' : !item.required ? ' (optional)' : '');
        const row = el('div', {
          className: 'check-item' + (!item.required ? ' optional-item' : ''),
          onClick: () => {
            _truckCheck[item.key] = !_truckCheck[item.key];
            box.className = 'check-box' + (_truckCheck[item.key] ? ' checked' : '');
            box.textContent = _truckCheck[item.key] ? '\u2713' : '';
            const checked = countChecked();
            progressEl.textContent = checked + ' of ' + totalItems() + ' items checked';
            continueBtn.className = 'btn btn-full ' + (allRequiredChecked() ? 'btn-primary' : 'btn-disabled');
            continueBtn.disabled = !allRequiredChecked();
          }
        });
        row.appendChild(box);
        row.appendChild(el('div', { className: 'check-label' }, labelText));
        card.appendChild(row);
      });
    });

    // Continue button
    const ready = allRequiredChecked();
    const continueBtn = el('button', {
      className: 'btn btn-full ' + (ready ? 'btn-primary' : 'btn-disabled'),
      disabled: !ready,
      onClick: () => {
        if (!allRequiredChecked()) return;
        setScreen('intake');
        render();
      }
    }, 'Continue \u2192');

    card.appendChild(el('div', { style: 'margin-top: 1.5rem;' }, [continueBtn]));
    c.appendChild(card);
    root.appendChild(c);
  }

  // ── INTAKE SCREEN ──────────────────────────────────────────
  function renderIntake() {
    const isEdit = !!inspection;
    const data = isEdit ? {
      inspectionId: inspection.inspectionId,
      inspectorName: inspection.inspectorName || '',
      inspectionDate: inspection.inspectionDate || new Date().toISOString().slice(0, 10),
      clientName: inspection.clientName || '',
      propertyAddress: inspection.propertyAddress || '',
      numberOfLevels: inspection.numberOfLevels || '',
      numberOfBedrooms: inspection.numberOfBedrooms || '',
      numberOfBathrooms: inspection.numberOfBathrooms || '',
      waterSource: inspection.waterSource || '',
      waterSourceDescription: inspection.waterSourceDescription || '',
      wifiNetwork: inspection.wifiNetwork || '',
      wifiPassword: inspection.wifiPassword || '',
      clientConcerns: inspection.clientConcerns || '',
      blueprintNotes: inspection.blueprintNotes || '',
      inspectorEmail: inspection.inspectorEmail || ''
    } : {
      inspectionId: genId(),
      inspectorName: '',
      inspectionDate: new Date().toISOString().slice(0, 10),
      clientName: '',
      propertyAddress: '',
      numberOfLevels: '',
      numberOfBedrooms: '',
      numberOfBathrooms: '',
      waterSource: '',
      waterSourceDescription: '',
      wifiNetwork: '',
      wifiPassword: '',
      clientConcerns: '',
      blueprintNotes: ''
    };

    const c = el('div', { className: 'screen' });
    c.appendChild(buildAppHeader(isEdit ? 'Edit Intake Details' : 'Customer & Property Intake'));
    c.appendChild(renderStatusBar(getLastSaveText()));

    const card = el('div', { className: 'card' });
    const fields = [
      { ...text('inspectionId', 'Inspection ID'), disabled: true },
      text('inspectorName', 'Inspector Name *'),
      text('inspectorEmail', 'Inspector Email'),
      date('inspectionDate', 'Inspection Date'),
      text('clientName', 'Client Name *'),
      text('propertyAddress', 'Property Address *'),
      photo('Title Page'),
      sel('numberOfLevels', 'Number of Levels *', ['1', '2', '3', '4', '5']),
      sel('numberOfBedrooms', 'Number of Bedrooms *', ['1','2','3','4','5','6','7','8','9','10','11','12','13','14','15']),
      sel('numberOfBathrooms', 'Number of Bathrooms *', ['1','2','3','4','5','6','7','8','9','10','11','12','13','14','15','16','17','18','19','20']),
      chips('waterSource', 'Water Source * (select all that apply)', ['Municipal', 'Well', 'Spring', 'Cistern', 'Other']),
      showIf(text('waterSourceDescription', 'If "Other": describe water source', { placeholder: 'e.g. Private spring on property' }), 'waterSource', 'Other'),
      divider(),
      text('wifiNetwork', 'Home wifi network name'),
      text('wifiPassword', 'WiFi Password', { placeholder: 'For Airthings and device connectivity' }),
      { type: 'wifi-copy' },
      textarea('clientConcerns', 'Client concerns / known problem areas', { placeholder: 'Tap \uD83C\uDF99 mic in your iPhone keyboard to dictate \u2014 read back and fix errors before saving.' }),
      textarea('blueprintNotes', 'Client blueprints / layout notes (optional)')
    ];

    const onIntakeChange = () => { updateShowIf(card, data); };
    fields.forEach(f => {
      const rendered = renderField(f, data, onIntakeChange, {}, () => {});
      if (rendered) card.appendChild(rendered);
    });
    updateShowIf(card, data);
    c.appendChild(card);

    const nav = el('div', { className: 'bottom-nav' }, [
      el('button', { className: 'btn btn-outline btn-nav', onClick: () => {
        if (isEdit) { setScreen('step'); render(); } else { setScreen('truck-check'); render(); }
      } }, isEdit ? '\u2190 Back to Steps' : '\u2190 Back'),
      el('button', { className: 'btn btn-primary btn-nav', onClick: () => {
        const required = ['inspectorName', 'clientName', 'propertyAddress', 'numberOfLevels', 'numberOfBedrooms', 'numberOfBathrooms'];
        const missing = required.filter(k => !data[k] || !data[k].trim || !data[k].trim());
        if (!data.waterSource || (Array.isArray(data.waterSource) ? data.waterSource.length === 0 : !data.waterSource)) missing.push('waterSource');
        if (missing.length) { alert('Please fill in all required fields (marked with *).'); return; }
        if (isEdit) {
          Object.assign(inspection, data);
          stepList = buildStepList(inspection);
          setScreen('step');
          saveNow().then(() => render());
        } else {
          inspection = {
            ...data,
            startedAt: new Date().toISOString(),
            endedAt: null,
            status: 'in-progress',
            stepData: {},
            timers: {},
            dynamicRooms: { lowest: [{ name: 'Lowest Level \u2014 Room 1' }], additional: [] },
            _lastStepIdx: 0,
            truckCheck: Object.assign({}, _truckCheck)
          }; setInspection(inspection);
          stepList = buildStepList(inspection);
          currentStepIdx = 0;
          setScreen('precheck');
          saveNow().then(() => render());
        }
      }}, isEdit ? 'Save Changes \u2713' : 'Start Inspection \u2192')
    ]);
    c.appendChild(nav);
    root.appendChild(c);
  }

  // ── STEP SCREEN ────────────────────────────────────────────
  function renderPrecheck() {
    const c = document.createElement('div');
    c.className = 'screen step-screen';
    c.appendChild(buildAppHeader('Pre-Inspection Checklist'));

    const title = document.createElement('h1');
    title.className = 'screen-title';
    title.textContent = 'Equipment Check';
    c.appendChild(title);

    const info = document.createElement('div');
    info.className = 'field-info';
    info.style = 'margin-bottom:16px;';
    info.textContent = 'Confirm everything is packed and ready before entering the home.';
    c.appendChild(info);

    const card = document.createElement('div');
    card.className = 'card';
    const data = getStepData('equipment');
    const fieldGen = STEP_FIELDS['equipment'];
    if (fieldGen) {
      const fields = fieldGen();
      const onFieldChange = () => { data._updatedAt = new Date().toISOString(); scheduleSave(); UI.updateShowIf(card, data); };
      fields.forEach(f => {
        const rendered = UI.renderField(f, data, onFieldChange, inspection, () => scheduleSave());
        if (rendered) card.appendChild(rendered);
      });
      UI.updateShowIf(card, data);
    }
    c.appendChild(card);

    const nav = document.createElement('div');
    nav.className = 'bottom-nav';

    const backBtn = document.createElement('button');
    backBtn.className = 'btn btn-outline btn-nav';
    backBtn.textContent = '← Back';
    backBtn.onclick = () => { setScreen('home'); render(); };

    const startBtn = document.createElement('button');
    startBtn.className = 'btn btn-primary btn-nav';
    startBtn.textContent = 'Begin Inspection →';
    startBtn.style = 'background:#2C3F16;';
    startBtn.onclick = () => {
      data._visited = true;
      data._completedAt = new Date().toISOString();
      currentStepIdx = 1; // skip equipment step - already done here
      setScreen('step');
      saveNow().then(() => { render(); window.scrollTo(0, 0); });
    };

    nav.appendChild(backBtn);
    nav.appendChild(startBtn);
    c.appendChild(nav);
    root.innerHTML = '';
    root.appendChild(c);
  }

  function renderStep() {
    if (currentStepIdx >= stepList.length) { setScreen('review'); render(); return; }
    const step = stepList[currentStepIdx];
    if (step.type === 'review') { setScreen('review'); render(); return; }

    const data = getStepData(step.id);
    if (!data._enteredAt) data._enteredAt = new Date().toISOString();
    data._roomName = step.name;

    if (step.type === 'debrief') {
      setTimeout(() => {
        if (data.radonPickupTime && !document.getElementById('radon-cal-btn')) {
          const calBtn = document.createElement('button');
          calBtn.id = 'radon-cal-btn';
          calBtn.type = 'button';
          calBtn.className = 'btn btn-outline btn-full';
          calBtn.style = 'margin:8px 0;background:#e8f5e9;border-color:#2C3F16;color:#2C3F16;font-weight:700;';
          calBtn.textContent = '\uD83D\uDCC5 Add Radon Pickup to Calendar';
          calBtn.onclick = () => {
            const dt = new Date(data.radonPickupTime);
            const pad = n => String(n).padStart(2,'0');
            const fmt = d => d.getFullYear()+pad(d.getMonth()+1)+pad(d.getDate())+'T'+pad(d.getHours())+pad(d.getMinutes())+'00';
            const dtEnd = new Date(dt.getTime() + 30*60000);
            const addr = (inspection.propertyAddress || 'Inspection address').replace(/,/g, '\\,');
            const ics = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nDTSTART:'+fmt(dt)+'\r\nDTEND:'+fmt(dtEnd)+'\r\nSUMMARY:Radon Pickup - '+addr+'\r\nDESCRIPTION:Pick up Airthings Corentium radon monitor\r\nLOCATION:'+addr+'\r\nEND:VEVENT\r\nEND:VCALENDAR';
            const blob = new Blob([ics], {type:'text/calendar'});
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a'); a.href=url; a.download='radon-pickup.ics'; a.click();
            URL.revokeObjectURL(url);
          };
          const card = document.querySelector('.step-screen .card');
          if (card) card.appendChild(calBtn);
        }
      }, 400);
    }
    if (step.type === 'debrief' && !data.radonPickupTime && inspection.startedAt) {
      const pickupMs = new Date(inspection.startedAt).getTime() + 54 * 60 * 60 * 1000;
      const d = new Date(pickupMs);
      const pad = n => String(n).padStart(2, '0');
      data.radonPickupTime = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
    }

    // Room name left blank intentionally - Dave types the actual room name

    inspection._lastStepIdx = currentStepIdx;
    if (inspection._furthestStepIdx === undefined || currentStepIdx > inspection._furthestStepIdx) {
      inspection._furthestStepIdx = currentStepIdx;
    }

    const c = el('div', { className: 'screen step-screen' });
    c.appendChild(buildAppHeader(step.name));
    c.appendChild(renderStatusBar(getLastSaveText()));

    const timersBar = renderTimersBar(inspection);
    if (timersBar) c.appendChild(timersBar);

    const currentPhase = step.phase;
    const phasesWithState = PHASES.map(p => {
      const phaseSteps = stepList.filter(s => s.phase === p.id && s.type !== 'review');
      const allDone = phaseSteps.length > 0 && phaseSteps.every(s => {
        const d = inspection.stepData && inspection.stepData[s.id];
        return d && d._visited;
      });
      return { ...p, done: allDone };
    });
    c.appendChild(renderProgressBar(phasesWithState, currentPhase, step.name, phaseId => {
      const idx = stepList.findIndex(s => s.phase === phaseId);
      if (idx >= 0) { currentStepIdx = idx; render(); }
    }, currentStepIdx + 1, stepList.length));

    const phaseSteps = stepList.filter(s => s.phase === currentPhase && s.type !== 'review');
    const alwaysShowSubNav = ['lowest', 'upper', 'rooms', 'supplementary', 'wrapup'].includes(currentPhase);
    if (phaseSteps.length > 1 || alwaysShowSubNav) {
      const subNav = el('div', { className: 'sub-nav' });
      phaseSteps.forEach((s, i) => {
        const sIdx = stepList.indexOf(s);
        const isCurr = sIdx === currentStepIdx;
        const isDone = inspection.stepData && inspection.stepData[s.id] && inspection.stepData[s.id]._visited;
        const btn = el('button', {
          type: 'button',
          className: 'sub-nav-btn' + (isCurr ? ' active' : '') + (isDone ? ' done' : ''),
          onClick: () => { currentStepIdx = sIdx; render(); window.scrollTo(0, 0); }
        }, s.name);
        subNav.appendChild(btn);
      });
      c.appendChild(subNav);
    }

    // Back to page 1 (edit intake) button
    const backToIntakeBtn = el('button', {
      type: 'button',
      className: 'btn btn-outline btn-small',
      style: 'position:fixed;top:max(54px,calc(env(safe-area-inset-top) + 8px));right:10px;z-index:200;font-size:11px;padding:4px 10px;display:inline-flex;align-items:center;justify-content:center;',
      onClick: () => { setScreen('intake'); render(); }
    }, '\u270E Intake');
    c.appendChild(backToIntakeBtn);

    // Search button
    const searchBtn = el('button', {
      type: 'button',
      style: 'position:fixed;top:max(54px,calc(env(safe-area-inset-top) + 8px));right:82px;z-index:200;background:#2C3F16;color:#fff;border:none;border-radius:8px;font-size:15px;padding:6px 12px;cursor:pointer;min-height:0;line-height:1.4;font-weight:700;touch-action:manipulation;box-shadow:0 2px 8px rgba(0,0,0,0.2);display:flex;align-items:center;justify-content:center;',
      onClick: () => openSearch()
    }, '\uD83D\uDD0D');
    c.appendChild(searchBtn);

    // Room navigation FAB
    const roomNavFab = el('button', {
      type: 'button',
      className: 'room-nav-fab',
      onClick: () => {
        const existing = document.getElementById('room-drawer-overlay');
        if (existing) { existing.remove(); return; }
        document.body.appendChild(buildRoomDrawer());
      }
    }, '\uD83D\uDCCD');
    c.appendChild(roomNavFab);

    // Spare photos FAB
    const spareFab = el('button', {
      type: 'button',
      style: 'position:fixed;bottom:160px;right:16px;width:48px;height:48px;background:#f59e0b;color:#fff;border:none;border-radius:50%;font-size:1.3rem;cursor:pointer;z-index:95;box-shadow:0 4px 14px rgba(0,0,0,0.25);touch-action:manipulation;display:flex;align-items:center;justify-content:center;',
      'aria-label': 'Add spare photo',
      onClick: () => {
        const inp = document.createElement('input');
        inp.type = 'file'; inp.accept = 'image/*'; inp.capture = 'environment';
        inp.onchange = async e => {
          if (!e.target.files[0]) return;
          try {
            const dataUrl = await UI.compressImage ? UI.compressImage(e.target.files[0]) : new Promise(r => { const fr = new FileReader(); fr.onload = ev => r(ev.target.result); fr.readAsDataURL(e.target.files[0]); });
            if (!inspection.sparePhotos) inspection.sparePhotos = [];
            const sp = { photoId: 'spare-' + Math.random().toString(36).substr(2,9), timestamp: new Date().toISOString(), caption: '', dataUrl, stepName: step.name, roomName: (getStepData(step.id).roomName || step.name), assignedSlot: null };
            inspection.sparePhotos.push(sp);
            saveNow();
            if (window.savePhotoToDevice) window.savePhotoToDevice(dataUrl, sp.photoId);

            // ── Quick-assign sheet ──────────────────────────────────
            const SPARE_SLOTS_CAPTURE = [
              ...Array.from({length:6}, (_,i) => ({ value: 'obs_' + (i+1),         label: 'Observation ' + (i+1) })),
              ...Array.from({length:6}, (_,i) => ({ value: 'actionTaken_' + (i+1), label: 'Action Taken ' + (i+1) })),
              ...Array.from({length:5}, (_,i) => ({ value: 'followUp_' + (i+1),    label: 'Follow-up ' + (i+1) }))
            ];

            const overlay = document.createElement('div');
            overlay.style = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:9999;display:flex;align-items:flex-end;justify-content:center;';

            const sheet = document.createElement('div');
            sheet.style = 'background:#fff;border-radius:16px 16px 0 0;padding:20px 16px 32px;width:100%;max-width:480px;box-sizing:border-box;';

            const preview = document.createElement('img');
            preview.src = dataUrl;
            preview.style = 'width:100%;max-height:180px;object-fit:cover;border-radius:8px;margin-bottom:14px;';
            sheet.appendChild(preview);

            const sheetTitle = document.createElement('div');
            sheetTitle.style = 'font-size:1rem;font-weight:800;color:#1e293b;margin-bottom:4px;';
            sheetTitle.textContent = '📸 Assign spare photo';
            sheet.appendChild(sheetTitle);

            const sheetSub = document.createElement('div');
            sheetSub.style = 'font-size:12px;color:#64748b;margin-bottom:14px;';
            sheetSub.textContent = 'Pick a section now or skip — you can assign it later in Review.';
            sheet.appendChild(sheetSub);

            const selEl = document.createElement('select');
            selEl.style = 'width:100%;padding:12px;font-size:15px;font-family:inherit;border:2px solid #f59e0b;border-radius:8px;background:#fff;color:#1e293b;-webkit-appearance:none;appearance:none;margin-bottom:14px;box-sizing:border-box;';
            const blankOpt2 = document.createElement('option');
            blankOpt2.value = ''; blankOpt2.textContent = '— Skip for now —';
            selEl.appendChild(blankOpt2);
            SPARE_SLOTS_CAPTURE.forEach(slot => {
              const opt = document.createElement('option');
              opt.value = slot.value; opt.textContent = slot.label;
              selEl.appendChild(opt);
            });
            sheet.appendChild(selEl);

            const capInput = document.createElement('input');
            capInput.type = 'text';
            capInput.placeholder = 'Caption (optional)…';
            capInput.style = 'width:100%;padding:12px;font-size:14px;font-family:inherit;border:1px solid #e5e7eb;border-radius:8px;box-sizing:border-box;margin-bottom:16px;';
            sheet.appendChild(capInput);

            const btnRow = document.createElement('div');
            btnRow.style = 'display:flex;gap:10px;';

            const confirmBtn = document.createElement('button');
            confirmBtn.type = 'button';
            confirmBtn.textContent = 'Save';
            confirmBtn.style = 'flex:1;padding:14px;background:#f59e0b;color:#fff;border:none;border-radius:10px;font-size:1rem;font-weight:700;cursor:pointer;touch-action:manipulation;';
            confirmBtn.onclick = () => {
              if (selEl.value) sp.assignedSlot = selEl.value;
              if (capInput.value.trim()) sp.caption = capInput.value.trim();
              saveNow();
              document.body.removeChild(overlay);
              showToast(selEl.value ? '📸 Spare photo saved + assigned' : '📸 Spare photo saved — assign in Review');
            };

            const skipBtn = document.createElement('button');
            skipBtn.type = 'button';
            skipBtn.textContent = 'Skip';
            skipBtn.style = 'padding:14px 20px;background:transparent;color:#64748b;border:1px solid #e5e7eb;border-radius:10px;font-size:1rem;cursor:pointer;touch-action:manipulation;';
            skipBtn.onclick = () => {
              document.body.removeChild(overlay);
              showToast('📸 Spare photo saved — assign in Review');
            };

            btnRow.appendChild(confirmBtn);
            btnRow.appendChild(skipBtn);
            sheet.appendChild(btnRow);
            overlay.appendChild(sheet);
            document.body.appendChild(overlay);
          } catch(err) { console.error(err); }
        };
        document.body.appendChild(inp); inp.click(); setTimeout(() => inp.remove(), 2000);
      }
    }, '📸');
    c.appendChild(spareFab);

    c.appendChild(el('h1', { className: 'screen-title' }, step.name));

    const fieldGen = STEP_FIELDS[step.type];
    if (fieldGen) {
      const fields = fieldGen();
      const card = el('div', { className: 'card' });
      const onFieldChange = () => {
        data._updatedAt = new Date().toISOString();
        scheduleSave();
        updateShowIf(card, data);
        // Change 3: Detect allSectionsComplete on post-assessment step
        if (step.type === 'post-assessment' && data.finalCheck && data.finalCheck.allSectionsComplete === true) {
          if (_finalSyncTriggeredId !== (inspection && inspection.inspectionId)) {
            _finalSyncTriggeredId = inspection.inspectionId;
            triggerFinalSync();
          }
        }
      };
      fields.forEach(f => {
        const rendered = renderField(f, data, onFieldChange, inspection, () => { scheduleSave(); });
        if (rendered) card.appendChild(rendered);
      });
      updateShowIf(card, data);
      c.appendChild(card);
    }

    if (step.dynamic === 'lowest') {
      const lowestSteps = stepList.filter(s => s.dynamic === 'lowest');
      if (step.id === lowestSteps[lowestSteps.length - 1].id) {
        c.appendChild(el('button', { className: 'btn btn-outline btn-full', onClick: () => { addDynamicRoom('lowest'); window.scrollTo(0, 0); } }, '+ Add Another Room (Lowest Level)'));
      }
    }
    if (step.type === 'bedroom') {
      const bedroomSteps = stepList.filter(s => s.type === 'bedroom');
      if (step.id === bedroomSteps[bedroomSteps.length - 1].id) {
        c.appendChild(el('button', { className: 'btn btn-outline btn-full', style: 'margin-top:8px', onClick: () => { addDynamicRoom('additional', 'Bedroom'); window.scrollTo(0, 0); } }, '+ Add Another Bedroom'));
      }
    }
    if (step.type === 'bathroom') {
      const bathroomSteps = stepList.filter(s => s.type === 'bathroom');
      if (step.id === bathroomSteps[bathroomSteps.length - 1].id) {
        c.appendChild(el('button', { className: 'btn btn-outline btn-full', style: 'margin-top:8px', onClick: () => { addDynamicRoom('additional', 'Bathroom'); window.scrollTo(0, 0); } }, '+ Add Another Bathroom'));
      }
    }
    if (step.phase === 'supplementary' || (step.phase === 'main' && step.id === 'kitchen-air')) {
      if (step.id === 'kitchen-air' || (step.dynamic === 'additional' && step.id === stepList.filter(s => s.dynamic === 'additional').pop()?.id)) {
        c.appendChild(el('button', { className: 'btn btn-outline btn-full', onClick: () => { addDynamicRoom('additional'); window.scrollTo(0, 0); } }, '+ Add Additional Room'));
      }
    }

    data._visited = true;

    const navButtons = [
      currentStepIdx > 0
        ? el('button', { className: 'btn btn-outline btn-nav', onClick: () => { currentStepIdx--; render(); window.scrollTo(0, 0); } }, '\u2190 Back')
        : el('div'),
      el('button', {
        type: 'button',
        className: 'btn btn-outline btn-home',
        onClick: () => {
          if (confirm('Return to home? Your progress is saved.')) {
            setScreen('home');
            render();
          }
        }
      }, '\uD83C\uDFE0'),
      el('button', { className: 'btn btn-primary btn-nav', onClick: () => {
        const missing = validateStep(step);
        if (missing.length) { showToast(missing.length + ' item' + (missing.length > 1 ? 's' : '') + ' still required'); flashUncheckedItems(c); return; }
        const warnings = warnStep(step);
        if (warnings.length) { showToast('\u26a0\ufe0f ' + warnings.join(', '), 3500); }
        data._completedAt = new Date().toISOString();
        currentStepIdx++;
        saveNow().then(() => { render(); window.scrollTo(0, 0); });
        checkpointToCloud(stepList); // fire-and-forget backup - silent on failure
      }}, currentStepIdx < stepList.length - 2 ? 'Next \u2192' : 'Review \u2192')
    ];
    if (isDevMode()) {
      navButtons.push(el('button', { className: 'btn btn-nav', style: 'background:#ff9900;color:#000;font-size:12px;padding:6px 10px;', onClick: () => {
        data._completedAt = new Date().toISOString();
        data._visited = true;
        currentStepIdx++;
        saveNow().then(() => { render(); window.scrollTo(0, 0); });
      }}, 'Skip \u23e9'));
    }
    const nav = el('div', { className: 'bottom-nav' }, navButtons);
    c.appendChild(nav);
    root.appendChild(c);
  }

  // ── REVIEW SCREEN ──────────────────────────────────────────
  function renderReview() {
    const c = el('div', { className: 'screen review-screen' });
    c.appendChild(buildAppHeader('Final Review'));
    c.appendChild(renderStatusBar(getLastSaveText()));

    // Status legend bar
    const legendBar = el('div', { style: 'background:#f0f7ee;border-radius:8px;padding:10px 14px;margin:0 0 8px;font-size:0.8rem;color:#4a5568;line-height:1.6;' });
    legendBar.innerHTML = '<strong style="color:#2C3F16">Status guide:</strong>' +
      ' <span style="background:#e8f5e9;padding:2px 6px;border-radius:4px;">Visited</span> = section opened during inspection.' +
      ' <span style="background:#fef3c7;padding:2px 6px;border-radius:4px;">Not visited</span> = section was skipped.' +
      ' Photos showing <strong>\u2601\ufe0f Uploaded to Drive</strong> have been synced to Google Drive - their local copy has been cleared to save storage.' +
      ' A photo marked <strong>?</strong> or <em>Unreviewed</em> in a report means no caption was added - tap the photo here to add one.';
    c.appendChild(legendBar);

    // ── 6a: Departure Checklist ──
    if (!inspection._departureChecklist) inspection._departureChecklist = {};
    const depData = inspection._departureChecklist;
    const depItems = [
      { key: 'downloadQtrak', label: 'Download Q-Trak data to computer' },
      { key: 'shipSamples', label: 'Ship all lab samples' }
    ];
    const depCard = el('div', { className: 'card' });
    depCard.appendChild(el('h3', { className: 'section-heading' }, 'Before You Leave'));
    const allInspBtn = el('button', {
      className: 'btn btn-outline btn-full',
      onClick: () => { setScreen('home'); inspection = null; setInspection(null); render(); }
    }, 'All Inspections');

    function updateDepState() {
      const allDone = depItems.every(i => !!depData[i.key]);
      allInspBtn.disabled = !allDone;
      allInspBtn.style.opacity = allDone ? '1' : '0.4';
      allInspBtn.style.pointerEvents = allDone ? 'auto' : 'none';
      scheduleSave();
    }

    depItems.forEach(item => {
      depCard.appendChild(renderCheck(item.key, item.label, !!depData[item.key], v => {
        depData[item.key] = v;
        updateDepState();
      }));
    });
    c.appendChild(depCard);

    const hCard = el('div', { className: 'card' });
    hCard.appendChild(el('h3', { className: 'section-heading' }, 'Inspection Details'));
    const infoFields = [
      ['ID', inspection.inspectionId], ['Inspector', inspection.inspectorName],
      ['Client', inspection.clientName], ['Address', inspection.propertyAddress],
      ['Date', inspection.inspectionDate], ['Levels', inspection.numberOfLevels],
      ['Bedrooms', inspection.numberOfBedrooms], ['Bathrooms', inspection.numberOfBathrooms],
      ['Water Source', (Array.isArray(inspection.waterSource) ? inspection.waterSource.join(', ') : (inspection.waterSource || '--')) + (inspection.waterSourceDescription ? ' (' + inspection.waterSourceDescription + ')' : '')],
      ['Wifi', inspection.wifiNetwork],
      ['Occupancy', inspection.stepData?.['property-details']?.occupancyDuringInspection], ['Weather', inspection.stepData?.['property-details']?.weatherConditions],
      ['Started', fmtDate(inspection.startedAt)], ['Status', inspection.status]
    ];
    infoFields.forEach(([l, v]) => {
      hCard.appendChild(el('div', { className: 'info-row' }, [
        el('span', { className: 'info-label' }, l),
        el('span', { className: 'info-value' }, v || '--')
      ]));
    });
    if (inspection.clientConcerns) hCard.appendChild(el('div', { className: 'info-block' }, [el('strong', null, 'Client Concerns: '), document.createTextNode(inspection.clientConcerns)]));
    if (inspection.knownProblemAreas) hCard.appendChild(el('div', { className: 'info-block' }, [el('strong', null, 'Known Problem Areas: '), document.createTextNode(inspection.knownProblemAreas)]));
    c.appendChild(hCard);

    // ── Room Summaries ──
    const summariesCard = el('div', { className: 'card' });
    summariesCard.appendChild(el('h3', { className: 'section-heading' }, 'Room Findings'));

    // Collect all rooms that have raw notes OR an AI summary
    const roomStepTypes = ['room-test','bedroom','bathroom','living-area','kitchen-appliance','water-sample','atp-kitchen','kitchen-air','additional-room','utility'];
    const roomSteps = stepList.filter(s => {
      if (!roomStepTypes.includes(s.type)) return false;
      const d = inspection.stepData && inspection.stepData[s.id];
      return d && (d.aiSummary || d.notes || (d.observations && d.observations.length) || d.followUpNote);
    });

    if (roomSteps.length === 0) {
      summariesCard.appendChild(el('p', { style: 'color:var(--text-muted);font-size:0.9rem;padding:8px 0;' }, 'No room findings yet'));
    } else {
      roomSteps.forEach(s => {
        const d = inspection.stepData[s.id];
        const roomBlock = el('div', { style: 'margin-bottom:16px;padding-bottom:16px;border-bottom:1px solid var(--accent-light);' });

        // Room name
        roomBlock.appendChild(el('div', { style: 'font-weight:700;font-size:1rem;color:var(--primary);margin-bottom:8px;' }, d.roomName || s.name));

        // Raw notes side
        const hasObs = d.observations && d.observations.length > 0;
        const hasNotes = d.notes && d.notes.trim();
        const hasFollowUp = d.followUpNote && d.followUpNote.trim();
        const hasRaw = hasObs || hasNotes || hasFollowUp;

        if (hasRaw) {
          const rawBlock = el('div', { style: 'background:#f8f9fa;border-left:3px solid #aaa;border-radius:0 6px 6px 0;padding:8px 10px;margin-bottom:8px;font-size:0.85rem;' });
          rawBlock.appendChild(el('div', { style: 'font-size:0.75rem;font-weight:600;color:#666;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px;' }, 'Inspector Notes'));
          if (hasObs) rawBlock.appendChild(el('div', { style: 'margin-bottom:4px;' }, 'Observations: ' + d.observations.join(', ')));
          if (hasNotes) rawBlock.appendChild(el('div', { style: 'margin-bottom:4px;' }, d.notes.trim()));
          if (hasFollowUp) rawBlock.appendChild(el('div', { style: 'color:#b45309;' }, '⚠️ Follow-up: ' + d.followUpNote.trim()));
          roomBlock.appendChild(rawBlock);
        }

        // AI summary side
        if (d.aiSummary) {
          const aiBlock = el('div', { style: 'background:#f0f7ee;border-left:3px solid var(--primary);border-radius:0 6px 6px 0;padding:8px 10px;font-size:0.85rem;' });
          aiBlock.appendChild(el('div', { style: 'font-size:0.75rem;font-weight:600;color:var(--primary);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px;' }, 'AI Summary'));
          aiBlock.appendChild(el('div', null, d.aiSummary));
          roomBlock.appendChild(aiBlock);
        }

        summariesCard.appendChild(roomBlock);
      });
    }
    c.appendChild(summariesCard);

    stepList.forEach((step, idx) => {
      if (step.type === 'review') return;
      const data = (inspection.stepData && inspection.stepData[step.id]) || {};
      const visited = !!data._visited;
      const sCard = el('div', { className: 'card' + (!visited ? ' card-incomplete' : '') });
      sCard.appendChild(el('div', { className: 'review-step-header' }, [
        el('h3', { className: 'section-heading' }, [
          document.createTextNode(step.name + ' '),
          el('span', { className: 'badge ' + (visited ? 'completed' : 'in-progress') }, visited ? 'Visited' : 'Not visited')
        ]),
        el('button', { className: 'btn btn-small btn-outline', onClick: () => { currentStepIdx = idx; setScreen('step'); render(); } }, 'Edit')
      ]));

      const summary = el('div', { className: 'review-summary' });
      const fieldGen = STEP_FIELDS[step.type];
      if (fieldGen && visited) {
        const fields = fieldGen();
        fields.forEach(f => {
          if (!f.key || f.type === 'heading' || f.type === 'info' || f.type === 'divider' || f.type === 'photo' || f.type === 'timer') return;
          const val = data[f.key];
          if (val === undefined || val === null || val === '') return;
          let display = '';
          if (f.type === 'reading' && typeof val === 'object') {
            if (val.status === 'not_tested') display = 'Not tested';
            else if (val.status === 'not_applicable') display = 'N/A';
            else if (val.value != null) display = val.value + (val.unit ? ' ' + val.unit : '');
            else return;
          } else if (f.type === 'checklist' && typeof val === 'object') {
            const checked = Object.entries(val).filter(([, v]) => v === true).length;
            display = checked + '/' + (f.items ? f.items.length : 0) + ' checked';
          } else if (f.type === 'chips' && Array.isArray(val)) {
            if (!val.length) return;
            display = val.join(', ');
          } else if (typeof val === 'boolean') {
            display = val ? 'Yes' : 'No';
          } else {
            display = String(val);
          }
          summary.appendChild(el('div', { className: 'review-item' }, [
            el('span', { className: 'review-item-label' }, (f.label || f.key) + ': '),
            el('span', null, display)
          ]));
        });
        // Show all photo arrays (handles _photos, _beforePhotos, _afterPhotos, ATP photos, etc.)
        const photoArrayKeys = Object.keys(data).filter(k =>
          k.startsWith('_') && Array.isArray(data[k]) && data[k].length &&
          data[k][0] && typeof data[k][0].photoId === 'string'
        );
        photoArrayKeys.forEach(pk => {
          const arr = data[pk];
          const labelRaw = pk.slice(1).replace(/Photos$/, '').replace(/([A-Z])/g, ' $1').trim();
          const label = (labelRaw || 'All') + ' Photos';
          summary.appendChild(el('div', { className: 'review-photos-section' }, [el('strong', null, arr.length + ' ' + label + ':')]));
          const grid = el('div', { className: 'review-photo-grid' });
          arr.forEach(p => {
            grid.appendChild(el('div', { className: 'review-photo-item' }, [
              el('img', { src: p.dataUrl, className: 'review-photo-img' }),
              p.caption ? el('div', { className: 'review-photo-caption' }, p.caption) : null
            ]));
          });
          summary.appendChild(grid);
        });
      }
      sCard.appendChild(summary);
      c.appendChild(sCard);
    });

    const exportData = buildExportJSON(stepList);

    const actCard = el('div', { className: 'card actions-card' });

    if (inspection.status !== 'completed') {
      const submitBtn = el('button', { className: 'btn btn-primary btn-full', onClick: () => {
        const unvisited = stepList.filter(s => s.type !== 'review' && !(inspection.stepData && inspection.stepData[s.id] && inspection.stepData[s.id]._visited));
        const atpData = (inspection.stepData && inspection.stepData['atp-kitchen']) || {};
        const atpIssues = [];
        if (!(atpData._atpBeforePhotos && atpData._atpBeforePhotos.length)) atpIssues.push('ATP Before photo missing');
        if (!(atpData._atpAfterPhotos && atpData._atpAfterPhotos.length)) atpIssues.push('ATP After photo missing');
        const allIssues = [
          ...unvisited.map(s => 'Section not visited: ' + s.name),
          ...atpIssues
        ];
        if (allIssues.length) {
          const names = allIssues.join('\n\u2022 ');
          alert('The following items are incomplete:\n\u2022 ' + names + '\n\nPlease address these before marking as complete.');
          return;
        }
        submitBtn.disabled = true;
        submitBtn.textContent = 'Submitting... \u23f3';
        inspection.status = 'completed';
        inspection.endedAt = new Date().toISOString();
        inspection.completedAt = inspection.endedAt;
        const completeData = buildExportJSON(stepList);
        saveNow().then(() => {
          submitInspection(completeData).then(ok => {
            if (!ok) { submitBtn.disabled = false; submitBtn.textContent = '\u2713 Submit Inspection'; }
          });
          setScreen('home'); inspection = null; setInspection(null); render();
        });
      }}, '\u2713 Submit Inspection');
      actCard.appendChild(submitBtn);
    } else {
      const reuploadBtn = el('button', { className: 'btn btn-outline btn-full', onClick: async () => {
        reuploadBtn.disabled = true;
        reuploadBtn.textContent = 'Uploading\u2026 \u23f3';
        try {
          const reuploadData = buildExportJSON(stepList);
          // Send main data first (no photos)
          const mainPayload = stripPhotosFromExport(reuploadData);
          await scriptFetch(mainPayload);
          // Send photos one at a time to avoid payload size limits
          const allPhotos = extractAllPhotosFromExport(reuploadData);
          for (let i = 0; i < allPhotos.length; i++) {
            reuploadBtn.textContent = 'Uploading photo ' + (i + 1) + ' of ' + allPhotos.length + '\u2026';
            await uploadPhotoImmediate(
              { photoId: allPhotos[i].photoId, roomName: allPhotos[i].roomName, stepName: allPhotos[i].stepName, dataUrl: allPhotos[i].imageData, caption: allPhotos[i].caption || '' },
              reuploadData.inspectionId,
              reuploadData.clientName || '',
              reuploadData.propertyAddress || ''
            );
          }
          reuploadBtn.textContent = '\u2713 Upload Complete (' + allPhotos.length + ' photos)';
        } catch(e) {
          reuploadBtn.disabled = false;
          reuploadBtn.textContent = '\u21ba Re-upload to Drive';
          alert('Upload failed: ' + e.message);
        }
      }}, '\u21ba Re-upload to Drive');
      actCard.appendChild(el('div', { className: 'completed-banner' }, [
        el('strong', null, '\u2713 Inspection Complete'),
        el('p', null, 'Completed: ' + fmtDate(inspection.endedAt)),
        reuploadBtn
      ]));
    }
    c.appendChild(actCard);

    // Initial departure checklist state
    updateDepState();

    c.appendChild(el('div', { className: 'bottom-nav' }, [
      el('button', { className: 'btn btn-outline btn-nav', onClick: () => {
        if (inspection.status !== 'completed') { currentStepIdx = stepList.length - 2; setScreen('step'); }
        else { setScreen('home'); inspection = null; setInspection(null); }
        render();
      }}, inspection.status !== 'completed' ? '\u2190 Back to Steps' : '\u2190 Home'),
      allInspBtn
    ]));


    // Spare Photos section in Review
    if (inspection.sparePhotos && inspection.sparePhotos.length) {
      const SPARE_SLOTS = [
        ...Array.from({length:6}, (_,i) => ({ value: 'obs_' + (i+1),        label: 'Observation ' + (i+1) })),
        ...Array.from({length:6}, (_,i) => ({ value: 'actionTaken_' + (i+1), label: 'Action Taken ' + (i+1) })),
        ...Array.from({length:5}, (_,i) => ({ value: 'followUp_' + (i+1),   label: 'Follow-up ' + (i+1) }))
      ];

      const unassigned = inspection.sparePhotos.filter(sp => !sp.assignedSlot);
      const assigned   = inspection.sparePhotos.filter(sp =>  sp.assignedSlot);

      // ── Bucket header ──
      const spHead = document.createElement('div');
      spHead.style = 'background:' + (unassigned.length ? '#fff8e1' : '#f0fdf4') + ';border-left:4px solid ' + (unassigned.length ? '#f59e0b' : '#22c55e') + ';padding:12px 16px;margin:16px 0 8px;border-radius:4px;display:flex;align-items:center;justify-content:space-between;';
      spHead.innerHTML = '<span style="font-weight:800;color:' + (unassigned.length ? '#92400e' : '#166534') + ';">📸 Spare Photos (' + inspection.sparePhotos.length + ')</span>' +
        (unassigned.length ? '<span style="font-size:12px;font-weight:700;background:#f59e0b;color:#fff;padding:2px 10px;border-radius:99px;">' + unassigned.length + ' need assignment</span>' : '<span style="font-size:12px;color:#166534;">✓ All assigned</span>');
      c.appendChild(spHead);

      // ── Render a single spare photo card ──
      function renderSpareCard(sp, i) {
        const spCard = document.createElement('div');
        spCard.className = 'photo-card';
        spCard.style = 'margin-bottom:10px;border:2px solid ' + (sp.assignedSlot ? '#22c55e' : '#f59e0b') + ';border-radius:8px;overflow:hidden;';
        spCard.id = 'spare-card-' + sp.photoId;

        // Photo
        const spImg = document.createElement('img');
        spImg.src = sp.dataUrl || '';
        spImg.className = 'photo-img';
        spImg.alt = 'Spare ' + (i + 1);
        spCard.appendChild(spImg);

        // Meta
        const spMeta = document.createElement('div');
        spMeta.style = 'padding:4px 10px;font-size:11px;color:#64748b;';
        spMeta.textContent = 'Captured during: ' + (sp.roomName || sp.stepName || 'inspection') + ' • ' + new Date(sp.timestamp).toLocaleTimeString();
        spCard.appendChild(spMeta);

        // Caption
        const spCap = document.createElement('input');
        spCap.type = 'text';
        spCap.placeholder = 'Caption…';
        spCap.value = sp.caption || '';
        spCap.style = 'width:100%;border:none;border-top:1px solid #e5e7eb;padding:10px;font-size:13px;font-family:inherit;box-sizing:border-box;';
        spCap.oninput = () => { sp.caption = spCap.value; scheduleSave(); };
        spCard.appendChild(spCap);

        // ── AI Caption Suggestion (spare photos) ────────────────────
        if (sp.dataUrl && sp.dataUrl !== '__uploaded__') {
          const aiSpareBtn = document.createElement('button');
          aiSpareBtn.type = 'button';
          aiSpareBtn.textContent = '✨ Suggest caption';
          aiSpareBtn.style = 'display:block;width:100%;padding:6px 10px;border-top:1px solid #e5e7eb;background:#f0f4ff;border-left:none;border-right:none;border-bottom:none;color:#3a5ec5;font-size:0.82rem;font-weight:600;cursor:pointer;text-align:left;';
          aiSpareBtn.onclick = async () => {
            aiSpareBtn.disabled = true;
            aiSpareBtn.textContent = '⏳ Analyzing photo...';
            try {
              const PROXY_URL = VISION_PROXY_URL;
              const base64 = sp.dataUrl.split(',')[1];
              const mimeType = (sp.dataUrl.split(';')[0].split(':')[1]) || 'image/jpeg';
              const prompt = 'You are a home health inspector writing a caption for a photo taken during a residential inspection.' +
                ' The caption should be 1-2 sentences, written in plain, accessible language — not overly technical.' +
                ' Describe what is visible in the photo.' +
                ' If there is any issue present, briefly explain how it could affect the health or comfort of the home\'s occupants if left unaddressed (e.g. mold risk, air quality, water quality, structural safety).' +
                ' If the photo shows something that appears normal and fine, just describe it briefly.' +
                ' Do not use alarming language. Be matter-of-fact and helpful.' +
                (sp.roomName ? ' Room: ' + sp.roomName + '.' : '') +
                (sp.stepName ? ' Section: ' + sp.stepName + '.' : '') +
                ' Return ONLY the caption text, no quotes, no labels, no extra formatting.';
              const resp = await fetch(PROXY_URL, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ imageBase64: base64, mimeType, prompt })
              });
              if (!resp.ok) throw new Error('API_ERROR ' + resp.status);
              const result = await resp.json();
              const text = result.content && result.content[0] && result.content[0].text;
              if (!text) throw new Error('EMPTY_RESPONSE');
              sp.caption = text.trim();
              spCap.value = sp.caption;
              scheduleSave();
              aiSpareBtn.textContent = '✓ Caption added — edit if needed';
              aiSpareBtn.style.background = '#edfaf1';
              aiSpareBtn.style.color = '#1e7e34';
              setTimeout(() => {
                aiSpareBtn.textContent = '✨ Re-suggest caption';
                aiSpareBtn.disabled = false;
                aiSpareBtn.style.background = '#f0f4ff';
                aiSpareBtn.style.color = '#3a5ec5';
              }, 3000);
            } catch (err) {
              aiSpareBtn.disabled = false;
              aiSpareBtn.textContent = '✨ Suggest caption';
            }
          };
          spCard.appendChild(aiSpareBtn);
        }

        // Section assignment dropdown
        const assignWrap = document.createElement('div');
        assignWrap.style = 'padding:8px 10px;border-top:1px solid #e5e7eb;background:#f8fafc;';

        const assignLabel = document.createElement('div');
        assignLabel.style = 'font-size:11px;font-weight:700;color:#64748b;margin-bottom:4px;text-transform:uppercase;letter-spacing:0.05em;';
        assignLabel.textContent = 'Assign to section';
        assignWrap.appendChild(assignLabel);

        const sel = document.createElement('select');
        sel.style = 'width:100%;padding:10px 12px;font-size:14px;font-family:inherit;border:2px solid ' + (sp.assignedSlot ? '#22c55e' : '#f59e0b') + ';border-radius:6px;background:#fff;color:#1e293b;-webkit-appearance:none;appearance:none;cursor:pointer;';

        const blankOpt = document.createElement('option');
        blankOpt.value = '';
        blankOpt.textContent = '— Select section —';
        sel.appendChild(blankOpt);

        SPARE_SLOTS.forEach(slot => {
          const opt = document.createElement('option');
          opt.value = slot.value;
          opt.textContent = slot.label;
          if (sp.assignedSlot === slot.value) opt.selected = true;
          sel.appendChild(opt);
        });

        sel.onchange = () => {
          sp.assignedSlot = sel.value || null;
          scheduleSave();
          // Refresh the whole spare photos section so bucket counts update
          const container = document.getElementById('spare-photos-container');
          if (container) {
            container.parentNode.removeChild(container);
          }
          renderSpareSection();
        };

        assignWrap.appendChild(sel);
        spCard.appendChild(assignWrap);
        return spCard;
      }

      // ── Render the full spare section ──
      function renderSpareSection() {
        const wrap = document.createElement('div');
        wrap.id = 'spare-photos-container';

        const unassignedNow = inspection.sparePhotos.filter(sp => !sp.assignedSlot);
        const assignedNow   = inspection.sparePhotos.filter(sp =>  sp.assignedSlot);

        // Update header
        spHead.style.background = unassignedNow.length ? '#fff8e1' : '#f0fdf4';
        spHead.style.borderLeftColor = unassignedNow.length ? '#f59e0b' : '#22c55e';
        spHead.innerHTML = '<span style="font-weight:800;color:' + (unassignedNow.length ? '#92400e' : '#166534') + ';">📸 Spare Photos (' + inspection.sparePhotos.length + ')</span>' +
          (unassignedNow.length ? '<span style="font-size:12px;font-weight:700;background:#f59e0b;color:#fff;padding:2px 10px;border-radius:99px;">' + unassignedNow.length + ' need assignment</span>' : '<span style="font-size:12px;color:#166534;">✓ All assigned</span>');

        // Unassigned bucket
        if (unassignedNow.length) {
          const bucketHdr = document.createElement('div');
          bucketHdr.style = 'font-size:11px;font-weight:700;color:#92400e;text-transform:uppercase;letter-spacing:0.05em;padding:8px 0 4px;';
          bucketHdr.textContent = '⚠️ Needs assignment (' + unassignedNow.length + ')';
          wrap.appendChild(bucketHdr);
          unassignedNow.forEach((sp, i) => wrap.appendChild(renderSpareCard(sp, inspection.sparePhotos.indexOf(sp))));
        }

        // Assigned bucket
        if (assignedNow.length) {
          const assignedHdr = document.createElement('div');
          assignedHdr.style = 'font-size:11px;font-weight:700;color:#166534;text-transform:uppercase;letter-spacing:0.05em;padding:12px 0 4px;';
          assignedHdr.textContent = '✓ Assigned (' + assignedNow.length + ')';
          wrap.appendChild(assignedHdr);
          assignedNow.forEach((sp, i) => wrap.appendChild(renderSpareCard(sp, inspection.sparePhotos.indexOf(sp))));
        }

        c.appendChild(wrap);
      }

      renderSpareSection();
    }

    root.appendChild(c);
    window.scrollTo(0, 0);
  }

  // buildExportJSON, cleanStepData → moved to inspection.js

  // ── Init ───────────────────────────────────────────────────
  initStorage({ onSyncStatusChange: updateSyncStatus });

  window.addEventListener('online', () => {
    const badge = document.querySelector('.online-badge');
    if (badge) { badge.textContent = ''; badge.className = 'online-badge online'; }
  });
  window.addEventListener('offline', () => {
    const badge = document.querySelector('.online-badge');
    if (badge) { badge.textContent = '\u25cf Offline'; badge.className = 'online-badge offline'; }
    updateSyncStatus('offline'); // Change 2
  });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('service-worker.js').catch(e => console.log('SW failed:', e));
  }

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

  // ── Periodic auto-save every 30s (safety net) ───────────────
  setInterval(() => {
    if (inspection && getScreen() === 'step') {
      saveNow();
    }
  }, 30000);

  // ── 5-minute auto-checkpoint + localStorage backup ────────────
  // Pushes full data JSON to Drive every 5 minutes during active inspection.
  // Also refreshes localStorage mirror. Belt-and-suspenders against data loss.
  setInterval(() => {
    if (inspection && getScreen() === 'step') {
      checkpointToCloud(stepList);
      backupToLocalStorage();
    }
  }, 5 * 60 * 1000);

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
