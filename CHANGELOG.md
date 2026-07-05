# InHaus Inspector — CHANGELOG

This file is the authoritative record of every significant change, decision, bug, and architectural choice made to the inspector app and its supporting systems.

**Update this file every time something changes.** When handing off to Codex/Claude Code, include this file. When rebuilding, read this first.

---

## Quick Reference — Current State (July 5 2026)

| Item | Value |
|------|-------|
| App version | v146 |
| Live URL | https://inhaus-inspector.netlify.app |
| GitHub Pages | BROKEN — use Netlify only |
| Apps Script | v50 — see URL below |
| Apps Script URL | `https://script.google.com/macros/s/AKfycbz21ibOdZOWgyUZB_9ttoUtGob3Ak3Cxe-AqpoZKXpa7TQLkM6Io1T6mB-xYryDYP2NGQ/exec` |
| Apps Script project | https://script.google.com/d/1p0QPkfC6w-eaB_gxEO4SZAtGHgXt0X0aguqiht9xDuGEAY_9UMIxSYTu/edit |
| Repo | /Users/hans/inhaus-update/ |
| Review portal | https://inhauslab.github.io/inhaus-review/ (token: InHaus2026) |
| AI proxy | https://inhaus-vision-proxy.mjordanjay.workers.dev (Cloudflare Worker) |
| Known open bug | `photoNeedsUpload()` checks `photo.imageData` but photos stored as `photo.dataUrl` — Codex has diagnosis |

---

## Known Bugs / Open Issues

### CRITICAL: Photo Upload Filter Mismatch (July 3 2026)
- **Symptom:** 42 photos from a real inspection never uploaded to Drive
- **Root cause:** `photoNeedsUpload()` filter checks `photo.imageData` but photos are stored as `photo.dataUrl`
- **Status:** Codex has diagnosis, fix not yet confirmed deployed
- **What happened:** Endpoint, token, and folder ID all checked out. Nobody read the filter function. Classic wrong-field check.
- **Rule:** Before any "sync is working" declaration, trace the COMPLETE path: storage format → extraction → filter → payload → Drive confirmation.

