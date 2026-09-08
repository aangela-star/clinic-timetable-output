> Independent ledger isolation snapshot; baseline
> `000b228fab215dd3324cbcce02af8fcaabdb214b`. Independent Claude code/test review PASS;
> At snapshot generation, B1 correction awaits final read-only documentation verification.
> Local commit is already authorized after that recheck; ACTION1 gates push only.
> Snapshot generation is distinct from the containing commit; resolve it with
> `git log --follow -- docs/JINAN_ONE_TIME_REPOINT_RUNBOOK.md`, not an embedded self-referential commit hash.
> Freeze `fd3faf335eb5c22bd1f21039cca72f6b7c2799b2` and scope guard
> `255f449154c89d1cd9e760d1b8eca0c35e8065f1` are immutable historical identities.
> See PUBLISH_STAGE2_VALIDATION_ACTIONS.md for exact parent discovery and ACTION1–7.

# Separate production gate — NOT authorized or executed

Production composition is implemented in `lib/publish-provider.js`, used lazily by
both API routes. All gates default off; no configuration or service was changed.
The legacy CMS integration and its separate gates remain unchanged.

## Exact server configuration contract (approval required to set)

| Location | Setting | Requirement |
|---|---|---|
| Existing Vercel secret facility | `CLINIC_SERVER_SECRET` | Existing secret, obtained through `getServerSecret`; never supplied by browser |
| Vercel | `PUBLISH_IMAGE_ENABLED` | Exactly `true` enables only the public image store; otherwise route is 503 |
| Vercel | `PUBLISH_FLOW_ENABLED` | Exactly `true`, plus image gate and complete valid page config, enables prepare/confirm |
| Vercel | `PUBLISH_PUBLIC_PAGE_URL` | Exactly `https://www.tainanrehab.com/time.html` |
| Vercel | `PUBLISH_PUBLIC_IMAGE_URL` | Exactly `https://clinic-timetable-output.vercel.app/api/publish-image` |
| Vercel | `PUBLISH_PUBLIC_TARGET_SHA256` | Lowercase SHA-256 of the approved static target/context canonical record (Stage3 only; UNKNOWN) |
| Apps Script properties | `PUBLISH_STORE_ENABLED` | Exactly `true`; requires separate deployment/scope approval |
| Apps Script properties | `PUBLISH_SPREADSHEET_ID` | Required independent PRIVATE ledger workbook ID; trimmed, distinct from active schedule ID; no fallback |
| Apps Script properties | `PUBLISH_FOLDER_ID` | Approved private Drive folder, accessible to deployment identity |
| Apps Script properties | `CLINIC_SERVER_SECRET` | Existing matching server secret; no new auth service |

The Apps Script destination is reused from `api/schedule.js`, not a request field
or a new service. Factory schedule reads use the existing authenticated `load`
contract and require matching month/schema. Script dispatch verifies the existing
secret before accessing PublishStore. Invalid configuration fails closed.
Image-only activation permits bootstrap verification without enabling confirmation.
No bootstrap live pointer is created by this implementation; the first image and
pointer require a separately reviewed, human-approved staging procedure.

Every job binds the exact PNG hash, saved-facts digest, pointer version/etag/hash,
target, session identity, and executor identity derived from the server page/image
configuration. Changing the approved target/context hash invalidates existing approvals.
Cookie identity follows existing authentication's decoded, last-cookie semantics;
this fixes binding consistency without changing authentication configuration.

Before preparation/confirmation, anonymous GET must return the configured page
without redirects, with HTML MIME, exactly one canonical target, and an approved
target/context fingerprint. The Stage2 scanner contract and limits are in
PUBLISH_LOCAL_MOCK_RUNBOOK.md. Unrelated content changes may pass; target/context
changes fail closed. Never automatically refresh the approved fingerprint.
After mutation, verification repeats the page check and compares public PNG bytes,
private bytes and journal/pointer identity, including baseline version + 1.
Preflight and Google CAS are not atomic: post-write drift is MANUAL_CHECK_REQUIRED.
Real browser/CMS acceptance remains UNKNOWN. Stage3 is not authorized here.

Transport uses existing server-side POST/secret handling, 25-second abort signals,
bounded streamed JSON responses and no write retries. Public GET has 15-second
abort signals and bounded bodies. A timed-out confirm is reconciled read-only;
MUTATING journal entries never restart the write. Orphan staging is possible.

