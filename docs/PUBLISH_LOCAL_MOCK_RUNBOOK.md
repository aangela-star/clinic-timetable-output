> Independent ledger isolation snapshot; baseline
> `000b228fab215dd3324cbcce02af8fcaabdb214b`. Independent Claude code/test review PASS;
> At snapshot generation, B1 correction awaits final read-only documentation verification.
> Local commit is already authorized after that recheck; ACTION1 gates push only.
> Snapshot generation is distinct from the containing commit; resolve it with
> `git log --follow -- docs/PUBLISH_LOCAL_MOCK_RUNBOOK.md`, not an embedded self-referential commit hash.
> Freeze `fd3faf335eb5c22bd1f21039cca72f6b7c2799b2` and scope guard
> `255f449154c89d1cd9e760d1b8eca0c35e8065f1` are immutable historical identities.
> See PUBLISH_STAGE2_VALIDATION_ACTIONS.md for exact parent discovery and ACTION1–7.

# LOCAL MOCK publishing — no production success claimed

Repository: `aangela-star/clinic-timetable-output`. Worktree:
`/private/tmp/inspection-repo-publish-worktree`, branch `feature/official-publish-flow`.
No production service, credentials, environment flags, CMS, or deployment are needed.

## Run

The filtered regression command below does not run the localhost HTTP test.
Standalone harness/browser commands are a separate host handoff, not executed in
this correction round. The historical regression attempted a bind and self-skipped
EPERM; no socket bound. No standalone harness/browser or sandbox bypass occurred
in the ledger increment. See checkpoint for distinct original and rerun logs.

```sh
cd /private/tmp/inspection-repo-publish-worktree
node --test --test-skip-pattern='^localhost HTTP auth, save, prepare, confirm, public image, limits$' tests/*.test.cjs
python3 -m unittest discover -s tests
node tools/mock-publish-store-server.js /private/tmp/<fresh-stage2-directory> <unused-port>
```

Open `http://127.0.0.1:<unused-port>`. The yellow MOCK banner is injected only by the
local harness. Enter arbitrary text to log in to MOCK authentication. Set the title explicitly to `SYNTHETIC MOCK` (empty unloaded title is intentionally
invalid for publishing), leave physician slots empty, then save the
month using the existing save button. Click 發布, wait for preparation, select
晉安官網, then click 確認發布 once. Open
`http://127.0.0.1:<unused-port>/public/jinan` to inspect the simulated page and image.
The page uses the fixed `/api/publish-image` image source and 675×1200 CSS.
The original 2160×3840 PNG bytes are served, without resizing.

The harness serves the real generator and schedule client. Its auth and schedule
endpoints are local mocks; it never reads repository auth configuration. It uses
an explicit static-file allowlist and cannot serve the data directory or secrets.
External JavaScript/CSS/fonts already referenced by the generator still require
read access to their existing CDNs. This is not a fully offline browser bundle.
No mutation endpoint reaches an external host.

## Protocol and safety

- GET `/api/publish?pointer=jinan-website` reads the current baseline.
- POST `{op:"prepare",input:{baseline,data,monthKey,pngDataUrl,pngSha256,targetPointerId}}`
  validates the PNG and compares facts with the schedule API's saved data. It stages
  one immutable image and records a five-minute approval. It cannot move the pointer.
- The server creates the opaque 128-bit approval ID and nonce, and binds them to
  the authenticated session hash, stable server executor identity, exact PNG hash,
  target, and baseline version+etag. No browser-selected identity or enable flag.
- POST `{op:"confirm",input:{approvalId,nonce}}` operates only on that stored job.
  Under the shared store lock it checks expiry, owner, baseline, and staged hash,
  persists MUTATING intent, atomically replaces one pointer record, then records
  CONSUMED. A repeated confirmation reconciles; it does not create a second blob.
- POST `{op:"reconcile",input:{approvalId,nonce}}` reads only. The browser stores
  the binding in sessionStorage before confirmation. Reopening the dialog after
  an ambiguous result reconciles first. No automatic mutation retry.
- Public verification compares exact stored image bytes, the live pointer's
  approval+nonce+target+hash, and anonymously fetched target-page HTML plus fixed-route image bytes.
  Three verification reads maximum, with bounded backoff. A mismatch is
  MANUAL_CHECK_REQUIRED. The mock HTML is hash-pinned and must reference the exact image route. This does not verify a real CMS page.
- 2,500,000 decoded PNG bytes and 3,500,000 JSON request bytes maximum on the new
  path. Oversize images are refused with guidance to retain the normal download
  and contact the administrator. No 15 MB ingress promise; capture is unchanged.

## Durability and recovery

