# Commands and execution order

All commands ran in `/Users/iaiangela/Projects/clinic-timetable-parser-fix-20261008`.

Before implementation (baseline parser):
```sh
python3 docs/timetable-parser-fix-20261008/run-offline.py --red
```
After implementation (run first with 97 tests, then again after two characterization tests; final log retained):
```sh
python3 docs/timetable-parser-fix-20261008/run-offline.py --green
python3 docs/timetable-parser-fix-20261008/run-offline.py
```
`commands-red.json`, `commands-green.json`, `commands-full.json` contain exact child argv and exit codes. `run-offline.py` records output, sanitizes environment, blocks external network and reaps child process groups. RED is historical evidence: running it against the fixed source now passes; the preserved RED test snapshots document the original input.

Reproducible observation and bounded local browser asset inspection:
```sh
node docs/timetable-parser-fix-20261008/characterize.cjs
python3 docs/timetable-parser-fix-20261008/inspect-browser-assets.py > docs/timetable-parser-fix-20261008/browser-feasibility.log
```
The first exploratory comparison used an inline Node script equivalent to `characterize.cjs`; final evidence uses the saved script, with break mutation adjacent to the target.

Final repository checks:
```sh
git branch --show-current
git rev-parse HEAD
git diff --check
git diff 08d41edbab4c2fbe940018959d33fc288c425a7e -- lib/publish-target.js tests/publish_target.test.cjs
git status --short
```
Source audit hashes were computed with Python hashlib on each `git ls-files` non-test/non-doc file and `git show 08d41edbab4c2fbe940018959d33fc288c425a7e:<file>` bytes. Exactly `lib/publish-target.js` differed. No secret/environment file was read. Generated suite scratch files were removed after collection.


Offline guard follow-up (application source/tests frozen):
```sh
# Before guard edit; expected exit 1, captured as guard-red.log:
env -i PATH=/usr/bin:/bin /Users/iaiangela/.local/bin/node --test docs/timetable-parser-fix-20261008/offline-guard.test.cjs
# After guard edit; exit 0 with HTTP listener EPERM skip, captured as guard-green.log:
env -i PATH=/usr/bin:/bin /Users/iaiangela/.local/bin/node --test docs/timetable-parser-fix-20261008/offline-guard.test.cjs
```
Coordinator: rerun the latter command outside the sandbox to exercise actual local HTTP, then rerun the existing sanitized full-suite runner. Post-fix full-suite results are pending. Historical suite logs are preserved. The guard regression uses stubbed transport for negative cases and a numeric-loopback-only server for HTTP; no external traffic is needed.

Follow-up verification: SHA256 comparison of all tracked non-doc files plus `tests/timetable_parser_realhtml.test.cjs` before/after; no differences. Reviewed the existing diff against `08d41edbab4c2fbe940018959d33fc288c425a7e`; no additional source/test edits. Refreshed and verified SHA256SUMS including guard regression artifacts.
