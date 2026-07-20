// InHaus Inspector - Shared Mutable State

let _inspection = null;
let _screen = 'home'; // home | truck-check | intake | precheck | step | review | photos
let _syncStatus = 'local'; // local | synced | syncing | checkpoint | failed | offline | final-failed
let _dirty = false;
const ACTIVE_POSITION_KEY = 'inhausActivePosition';

function cleanTimestamp(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function loadSyncTimestampsFromInspection(inspection) {
  _lastSuccessfulCloudSyncAt = cleanTimestamp(inspection && inspection._lastSuccessfulCloudSyncAt);
  _lastCheckpointAttemptAt = cleanTimestamp(inspection && inspection._lastCheckpointAttemptAt);
  _lastCheckpointSucceededAt = cleanTimestamp(inspection && inspection._lastCheckpointSucceededAt);
}

// ── inspection ──────────────────────────────────────────────
export function getInspection() { return _inspection; }
export function setInspection(v) {
  _inspection = v;
  if (typeof window !== 'undefined') window.inspection = v;
  loadSyncTimestampsFromInspection(v);
}

// ── screen ──────────────────────────────────────────────────
export function getScreen() { return _screen; }
export function setScreen(v) { _screen = v; }

// ── Active inspection position ─────────────────────────────
// localStorage survives Safari reloads and service-worker cache restarts.
export function saveActivePosition(inspection, stepIdx, screen) {
  if (!inspection || inspection.status !== 'in-progress' || !inspection.inspectionId) return false;
  try {
    localStorage.setItem(ACTIVE_POSITION_KEY, JSON.stringify({
      inspectionId: inspection.inspectionId,
      stepIdx: Number.isInteger(Number(stepIdx)) ? Number(stepIdx) : 0,
      screen: String(screen || 'step')
    }));
    return true;
  } catch (err) {
    console.warn('Could not save active inspection position:', err);
    return false;
  }
}

export function loadActivePosition() {
  try {
    const raw = localStorage.getItem(ACTIVE_POSITION_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    if (!saved || !saved.inspectionId) throw new Error('invalid_active_position');
    return {
      inspectionId: String(saved.inspectionId),
      stepIdx: Number.isInteger(Number(saved.stepIdx)) ? Number(saved.stepIdx) : 0,
      screen: String(saved.screen || 'step')
    };
  } catch (err) {
    try { localStorage.removeItem(ACTIVE_POSITION_KEY); } catch (_) {}
    return null;
  }
}

export function clearActivePosition(inspectionId) {
  try {
    if (inspectionId) {
      const saved = loadActivePosition();
      if (saved && saved.inspectionId !== inspectionId) return false;
    }
    localStorage.removeItem(ACTIVE_POSITION_KEY);
    return true;
  } catch (err) {
    return false;
  }
}

// ── syncStatus ──────────────────────────────────────────────
export function getSyncStatus() { return _syncStatus; }
export function setSyncStatus(v) { _syncStatus = v; }

// ── dirty flag ──────────────────────────────────────────────
export function isDirty() { return _dirty; }
export function setDirty(v) { _dirty = !!v; }

// ── lastSaveText ────────────────────────────────────────────
let _lastSaveText = '';
export function getLastSaveText() { return _lastSaveText; }
export function setLastSaveText(v) { _lastSaveText = v; }

// ── lastLocalSaveAt ─────────────────────────────────────────
let _lastLocalSaveAt = null;
export function getLastLocalSaveAt() { return _lastLocalSaveAt; }
export function setLastLocalSaveAt(v) { _lastLocalSaveAt = v; }

// ── lastSuccessfulCloudSyncAt ───────────────────────────────
let _lastSuccessfulCloudSyncAt = null;
export function getLastSuccessfulCloudSyncAt() { return _lastSuccessfulCloudSyncAt; }
export function setLastSuccessfulCloudSyncAt(v) {
  _lastSuccessfulCloudSyncAt = cleanTimestamp(v);
  if (_inspection) _inspection._lastSuccessfulCloudSyncAt = _lastSuccessfulCloudSyncAt;
}

// ── lastCheckpointAttemptAt ─────────────────────────────────
let _lastCheckpointAttemptAt = null;
export function getLastCheckpointAttemptAt() { return _lastCheckpointAttemptAt; }
export function setLastCheckpointAttemptAt(v) {
  _lastCheckpointAttemptAt = cleanTimestamp(v);
  if (_inspection) _inspection._lastCheckpointAttemptAt = _lastCheckpointAttemptAt;
}

// ── lastCheckpointSucceededAt ───────────────────────────────
let _lastCheckpointSucceededAt = null;
export function getLastCheckpointSucceededAt() { return _lastCheckpointSucceededAt; }
export function setLastCheckpointSucceededAt(v) {
  _lastCheckpointSucceededAt = cleanTimestamp(v);
  if (_inspection) _inspection._lastCheckpointSucceededAt = _lastCheckpointSucceededAt;
}

export function getBestCloudSyncAt() {
  return Math.max(_lastSuccessfulCloudSyncAt || 0, _lastCheckpointSucceededAt || 0) || null;
}
