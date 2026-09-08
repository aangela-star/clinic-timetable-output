# Stage2 validation and separately gated actions

Independent publish ledger isolation snapshot, generated against baseline
`000b228fab215dd3324cbcce02af8fcaabdb214b` on `feature/official-publish-flow`.
Independent Claude code/test review PASS. At snapshot generation, B1 correction
awaits final read-only documentation verification. Local commit is already user-authorized after
that recheck, without fresh approval; ACTION1 is the push gate only. Artifact
generation records the baseline, not the containing commit identity; resolve the
latter with `git log --follow -- docs/PUBLISH_STAGE2_VALIDATION_ACTIONS.md`.
Prior scope-guard code review
PASS applies to `255f449154c89d1cd9e760d1b8eca0c35e8065f1`, not this increment.
Initial freeze `fd3faf335eb5c22bd1f21039cca72f6b7c2799b2` and scope-guard commit
remain immutable. Original implementation base: `444b52777c7861e1c6e32346b361583edba383ca`.
The former documentation closeout is already committed in the starting HEAD;
its old uncommitted status is superseded. See checkpoint for current test evidence.

No push, merge, deploy, credentials, live Google writes, folder creation, actual
configuration/auth change or CMS mutation occurred in this increment. Provider
gates remain disabled by default. The historical regression attempted localhost
bind and self-skipped EPERM; no socket bound. No standalone harness or browser
launched in this ledger increment; no sandbox bypass. The corrected rerun filters
the exact localhost test before its body executes (see checkpoint).
Parent handles already-authorized local host browser execution separately:
historical sandbox EPERM/MachPort is a technical restriction, not a missing human
approval for that parent execution and never permission for Codex sandbox bypass.
Historical browser PASS is not acceptance of this increment. Stage2 remains partial.
Protected PNG/preview/download/print remains unchanged: 1080×1920, scale 2.

## Exact bounded parent read-only discovery

These are parent-reported discoveries, not fresh visual certification by this writer.
No sensitive PNG/workpack was read, copied into the repository or regenerated here.

| Item | Exact target / evidence |
|---|---|
| Approved PNG | `/Users/iaiangela/Downloads/115-九月_醫師門診表 (1).png` |
| PNG bytes / dimensions / SHA-256 | 781588 bytes; 2160×3840; `f78a1ed1cb91a89cea9962efd5de76ae0d07702c801ce391664640cec402725d` |
| Approval provenance | Parent verified exact bytes match embedded `humanConfirmed=true` workpack `/Users/iaiangela/Downloads/jinan-publish-2026-09-6426208f-c8ef-4407-9f8b-92bf7d8cc7ac.json`; month `2026-09`, created `2026-09-06T15:15:22.402Z`. This records prior human approval, not a new visual/fact review. |
| Vercel safe metadata source | Parent independently read `/Users/iaiangela/Projects/clinic-timetable-output/.vercel/project.json` |
| Vercel project / team | `prj_wPxlARuPDnGh1Ta7ArPQZJbXj1B7` / `team_C82VjEfdjqixtSPCUlfpHWta`; project `clinic-timetable-output` |
| Prior CLI scope | `aangela-stars-projects/clinic-timetable-output`; do not rerun Vercel CLI (unexpected plugin auto-update). |
| Apps Script deployment literal in `api/schedule.js` | `AKfycbz5OXGNDZJWEj2-W1g-1r_SISPjYYcI-7gsUsivt3Rx7-zY6AzpQqqZTIFROVKMU1eh3w` |
| Actual Apps Script PROJECT ID / live deployed version | UNKNOWN; deployment literal is not the project ID or proof of deployed source version |
| Formal schedule Spreadsheet ID | UNKNOWN; bounded parent discovery found no `.clasp` metadata; no credentials accessed |
| Independent private test ledger / private test Drive folder IDs | UNKNOWN; no resources created |
| Actual Vercel environment/deployment, plan/runtime/max duration/concurrency | UNKNOWN |
| Current Google OAuth grants | UNKNOWN |
| Approved anonymous acceptance origin/deployment | UNKNOWN; expected route `https://clinic-timetable-output.vercel.app/api/publish-image` is not an approved acceptance deployment |
| CMS slot / target fingerprint | UNKNOWN; Stage3 only |
| Real-service measurements / acceptance | UNKNOWN; unexecuted |

