# Isolated storage-write validation

This revision executes and verifies the local synthetic workflow now. NONPRODUCTION describes this task's execution scope; it is not a permanent prohibition on separately approved production configuration or deployment. No real request, credential access, configuration change, Google write, deployment or clinical PNG read occurred. Defaults remain OFF. This endpoint is STORAGE WRITE PROOF ONLY. `PREPARED` means one private staged blob and a durable journal record, never readiness for confirm, publication, or acceptance of live deployment identity.

## Authorization and server-side issuance

`POST /api/prepare-validation` is separate from normal publishing and IMAGE/FLOW. All operations require the existing authenticated application session and exact configured HTTPS Origin and Host. Shared login establishes neither a person nor an owner email. No email assertion from the caller is accepted or inferred.

1. `{"op":"session"}` creates a separate random 256-bit operator session in the `__Secure-clinic_validation_operator` cookie (HttpOnly, Secure, SameSite=Strict, path `/api/prepare-validation`, maximum browser age eight hours). It returns only `ok`, `status: OPERATOR_SESSION`, and the SHA-256 of that token as `sessionSha256`. This is an unprivileged enrollment receipt. It neither signs a capability nor accesses authority material nor writes to Google. Repeated enrollment with the same valid cookie returns the same receipt without renewing the cookie. Do not reenroll after an ambiguous prepare.
2. An independently authenticated owner approves exactly this digest and ONE preallocated lowercase UUID v4 operationId, using platform-controlled metadata described below. Keep the same operator cookie and operationId through recovery. Shared login cannot edit this metadata; an enrollment receipt alone grants no authorization.
3. `{"op":"authorize","operationId":"<approved UUID>"}` checks the metadata and performs server-only scoped issuance. It returns `AUTHORIZED`, the operationId and `authorizationExpiresAt`, never the capability or a master secret. This is a local server authorization check, not a GAS write or a live target preflight.
4. Prepare/status/reconcile repeat the same binding checks and mint a short-lived internal HMAC capability immediately before transport. Browser-supplied `x-validation-capability` is rejected. There is no unrestricted login-to-capability exchange or long-lived issuer service.

Required server metadata (all initially absent/off):

| Configuration | Meaning |
| --- | --- |
| `PREPARE_VALIDATION_ENABLED=true` | Route gate |
| `VERCEL_ENV=preview` or `development` | Allowed nonproduction environment |
| `VERCEL_ENV=production` AND `PREPARE_VALIDATION_PRODUCTION_ENABLED=true` | Additional explicit production opt-in; not activated here |
| `PREPARE_VALIDATION_ORIGIN` | One exact HTTPS origin without path, trailing slash, credentials or alias; Host must also match |
| `PREPARE_VALIDATION_ISSUANCE_ENABLED=true` | Separate owner-approval/issuance gate |
| `PREPARE_VALIDATION_APPROVED_SESSION_SHA256` | Exact lowercase SHA-256 of the separate operator token |
| `PREPARE_VALIDATION_APPROVED_OPERATION_ID` | One retained lowercase UUID v4, never an operation list or wildcard |
| `PREPARE_VALIDATION_APPROVED_AT` / `PREPARE_VALIDATION_APPROVED_UNTIL` | Fixed 13-digit epoch millisecond bounds; start inclusive, end exclusive; maximum eight-hour interval |

Apps Script independently requires the validation and issuance gates plus the same approved digest, operation and time bounds in Script Properties. It verifies those values before lock/storage access and revalidates the signed scope immediately before each journal write and Drive creation. Missing, malformed, mismatching, not-yet-valid, revoked or expired approval fails closed. It does not learn approved scope from a request.

The existing server authentication secret stays on the server except for the existing authenticated server-to-GAS transport. A separate server-only `PREPARE_VALIDATION_AUTHORITY_SECRET`, at least 32 characters of independently generated high-entropy material, is provisioned at both boundaries. Matching master keys are rejected. Neither master key is available to browsers, JSON responses, evidence or logs. This task did not read or retrieve either real key. The operator cookie is an intentionally issued bearer session, distinct from both master keys; do not copy it into logs or approval metadata.