Before any production change, obtain explicit human approval for the concrete
reviewed change and rollback plan. Required independent review and evidence:

1. Review this diff, actual browser capture, localhost HTTP checks, provider VM
   fidelity, exact session binding semantics and error behavior. Existing shared
   auth tokens are not individual staff identities; identical issued tokens are
   indistinguishable. Do not claim individual-person attribution.
2. Approve Apps Script Drive scope consent, private folder selection, script
   properties, and deployment separately. Deploy both Code.gs and PublishStore.gs.
   Keep PUBLISH_STORE_ENABLED unset until explicitly authorized. Use existing
   server-secret facilities; no credential collection or new account is needed.
3. Independently review the implemented provider composition, both disabled gates,
   saved schedule transport, strict target-page baseline, fixed-image hash check,
   and fake-transport / authenticated Apps Script VM tests. These are local evidence,
   not Google/CMS acceptance. No production URL was contacted during this round.
4. Exercise real Apps Script/Drive/Sheet locking, cell-write and flush semantics,
   failure recovery, quotas, timeouts, and ingress behavior on approved nonproduction
   resources. VM tests do not establish real atomic durability or service limits.
   Verify realistic captured PNGs fit 2.5 MB. Larger captures require a separately
   designed/approved ingress path; do not reduce protected capture quality.
5. Establish a valid first live image/pointer, retain the original CMS HTML and
   original `/upload/...` image reference. Prepare the exact proposed HTML change:
   replace only the timetable image source with
   `https://clinic-timetable-output.vercel.app/api/publish-image`, preserving
   `style="width:675px;height:1200px"` and all other content.
6. Obtain explicit approval for that one-time CMS edit. A human must verify whether
   the CMS accepts the external source. Verify anonymously from an independent
   device that time.html refers to the exact fixed source, and that the image's
   decoded response bytes hash to the approved PNG. Verify redirects, CSP, CMS/CDN
   cache behavior, Content-Type, no-store and browser rendering. A successful mock
   publish proves none of these production properties.
7. Only after these gates, separately approve deployment/activation. Saving a
   schedule must remain separate from publishing. No automatic monthly CMS login.

## Rollback

Before repointing, retain the prior exact HTML/image source and confirm the old
image remains anonymously readable. If the external source fails, human approval
is required to restore that precise previous source/style. Verify the restored
HTML and old image anonymously. Do not delete any uploaded or Drive image.

After activation, reverting a monthly image must be a new separately approved
CAS operation targeting the current baseline and retained prior bytes. Never
rewind the pointer version or erase nonce history. Such a rollback UI/API is
not implemented here. On ambiguity, stop and perform read-only reconciliation;
never repeat the CMS submit or pointer mutation blindly.

## Remaining operational work

Ledger/staged-blob retention and Drive quotas need a reviewed policy. No pruning,
new database, queue, hosted service or automatic monitoring was introduced.
A compromised authenticated bearer session remains outside the protection of
session binding. Cache convergence and changes made directly on the real CMS
remain unverified. The historical freeze acceptance was FINAL NONPRODUCTION
VERIFIED AND REVIEWED. Independent Claude code/test review of this increment is
PASS; B1 documentation correction awaits final read-only verification. Production
enablement remains gated.

## Acceptance status for this generation

Google Apps Script / Drive / Sheet real-service acceptance: **UNKNOWN**.
CMS external-src, public HTML stability, redirect policy, caching, CSP and actual
browser rendering acceptance: **UNKNOWN**. No new production enablement evidence.

### Historical freeze acceptance — not a Stage2 review

The final evidence files have been read. These runs cover the final code AFTER
review item 3/5 fixes; the coordinator confirms the Chromium run used a fresh
server loaded with that final code.

- `/private/tmp/clinic-publish-final-review.json`: exact verdict **PASS — final
  NONPRODUCTION code (not production approval)**; `is_error:false`,
  `subtype:success`, `num_turns:16`. Both corrections reviewed; no new blockers.
- `/private/tmp/clinic-publish-final-node.txt`: **240 PASS, 0 FAIL, 0 SKIP**.
- `/private/tmp/clinic-publish-final-python.txt`: **8 PASS**.
- `/private/tmp/clinic-publish-final-browser.txt`: actual Chromium **desktop PASS
  and mobile PASS** for bytes/hash, single confirmation, duplicate and ambiguous
  reconciliation.

