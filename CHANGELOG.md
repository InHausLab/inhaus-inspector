# InHaus Inspector — CHANGELOG

This file is the authoritative record of every significant change, decision, bug, and architectural choice made to the inspector app and its supporting systems.

**Update this file every time something changes.** When handing off to Codex/Claude Code, include this file. When rebuilding, read this first.

---

## Quick Reference — Current State (July 19 2026)

| Item | Value |
|------|-------|
| App version | v169 (bounded network and database failures) |
| Live URL | https://inhaus-inspector.netlify.app |
| GitHub Pages | BROKEN — use Netlify only |
| Apps Script | v64 team merge and company comment library — see URL below |
| Apps Script URL | `https://script.google.com/macros/s/AKfycbwcCqVf_tnTJPm9D65SKEdfIq7-gYhCQZqaTL1rvVgJkGtdEXRNckLUkgW8octOQjFIXA/exec` |
| Apps Script project | https://script.google.com/d/1p0QPkfC6w-eaB_gxEO4SZAtGHgXt0X0aguqiht9xDuGEAY_9UMIxSYTu/edit |
| Repo | /Users/hans/inhaus-update/ |
| Review portal | https://inhauslab.github.io/inhaus-review/ (token: InHaus2026) |
| AI proxy | https://inhaus-vision-proxy.mjordanjay.workers.dev (Cloudflare Worker) |
| Photo Worker | inhaus-photo-worker (Cloudflare Worker, InHaus company account) |
| Known open bug | `photoNeedsUpload()` checks `photo.imageData` but photos stored as `photo.dataUrl` — superseded by Supabase migration (branch feat/supabase-photo-pipeline) which fixes this at the root |
| Branch (staging) | feat/supabase-photo-pipeline · draft PR #2 · deploy-preview-2--inhaus-inspector.netlify.app |
| Supabase project | inhaus-lab · ref kvpaqvieacccojkkxqul |
| Supabase bucket | inspection-photos (private) |
| Staging table | inspector_photo_uploads |
| Feature flag | USE_SUPABASE_PHOTOS (config.js) |
| Files changed (branch) | config.js, supabase-photos.js (new), sync.js, app.js, screens.js |
| Clean-pass inspection | INH-20260705-P11PU1 — 5 photos, "safe to leave" verified |

---

## v169 — Bounded Network and Database Failures
**Date:** July 19, 2026

- Added explicit deadlines to Apps Script saves and reads so weak cellular service cannot leave cloud controls spinning forever.
- Added bounded timeouts for photo signing, upload, Drive mirroring, confirmation, and final photo verification; failures remain retryable and local photo copies are preserved.
- Added timeouts to AI photo captions, label scans, equipment scans, room summaries, follow-up plans, and company comment-library loading.
- Added IndexedDB transaction-abort handling so interrupted local writes reject cleanly instead of leaving their callers waiting indefinitely.

## v168 — Mobile Header Spacing
**Date:** July 19, 2026

- Moved the now-visible inspection search control to the open left side of the mobile header so it cannot overlap the centered InHaus Lab logo.

## v167 — Mobile Header Visibility and Upgrade Guidance
**Date:** July 19, 2026

- Made the fixed **Intake** and inspection-search controls clearly visible against the dark mobile header.
- Added an always-visible database-upgrade notice so any older open app tab produces a clear close-tabs-and-retry instruction instead of a blank or frozen screen.
- Removed the stale hard-coded version number from the cache-reset screen; it now says it is opening the latest version.

## v166 — Workspace Back Navigation
**Date:** July 19, 2026

- Fixed a navigation loop where opening Recovery, Team, or Findings from **My Work** could leave the **Back** button reopening My Work instead of returning to the active inspection.

## v165 — Database Upgrade Hang Protection
**Date:** July 19, 2026

- Fixed **Save for Inspector** getting stuck forever on **Saving to Cloud…** when an older InHaus Inspector tab was still holding the previous IndexedDB version open.
- Future app versions now release their local database connection when an upgrade is requested.
- If an older tab cannot release the database, the app now restores the save button and tells the user to close other InHaus Inspector tabs and retry.

## v164 — Full Audit Fixes
**Date:** July 19, 2026

- Fixed the floating spare-photo camera so compression is fully awaited before the photo is saved, vaulted, and queued for upload.
- Made **My Work** useful in single-inspector mode by treating all inspection sections as that inspector's work; team mode still shows only explicitly assigned sections.
- Preserved navigation context when an inspector opens Photos from My Work, so Back returns to My Work instead of Review.
- Changed comment-library admin loading from a token-bearing GET URL to an authenticated POST, keeping the admin token out of browser history and ordinary URL logs.

