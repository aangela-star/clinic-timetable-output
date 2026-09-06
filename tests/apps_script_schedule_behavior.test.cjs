const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const code = fs.readFileSync(path.resolve(__dirname, '../apps-script/Code.gs'), 'utf8');
const headers = ['month_key', 'data_json', 'schema_version', 'updated_at'];
const secret = 'test-only-server-secret';

function schedule(title, note) {
  return { title, note, clinics: [{ schedule: {}, changes: [] }] };
}

function createHarness(initialRows, { lockAvailable = true, displayMonths = {} } = {}) {
  const rows = initialRows.map((row) => row.slice());
  const numberFormats = [];
  const lockState = { tryCalls: [], releaseCalls: 0, locked: false };
  let flushCalls = 0;

  const sheet = {
    getLastRow() {
      return rows.length;
    },
    getRange(row, column, rowCount = 1, columnCount = 1) {
      return {
        getDisplayValues() {
          return rows.slice(row - 1, row - 1 + rowCount).map((source, offset) =>
            source.slice(column - 1, column - 1 + columnCount).map((value, c) =>
              column + c === 1 && Object.hasOwn(displayMonths, row + offset)
                ? displayMonths[row + offset] : String(value),
            ),
          );
        },
        getValues() {
          return rows.slice(row - 1, row - 1 + rowCount).map(
            (source) => source.slice(column - 1, column - 1 + columnCount),
          );
        },
        setValues(values) {
          for (let r = 0; r < rowCount; r += 1) {
            if (!rows[row - 1 + r]) rows[row - 1 + r] = [];
            for (let c = 0; c < columnCount; c += 1) {
              rows[row - 1 + r][column - 1 + c] = values[r][c];
            }
          }
          return this;
        },
        setNumberFormat(format) {
          numberFormats.push({ row, column, format });
          return this;
        },
      };
    },
    deleteRow(row) {
      rows.splice(row - 1, 1);
    },
    setFrozenRows() {},
  };

  const lock = {
    tryLock(timeout) {
      lockState.tryCalls.push(timeout);
      lockState.locked = lockAvailable;
      return lockAvailable;
    },
    hasLock() {
      return lockState.locked;
    },
    releaseLock() {
      lockState.releaseCalls += 1;
      lockState.locked = false;
    },
  };

  const context = vm.createContext({
    Date,
    JSON,
    isNaN,
    String,
    Number,
    Error,
    PropertiesService: {
      getScriptProperties: () => ({ getProperty: () => secret }),
    },
    LockService: { getScriptLock: () => lock },
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ({
        getSheetByName: (name) => (name === 'Schedules' ? sheet : null),
      }),
      flush: () => { flushCalls += 1; },
    },
    Utilities: {
      formatDate: (value) => `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}`,
    },
    Session: { getScriptTimeZone: () => 'Asia/Taipei' },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: (text) => ({
        text,
        setMimeType() { return this; },
      }),
    },
  });

  vm.runInContext(`${code}\n;globalThis.__api = { doPost, monthCellToKey_ };`, context);

  return {
    rows,
    numberFormats,
    lockState,
    get flushCalls() { return flushCalls; },
    monthCellToKey: context.__api.monthCellToKey_,
    post(body) {
      const output = context.__api.doPost({ postData: { contents: JSON.stringify(body) } });
      return JSON.parse(output.text);
    },
  };
}

test('load finds a Google Sheets Date month cell', () => {
  const data = schedule('115/8月', 'legacy date row');
  const harness = createHarness([
    headers,
    [new Date('2026-08-15T00:00:00Z'), JSON.stringify(data), 1, new Date('2026-08-20T00:00:00Z')],
  ]);

  const result = harness.post({ secret, action: 'load', month: '2026-08' });

  assert.equal(result.ok, true);
  assert.equal(result.found, true);
  assert.deepEqual(result.data, data);
  assert.deepEqual(harness.lockState.tryCalls, []);
});

