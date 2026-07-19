// InHaus Inspector - Storage (save/load/backup logic)
import { getInspection, setLastSaveText, getLastLocalSaveAt, setLastLocalSaveAt } from './state.js?v=161';

let _onSyncStatusChange = null;
let _saveTimeout = null;

export function initStorage({ onSyncStatusChange }) {
  _onSyncStatusChange = onSyncStatusChange;
}

function showSave(msg) {
  setLastSaveText(msg);
  var saveEl = document.getElementById('save-status');
  if (saveEl) { saveEl.textContent = msg; saveEl.style.color = ''; saveEl.onclick = null; saveEl.style.cursor = ''; }
}

function showSaveError(msg) {
  _onSyncStatusChange('failed');
  // Legacy high-visibility banner so Dave notices immediately
  var banner = document.getElementById('save-error-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'save-error-banner';
    banner.style.cssText = 'position:fixed;top:0;left:0;right:0;background:#c0392b;color:#fff;font-size:15px;font-weight:bold;text-align:center;padding:12px;z-index:99999;cursor:pointer;';
    banner.addEventListener('click', function() { banner.remove(); });
    document.body.appendChild(banner);
  }
  banner.textContent = msg + ' - Tap to dismiss';
}

export async function saveNow() {
  const inspection = getInspection();
  if (!inspection) return;
  showSave('Saving...');
  try {
    await window.DB.save(inspection);
    setLastLocalSaveAt(Date.now()); // Change 1
    const t = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    _onSyncStatusChange('local'); // Change 2
    backupToLocalStorage(); // mirror to localStorage as secondary safety net
    // Clear any previous error banners
    const b = document.getElementById('save-error-banner');
    if (b) b.remove();
  } catch (e) {
    console.error('Save failed:', e);
    if (e && (e.name === 'QuotaExceededError' || (e.message && e.message.includes('quota')))) {
      showSaveError('\u26a0\ufe0f Storage full \u2014 SCREENSHOT THIS SCREEN NOW then tap Sync to Drive');
    } else {
      showSaveError('\u26a0\ufe0f Save failed \u2014 data may be lost on reload. Tap Sync to Drive now.');
    }
  }
}

export function scheduleSave() {
  if (_saveTimeout) clearTimeout(_saveTimeout);
  _saveTimeout = setTimeout(saveNow, 300);
}

// ── localStorage Shadow Backup ────────────────────────────
// Secondary safety net: stores inspection JSON (no photo data) in localStorage.
// Survives IndexedDB failures, quota issues, and accidental clears.
export function backupToLocalStorage() {
  const inspection = getInspection();
  if (!inspection || !inspection.inspectionId) return;
  try {
    const bak = JSON.parse(JSON.stringify(inspection));
    // Strip photo dataUrls - keep metadata only, not pixel data
    if (bak.stepData) {
      Object.values(bak.stepData).forEach(step => {
        Object.keys(step).forEach(k => {
          if (Array.isArray(step[k]) && step[k].length && step[k][0] && typeof step[k][0].photoId === 'string') {
            step[k] = step[k].map(p => ({
              photoId: p.photoId, stepName: p.stepName, roomName: p.roomName,
              caption: p.caption, timestamp: p.timestamp,
              placementSource: p.placementSource || '',
              routingStatus: p.routingStatus || '',
              assignedSlot: p.assignedSlot || null,
              uploaded: p.dataUrl === '__uploaded__'
            }));
          }
        });
      });
    }
    if (Array.isArray(bak.sparePhotos)) {
      bak.sparePhotos = bak.sparePhotos.map(p => ({
        photoId: p.photoId,
        stepName: p.stepName,
        roomName: p.roomName,
        caption: p.caption,
        timestamp: p.timestamp,
        placementSource: p.placementSource || '',
        routingStatus: p.routingStatus || '',
        assignedSlot: p.assignedSlot || null,
        uploaded: p.dataUrl === '__uploaded__'
      }));
    }
    const key = 'inhaus_bak_' + inspection.inspectionId;
    localStorage.setItem(key, JSON.stringify({ data: bak, savedAt: new Date().toISOString() }));
    cleanOldLocalStorageBackups();
  } catch(e) { /* localStorage full or unavailable - not critical */ }
}

function cleanOldLocalStorageBackups() {
  try {
    const keys = Object.keys(localStorage).filter(k => k.startsWith('inhaus_bak_'));
    if (keys.length <= 5) return;
    const withTime = keys.map(k => {
      try { return { k, t: JSON.parse(localStorage.getItem(k)).savedAt }; } catch(e) { return { k, t: '' }; }
    }).sort((a, b) => (a.t < b.t ? -1 : 1));
    withTime.slice(0, withTime.length - 5).forEach(({ k }) => localStorage.removeItem(k));
  } catch(e) {}
}
