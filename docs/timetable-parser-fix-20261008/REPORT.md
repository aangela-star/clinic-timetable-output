# Minimal real-HTML parser fix — 2026-10-08

Ready for independent Claude code/evidence review, not production or publication approval. No independent final review has been performed in this task.

Worktree: `/Users/iaiangela/Projects/clinic-timetable-parser-fix-20261008`.
Branch: `fix/timetable-realhtml-parser-20261008`.
HEAD and intended base remain `08d41edbab4c2fbe940018959d33fc288c425a7e`. No commit, push, merge, deployment, production configuration change, or external write.

## Implementation and scope

Only source modified: `lib/publish-target.js` (6 lines added, 3 removed).

- Comments permit inert `<!` content; the retained `--` rejection also rejects nested `<!--`. Unterminated and ambiguous comments still fail.
- Boolean attributes restore the cursor to the end of the attribute name when no `=` follows, leaving whitespace for the next iteration. Quoted/value handling and mandatory separators remain intact.
- A new `li` scans ancestors only to the nearest list boundary. Same-scope implicit closure still fails. Other ancestor restrictions are unchanged. `menu` remains unsupported; no supported tags were added. `dt`/`dd` behavior is unchanged.

Canonical target attributes, last-four-ancestor hashing, URL handling, target uniqueness and rejection semantics were not changed. No additional parser blocker emerged on the real fixture.

Modified tests: append-only `tests/publish_target.test.cjs`; new `tests/timetable_parser_realhtml.test.cjs`. This evidence directory contains fixtures, reproducible offline runners, captured logs and audit artifacts. All original tracked tests remain intact. The prior worktree's entire test is archived as `reference-tests.original.cjs.txt`; its byte/hash/image/month/order mutation rejection tests are carried over unchanged except the local fixture directory. Its historical assertions that *valid* constructs reproduce bugs are superseded by compatibility tests, not retained as current rejection requirements. Original hostile/malformed/ambiguous/uniqueness/origin/link rejection suites and full-page mock drift assertions were not weakened.

## Provenance and TDD

Read authoritative secretary handoff `timetable-realhtml-local-20261008-final.md`, Claude `timetable-parser-fix-claude-design.json`, and actual supplement filename `timetable-parser-fix-claude-supplement.json`. The initially attempted `...design-supplement.json` did not exist. Reference worktree and baseline were read only.

`real-public.html` is a verbatim 22098-byte copy from the reference worktree's `docs/timetable-realhtml-local-20261008/real-public.html`, captured 2026-10-08T07:14:58Z from the public timetable page; SHA256 **6eca7c113577973e4831a6dc224e8a09ec952fd51613a66d0f82f82d71c45001**. No refetch or subresource request occurred here. Contract, selected span, third tag, and historical two-tag NOT-APPROVABLE proposal were also copied verbatim.

`three-images.MOCK-ONLY.html` changes exactly the first timetable image's src to `https://mock.invalid/poster.png`. It preserves the remaining two image tags and every other byte. No removal is approved or performed on any real page. The third image's identity, intended encoding, status and disposition remain unresolved.

Tests were written and run before the parser edit:

| Evidence | Outcome |
| --- | --- |
| `red.log` | 97 tests: 87 pass, **10 fail**, including real full-page compatibility |
| `green.log` | 99 tests: 99 pass, 0 fail |
| `node-full.log` | 503 tests: **502 pass, 0 fail, 1 skip** |
| `python-full.log` | **8 pass** |

RED test text is preserved in `red-realhtml-test.cjs.txt` and `red-unit-test.cjs.txt`. Two empirical/legacy-pin characterization tests were added after the first successful GREEN; the recorded final GREEN and full run include them. The skip is the existing localhost HTTP acceptance test: sandbox listener EPERM. HTTP acceptance is unverified.

## Fingerprints are not publication approval

`comparisons.json` and `characterize.cjs` record empirical observations, not approved hashes. The three-image variant differs from the historical two-tag proposal because the latter adds target `style="max-width:100%;height:auto;"`. Giving the three-image variant the same target style produces **the same fingerprint** as the two-tag proposal. Break counts/positions are siblings, not ancestors; the supplement's unsupported contrary conjecture was not adopted. Changed month text and swapped unrelated image order also produce the same fingerprint.