---

## v163 — Smart Photo Routing, Company Comments, My Work, and Recovery
**Date:** July 19, 2026

- Added automatic destination suggestions for unplaced photos using caption keywords, inspection context, and capture-time proximity. Inspectors confirm a suggestion with one tap or choose a different room/task manually.
- Added a centrally curated company comment library. Approved wording is available to every inspector; new reusable comments remain local and enter a separate admin approval queue before company-wide use.
- Added atomic server-side team synchronization with per-field timestamps. Different inspectors can edit different fields in the same section without one device overwriting the other. Active-section presence warns when another inspector is in the same section.
- Added **My Work** with each inspector's assigned sections, incomplete requirements, findings needing review, and photos still needing placement.
- Added automatic and manual restore points, Recently Deleted photo recovery, shared photo tombstones, and an inspection audit history.
- Deleted-photo tombstones are honored by the review API so an older Supabase or Drive copy cannot silently reappear.
- Kept the inspector workflow and final report handoff intact; report preview/building remains outside the inspector role.

---

## v162 — Rapid Capture, Smart Findings, Approved Comments, and Multi-Inspector Mode
**Date:** July 19, 2026

- Added **Rapid Capture** inside every inspection section. Inspectors choose the current room/task once, capture repeated photos, dictate one field note, and save directly into a Findings Inbox.
- Added a structured finding model containing location, report section, severity, original inspector wording, cleaned report wording, photos, review status, author, timestamps, and reusable-comment status.
- Every photo with an inspector comment automatically creates a finding. Final submission is blocked until each finding is approved for the report or explicitly excluded.
- Added a guarded comment-cleaning workflow: the original inspector wording stays visible, can be copied into a separate report draft, and must be fine-tuned and approved before it can be reused.
- Added an approved reusable comment library. A comment can only enter the library after its cleaned wording has been reviewed and approved; approved comments are available in future Rapid Capture sessions.
- Added **Multi-Inspector Mode** with named team members, per-device identity selection, section assignments, capture/edit attribution, activity history, and a team sync action.
- Team checkpoints now pull the latest cloud draft and merge sections, findings, photos, assignments, activity, rooms, and approved comments before saving. Section timestamps provide convergent sync without silently discarding another inspector's separately assigned work.
- Updated the report builder to prefer approved structured findings and include severity, report location, photo count, and approver attribution.
- Existing photo annotation remains unchanged and is available from captured photo cards.

---

## v161 — Office Preparation and Phone Handoff
**Date:** July 19, 2026

- Added **Prepare Inspection in Office** so staff can enter the client, property, inspector, inspection date, home details, Wi-Fi information, client concerns, and layout notes before the site visit.
- Added water-test preparation fields for the water panel kit/sample ID, PFAS test and kit/sample IDs, microplastics test and sample ID, and office preparation notes.
- Prepared inspections are saved locally and checkpointed to the existing cloud assessment record with the review status `Prepared`.
- Added **Continue Inspection** with cloud lookup and search by address, client, inspector, date, or inspection ID.
- Claiming a prepared inspection on a field device restores its resumable form data, marks it `Field Active`, and opens the pre-inspection checklist.
- Cloud resume payloads exclude photo image bytes and Wi-Fi passwords. Existing final submissions continue to enter the review portal as `Needs Review`.

---

## Engineering Record: Photo Pipeline Migration to Supabase
**Date:** July 5, 2026  
**Branch:** feat/supabase-photo-pipeline · draft PR #2  
**State:** Validated on device (staging only). Production untouched. Not merged.

### 1. The Problem

The app captured inspection data reliably and synced form data to Google Sheets fine. The photo pipeline was the failure point. Photos traveled as base64 text → Google Apps Script web app → Google Drive. Every symptom traced back to that one path:

- **Slow:** base64 is ~33% larger than binary; the phone did CPU-heavy compression; Apps Script decoded each image, created a Drive file, changed sharing, and wrote a Photo Log sheet row — serially, in batches of 3. 40+ photos stranded the inspector at the end of a job.
- **Unreliable:** recurring `Service Spreadsheets failed`, `Photo Log already exists`, and batch-of-3 all-or-nothing failures. A sheet-write hiccup failed the whole photo batch even after files reached Drive.
- **Duplicate Drive folders:** the folder-lookup matched on inspection ID inside folder names (which never contained it), so every retry created a new folder — one real incident produced 178 duplicate folders for a single inspection.
- **False confidence / silent loss:** the app could report "complete" while photos were missing.
- **Hard ceiling:** Apps Script execution/quota limits could never support 100+ concurrent inspectors regardless of patching.

