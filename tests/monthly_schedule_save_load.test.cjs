const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const core = require('../schedule-save-load-core.js');
const repoRoot = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test('accepts only YYYY-MM month keys', () => {
  assert.equal(core.isValidMonthKey('2026-08'), true);
  assert.equal(core.isValidMonthKey('2026-8'), false);
  assert.equal(core.isValidMonthKey('2026-13'), false);
  assert.equal(core.isValidMonthKey('115-08'), false);
});

test('infers Gregorian month key from ROC and Gregorian titles', () => {
  assert.equal(core.inferMonthKeyFromTitle('115/4月'), '2026-04');
  assert.equal(core.inferMonthKeyFromTitle('115年12月'), '2026-12');
  assert.equal(core.inferMonthKeyFromTitle('2026/8月'), '2026-08');
  assert.equal(core.inferMonthKeyFromTitle('2026-08'), '2026-08');
});

test('blocks an obvious month/title mismatch', () => {
  const mismatch = core.getMonthTitleMismatch('2026-08', '115/4月');
  assert.equal(mismatch.code, 'MONTH_TITLE_MISMATCH');
  assert.match(mismatch.message, /已停止儲存/);
});

test('does not invent a mismatch for an unparseable title', () => {
  assert.equal(core.getMonthTitleMismatch('2026-08', '八月份門診'), null);
});

test('validates the minimal existing schedule data shape', () => {
  assert.equal(core.isValidScheduleData({ title: '115/8月', note: '', clinics: [{}] }), true);
  assert.equal(core.isValidScheduleData({ title: '115/8月', note: '', clinics: [] }), false);
});

test('valid stored month takes priority over the title-derived fallback', () => {
  const runtime = {
    localStorage: {
      getItem: (key) => {
        assert.equal(key, 'clinic-timetable.last-schedule-month');
        return '2026-08';
      },
    },
  };

  assert.equal(core.getInitialMonthKey(runtime, '115/4月'), '2026-08');
});

test('missing or invalid stored month falls back to the title', () => {
  assert.equal(core.getInitialMonthKey({ localStorage: { getItem: () => null } }, '115/4月'), '2026-04');
  assert.equal(core.getInitialMonthKey({ localStorage: { getItem: () => '2026-99' } }, '115/4月'), '2026-04');
});

test('localStorage read failure safely falls back to the title', () => {
  const runtime = {};
  Object.defineProperty(runtime, 'localStorage', {
    get() { throw new Error('storage blocked'); },
  });

  assert.doesNotThrow(() => core.getInitialMonthKey(runtime, '115/4月'));
  assert.equal(core.getInitialMonthKey(runtime, '115/4月'), '2026-04');
});

test('localStorage write failure does not crash', () => {
  const runtime = {
    localStorage: {
      setItem() { throw new Error('quota exceeded'); },
    },
  };

  assert.doesNotThrow(() => core.rememberLastScheduleMonth(runtime, '2026-08'));
  assert.equal(core.rememberLastScheduleMonth(runtime, '2026-08'), false);
});

test('invalid month is never written to localStorage', () => {
  const writes = [];
  const runtime = { localStorage: { setItem: (...args) => writes.push(args) } };

  assert.equal(core.rememberLastScheduleMonth(runtime, '2026-8'), false);
  assert.deepEqual(writes, []);
});

test('only successful found loads remember the month', () => {
  const writes = [];
  const runtime = { localStorage: { setItem: (...args) => writes.push(args) } };

  assert.equal(core.rememberLoadedMonth(runtime, '2026-08', { ok: false, found: true }), false);
  assert.equal(core.rememberLoadedMonth(runtime, '2026-08', { ok: true, found: false }), false);
  assert.equal(writes.length, 0);
  assert.equal(core.rememberLoadedMonth(runtime, '2026-08', { ok: true, found: true }), true);
  assert.deepEqual(writes, [['clinic-timetable.last-schedule-month', '2026-08']]);
});

test('only successful saves remember the month', () => {
  const writes = [];
  const runtime = { localStorage: { setItem: (...args) => writes.push(args) } };

  assert.equal(core.rememberSavedMonth(runtime, '2026-08', { ok: false }), false);
  assert.equal(writes.length, 0);
  assert.equal(core.rememberSavedMonth(runtime, '2026-08', { ok: true }), true);
  assert.deepEqual(writes, [['clinic-timetable.last-schedule-month', '2026-08']]);
});

