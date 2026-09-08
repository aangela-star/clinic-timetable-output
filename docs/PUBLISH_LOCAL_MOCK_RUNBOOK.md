# LOCAL MOCK publishing — no production success claimed

Repository: `aangela-star/clinic-timetable-output`. Worktree:
`/private/tmp/inspection-repo-publish-worktree`, branch `feature/official-publish-flow`.
No production service, credentials, environment flags, CMS, or deployment are needed.

## Run

```sh
cd /private/tmp/inspection-repo-publish-worktree
node --test tests/*.test.cjs
python3 -m unittest discover -s tests
node tools/mock-publish-store-server.js /private/tmp/clinic-publish-finish-independent-store 4174
```

Open `http://127.0.0.1:4174`. The yellow MOCK banner is injected only by the
local harness. Enter arbitrary text to log in to MOCK authentication. Set the title explicitly to `SYNTHETIC MOCK` (empty unloaded title is intentionally
invalid for publishing), leave physician slots empty, then save the
month using the existing save button. Click 發布, wait for preparation, select
晉安官網, then click 確認發布 once. Open
`http://127.0.0.1:4174/public/jinan` to inspect the simulated page and image.
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

## FINAL nonproduction acceptance — verified and reviewed

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
sandbox outcomes remain below; they are not the current acceptance result.
Production approvals and all real-service unknowns/gates remain outstanding.
No tests or servers were run during this documentation-only evidence closeout.

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
