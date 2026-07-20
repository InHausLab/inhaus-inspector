// InHaus Inspector - Configuration Constants

// ── Google Drive Export Config ─────────────────────────────
// Google Apps Script web app URL
export const GOOGLE_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzwyXsEmFCBkkRYIA0VXBCd89WWt4n2YqSAlJXRU477g7ws7_JitbZpvr4GopEQ2UqlXQ/exec'; // Apps Script v70 — July 20 2026

// ── Sync secret ────────────────────────────────────────────
// Frontend token only - not a true secret. Must match SYNC_SECRET in Apps Script Properties.
// The deployed Apps Script currently accepts this value.
export const SYNC_SECRET = 'ihl-sync-2026';
// Keep as a same-value fallback for cached clients and duplicate-secret de-duping.
export const LEGACY_SYNC_SECRET = 'ihl-sync-2026';

// Shared read token for the internal cloud inspection list. This is a frontend
// access token (not a secret) and matches the existing review/list endpoint.
export const FIELD_RESUME_TOKEN = 'InHaus2026';

// ── Google Shared Drive Config ──────────────────────────────
// Shared Drive folder ID where per-assessment subfolders should be created.
// Find it in the URL when browsing the Shared Drive in Google Drive:
//   https://drive.google.com/drive/u/0/folders/[FOLDER_ID_HERE]
export const SHARED_DRIVE_FOLDER_ID = '11A2EXgQSFo4BAh3aYlJpHxqZKsfwe06l'; // Assessments/ folder in Products & Services Shared Drive — verified from Apps Script July 3 2026

// ── AI Vision Proxy Config ──────────────────────────────────
export const VISION_PROXY_URL = 'https://inhaus-vision-proxy.mjordanjay.workers.dev';

// ── Supabase Photo Storage (Phase 2 photo pipeline) ─────────
// Photos route through the InHaus Cloudflare Worker. The browser never receives
// the Supabase service-role key; it only receives a short-lived signed upload URL.
export const SUPABASE_URL = 'https://kvpaqvieacccojkkxqul.supabase.co'; // inhaus-lab project
export const SUPABASE_BUCKET = 'inspection-photos';
export const PHOTO_WORKER_URL = 'https://inhaus-photo-worker.inhauslab.workers.dev';
export const PHOTO_UPLOAD_SECRET = '42be53ef7bf9c07b52bb56c30ebd457a5ed227343a6d5313df98cbd525006b7c';

// Feature flag. Keep false until Supabase is configured and tested, then flip
// to true to route photos through Supabase instead of Apps Script/Drive.
export const USE_SUPABASE_PHOTOS = true;
