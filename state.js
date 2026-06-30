// InHaus Inspector - Shared Mutable State

let _inspection = null;
let _screen = 'home'; // home | truck-check | intake | precheck | step | review | photos
let _syncStatus = 'local'; // local | synced | syncing | checkpoint | failed | offline | final-failed
let _dirty = false;

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
  loadSyncTimestampsFromInspection(v);
}

// ── screen ──────────────────────────────────────────────────
export function getScreen() { return _screen; }
export function setScreen(v) { _screen = v; }

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
