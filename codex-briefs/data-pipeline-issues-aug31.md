# Codex Handoff Brief — Data Pipeline Issues
**Date:** August 31, 2026  
**Priority:** HIGH — 4 issues blocking Tanner's report workflow  
**Source:** Tanner's audit spreadsheet (https://docs.google.com/spreadsheets/d/1ykRQtoGyvxVNH-XMnvepndAmJNLyfmxvzZhEyu08HHI)

---

## Current live state

- **Inspector App:** v245 on Netlify (https://inhaus-inspector.netlify.app/)
- **Review Portal:** V89 on GitHub Pages (https://inhauslab.github.io/inhaus-review/)
- **Apps Script:** v87 live
- **Inspector App repo:** `/Users/hans/inhaus-update/` → `InHausLab/inhaus-inspector`
- **Review Portal repo:** `InHausLab/inhaus-review`
- **Apps Script repo:** `InHausLab/inhaus-apps-script`

Read `CHANGELOG.md` in the inspector repo before touching anything.

---

## Issue 1 — Follow-up/recheck items fragmented across 3 inconsistent computations (HIGH)

### Symptom
Three separate surfaces each produce a different follow-up list for the same inspection. They share zero rooms in common in tested cases:
1. **App Spreadsheet → Follow-Up table** (inspector flags during inspection)
2. **Review Portal → `roomData.followUpItems` rollup** (reviewer additions)
3. **Review Portal → "Suggestions from Findings" live panel** (computed from freeform notes + both of the above, but drops at least one inspector-flagged room entirely)

Depending which surface Report Copy reads, the recheck plan is missing 1 to most rooms with no indication anything is missing.

### Root cause (Tanner's finding)
No single merge step exists. Each computation reads from a different source and none reconciles with the others.

### What to build
One authoritative follow-up list that:
- Starts with inspector-flagged follow-up items from the rooms array
- Merges reviewer additions from `roomData.followUpItems`
- De-dupes by room
- Becomes the single source the Suggestions panel, _context.md, and Report Copy all read from

### Verification
On any real submitted assessment: the Suggestions panel, the _context.md Client Follow-Up Plan field, and the App Spreadsheet Follow-Up table all show the same rooms. No room with a mold recheck note, water issue, or inspector flag is absent from any of the three surfaces.

---

## Issue 2 — Client Follow-Up Plan field always empty in _context.md (HIGH)

### Symptom
`_context.md` Client Follow-Up Plan field is `Not recorded` on every assessed inspection, even when the Review Portal's Suggestions panel has populated recheck content that could fill it.

### Root cause
The Suggestions panel content is never written into the Client Follow-Up Plan structured field. It requires manual copy-paste, which reviewers consistently skip because nothing requires it.

### What to build
When the review is submitted to Tanner, auto-populate the Client Follow-Up Plan field in the generated `_context.md` from the authoritative merged follow-up list built in Issue 1. If the reviewer has already written content in the field, prefer their text. If the field is empty and a merged follow-up list exists, write it in automatically.

### Verification
Submit a test review. Open the generated `_context.md`. Client Follow-Up Plan is populated with all rooms from the merged follow-up list. Not `Not recorded`.

---

## Issue 3 — Review Portal Data tab captures ~10 of 140+ fields (HIGH)

### Symptom
The "Review Portal Data" tab in the generated assessment spreadsheet holds approximately 10 rows (handful of Summary-step answers, 5 photo-grouping entries, system/handoff metadata). The same review's Raw Review Data tab and live portal contain 140+ distinct fields including every per-room note, no-issues flag, and the client follow-up plan. None of those land in the curated tab.

No visible rule governs what lands in this tab vs. what doesn't. Tanner cannot use it as a quick-reference without digging into raw JSON.

### What to build
Expand the Review Portal Data tab to include at minimum:
- All per-room notes (inspector notes + reviewer additions)
- All no-issues flags per room
- Follow-up flags per room
- Client Follow-Up Plan
- Assessment Observations (all 5 fields when populated)
- Actions Taken
- Any reviewer-edited field values

Alternatively: document exactly which fields the tab is designed to carry (if it's intentionally a subset) and make it consistent and predictable. Currently it's neither.

### Verification
On any submitted assessment: the Review Portal Data tab contains per-room notes and follow-up flags visible in the live portal. No per-room note present in the portal is missing from the tab.

---

## Issue 4 — Photo annotations never reach Drive (HIGH)

### Symptom
Photo markup added in the Review Portal (circles, arrows, text annotations) is stored in a `photoAnnotations` field as coordinate/overlay metadata, but the actual Drive photo file and its URL never change. The Drive folder always gets the original unmodified image.

Additionally: at least one assessment showed `photo copy pending: 4` — photos can get stuck mid-sync to Drive and never arrive.

### Root cause (Tanner's finding)
Annotations are stored as separate coordinate metadata, never baked into an exported image and never pushed to Drive.

### What to build
On review submission to Tanner:
1. For each photo with saved annotations, render the annotation overlay onto the photo (composite the arrows/circles/text at the saved coordinates into a new image)
2. Push the composited image to Drive (replace or supplement the original file in Technician Photos)
3. Update the Drive URL reference in the submission package to point at the annotated version
4. For stuck photos (`photo copy pending`): add a retry mechanism and surface the error clearly instead of silently failing

### Verification
Submit a review with at least one annotated photo. Open the Drive Technician Photos folder. The photo file shows the annotation overlays. The original unannotated version is either replaced or the Drive folder contains the annotated version as the primary file.

---

## Hard constraints — do not change

- **Never deploy Apps Script via clasp** — always paste source into the editor UI and deploy new version manually. This is in CHANGELOG.md.
- **Tanner's `ihl_photos` and `ihl_assessments` Supabase schema** — do not modify. Tanner owns these tables.
- **Do not touch the Supabase auth / login feature** — it's queued, not in scope for this brief.
- **Review Portal is on GitHub Pages** — verify the Pages deployment actually updated before calling it done.
- **Inspector App deploys via Netlify auto-deploy** — push to main, verify `curl -s https://inhaus-inspector.netlify.app/service-worker.js | grep CACHE_NAME` shows the new version.
- **Version bump required on every app change** — bump in both `index.html` AND `service-worker.js`.

---

## Secondary issues (MEDIUM — do not start until HIGH items are done)

Tanner documented 16 additional issues. Do not scope these into this brief. The full list is at:  
https://docs.google.com/spreadsheets/d/1ykRQtoGyvxVNH-XMnvepndAmJNLyfmxvzZhEyu08HHI

Top MEDIUM items if there's time after HIGH:
- **Issue 12:** Utility Room / Arrival & Setup rooms outside `rooms[]` array — invisible to all rollups
- **Issue 18:** Q-Trak location has competing values (original app vs. reviewer override) with no canonical winner
- **Issue 8:** Room name and Q-Trak location label mismatches/collisions (two rooms can have identical qtrakLocation)
- **Issue 15:** `_context.md` status race — reads "In Review" 26 seconds after actual submission

---

## Proof required before calling any issue done

Do not say fixed without the following evidence attached:

| Issue | Proof required |
|---|---|
| 1 — Follow-up fragmentation | Screenshot or curl output showing same rooms in Suggestions panel + _context.md + App Spreadsheet Follow-Up table |
| 2 — Client Follow-Up Plan empty | Contents of generated _context.md Client Follow-Up Plan field after test submission |
| 3 — Review Portal Data tab incomplete | Row count and sample of per-room note rows from the tab after test submission |
| 4 — Annotations to Drive | Drive folder photo file showing annotation overlays visible |

Hans will not mark any issue complete based on "looks right in code" alone.
