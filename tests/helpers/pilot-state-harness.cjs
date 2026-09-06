const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const source = ['Code.gs', 'PilotState.gs'].map(file => fs.readFileSync(path.join(__dirname, '../../apps-script', file), 'utf8')).join('\n');
function pilotHarness() {
  const props = { CLINIC_SERVER_SECRET: 'mock-secret', JINAN_PILOT_STATE_ENABLED: 'true' };
  const rows = [];
  let hasSheet = false;
  const control = { locked: false, failWrite: false };
  const sheet = { getLastRow: () => rows.length, getRange: (r, c, nr = 1, nc = 1) => ({
    setNumberFormat() { return this; },
    getValues() { return rows.slice(r - 1, r - 1 + nr).map(row => row.slice(c - 1, c - 1 + nc)); },
    setValues(values) { if (control.failWrite) throw new Error('write failure'); values.forEach((row, i) => { rows[r - 1 + i] = row.slice(); }); return this; },
  }) };
  const ss = { getSheetByName: () => hasSheet ? sheet : null, insertSheet: () => { hasSheet = true; return sheet; } };
  return { props, rows, control, request: async body => {
    // A fresh Apps Script runtime on every request; only service state survives.
    const context = vm.createContext({
      PropertiesService: { getScriptProperties: () => ({ getProperty: key => props[key] || null, setProperty: (key, value) => { props[key] = value; } }) },
      LockService: { getScriptLock: () => ({ tryLock: () => { if (control.locked) return false; control.locked = true; return true; }, releaseLock: () => { control.locked = false; } }) },
      SpreadsheetApp: { getActiveSpreadsheet: () => ss, flush() {} },
      Utilities: { DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
        computeDigest: (algorithm, data) => Array.from(crypto.createHash('sha256').update(data).digest()),
        base64Encode: data => Buffer.from(data).toString('base64'), base64Decode: data => Buffer.from(data, 'base64'),
        newBlob: data => ({ getDataAsString: () => Buffer.from(data).toString('utf8') }) },
      ContentService: { MimeType: { JSON: 'json' }, createTextOutput: text => ({ setMimeType: () => JSON.parse(text) }) },
    });
    vm.runInContext(source, context);
    return context.doPost({ postData: { contents: JSON.stringify(body) } });
  } };
}
module.exports = { pilotHarness };
