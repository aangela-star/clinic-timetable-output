const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const code = fs.readFileSync(path.resolve(__dirname, '../apps-script/Code.gs'), 'utf8');
const headers = ['month_key', 'data_json', 'schema_version', 'updated_at'];
const finalHeaders = [
  'version_id',
  'month_key',
  'version_date',
  'version_seq',
  'parent_version_id',
  'expected_latest_version_id',
  'save_request_id',
  'data_json',
  'schema_version',
  'saved_at',
];
const secret = 'test-only-server-secret';

function schedule(title, note) {
  return {
    title,
    note,
    clinics: [
      { id: 'clinic-1', name: '晉安復健科診所 醫師門診表', schedule: {}, changes: [] },
      { id: 'clinic-2', name: '毅安診所 醫師門診表', schedule: {}, changes: [] },
    ],
  };
}

function canonicalJson(value) {
  return JSON.stringify(sortValue(value));
}

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const output = {};
    Object.keys(value).sort().forEach((key) => {
      output[key] = sortValue(value[key]);
    });
    return output;
  }
  return value === undefined ? null : value;
}

function scheduleWithCanonicalJsonLength(targetLength) {
  const baseline = schedule('115/9月', '');
  baseline.clinics[0].id = 'jinan';
  baseline.clinics[1].id = 'yian';
  const overhead = canonicalJson(baseline).length;
  assert.ok(targetLength >= overhead);
  const data = schedule('115/9月', 'x'.repeat(targetLength - overhead));
  data.clinics[0].id = 'jinan';
  data.clinics[1].id = 'yian';
  assert.equal(canonicalJson(data).length, targetLength);
  return data;
}

