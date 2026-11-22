// PR18 BLOCKER 1. The editor's startup read reaches Apps Script through the proxy's GET, which
// forwarded the 'load' action. 'load' shares getScheduleSheet_() with 'save', and that helper
// INSERTS the Schedules sheet and writes its header row when the sheet is missing, and writes the
// header row when the sheet exists but is empty. So an automatic read could create state in the
// bound spreadsheet. This file pins a dedicated read-only action that cannot write by
// construction, and proves it by running the real apps-script/Code.gs in a VM whose spreadsheet
// objects TRAP every non-read call: the trap records the call and throws, so a write attempt both
// shows up in the recording and fails loudly instead of being silently tolerated.
//
// SCOPE OF PROOF: this is the repository source executed against a mock SpreadsheetApp. It says
// nothing about what is actually deployed in the Apps Script project; that remains unverified and
// must be deployed and checked separately (see the remediation report).
const test = require('node:test');
const assert = require('node:assert/strict');
const { code, HEADERS, secret, schedule, createHarness } = require('./helpers/apps-script-vm.cjs');

const ACTION = 'loadReadOnly';
const populated = () => [
  HEADERS,
  ['2026-11', JSON.stringify(schedule('115/11月', 'november')), 1, '2026-11-22T00:00:00.000Z'],
];

test('read-only load returns a populated month and attempts no mutation at all', () => {
  const h = createHarness(populated());
  const before = JSON.stringify(h.rows);
  const result = h.post({ secret, action: ACTION, month: '2026-11' });

  assert.equal(result.ok, true);
  assert.equal(result.found, true);
  assert.equal(result.month, '2026-11');
  assert.equal(result.readOnly, true, 'the backend must state that it served a read-only path');
  assert.deepEqual(result.data, schedule('115/11月', 'november'));
  assert.equal(result.updatedAt, '2026-11-22T00:00:00.000Z');
  assert.equal(result.schemaVersion, 1);
  assert.deepEqual(h.record, [], `mutation attempted: ${h.record}`);
  assert.deepEqual(h.lockCalls, [], 'a read must not take the script lock');
  assert.equal(JSON.stringify(h.rows), before);
});

test('read-only load reports a month that is absent from a populated sheet', () => {
  const h = createHarness(populated());
  const result = h.post({ secret, action: ACTION, month: '2026-12' });
  assert.equal(result.ok, true);
  assert.equal(result.found, false);
  assert.equal(result.readOnly, true);
  assert.equal(result.storage, 'MONTH_MISSING');
  assert.deepEqual(h.record, [], `mutation attempted: ${h.record}`);
});

test('read-only load never creates the Schedules sheet when it is missing', () => {
  const h = createHarness([], { sheetState: 'missing' });
  const result = h.post({ secret, action: ACTION, month: '2026-11' });
  assert.equal(result.ok, true);
  assert.equal(result.found, false);
  assert.equal(result.readOnly, true);
  assert.equal(result.storage, 'SHEET_MISSING');
  assert.deepEqual(h.record, [], `mutation attempted: ${h.record}`);
  assert.ok(!h.record.includes('Spreadsheet.insertSheet'));
});

test('read-only load never writes headers into an existing empty sheet', () => {
  const h = createHarness([], { sheetState: 'empty' });
  const result = h.post({ secret, action: ACTION, month: '2026-11' });
  assert.equal(result.ok, true);
  assert.equal(result.found, false);
  assert.equal(result.readOnly, true);
  assert.equal(result.storage, 'SHEET_EMPTY');
  assert.deepEqual(h.record, [], `mutation attempted: ${h.record}`);
  assert.deepEqual(h.rows, [], 'no header row may be written by a read');
});

test('read-only load fails closed on unexpected headers instead of repairing them', () => {
  const h = createHarness([['month', 'json', 'v', 'when'],
    ['2026-11', JSON.stringify(schedule('115/11月', 'x')), 1, 'y']]);
  const result = h.post({ secret, action: ACTION, month: '2026-11' });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'INVALID_SHEET_HEADERS');
  assert.deepEqual(h.record, [], `mutation attempted: ${h.record}`);
});

