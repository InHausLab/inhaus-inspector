# InHaus Inspector — Monday Go-Live Checklist

## Release

- Inspector app: **v170**
- Live app: https://inhaus-inspector.netlify.app/
- Backup deployment: https://inhaus-inspector.vercel.app/
- Review portal: https://inhauslab.github.io/inhaus-review/
- Apps Script bridge: **v64**

## Current Go/No-Go Status

**GO for a supervised field inspection after the phone shows v170.**

Verified on the live production systems:

- Office preparation saves to the cloud and appears under Continue Inspection.
- A phone-sized session can resume the prepared inspection.
- Multi-inspector identity, section assignments, My Work, and Team Sync work.
- Rapid Capture creates a Smart Finding.
- The original inspector comment remains visible while a separate cleaned report comment is reviewed and approved.
- Restore points and audit history work.
- The review portal loads the real inspection `INH-20260717-YZNHG0` with all **34 photos**.
- All 34 photos have individual placement controls and Describe controls.
- Photo destinations include **Water Treatment System**.
- Netlify and Vercel serve the same v170 cache, database guard, header controls, and cache-reset guidance.
- Cloud, photo, AI, and local database operations now fail with retryable messages instead of spinning indefinitely when a request or transaction stalls.
- Rapid Capture, finding approval/exclusion, photo captions, and photo placement changes now checkpoint to the cloud immediately after their local save.
- No live browser warnings or errors were present at the end of the audit.

## Before the First Inspection

1. Open https://inhaus-inspector.netlify.app/ on the inspector's phone.
2. Pull down to refresh. If needed, open https://inhaus-inspector.netlify.app/cache-reset.html once.
3. Confirm the gray version badge says **v170**.
4. Confirm only one InHaus Inspector tab is open.
5. Open the prepared inspection through **Continue Inspection** and select the inspector's name.
6. Take one ordinary test photo, add a short comment, and confirm it appears in Findings before beginning the full house.

## Field Guardrails

- Keep the app open while photos are uploading.
- A photo comment must be cleaned or excluded in Findings; it is never silently discarded.
- Do not leave the property until the final screen says the cloud save is verified and no photos remain waiting.
- Do not submit anything to Tanner until photo placement and required review items are complete.
- If an upgrade-blocked banner appears, close every other InHaus Inspector tab and tap the banner to retry.

## Manual Checks That Require a Real Phone

These cannot be fully automated because they require phone hardware or browser permission:

- Camera capture from the phone camera picker.
- Voice dictation through the phone keyboard or microphone permission.

The existing 34-photo production inspection verifies the downstream upload, review, description, and placement pipeline.

## QA Record

`INH-20260719-XDHKTK` is a clearly labeled test record (`TEST v164 — DO NOT REPORT`) created during the end-to-end audit. Do not send it to Tanner.