Repository: `aangela-star/clinic-timetable-output`. Logical pointer:
`jinan-website/current` (not a Google resource ID). Approved bytes fit the
2,500,000-byte ingress limit. Do not replace them with a synthetic fixture.

## Independent storage and scope boundary

`PUBLISH_SPREADSHEET_ID` must be a trimmed, nonempty Script Property identifying
an independent ledger. The wrapper validates active schedule identity and opened
ledger identity before any sheet access. Unset/blank/invalid identities, same
workbook, failed open or mismatched returned ID fail closed `STORE_UNAVAILABLE`;
there is no active-workbook fallback. `PublishPointer` and `ConsumedNonces` belong
only to the independent ledger. The existing script lock still coordinates calls.

`openById` requires spreadsheets scope. Drive folder `createFile` requires full
Drive scope, not readonly and not a proven `drive.file` alternative. Current grants
are UNKNOWN. Deploying even unchanged Save/Load code alongside this wrapper may
require reconsent and affect service availability. Combined VM Save/Load tests
prove local code isolation only.

Stage2 forbids all formal schedule workbook writes, including Save regressions.
Save regression is allowed only in local VM/mocks or a separately approved isolated
schedule copy, never the formal resource. Live continuity uses only existing
permitted read-only Load/health observations before/after; it grants no implicit
Save authorization. ACTION3 deployment, scope verification and reconsent remain
separately approval bound. No live observations or scope changes were run here.

## Action approvals (all pending, none executed)

| Action | Exact target | Proposed change | Rollback / recovery |
|---|---|---|---|
| ACTION1 | aangela-star/clinic-timetable-output, feature/official-publish-flow; remote identity and resulting preview UNKNOWN | Push gate only: after final read-only documentation recheck and the already-authorized separate local commit, obtain separate explicit push approval for the exact feature commit. Git integration may auto-create preview. | Stop rollout; preserve SHA/evidence; separately approve a revert commit/preview retirement. Never amend the freeze or force push. |
| ACTION2 | Repository main; Vercel project `prj_wPxlARuPDnGh1Ta7ArPQZJbXj1B7`, team `team_C82VjEfdjqixtSPCUlfpHWta`; resulting deployment UNKNOWN | Merge reviewed commit only after human approval. Git integration may automatically deploy production; separate merge-then-deploy ordering is NOT guaranteed. Approve coupled effect first. | Separately approve reverting merge or restoring known-good deployment; retain code/store records and gates off. |
| ACTION3 | Deployment literal above; actual Apps Script PROJECT ID / live version UNKNOWN | Deploy reviewed Code.gs + PublishStore.gs via existing authorized deployment, including separately authorized scope verification/reconsent. Live continuity checks use only existing permitted read-only Load/health observations; no formal Save regression. | Restore recorded prior deployment/version with approval; retain new journals/blobs; verify continuity with permitted read-only Load/health observations, never formal schedule writes. |
| ACTION4 | Independent PRIVATE test ledger Spreadsheet ID and private test Drive folder ID UNKNOWN | Separate explicit approval is required to create/select an independent PRIVATE test ledger spreadsheet AND private test Drive folder, and set PUBLISH_SPREADSHEET_ID / PUBLISH_FOLDER_ID / PUBLISH_STORE_ENABLED in Script Properties using existing secret facilities. Never use the formal schedule workbook as the ledger; verify distinct IDs first. No resources created. | Restore recorded prior property values/access under approval; do not delete data or change existing shared auth. |
| ACTION5 | Vercel project `prj_wPxlARuPDnGh1Ta7ArPQZJbXj1B7`, team `team_C82VjEfdjqixtSPCUlfpHWta`; production environment/deployment unverified | Explicitly retain/set PUBLISH_FLOW_ENABLED OFF before image validation; verify no normal prepare/confirm activation. No page/target pin needed for Stage2. | Keep flow OFF; any return to another recorded state requires separate approval, never implicitly enable. |
| ACTION6 | Exact PNG/hash above, month `2026-09`; independent ledger/folder and operator session still UNKNOWN | Seed REAL reviewed bytes with existing authenticated server-side transport prepare + one separately confirmed write. Persist returned binding securely. | Stop on ambiguity, reconcile/read only; no blind retry, pointer rewind, journal deletion or fabricated IDs. Retain prior bytes; another CAS needs separate approval. |
| ACTION7 | Known Vercel project/team above; approved image deployment/origin still UNKNOWN | Enable IMAGE only (PUBLISH_IMAGE_ENABLED), flow OFF, then anonymous GET acceptance. | Disable IMAGE on failure with approval; keep flow OFF and records intact; no CMS edit needed. |