for (const [kind, rawMonth] of [
  ['text', '2026-09'],
  ['Date', new Date('2026-09-01T00:00:00Z')],
  ['numeric serial', 46266],
]) {
  test(`load matches ${kind} month with YYYY-MM display without writing`, () => {
    const data = schedule('115/九月', kind);
    const original = [headers, [rawMonth, JSON.stringify(data), 1, '2026-09-06T10:40:08.000Z']];
    const harness = createHarness(original, { displayMonths: { 2: '2026-09' } });
    const result = harness.post({ secret, action: 'load', month: '2026-09' });
    assert.equal(result.ok, true);
    assert.equal(result.found, true);
    assert.equal(result.month, '2026-09');
    assert.deepEqual(result.data, data);
    assert.equal(result.updatedAt, '2026-09-06T10:40:08.000Z');
    assert.deepEqual(harness.rows, original);
    assert.equal(harness.flushCalls, 0);
    assert.deepEqual(harness.numberFormats, []);
    assert.deepEqual(harness.lockState.tryCalls, []);
  });
}

test('load chooses the last matching displayed month and never another month', () => {
  const latest = schedule('115/九月', 'latest');
  const original = [headers,
    ['2026-09', JSON.stringify(schedule('115/九月', 'old')), 1, 'old'],
    [46266, JSON.stringify(latest), 1, 'latest'],
    [46296, JSON.stringify(schedule('115/10月', 'other month')), 1, 'other'],
  ];
  const harness = createHarness(original, { displayMonths: { 3: '2026-09', 4: '2026-10' } });
  const result = harness.post({ secret, action: 'load', month: '2026-09' });
  assert.equal(result.found, true);
  assert.deepEqual(result.data, latest);
  assert.equal(result.updatedAt, 'latest');
  assert.deepEqual(harness.post({ secret, action: 'load', month: '2026-08' }),
    { ok: true, found: false, month: '2026-08' });
  assert.deepEqual(harness.rows, original);
});

test('valid displayed month takes precedence over a conflicting raw month', () => {
  const harness = createHarness([headers, ['2026-08', JSON.stringify(schedule('115/九月', 'display')), 1, 'stamp']],
    { displayMonths: { 2: '2026-09' } });
  assert.equal(harness.post({ secret, action: 'load', month: '2026-09' }).found, true);
  assert.equal(harness.post({ secret, action: 'load', month: '2026-08' }).found, false);
});

test('save overwrites the newest same-month row, removes legacy duplicates, and writes a text month key under ScriptLock', () => {
  const oldDateData = schedule('115/8月', 'old date row');
  const oldTextData = schedule('115/8月', 'old text row');
  const julyData = schedule('115/7月', 'keep another month');
  const currentData = schedule('115/8月', 'current save');
  const harness = createHarness([
    headers,
    [new Date('2026-08-01T00:00:00Z'), JSON.stringify(oldDateData), 1, new Date('2026-08-02T00:00:00Z')],
    ['2026-07', JSON.stringify(julyData), 1, new Date('2026-07-20T00:00:00Z')],
    ['2026-08', JSON.stringify(oldTextData), 1, new Date('2026-08-25T00:00:00Z')],
  ]);

  const result = harness.post({ secret, action: 'save', month: '2026-08', data: currentData });

  assert.equal(result.ok, true);
  assert.deepEqual(harness.lockState.tryCalls, [10000]);
  assert.equal(harness.lockState.releaseCalls, 1);
  assert.equal(harness.flushCalls, 1);
  assert.ok(harness.numberFormats.some(({ column, format }) => column === 1 && format === '@'));

  const augustRows = harness.rows.slice(1).filter((row) => harness.monthCellToKey(row[0]) === '2026-08');
  assert.equal(augustRows.length, 1);
  assert.equal(typeof augustRows[0][0], 'string');
  assert.equal(augustRows[0][0], '2026-08');
  assert.deepEqual(JSON.parse(augustRows[0][1]), currentData);
  assert.equal(harness.rows.some((row) => row[0] === '2026-07'), true);
});

test('save lock timeout leaves all sheet rows unchanged', () => {
  const original = [headers, ['2026-08', JSON.stringify(schedule('115/8月', 'existing')), 1, 'timestamp']];
  const harness = createHarness(original, { lockAvailable: false });

  const result = harness.post({ secret, action: 'save', month: '2026-08', data: schedule('115/8月', 'new') });

  assert.equal(result.ok, false);
  assert.equal(result.error, 'SAVE_LOCK_TIMEOUT');
  assert.deepEqual(harness.rows, original);
  assert.equal(harness.flushCalls, 0);
  assert.equal(harness.lockState.releaseCalls, 0);
});
