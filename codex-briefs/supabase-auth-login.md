# Codex Handoff: Inspector App — Per-User Login (Supabase Auth)

**Written:** July 23, 2026  
**Priority:** Queued — do not build during active inspection review period  
**Repo:** /Users/hans/inhaus-update (InHausLab/inhaus-inspector)  
**Live app:** https://inhaus-inspector.netlify.app  
**Current version:** v205+

---

## Goal

Add a login screen to the inspector app so that:
1. The app is not publicly accessible without credentials
2. A casual competitor cannot open the URL and browse the full checklist/methodology
3. If code or methodology is lifted, we know whose credentials were active (accountability trail)

---

## What to build

### Login screen
- Simple email + password form shown to unauthenticated users
- On successful auth, redirect to the existing app home screen
- On failed auth, show a clear error message
- "Stay logged in" — session should persist between visits (don't log out on tab close)

### Session gate
- Every page/view of the app checks for a valid Supabase session
- If no valid session: show login screen, not the app
- If session expires: redirect to login, preserve intended destination if possible

### Logout
- Add a small logout option (e.g. in settings or the version badge area)
- On logout: clear session, return to login screen

---

## Users

| Name | Email | Role |
|------|-------|------|
| David (inspector) | TBD — Matt will provide | Inspector |
| Tanner | tanner@inhauslab.com | Team |
| Allie | allie@inhauslab.com | Team |
| Matt | matt@inhauslab.com | Admin |

Create these users in Supabase Auth dashboard manually — no self-signup flow needed. Disable public signups entirely.

---

## Supabase project

- **Project:** inhaus-lab  
- **Project ID:** kvpaqvieacccojkkxqul  
- **Credentials:** `~/.openclaw/credentials/supabase_inhaus.json`  
- **Auth:** use Supabase's built-in email/password auth (already available in the project)

---

## Technical notes

- The app is a vanilla JS PWA (no React/Vue framework). Auth state should be managed with the Supabase JS client (`@supabase/supabase-js`).
- The Supabase client is likely already initialized in `config.js` or `app.js` — extend it rather than adding a second client.
- Do NOT add the Supabase service role key to the client. Use the anon key + RLS. Auth session is sufficient to gate the UI.
- The login screen should match the existing dark theme of the app.
- Do not break offline functionality for an already-authenticated user — if they have a valid cached session, the app should still load offline.

---

## Read first

- `CHANGELOG.md` — full engineering history, current architecture
- `config.js` — where Supabase client and feature flags live
- `app.js` — main app entry point
- `service-worker.js` — handles offline caching (be careful not to break it)

---

## Verification required before calling it done

1. Open the app URL in an incognito window — must show login screen, not the app
2. Log in as David's credentials — must reach the app home screen
3. Close the tab, reopen — must still be logged in (session persistence)
4. Log out — must return to login screen
5. Confirm Supabase Auth dashboard shows the login event in the user's auth log

---

## Export/download alert system

Any action that moves data out of the app must be logged and trigger an immediate email alert to Matt.

### What counts as an export/download
- Downloading a report (PDF or any file)
- Copying a share link for an inspection
- Any data export function (CSV, JSON, etc.)
- Photo downloads (bulk or individual)

### What to log (Supabase table: `audit_log`)
Each event should write a row with:
- `user_id` + `user_email`
- `action` (e.g. `export_report`, `download_photo`, `copy_share_link`)
- `inspection_id` (if applicable)
- `timestamp`
- `ip_address`
- `user_agent` (device/browser)

### Email alert
- Send immediately to `matt@inhauslab.com` on every export event
- Use Google Apps Script or a Supabase Edge Function to send the email
- Email subject: `[InHaus Alert] Export by <user_email>`
- Email body: who, what action, which inspection, timestamp, IP, device

### Implementation note
The alert should fire server-side (Edge Function or Apps Script) — not just client-side logging, which can be bypassed.

---

## What NOT to do

- Do not add self-signup (no "Create account" flow)
- Do not break the existing photo pipeline, checkpoint sync, or offline behavior
- Do not add role-based access control yet — that's a later feature
- Do not deploy while a real inspection is in progress