function createHarness(initialRows, { lockAvailable = true, now = '2026-08-31T16:05:00.000Z', includeSchedules = true, extraSheets = {}, uuidValues: configuredUuidValues, propertyReadOverrides = {}, faults = {} } = {}) {
  const rows = initialRows.map((row) => row.slice());
  const sheets = {};
  const numberFormats = [];
  const properties = { CLINIC_SERVER_SECRET: secret };
  const uuidValues = configuredUuidValues ? configuredUuidValues.slice() : ['uuid-0001', 'uuid-0002', 'uuid-0003'];
  const lockState = { tryCalls: [], releaseCalls: 0, locked: false };
  let flushCalls = 0;

  function consumeFault(kind, predicate) {
    const list = faults[kind] || [];
    const index = list.findIndex(predicate);
    if (index === -1) return;
    const [fault] = list.splice(index, 1);
    const error = new Error(fault.message || `${kind} fault`);
    error.code = fault.code || 'INJECTED_FAULT';
    throw error;
  }

  function makeSheet(sheetRows, sheetName) {
    return {
    name: sheetName,
    getLastRow() {
      return sheetRows.length;
    },
    getRange(row, column, rowCount = 1, columnCount = 1) {
      return {
        getValues() {
          return sheetRows.slice(row - 1, row - 1 + rowCount).map(
            (source) => source.slice(column - 1, column - 1 + columnCount),
          );
        },
        setValues(values) {
          for (let r = 0; r < rowCount; r += 1) {
            if (!sheetRows[row - 1 + r]) sheetRows[row - 1 + r] = [];
            for (let c = 0; c < columnCount; c += 1) {
              sheetRows[row - 1 + r][column - 1 + c] = values[r][c];
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
      sheetRows.splice(row - 1, 1);
    },
    clear() {
      sheetRows.splice(0, sheetRows.length);
    },
    copyTo() {
      consumeFault('copyTo', (fault) => !fault.from || fault.from === this.name);
      const copiedRows = sheetRows.map((row) => row.slice());
      const copy = makeSheet(copiedRows, `${this.name} copy`);
      sheets[copy.name] = copy;
      return copy;
    },
    setName(name) {
      consumeFault('setName', (fault) => (!fault.from || fault.from === this.name) && (!fault.to || fault.to === name));
      if (sheets[name] && sheets[name] !== this) {
        throw new Error(`Sheet name already exists: ${name}`);
      }
      delete sheets[this.name];
      this.name = name;
      sheets[name] = this;
      return this;
    },
    setFrozenRows() {},
    };
  }
  if (includeSchedules) {
    const sheet = makeSheet(rows, 'Schedules');
    sheets.Schedules = sheet;
  }
  Object.entries(extraSheets).forEach(([name, sheetRows]) => {
    sheets[name] = makeSheet(sheetRows.map((row) => row.slice()), name);
  });

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
    Date: class FixedDate extends Date {
      constructor(...args) {
        super(...(args.length ? args : [now]));
      }
      static now() {
        return new Date(now).getTime();
      }
    },
    JSON,
    isNaN,
    String,
    Number,
    Error,
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (key) => Object.hasOwn(propertyReadOverrides, key) ? propertyReadOverrides[key] : (properties[key] || null),
        setProperty: (key, value) => { properties[key] = String(value); },
        deleteProperty: (key) => { delete properties[key]; },
      }),
    },
    LockService: { getScriptLock: () => lock },
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ({
        getSheetByName: (name) => sheets[name] || null,
        insertSheet: (name) => {
          const inserted = makeSheet([], name);
          sheets[name] = inserted;
          return inserted;
        },
      }),
      flush: () => { flushCalls += 1; },
    },
    Utilities: {
      getUuid: () => uuidValues.shift() || 'uuid-fallback',
      formatDate: (value, timezone, pattern) => {
        const date = new Date(value.getTime() + (timezone === 'Asia/Taipei' ? 8 * 60 * 60 * 1000 : 0));
        const yyyy = date.getUTCFullYear();
        const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
        const dd = String(date.getUTCDate()).padStart(2, '0');
        const HH = String(date.getUTCHours()).padStart(2, '0');
        const MM = String(date.getUTCMinutes()).padStart(2, '0');
        const ss = String(date.getUTCSeconds()).padStart(2, '0');
        if (pattern === 'yyyyMMddHHmmss') return `${yyyy}${mm}${dd}${HH}${MM}${ss}`;
        if (pattern === 'yyyy-MM-dd') return `${yyyy}-${mm}-${dd}`;
        return `${yyyy}-${mm}`;
      },
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

  vm.runInContext(`${code}\n;globalThis.__api = { doPost, monthCellToKey_, migrateLegacySchedulesToVersions_, rollbackVersionMigration_, readFinalRows_ };`, context);

  return {
    rows,
    sheets,
    numberFormats,
    properties,
    lockState,
    get flushCalls() { return flushCalls; },
    monthCellToKey: context.__api.monthCellToKey_,
    post(body) {
      const output = context.__api.doPost({ postData: { contents: JSON.stringify(body) } });
      return JSON.parse(output.text);
    },
    migrate() {
      return context.__api.migrateLegacySchedulesToVersions_();
    },
    rollback(backupName) {
      return context.__api.rollbackVersionMigration_(backupName);
    },
    readFinalRows(sheet = sheets.Schedules) {
      return context.__api.readFinalRows_(sheet);
    },
  };
}

function finalVersionRow({
  versionId,
  monthKey,
  versionDate = '2026-09-01',
  versionSeq = 1,
  parentVersionId = '',
  expectedLatestVersionId = '',
  saveRequestId,
  data = schedule('115/9月', 'existing'),
  schemaVersion = 1,
  savedAt = new Date('2026-09-01T01:00:00.000Z'),
}) {
  return [
    versionId,
    monthKey,
    versionDate,
    versionSeq,
    parentVersionId,
    expectedLatestVersionId,
    saveRequestId,
    JSON.stringify(data),
    schemaVersion,
    savedAt,
  ];
}

test('saveVersion appends an immutable final-schema row and leaves current unset', () => {
  const data = schedule('115/9月', 'first version');
  const harness = createHarness([finalHeaders]);

  const result = harness.post({
    secret,
    action: 'saveVersion',
    monthKey: '2026-09',
    schemaVersion: 1,
    saveRequestId: 'req-1',
    parentVersionId: null,
    expectedLatestVersionId: null,
    data,
  });

  assert.equal(result.ok, true);
  assert.equal(result.created, true);
  assert.equal(result.version.versionId, 'sv_uuid-0001');
  assert.equal(result.version.versionDate, '2026-09-01');
  assert.equal(result.version.versionSeq, 1);
  assert.equal(result.version.displayName, '2026-09-01 V1');
  assert.equal(harness.properties.CURRENT_SCHEDULE_VERSION_ID, undefined);
  assert.equal(harness.rows.length, 2);
  assert.deepEqual(harness.rows[0], finalHeaders);
  assert.equal(harness.rows[1][0], 'sv_uuid-0001');
  assert.equal(harness.rows[1][1], '2026-09');
  assert.equal(harness.rows[1][2], '2026-09-01');
  assert.equal(harness.rows[1][3], 1);
  assert.equal(harness.rows[1][4], '');
  assert.equal(harness.rows[1][5], '');
  assert.equal(harness.rows[1][6], 'req-1');
  assert.equal(JSON.parse(harness.rows[1][7]).clinics[0].id, 'jinan');
  assert.equal(JSON.parse(harness.rows[1][7]).clinics[1].id, 'yian');
  assert.equal(harness.rows[1][8], 1);
  assert.ok(harness.rows[1][9] instanceof Date);
});

test('saveVersion retries UUID collisions and fails closed when retries are exhausted', () => {
  const collision = createHarness([
    finalHeaders,
    finalVersionRow({ versionId: 'sv_uuid-collision', monthKey: '2026-09', saveRequestId: 'existing' }),
  ], { uuidValues: ['uuid-collision', 'uuid-fresh'] });

  const saved = collision.post({
    secret,
    action: 'saveVersion',
    monthKey: '2026-09',
    schemaVersion: 1,
    saveRequestId: 'after-collision',
    expectedLatestVersionId: 'sv_uuid-collision',
    data: schedule('115/9月', 'fresh'),
  });
  assert.equal(saved.ok, true);
  assert.equal(saved.version.versionId, 'sv_uuid-fresh');
  assert.equal(collision.rows.filter((row) => row[0] === 'sv_uuid-collision').length, 1);

  const exhausted = createHarness([
    finalHeaders,
    finalVersionRow({ versionId: 'sv_same', monthKey: '2026-09', saveRequestId: 'existing' }),
  ], { uuidValues: ['same', 'same', 'same', 'same', 'same'] });
  const blocked = exhausted.post({
    secret,
    action: 'saveVersion',
    monthKey: '2026-09',
    schemaVersion: 1,
    saveRequestId: 'exhausted',
    expectedLatestVersionId: 'sv_same',
    data: schedule('115/9月', 'blocked'),
  });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.error, 'VERSION_ID_COLLISION_EXHAUSTED');
  assert.equal(exhausted.rows.length, 2);
});

test('saveVersion verifies the exact appended request metadata after write', () => {
  const harness = createHarness([finalHeaders]);
  const originalFlush = harness.sheets.Schedules.getRange;
  let tampered = false;
  harness.sheets.Schedules.getRange = function getRange(row, column, rowCount, columnCount) {
    const range = originalFlush.call(this, row, column, rowCount, columnCount);
    if (row > 1 && column === 1 && columnCount === finalHeaders.length) {
      const originalSetValues = range.setValues;
      range.setValues = function setValues(values) {
        const result = originalSetValues.call(this, values);
        if (!tampered) {
          tampered = true;
          harness.rows[row - 1][6] = 'wrong-request';
        }
        return result;
      };
    }
    return range;
  };

  const result = harness.post({
    secret,
    action: 'saveVersion',
    monthKey: '2026-09',
    schemaVersion: 1,
    saveRequestId: 'req-exact',
    data: schedule('115/9月', 'verify'),
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'VERSION_APPEND_VERIFY_FAILED');
});

test('saveVersion sequences per target month and Taipei server date, and rejects malformed history', () => {
  const harness = createHarness([
    finalHeaders,
    finalVersionRow({ versionId: 'sv_aug', monthKey: '2026-08', versionDate: '2026-09-01', versionSeq: 1, saveRequestId: 'req-aug', data: schedule('115/8月', 'aug') }),
    finalVersionRow({ versionId: 'sv_sep_1', monthKey: '2026-09', versionDate: '2026-09-01', versionSeq: 1, saveRequestId: 'req-sep-1' }),
  ]);

  const result = harness.post({
    secret,
    action: 'saveVersion',
    monthKey: '2026-09',
    schemaVersion: 1,
    saveRequestId: 'req-sep-2',
    parentVersionId: null,
    expectedLatestVersionId: 'sv_sep_1',
    data: schedule('115/9月', 'second'),
  });

  assert.equal(result.ok, true);
  assert.equal(result.version.versionDate, '2026-09-01');
  assert.equal(result.version.versionSeq, 2);

  const malformed = createHarness([
    finalHeaders,
    finalVersionRow({ versionId: 'sv_a', monthKey: '2026-09', versionSeq: 1, saveRequestId: 'req-a' }),
    finalVersionRow({ versionId: 'sv_b', monthKey: '2026-09', versionSeq: 1, saveRequestId: 'req-b' }),
  ]);
  const blocked = malformed.post({
    secret,
    action: 'saveVersion',
    monthKey: '2026-09',
    schemaVersion: 1,
    saveRequestId: 'req-c',
    data: schedule('115/9月', 'blocked'),
  });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.error, 'MALFORMED_VERSION_HISTORY');
  assert.equal(malformed.rows.length, 3);
});

