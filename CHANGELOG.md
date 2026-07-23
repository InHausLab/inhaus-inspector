# InHaus Inspector — CHANGELOG

This file is the authoritative record of every significant change, decision, bug, and architectural choice made to the inspector app and its supporting systems.

**Update this file every time something changes.** When handing off to Codex/Claude Code, include this file. When rebuilding, read this first.

---

## Review Portal V16 — Inspection Date and Before Leaving
**Date:** July 23, 2026

- Fixed the blank editable Inspection Date field. Apps Script returns a long JavaScript date string that the summary formatter accepted but the HTML date input rejected; V16 normalizes it to `YYYY-MM-DD`.
- Added a dedicated, editable Before Leaving card with the ten standard final checks plus the two saved departure tasks.
- Preserved source truth in the checklist UI: app-recorded answers are labeled `Saved by inspector`, portal answers are labeled `Saved in portal`, and missing source answers are labeled `Not recorded in app`.
- Riverside production verification: live `V16`, date input `2026-07-22`, 12 checklist rows, 2 checked inspector-saved departure tasks, and 10 missing app answers visibly identified. Particulate matter remained visible and the photo grid remained exactly 59 unique photos.
- Review Portal commit: `5345a82` (`fix: restore inspection date and before leaving checklist`).

## Review Portal V15 — Particulate Matter Display
**Date:** July 23, 2026

- Restored the saved Property Details particulate-matter reading to the visible Inspection Summary.
- Added the same source reading to the unified Tests & Samples summary as a recorded Particulate Matter measurement.
- The renderer reads the preserved nested app field when the thin Apps Script summary does not promote that value to the inspection top level.
- Production Riverside verification: live `V15` displays `PM2.5: 6.1 µg/m³; PM10: 8 µg/m³` in both sections, retains all 27 saved app steps and 1,595 captured values, and still renders exactly 59 photo cards with 59 unique photo IDs.
- Review Portal commit: `c53a55a` (`fix: show particulate matter in review portal`).

## URGENT PRODUCTION CORRECTION — Apps Script v86 + Review Portal V14
**Date:** July 23, 2026

- The configured Apps Script deployment was rolled back from v87 to v86 after production review reads regressed to a thin 13-key summary that omitted the complete checkpoint and findings.
- The stable `/exec` URL in `config.js` was preserved. **Apps Script v86 is the current production deployment. Do not redeploy v87 or repository `HEAD` until the review-read path is reconstructed and passes full parity tests.**
- No authoritative inspection or photo data was deleted or overwritten. The complete preserved Riverside checkpoint (27 steps, 52 findings) was backed up into the inspection's isolated authenticated Review Portal recovery record, after first backing up the current reviewer edits.
- Review Portal V14 now merges that preserved checkpoint underneath the live Apps Script summary. Live values remain authoritative while missing steps, findings, rooms, tests, and summaries are restored.
- Fixed the photo merge regression: Apps Script returned 59 Drive photo records without photo IDs while the Worker returned the same 59 photos with IDs. The portal previously concatenated both sets and deduplicated by URL, producing 118 cards. V14 matches exact room/step/caption/timestamp metadata first.
- Production verification passed on GitHub Pages: `V14`, 27 saved app steps, 1,594 captured values, 17 data groups, and exactly 59 photo cards with 59 unique photo IDs and zero duplicate IDs. Heating and Zebra Room AI-summary data render and no portal load error is present.
- Review Portal commit: `2a8f9af` (`fix: restore complete inspection and dedupe photos`).

## v203 — Report Workflow Repair
**Date:** July 23, 2026

