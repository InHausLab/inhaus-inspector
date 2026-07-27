# Codex Handoff: Fix gog Sheets + Drive Access

**Written:** July 23, 2026  
**Priority:** HIGH — blocks Hans from reading/writing Sheets and Drive without Matt screenshots  
**This has been attempted multiple times and keeps failing. Debug root cause, don't just re-add the scopes.**

---

## Problem

Hans cannot read Google Sheets or Drive using `gog`. Every attempt returns either:
- `401 unauthorized_client` — scope not authorized
- `403 forbidden` — no permission

Gmail via the same service account works fine.

---

## What has been tried (do not repeat these)

1. Matt added Drive + Sheets scopes to domain-wide delegation in Google Admin Console (done multiple times, still fails)
2. `gog auth service-account set` with the key file — configured successfully but Sheets still 403
3. Manual Python JWT token workaround — worked once (July 15) but only for 1-hour tokens, not a fix

---

## Current state

- **Service account:** `inhaus-gmail-reader@openclaw-integration-v2.iam.gserviceaccount.com`
- **Client ID:** `104548056530019489477`
- **Key file:** `~/.openclaw/credentials/inhaus-gmail-reader.json`
- **gog service account configured:** yes (`gog auth service-account set` runs clean)
- **Gmail:** works
- **Sheets:** `403 forbidden` — `The caller does not have permission`
- **Drive:** `401 unauthorized_client`

---

## What to diagnose

1. Confirm what scopes are actually authorized in Google Admin Console right now (not what Matt thinks he added — what's actually there). Use the Google Admin SDK or `gam` if available.
2. Check if the service account needs to impersonate `matt@inhauslab.com` — some Workspace configs require a `--subject` / impersonation header for Sheets access even with DWD enabled.
3. Check if the Sheets files themselves are owned by a personal Gmail account vs the Workspace account — service accounts can't access files they haven't been shared with, even with DWD.
4. Try explicitly sharing both sheets with `inhaus-gmail-reader@openclaw-integration-v2.iam.gserviceaccount.com` as a test — if that works, the DWD scopes are wrong. If it still fails, the key or token is wrong.

---

## The two sheets that need to be readable right now

- `1hBgLwSjj5RacpIfrhtWpK4SQwZfPT85FZ7zjOq6AEzk` — Things to Fix (sheet 1)
- `1cKR0ziNbbCl44leVhbz_wXtU6rX_6na7vqKWroiWTFk` — Things to Fix (sheet 2, duplicate)

Once access works: read both sheets, merge into one, report which rows are unique to each.

---

## Verification

```bash
gog sheets get "1hBgLwSjj5RacpIfrhtWpK4SQwZfPT85FZ7zjOq6AEzk" "A1:Z50" --json --account inhaus-gmail-reader@openclaw-integration-v2.iam.gserviceaccount.com
```

Must return actual row data, not a 401 or 403. That is the only acceptable verification.

---

## Do not

- Do not tell Matt to go back to Google Admin Console again without first confirming the scopes aren't already there
- Do not say it's fixed without running the verification command above
