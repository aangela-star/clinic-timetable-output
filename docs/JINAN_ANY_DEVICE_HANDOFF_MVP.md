# Any-device Jinan handoff MVP — implementation and activation boundary

## Phase 0 evidence (2026-09-06)

- GitHub main: `444b52777c7861e1c6e32346b361583edba383ca`. Production homepage bytes matched `origin/main:index.html` during this audit. This verifies that artifact, not every server deployment setting.
- Existing bound Apps Script project: `1n8b6OLv_LyOONJeLGCbCDUnudpUGgM7PsbSUVvpUqm8l1j_m4rTJNETB`; existing Web App ID: `AKfycbz5OXGNDZJWEj2-W1g-1r_SISPjYYcI-7gsUsivt3Rx7-zY6AzpQqqZTIFROVKMU1eh3w`; existing Spreadsheet: `1wugjTcB9R2x_KlnJESZF6h0z1KNT3NcE5zkFDLrqSzg`. Prior Version 4 Save/Load diagnosis and successful Production load remain the baseline. This Mission did not edit the live project or Sheet.
- Apps Script source routes authenticated Save/Load synchronously. A separate namespaced handoff handler can be added before month validation; its one-line dispatch hook does not alter Save/Load logic. `PublishJobs.gs` never calls SpreadsheetApp.
- Chrome, Codex CLI 0.153.4, Node, Python and launchctl are present. No Google Drive Desktop was found in `/Applications` or `~/Applications`, and `~/Library/CloudStorage` does not exist. No installed agent-browser executable was found. Do not describe an uninstalled sync service as available.
- Exact Drive search for `Clinic Timetable Publish Queue` returned no result. It is not proof that the account has no other suitable folders. No folders were created.
- Noninteractive Codex CLI can start the configured CUA tool, but its native Chrome probe returned **Computer Use was not approved to use Google Chrome**. Desktop-thread permission does not automatically authorize an independent CLI execution. No bypass, browser profile/cookie extraction or alternate native-control technology was used.
- The current machine's software was audited; it has not been independently established that this account/session is the permanently assigned Mac mini or that its logged-in GUI will remain available.

## Selected architecture

A: browser → same-origin authenticated Vercel API → existing Apps Script → private Google Drive folder; designated Mac polls the same Apps Script with a separate runner secret. No local inbound port, remote bridge, Database, Drive Desktop install, or queue SaaS.

B (browser directly calling Apps Script) was rejected because it would move the shared secret to the client or require Google user authorization. Direct Drive browser OAuth also conflicts with the no-popup requirement. Drive Desktop folder moves are not treated as distributed atomic claims; this host lacks that runtime anyway.

Google's existing DriveApp supports folder/file storage ([official reference](https://developers.google.com/apps-script/reference/drive/drive-app)). Apps Script serializes state transitions with ScriptLock. Adding DriveApp will require appropriate Drive OAuth authorization for the existing account; this has not been granted or silently applied. A private folder restriction in code does not narrow the OAuth scope itself.

## Request and storage contracts