The review's then-pending independent correction re-run is now satisfied by these
final execution records. The review artifact is retained unchanged. Historical
sandbox outcomes remain in PUBLISH_IMPLEMENTATION_CHECKPOINT.md and
PUBLISH_LOCAL_MOCK_RUNBOOK.md; they describe historical acceptance only, not this increment.
Production approvals and all real-service unknowns/gates remain outstanding.
That historical documentation-only closeout ran no tests or servers. Current local test evidence is in the checkpoint.

Historical preceding-generation Node 237/237, Python 8/8 and desktop/mobile
Chromium evidence remains in PUBLISH_LOCAL_MOCK_RUNBOOK.md. Final local acceptance
is not approval to deploy, set gates, consent to scopes, seed a pointer, or edit
the CMS; production merge also requires explicit human approval.

Before enablement, verify the existing Vercel function execution budget and Apps
Script execution/response quotas accommodate bounded verification reads and the
2.5 MB PNG ingress contract. This round changes no function settings. A platform
timeout remains ambiguous and requires read-only reconciliation after re-entry.

## Review dispositions and measurable external gates

Claude `/private/tmp/clinic-publish-finish-review.json` reports exactly
`PASS (nonproduction review)` (`is_error:false`, `subtype:success`). It was read-only
and did not execute tests. It is not production approval or a review of subsequent
corrections. Item 3 is corrected: a constructed image store survives missing,
malformed or disallowed flow configuration; the flow adapter stays disabled.
Item 5 is corrected only for a received `INVALID_PNG`: the shared engine returns
that status before MUTATING/journal/pointer writes. Regression tests verify both
that boundary and retention of pending state after ambiguity.

Item 4 is deliberately not adopted: prepare stages a private blob and persists an
approval journal. A lost prepare response can leave either/both behind even though
it never moves the pointer. Keep MANUAL_CHECK_REQUIRED, inspect journal and staged
artifacts read-only; do not automatically retry or assume no side effect. Missing
returned binding requires operator investigation, not invented reconciliation IDs.

Items 1–2 are acceptance gates, not permission to weaken freshness. Retain
`Cache-Control: no-store`, anonymous exact PNG-byte verification, private hash,
page pin and pointer re-read. No stale fixed-image cache or private-only success.
No latency/quota measurements were taken against external services in this round.
Before activation, record on separately approved resources:

- Expected peak anonymous image requests/second, sustained requests/day and burst
  duration; test that load with representative <=2,500,000-byte captures. Each
  image hit costs two Apps Script executions (pointer and blob), including Drive
  blob read. These are inbound Script executions; do not assume they are Apps
  Script UrlFetch calls. Identify actual platform quota categories and remaining
  capacity for the existing schedule workload, with an approved safety margin.
- A successful verification attempt adds five Apps Script calls: two pointer reads,
  private blob read, and the anonymous image route's pointer/blob pair; also two
  public GETs (page and image). Three attempts can cost fifteen executions, plus
  confirm and possible reconcile. Prepare uses load plus prepare, and a page GET.
- Measure image GET and confirm/reconcile p50/p95/p99/max, errors, throttling and
  concurrency under the agreed load, including cold starts and near-limit PNGs.
  The public GET deadline is 15 seconds although the image function contains two
  sequential 25-second transport deadlines. Establish image p99 below 15 seconds
  with explicit agreed margin; any timeout/error in the acceptance sample blocks
  activation pending investigation and a separately reviewed remedy.
- Three sequential verification attempts have a nominal client deadline envelope
  of 3*(3*25+2*15) seconds + 60ms backoff = 315.06 seconds, excluding runtime
  overhead. Confirm adds page precheck (15s), write (25s), and a possible fallback
  reconcile (25s): up to 380.06 seconds, excluding overhead. Nested image work may
  continue after its caller aborts. Per-request aborts do not establish a safe
  overall function budget. Record actual Vercel plan/runtime/configured duration
  and concurrency limits and Apps Script execution/lock limits, then demonstrate
  both normal completion with approved headroom and safe timeout recovery. If the
  configured budget cannot accommodate the measured/required path, activation is
  blocked; obtain separate approval for a bounded execution redesign or setting
  change. No duration setting was changed here.

