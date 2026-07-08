# Tanner Update — July 6, 2026
# FINAL — approved for send

To: tanner@inhauslab.com (via Slack DM)
Subject: Inspector app update — two things from this weekend

---

Hi Tanner,

Quick update on two things from this weekend.

**1. Apps Script v50 (live July 4)**

Deployed a fix for the duplicate folder problem. The old version was creating new folders on every retry because the folder lookup was mismatched. V50 now matches by exact inspection name. Let me know if you're still seeing duplicates from your side.

**2. Photo pipeline — Supabase (staging only, not live yet)**

We moved this because the old photo path was not working well enough for field use. Photos were going from iPhone browser → base64 → Apps Script → Google Drive, and that created three big problems:

- Too slow, especially with 40+ photos
- Fragile, with failures around Apps Script, Drive folders, duplicate uploads, and Sheet logging
- Not a scalable or secure long-term architecture

The new path is much cleaner: photos now upload as real JPEG files directly to Supabase Storage when they are taken. Metadata is written into a new staging table, `inspector_photo_uploads`.

This is add-only. We did not change any existing `ihl_*` tables, columns, indexes, RLS policies, data, or functions.

What was added:

- Private storage bucket: `inspection-photos`
- New staging table: `inspector_photo_uploads`
- Add-only RLS/grants so the inspector app can upload photo files and metadata

Why this matters: the photo pipeline finally works from a real iPhone and is no longer dependent on Apps Script/Drive as the upload bottleneck. The same system that works for 5 inspectors should work for 100, because photos go straight into object storage instead of being pushed through Apps Script one batch at a time.

A few decisions are yours when we're ready to go live:

1. Should Supabase Storage become the source of truth for photo files, or should photos still be mirrored into Drive?
2. How do you want `inspector_photo_uploads` folded into `ihl_photos`? Right now `ihl_photos` has `drive_url` but no `storage_path`.
3. Since `ihl_photos.inspection_id` has an FK to `ihl_assessments`, photo reconciliation needs a parent assessment row first.
4. Before wider rollout we should move uploads behind a Cloudflare Worker with signed upload URLs so the public key is not write-capable.

Nothing here blocks you. It is isolated, additive, and reversible. Happy to jump on a call or send the full technical changelog if helpful.

Matt