- `GET /api/publish-jobs`: existing session required; gate must be enabled. Anonymous server GET captures a unique 675×1200 target image and baseline. This avoids shipping a perpetually stale hard-coded baseline after each successful publish.
- `POST /api/publish-jobs`: existing session required; exact job schema plus full source PNG validation/hash. Maximum 3.5 MB JSON, PNG data URL at most 3.2 MB, below the Vercel [4.5 MB body limit](https://vercel.com/docs/functions/limitations). Oversized jobs stop without upload; PNG dimensions are not reduced to fit.
- Only server forwards `publishJob.enqueue` using the existing server secret. No CMS credentials/cookies in jobs. Mac receives a separate `PUBLISH_RUNNER_SECRET` that cannot enqueue or access Save/Load.
- After a confirm click the UI captures Preview, submits a snapshot and reports handoff receipt, not publication. Ambiguous delivery preserves the same pending job in the current UI session and blocks repeat creation; a page reload clears this local UI guard. Cloud duplicate jobId protection remains authoritative. There is no unattended CMS activation or UI status polling in this revision.
- Drive folder proposal: **Clinic Timetable Publish Queue** in the existing account, private (no public/link/domain sharing). Each jobId folder contains immutable `job.json`, mutable `state.json`, and terminal `result.json`.
- No folder ID is guessed. `PUBLISH_HANDOFF_FOLDER_ID` must refer to the explicitly approved folder. A partially created folder/file fails closed; do not delete/recreate it to retry automatically.
- Same jobId + same JSON: existing receipt returned. Same ID + changed content: reject. A server-wide ScriptLock serializes enqueue/claim/finish. No scheduled Apps Script trigger or Sheet tab is added.
- `ready → claimed → published | manual-check`. FAILED result is retained under manual-check for inspection. Claim is persisted before bytes return. Only the originating claimId may finish. Result retry with identical content is safe; conflicting terminal result is rejected.
- No lease expiry, automatic reclaim or automatic CMS retry. A claimed job blocks another claim until reconciled. Max 500 job folders triggers operator review; do not archive/delete idempotency history to bypass that limit.

## Mac pickup and execution

`runner/worker.cjs` is a one-shot entry point; `runner/launchd.example.plist` is an **uninstalled, disabled template**. Default execution returns NOT_ACTIVATED before touching Google or CMS. No launchd job was loaded.

Before cloud claim, a local exclusive pickup receipt is persisted. A crash/timeout leaves it behind and stops future pickup. After claim, job bytes, original PNG, baseline HTML/image and state are saved locally with restrictive permissions and fsync. A per-job directory cannot be recreated: restart, replay and duplicate sync events cannot execute that job a second time.

Ordinary deterministic code handles schema/hash, PNG reconstruction, anonymous baseline GET, drift comparison, durable local state, public readback/full HTML comparison, and result JSON. The browser driver alone handles session, upload, image properties, draft validation and the final click. See `runner/BROWSER_DRIVER_CONTRACT.md`.

This revision intentionally has **no working Production browser driver**. Its interface is exercised by a fake driver; `browser-driver.cjs` is explicitly unavailable. A successful mock flow is not evidence of an unattended live CUA session. Chrome authorization must be resolved before implementing/binding and approving the actual driver. Do not flip the placeholder's available flag to claim jobs.

When a driver is available, the runner's sequence is: baseline → session → upload once → derived validation → image src apply → fresh drift check → persist SUBMIT_DISPATCHING → submit once → public HTML/image compare → result. Missing session returns SESSION_EXPIRED / MANUAL_CHECK_REQUIRED; no password guessing. Uncertain derivative review fails closed. A submit timeout stays SUBMIT_AMBIGUOUS with no retry even if the CMS may have accepted it.

Derived validation includes PNG structure/CRC/decompression checks, 675×1200 dimensions, and the browser driver's whole-image readability/completeness comparison against the approved source. RGB/RGBA noninterlaced 8-bit derivatives are accepted; other formats stop for review. Exact equality to the original 2160×3840 bytes is not required. Final public bytes must equal the pre-submit derivative.

Result fields: jobId, finishedAt, status, safe code or publicImagePath/dimensions/bytes/sha256/pageUnchanged. Raw exceptions, cookies and credentials are excluded. A result-write timeout does not rerun the CMS: retain local result and claim receipt for manual reconciliation. There is no automatic cleanup or destructive rollback.

## Local verification

- Full Node suite and Python suite must pass before review/commit.
- `node runner/dry-run.cjs <job.json>` only validates and anonymously reads public baseline; it never claims a Google job or opens CMS.
- The actual previously executed job `6426208f-c8ef-4407-9f8b-92bf7d8cc7ac` now correctly returns BASELINE_DRIFT: its baseline path is the old `/upload/115-九月_醫師門診表 (1).png`.
- A synthetic local-only copy using the same approved source PNG and freshly captured current baseline returned DRY_RUN_PASS / NO_CMS_OPERATIONS. The original job file was not changed.
- Current public image: `/upload/source.png`, 675×1200, 294076 bytes, SHA-256 `503cbde3c21bd37f0562154df3fa4029d08e65ce0c1f90b59d7af4980d17dc65`; successful prior publish verified at 2026-09-06T15:22:48.642Z. It is the newest baseline; earlier runbook entries remain historical Pilot evidence.
- Claim/replay/persistence/API/runner tests use mocked Drive/CMS transports. They do not certify Drive authorization, live multi-request durability under Google failures, locked-screen operation or unattended UI reliability.

## Approval-ready setup and activation plan (not executed)

1. First resolve the noninteractive Chrome permission with Angela, then rerun a read-only CLI probe. It must access only the intended Chrome session. Do not request broad sandbox bypass.
2. Obtain approval to create one private **Clinic Timetable Publish Queue** folder in the existing Google account and grant required Drive authorization to the existing Apps Script project. Confirm owner and retrieve its actual ID. No patient-facing content or Sheet data is part of this setup.
3. Separately approve update of the same existing Apps Script deployment with the namespaced handler. Configure folder ID and runner-only secret; keep `PUBLISH_HANDOFF_ENABLED` absent/not true until staged handoff verification is authorized. Never replace CLINIC_SERVER_SECRET.
4. Separately review/merge and deploy the Vercel API/UI, preserving Save/Load and PNG contracts. Production gate remains OFF. Turning it on changes the confirm path from local download to Google handoff and requires explicit approval.
5. Verify real private-folder enqueue/claim/result with a no-CMS test job. Record any failure as terminal; do not publish to prove handoff works.
6. Only after actual browser driver review, a controlled single-job approval and result checks may unattended CMS write and the launchd schedule be enabled. Normal user confirmation grants that job's fact set; it is not blanket authority for arbitrary future jobs.

No new folder, OAuth grant, live Apps Script edit/deployment, Vercel deployment, launcher installation, cloud queue write, CMS login/upload/submit or new service occurred during this Mission. The next gate is a local Chrome permission decision, not permission to publish.