Internal capability: unpadded base64url(JSON) plus base64url(HMAC-SHA256(authority, encoded payload)). Exact fields are `purpose=clinic-prepare-validation-v1`, `executorId=vercel-isolated-prepare-validation-v1`, approved `operationId`, operator token SHA-256 in `session`, `deploymentEndpoint` equal to the literal approved HTTPS `/exec` URL below, and integer millisecond `iat`/`exp`. Lifetime is at most five minutes, clipped to the fixed approval end. Apps Script independently checks HMAC, exact fields, executor, purpose, literal deployment endpoint, operation, digest and configured interval. No caller field can change the executor or target.

Threat model: an ordinary shared-login holder can enroll but cannot obtain authorization for an unapproved cookie or operation. A stolen enrollment digest is not the cookie preimage. A stolen operator cookie together with valid shared login can exercise the approved scope during its configured lifetime; HttpOnly is not protection against all same-origin compromise. The GAS boundary does not authenticate a human itself: it trusts the existing transport secret, a separate HMAC authority, and independently installed owner metadata. Compromise of the server, both master secrets, the GAS project, or configuration administrators is outside this protection. HMAC and metadata checks are independent write-side enforcement, not an independent identity provider or a claim to withstand full server compromise.

## Fixed targets and server-selected endpoint trust

| Target | Exact ID/value |
| --- | --- |
| Script project | `1n8b6OLv_LyOONJeLGCbCDUnudpUGgM7PsbSUVvpUqm8l1j_m4rTJNETB` |
| Deployment | `AKfycbz5OXGNDZJWEj2-W1g-1r_SISPjYYcI-7gsUsivt3Rx7-zY6AzpQqqZTIFROVKMU1eh3w` |
| Isolated ledger | `1mphbqFGjstnF_SOrBVG242d4MH2aN274QGtGyjdN9Gg` |
| Private folder | `1mbllfD0z51GgTDsVaKypendQVy_6lG9r` |
| Formal schedule workbook (read only) | `1wugjTcB9R2x_KlnJESZF6h0z1KNT3NcE5zkFDLrqSzg` |
| Approved PNG | 2160 × 3840; 781588 bytes |
| PNG SHA-256 | `f78a1ed1cb91a89cea9962efd5de76ae0d07702c801ce391664640cec402725d` |

These pins remain unchanged in server and GAS code. Requests/config cannot override them. Apps Script checks actual `PUBLISH_SPREADSHEET_ID`, `PUBLISH_FOLDER_ID`, `PREPARE_VALIDATION_DEPLOYMENT_ID`, `ScriptApp.getScriptId()`, opened ledger identity and resolved folder identity. It only reads the formal workbook and never invokes bootstrap-capable schedule load/initialize helpers. PNG validation retains the full Node parser and exact pinned digest/size; GAS verifies bytes, dimensions and digest before staging and rereads staged bytes.

The approved Vercel server code sends its credential POST only to the literal `https://script.google.com/macros/s/AKfycbz5OXGNDZJWEj2-W1g-1r_SISPjYYcI-7gsUsivt3Rx7-zY6AzpQqqZTIFROVKMU1eh3w/exec`. Neither browser input nor environment/config URL can override that destination. The independent authority HMAC signs this exact endpoint along with the approved scope; both server and Apps Script compare it to their fixed pin. Missing, alias, `/dev` or other endpoint claims fail authentication. Existing project/deployment/storage/PNG pins are unchanged.

This is an end-to-end server trust boundary, not runtime invoking-deployment attestation. It assumes the reviewed Vercel code is actually deployed, controls the fixed request destination, keeps both secrets private, and uses normal HTTPS verification to reach Google's approved deployment mapping. Apps Script Script Properties and secrets are project-wide and may be accessible to other deployments of that project. The signed endpoint proves authorized server intent, not which deployment received a copied request. A project administrator, compromised server, or another deployment with access to both secrets can undermine this boundary. Deployment/version access and project secret custody therefore require separate live review. The endpoint does not claim cryptographic isolation between deployments of one Apps Script project.

`ScriptApp.getScriptId()` must return the exact project. Actual Script Properties must match the pinned ledger, folder and deployment ID; actual opened ledger, formal workbook and resolved folder IDs must match their isolated pins before any write. Missing or throwing required services fail closed. `ScriptApp.getService().getUrl()` is deliberately unused: it is never authoritative evidence of the invoking deployment, whether canonical, alias, `/dev`, missing or unavailable. There is no invocation-attestor parameter or HTTP/environment bypass.