The supplied directory contains fsync'd job and immutable base64 blob records and
an atomic pointer JSON file. All instances sharing this directory share a mkdir
write lock. It is a local filesystem simulator, not a distributed filesystem.
Apps Script uses the same engine with ScriptLock, a persisted ConsumedNonces
journal, private Drive blobs, and a single PublishPointer cell.

Restarting the harness retains schedules and publish state. MOCK login sessions
are intentionally memory-only; a restarted harness requires login, and an old
approval cannot be adopted by a new session. For regression evidence of recovery
with the same authenticated identity, run the store test suite (including an
actual child-process exit after pointer persistence). Real sessions retain the
existing server-authentication behavior; no auth code was changed.

A killed local writer can leave `lock/`. Read-only reconciliation does not need
that lock, but further writes stop. After independently verifying that **all**
writers using this data directory have stopped, remove only the empty lock:

```sh
rmdir /private/tmp/inspection-repo-publish-worktree/.publish-runs/mock-store/lock
```

Do not erase jobs or rewind nonces. MUTATING with an old pointer stays ambiguous;
no code retries that mutation. Preserve the directory for investigation. An
orphan staged image can exist if preparation fails; no automatic deletion or
retention policy is implemented.

## Known limitations and safe recovery

- Repeated prepares, abandoned approvals and failed confirmations can leave orphan
  staged blobs (local blob JSON or private Drive files). Define retention and safe
  cleanup before production enablement; do not delete records needed to reconcile.
- PNG-to-saved-facts correspondence is trusted from the authenticated browser, not
  server-verified. The server checks saved facts and binds the exact PNG hash.
- `sessionStorage.publishPending` can keep a dialog in read-only reconciliation
  after a crash before pointer update. Opening a new tab/device or clearing storage
  does not resolve the previous effect and must not be used to bypass it. Inspect
  the current pointer, previous job/journal and public bytes read-only first. Do
  not prepare or confirm a fresh publish until the previous effect is resolved.
  A new session cannot adopt an old approval; unresolved cases require operator
  investigation. There is no in-UI reset/retry for ambiguous attempts.

## Historical freeze acceptance — not a Stage2 review

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
sandbox outcomes remain below; they describe historical acceptance only, not this increment.
Production approvals and all real-service unknowns/gates remain outstanding.
That historical documentation-only closeout ran no tests or servers. Current local test evidence is in the checkpoint.

## Historical execution evidence and future runs

The independent preceding-generation logs have been read and verified:
- `/private/tmp/clinic-publish-finish-independent-node.txt`: 237 PASS, 0 FAIL, 0 SKIP.
- `/private/tmp/clinic-publish-finish-independent-python.txt`: 8 PASS.
- `/private/tmp/clinic-publish-finish-independent-browser.txt`: actual Chromium
  desktop and mobile BOTH PASS. Explicit SYNTHETIC MOCK saved titles, actual
  anonymous PNG bytes/hash/dimensions, one confirmation, duplicate no-op and
  dropped-response read-only reconciliation are covered.

These supersede earlier sandbox EPERM/MachPort failures as local acceptance
evidence. They do not establish Google/CMS acceptance. Claude's exact verdict in
`/private/tmp/clinic-publish-finish-review.json` is **PASS (nonproduction review)**;
it was a read-only review without test execution, before the final corrections.
The final post-correction execution and review above supersede that earlier
acceptance status.

Coordinator server port **4174**, pid **30781**, remains owner-managed: do not stop,
restart, replace or reset it. The initial Run commands above are for a future new
harness only; do not execute the server command while the coordinator owns 4174.
For future independent runs use an owner-approved server or an unused port and
fresh directory, with an already installed Playwright runtime:

```sh
node tests/e2e/publish_local.mjs --port <approved-port> --playwright-module /Users/iaiangela/.hermes/hermes-agent/node_modules/playwright/index.mjs
```

No package installation is needed. The script checks desktop/mobile in separate
authenticated contexts and each public image in a fresh anonymous context. Faults
are injected in local test code, not production endpoints. Final correction tests
and file identity are recorded in PUBLISH_IMPLEMENTATION_CHECKPOINT.md.

Prepare can stage blobs and write a journal before its response is lost. It is
not automatically retryable. Received pre-mutation INVALID_PNG during confirm now
clears pending UI state; dropped responses and ambiguous mutation retain it.
No stale fixed-image cache was added; exact anonymous verification remains intact.
See JINAN_ONE_TIME_REPOINT_RUNBOOK.md for bootstrap and measured external gates.

## Stage2 static target guard contract

`lib/publish-target.js` is a stateful token/attribute scanner with an explicit
stack, not a regex-only parser and not browser-equivalent HTML5 parsing. No new
dependency. Production uses `PUBLISH_PUBLIC_TARGET_SHA256`; the old environment
name does not enable the flow. Changing the new pin changes executor identity.
The frozen mock harness alone keeps its stricter whole-page `pageSha256` argument
on same-origin HTTP 127.0.0.1. There is no production config fallback.