test('saveVersion idempotency lookup happens before stale checks and detects key reuse', () => {
  const originalData = schedule('115/9月', 'original');
  const harness = createHarness([
    finalHeaders,
    finalVersionRow({ versionId: 'sv_first', monthKey: '2026-09', versionSeq: 1, saveRequestId: 'same-req', data: originalData }),
    finalVersionRow({ versionId: 'sv_second', monthKey: '2026-09', versionSeq: 2, saveRequestId: 'newer-req', expectedLatestVersionId: 'sv_first', data: schedule('115/9月', 'newer') }),
  ]);

  const replay = harness.post({
    secret,
    action: 'saveVersion',
    monthKey: '2026-09',
    schemaVersion: 1,
    saveRequestId: 'same-req',
    parentVersionId: null,
    expectedLatestVersionId: null,
    data: originalData,
  });

  assert.equal(replay.ok, true);
  assert.equal(replay.created, false);
  assert.equal(replay.idempotentReplay, true);
  assert.equal(replay.version.versionId, 'sv_first');
  assert.equal(harness.rows.length, 3);

  const reuse = harness.post({
    secret,
    action: 'saveVersion',
    monthKey: '2026-09',
    schemaVersion: 1,
    saveRequestId: 'same-req',
    parentVersionId: null,
    expectedLatestVersionId: null,
    data: schedule('115/9月', 'different'),
  });
  assert.equal(reuse.ok, false);
  assert.equal(reuse.error, 'IDEMPOTENCY_KEY_REUSE');
  assert.equal(harness.rows.length, 3);
});

test('saveVersion enforces target-month stale base and allows cross-month parent lineage', () => {
  const harness = createHarness([
    finalHeaders,
    finalVersionRow({ versionId: 'sv_aug_parent', monthKey: '2026-08', saveRequestId: 'aug-parent', data: schedule('115/8月', 'parent') }),
    finalVersionRow({ versionId: 'sv_sep_latest', monthKey: '2026-09', saveRequestId: 'sep-latest' }),
  ]);

  const stale = harness.post({
    secret,
    action: 'saveVersion',
    monthKey: '2026-09',
    schemaVersion: 1,
    saveRequestId: 'stale',
    parentVersionId: 'sv_aug_parent',
    expectedLatestVersionId: null,
    data: schedule('115/9月', 'stale'),
  });
  assert.equal(stale.ok, false);
  assert.equal(stale.error, 'STALE_BASE');
  assert.equal(stale.latestVersionId, 'sv_sep_latest');
  assert.equal(stale.actualLatestVersion.versionId, 'sv_sep_latest');
  assert.equal(Object.hasOwn(stale.actualLatestVersion, 'data'), false);

  const saved = harness.post({
    secret,
    action: 'saveVersion',
    monthKey: '2026-09',
    schemaVersion: 1,
    saveRequestId: 'cross-month-parent',
    parentVersionId: 'sv_aug_parent',
    expectedLatestVersionId: 'sv_sep_latest',
    data: schedule('115/9月', 'child'),
  });
  assert.equal(saved.ok, true);
  assert.equal(saved.version.parentVersionId, 'sv_aug_parent');

  const missing = harness.post({
    secret,
    action: 'saveVersion',
    monthKey: '2026-09',
    schemaVersion: 1,
    saveRequestId: 'missing-parent',
    parentVersionId: 'sv_missing',
    expectedLatestVersionId: saved.version.versionId,
    data: schedule('115/9月', 'missing'),
  });
  assert.equal(missing.ok, false);
  assert.equal(missing.error, 'PARENT_VERSION_NOT_FOUND');
});

test('version read actions cover current, latest, metadata list, exact loadVersion, and invalid current', () => {
  const harness = createHarness([
    finalHeaders,
    finalVersionRow({ versionId: 'sv_aug', monthKey: '2026-08', saveRequestId: 'aug', data: schedule('115/8月', 'aug') }),
    finalVersionRow({ versionId: 'sv_sep_1', monthKey: '2026-09', versionSeq: 1, saveRequestId: 'sep1' }),
    finalVersionRow({ versionId: 'sv_sep_2', monthKey: '2026-09', versionSeq: 2, saveRequestId: 'sep2', expectedLatestVersionId: 'sv_sep_1', data: schedule('115/9月', 'latest') }),
  ]);

  assert.deepEqual(harness.post({ secret, action: 'loadCurrent' }), { ok: true, found: false, currentScheduleVersionId: null });

  const latest = harness.post({ secret, action: 'loadLatestForMonth', monthKey: '2026-09' });
  assert.equal(latest.ok, true);
  assert.equal(latest.version.versionId, 'sv_sep_2');
  assert.equal(latest.version.data.note, 'latest');

  const list = harness.post({ secret, action: 'listVersions', monthKey: '2026-09' });
  assert.equal(list.ok, true);
  assert.equal(list.monthKey, '2026-09');
  assert.equal(list.currentScheduleVersionId, null);
  assert.deepEqual(list.versions.map((version) => version.versionId), ['sv_sep_2', 'sv_sep_1']);
  assert.equal(Object.hasOwn(list.versions[0], 'data'), false);

  const loaded = harness.post({ secret, action: 'loadVersion', versionId: 'sv_sep_1' });
  assert.equal(loaded.ok, true);
  assert.equal(loaded.version.versionId, 'sv_sep_1');

  harness.properties.CURRENT_SCHEDULE_VERSION_ID = 'sv_missing';
  const invalid = harness.post({ secret, action: 'loadCurrent' });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.error, 'CURRENT_VERSION_INVALID');
  assert.equal(invalid.currentScheduleVersionId, 'sv_missing');

  const missing = harness.post({ secret, action: 'loadVersion', versionId: 'sv_missing' });
  assert.equal(missing.ok, false);
  assert.equal(missing.error, 'VERSION_NOT_FOUND');
});