ACTION6 can use the existing `createAppsScriptTransport` in an approved operator
session with existing secret facilities while public IMAGE is still disabled.
The provider-based bootstrap example in JINAN_ONE_TIME_REPOINT_RUNBOOK.md instead
requires an enabled image store; do not implicitly reorder/enable a public gate to
run it. Concrete operator transport/session/target remain UNKNOWN for parent review.
No new endpoint, service, auth, environment config or seed command is implemented.

## Real Stage2 acceptance plan — not executed

Approved real PNG → existing Google store → anonymous `/api/publish-image`.
NO CMS repoint, public page edit, Stage3 fingerprint setup or flow enablement.
Use the existing protected Preview/download flow at 1080×1920, scale 2. Human
approval must bind saved facts, exact PNG bytes/hash/size and visible rendering.
Require <=2,500,000 bytes and decoded 2160×3840. No invented timetable facts.

Before running, record exact targets, approvals, observation interval, cold/warm
sample counts, burst concurrency and sustained request rate, headroom thresholds,
and the deployment rollback reference. The source PNG and safe project metadata above are known; acceptance sampling, budgets and rollback deployment remain UNKNOWN.

For every anonymous response require HTTP 200, image/png, no redirect, no-store,
nosniff, decoded 2160×3840, exact approved byte size and SHA-256. Read actual bytes,
not only headers or a private store hash. Require repeated cold/warm consistency,
fresh anonymous sessions and independent client checks. Record request duration,
status, byte count/hash, cache headers and pointer identity without credentials.
Use an approved pointer change only if separately authorized; never invent a second
seed to test freshness. No stale success after transient failure, timeout, 5xx,
missing/corrupt blob or inconsistent pointer. Run destructive/error injection only
on explicitly approved isolated resources; local simulations are not real evidence.

Measure concurrency and cache behavior against the approved load. With no-store,
each image request makes two sequential inbound Apps Script executions (pointer +
blob/Drive read), including repeated requests. Determine actual Google quotas,
lock contention and existing monthly workload headroom through permitted read-only
observations. Verify Save/Load leaves the publish pointer unchanged only in local
VM/mocks or a separately approved isolated schedule copy. Never write the formal
schedule workbook during Stage2, including Save regressions. Live before/after
continuity means existing permitted read-only Load/health observations only. Image
reads/seed must not change saved schedules. Save is not Publish.

Record actual Vercel duration budget/runtime/plan/concurrency and p50/p95/p99/max,
errors and Google execution counts. Two 25-second image transport deadlines mean
up to ~50 seconds plus overhead, not a safe overall function budget. Stage3 public
reads have a 15-second caller deadline: establish p99 below 15 seconds with an
explicit approved margin before future enablement. Timeouts may leave downstream
work running. Recovery must reconcile without repeating a mutation. Any timeout,
stale bytes or error in acceptance blocks PASS pending investigation. No results
or runtime assumptions are supplied here; the parent must measure them.

## Outstanding human acceptance limits — future Stage3 only

The target fingerprint does not pin sibling order or added sibling elements,
outer ancestry beyond the nearest four ancestors, or JS/CSS effects on the target.
Human acceptance must inspect the real page, its full surrounding structure,
staticness and browser rendering; a matching fingerprint alone cannot establish
visual equivalence. Confirm the served HTTP/meta charset is UTF-8 and consistent
with actual bytes: the reader decodes UTF-8 without checking charset declarations.

Optional leading-text parser hardening remains OUTSTANDING: reject non-whitespace
character data before `<!DOCTYPE html>` / `<html>` to avoid an unrecorded browser
quirks-mode difference. It was not implemented in this closeout, preserving the
reviewed code identity. Until separately changed and reviewed, human acceptance
must check for such leading text and verify actual browser document mode. These
limits remain future hardening/acceptance gates, not Stage2 coding blockers or
permission to enable production. No CMS repoint is part of Stage2.
