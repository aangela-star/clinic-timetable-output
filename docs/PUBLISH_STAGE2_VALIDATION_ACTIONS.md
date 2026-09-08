# Stage2 validation and separately gated actions

Current state: Stage2 code review PASS; execution PARTIAL; browser acceptance
UNVERIFIED / pending (sandbox listener EPERM / Chromium MachPort). Whole Stage2 is
not complete and production is not approved. No browser retry or sandbox bypass.
Exact initial reviewed commit (immutable freeze): `fd3faf335eb5c22bd1f21039cca72f6b7c2799b2`.
Exact Stage2 reviewed commit (local): `255f449154c89d1cd9e760d1b8eca0c35e8065f1`.
Original implementation base: `444b52777c7861e1c6e32346b361583edba383ca`.
The user authorized the exact local Stage2 commit; it is a direct child of the
initial freeze, which was not amended. This later documentation-only closeout is
UNCOMMITTED, pending final Claude read-only documentation review.

Independent Claude code review: PASS, 19 turns, no coding blockers; evidence
`/private/tmp/clinic-stage2-review.json`, SHA-256 `ee82dde69cbca7b5a6f161ce3194b22a58d53bf11e83e2544fe661f29e673156`.
Independent coordinator execution: Node 298 PASS, 0 FAIL, 0 SKIP; Python 8 PASS;
`git diff --check` PASS. The checkpoint records exact log hashes. Those executions
satisfy the review's pending Node/Python rerun; browser acceptance remains pending.
Historical browser PASS does not apply to this Stage2 identity. No tests were run
in this closeout. Protected PNG/preview/download/print behavior remains unchanged
from the initial freeze (1080×1920, html2canvas scale 2).

No push, merge, deploy, credentials, real store access, actual configuration
change or CMS mutation is authorized by this document. Settings named here are
DOCUMENTATION ONLY. Provider gates remain disabled by default. No targets were
discovered and no values were invented during closeout.

## Targets and evidence still required from parent

| Item | Exact approved target / result |
|---|---|
| Real approved source PNG path, approval and saved month | UNKNOWN |
| Real PNG byte size, SHA-256, decoded dimensions and visual approval | UNKNOWN |
| Existing Google Apps Script project / deployment / version | UNKNOWN |
| Existing Google Sheet and private Drive folder | UNKNOWN |
| Actual Vercel team/project/environment/deployment | UNKNOWN |
| Actual Vercel runtime/plan/max duration/concurrency | UNKNOWN |
| Approved anonymous acceptance origin/deployment URL | UNKNOWN |
| Real CMS timetable slot identifiers / approved target fingerprint | UNKNOWN; Stage3 only |
| Real-service measurements / acceptance result | UNKNOWN; no run performed |

Expected repository is `aangela-star/clinic-timetable-output`; current branch is
`feature/official-publish-flow`. Expected production route is
`https://clinic-timetable-output.vercel.app/api/publish-image`; this expectation
is not discovery/verification of a Vercel project or an approved acceptance target.
Logical store pointer is the implemented `jinan-website/current`, not a discovered
Google resource ID. Do not substitute generated/synthetic fixtures for the REAL
approved PNG. The parent must resolve UNKNOWN fields before authorizing an action.

## Action approvals (all pending, none executed)

| Action | Exact target | Proposed change | Rollback / recovery |
|---|---|---|---|
| ACTION1 | aangela-star/clinic-timetable-output, feature/official-publish-flow; remote identity and resulting preview UNKNOWN | After final read-only documentation review and separate push approval, push the approved feature commit; the exact reviewed Stage2 code is already committed locally. Git integration may auto-create preview. | Stop rollout; preserve SHA/evidence; separately approve a revert commit/preview retirement. Never amend the freeze or force push. |
| ACTION2 | Repository main; Vercel project/deployment UNKNOWN | Merge reviewed commit only after human approval. Git integration may automatically deploy production; separate merge-then-deploy ordering is NOT guaranteed. Approve coupled effect first. | Separately approve reverting merge or restoring known-good deployment; retain code/store records and gates off. |
| ACTION3 | Apps Script project/deployment/version UNKNOWN | Deploy reviewed Code.gs + PublishStore.gs via existing authorized deployment, including separately reviewed scopes. | Restore recorded prior deployment/version with approval; retain new journals/blobs; verify Save/Load. |
| ACTION4 | Drive folder, Script Properties, Sheet IDs UNKNOWN | Approve existing private folder/scope and store properties PUBLISH_FOLDER_ID/PUBLISH_STORE_ENABLED using existing secret facilities. | Restore recorded prior property values/access under approval; do not delete data or change existing shared auth. |
| ACTION5 | Vercel production project/environment UNKNOWN | Explicitly retain/set PUBLISH_FLOW_ENABLED OFF before image validation; verify no normal prepare/confirm activation. No page/target pin needed for Stage2. | Keep flow OFF; any return to another recorded state requires separate approval, never implicitly enable. |
| ACTION6 | Approved real PNG/month/hash and existing Google store UNKNOWN | Seed REAL reviewed bytes with existing authenticated server-side transport prepare + one separately confirmed write. Persist returned binding securely. | Stop on ambiguity, reconcile/read only; no blind retry, pointer rewind, journal deletion or fabricated IDs. Retain prior bytes; another CAS needs separate approval. |
| ACTION7 | Approved Vercel image deployment/origin UNKNOWN | Enable IMAGE only (PUBLISH_IMAGE_ENABLED), flow OFF, then anonymous GET acceptance. | Disable IMAGE on failure with approval; keep flow OFF and records intact; no CMS edit needed. |

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
and the deployment rollback reference. All values are currently UNKNOWN.

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
lock contention and existing monthly Save/Load workload headroom. Verify saving
and loading a month before/after image setup leaves publish pointer unchanged;
image reads/seed must not change saved schedules. Save is not Publish.

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