**Decision:** Do not rewrite the app. Replace only the photo transport (Option B). Everything else works.

### 2. Old Architecture (photos)

Capture (`ui.js` `compressImage`, max 1200px, JPEG q≈0.65, <~680KB) → stored as a data-URL in the live inspection object and in a separate IndexedDB `photoVault` store → at final sync, photos stripped from the main payload, then sent separately as base64 JSON POSTs (`photoUploadOnly:true`) to Apps Script → Apps Script decodes, `createFile` in the inspection's Drive folder, `setSharing(ANYONE_WITH_LINK)`, appends a Photo Log row → app marks photos confirmed from the response.

### 3. New Architecture (photos)

Capture & compression unchanged. Then:

1. On capture, the compressed JPEG is converted to a binary Blob and POSTed directly to Supabase Storage at `<inspectionId>/<photoId>.jpg`. Photo metadata is inserted into an app-owned table. This happens per photo, in the background, the moment it's taken.
2. **Idempotent:** the object path is deterministic per photo, so a retry overwrites/no-ops. Supabase's "already exists" response is treated as success.
3. **Final Submit** is a receipt, not the upload event. It flushes any photo not yet stored — sourced from the `photoVault` (the reliable pixel store), so a photo whose live copy was lost still uploads.
4. Form data still syncs to Apps Script / Google Sheets, unchanged. Only photos moved.
5. Photos are kept locally until Supabase confirms; the `photoVault` + a localStorage shadow remain as safety nets.

### 4. Supabase Backend (what was added)

All in the company's existing `inhaus-lab` project (owned by Tanner). **Strictly add-only — zero changes to any existing table, column, index, policy, function, or data.**

| Object | Detail |
|--------|--------|
| `inspection-photos` | Private storage bucket. Layout: one folder per inspection, one object per photo — `<inspectionId>/<photoId>.jpg`. |
| `inspector_photo_uploads` | App-owned staging table for photo metadata: `id`, `photo_id`, `inspection_id`, `room_name`, `step_name`, `caption`, `slot`, `bucket`, `storage_path`, `source_system`, `created_at`. Deliberately separate from Tanner's `ihl_photos` — a clean handoff point for him to reconcile. |
| RLS policies | Permissive insert (and update on the bucket) for the anon role on the table and bucket-scoped on `storage.objects`; grants to match. No public read of real data. |
| Temp read policy | `temp anon read tbl` / `temp anon read bkt` — added only to verify uploads by API during testing. **To be dropped before go-live.** |

**Auth:** The browser uses the project's publishable (anon) key (public by design; lives in `config.js`). Direct REST/Storage calls must stay simple — no `x-upsert`, no `return=representation` — because those need a SELECT policy that was intentionally not granted. See bugs #1/#2.

### 5. Tanner's Existing Schema (discovered, untouched)

