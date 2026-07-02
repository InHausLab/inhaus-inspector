// InHaus Inspector - Configuration Constants

// ── Google Drive Export Config ─────────────────────────────
// Google Apps Script web app URL
export const GOOGLE_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxmOMfSGaz9sDHxAKBjNXtJ44MLdusXRe-GOrV6nGH0Iw0tciFg1Wkw-02hB-dQglAbgQ/exec'; // v37 — verified July 1 2026

// ── Sync secret ────────────────────────────────────────────
// Frontend token only - not a true secret. Must match SYNC_SECRET in Apps Script Properties.
// The deployed Apps Script currently accepts this value.
export const SYNC_SECRET = 'ihl-sync-2026';
// Keep as a same-value fallback for cached clients and duplicate-secret de-duping.
export const LEGACY_SYNC_SECRET = 'ihl-sync-2026';

// ── Google Shared Drive Config ──────────────────────────────
// Shared Drive folder ID where per-assessment subfolders should be created.
// Find it in the URL when browsing the Shared Drive in Google Drive:
//   https://drive.google.com/drive/u/0/folders/[FOLDER_ID_HERE]
export const SHARED_DRIVE_FOLDER_ID = ''; // e.g. '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms'

// ── AI Vision Proxy Config ──────────────────────────────────
export const VISION_PROXY_URL = 'https://inhaus-vision-proxy.mjordanjay.workers.dev';