test('read-only load fails closed on a malformed stored payload', () => {
  const h = createHarness([HEADERS, ['2026-11', '{not json', 1, 'y']]);
  const result = h.post({ secret, action: ACTION, month: '2026-11' });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'INVALID_STORED_DATA');
  assert.deepEqual(h.record, [], `mutation attempted: ${h.record}`);
});

test('read-only load fails closed when the stored month title contradicts the key', () => {
  const h = createHarness([HEADERS, ['2026-11', JSON.stringify(schedule('115/10月', 'wrong')), 1, 'y']]);
  const result = h.post({ secret, action: ACTION, month: '2026-11' });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'MONTH_TITLE_MISMATCH');
  assert.deepEqual(h.record, [], `mutation attempted: ${h.record}`);
});

test('read-only load rejects a bad month key and a bad secret without touching the spreadsheet', () => {
  for (const body of [
    { secret, action: ACTION, month: 'nope' },
    { secret: 'wrong', action: ACTION, month: '2026-11' },
  ]) {
    const h = createHarness(populated(), { sheetState: 'missing' });
    const result = h.post(body);
    assert.equal(result.ok, false);
    assert.ok(['INVALID_MONTH_KEY', 'UNAUTHORIZED'].includes(result.error), result.error);
    assert.deepEqual(h.record, []);
    assert.deepEqual(h.reads, [], 'the spreadsheet must not even be opened');
  }
});

// An Apps Script deployment that predates this change receives 'loadReadOnly' as an unknown
// action. That must be a write-free refusal, which is what lets the proxy fail closed safely.
test('an unknown action is refused without opening or touching the spreadsheet', () => {
  const h = createHarness([], { sheetState: 'missing' });
  const result = h.post({ secret, action: 'actionFromAFutureClient', month: '2026-11' });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'UNSUPPORTED_ACTION');
  assert.deepEqual(h.record, []);
  assert.deepEqual(h.reads, []);
});

// CONTROL: the blocker was real. The legacy 'load' action, with writes ALLOWED so the call
// sequence is observable rather than aborted, does create the sheet and write the header row.
test('CONTROL: the legacy load action does write when the sheet is missing or empty', () => {
  const missing = createHarness([], { sheetState: 'missing', allowWrites: true });
  missing.post({ secret, action: 'load', month: '2026-11' });
  assert.ok(missing.record.includes('Spreadsheet.insertSheet'),
    `legacy load should have inserted the sheet: ${missing.record}`);
  assert.ok(missing.record.includes('Range.setValues'),
    `legacy load should have written the header row: ${missing.record}`);

  const empty = createHarness([], { sheetState: 'empty', allowWrites: true });
  empty.post({ secret, action: 'load', month: '2026-11' });
  assert.ok(empty.record.includes('Range.setValues'),
    `legacy load should have written headers into the empty sheet: ${empty.record}`);
  assert.ok(empty.record.includes('Sheet.setFrozenRows'), `${empty.record}`);
});

// The legacy action stays in the deployed backend (older frontends and the legacy editor page may
// still be served from a cache), but nothing in this repository may route a browser read to it.
test('the read-only action is the only load path the save action does not share', () => {
  assert.match(code, /loadReadOnly/);
  const readOnlyBody = code.slice(code.indexOf('function readOnlyLoadRequest_'),
    code.indexOf('function assertServerSecret_'));
  assert.ok(readOnlyBody.length > 100, 'failed to isolate the read-only handler');
  assert.ok(!/getScheduleSheet_\(/.test(readOnlyBody),
    'the read-only path must not call the sheet bootstrap helper that can insert and write');
  assert.ok(!/insertSheet|setValues|setFrozenRows|deleteRow|flush|getScriptLock/.test(readOnlyBody),
    'the read-only path must contain no mutating call');
});
