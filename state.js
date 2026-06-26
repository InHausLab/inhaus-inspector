// InHaus Inspector - Shared Mutable State

let _inspection = null;
let _screen = 'home'; // home | truck-check | intake | precheck | step | review
let _syncStatus = 'local'; // local | synced | syncing | checkpoint | failed | offline | final-failed
let _dirty = false;

// ── inspection ──────────────────────────────────────────────
export function getInspection() { return _inspection; }
export function setInspection(v) { _inspection = v; }

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
export function setLastSuccessfulCloudSyncAt(v) { _lastSuccessfulCloudSyncAt = v; }

// ── lastCheckpointAttemptAt ─────────────────────────────────
let _lastCheckpointAttemptAt = null;
export function getLastCheckpointAttemptAt() { return _lastCheckpointAttemptAt; }
export function setLastCheckpointAttemptAt(v) { _lastCheckpointAttemptAt = v; }

// ── lastCheckpointSucceededAt ───────────────────────────────
let _lastCheckpointSucceededAt = null;
export function getLastCheckpointSucceededAt() { return _lastCheckpointSucceededAt; }
export function setLastCheckpointSucceededAt(v) { _lastCheckpointSucceededAt = v; }