test('setCurrentVersion uses optimistic concurrency and already-current retry is idempotent', () => {
  const harness = createHarness([
    finalHeaders,
    finalVersionRow({ versionId: 'sv_one', monthKey: '2026-09', saveRequestId: 'one' }),
    finalVersionRow({ versionId: 'sv_two', monthKey: '2026-09', versionSeq: 2, saveRequestId: 'two', expectedLatestVersionId: 'sv_one' }),
  ]);

  const changed = harness.post({ secret, action: 'setCurrentVersion', versionId: 'sv_one', expectedCurrentVersionId: null });
  assert.equal(changed.ok, true);
  assert.equal(changed.changed, true);
  assert.equal(changed.currentScheduleVersionId, 'sv_one');
  assert.equal(changed.version.versionId, 'sv_one');
  assert.equal(harness.properties.CURRENT_SCHEDULE_VERSION_ID, 'sv_one');

  const retry = harness.post({ secret, action: 'setCurrentVersion', versionId: 'sv_one', expectedCurrentVersionId: null });
  assert.equal(retry.ok, true);
  assert.equal(retry.changed, false);
  assert.equal(retry.currentScheduleVersionId, 'sv_one');
  assert.equal(retry.version.versionId, 'sv_one');

  const mismatch = harness.post({ secret, action: 'setCurrentVersion', versionId: 'sv_two', expectedCurrentVersionId: null });
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.error, 'CURRENT_VERSION_CHANGED');
  assert.equal(mismatch.currentScheduleVersionId, 'sv_one');
  assert.equal(harness.properties.CURRENT_SCHEDULE_VERSION_ID, 'sv_one');
});

test('setCurrentVersion verifies script property read-back matches requested target', () => {
  const harness = createHarness([
    finalHeaders,
    finalVersionRow({ versionId: 'sv_one', monthKey: '2026-09', saveRequestId: 'one' }),
  ], { propertyReadOverrides: { CURRENT_SCHEDULE_VERSION_ID: 'sv_wrong' } });

  const result = harness.post({ secret, action: 'setCurrentVersion', versionId: 'sv_one', expectedCurrentVersionId: 'sv_wrong' });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'CURRENT_VERSION_VERIFY_FAILED');
});

test('saveVersion rejects month-title mismatch and invalid clinic identities', () => {
  const mismatch = createHarness([finalHeaders]).post({
    secret,
    action: 'saveVersion',
    monthKey: '2026-09',
    schemaVersion: 1,
    saveRequestId: 'bad-month',
    data: schedule('115/8月', 'bad'),
  });
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.error, 'MONTH_TITLE_MISMATCH');

  const duplicate = schedule('115/9月', 'duplicate');
  duplicate.clinics[1].id = 'clinic-1';
  duplicate.clinics[1].name = '晉安復健科診所 醫師門診表';
  const duplicateResult = createHarness([finalHeaders]).post({
    secret,
    action: 'saveVersion',
    monthKey: '2026-09',
    schemaVersion: 1,
    saveRequestId: 'duplicate',
    data: duplicate,
  });
  assert.equal(duplicateResult.ok, false);
  assert.equal(duplicateResult.error, 'DUPLICATE_CLINIC_IDENTITY');

  const unknown = schedule('115/9月', 'unknown');
  unknown.clinics[1].id = 'clinic-3';
  const unknownResult = createHarness([finalHeaders]).post({
    secret,
    action: 'saveVersion',
    monthKey: '2026-09',
    schemaVersion: 1,
    saveRequestId: 'unknown',
    data: unknown,
  });
  assert.equal(unknownResult.ok, false);
  assert.equal(unknownResult.error, 'INVALID_CLINIC_IDENTITY');

  const swapped = schedule('115/9月', 'swapped');
  swapped.clinics[0].name = '毅安診所 醫師門診表';
  const swappedResult = createHarness([finalHeaders]).post({
    secret,
    action: 'saveVersion',
    monthKey: '2026-09',
    schemaVersion: 1,
    saveRequestId: 'swapped',
    data: swapped,
  });
  assert.equal(swappedResult.ok, false);
  assert.equal(swappedResult.error, 'INVALID_CLINIC_IDENTITY');

  const malformed = schedule('115/9月', 'malformed');
  delete malformed.clinics[0].schedule;
  const malformedResult = createHarness([finalHeaders]).post({
    secret,
    action: 'saveVersion',
    monthKey: '2026-09',
    schemaVersion: 1,
    saveRequestId: 'malformed',
    data: malformed,
  });
  assert.equal(malformedResult.ok, false);
  assert.equal(malformedResult.error, 'INVALID_SCHEDULE_DATA');
});

test('final-schema actions require final headers while legacy load/save remain compatible', () => {
  const legacyData = schedule('115/9月', 'legacy');
  const harness = createHarness([
    headers,
    ['2026-09', JSON.stringify(legacyData), 1, new Date('2026-09-01T00:00:00.000Z')],
  ]);

  const finalAction = harness.post({ secret, action: 'loadLatestForMonth', monthKey: '2026-09' });
  assert.equal(finalAction.ok, false);
  assert.equal(finalAction.error, 'FINAL_SCHEMA_REQUIRED');

  const legacyLoad = harness.post({ secret, action: 'load', month: '2026-09' });
  assert.equal(legacyLoad.ok, true);
  assert.equal(legacyLoad.found, true);

  const legacySave = harness.post({ secret, action: 'save', month: '2026-09', data: schedule('115/9月', 'new legacy') });
  assert.equal(legacySave.ok, true);
  assert.equal(harness.rows[0].join('|'), headers.join('|'));

  const finalHarness = createHarness([finalHeaders]);
  const finalLoad = finalHarness.post({ secret, action: 'load', month: '2026-09' });
  assert.equal(finalLoad.ok, false);
  assert.equal(finalLoad.error, 'LEGACY_ACTION_UNAVAILABLE_AFTER_MIGRATION');
  const finalSave = finalHarness.post({ secret, action: 'save', month: '2026-09', data: schedule('115/9月', 'legacy blocked') });
  assert.equal(finalSave.ok, false);
  assert.equal(finalSave.error, 'LEGACY_ACTION_UNAVAILABLE_AFTER_MIGRATION');
  assert.deepEqual(finalHarness.rows, [finalHeaders]);
});

