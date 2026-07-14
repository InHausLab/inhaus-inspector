-- supabase-changelog-for-tanner.sql
-- What the Supabase photo pipeline added to the inhaus-lab project
-- Branch: feat/supabase-photo-pipeline (draft PR #2)
-- Date: July 5, 2026
-- Author: Hans (inspector app)
-- Status: STAGING ONLY — not merged to production yet
--
-- Zero changes to any existing table, column, index, policy, function, or data.
-- Everything below is ADD-ONLY.

-- ============================================================
-- 1. Storage bucket
-- ============================================================
-- Created via Supabase dashboard (Storage > New bucket)
-- Name: inspection-photos
-- Public: false (private)
-- Layout: <inspectionId>/<photoId>.jpg
--   e.g. INH-20260705-P11PU1/photo-abc123.jpg

-- ============================================================
-- 2. New staging table
-- ============================================================
CREATE TABLE IF NOT EXISTS inspector_photo_uploads (
    id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    photo_id        text NOT NULL,          -- app-assigned, e.g. "photo-abc123"
    inspection_id   text NOT NULL,          -- e.g. "INH-20260705-P11PU1"
    room_name       text,
    step_name       text,
    caption         text,
    slot            int,
    bucket          text DEFAULT 'inspection-photos',
    storage_path    text NOT NULL,          -- full path inside bucket
    drive_url       text,                   -- filled by Cloudflare Worker /mirror
    source_system   text DEFAULT 'inspector_app_v2',
    created_at      timestamptz DEFAULT now()
);

-- Go-live requires a unique photo_id so retries stay idempotent.
-- Add the constraint after deleting test/duplicate rows in section 7.

-- ============================================================
-- 3. RLS policies (table)
-- ============================================================

-- Enable RLS
ALTER TABLE inspector_photo_uploads ENABLE ROW LEVEL SECURITY;

-- Allow anon role to insert
CREATE POLICY "anon insert inspector_photo_uploads"
    ON inspector_photo_uploads
    FOR INSERT
    TO anon
    WITH CHECK (true);

-- TEMP: read policy added during testing only — DROP BEFORE GO-LIVE
-- CREATE POLICY "temp anon read tbl"
--     ON inspector_photo_uploads
--     FOR SELECT
--     TO anon
--     USING (true);
-- ^ This was created during staging verification. Must be dropped before production.

-- ============================================================
-- 4. RLS policies (storage bucket)
-- ============================================================
-- Applied via Supabase dashboard (Storage > inspection-photos > Policies)
--
-- INSERT policy: "anon can upload to inspection-photos"
--   Principal: anon
--   Operation: INSERT
--   bucket_id = 'inspection-photos'
--
-- UPDATE policy: "anon can update objects in inspection-photos"  
--   Principal: anon
--   Operation: UPDATE
--   bucket_id = 'inspection-photos'
--
-- TEMP read policy: "temp anon read bkt" — SELECT for anon
--   ^ Added for staging verification. Must be dropped before go-live.
--
-- No SELECT policy for real data (intentional — prevents public reads).

-- ============================================================
-- 5. What was NOT changed (Tanner's existing schema)
-- ============================================================
-- The following objects were discovered, audited, and left completely untouched:
--
--   organizations
--   ihl_users             (4 rows)
--   customers
--   homes
--   ihl_assessments
--   ihl_assessment_files  (has drive_file_id + drive_url — built for Drive mirroring)
--   ihl_photos            (18 columns: inspection_id FK→ihl_assessments, photo_id,
--                          room_name, slot, drive_url, source_system default 'apps_script',
--                          raw_jsonb, uuid, ...)
--   ihl_lab_results
--   ihl_air_quality_rooms
--   ihl_sync_runs         (209 rows from dormant n8n automations)

-- ============================================================
-- 6. Reconciliation notes for Tanner
-- ============================================================
-- When ready to fold inspector_photo_uploads into ihl_photos:
--
-- a) ihl_photos has no storage_path column — only drive_url.
--    The schema was designed around Drive-as-store. Recommend adding:
--    ALTER TABLE ihl_photos ADD COLUMN storage_path text;
--
-- b) ihl_photos.inspection_id is a FK to ihl_assessments.inspection_id.
--    A photo row needs a parent assessment row. The staging table avoids
--    this entanglement; reconciliation will need assessment rows to exist first.
--
-- c) Suggested migration to move staged photos into ihl_photos (template only):
--
--    INSERT INTO ihl_photos (
--        inspection_id, photo_id, room_name, slot,
--        storage_path, source_system, created_at
--    )
--    SELECT
--        inspection_id, photo_id, room_name, slot,
--        storage_path, source_system, created_at
--    FROM inspector_photo_uploads
--    WHERE inspection_id IN (
--        SELECT inspection_id FROM ihl_assessments  -- FK safety
--    )
--    ON CONFLICT DO NOTHING;  -- if you add a unique constraint

-- ============================================================
-- 7. Cleanup (before or at go-live)
-- ============================================================
-- Delete test data from bucket:
--   - browsertest/
--   - __validation__/
--   - __codex_validation__/
--   - __codex_mirror_*/
--   - vaulttest-*/
--   - flushfix-insp/
--
-- Delete test inspections from inspector_photo_uploads:
--   DELETE FROM inspector_photo_uploads WHERE inspection_id IN ('Q970DG', '0AKB8I', 'P11PU1');
--   DELETE FROM inspector_photo_uploads WHERE inspection_id ILIKE '__codex%';
--
-- July 14 go-live additions required for the Cloudflare Worker mirror:
--   ALTER TABLE inspector_photo_uploads ADD COLUMN IF NOT EXISTS drive_url text;
--   ALTER TABLE inspector_photo_uploads ADD CONSTRAINT uq_photo_id UNIQUE (photo_id);
--
-- Drop temp read policies:
--   DROP POLICY "temp anon read tbl" ON inspector_photo_uploads;
--   -- Also drop "temp anon read bkt" from Storage bucket policies via dashboard.
