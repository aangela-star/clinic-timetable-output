# R4: reachable prepare-only private storage proof

This is an offline correction on `task/prepare-validation-local-20260909`, baseline `378c9a7556d2d6420f0a96879673a6e562210733`. It is ready for a separate read-only review, not production activation. Nothing was committed, deployed, or written remotely; no real credentials or environment/auth settings were read or changed.

The real exported Vercel handler now reaches real Apps Script `doPost` and `prepareValidationRequest_` without an invocation attestor. Vercel selects the literal approved `/exec` URL, signs that endpoint into the independent authority capability, and sends the existing master transport secret only in the first POST. GAS verifies scope/owner metadata and the signed endpoint, then actual project, Script Properties, opened ledger/formal workbook and folder identities before private writes. Existing pins, auth gates, approval window, journal recovery and R3 null-prototype canonicalization remain intact.

The trust assumption is approved Vercel code controlling a fixed HTTPS destination and custody of both secrets. A signed destination is server intent, not Apps Script invoking-deployment introspection. Script Properties/secrets are shared across project deployments; a compromised deployment with both secrets can violate this assumption. `ScriptApp.getService().getUrl()` is not authoritative and is unused. See [the full contract](prepare-validation.md).

The separate prepare transport allows at most one Google ContentService response redirect (302/303) to HTTPS `script.googleusercontent.com/macros/echo`, followed by a credential-free GET. It never replays a credential POST on redirects. Unsupported redirects and ambiguous responses require manual recovery with the same operation/session.

## Evidence

All new evidence is in ignored `.validation-evidence/r4/`; prior R3 files are preserved byte-for-byte.

- `red-dead-end-0.log`: the new real-wrapper regression failed with `TARGET_IDENTITY_UNKNOWN` before implementation changes (exit 1).
- `green-0.log`: the same regression reached PREPARED with one private file and two journal writes after the correction (exit 0).
- `full-acceptance-0.log`: 416 Node tests, 415 passed, zero failed, one existing localhost listener EPERM skip (exit 0).
- `full-acceptance-1.log`: all eight Python tests passed (exit 0).
- `audit.log`: branch/base, full source syntax, whitespace, protected-file equality, preserved evidence, and patch checks. There is no package.json/build toolchain; no hosted build is claimed.
- `review.patch`: full baseline-relative patch, including all untracked implementation/tests/docs. `fix-only.patch` isolates R4 from the supplied 11-file worktree.
- `source-files.manifest`: exact SHA-256 of every changed/new source file, including docs and tests. `evidence.manifest` separately seals the R4 evidence and snapshots; its checksum is `evidence.manifest.sha256`.
- `handoff.md`: complete file scope, executed commands/exits and remaining unknowns. Earlier failed harness runs remain recorded; they are not acceptance passes.

The fixture runs the real handler's default auth/issuance/transport and both real GAS wrappers with normal Google services mocked. Only PNG verification defaults use synthetic test pins. No production source contains a synthetic attestor or environment bypass. Negative cases verify zero writes for wrong scope/endpoint, target properties/project/opened resources, unknown required services, forged auth and fake attestation input. Safe/unsafe redirect, response-loss and bounded-response tests execute the actual prepare transport. Existing security, durability, recovery and `__proto__` suites also pass.

## Remaining live-only unknowns

Actual deployed Vercel/GAS source versions and Google deployment mapping, shared-project secret custody, Google response redirect behavior, scopes/folder ACLs, existing journal/pointer integrity, formally saved facts, approved real PNG, hosting raw-body handling, and real persistence/quota/timeout behavior remain unverified. The sandbox prevented the existing localhost HTTP acceptance test; wrapper tests are local simulations, not HTTP or live acceptance.

PREPARED means **PRIVATE STORAGE WRITE PROOF ONLY**. No confirm, public pointer seed/mutation, IMAGE/FLOW/CMS, publication or cleanup was added. The fixture supplies an existing synthetic pointer; this endpoint does not create one. A separately reviewed seeded pointer/confirm flow is still required later. Fresh independent read-only Codex review follows this writer's completion; no independent-review pass is claimed here.
