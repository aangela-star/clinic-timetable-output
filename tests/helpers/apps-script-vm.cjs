// Shared VM harness for the repository's apps-script/Code.gs.
// Every spreadsheet call that is not an explicitly listed READ is treated as a mutation attempt:
// the trap records it and (unless writes are explicitly allowed for a control case) throws, so a
// write both shows up in the recording and fails loudly instead of passing silently.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const code = fs.readFileSync(path.resolve(__dirname, '..', '..', 'apps-script', 'Code.gs'), 'utf8');
const HEADERS = ['month_key', 'data_json', 'schema_version', 'updated_at'];
const secret = 'test-only-server-secret';

function schedule(title, note) {
  return { title, note, clinics: [{ schedule: {}, changes: [] }] };
}

// Anything that is not an explicitly listed READ is treated as a mutation attempt.
const READS = {
  Spreadsheet: ['getSheetByName', 'getName', 'getId', 'getSheets'],
  Sheet: ['getLastRow', 'getLastColumn', 'getRange', 'getName', 'getMaxRows'],
  Range: ['getValues', 'getValue', 'getDisplayValues', 'getDisplayValue', 'getA1Notation'],
};

function trap(kind, impl, record, { allowWrites = false } = {}) {
  return new Proxy({}, {
    get(_target, prop) {
      if (typeof prop !== 'string') return undefined;
      if (READS[kind].includes(prop)) return impl[prop];
      return (...args) => {
        record.push(`${kind}.${prop}`);
        if (allowWrites && typeof impl[prop] === 'function') return impl[prop](...args);
        if (allowWrites) return undefined;
        throw new Error(`BLOCKED_MUTATION ${kind}.${prop}`);
      };
    },
  });
}

// sheetState: 'populated' | 'empty' | 'missing'
function createHarness(initialRows, {
  sheetState = 'populated', displayMonths = {}, allowWrites = false, source = code,
} = {}) {
  const rows = initialRows.map((row) => row.slice());
  const record = [];
  const reads = [];

  const rawSheet = {
    getLastRow() { reads.push('getLastRow'); return sheetState === 'empty' ? 0 : rows.length; },
    getRange(row, column, rowCount = 1, columnCount = 1) {
      reads.push(`getRange(${row},${column},${rowCount},${columnCount})`);
      const slice = () => rows.slice(row - 1, row - 1 + rowCount)
        .map((s) => s.slice(column - 1, column - 1 + columnCount));
      const rawRange = {
        getValues: () => slice(),
        getDisplayValues: () => rows.slice(row - 1, row - 1 + rowCount).map((s, offset) =>
          s.slice(column - 1, column - 1 + columnCount).map((value, c) =>
            (column + c === 1 && Object.hasOwn(displayMonths, row + offset)
              ? displayMonths[row + offset] : String(value)))),
        setValues(values) {
          for (let r = 0; r < rowCount; r += 1) {
            if (!rows[row - 1 + r]) rows[row - 1 + r] = [];
            for (let c = 0; c < columnCount; c += 1) rows[row - 1 + r][column - 1 + c] = values[r][c];
          }
          return rawRange;
        },
        setNumberFormat() { return rawRange; },
      };
      return trap('Range', rawRange, record, { allowWrites });
    },
    deleteRow(row) { rows.splice(row - 1, 1); },
    setFrozenRows() {},
  };
  const sheet = trap('Sheet', rawSheet, record, { allowWrites });

  const rawSpreadsheet = {
    getSheetByName(name) {
      reads.push(`getSheetByName(${name})`);
      return name === 'Schedules' && sheetState !== 'missing' ? sheet : null;
    },
    insertSheet() { return sheet; },
  };

  const lockCalls = [];
  const context = vm.createContext({
    Date, JSON, isNaN, String, Number, Error, Object, Array,
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => secret }) },
    LockService: {
      getScriptLock: () => {
        lockCalls.push('getScriptLock');
        return { tryLock: () => true, hasLock: () => true, releaseLock: () => {} };
      },
    },
    SpreadsheetApp: {
      getActiveSpreadsheet: () => trap('Spreadsheet', rawSpreadsheet, record, { allowWrites }),
      flush: () => { record.push('SpreadsheetApp.flush'); if (!allowWrites) throw new Error('BLOCKED_MUTATION flush'); },
    },
    Utilities: { formatDate: (value) => `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}` },
    Session: { getScriptTimeZone: () => 'Asia/Taipei' },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: (text) => ({ text, setMimeType() { return this; } }),
    },
  });
  vm.runInContext(`${source}\n;globalThis.__doPost = doPost;`, context);

  return {
    rows, record, reads, lockCalls,
    post(body) {
      return JSON.parse(context.__doPost({ postData: { contents: JSON.stringify(body) } }).text);
    },
  };
}


module.exports = { code, HEADERS, secret, schedule, createHarness };