- Repaired Riverside assessment `INH-20260722-VCMSTE` downstream artifacts without changing the preserved inspection payload or Supabase originals.
- Added assessment `018` to `Home Health Report_Tracker` row 26 with `C-0017`, `H-0017`, and `RPT-018`.
- Consolidated the two Riverside Drive folders into `018 – 2026-07-22 – Hubbard – 230 Riverside Dr`; preserved the interrupted recovery duplicate inside an archived subfolder rather than deleting data.
- Created `Technician Photos`, moved all 60 preserved Drive files into it, and renamed them from opaque slot IDs to room/step/caption/photo-ID names. The 60 files represent 59 unique photos plus one clearly labeled recovery duplicate.
- Created and populated the inspection spreadsheet's `Photo Log` with all 59 unique Supabase photo records.
- Completed Tanner's tracker handoff for assessment `018`: column A is `Waiting on Labs`, the address is normalized to `230 Riverside Dr, Basalt CO 81621`, and column AO is a verified clickable link to the canonical assessment folder.
- Corrected the same normalized address in the customer/home ID record, inspection Summary, and CSV Output.
- The inspector app now includes a lightweight photo manifest in the final Apps Script payload so `Photo Log` can be built even though binary photos use Supabase.
- The Photo Worker now requires the assessment folder ID, mirrors only into its `Technician Photos` child, and refuses to create a second top-level fallback folder.
- Worker Drive filenames now use room, step, caption, and photo ID instead of `slot-0-p-*`.
- Apps Script source now assigns idempotent assessment/report/client/home IDs, writes tracker columns A:K with the initial `Waiting on Labs` status, creates the canonical assessment folder name, links that folder in tracker column AO, creates `Technician Photos`, and always writes `Photo Log`.
- Address normalization now standardizes Tanner's preferred `Street, City ST ZIP` format, fills known local Colorado ZIP codes when omitted, and stops submission with a clear format error when an address cannot be safely completed.

### Apps Script v87 deployment

- Restored `InHausLab/inhaus-apps-script` as a private GitHub repository and pushed the complete `main` history through commit `823da21`.
- Verified the local `Code.gs`, committed `HEAD`, and `origin/main` were byte-for-byte identical before updating the Apps Script editor.
- Deployed production Apps Script version `87` and updated the existing configured deployment `AKfycbwWz...LEXqQ` from version 86 to version 87. `config.js` and its stable web-app URL were not changed.
- Archived the temporary duplicate v87 deployment created during the migration; the original configured deployment remains the single intended production endpoint.
- Required production POST verification returned `{"status":"ok","checkpointed":true}`. A read-only production list check returned HTTP 200 JSON and still included the Riverside inspection.
- The pre-existing local `.clasp.json` modification was not staged, committed, pushed, or used for deployment.

## v202 — Safe Checkpoints, Intake-Driven Tests, and Portal Photo Delete
**Date:** July 22, 2026
**Branch:** `codex/safe-checkpoints-collaboration`

- Cloud-loaded inspections now flatten all nested `resumeData` checkpoints before opening, preserving complete older steps underneath a partial outer checkpoint.
- New checkpoints use resume schema v2, never embed the prior checkpoint, and include a receipt with checkpoint ID, timestamp, schema version, step count, captured-field count, and unique-photo count.
- Fixed capability detection so both the live top-level `teamFieldMerge` response and the older nested response select the server's field-level merge route.
- Team inspections now require explicit per-browser-session inspector identity confirmation, including local resume and restored active positions.
- Starting assigned work waits for a successful cloud team sync and shows a verified join receipt instead of entering the inspection after a fire-and-forget request.
- Added five automated regression tests for checkpoint flattening, two-device field preservation, explicit identity confirmation, capability parsing, and flat checkpoint receipts.
- Removed the standalone **Main Living Area** step from new inspection flows without deleting that step's saved data from older inspections or recovery checkpoints.
- Added an office-intake **Required tests for this inspection** selector. The Pre-Assessment Checklist automatically displays the selected tests and also derives Water Panel, PFAS, and Microplastics requirements from prepared kit choices.
- Added a persisted **Water test sample type** selection for Unfiltered, Filtered, or Both, visible in office preparation and the Water Samples step.
- Removed the inspector-phone `voiceReviewed` checkbox while preserving the field key and the existing review-portal room-note confirmation controls.
- Added an authenticated review-portal photo-delete route to the Photo Worker plus a portal **Delete Photo** control. Deleted IDs are saved with the review so stale Apps Script photo metadata cannot make a deleted photo reappear.
- Reverified the earlier v200 fixes in a real browser: fixed iPhone footer marker, Primary Bathroom at Step 13, no Main Living Area search result, filtered/unfiltered water controls, portal voice-review controls, annotation colors, rotation, and the new delete control.
- Added six July 22 workflow/Worker regressions; the full suite now contains 11 passing tests.
- The Riverside production inspection and its recovery snapshot were not modified during these tests.