test('manual migration validates legacy data, is idempotent, and leaves current unset; rollback preserves version data', () => {
  const harness = createHarness([
    headers,
    ['2026-08', JSON.stringify(schedule('115/8月', 'aug')), 1, new Date('2026-08-15T02:00:00.000Z')],
    ['2026-09', JSON.stringify(schedule('115/9月', 'sep')), 1, new Date('2026-09-01T02:00:00.000Z')],
  ]);
  harness.properties.CURRENT_SCHEDULE_VERSION_ID = 'sv_old';

  const migrated = harness.migrate();
  const activeRows = harness.sheets.Schedules.getRange(1, 1, 3, finalHeaders.length).getValues();
  assert.equal(migrated.ok, true);
  assert.equal(migrated.migrated, true);
  assert.equal(activeRows[0].join('|'), finalHeaders.join('|'));
  assert.equal(activeRows.length, 3);
  assert.equal(harness.properties.CURRENT_SCHEDULE_VERSION_ID, undefined);

  const idempotent = harness.migrate();
  assert.equal(idempotent.ok, true);
  assert.equal(idempotent.idempotent, true);
  assert.equal(harness.properties.CURRENT_SCHEDULE_VERSION_ID, undefined);

  const backupName = migrated.backupSheetName;
  const rolledBack = harness.rollback(backupName);
  assert.equal(rolledBack.ok, true);
  assert.equal(harness.sheets.Schedules.getRange(1, 1, 1, headers.length).getValues()[0].join('|'), headers.join('|'));
  assert.ok(Object.keys(harness.sheets).some((name) => name.startsWith('Schedules_version_data_')));

  const duplicate = createHarness([
    headers,
    ['2026-09', JSON.stringify(schedule('115/9月', 'a')), 1, new Date('2026-09-01T00:00:00.000Z')],
    ['2026-09', JSON.stringify(schedule('115/9月', 'b')), 1, new Date('2026-09-02T00:00:00.000Z')],
  ]);
  assert.throws(() => duplicate.migrate(), /duplicate month/i);
  assert.equal(duplicate.rows[0].join('|'), headers.join('|'));

  const partial = createHarness([
    finalHeaders,
    finalVersionRow({ versionId: 'sv_partial', monthKey: '2026-09', saveRequestId: 'partial' }).slice(0, 8),
  ]);
  assert.throws(() => partial.migrate(), /schema_version/);
});

test('migration fails closed when partial state or missing active sheet exists without mutating sheets', () => {
  const partial = createHarness([
    headers,
    ['2026-09', JSON.stringify(schedule('115/9月', 'sep')), 1, new Date('2026-09-01T02:00:00.000Z')],
  ]);
  partial.properties.SCHEDULE_VERSION_MIGRATION_STATE = JSON.stringify({ status: 'in_progress' });
  const namesBefore = Object.keys(partial.sheets).sort();
  assert.throws(() => partial.migrate(), { code: 'MIGRATION_INCOMPLETE' });
  assert.deepEqual(Object.keys(partial.sheets).sort(), namesBefore);
  assert.equal(partial.rows.length, 2);

  const missing = createHarness([], { includeSchedules: false });
  assert.throws(() => missing.migrate(), { code: 'SCHEDULE_SHEET_NOT_FOUND' });
  assert.deepEqual(Object.keys(missing.sheets), []);

  const finalMissing = createHarness([], { includeSchedules: false });
  const result = finalMissing.post({ secret, action: 'loadLatestForMonth', monthKey: '2026-09' });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'SCHEDULE_SHEET_NOT_FOUND');
  assert.deepEqual(Object.keys(finalMissing.sheets), []);
});

test('idempotent migration on final sheet keeps authorized current version', () => {
  const harness = createHarness([
    finalHeaders,
    finalVersionRow({ versionId: 'sv_current', monthKey: '2026-09', saveRequestId: 'current' }),
  ]);
  harness.properties.CURRENT_SCHEDULE_VERSION_ID = 'sv_current';
  const result = harness.migrate();
  assert.equal(result.ok, true);
  assert.equal(result.idempotent, true);
  assert.equal(harness.properties.CURRENT_SCHEDULE_VERSION_ID, 'sv_current');
});

test('rollback validates active final sheet and exact preserved legacy backup before mutating', () => {
  const backupRows = [
    headers,
    ['2026-09', JSON.stringify(schedule('115/9月', 'backup')), 1, new Date('2026-09-01T02:00:00.000Z')],
  ];
  const harness = createHarness([
    finalHeaders,
    finalVersionRow({ versionId: 'sv_new', monthKey: '2026-09', saveRequestId: 'new' }),
  ], { extraSheets: { Schedules_legacy_backup_20260901000000: backupRows } });

  assert.throws(() => harness.rollback('ArbitraryBackup'), { code: 'INVALID_BACKUP_SHEET_NAME' });
  assert.ok(harness.sheets.Schedules);
  assert.ok(harness.sheets.Schedules_legacy_backup_20260901000000);

  const legacyActive = createHarness(backupRows, { extraSheets: { Schedules_legacy_backup_20260901000000: backupRows } });
  const noop = legacyActive.rollback('Schedules_legacy_backup_20260901000000');
  assert.equal(noop.ok, true);
  assert.equal(noop.restored, false);
  assert.equal(legacyActive.sheets.Schedules.getRange(1, 1, 1, headers.length).getValues()[0].join('|'), headers.join('|'));

  const badBackup = createHarness([
    finalHeaders,
    finalVersionRow({ versionId: 'sv_new', monthKey: '2026-09', saveRequestId: 'new' }),
  ], { extraSheets: { Schedules_legacy_backup_20260901000000: [finalHeaders] } });
  assert.throws(() => badBackup.rollback('Schedules_legacy_backup_20260901000000'), { code: 'INVALID_SHEET_HEADERS' });

  const restored = harness.rollback('Schedules_legacy_backup_20260901000000');
  assert.equal(restored.ok, true);
  assert.ok(harness.sheets.Schedules_legacy_backup_20260901000000);
  assert.ok(Object.keys(harness.sheets).some((name) => name.startsWith('Schedules_version_data_')));
});

