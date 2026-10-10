# Minimal exception deletion release regression

Base: `31a426a188d0af580e4442b0bb197d966198290a`. Branch: `fix/timetable-exception-delete-release`.

The product change is exactly three reviewed `index.html` lines: visible accessible 刪除 with a 44px target and type=button, shrinkable adjacent input, and a whitespace-only exception bullet filter. Nonblank strings remain verbatim. Empty arrays hide the exception section; all-blank nonempty arrays retain its title without bullets. Capture layout, 1080×1920 dimensions and html2canvas scale 2 are unchanged.

The appended Apps Script VM test checks empty and legacy-whitespace arrays round-trip without modifying Apps Script. Browser tests use synthetic authentication and storage, locally verified retained assets, blocked service workers/WebSockets, abort-only unknown routing, and fresh owned Chromium contexts. No external request is forwarded. Save/Load is explicit; edits do not autosave or publish.

Run from the repository root. Dependencies are existing offline assets and installed Playwright/Chromium; this harness never installs or downloads dependencies. Default paths refer to the retained sibling asset folder and the local runtime. Portable overrides are `--assets=/absolute/asset-folder`, `--deps=/absolute/node_modules`, and runner `--node=/absolute/node`. Preserve the asset manifest and verified bytes together.

```sh
/usr/bin/env -i PATH=/usr/bin:/bin /Users/iaiangela/.local/bin/node --require ./docs/exception-delete-release/offline-guard.cjs docs/exception-delete-release/browser.cjs review-new
/usr/bin/env -i PATH=/usr/bin:/bin /usr/bin/python3 docs/exception-delete-release/run-offline.py --phase=suites-new
/usr/bin/env -i PATH=/usr/bin:/bin /Users/iaiangela/.local/bin/node --require ./docs/exception-delete-release/offline-guard.cjs --test docs/exception-delete-release/offline-guard.test.cjs
```

Use a fresh phase each run; evidence directories cannot be overwritten. Phases starting `delete-` intentionally omit whitespace assertions for intermediate delete-only TDD. Final/review phases include all checks. Browser base/branch assertions deliberately bind this pre-commit artifact; a later committed candidate requires the reviewer to bind those assertions to its reviewed SHA.

Local evidence is under `.local/release-prep/` and must not be staged. It records missing-button RED, whitespace-bullet RED, intermediate delete GREEN, final desktop/mobile GREEN, actual 2160×3840 downloads, full suites, source manifests, metadata and exact patches. The initial `delete-red` attempt also exposed a harness snapshot exclusion error; retain it as diagnostic evidence and use corrected `delete-red-verified` as the accepted RED.

Limits: Chromium mobile emulation is not physical Safari. Print is a mocked `window.print()` call, not a physical printer check. Storage/authentication are synthetic; offline tests do not attest live integration or publication readiness. This documentation does not authorize deployment. Parent must obtain Claude review of the isolated artifact and exact rollback preflight; GitHub source audit must precede deployment. Do not merge merely to obtain a SHA: merging production main may automatically deploy via Vercel.
