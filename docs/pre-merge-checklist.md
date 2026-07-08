# Pre-Merge Checklist — Supabase Photo Pipeline
# Branch: feat/supabase-photo-pipeline (draft PR #2)
# Last updated: July 8, 2026
# Owner: Matt (go/no-go), Tanner (schema/security), Hans (app)

This is the single source of truth for what blocks go-live.
Do not merge to main until every BLOCKING item is checked off.

---

## BLOCKING — must be done before merge

### Security

- [ ] **Drop temp read policies**
  - `temp anon read tbl` on `inspector_photo_uploads` table (Supabase dashboard → Table Editor → Policies)
  - `temp anon read bkt` on `inspection-photos` bucket (Supabase dashboard → Storage → Policies)
  - _Owner: Tanner_

- [ ] **CF Worker + signed upload URLs**
  - Move photo uploads behind the Cloudflare Worker so the publishable anon key is not write-capable from the browser
  - Service-role key stays server-side only; browser gets short-lived signed URLs
  - _Owner: Hans (build) + Matt (go/no-go)_
  - _Note: Agreed as blocking, not optional (Tanner, #ai-council thread, 2026-07-08 10:36 MDT)_

### Verification

- [ ] **iPhone offline / airplane mode test**
  - Full inspection with airplane mode on from start through sync
  - Expected: data + photos queue locally, sync succeeds after reconnect
  - Cannot declare app ready for multi-inspector use until this passes
  - _Owner: Matt (device test) — requires a real iPhone, cannot be done by Hans_
  - _Timeline: needed before 3 assessments/week scale_

### Cleanup (Supabase)

- [ ] **Delete test data from bucket**
  - Folders: `browsertest/`, `__validation__/`, `vaulttest-*/`, `flushfix-insp/`
  - _Owner: Tanner or Hans_

- [ ] **Delete test inspection rows**
  - `DELETE FROM inspector_photo_uploads WHERE inspection_id IN ('Q970DG', '0AKB8I', 'P11PU1');`
  - _Owner: Tanner_

### Infrastructure

- [ ] **Consolidate to one deployment target**
  - Currently: GitHub Pages + Netlify + Vercel all deploy from `main`
  - This already caused an incident (fixing one while phone loaded another)
  - Recommendation: Netlify only (already primary, auto-deploys, working)
  - Action: disable GitHub Pages (`gh-pages` branch is already broken/stale) and remove Vercel deployment
  - _Owner: Matt (Netlify/Vercel account access) + Hans_

---

## NON-BLOCKING — do before or shortly after merge

- [ ] **Add unique constraint on `photo_id`**
  - `ALTER TABLE inspector_photo_uploads ADD CONSTRAINT uq_photo_id UNIQUE (photo_id);`
  - Currently retries can create duplicate metadata rows (storage is idempotent, cosmetic issue)
  - Can be done as part of Tanner's reconciliation or ahead of it
  - _Owner: Tanner_

- [ ] **Drive mirror**
  - Server-side job (CF Worker or equivalent) that copies photos from Supabase Storage to Drive after inspection
  - Until built: Drive view is empty for new inspections (office staff impact)
  - _Owner: Hans (build) — can happen post-merge if Matt accepts the gap_

- [ ] **Tanner reconciliation: fold `inspector_photo_uploads` into `ihl_photos`**
  - Requires: `storage_path` column added to `ihl_photos`, parent assessment rows exist, unique constraint in place
  - See `docs/supabase-changelog-for-tanner.sql` for migration template
  - _Owner: Tanner_

---

## MERGE STEPS (when all BLOCKING items checked)

1. Bump version in `index.html` + `service-worker.js` (NOT app.js)
2. Turn `USE_SUPABASE_PHOTOS` flag ON in `config.js`
3. Merge `feat/supabase-photo-pipeline` → `main`
4. Verify Netlify deploys successfully
5. Run one live inspection on a real device to confirm photos reach Supabase Storage
6. After confirmed: retire the Apps Script photo upload path (remove base64 batch code)

---

## Next Steps — Explicit Owners

| # | Item | Owner | Blocking? | Notes |
|---|------|-------|-----------|-------|
| 1 | Drop two temp read policies in Supabase | Tanner | YES | Dashboard action, ~2 min |
| 2 | CF Worker + signed URLs | Hans (build) | YES | Design doc → Matt approves → Hans builds |
| 3 | iPhone offline/airplane mode test | Matt | YES | Real device required, cannot be proxied |
| 4 | Delete test data from bucket + table | Tanner or Hans | YES | SQL in supabase-changelog-for-tanner.sql |
| 5 | Consolidate to Netlify-only deployment | Matt + Hans | YES | Matt disables GitHub Pages / Vercel; Hans confirms |
| 6 | Add unique constraint on photo_id | Tanner | No | Can be part of reconciliation |
| 7 | Drive mirror (post-merge) | Hans | No | Matt decides: gap acceptable or build first? |
| 8 | Fold inspector_photo_uploads into ihl_photos | Tanner | No | Phase 3 — after go-live |

---

## Reference

- CHANGELOG.md: https://github.com/InHausLab/inhaus-inspector/blob/main/CHANGELOG.md
- Supabase schema notes: docs/supabase-changelog-for-tanner.sql
- Tanner update doc: docs/tanner-update-july-6-2026.md
- Staging URL: deploy-preview-2--inhaus-inspector.netlify.app
- Feature flag: `USE_SUPABASE_PHOTOS` in `config.js`
