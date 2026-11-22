# 2026-11 fixture (cloud-sync-20261122)

Tracked test fixtures for `tests/calendar_cross_device_month.test.cjs`. Copied from the
local run artifacts so the tests do not depend on untracked working files.

- `november-2026.json` — the November 2026 draft as a saved editor payload.
- `november-2026-ledger.md` — the 150-cell source-to-model ledger for that draft.

## Candidate, not cloud published

This month is a **candidate draft only**. It has never been written to the cloud or published
to the public site: `state.source.approved` is `false` and `state.source.status` is
`pending-approval`, and the tests assert both. Nothing here should be read as approval to
publish, and the cells have not been verified by a human
(`state.source.imageVerification.humanCellByCellVerified` is `false`).

## Saturday 午診／晚診 is closed on a user confirmation

Both source photos are **blank** for Saturday afternoon and evening — no name and no 停診 mark.
The `closed` encoding of those four baseline cells (16 rendered cells) comes from the user's
explicit confirmation on 2026-11-22, 「星期六下午晚上都一定是休診」, recorded in
`state.source.saturdayClosure`. The images do **not** prove closure
(`imageProvesClosure: false`); the ledger keeps the source column as `(空白)` and labels the
reason `使用者確認休診（原圖空白）`.

## Original images are retained locally, not shipped

The two source photos are not in this repository. The absolute personal paths they were read
from have been replaced with descriptive filenames, and the image and crop references are
labelled `local evidence, not shipped`. All schedule values and provenance semantics are
otherwise identical to the artifact they were copied from.

## Running the tests

```
node --test tests/*.test.cjs
```