test('interrupted rollback persists marker and is recoverable on retry without deleting sheets', () => {
  const backupRows = [
    headers,
    ['2026-09', JSON.stringify(schedule('115/9月', 'backup')), 1, new Date('2026-09-01T02:00:00.000Z')],
  ];
  const harness = createHarness([
    finalHeaders,
    finalVersionRow({ versionId: 'sv_new', monthKey: '2026-09', saveRequestId: 'new' }),
  ], {
    extraSheets: { Schedules_legacy_backup_20260901000000: backupRows },
    faults: { copyTo: [{ from: 'Schedules_legacy_backup_20260901000000', code: 'COPY_FAILED' }] },
  });

  assert.throws(() => harness.rollback('Schedules_legacy_backup_20260901000000'), { code: 'COPY_FAILED' });
  assert.equal(harness.sheets.Schedules, undefined);
  assert.ok(harness.sheets.Schedules_version_data_20260901000500);
  assert.ok(harness.sheets.Schedules_legacy_backup_20260901000000);
  assert.equal(JSON.parse(harness.properties.SCHEDULE_VERSION_MIGRATION_STATE).status, 'rollback_in_progress');

  const recovered = harness.rollback('Schedules_legacy_backup_20260901000000');
  assert.equal(recovered.ok, true);
  assert.equal(recovered.restored, true);
  assert.equal(harness.sheets.Schedules.getRange(1, 1, 1, headers.length).getValues()[0].join('|'), headers.join('|'));
  assert.ok(harness.sheets.Schedules_version_data_20260901000500);
  assert.ok(harness.sheets.Schedules_legacy_backup_20260901000000);
  assert.equal(harness.properties.CURRENT_SCHEDULE_VERSION_ID, undefined);
  assert.equal(harness.properties.SCHEDULE_VERSION_MIGRATION_STATE, undefined);
});

test('interrupted migration with missing active Schedules can be explicitly rolled back', () => {
  const harness = createHarness([
    headers,
    ['2026-09', JSON.stringify(schedule('115/9月', 'legacy')), 1, new Date('2026-09-01T02:00:00.000Z')],
  ], {
    faults: { setName: [{ from: 'Schedules_version_build_20260901000500', to: 'Schedules', code: 'RENAME_FAILED' }] },
  });
  harness.properties.CURRENT_SCHEDULE_VERSION_ID = 'sv_current';

  assert.throws(() => harness.migrate(), { code: 'RENAME_FAILED' });
  assert.equal(harness.sheets.Schedules, undefined);
  assert.ok(harness.sheets.Schedules_legacy_backup_20260901000500);
  assert.ok(harness.sheets.Schedules_legacy_replaced_20260901000500);
  assert.ok(harness.sheets.Schedules_version_build_20260901000500);

  const recovered = harness.rollback('Schedules_legacy_backup_20260901000500');
  assert.equal(recovered.ok, true);
  assert.equal(harness.sheets.Schedules.getRange(1, 1, 1, headers.length).getValues()[0].join('|'), headers.join('|'));
  assert.ok(harness.sheets.Schedules_legacy_backup_20260901000500);
  assert.ok(harness.sheets.Schedules_legacy_replaced_20260901000500);
  assert.ok(harness.sheets.Schedules_version_build_20260901000500);
  assert.equal(harness.properties.CURRENT_SCHEDULE_VERSION_ID, undefined);
  assert.equal(harness.properties.SCHEDULE_VERSION_MIGRATION_STATE, undefined);
});

test('rollback fails closed for unknown state before mutation', () => {
  const backupRows = [
    headers,
    ['2026-09', JSON.stringify(schedule('115/9月', 'backup')), 1, new Date('2026-09-01T02:00:00.000Z')],
  ];
  const harness = createHarness([
    finalHeaders,
    finalVersionRow({ versionId: 'sv_new', monthKey: '2026-09', saveRequestId: 'new' }),
  ], { extraSheets: { Schedules_legacy_backup_20260901000000: backupRows } });
  harness.properties.SCHEDULE_VERSION_MIGRATION_STATE = JSON.stringify({ status: 'unknown', backupSheetName: 'Schedules_legacy_backup_20260901000000' });
  const namesBefore = Object.keys(harness.sheets).sort();

  assert.throws(() => harness.rollback('Schedules_legacy_backup_20260901000000'), { code: 'INVALID_MIGRATION_STATE' });
  assert.deepEqual(Object.keys(harness.sheets).sort(), namesBefore);
});