The prepare-only transport uses manual redirects. It permits one 302/303 response redirect to HTTPS `script.googleusercontent.com/macros/echo`, without userinfo, nondefault port or fragment. It follows using GET with no request body, credential headers or cookies, and no referrer. It rejects 301/307/308, foreign hosts, other paths, relative locations, and further redirects; never replays the credential POST. The response shares the 25-second deadline and 3,500,000-byte bound. Transport ambiguity returns manual-check, with no automatic retry. This narrow transport does not change normal publishing transport behavior.

The R4 regression executes the real exported Vercel handler, session authentication, enrollment/approval issuance, fixed transport and real Apps Script `doPost` / `prepareValidationRequest_`. Only Google services and synthetic PNG verification are mocked. The pre-fix run returned `TARGET_IDENTITY_UNKNOWN`; the corrected wrappers complete private storage preparation. No invocation attestor is supplied. This local proof does not establish live deployment identity, permissions or persistence.

## Strict request and result contract

In addition to session and authorize, only these operations are supported:

- Prepare: `{"op":"prepare","operationId":"<approved UUID>","input":{"baseline":{"pointerVersion":0,"pointerEtag":"<existing etag>"},"monthKey":"YYYY-MM","data":{"title":"<saved title>","note":"<saved note>","clinics":[]},"targetPointerId":"jinan-website/current","pngDataUrl":"<approved PNG>","pngSha256":"<approved SHA256>"}}`. Placeholders are not clinic facts. Clinics must be nonempty and equal formally stored data. Baseline optionally includes the existing lowercase SHA-256 `pngSha256`; use the actual existing ledger baseline.
- Status: `{"op":"status","operationId":"<same UUID>"}`.
- Reconcile: `{"op":"reconcile","operationId":"<same UUID>"}`; identical read-only lookup semantics.

Top-level/input/data/baseline keys are exact; baseline version must be a safe nonnegative integer below MAX_SAFE_INTEGER, etag 1–128 alphanumeric/underscore/hyphen characters, title 1–100 characters without controls, note at most 10000 characters. Facts are compared canonically to existing saved facts; no AI inference occurs. Raw JSON rejects duplicate keys at every nesting depth, including escaped aliases. JSON Content-Type may have only the UTF-8 charset parameter. Missing/malformed Origin/Host or browser capability headers fail. Body limit is 3500000 bytes; supplied Content-Length must be a canonical bounded decimal and must match the validated JSON text bytes. Platform-parsed bodies cannot reveal discarded duplicate keys or original whitespace/byte length; for those, the handler enforces normalized object shape/size and compares Content-Length to its JSON serialization (noncanonical original formatting can therefore be rejected), while GAS always reparses raw transport text strictly. This is a remaining hosting-adapter limitation to verify before live acceptance.

Status results allowlist `NOT_FOUND`, `PREPARED`, `EXPIRED_APPROVAL`, `MANUAL_CHECK_REQUIRED`; known rejections include stale baseline, missing saved facts, invalid input/PNG/scope, and upstream failures. Prepared/expired results return only `ok`, `status`, `operationId`, `approvalId`, `nonce`, `expiresAt`, `pngSha256`, with strict type/length checks. No blob ID, journal, cookie, capability, executor or master key is returned in JSON. All responses use no-store. Failed/unknown upstream responses become manual-check, with no transport retry.

There is NO confirm, pointer read/mutation, public pointer seeding, bootstrap, blob download, publish or cleanup operation. An existing `PublishPointer` is a prerequisite. Do not seed public state to satisfy this proof. `validation:` approvals and validation purpose are rejected by the normal transaction engine. Neither save nor this proof publishes anything.

## Durability and recovery lifetime

The existing ScriptLock covers journal lookup/CAS, intent write/flush/exact readback, staging, verification and final persistence. A stable operationId keys one row in `PrepareValidationJournal`. The digest binds initial baseline, month, saved facts, target and PNG hash. Changed retries cannot replace it. Canonical fact comparison and request hashing recursively use null-prototype objects so every own JSON key, including nested `__proto__`, remains serialized data without changing prototypes. A flushed and reread INTENT must exist before Drive creation. Any existing INTENT is permanently non-retryable by this API, including orphan creation followed by an exception, verification failure, quota/timeout, or final journal failure. Use read-only status; do not mint another operationId to bypass ambiguity.