test('Apps Script save uses ScriptLock and releases it', () => {
  const code = read('apps-script/Code.gs');
  assert.match(code, /LockService\.getScriptLock\(\)/);
  assert.match(code, /tryLock\(10000\)/);
  assert.match(code, /finally\s*\{/);
  assert.match(code, /releaseLock\(\)/);
});

test('Apps Script schema stays minimal and keyed by month_key', () => {
  const code = read('apps-script/Code.gs');
  assert.match(code, /\['month_key', 'data_json', 'schema_version', 'updated_at'\]/);
  assert.match(code, /findMonthRows_\(sheet, monthKey\)/);
});

test('Apps Script normalizes legacy date month cells and forces new month keys to text', () => {
  const code = read('apps-script/Code.gs');
  assert.match(code, /function monthCellToKey_\(value\)/);
  assert.match(code, /value instanceof Date/);
  assert.match(code, /Utilities\.formatDate\(/);
  assert.match(code, /function findMonthRows_\(sheet, monthKey\)/);
  assert.match(code, /setNumberFormat\('@'\)/);
  assert.match(code, /deleteRow\(rows\[i\]\)/);
  assert.doesNotMatch(code, /appendRow\(values\)/);
});

test('Apps Script rejects direct GET access and requires server secret for POST', () => {
  const code = read('apps-script/Code.gs');
  assert.match(code, /function doGet\(\)/);
  assert.match(code, /METHOD_NOT_ALLOWED/);
  assert.match(code, /assertServerSecret_\(body\.secret\)/);
  assert.match(code, /getProperty\(SERVER_SECRET_PROPERTY\)/);
});

test('Vercel proxy requires signed session and keeps server secret out of browser config', () => {
  const proxy = read('api/schedule.js');
  const session = read('lib/server-session.js');
  const config = read('schedule-api-config.js');
  assert.match(proxy, /hasValidSession\(req\)/);
  assert.match(proxy, /secret: getServerSecret\(\)/);
  assert.match(session, /HttpOnly; Secure; SameSite=Strict/);
  assert.match(config, /window\.location\.origin \+ "\/api\/schedule"/);
  assert.doesNotMatch(config, /CLINIC_SERVER_SECRET/);
  assert.equal(fs.existsSync(path.join(repoRoot, 'api/_session.js')), false);
});

test('shared-password login establishes a server session before marking browser authenticated', () => {
  const authGate = read('auth-gate.js');
  assert.match(authGate, /fetch\("\/api\/auth"/);
  assert.match(authGate, /serverAuthenticated = await establishServerSession\(password\)/);
  assert.match(authGate, /storage\.setItem\(SESSION_KEY, "1"\)/);
});

test('front end keeps load manual and preserves INITIAL_DATA fallback', () => {
  const html = read('index.html');
  assert.match(html, /useState\(INITIAL_DATA\)/);
  assert.match(html, /getInitialMonthKey\(window, INITIAL_DATA\.title\)/);
  assert.match(html, /onClick=\{handleLoadSchedule\}/);
  assert.doesNotMatch(html, /useEffect\([^]*handleLoadSchedule/);
  assert.doesNotMatch(html, /useState\([^]*handleLoadSchedule\(/);
  assert.match(html, /尚無已儲存資料，目前畫面未變更/);
});

test('front end remembers month only after successful load or save responses', () => {
  const html = read('index.html');
  assert.match(html, /if \(!payload\.found\)[^]*return;[^]*setData\(payload\.data\);[^]*rememberLoadedMonth\(window, monthKey, payload\)/);
  assert.match(html, /if \(!payload\.ok\) throw[^]*rememberSavedMonth\(window, monthKey, payload\)/);
});

test('preview and PNG capture invariants remain present', () => {
  const html = read('index.html');
  assert.match(html, /width: '1080px', height: '1920px'/);
  assert.match(html, /scale: 2, useCORS: true, backgroundColor: "#f8fafc", width: 1080, height: 1920/);
  assert.match(html, /<PosterContent ref=\{captureRef\} data=\{data\} isForCapture=\{true\} \/>/);
  assert.match(html, /<PosterContent data=\{data\} isForCapture=\{false\} \/>/);
});