test('rollback migration state requires status-specific valid sheet names before mutation', () => {
  const backupRows = [
    headers,
    ['2026-09', JSON.stringify(schedule('115/9月', 'backup')), 1, new Date('2026-09-01T02:00:00.000Z')],
  ];
  const finalRows = [
    finalHeaders,
    finalVersionRow({ versionId: 'sv_new', monthKey: '2026-09', saveRequestId: 'new' }),
  ];

  const missingBuildName = createHarness(finalRows, { extraSheets: { Schedules_legacy_backup_20260901000000: backupRows } });
  missingBuildName.properties.SCHEDULE_VERSION_MIGRATION_STATE = JSON.stringify({
    status: 'in_progress',
    backupSheetName: 'Schedules_legacy_backup_20260901000000',
    replacedLegacyName: 'Schedules_legacy_replaced_20260901000000',
    startedAt: '2026-09-01T00:00:00.000Z',
  });
  const missingNamesBefore = Object.keys(missingBuildName.sheets).sort();
  assert.throws(() => missingBuildName.rollback('Schedules_legacy_backup_20260901000000'), { code: 'INVALID_MIGRATION_STATE' });
  assert.deepEqual(Object.keys(missingBuildName.sheets).sort(), missingNamesBefore);
  assert.equal(missingBuildName.sheets.Schedules.getRange(1, 1, 1, finalHeaders.length).getValues()[0].join('|'), finalHeaders.join('|'));

  const missingPreservedName = createHarness(finalRows, { extraSheets: { Schedules_legacy_backup_20260901000000: backupRows } });
  missingPreservedName.properties.SCHEDULE_VERSION_MIGRATION_STATE = JSON.stringify({
    status: 'rollback_in_progress',
    backupSheetName: 'Schedules_legacy_backup_20260901000000',
    startedAt: '2026-09-01T00:00:00.000Z',
  });
  const preservedNamesBefore = Object.keys(missingPreservedName.sheets).sort();
  assert.throws(() => missingPreservedName.rollback('Schedules_legacy_backup_20260901000000'), { code: 'INVALID_MIGRATION_STATE' });
  assert.deepEqual(Object.keys(missingPreservedName.sheets).sort(), preservedNamesBefore);
  assert.equal(missingPreservedName.sheets.Schedules.getRange(1, 1, 1, finalHeaders.length).getValues()[0].join('|'), finalHeaders.join('|'));

  const malformedBackupName = createHarness(finalRows, { extraSheets: { Schedules_legacy_backup_20260901000000: backupRows } });
  malformedBackupName.properties.SCHEDULE_VERSION_MIGRATION_STATE = JSON.stringify({
    status: 'in_progress',
    backupSheetName: 'bad_backup',
    replacedLegacyName: 'Schedules_legacy_replaced_20260901000000',
    buildSheetName: 'Schedules_version_build_20260901000000',
    startedAt: '2026-09-01T00:00:00.000Z',
  });
  assert.throws(() => malformedBackupName.rollback('Schedules_legacy_backup_20260901000000'), { code: 'INVALID_MIGRATION_STATE' });
});

test('pre-cutover interrupted migration rollback clears only state when active legacy is valid and backup is absent', () => {
  const legacyRows = [
    headers,
    ['2026-09', JSON.stringify(schedule('115/9月', 'legacy')), 1, new Date('2026-09-01T02:00:00.000Z')],
  ];
  const harness = createHarness(legacyRows);
  harness.properties.CURRENT_SCHEDULE_VERSION_ID = 'sv_current';
  harness.properties.SCHEDULE_VERSION_MIGRATION_STATE = JSON.stringify({
    status: 'in_progress',
    backupSheetName: 'Schedules_legacy_backup_20260901000000',
    replacedLegacyName: 'Schedules_legacy_replaced_20260901000000',
    buildSheetName: 'Schedules_version_build_20260901000000',
    startedAt: '2026-09-01T00:00:00.000Z',
  });
  const namesBefore = Object.keys(harness.sheets).sort();
  const rowsBefore = harness.rows.map((row) => row.slice());

  const recovered = harness.rollback('Schedules_legacy_backup_20260901000000');

  assert.equal(recovered.ok, true);
  assert.equal(recovered.restored, false);
  assert.equal(recovered.recovered, true);
  assert.deepEqual(Object.keys(harness.sheets).sort(), namesBefore);
  assert.deepEqual(harness.rows, rowsBefore);
  assert.equal(harness.properties.CURRENT_SCHEDULE_VERSION_ID, 'sv_current');
  assert.equal(harness.properties.SCHEDULE_VERSION_MIGRATION_STATE, undefined);
});

test('pre-cutover interrupted migration rollback still fails closed when backup is absent and active sheet is not legacy', () => {
  const finalActive = createHarness([
    finalHeaders,
    finalVersionRow({ versionId: 'sv_new', monthKey: '2026-09', saveRequestId: 'new' }),
  ]);
  finalActive.properties.SCHEDULE_VERSION_MIGRATION_STATE = JSON.stringify({
    status: 'in_progress',
    backupSheetName: 'Schedules_legacy_backup_20260901000000',
    replacedLegacyName: 'Schedules_legacy_replaced_20260901000000',
    buildSheetName: 'Schedules_version_build_20260901000000',
    startedAt: '2026-09-01T00:00:00.000Z',
  });
  const finalNamesBefore = Object.keys(finalActive.sheets).sort();
  assert.throws(() => finalActive.rollback('Schedules_legacy_backup_20260901000000'), { code: 'BACKUP_SHEET_NOT_FOUND' });
  assert.deepEqual(Object.keys(finalActive.sheets).sort(), finalNamesBefore);
  assert.ok(finalActive.properties.SCHEDULE_VERSION_MIGRATION_STATE);

  const missingActive = createHarness([], { includeSchedules: false });
  missingActive.properties.SCHEDULE_VERSION_MIGRATION_STATE = finalActive.properties.SCHEDULE_VERSION_MIGRATION_STATE;
  assert.throws(() => missingActive.rollback('Schedules_legacy_backup_20260901000000'), { code: 'BACKUP_SHEET_NOT_FOUND' });
  assert.deepEqual(Object.keys(missingActive.sheets), []);
  assert.ok(missingActive.properties.SCHEDULE_VERSION_MIGRATION_STATE);
});

test('final history validation rejects duplicate save_request_id and impossible dates/schema versions', () => {
  const duplicate = createHarness([
    finalHeaders,
    finalVersionRow({ versionId: 'sv_one', monthKey: '2026-09', saveRequestId: 'same' }),
    finalVersionRow({ versionId: 'sv_two', monthKey: '2026-09', versionSeq: 2, saveRequestId: 'same' }),
  ]);
  assert.throws(() => duplicate.readFinalRows(), /save_request_id/);

  const invalidVersionDate = createHarness([
    finalHeaders,
    finalVersionRow({ versionId: 'sv_bad_date', monthKey: '2026-09', saveRequestId: 'bad-date', versionDate: '2026-02-31' }),
  ]);
  assert.throws(() => invalidVersionDate.readFinalRows(), /版本日期/);

  const invalidSavedAt = createHarness([
    finalHeaders,
    finalVersionRow({ versionId: 'sv_bad_saved', monthKey: '2026-09', saveRequestId: 'bad-saved', savedAt: 'garbage' }),
  ]);
  assert.throws(() => invalidSavedAt.readFinalRows(), /saved_at/);

  const invalidSchema = createHarness([
    finalHeaders,
    finalVersionRow({ versionId: 'sv_bad_schema', monthKey: '2026-09', saveRequestId: 'bad-schema', schemaVersion: '1abc' }),
  ]);
  assert.throws(() => invalidSchema.readFinalRows(), /schema_version/);

  const migrationSchema = createHarness([
    headers,
    ['2026-09', JSON.stringify(schedule('115/9月', 'legacy')), '1abc', new Date('2026-09-01T02:00:00.000Z')],
  ]);
  assert.throws(() => migrationSchema.migrate(), /schema_version/);
});