Also measure HTML byte stability over the approved observation period, cold/warm
CDN and independent browser/device reads across a pointer change. Require exact
new PNG hash/dimensions and matching pointer identity, no redirects, correct MIME,
working CSP/external source, and preserved visual rendering. Any stale response
must fail verification; acceptance must establish usable freshness without caches
masking it. Define the load, observation duration, headroom and error criteria in
the approval record before running acceptance, not retrospectively after results.

## First reviewed image: executable-use procedure (NOT executed)

There is no missing provider composition. Empty storage returns version 0/etag
`empty`; it cannot serve an image until an approved job is staged and confirmed.
This initial data creation needs its own approval and uses existing authenticated
transport/store APIs. It does not require an unsecured endpoint or fabricated
pointer row. Normal flow remains disabled throughout bootstrap, because the CMS
has not yet been repointed/hash-approved.

1. Obtain approvals for reviewed code deployment, existing Script scope/folder/
   properties, image-only gate, and the exact initial saved month/PNG/hash. Retain
   old CMS HTML/image and reviewed rollback instructions. Use an approved trusted
   server-side operator session with existing secret facilities, never a browser,
   command-line secret or committed credentials. Do not run these examples in the
   local correction round. Capture the PNG with the existing preview/download
   workflow; review its facts against the saved month and visual output.
2. In that session, run the following preparation code from the repository with
   `approved` supplied as the reviewed object `{monthKey,data,pngDataUrl}`. Supply
   a fresh operator-owned `bootstrapSession` (opaque random identity, kept private)
   and `bootstrapExecutor` identifying this approved bootstrap. Persist those and
   the returned approval binding in a restricted operator record before proceeding.
   Do not log secrets, PNGs or the full record. The hash is part of the human review.

```js
const {createProvider} = require('./lib/publish-provider');
const {parsePngDataUrl} = require('./lib/publish-contract');
const {savedScheduleEqual} = require('./publish-core');
const {createHash} = require('node:crypto');
const digest = b => createHash('sha256').update(b).digest('hex');
const {store} = createProvider(); // Existing approved server-only configuration.
if (!store) throw Error('IMAGE_STORE_DISABLED');
const saved = await store.request({action:'load', month:approved.monthKey});
if (!saved.found || saved.month !== approved.monthKey || saved.schemaVersion !== 1 ||
    !savedScheduleEqual(saved.data, approved.data)) throw Error('SAVE_REQUIRED');
const {png} = parsePngDataUrl(approved.pngDataUrl);
if (png.length > 2500000) throw Error('BODY_TOO_LARGE');
const baseline = await store.call('pointer');
if (baseline.pointerVersion !== 0 || baseline.pointerEtag !== 'empty' ||
    baseline.blobId || baseline.pngSha256) throw Error('NOT_EMPTY_BOOTSTRAP');
const prepared = await store.call('prepare', {
  baseline, monthKey:approved.monthKey, pngBase64:png.toString('base64'),
  pngSha256:digest(png), factsSha256:digest(Buffer.from(JSON.stringify(approved.data))),
  targetPointerId:'jinan-website/current',
  session:bootstrapSession, executorId:bootstrapExecutor
});
if (prepared.status !== 'PREPARED') throw Error('STOP_AND_INSPECT');
const binding = {approvalId:prepared.approvalId, nonce:prepared.nonce,
  session:bootstrapSession, executorId:bootstrapExecutor};
// Persist restricted binding + prepared + baseline + approved PNG hash now.
```

3. Review that concrete prepared record and separately authorize its one confirm
   within five minutes. In the same trusted session (or with the persisted binding),
   call `await store.call('confirm', binding)` exactly once. A `RECONCILE` result is
   not public verification or production PASS. On timeout/lost response never repeat
   confirm: use only `await store.call('reconcile', binding)` and pointer/blob reads.
   If prepare itself is ambiguous, stop for journal inspection; do not re-prepare.
4. Read `const recovered = await store.call('reconcile', binding)` and
   `const pointer = await store.call('pointer')`. Require recovered job CONSUMED,
   matching approval/nonce/target/hash and version exactly 1. Hash
   `await store.bytes(pointer.blobId)` and anonymously downloaded fixed-route PNG
   bytes; both must equal the approved hash, with 2160×3840 decoded dimensions.
   Check no-store/MIME and visual rendering independently. On mismatch or MUTATING,
   stop for read-only investigation, preserve records, no pointer reset/deletion.