The canonical record is JSON `[doctypeMarker, target, nearestFourAncestors]`, each node represented
as `[lowercaseTag, sortedAttributePairs]`. Target attrs are restricted to src, id,
class, style, alt, title, width, height, loading, decoding and fetchpriority.
Ancestors of the target accept only id/class/style/lang/dir/title/role and
aria-label/aria-labelledby/aria-hidden; these semantic attrs are also fingerprinted. Attribute names/order/quotes
normalize; class token whitespace collapses; src becomes an absolute URL. Supported
terminated character references decode before comparison (amp/quot/apos/lt/gt and
valid numeric scalar references). Other value whitespace is preserved, especially
CSS strings, where collapsing could change meaning. Unknown entities fail closed.
Target style rejects URL/image/content substitutions, escapes and CSS comments.

Require exactly one target. Duplicate attributes, ambiguous syntax, unknown tags,
unclosed/misnested stacks, known implied-end/foster-parenting cases, implicit tbody,
raw quoted angle brackets, malformed comments, unsupported raw-text modes and
script escaped states fail closed. Normal comments and script/style/textarea/title
contents do not produce image targets. Real base and noscript tags fail globally (noscript tokenization depends on scripting); an inert
base string inside raw text/comment is not an element. Target candidates in picture,
template, SVG/MathML, noscript, select, object, iframe or head are rejected.
Unrelated balanced picture/source/template/simple SVG content is allowed where
unambiguous. Alternate-source lists must be simple URL plus optional numeric w/x
descriptors, and must not alias the target. Dangerous attributes on the target,
including event handlers, srcset, lazy data sources and usemap, are rejected.

Limits: 1 MB HTML, stack depth 128, canonical record 16 KiB, four pinned ancestors.
This is a deliberately small static subset, not proof against every browser tree
repair. It does not execute scripts or compute CSS: class rules, external styles,
media rules, DOM mutation, CSS-generated images and ancestors beyond the four-node
pin can affect rendering without changing the fingerprint. Human review of real
HTML/staticness, browser rendering and the exact proposed fingerprint is mandatory
before Stage3. Unsupported real markup needs separate review, never a bypass.
Full-page UTF-8 decoding rejects replacement characters. Fetch redirect, MIME,
size limits and anonymous exact PNG-byte checks are unchanged. The existing HTTP
reader was inspected and left byte-identical; no need to modify it was found.

## Stage2 test-only degraded conditions

Only direct LocalStore construction in tests supplies faults. The protected HTTP
harness supplies none; no route/request/env knobs were added. `latencyMs` delays
operations; `transientOnce` throws STORE_UNAVAILABLE before the first prepare or
confirm engine call; `timeout: true` fails every operation with AbortError, or an
operation name scopes it (e.g. confirm). Blob reads also support latency/timeout.
Existing dropResponse/beforePointer/afterPointer/cache behavior remains available.
These simulations do not establish Google service semantics or timing.

Tests check unchanged pointer on transient failure, read-only reconciliation,
explicit duplicate confirms with one blob/version, stale bytes never PUBLISHED,
and actual AbortSignal timeout delivery using a VM-only 5 ms clock substituted
for the production transport's unchanged 25,000 ms deadline. Existing UI tests
prove ambiguous status/lost responses retain publishPending. No production clock,
HTTP helper or request behavior was changed. No fault is a retry authorization.

Historical Stage2 author browser attempt: fresh `/private/tmp/clinic-stage2-browser-store-20260908`,
port 4187. Server failed EPERM; installed Chromium failed MachPort permission.
No browser PASS claimed. See `/private/tmp/clinic-stage2-browser*.txt` and the
current checkpoint for Node/Python evidence. Port 4174 was never contacted.

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

Parent-only host browser handoff (not executed by this writer): existing evidence
records port 4187 and the installed runtime below. For a fresh host harness use
this new data path; its creation happens only when the parent runs the command.
Port availability has not been probed. Keep owner-managed port 4174 untouched.

```sh
node tools/mock-publish-store-server.js /private/tmp/clinic-ledger-host-store-20260908 4187
node tests/e2e/publish_local.mjs --port 4187 --playwright-module /Users/iaiangela/.hermes/hermes-agent/node_modules/playwright/index.mjs
```

Recorded Chromium runtime from `/private/tmp/clinic-stage2-browser.txt`:
`/Users/iaiangela/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell`.
Historical listener EPERM/MachPort is not an approval blocker for the parent's
already-authorized host execution. Codex must not bypass the sandbox or attempt
browser/server execution. Current browser/HTTP results remain pending parent evidence.
Successful writer Node command excludes the listener test by exact name:
`node --test --test-skip-pattern='^localhost HTTP auth, save, prepare, confirm, public image, limits$' tests/*.test.cjs`.