### GitHub Pages Broken (ongoing)
- Commits go to `main` branch. GitHub Pages is configured to read `gh-pages` branch.
- `gh-pages` is never updated. Pages never rebuilds.
- **Workaround:** Use Netlify (https://inhaus-inspector.netlify.app) for all links. Netlify auto-deploys on push to main.
- **Do not fix this** unless Matt explicitly asks — Netlify works fine.

### iPhone Airplane Mode Test (pending)
- Offline PWA behavior on iPhone has never been tested in airplane mode.
- Do NOT declare the app ready for multi-inspector use until this is done.

---

## Architecture Decisions

### Photo Storage Format
- Photos are captured and stored in IndexedDB as `photo.dataUrl` (base64 string)
- NOT `photo.imageData` — any filter or upload code must check `photo.dataUrl`
- Triple redundancy design: IndexedDB (local) + Drive upload + Web Share API (inspector saves to camera roll)

### Sync Architecture
- App sends data via POST to Apps Script bridge (JSON body with `syncSecret` field)
- Auth: `syncSecret` in JSON body — NOT `x-sync-secret` header (header was the old pattern, removed when Cloudflare proxy was removed)
- All sync goes through Apps Script bridge → Google Drive (Assessments/ shared drive)
- Supabase is future state only — do not build toward it yet

### Drive Folder Structure
- Assessments/ is a Shared Drive folder (`supportsAllDrives=true` required)
- Each inspection gets its own folder named by inspection name (NOT by inspectionId — learned the hard way)
- Photos upload separately after the main data sync

### Service Worker / Caching
- Version badge lives in `index.html` AND `service-worker.js` — update BOTH
- Do NOT use `skipWaiting` — causes iOS Safari issues
- Use `clients.claim` only pattern
- Inspectors must hard-refresh Safari before each inspection

### Dev Mode
- Tap version badge 5x fast to enter Dev Mode
- Dev Mode adds skip buttons and debug info
- Auto-disables on sync — inspectors should NOT be in Dev Mode during real inspections

### AI Features
- AI HVAC scanner + AI Room Summary use Cloudflare Worker proxy
- Proxy URL: https://inhaus-vision-proxy.mjordanjay.workers.dev
- Under mjordanjay personal CF account (id: ccd2d91cb28a29269af208469b560db1)
- Returns 403 on GET and "Forbidden origin" on curl — this is expected (only accepts inhauslab.github.io origin)

### Apps Script Deployments
- **NEVER deploy via clasp** — breaks the web app
- Always use the Apps Script UI (script.google.com) to publish new versions
- After deploy: copy the new /exec URL, update `config.js` in the repo, bump version, push
- This CANNOT be done programmatically by Hans — Matt must click through the browser UI

---

## Changelog

### v146 — July 4 2026
- [OPS] Updated Apps Script URL to v49/v50 deployment (previous URL was broken)
- [DECISION] Folder dedup fix in Apps Script v50: folders now matched by exact inspection name instead of inspectionId — prevents duplicate Drive folders

### Apps Script v50 — July 4 2026
- [FIX] Deduplication: folder match now by exact inspection name (not inspectionId in folder name)
- [URL] `https://script.google.com/macros/s/AKfycbz21ibOdZOWgyUZB_9ttoUtGob3Ak3Cxe-AqpoZKXpa7TQLkM6Io1T6mB-xYryDYP2NGQ/exec`

### v145 / Apps Script v38–v49 — July 2–3 2026
- [FIX] Multiple photo upload recovery attempts (dataUrl vs imageData root cause not yet resolved)
- [FIX] Added cache reset path `/cache-reset.html` for stuck mobile clients
- [FIX] Recover from duplicate photo log errors
- [FIX] Trust photo upload counts returned from Apps Script
- [FIX] Upload photos in background during inspections (not blocking)
- [FIX] Retry photo uploads by folder lookup key
- [FIX] Accept `dataUrl` photos in final upload step (partial fix — filter upstream still wrong)
- [OPS] Apps Script URL changed multiple times July 2–3 due to repeated redeployments
- [INCIDENT] July 3: 42 photos from real inspection never uploaded — see Known Bugs above

### Apps Script v37 — July 1 2026
- [FEAT] Added `doGet` handler — `action=list&token=InHaus2026` returns `{status:ok, count:N}`
- [FIX] Review portal list endpoint now live
- [VERIFIED] Returns `{status:ok, count:4}` — confirmed working

### v143–v144 — July 1 2026
- [FEAT] OpenClaw Readiness Console deployed at `/readiness/` — 7 auto-checks, manual evidence gates, computed add-user decision (Ready/Caution/Do Not Add Users)
- [FEAT] Hans Operating Workbench v1 deployed at `/workbench/` — protocol enforcement tool with DIAGNOSED/PATCHED/VERIFIED/DEPLOYED/MONITORED stages, 3-failure hard block, phone/browser handoff gate
- [FEAT] Report viewer at `/reports/` — replaces lost Replit viewer, 9 sections, photos render, mobile works, no auth token in public JS
- [OPS] All portals updated to point at v37 Apps Script URL

### v135–v142 — June 29–30 2026
- [FIX] Sync auth field corrected: `x-sync-secret` header → `syncSecret` in JSON body (mismatch since Cloudflare proxy removed)
- [FIX] SHARED_DRIVE_FOLDER_ID set to correct Assessments/ folder ID (was blank)
- [FIX] Final sync waits for all checklist boxes checked before triggering
- [FIX] Multiple sync stability fixes: checkpoint sync, backup status warnings, local photo copies kept after Drive upload
- [OPS] Netlify mirror set up — auto-deploys on push to main, now primary URL

### Apps Script v36 — June 30 2026
- [FEAT] First working bridge: POST JSON body with syncSecret, creates folder in Assessments/, returns `{status:ok}`
- [VERIFIED] Drive write confirmed July 1: POST shape is JSON body with `syncSecret` (NOT `x-sync-secret` header)
- [NOTE] `supportsAllDrives=true` required for Shared Drive access

### v120 — June 28–29 2026
- [FIX] Sync auth fixed — `x-sync-secret` was `syncSecret` (mismatch discovered)
- [FIX] Ice maker N/A option, duplicate end follow-ups removed, sync banner redisplay fixed, final sync timeout escape added
- [FIX] Service worker re-enabled with safe iOS Safari pattern (no `skipWaiting`, `clients.claim` only)
- [FIX] All sync routed through Cloudflare Worker proxy — SYNC_SECRET server-side only
- [FIX] P0/P1/P2 UX bugs from June 28 audit: truck check persistence, room registry auto-open, sync failure modal after 3 failures, last backup time on failed sync, Dev Mode behind Advanced section

### v114 — June 27 2026
- [FIX] Dual photo backup — auto-download + Web Share API, prompts inspector to Save Image
- [FIX] Replace 'Call Matt' with real support number
- [FIX] Strip WiFi password from export
- [OPS] Netlify.toml added for mirror deployment

### v113 — June 26 2026 (approx)
- [FIX] Mobile step rendering freeze fixed (Codex, commit 92814a6)
- [FIX] Apps Script URL updated to v2 deployment

### v91–v112 — June 16–25 2026
- [FEAT] Voice dictation, smart pre-fill, inline caption editing all live (June 16)
- [FEAT] Version badge corrected to v84 in index.html (was showing wrong version)
- [FEAT] Spare photo slot assignment: ⚠️ Needs assignment / ✓ Assigned buckets, inline dropdown per photo, `assignedSlot` syncs to Drive, portal auto-populates slots from `assignedSlot`
- [FIX] Next button freeze (Codex, commit 92814a6)

### v85 — June 18 2026
- [FEAT] Spare photo slot assignment feature
- [FEAT] Inline dropdown per photo assigns to Observation/Action Taken/Follow-up slots

### v84 — June 16 2026
- [FIX] Version badge + appVersion corrected (was still showing v117 despite being v84)
- [NOTE] Version badge lives in `index.html` AND `service-worker.js` — must update BOTH

### v80–v81 — June 10 2026 (Gold Session)
- [FEAT] Sync status indicator — 7 states (idle, syncing, success, error, offline, warning, retry)
- [FEAT] Final sync blocking overlay + receipt card (shows sync confirmation before inspector can leave)
- [FEAT] Storage warning threshold lowered to 70% + 30-min no-sync warning added
- [FEAT] Photo privacy comments added to upload code
- [FEAT] Photo upload confirmation: `text/plain` fetch (no preflight, readable response)
- [FEAT] Photos only cleared from device AFTER Drive confirms receipt
- [FEAT] Retry queue for failed uploads
- [FEAT] Unconfirmed count shown in receipt card

### Review Portal — June 10 2026 (Gold Session — major overhaul)
- [FEAT] Floating 📷 FAB — fixed position, opens full-screen photo modal
- [FEAT] Photo slot selector dropdown, S/M/L size controls
- [FEAT] Photo Library in Section 5 with assignment status (green = assigned, yellow = not placed)
- [FEAT] Photo accountability rule: every photo must be assigned, marked not needed, or saved for later
- [FEAT] Completion Score (0–100) — calculateCompletionScore(): photos 30pts, observations 25pts, actions 25pts, checklist 20pts
- [FEAT] Letter grades: F→D→C→B→A→A+ with color-coded bars
- [FEAT] Same-Day Bonus: A grade (85+) submitted same calendar day → ⚡ badge
- [FEAT] Inspector Performance Dashboard at `/performance.html` — monthly cards, comp adjustments, ⚡ streak badges
- [FEAT] Comp logic: 90+=+5% / 80+=+2% / 70+=Base / 60+=−2% / <60=PIP

### v79 — June 10 2026
- [FEAT] Tanner feedback remaining items from 5/27 review: qty column, post-inspection content section, status legend, photo clarity improvements

### v76 — May 29 2026
- [FEAT] Actions Taken During Assessment section
- [FEAT] Assessment Observations section

### v27–v30 — April–May 2026
- [FEAT] Room navigation drawer, search
- [FEAT] Photos auto-upload with submit, captions preserved
- [FIX] Prevent duplicate submissions, disable button on submit
- [FIX] Photo upload always separate, remove debug UI, fix badge

### Early versions (v1–v26) — April 2026
- Initial app build: intake, equipment checklist, room-by-room workflow, final review
- iPad-first PWA, offline-capable, IndexedDB storage
- Tanner feedback batch: nav, bathroom logic, content fixes, debrief reorder
- Follow-up recommendation fields, radon auto-populate, FLIR labels
- Boulder Blue fields, PFAS kit barcode, Assessment End Time
- Dev mode via logo 5x tap (not URL param — breaks PWA)

---

## Deployment Procedure

### App (Netlify — auto)
1. Make changes in `/Users/hans/inhaus-update/`
2. Bump version in `index.html` AND `service-worker.js`
3. `git add -A && git commit -m "v<N>: description" && git push`
4. Netlify deploys automatically (1–2 min)
5. Verify: `curl -s https://inhaus-inspector.netlify.app/service-worker.js | grep CACHE_NAME`

### Apps Script (manual — Matt must do this)
1. Open https://script.google.com/d/1p0QPkfC6w-eaB_gxEO4SZAtGHgXt0X0aguqiht9xDuGEAY_9UMIxSYTu/edit
2. Make edits
3. Deploy → New deployment → Web app → Execute as: Me, Access: Anyone
4. Copy the new `/exec` URL
5. Update `config.js` in the repo with the new URL
6. Bump app version, push
7. **NEVER use clasp to deploy — it breaks the web app**

---

## Handoff Brief Template (for Codex/Claude Code)

When handing off to Codex, include:
- This file (CHANGELOG.md)
- `memory/05-projects/inspector-app.md`
- The specific bug description with: symptom, files involved, what was already tried
- Verification method (what a passing fix looks like)
- What NOT to change (e.g., Supabase is future state, don't touch Tanner's schema)
