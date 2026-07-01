# Report Viewer QA Checklist

Use this before sending a report-viewer link to Hans, Tanner, or an inspector.

## Links

- Public viewer: https://inhaus-inspector.netlify.app/reports
- Direct sample: https://inhaus-inspector.netlify.app/reports/report.html?id=INH-20260428-DKNSOB
- Default sample inspection: `INH-20260428-DKNSOB`

## Quick QA

- Open the public viewer link in a fresh tab.
- Confirm it auto-loads `INH-20260428-DKNSOB` without typing an ID.
- Confirm the status says `Loaded INH-20260428-DKNSOB.`
- Confirm the report shows cover, executive summary, property snapshot, systems/environment, room findings, testing/samples, actions, observations, follow-up, and photo appendix.
- Confirm the photo appendix shows image cards and no broken-image icons.
- Use the Copy Link button and confirm the copied URL or status message includes `?id=INH-20260428-DKNSOB`.
- Enter the known portal code and confirm the viewer loads the live inspection list without an unauthorized warning.
- Use Print / Save as PDF and confirm the loader controls are hidden from the PDF.
- Check a phone-width viewport for no horizontal scrolling.

## Tanner Review Questions

- Does this section order match the final report workflow?
- Which sections should be hidden when there is no reviewed content?
- Which photo captions need Tanner-facing wording instead of field labels?
- Should the report readiness score remain internal-only?
- What exact credit, license, and disclaimer language belongs in the final client report?

## Endpoint Map

- `REPORT_REVIEW_API_URL` points to the v37 bridge endpoint and supports `action=list` and `action=get` with the portal access token.
- `REPORT_BRIDGE_API_URL` points to the same authoritative bridge and remains the fallback for `action=getReview`.
- The v37 bridge returned `status: ok`, `count: 4` for `action=list`, and returned the full `INH-20260428-DKNSOB` inspection for `action=get`.
- The viewer falls back to static JSON under `/reports/api/` so the public sample can render without entering a portal code.
- Live tokens should stay out of links. Use session storage through the access-code field for any live review access.
- The authoritative Apps Script deployment is `AKfycbxmOMfSGaz9sDHxAKBjNXtJ44MLdusXRe-GOrV6nGH0Iw0tciFg1Wkw-02hB-dQglAbgQ` unless a newer verified handoff says otherwise.

## Current Safe Behavior

- Bare `/reports` and `/reports/report.html` auto-load the default sample.
- `?id=...`, `?inspectionId=...`, `?inspection=...`, `?report=...`, and `#INSPECTION-ID` are accepted as direct-link inputs.
- A missing inspection shows Retry and Load Sample actions instead of leaving the user at a dead end.
- Report footer marks the output as an internal draft until reviewed against source inspection data, lab results, and client scope notes.
