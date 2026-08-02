# AGENTS.md — InHaus Inspector App Operating Spec

> This file is the operating contract for every agent (Codex, Claude, Hans, or any future AI)
> working in this repo. It must be read before any task begins.
> When a process changes, update this file as part of the same commit. Never bypass it.

---

## Definition of Done

A task is **done** when and only when:

- **E2E-1 passes** against the deployed artifact.
- The real deployed product is used through the normal browser/human workflow with
  realistic data. Automated, unit, integration, contract, build, and smoke tests are
  prerequisites; they are not acceptance proof by themselves.
- Browser screenshots and direct checks of the affected systems of record or generated
  artifacts prove the result. State every affected path that remains unverified.
- The passing run is recorded in the completion report (run ID or timestamp, not just "it passed").
- CHANGELOG.md is updated with the change, version bump, and commit SHA.
- This file is updated if any process described here changed.

"Looks correct," "deploy succeeded," or "tests pass locally" do not satisfy done. Done requires
an E2E-1 pass on the live, deployed surface.

**E2E-1 cleanup requirement:** E2E-1 creates test data in production Supabase under the
`E2E-TEST` prefix. Cleanup must run at the end of every E2E-1 execution. Before scheduling
E2E-1 as a nightly job, prove cleanup is bulletproof: run it, inspect Supabase, confirm no
ghost rows remain. Do not schedule until that proof exists.

---

## Diagnosis Protocol

Every bug fix follows this sequence. Do not skip steps.

```
SYMPTOM:     Exact observed behavior (what failed, where, when)
ROOT CAUSE:  Specific code path, config value, or data condition responsible
FIX:         What changed and why (file, line, logic)
PROOF:       Objective verification — curl result, E2E-1 pass, Drive row confirmed,
             Supabase row confirmed. "Code looks right" is not proof.
```

If proof requires a phone, mobile browser, or user-authenticated session you cannot
access directly: **stop and write a handoff brief**. Do not attempt verification you
cannot perform. Do not say it is fixed.

**The agent owns the retry loop.** Deploy, verify, diagnose, and retry independently
whenever tooling and access permit. Never use Matt, Tanner, Hans, or an inspector as a
retry button. Ask a person only for a blocker requiring their identity, authorization,
physical device, or business decision. Do not ask them to perform a check the agent can
perform through the browser, API, database, repository, deployment system, or generated
artifacts.

**Three-failure hard stop.** After two failed attempts: record what was tried, state
the remaining hypothesis, one more attempt only if materially different. After three
failures: stop completely. Write a handoff brief with problem, files, symptoms, changes
tried, log evidence, remaining hypotheses, and requested next action. No fourth attempt.

---

## Deploy Discipline

1. **Inspector app (Netlify):** deploy via `git push` to `main`. Never deploy by dragging
   files or using the Netlify UI directly — it bypasses version tracking.

2. **Apps Script:** it is not part of the inspector app, review portal, or handoff
   production path. Do not restore an Apps Script fallback or second writer.

3. **Cloudflare Worker:** deploy via `wrangler deploy` from a machine with a valid
   Cloudflare API token scoped to the InHaus account (`bbf861ec`). The deploying
   machine must be documented. See deploy-path registry below.

4. **Version bump:** every deploy increments the version in `index.html` and
   `service-worker.js`. The version badge lives there — not in `app.js`.

5. **No deploys during active inspections.** If David or any inspector is on-site,
   do not deploy to production. Coordinate with Matt first.

### Deploy-Path Registry

| Component       | Deploy method         | Required credential          | Authorized machines         |
|-----------------|----------------------|------------------------------|-----------------------------|
| Inspector app   | `git push` → Netlify  | GitHub (InHausLab org)       | Any machine with git access |
| CF Worker       | `wrangler deploy`     | CF API token, account bbf861ec | Hans's Mac Mini (as of Aug 2026) |
| Supabase schema | Supabase dashboard    | Supabase project credentials | Any browser                 |

**Single-machine dependency:** The CF Worker currently requires Hans's Mac Mini. If that
machine is unavailable, the recovery path is: provision a new `wrangler` environment on
any Mac/Linux machine, set `CLOUDFLARE_API_TOKEN` from the stored credential, run
`wrangler deploy` from `workers/inhaus-photo-worker/`. Token location: ask Matt.
This dependency must be eliminated (CI/CD or GitHub Actions) before going to scale.

---

## Scope Rules

1. **Fix what is asked. Nothing else.** Do not refactor adjacent code, rename variables,
   or improve unrelated behavior in the same commit. Scope creep hides regressions.

2. **One hypothesis at a time.** State the hypothesis, make the minimal change to test it,
   verify, then proceed. Do not bundle multiple theories into one deploy.

3. **Schema changes need Tanner's sign-off.** Tables `ihl_photos` and `ihl_assessments`
   are Tanner's. Do not alter their schema without explicit approval. New app-owned tables
   (e.g., `inspector_photo_uploads`) are fine.

4. **No production data mutations during debugging.** Use `E2E-TEST` prefix entries or
   a designated scratch project. Never write to or delete real inspection records as
   part of a diagnostic step.

5. **Auth before features.** If an endpoint serving inspection data is found to be
   unauthenticated, that is P0 and blocks all other work until resolved. Client PII
   must not sit behind guessable URLs.

---

## Completion Report Format

Every task — however small — closes with a report in this format:

```
TASK:        [one line description]
CHANGE:      [files changed, what changed]
VERSION:     [new version number, if applicable]
COMMIT:      [SHA]
E2E-1:       [PASS — run ID/timestamp] | [NOT RUN — reason]
PROOF:       [what was verified and how]
CHANGELOG:   [updated / not applicable — reason]
OPEN ITEMS:  [anything deferred, with owner]
```

If E2E-1 was not run, state why explicitly. "Didn't have time" is not acceptable.
Acceptable reasons: task was documentation-only, E2E-1 is not yet scheduled (state this),
or E2E infrastructure is down (state this and file a follow-up).

---

## Auth Audit Requirement

Before any field inspection with real client data:

- Every endpoint serving inspection data (Worker routes and portal APIs)
  must require authentication.
- Run the audit: attempt unauthenticated GETs against every known endpoint. Record results.
- Report findings before fixing anything. The report is the deliverable, not the fix.
- Verify current deployed state. Do not assume one endpoint's bearer token covers all
  surfaces.

---

## This File

- Lives at the root of this repo as `AGENTS.md`.
- Read it before starting any task.
- When a process described here changes, update this file in the same commit.
- If this file and actual practice diverge, the file is wrong — fix the file.
- The global Codex rules at `~/.codex/AGENTS.md` apply in addition to this file.