A persisted PREPARED record recovers the same approval after response loss. The approval expires five minutes from original intent construction. New internal transport capabilities, authorize, status and reconcile NEVER renew that timestamp. Read-only recovery after capability/approval expiry remains possible for the SAME operator cookie and operation while BOTH boundaries' fixed approval intervals and gates remain valid, and the app session authenticates. Reauthentication to the shared app does not rebind the independent operator session. Replacement/loss of the operator cookie cannot take over the journal. At metadata expiry/revocation, recovery is denied: preserve evidence and use a separately approved manual procedure. Do not extend metadata or switch operation/session automatically to work around expiry.

NOT_FOUND describes only the journal, not absence of an orphan. Intact durable storage is an assumption; deletion/corruption breaks at-most-one guarantees. Partial/duplicate/unreadable journal data returns manual-check without repair. A definite pre-intent failure that wrote nothing may be attempted again by explicit human decision for the same operation; no automatic retry exists. Status does not search Drive or reverify an existing file.

## Future owner-only activation procedure (not executed)

A separately authorized owner must first review this artifact and resolve live blockers: approved Vercel code/fixed destination, exact Google deployment mapping and project-wide secret custody, project and folder ACLs/scopes, existing ledger/pointer/journal integrity, saved formal facts, approved PNG availability, hosting raw-body behavior, and actual persistence/permission/quota behavior. Offline fakes do not settle these questions. No live activation is authorized by this offline proof.

Using existing platform administration and secret mechanisms, independently authenticate the owner outside shared clinic login. Preserve existing master secrets; do not export them, show them to Codex, or put them in a browser. A distinct authority key, if not already provisioned, requires separate approved provisioning directly into server/GAS secret settings. No extra service is needed.

After separate deployment/configuration approval, select the exact origin/environment, enable the route for unprivileged enrollment, have the intended operator enroll through the authenticated same-origin session operation, and verify the displayed digest with that operator through the owner's trusted channel. Allocate and retain ONE UUID before dispatch. Install only that digest/UUID and a fixed bounded time interval on BOTH server and GAS; then explicitly enable both issuance and validation gates. Production additionally requires the server production gate. Owner email text is never a substitute for this administrative approval. Do not paste cookies, tokens, signed capabilities or keys into evidence.

Existing ledger setup is a separate schema-only approval: add at most one `PrepareValidationJournal` sheet with A1 `operation_id`, B1 `validation_json` if absent. Inspect/preserve any existing sheet. Never reinitialize the ledger, `PublishPointer`, `ConsumedNonces`, formal workbook or folder, and never seed a public pointer for this endpoint. No setup helper is shipped or run.

Run authorize, then the single reviewed prepare only after all blockers are resolved under separate approval. On response loss use status/reconcile with retained operation/session, not a new operation or upload. Record nonsecret outcomes. Disable issuance/validation explicitly when finished; this also stops read recovery. Plan the recovery window before disabling. Removal/cleanup and any future confirm are separate tasks requiring review and human approval; there is no confirm implementation here.

## Offline evidence and scope

Revision runners are copies of the inspected credential-free offline runner with new log paths, retaining the external-network guard. Tests execute actual handler issuance, actual session authentication under a fake server environment, actual transport with fake fetch, GAS dispatch/VM, and fault-state transitions. They cover wrong scopes, malformed lengths/keys, exact origin, production opt-in, signed endpoint mismatches, actual runtime identity mismatches, safe response redirects, revocation, durable intent, staging faults, dropped response, immutable expiry, no orphan retry and read-only recovery. No installation, external network, live browser, actual secrets, remote writes, deployment, commit, staging, push or merge occurred. Protected Preview → high-resolution PNG/printing and IMAGE/FLOW code are unchanged.

See `docs/prepare-validation-r4.md` and `.validation-evidence/r4/` for R4 logs, patches and the complete source manifest. Original evidence remains unchanged. No independent review is claimed; a fresh read-only Codex review follows.