The project already contained a complete, well-designed backend schema (Tanner's): `organizations`, `ihl_users` (4 rows), `customers`, `homes`, `ihl_assessments`, `ihl_assessment_files` (has `drive_file_id` + `drive_url` — built for Drive mirroring), `ihl_photos` (18 columns incl. `inspection_id`, `photo_id`, `room_name`, `slot`, `drive_url`, `source_system` default `'apps_script'`, `raw_jsonb`, uuid), `ihl_lab_results`, `ihl_air_quality_rooms`, `ihl_sync_runs` (209 rows from dormant n8n automations). Data tables were empty.

Two facts constrained integration and are flagged for Tanner:

- `ihl_photos` has no `storage_path` column (only `drive_url`) — the schema was designed around Drive-as-store. We uploaded binaries to Supabase Storage and recorded paths in the staging table instead of guessing at his schema.
- `ihl_photos.inspection_id` is a foreign key to `ihl_assessments.inspection_id` — a photo row needs a parent assessment row first. Writing directly into `ihl_photos` means also writing assessments; the staging table avoids that entanglement until Tanner decides the reconciliation.

### 6. Application Code Changes

Branch `feat/supabase-photo-pipeline`. Behind flag `USE_SUPABASE_PHOTOS` — on in the branch, off in main/production.

| File | Change |
|------|--------|
| `config.js` | Added `SUPABASE_URL`, `SUPABASE_ANON_KEY` (publishable), `SUPABASE_BUCKET`, and the `USE_SUPABASE_PHOTOS` flag. |
| `supabase-photos.js` | **New file.** Dependency-free upload client. `uploadPhotoToSupabase()`: data-URL→Blob, deterministic storage path, binary POST to Storage, best-effort metadata insert, "already exists" (409-in-body) treated as success. |
| `sync.js` | `uploadPhotoImmediate()` branches to `storePhotoInSupabase()` when the flag is on. New `uploadPhotosViaSupabase()` is the final-submit flush — vault-driven: merges the export set with the `photoVault`, uploads anything not yet stored, skips already-stored (no dup uploads), marks confirmations. `sendToGoogleScript()` gated so the Supabase flush always runs and the old Apps Script batch loop is bypassed. |
| `app.js` | New shared `photoIsUploaded()` that recognizes Supabase confirmation (`storagePath` / `_driveConfirmed` / vault `uploadState 'stored'`) — used in `getPhotoHealth()`, `auditPhotos()`, and the sync receipt. Receipt copy "in Drive" → "in cloud". |
| `screens.js` | Photo status pills + the "Can I Leave?" readiness counter now recognize Supabase; relabeled "Drive" → "Cloud"/"upload". |

### 7. Bugs Found & Fixed During Testing

All caught on staging, never in production.

| # | Bug | Fix |
|---|-----|-----|
| 1 | RLS mechanics: the publishable key resolves to the anon role, but `x-upsert` and `return=representation` silently require a SELECT policy — uploads failed with a misleading "row-level security" error. | Use plain calls (no upsert / no representation); insert-only policies. Confirmed the whole thing works with the anon key. |
| 2 | "Already exists" retry mis-handled: Supabase Storage returns HTTP 400 with a body of `{"statusCode":"409","Duplicate"}` — code checked `res.status`, so retries looked like failures. | Inspect the response body; treat duplicate as success (idempotent). |
| 3 | Final-flush pixel-field mismatch: the export emits photos with pixels in `imageData`, but the flush read `dataUrl` — photos not in the live cache were silently skipped (the "3 of 7 not confirmed" symptom). | Map `imageData`→`dataUrl` before upload. |
| 4 | Vault-only pixels stranded: photos whose image data lived only in the `photoVault` (e.g. after an iOS local-save hiccup) were absent from the export entirely, so no re-upload could ever reach them. | Rewrote the flush to read the vault directly, merge with the export, and upload anything not yet stored. |
| 5 | App-wide mislabel: status/health/receipt checks judged a photo "uploaded" only if it had a Google Drive link — so Supabase photos showed as "waiting for Drive" everywhere, even ones safely stored. | Shared `photoIsUploaded()` that recognizes Supabase; relabeled copy. |

### 8. Testing & Validation

- **API level:** curl round-trips proving the anon key can upload to the bucket (200) and insert metadata (201).
- **Browser module level:** the real `supabase-photos.js` uploading a browser-generated JPEG, including the idempotent-retry path.
- **Local full-flow:** a captured photo driven through the app's actual `uploadPhotoImmediate` path → confirmed in Supabase, vault flipped to `stored`.
- **Staging on real iPhone — run A** (INH-20260705-Q970DG): 7 photos; 4 auto-uploaded during the walkthrough; app correctly caught 3 unconfirmed and offered retry. This run surfaced bugs #3–#5. (Those 3 photos were unrecoverable — their image data never survived an iOS "Save failed" glitch mid-inspection; a one-off, not a pipeline bug.)
- **Staging on real iPhone — run B** (INH-20260705-P11PU1), after fixes: a full fresh inspection — 5 photos auto-uploaded, Submit showed "safe to leave" with zero unconfirmed, all 5 verified in Supabase. Clean end-to-end pass.

### 9. Deployment State

- **Production** (the 5 inspectors' app) serves from `main`: GitHub Pages (inhauslab.github.io/inhaus-inspector) plus Netlify and Vercel. Not touched. Flag is off there.
- This work lives on branch `feat/supabase-photo-pipeline`, draft PR #2, deployed only to the Netlify deploy preview at `deploy-preview-2--inhaus-inspector.netlify.app` — the isolated URL used for the iPhone tests.
- Not merged. App version not yet bumped (needed so the service-worker cache picks up new code on the phones at go-live).

### 10. What Remains Before Production

| # | Item | Notes |
|---|------|-------|
| 1 | Drive mirror (next build) | Server-side job (likely the existing Cloudflare Worker) that copies stored photos into Google Drive after the inspector leaves — so office staff keep the Drive view. Can write into Tanner's `ihl_assessment_files.drive_url` or a Drive folder. Until built, the Drive view is empty for new inspections. |
| 2 | Security hardening | Move writes behind the Worker with short-lived signed URLs (service-role held server-side) so the public key isn't write-capable. Needed before wide rollout beyond the pilot. |
| 3 | Cleanup | Delete test data (bucket folders `browsertest/`, `__validation__/`, `vaulttest-*/`, `flushfix-insp/`; test inspections Q970DG, 0AKB8I, P11PU1; duplicate rows in `inspector_photo_uploads`) and drop the temporary read policy. |
| 4 | Go-live (business call) | Bump version, merge to main, deploy to GitHub Pages/Netlify. Decision: ship now (photos reliable immediately, Drive view waits for #1) vs. build the mirror first. |
| 5 | Tanner reconciliation | Fold `inspector_photo_uploads` into `ihl_photos` in his preferred shape (mind the missing `storage_path` column and the assessment FK). |
| 6 | Retire Apps Script photo path | After go-live, remove the base64 photo upload code from the Apps Script bridge entirely. Eventually migrate form-data/Sheets too. |

### 11. Known Issues & Risks

- **iOS storage:** iOS Safari can fail local IndexedDB writes ("Save failed" banner) — most often in a Private tab or with strict privacy settings. Pre-existing and separate from the photo upload, but can prevent a photo's pixels from ever being saved (cause of the 3 unrecoverable photos in run A). Worth hardening.
- **Dup metadata rows:** No unique constraint on `photo_id` in `inspector_photo_uploads`, so retries created duplicate metadata rows. Cosmetic (storage objects are idempotent) — address with a unique index or during Tanner's fold-in.
- **Public write:** The publishable key can currently write to the bucket + staging table. Acceptable for the pilot; addressed by remaining item #2.
- **3 deployments:** GitHub Pages, Netlify, and Vercel all deploy from `main`. This caused a real incident earlier (fixing one while the phone loaded another). Recommend consolidating to one before go-live.

### 12. Reference / Identifiers

| Item | Value |
|------|-------|
| GitHub repo | InHausLab/inhaus-inspector |
| Work branch | feat/supabase-photo-pipeline · draft PR #2 |
| Staging URL | deploy-preview-2--inhaus-inspector.netlify.app |
| Production URL | inhauslab.github.io/inhaus-inspector (+ Netlify, Vercel) |
| Supabase project | inhaus-lab · ref kvpaqvieacccojkkxqul |
| Bucket | inspection-photos (private) |
| Staging table | inspector_photo_uploads |
| Feature flag | USE_SUPABASE_PHOTOS (config.js) |
| Files changed | config.js, supabase-photos.js (new), sync.js, app.js, screens.js |
| Clean-pass inspection | INH-20260705-P11PU1 — 5 photos, "safe to leave" verified |
| Companion docs on file | app-overview-for-hans, tanner-update, supabase-changelog-for-tanner (SQL), original architecture brief |

---

## Known Bugs / Open Issues

### Photo Upload Filter Mismatch — SUPERSEDED (July 3 2026 bug, fixed in Supabase branch)
- **Original symptom:** 42 photos from a real inspection never uploaded to Drive
- **Original root cause:** `photoNeedsUpload()` filter checked `photo.imageData` but photos were stored as `photo.dataUrl`
- **Status:** The Supabase photo pipeline (feat/supabase-photo-pipeline) rewrites the upload path entirely and fixes this at the root. Bug is superseded once the branch merges.

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

### v160 — July 18 2026
- [PHOTO WORKFLOW] Photos now carry the room and task from their capture screen automatically and show a clear **Saved to room → task** confirmation.
- [INSPECTOR UX] The floating camera button no longer asks inspectors to choose report-builder observation/action/follow-up slots. It saves immediately to the current inspection context.
- [INSPECTOR UX] The Photos screen now opens to exceptions only, summarizes automatically organized photos, and offers a simple room/task dropdown only when a photo truly needs placement.
- [COMMENTS] Inspector photo comments are explicitly labeled and visually highlighted in the capture cards, Photos screen, and Final Review summary.
- [DATA FIX] Additional photos from the floating camera button are now included in the inspection export and final photo verification instead of existing only in local/cloud photo storage.
- [SAFETY] The localStorage shadow backup retains routing metadata for every photo while continuing to strip image bytes.

### v158 — July 17 2026
- [BACKEND FIX] Apps Script `syncToSupabase()` now supplies required `assessment_num` from the generated Drive assessment number.
- [BACKEND FIX] A rejected `ihl_assessments` insert now throws through `doPost` instead of being swallowed and falsely reported as success.
- [OPS] Deployed Apps Script version 52 and updated the inspector app to the new web-app URL.

### v157 — July 17 2026
- [ROOT CAUSE] Final submit could skip the inspection JSON POST when local `_dataSyncedToDrive`, folder ID, and payload fingerprint flags claimed the data had already synced. Those flags can survive a stale/dead Apps Script deployment even when no `ihl_assessments` record exists.
- [FIX] Final submit and **Retry inspection data sync** now always POST the stripped inspection JSON to Apps Script before photo confirmation/mirroring. Server-side folder reuse and Supabase upsert keep retries idempotent.
- [VERIFY] Supabase query for `INH-20260717-YZNHG0` returned no assessment row before this fix. The live Apps Script list endpoint accepted `InHaus2026` and also returned zero inspections.

### v156 — July 17 2026
- [INCIDENT] Real inspection `INH-20260717-YZNHG0` uploaded and mirrored 34 photos, but its inspection JSON did not reach Apps Script; the live review list returned zero inspections. Form data remains recoverable only from Matt's device/local backup.
- [FIX] `scriptFetch()` now rejects HTTP failures, HTML/non-JSON responses, invalid response shapes, and any response that does not explicitly return `status: "ok"`.
- [FIX] Final-submit failures no longer claim the phone is offline merely because a server sync failed. Offline wording is used only when `navigator.onLine === false`; online failures show the real error and a retry instruction.
- [FIX] The completed-inspection screen replaces **Re-upload photos** with **Retry inspection data sync** when all photos are already confirmed, preserving JSON recovery without suggesting duplicate photo work.
- [VERIFY] Direct Apps Script ping and review-list calls returned valid JSON; list count remained zero. Mocked 50-photo mirror completed all 50 photos in four Worker batches (14+14+14+8).
- [AUDIT] Phone sleep or force-closing Safari can still interrupt the in-flight final sync. Local/IndexedDB and Supabase retries protect data, but inspectors must keep the app open and awake until the success receipt appears.

### v148 — July 15 2026
- [OPS] Bumped app shell and service-worker cache to v148.
- [VERIFY] End-to-end dry run passed: Worker /sign, signed PUT to Supabase Storage, /mirror to Drive, row confirmed in inspector_photo_uploads with drive_url populated. Pipeline confirmed live.
- [NOTE] Cleanup blocker: `service_role` lacks DELETE on inspector_photo_uploads — test row DRY-RUN-001 remains (harmless). Tanner needs `GRANT DELETE ON public.inspector_photo_uploads TO service_role`.
- [GUARD] sync.js: added 3x `console.warn('[RETIRED] Apps Script photo path triggered...')` guards to the old base64/Apps Script upload path. Code not deleted — just loud if accidentally re-engaged.
- [VERIFY] Review portal photo loading: no changes needed. New inspection photos are mirrored to Drive via /mirror; Apps Script `getInspectionForReview` already scans the Drive folder via `mergeDriveFolderPhotosForReview`. Portal will render photos from new inspections the same way it always has.
- [FEAT] Home screen: added one-time-per-session hard-refresh reminder banner. Uses sessionStorage flag, dismisses on tap, uses existing `.reminder-banner` CSS class.

### v147 — July 14 2026
- [FEAT] Added InHaus company Cloudflare Worker `inhaus-photo-worker`.
- [SECURITY] Photo uploads now request a short-lived signed upload URL from the Worker instead of writing directly to Supabase with a browser publishable key.
- [FEAT] Added Worker `/mirror` endpoint to copy Supabase-stored photos into the existing Google Drive assessment folder and write `drive_url` back to `inspector_photo_uploads`.
- [FEAT] Final submit now flushes photos to Supabase and then calls the Drive mirror endpoint.
- [OPS] Rebased/cherry-picked the July 5 Supabase photo staging commits onto current `main` so newer docs/pages are preserved.
- [OPS] Bumped app shell and service-worker cache to v147.
- [VERIFY] Worker `/sign` and `/mirror` smoke tests passed end-to-end; `/mirror` wrote `drive_url` and produced a public Drive thumbnail redirect.

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