### Follow-up requiring workflow clarification

- The handoff says only **“Step 6 — move to near end.”** In the current three-bedroom/three-bath flow, Step 6 is **Lowest Level — Room 1**. Moving it alone would split it from the Step 5 Radon Monitor Setup while the phase navigation still treats both as one Lowest Level phase. Its intended destination or whether the whole Lowest Level phase should move must be confirmed before changing this order.
- Required tests now auto-load from fields entered in the app's office intake. Auto-import from a separate external intake system will require that system's authoritative test-order field names and read endpoint; no external intake contract is currently present in this repo.

---

## v201 — Move Finding Review to the Review Portal
**Date:** July 22, 2026

- Removed the phone-side submission gate that required inspectors to clean, approve, or exclude every Smart Finding before completing an inspection.
- Pending findings remain unchanged in the inspection export and continue syncing to the cloud; no findings or photo captions are deleted or auto-approved.
- The phone's Final Review now labels pending findings as queued for the desktop review portal and keeps phone review available only as an optional action.
- Removed pending findings from the **Can I Leave?** blocker count. Required inspection fields, departure checklist, cloud backup, and missing-photo safety checks remain enforced.
- Bumped the PWA cache and visible badge to `v201` so iPhones receive the updated submission workflow without changing active inspection data.

---

## ⚠️ APPS SCRIPT RULE — MANDATORY (July 20 2026)

The Apps Script editor was wiped on July 20 2026 because Codex was editing the live script directly without saving to the repo. v52 through v64 were lost.

**Before making ANY Apps Script change:**
1. Edit `/Users/hans/inhaus-apps-script/Code.gs` first
2. Commit and push that file to the repo
3. THEN have Matt paste the new code into the editor and deploy
4. Verify POST works with curl (GET success does NOT mean POST works)
5. Update CHANGELOG with the new version number and URL

**Never edit the Apps Script editor directly.** The file is the source of truth. The editor is just a deploy target.

**POST verification command (required before calling any deploy done):**
```
curl -sL <new_url> -H "Content-Type: text/plain;charset=utf-8" -d '{"syncSecret":"ihl-sync-2026","_checkpoint":true,"inspectionId":"INH-TEST-POST","status":"prepared"}' | python3 -m json.tool
```
Must return `{"status": "ok", ...}`. Do not add `-X POST`: preserving POST across Google's redirect causes a false 405 at the redirected URL.

---

## July 22 2026 — Review Portal Cloud Save

- Added isolated Supabase table `public.review_data` with `inspection_id`, JSONB `field_data`, and `updated_at`.
- Enabled RLS, revoked browser roles, and granted only `service_role` read/insert/update access. Existing photo and Tanner tables were not changed.
- Added authenticated Photo Worker endpoints `POST /save-review` and `GET /get-review`; the Worker keeps the Supabase service key private and validates the portal review token from the Authorization header.
- Installed the Worker secret `REVIEW_ACCESS_TOKEN` and deployed `inhaus-photo-worker` version `7cf697cc-2a8e-4344-9429-876fade25529`.
- Updated `InHausLab/inhaus-review` commit `41e3ea2` so field edits still save locally for recovery, then persist through the Photo Worker and reload from Supabase on another device.
- Bumped the review portal asset URL to `portal.js?v=20260722-01` for GitHub Pages cache invalidation.
- Verified production behavior: unauthenticated reads return `401`; authenticated field save and read-back return the same JSON; review portal CORS preflight returns `204` with `Authorization` and `Content-Type` allowed. A temporary report-note value saved from the live GitHub Pages UI, survived a full reload from Supabase, and was then restored to its original blank value. Both test-created database rows were deleted after verification.
- Apps Script, `config.js`, `inspector_photo_uploads`, Tanner's tables, and clasp were not changed.

