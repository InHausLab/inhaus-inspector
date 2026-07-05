// InHaus Inspector - Configuration Constants

// ── Google Drive Export Config ─────────────────────────────
// Google Apps Script web app URL
export const GOOGLE_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbx6VWKm-smdwpiZbzVIk8VGLV7V7p0Zbq1X4DE3YMe9bjH-zxkfRH_aznYCp08LzEhBLw/exec'; // v37 — verified July 3 2026 (v38 attempt failed auth, abandoned)

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
export const SHARED_DRIVE_FOLDER_ID = '11A2EXgQSFo4BAh3aYlJpHxqZKsfwe06l'; // Assessments/ folder in Products & Services Shared Drive — verified from Apps Script July 3 2026

// ── AI Vision Proxy Config ──────────────────────────────────
export const VISION_PROXY_URL = 'https://inhaus-vision-proxy.mjordanjay.workers.dev';

// ── Supabase Photo Storage (Phase 2 photo pipeline) ─────────
// Direct binary photo upload, replacing the base64 → Apps Script → Drive path.
// Fill these in from your Supabase project (Settings → API). The anon key is
// safe in frontend code — it is public by design and protected by row-level
// security policies on the bucket and tables.
export const SUPABASE_URL = 'https://kvpaqvieacccojkkxqul.supabase.co'; // inhaus-lab project
export const SUPABASE_ANON_KEY = 'sb_publishable_UjaZpTZPwPfGTdA0aW7QoA_zb8HyshW'; // publishable key — safe in browser
export const SUPABASE_BUCKET = 'inspection-photos';

// Feature flag. Keep false until Supabase is configured and tested, then flip
// to true to route photos through Supabase instead of Apps Script/Drive.
export const USE_SUPABASE_PHOTOS = true;