Production provider composition supplies only the target hash. It does **not** enforce whole-page month, sibling image or order equality. The legacy whole-page SHA pin is restricted to the local loopback mock harness; its image/month/order rejection tests still pass. The separate frozen proposal contract also rejects byte drift, but is local evidence, not production enforcement.

Unwired raw HTML still rejects. Both grammar-compatible proposals fail mocked verification with no approved target hash or a mismatched hash, even when supplied a whole-page hash at an HTTPS URL. Mock `publicRead` stops after its injected HTML response and never requests image bytes. Neither computed fingerprint was installed as a production approval hash. Parser acceptance cannot settle third-image disposition or approve the historical removal proposal.

## Verification limits and cleanup

`source-audit.json` compares every tracked non-test/non-doc file to the exact base; only the allowed parser differs. Product `index.html`, PosterContent, preview/download/print rendering, 1080×1920 dimensions, html2canvas scale 2, auth, save/load, APIs and provider remain byte-identical. Existing static and VM suites passed; this does not prove browser rendering.

`browser-feasibility.log` records a bounded inspection of the worktree and the already-known runtime dependency directory. Playwright/lucide exist, but React, ReactDOM, Babel standalone, Tailwind and html2canvas assets do not. Genuine isolated product Preview → 2160×3840 PNG/download/print/mocked SaveLoad browser regression was **NOT RUN**. No synthetic specimen is claimed as a product pass; no browser was launched or dependencies downloaded/installed.

Offline suite processes use an explicitly constructed environment, an external-network guard, bounded waits and process-group cleanup. Python sockets are blocked. Tests use mock responses; no networked project entrypoint was executed. Suite children exited and their groups were collected; task scratch data was removed. No persistent task server/browser exists. No credentials were read and no login/env edits, live image requests, CMS/GAS/Drive writes or production operations were performed. All local test data is synthetic except the attributed public HTML fixtures.

Remaining gates: independent final review; genuine product browser regression; fresh production baseline and approved exact page changes (including third-image disposition); deployed-source parity and authorized live image/CMS checks. Merge and production deployment require explicit human approval.

## Offline guard follow-up — source frozen

The coordinator independently reran the application suites outside the sandbox using the original guard: Node **503 total, 502 pass, 1 fail, 0 skip**; Python **8 pass** (Python result reported by coordinator). The Node log was inspected at `/Users/iaiangela/.hermes/profiles/secretary/work/timetable-parser-fix-independent-node.log`; its SHA256 is `c967dc14d033e49bed5092bb672da881adc71da654e370e212c1143b400c14fa`. The sole failure is `localhost HTTP auth, save, prepare, confirm, public image, limits` with `TypeError: fetch failed`. That log does not expose the nested cause. The historical sandbox logs above are preserved, not replaced or represented as independent success.

A guard-only regression reproduces the suspected defect: Node's normalized `[options, callback]` argument array was inspected as if it were the options object, rejecting numeric loopback hosts. The guard now inspects the inner options while forwarding the original arguments unchanged. The numeric-loopback allowlist and external-traffic rejection policy remain unchanged.

`offline-guard.test.cjs` is an evidence-harness test in this directory, not an application test. It uses Node-normalized arguments with a stubbed underlying connect (no traffic), asserts original argument identity, and checks rejection of external numeric addresses, external names, localhost names, missing hosts and socket paths in both direct and normalized forms. It also attempts an actual HTTP fetch against a server bound only to `127.0.0.1` with bounded timeout and cleanup.

- `guard-red.log`, before the guard edit: **1 pass, 1 fail, 1 skip**; normalized loopback fails with `EVIDENCE_EXTERNAL_NETWORK_FORBIDDEN`.
- `guard-green.log`, after the guard edit: **2 pass, 0 fail, 1 skip**.
- The HTTP test is skipped only because listening returns sandbox **EPERM**. Actual HTTP acceptance and a complete post-fix application suite outside the sandbox remain **pending coordinator rerun**. No full application-suite rerun is claimed for this follow-up.

Follow-up edits are confined to the guard, its evidence regression test/logs, this report, command documentation and the checksum manifest. All tracked non-doc files and the untracked real-HTML application test were hashed before and after this follow-up and are byte-identical. **Source and application tests are unchanged from the frozen review state**, including protected PNG/preview/printing behavior. No credentials were read, external/production requests made, packages installed, commits created or production changes performed. Ready for coordinator verification; not a production approval.