---

## Quick Reference — Current State (July 21 2026)

| Item | Value |
|------|-------|
| App version | v200 (commit bbbcd6d) — assessmentType field live |
| Apps Script | v74 source — NOT YET DEPLOYED. Paste Code.gs into editor + deploy as new version before testing. |

---

## July 21 2026 — Assessment Type / Test Mode

### What changed
- **New intake field: Assessment Type** — selector with two options: `Home Health Assessment` (default) and `Test / Training`
- Field appears at top of intake form, above Inspector Name
- Value saved to inspection object and included in sync payload (`buildExportJSON`)

### Apps Script v74 changes (NOT YET DEPLOYED)
- New constant: `TEST_ASSESSMENTS_FOLDER_ID` — paste the `_Test Assessments/` folder ID here before deploying
- `processInspection()` branches on `data.assessmentType === 'Test / Training'`
- Test path (`createTestInspectionSheet`): no tracker row write, no assessment number, folder lands in `_Test Assessments/` with name `TEST — YYYY-MM-DD — INH-ID`
- Real path (`Home Health Assessment` or field missing): zero behavior change
- Sheet inside test folder still named `InHaus Inspection — INH-ID` (standard naming)

### Before deploying Apps Script v74
1. Get the `_Test Assessments/` Drive folder ID (from Matt's Drive link)
2. Paste it into `TEST_ASSESSMENTS_FOLDER_ID` in Code.gs
3. Commit, then paste into Apps Script editor and deploy as new version
4. Verify with checkpoint POST, then a test-mode full sync

### Files changed
- `screens.js` (commit bbbcd6d): ASSESSMENT_TYPE_OPTIONS, assessmentType data init, sel() field added to intake
- `inspection.js` (commit bbbcd6d): assessmentType included in buildExportJSON
- `Code.gs` (commit 4e71b31, `/Users/hans/inhaus-apps-script/`): TEST_ASSESSMENTS_FOLDER_ID constant + createTestInspectionSheet function

---

## Quick Reference — Current State (July 20 2026)

| Item | Value |
|------|-------|
| App version | v200 |
| Live URL | https://inhaus-inspector.netlify.app |
| GitHub Pages | BROKEN — use Netlify only |
| Apps Script | v73 source / Google deployment Version 82 — completed review list and App Fix email verified |
| Apps Script URL | `https://script.google.com/macros/s/AKfycbwWzLVAIbUMDR11ryZiHft3ZTrzT9zrCQl5Gw4Tq6nIoNYhCepQYEC0dYz3r8b51LEXqQ/exec` |
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

## Apps Script v73 — Completed Review List and App Fix Email
**Date:** July 20, 2026

- Deployed authoritative Hans source commit `8ac8539` to the existing production deployment ID as Google Apps Script **Version 82**.
- `getReviewList()` now includes `prepared`, `field active`, `completed`, `needs review`, and `in-progress` inspections while continuing to hide test records.
- Preserved the v72 App Fix feedback route, private Drive attachments, retry-safe email notification, and `appFeedback: true` capability.
- Verified the production root reports `InHaus Inspector Bridge v70b is running`.
- Verified the production list returns `INH-20260720-SHMXOQ` for Jo Archer at 369 Hillcrest Dr with status `needs review`.
- Verified capabilities return `appFeedback: true` and a real POST checkpoint returned `checkpointed: true`.

---

## v200 — Field Workflow and Photo Reliability Pass
**Date:** July 20, 2026

- Preserved and regression-tested the v199 fixed iPhone footer behavior on the Photos screen.
- Completed photo deletion end to end: photo cards and the Photos screen now remove the IndexedDB record and call the authenticated Photo Worker to delete the Supabase object. Because production intentionally denies table-row DELETE, metadata is safely tombstoned with the existing UPDATE grant and excluded from all photo reads, mirroring, and confirmation checks.
- Renamed the third default bathroom to **Primary Bathroom** and moved each bedroom's private-bathroom controls to the bottom of the page.
- Removed the first Lowest Level room-name field and shortened the phase label to **Lowest Level**.
- Removed the broken Priority Laboratory order-portal link and hid the redundant in-app dictation hint on iOS.
- Added visible inspector-context fields to photo cards and includes that context in AI caption generation.
- Added compact Before/After camera controls for each kitchen remediation area; captured photos inherit the area and Before/After labels.
- Removed redundant ATP Before/After photo sections and their validation gate because the RLU scanners already capture the meter images.
- Fixed weather auto-fill to target `weatherConditions` directly instead of a nearby notes field. Added live PM2.5 and PM10 data from Open-Meteo to a dedicated particulate-matter field.
- Moved **Tests Conducted — Confirm for Tanner** out of the inspector's final field checklist; the review portal owns this confirmation.
- Added Photo Worker endpoints for cloud deletion and authenticated per-inspection photo listing so the review portal can recover photos when Apps Script metadata lags.
- Updated the review portal to merge Worker/Supabase photos and display ATP surface, pre/post RLU, cleaning status, pass/fail status, notes, and reviewer confirmation in the same order as the app.

---

## v199 — Immediate App Fix Delivery
**Date:** July 20, 2026

- Changed the feedback action to **Send to Matt** so inspectors know where the suggestion goes.
- Successful suggestions now confirm they were sent directly to Matt and retained in **Things to Fix**.
- Added Apps Script v72 source support to email every suggestion immediately to `matt@inhauslab.com`, including inspection context and private Drive links to its screenshot and voice note.
- Email delivery is retry-safe: the spreadsheet row is preserved first, failed notifications retry, and completed notifications are not sent twice.

---

## v198 — Complete Photo Deletion
**Date:** July 20, 2026

- Deleting a photo now removes it from the IndexedDB vault, inspection step data, and the photo retry queue.

---

## v197 — Compact App Feedback Icon
**Date:** July 20, 2026

- Simplified the top-left feedback shortcut to a round yellow **💡** button without visible text.
- Preserved the full “Suggest an app fix” accessibility label.

---

## v196 — App Fix Button at Top Left
**Date:** July 20, 2026

- Moved the persistent **💡 App Fix** button from above the bottom navigation to the top-left safe area.
- Keeps the feedback shortcut clear of Back, Home, Next, and Review controls on phones and tablets.

---

## v195 — Inspector “Suggest an App Fix” Queue
**Date:** July 20, 2026

- Added a persistent **💡 App Fix** button throughout the inspector app.
- Inspectors can attach a screenshot from Photos, record and review a voice note up to 60 seconds, add a typed explanation, and send the suggestion without leaving their inspection.
- Every submission automatically includes the inspector, inspection ID, address, app version, current screen/step, page URL, device/browser, timestamp, and online state.
- Added an IndexedDB feedback retry queue. If the cloud is unavailable, the suggestion and attachments stay on that phone and retry automatically when connectivity returns.
- Added a capability gate so cached/older Apps Script deployments never misinterpret feedback as inspection data.
- Added Apps Script v71 source support for a private Shared Drive folder and spreadsheet named **Things to Fix on the App**, with screenshot and voice-note links and a default `New` status.
- Apps Script source commit: `257f37b` on Hans. Live deployment still requires the approved source-to-editor deployment step; the prior v70 endpoint safely causes v195 clients to queue instead of posting.

---

## v191 — Bottom Navigation Locked to Phone Footer
**Date:** July 20, 2026

- Moved the Back, Home, Next, and Review navigation bar out of the scrolling inspection screen and into a body-level fixed footer.
- The navigation remains anchored to the bottom safe area while the inspector scrolls long checklists or changes sections.
- Increased the footer stacking layer and enabled iPhone Safari compositing safeguards so checklist content cannot pull the navigation into the page flow.
- Preserved bottom content padding so the fixed footer does not cover the final checklist items.

---

## v190 — Global Repeating Timer Alarms
**Date:** July 20, 2026

- Moved timer expiration out of the individual room field and into one app-wide alarm manager, so changing rooms or screens no longer disables the alarm.
- Added a full-screen high-visibility alarm that sounds and attempts vibration every five seconds until the inspector taps **Stop Alarm**.
- Unlocks Web Audio from the inspector's Start/Restart tap to improve alarm reliability on iPhone, requests notification permission from that same user action, and shows a lock-screen notification when the browser permits it.
- Requests a screen wake lock while a timer is running and automatically releases it when no timers remain.
- Checks all timers immediately when the app becomes visible again. If Safari was suspended or the phone was locked when a timer expired, the alarm starts immediately on reopen.
- Tapping a timer notification focuses or reopens InHaus Inspector.

**Platform limit:** iOS can suspend a web app while the phone is locked or the app is closed, and iPhone Safari does not expose vibration to web apps. Guaranteed lock-screen delivery requires a server-scheduled Web Push service and the Home Screen app with notifications enabled; sound, vibration, Focus, and silent-mode behavior remain controlled by iOS.

---

## v188 — Separate Bedrooms and Bathrooms
**Date:** July 20, 2026

- Split bedrooms and bathrooms into separate navigation and progress groups. Bathrooms no longer appear under the bedroom/upper-level section.
- Fixed `Add Bedroom` and `Add Bathroom` so they create true bedroom and bathroom steps instead of generic additional rooms.
- Added a one-tap `Add Private Bathroom` action inside each bedroom. It reuses an unopened bathroom entered during office preparation before increasing the property bathroom count, which prevents duplicates.
- Private bathrooms inherit the bedroom name (for example, `Bedroom 1 — Bathroom`) and continue following bedroom renames unless the bathroom name is manually customized.
- Added bathroom types for private/ensuite, shared, and hall/guest/standalone. Shared bathrooms can link to multiple bedrooms while remaining a single bathroom record.
- Preserved all existing `bedroom-*`, `bathroom-*`, and legacy `additional-*` step IDs so prior answers, findings, photos, and saved resume positions remain attached.
- Added compact room groups and bathroom relationship metadata to the report-builder export without duplicating room data in cloud checkpoints.
- Verified in the browser: separate navigation groups; reusing an office-prepared bathroom; creating an additional bedroom and private bathroom; automatic rename propagation; and one shared bathroom linked to two bedrooms.

---

## v184 — Room-Level FLIR Photos
**Date:** July 20, 2026

- Replaced the numbered FLIR image-log forms with photo cards.
- Every room's FLIR section now has an `Add FLIR Photo` button that imports from the device photo library and assigns the photo to that room automatically.
- After the first photo, the control changes to `Add Another FLIR Photo`; inspectors can import multiple photos at once or add more later.
- Each FLIR photo has an editable inspector comment. Multi-room areas show a room selector only when a photo cannot be assigned automatically.
- Added the same FLIR photo workflow to bathrooms and the utility room.
- FLIR photo room, comment, and photo ID are included in the report-builder export while legacy numbered FLIR entries remain readable.
- Browser smoke test verified the first-photo state, additional-photo state, automatic Bathroom assignment, editable comment, and removal of the old `FLIR Image #` field.

---

## Apps Script v69 — Large Cloud Checkpoints
**Date:** July 20, 2026

- Fixed checkpoint failures caused by Google Sheets' 50,000-character limit per cell.
- Checkpoint JSON larger than 40,000 characters is now split across multiple cells and reassembled transparently when listed or restored.
- Existing single-cell checkpoint rows remain readable; smaller updates also clear any stale chunk cells from an older large checkpoint.
- Deployed to the existing production Apps Script URL as Google deployment Version 79.
- Verified a 120,000-character checkpoint returned `checkpointed: true`, then read back all 120,000 characters with its complete `resumeData` intact.
- Reverified that `INH-20260720-SHMXOQ` (369 Hillcrest Dr, Dave) remains available and test checkpoints stay hidden.

---

## v179 — Prepared Inspections Load Automatically
**Date:** July 20, 2026

- The Select a Prepared Inspection screen now displays every available prepared inspection as soon as the screen opens; searching is optional.
- Added a clear loading spinner while the cloud list is being fetched.
- Prepared inspections are sorted newest first using the best available preparation or update timestamp.
- Made each inspection card tappable while retaining the explicit Continue on This Device button.
- Added the exact empty state: `No inspections prepared yet`.
- This release changes only the prepared-inspection screen; cloud data and sync behavior are unchanged.
- Backend hotfix: Apps Script v68 now merges `Prepared` and `Field Active` checkpoints from the Resume Data sheet into the list endpoint and returns their complete `resumeData` from the detail endpoint.
- Test and smoke-test checkpoints are excluded from the prepared-inspection list so inspectors see only real assignments.
- Checkpoint saves now perform a read-after-write verification before reporting cloud success.
- Deployed to the existing production Apps Script URL as Google deployment Version 78.
- Verified `INH-20260720-SHMXOQ` (369 Hillcrest Dr, Dave) appears as `prepared` and its complete resume record loads successfully; a fresh `INH-TEST-V68` checkpoint POST returned `checkpointed: true` and remained hidden from the inspector-facing list.

---

## v178 — Restore the Last Working Position
**Date:** July 20, 2026

- Fixed active inspections reopening on Final Review instead of the inspector's last field step.
- Home and Final Review are now treated as summary/exit surfaces and cannot overwrite the saved working position.
- Existing devices with a stale Home or Final Review position automatically migrate back to the inspection's last actual step.
- Stores the stable step ID alongside the numeric index so future step-list changes do not move inspectors to the wrong section.
- The Resume button now uses the same exact-position restore path as a full Safari reload.
- Verified locally by opening Final Review and reloading (returned to Lowest Level — Room 1), then moving to Utility Room and reloading (returned to Utility Room exactly).

---

## v177 — Battery Drain and Sample ID Scanner Reliability
**Date:** July 20, 2026

- Removed the 30-second polling save; local persistence remains event-driven on edits, navigation, explicit saves, and final submission.
- Added a persisted inspection-dirty flag so automatic cloud checkpoints run only for changed, in-progress inspections while online and visible.
- Increased the automatic checkpoint interval from one minute to three minutes; a successful checkpoint clears the dirty flag and stops the timer until another edit.
- Pauses automatic checkpoint timers while Safari is hidden and restarts them only when an active inspection still has unsynced changes.
- Capped automatic failed-photo retries at once per five minutes and prevented automatic retries while offline; explicit retry controls are unchanged.
- Updated the sample-label vision prompt to ignore barcode stripes and read the human-readable kit or sample ID near the barcode.
- Ensured sample-label scans send an image at least 800 pixels wide to the vision proxy, while leaving normal inspection-photo compression unchanged.
- Made scanner response parsing tolerate JSON code fences after an end-to-end barcode test correctly read `wtk_pfas_27079` but returned the object inside a Markdown fence.
- Added a guarded service-worker refresh when the running configuration does not contain the restored Apps Script v65 deployment URL.
- Verification: a four-minute dirty-idle browser run produced one successful automatic checkpoint and no repeating save/checkpoint loop; the 800px synthetic barcode label returned `wtk_pfas_27079`; and the redirect-safe v65 checkpoint POST returned HTTP 200 with `status: ok`.
- Rebases cleanly over the v174 checkpoint-modal cooldown and the v175-v176 Q-Trak/FLIR field updates.

---

## v176 — FLIR Meterlink Link and Q-Trak Cleanup
**Date:** July 20, 2026

- Updated the FLIR Meterlink link to open the FLIR ONE app store page.
- Preserved the v175 removal of the Q-Trak floorplan checklist item.

## v175 — Remove Q-Trak Floorplan Checklist
**Date:** July 20, 2026

- Removed the Q-Trak floorplan checklist item from room steps.

---

## v174 — Checkpoint Modal Hotfix
**Date:** July 20, 2026

- Fixed checkpoint failure modal firing repeatedly during active inspections, interrupting inspectors in the field.
- Modal now only shows if there has been no successful backup for 30+ minutes AND 10 minutes have passed since the last modal dismissal.
- Network timeouts (AbortError, Failed to fetch) no longer trigger the modal at all -- they silently retry with exponential backoff (2min → 5min → 10min).
- The top-of-screen sync banner is sufficient warning for transient network failures; the modal is reserved for genuine extended outages.

## v173 — Exact Inspection Position Restore
**Date:** July 20, 2026

- Saves `{ inspectionId, stepIdx, screen }` to `inhausActivePosition` whenever an active inspection screen renders and whenever Safari hides or unloads the page.
- On startup, restores the exact saved screen and step only after IndexedDB confirms the same inspection still exists with `in-progress` status.
- Invalid, missing, completed, or mismatched records fall back to the normal home screen without changing the existing cloud-resume workflow.
- Clears the saved position after a successful final submission or permanent inspection deletion.
- Leaves checkpoint/sync logic and the truck, intake, and pre-inspection screen flows unchanged.

---

## v172 — Cloud Photo Metadata Sync and Photo-to-Number Capture
**Date:** July 20, 2026

- Fixed a field-test failure where photo files reached Supabase immediately but captions entered after capture remained only on the phone.
- Added a dedicated authenticated photo-worker metadata endpoint so caption, room, task, and slot changes update the existing cloud photo row without re-uploading image bytes.
- Photo Organization now sends metadata before its normal inspection checkpoint and reports a retryable local-only state if either save fails.
- Verified the failure against Berta inspection `INH-20260720-X8S3U8`: four image files were present while both new captions were absent before this fix.
- Added the existing photo-to-ID scanner to the office-prep water, PFAS, and microplastics identifiers and the field PFAS kit number.
- Added an editable photo-to-number scanner for ATP pre-test and post-test RLU readings; failed scans fall back to manual numeric entry.
- Left existing field sample-ID scanners and all Q-Trak readings unchanged.

## v171 — Restored Production Bridge and Review Photos
**Date:** July 20, 2026

- Restored the feature-complete Apps Script backend after the editor wipe, including the Supabase-backed review list/detail API, team field merging, company comment library, review submission controls, and secure photo metadata recovery.
- Corrected the Supabase service-key property lookup to accept the configured `SUPABASE_KEY` name while retaining the legacy `SUPABASE_SERVICE_KEY` fallback.
- Kept checkpoints fast and non-destructive: they update the Supabase inspection record without rebuilding the final Drive workbook.
- Deployed Apps Script Version 71 and verified a real checkpoint POST, bridge capabilities, a four-inspection review list, and all 34 photos for `INH-20260717-YZNHG0` before changing the client URL.
- Updated the inspector, readiness console, reports tool, review portal, and performance page to the same verified deployment.
- Routed the readiness POST checkpoint through a same-origin Netlify health function because browsers cannot follow the Apps Script cross-origin POST redirect; the function still performs and validates the real upstream POST.

## v170 — Finding and Photo-Change Cloud Checkpoints
**Date:** July 19, 2026

- Rapid Capture now checkpoints each saved finding to the cloud immediately after the local save.
- Approving or excluding a finding now waits for a verified cloud checkpoint and clearly reports when only the local copy is safe.
- Finding comment, severity, and report-destination edits now use a short debounce and then checkpoint to the cloud.
- Photo caption and placement changes now checkpoint to the cloud instead of waiting for a later inspection-step transition.
- Confirmed the complete test-photo path through Supabase, Drive mirroring, the Apps Script record, fresh-device resume, and the review portal.
- July 20 launch hardening: replaced the stale OpenClaw readiness assumptions with v170/v64 production checks against `INH-20260717-YZNHG0`, made the headline score reflect live system health, and kept real-phone checks as the supervised-to-unsupervised gate.
- Corrected the cache-reset URL marker to v170 so field devices no longer reopen with an obsolete `v=145` query after clearing the app shell.

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