test('final history validation rejects broken parent lineage while allowing earlier cross-month parents', () => {
  const validCrossMonth = createHarness([
    finalHeaders,
    finalVersionRow({ versionId: 'sv_aug', monthKey: '2026-08', saveRequestId: 'aug', data: schedule('115/8月', 'aug') }),
    finalVersionRow({ versionId: 'sv_sep', monthKey: '2026-09', saveRequestId: 'sep', parentVersionId: 'sv_aug' }),
  ]);
  assert.equal(JSON.stringify(validCrossMonth.readFinalRows().map((row) => row.versionId)), JSON.stringify(['sv_aug', 'sv_sep']));

  const orphan = createHarness([
    finalHeaders,
    finalVersionRow({ versionId: 'sv_child', monthKey: '2026-09', saveRequestId: 'child', parentVersionId: 'sv_missing' }),
  ]);
  assert.throws(() => orphan.readFinalRows(), { code: 'MALFORMED_VERSION_HISTORY' });

  const forwardParent = createHarness([
    finalHeaders,
    finalVersionRow({ versionId: 'sv_child', monthKey: '2026-09', saveRequestId: 'child', parentVersionId: 'sv_parent' }),
    finalVersionRow({ versionId: 'sv_parent', monthKey: '2026-09', versionSeq: 2, saveRequestId: 'parent', expectedLatestVersionId: 'sv_child' }),
  ]);
  assert.throws(() => forwardParent.readFinalRows(), { code: 'MALFORMED_VERSION_HISTORY' });
});

test('final history validation reconstructs target-month expected latest in row order', () => {
  const valid = createHarness([
    finalHeaders,
    finalVersionRow({ versionId: 'sv_aug_1', monthKey: '2026-08', saveRequestId: 'aug-1', data: schedule('115/8月', 'aug1') }),
    finalVersionRow({ versionId: 'sv_sep_1', monthKey: '2026-09', saveRequestId: 'sep-1' }),
    finalVersionRow({ versionId: 'sv_aug_2', monthKey: '2026-08', versionSeq: 2, saveRequestId: 'aug-2', expectedLatestVersionId: 'sv_aug_1', data: schedule('115/8月', 'aug2') }),
    finalVersionRow({ versionId: 'sv_sep_2', monthKey: '2026-09', versionSeq: 2, saveRequestId: 'sep-2', parentVersionId: 'sv_aug_2', expectedLatestVersionId: 'sv_sep_1' }),
  ]);
  assert.equal(JSON.stringify(valid.readFinalRows().map((row) => row.versionId)), JSON.stringify(['sv_aug_1', 'sv_sep_1', 'sv_aug_2', 'sv_sep_2']));

  const firstRowWithBase = createHarness([
    finalHeaders,
    finalVersionRow({ versionId: 'sv_first', monthKey: '2026-09', saveRequestId: 'first', expectedLatestVersionId: 'sv_other' }),
  ]);
  assert.throws(() => firstRowWithBase.readFinalRows(), { code: 'MALFORMED_VERSION_HISTORY' });

  const missingExpectedLatest = createHarness([
    finalHeaders,
    finalVersionRow({ versionId: 'sv_first', monthKey: '2026-09', saveRequestId: 'first' }),
    finalVersionRow({ versionId: 'sv_second', monthKey: '2026-09', versionSeq: 2, saveRequestId: 'second' }),
  ]);
  assert.throws(() => missingExpectedLatest.readFinalRows(), { code: 'MALFORMED_VERSION_HISTORY' });

  const crossMonthExpectedLatest = createHarness([
    finalHeaders,
    finalVersionRow({ versionId: 'sv_aug', monthKey: '2026-08', saveRequestId: 'aug', data: schedule('115/8月', 'aug') }),
    finalVersionRow({ versionId: 'sv_sep', monthKey: '2026-09', saveRequestId: 'sep', expectedLatestVersionId: 'sv_aug' }),
  ]);
  assert.throws(() => crossMonthExpectedLatest.readFinalRows(), { code: 'MALFORMED_VERSION_HISTORY' });
});

test('version IDs, save request IDs, and saved payloads are bounded before writes', () => {
  const longVersionId = 'sv_' + 'x'.repeat(129);
  const invalidVersion = createHarness([finalHeaders]).post({ secret, action: 'loadVersion', versionId: longVersionId });
  assert.equal(invalidVersion.ok, false);
  assert.equal(invalidVersion.error, 'INVALID_VERSION_ID');

  const longRequest = createHarness([finalHeaders]).post({
    secret,
    action: 'saveVersion',
    monthKey: '2026-09',
    schemaVersion: 1,
    saveRequestId: 'r'.repeat(129),
    data: schedule('115/9月', 'bounded'),
  });
  assert.equal(longRequest.ok, false);
  assert.equal(longRequest.error, 'INVALID_SAVE_REQUEST_ID');

  const acceptedBoundary = createHarness([finalHeaders]).post({
    secret,
    action: 'saveVersion',
    monthKey: '2026-09',
    schemaVersion: 1,
    saveRequestId: 'req-boundary',
    data: scheduleWithCanonicalJsonLength(45000),
  });
  assert.equal(acceptedBoundary.ok, true);

  const oversized = scheduleWithCanonicalJsonLength(45001);
  const oversizedResult = createHarness([finalHeaders]).post({
    secret,
    action: 'saveVersion',
    monthKey: '2026-09',
    schemaVersion: 1,
    saveRequestId: 'req-oversized',
    data: oversized,
  });
  assert.equal(oversizedResult.ok, false);
  assert.equal(oversizedResult.error, 'SCHEDULE_PAYLOAD_TOO_LARGE');
});

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
