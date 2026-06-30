// InHaus Inspector - Configuration Constants

// ── Google Drive Export Config ─────────────────────────────
// Google Apps Script web app URL
export const GOOGLE_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxmOMfSGaz9sDHxAKBjNXtJ44MLdusXRe-GOrV6nGH0Iw0tciFg1Wkw-02hB-dQglAbgQ/exec';

// ── Sync secret ────────────────────────────────────────────
// Frontend token only — not a true secret. Must match SYNC_SECRET in Apps Script Properties.
export const SYNC_SECRET = 'ihl-873c6c3fc4dd26a348a8ab2b9ba2a4323514273f025edb1c'; // Rotated June 28 2026 — now validated server-side only
// Fallback for the currently deployed Apps Script, which still accepts the pre-rotation value.
// Keep this until the deployed script URL is verified against the rotated SYNC_SECRET.
export const LEGACY_SYNC_SECRET = 'ihl-sync-2026';

// ── Google Shared Drive Config ──────────────────────────────
// Shared Drive folder ID where per-assessment subfolders should be created.
// Find it in the URL when browsing the Shared Drive in Google Drive:
//   https://drive.google.com/drive/u/0/folders/[FOLDER_ID_HERE]
export const SHARED_DRIVE_FOLDER_ID = ''; // e.g. '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms'

// ── AI Vision Proxy Config ──────────────────────────────────
export const VISION_PROXY_URL = 'https://inhaus-vision-proxy.mjordanjay.workers.dev';