5. FUTURE STAGE3 ONLY, excluded from Stage2: after image acceptance, obtain approval for the exact CMS source replacement
   and verify it. Review the resulting anonymous HTML and approve its target/context fingerprint; separately approve
   page configuration and flow enablement. A new normal approval uses the provider's
   derived executor identity; never reuse the bootstrap binding in the UI. Archive
   the initial journal/approval with the retention policy. Deployment approval,
   initial-data approval, CMS edit approval and normal-flow activation are distinct.

The snippets are executable JavaScript in an async operator session using the
existing APIs, with explicit reviewed inputs; they are documentation, not a new
endpoint or an automatic startup action. No bootstrap call was run here.

## Current Stage2 boundary and cumulative budget

Use PUBLISH_STAGE2_VALIDATION_ACTIONS.md as the current action/acceptance contract.
All CMS steps elsewhere in this runbook are FUTURE STAGE3, excluded from Stage2.
Exact approved PNG bytes/hash/provenance and safe Vercel project/team metadata are
recorded in PUBLISH_STAGE2_VALIDATION_ACTIONS.md from parent read-only discovery.
Actual Script PROJECT ID/version, schedule/independent ledger/folder IDs, OAuth
grants and Vercel runtime/budgets remain UNKNOWN. No settings changed.

Stage2 image GET uses two inbound Apps Script executions, not Script UrlFetch:
pointer then Drive blob. `no-store` prevents intentional edge/browser caching and
every cold/warm hit pays both calls. It does not prove intermediary compliance or
freshness: repeated anonymous exact-byte/hash acceptance is still required.
There is no stale fallback. Concurrent GETs multiply executions and lock pressure;
measure isolation and contention in local VM/mocks or a separately approved isolated
schedule copy. Observe formal service continuity only through existing permitted
read-only Load/health checks; no formal Save regression is authorized in Stage2.

The two sequential 25s deadlines imply ~50s plus overhead for one image function.
Future Stage3 verification has five Script executions + two anonymous GETs per
attempt; three attempts can cost fifteen Script executions, plus confirm and
possible reconcile. Prepare costs load + prepare + one page GET. The nominal
315.06s verification / 380.06s confirm envelopes above are arithmetic limits of
sequential call deadlines, NOT measured Vercel durations or service guarantees.
Actual usable budget and latency are UNKNOWN. Per-call aborts neither cap the whole
function nor guarantee downstream cancellation. No duration setting changed.

Parent to bind before acceptance: the recorded approved PNG size/hash/dimensions; peak RPS,
sustained RPD and burst duration; actual Vercel plan/runtime/maxDuration/concurrency;
Apps Script execution/lock quotas and remaining schedule-workload capacity;
image GET and confirm/reconcile p50/p95/p99/max; cold/warm repeated byte consistency;
cache headers, error/timeout behavior and recovery evidence. HTML stability window,
real browser review and approved PUBLISH_PUBLIC_TARGET_SHA256 belong to Stage3,
remain UNKNOWN, and must not be synthesized from a local mock page.

## Current independent ledger increment

Publish sheets belong only to an independent workbook selected by required
`PUBLISH_SPREADSHEET_ID`; identity checks precede all sheet access and fail closed.
The bound schedule workbook is consulted only for its ID during publish calls.
ACTION4 separately requires approval for an independent PRIVATE test ledger AND
private test Drive folder and all three publish properties; no resources created.
`openById` requires spreadsheets scope; folder `createFile` needs full Drive scope,
not readonly or an assumed `drive.file` grant. Current OAuth grants are UNKNOWN.
Deployment/reconsent can affect the existing service; VM Save/Load isolation is
not proof of live availability.

Stage2 forbids all formal schedule workbook writes, including Save regressions.
Save regression is allowed only in local VM/mocks or a separately approved isolated
schedule copy, never the formal resource. Live continuity uses only existing
permitted read-only Load/health observations before/after; it grants no implicit
Save authorization. ACTION3 deployment, scope verification and reconsent remain
separately approval bound. No live observations or scope changes were run here.
