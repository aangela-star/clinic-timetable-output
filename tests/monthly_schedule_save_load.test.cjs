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

function septemberRuntime() {
  return { Date: class extends Date { constructor() { super(2026, 8, 6, 12); } } };
}

test('initial month uses browser local September date, never April title or remembered month', () => {
  const runtime = septemberRuntime();
  runtime.localStorage = { getItem: () => '2026-04' };
  assert.equal(core.getInitialMonthKey(runtime, '115/4月'), '2026-09');
});
test('local calendar getters determine the month, not UTC date', () => {
  const runtime = { Date: class { getFullYear() { return 2026; } getMonth() { return 8; }
    toISOString() { return '2026-08-31T16:30:00.000Z'; } } };
  assert.equal(core.getInitialMonthKey(runtime), '2026-09');
});
test('initial month does not access localStorage or parse the initial title', () => {
  const runtime = septemberRuntime();
  Object.defineProperty(runtime, 'localStorage', { get() { throw new Error('storage blocked'); } });
  assert.equal(core.getInitialMonthKey(runtime, '115/4月'), '2026-09');
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

test('front end auto-loads on authenticated App mount and retains manual controls', () => {
  const html = read('index.html');
  assert.match(html, /getInitialMonthKey\(window\)/);
  assert.doesNotMatch(html, /getInitialMonthKey\(window, INITIAL_DATA\.title\)/);
  assert.match(html, /onClick=\{handleLoadSchedule\}/);
  assert.match(html, /onClick=\{handleSaveSchedule\}/);
  assert.match(html, /useEffect\(\(\) => \{\s*handleLoadSchedule\(\);/);
  assert.match(html, /尚無已儲存資料，目前未載入正式門診資料/);
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
  assert.match(html, /<PosterContent ref=\{captureRef\} data=\{renderData\} isForCapture=\{true\} \/>/);
  assert.match(html, /<PosterContent data=\{renderData\} isForCapture=\{false\} \/>/);
});

// Execute the actual non-JSX App load code with minimal hook/transport mocks.
function loadHarness(responses) {
  const vm = require('node:vm');
  const html = read('index.html');
  const body = html.slice(html.indexOf('function App({ onLogout }) {') + 'function App({ onLogout }) {'.length,
    html.indexOf('            const handleSaveSchedule ='));
  const monthInput = html.slice(html.indexOf('type="month"'));
  const monthChange = monthInput.match(/onChange=\{\(e\) => \{([\s\S]*?)\}\}/)[1];
  const states = [], refs = [], effects = [], calls = [];
  let stateIndex = 0, refIndex = 0;
  const seed = { title: '115/4月', note: 'old note', clinics: [{ id: 'clinic-1', name: '晉安', theme: 'teal', changes: ['4/5'], schedule: { '週一': { '早診': '舊醫師' } } }] };
  const context = vm.createContext({
    INITIAL_DATA: seed, ScheduleSaveLoadCore: core,
    window: { ...septemberRuntime(), SCHEDULE_SAVE_LOAD_CONFIG: { webAppUrl: 'https://local.test/api/schedule' } },
    ClinicOrder: { orderClinicsByPriority: clinics => clinics },
    PublishCore: { evaluatePublishSelection: () => ({}), PUBLISH_CHANNELS: [] },
    useState(initial) { const i = stateIndex++; if (!(i in states)) states[i] = typeof initial === 'function' ? initial() : initial; return [states[i], value => { states[i] = value; }]; },
    useRef(initial) { const i = refIndex++; return refs[i] || (refs[i] = { current: initial }); },
    useEffect(fn) { effects.push(fn); },
    fetch: async url => { calls.push(String(url)); const next = responses.shift(); return await next; },
    URL, setTimeout: () => {}, lucide: { createIcons() {} }, console: { error() {} },
  });
  function render() { stateIndex = 0; refIndex = 0; return vm.runInContext(`(function(){${body}; return {handleLoadSchedule, changeMonth: (e) => {${monthChange}}};})()`, context); }
  return { states, effects, calls, seed, render };
}
const savedSeptember = { title: '115/九月', note: '正式存檔備註', clinics: [{ id: 'clinic-1', changes: ['九月已確認異動'], schedule: {} }] };
const responseFor = payload => ({ ok: true, json: async () => payload });
test('mount load applies the saved current-month data instead of April initial data', async () => {
  const h = loadHarness([responseFor({ ok: true, found: true, data: savedSeptember })]);
  h.render();
  assert.equal(h.states[2], '2026-09');
  assert.notEqual(h.states[0].title, '115/4月');
  h.effects[0]();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(h.states[0], savedSeptember);
  assert.equal(new URL(h.calls[0]).searchParams.get('month'), '2026-09');
  assert.equal(h.calls.length, 1);
});
test('missing current month leaves no April facts and never requests April', async () => {
  const h = loadHarness([responseFor({ ok: true, found: false })]); h.render(); h.effects[0]();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.states[0].title, '');
  assert.equal(h.states[0].clinics[0].schedule['週一']['早診'], '');
  assert.equal(h.states[0].clinics[0].changes.length, 0);
  assert.match(h.states[5], /2026-09.*尚無已儲存資料，目前未載入正式門診資料/);
  assert.equal(h.calls.length, 1);
  assert.equal(new URL(h.calls[0]).searchParams.get('month'), '2026-09');
  assert.equal(h.seed.title, '115/4月'); // no mutation of the template
});
test('manual Load still uses the selected month and preserves data on missing response', async () => {
  const h = loadHarness([responseFor({ ok: true, found: true, data: savedSeptember }), responseFor({ ok: true, found: false })]);
  await h.render().handleLoadSchedule();
  h.states[2] = '2026-10'; await h.render().handleLoadSchedule();
  assert.equal(h.states[0], savedSeptember);
  assert.equal(new URL(h.calls[1]).searchParams.get('month'), '2026-10');
  assert.match(h.states[5], /目前畫面未變更/);
});
test('401 remains a failure without fallback or applying a response body', async () => {
  const h = loadHarness([{ ok: false, status: 401, json: async () => { throw new Error('must not apply'); } }]);
  await h.render().handleLoadSchedule();
  assert.match(h.states[5], /HTTP 401/);
  assert.equal(h.states[0].title, '');
  assert.equal(h.calls.length, 1);
});

test('a late initial response cannot overwrite data from a newer manual load', async () => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const h = loadHarness([pending, responseFor({ ok: true, found: true, data: savedSeptember })]);
  const app = h.render();
  const oldLoad = app.handleLoadSchedule();
  await app.handleLoadSchedule();
  release(responseFor({ ok: true, found: true, data: { ...savedSeptember, note: 'stale' } }));
  await oldLoad;
  assert.equal(h.states[0], savedSeptember);
});
test('logout/unmount invalidates the pending automatic load', async () => {
  let release;
  const h = loadHarness([new Promise(resolve => { release = resolve; })]);
  h.render();
  const cleanup = h.effects[0]();
  cleanup();
  release(responseFor({ ok: true, found: true, data: savedSeptember }));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.states[0].title, '');
});
test('logging in again mounts a new current-month load rather than restoring April', async () => {
  for (let login = 0; login < 2; login += 1) {
    const h = loadHarness([responseFor({ ok: true, found: true, data: savedSeptember })]);
    h.render(); h.effects[0](); await new Promise(resolve => setImmediate(resolve));
    assert.equal(h.states[2], '2026-09');
    assert.equal(h.states[0].title, '115/九月');
    assert.equal(h.calls.length, 1);
  }
});
test('an April payload returned for the current month is rejected', async () => {
  const h = loadHarness([responseFor({ ok: true, found: true, data: { ...savedSeptember, title: '115/4月' } })]);
  await h.render().handleLoadSchedule();
  assert.equal(h.states[0].title, '');
  assert.match(h.states[5], /不一致/);
});

test('manual month selection cancels the pending automatic response without auto-loading another month', async () => {
  let release;
  const h = loadHarness([new Promise(resolve => { release = resolve; })]);
  const app = h.render(); h.effects[0]();
  app.changeMonth({ target: { value: '2026-10' } });
  release(responseFor({ ok: true, found: true, data: savedSeptember }));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.states[2], '2026-10');
  assert.equal(h.states[0].title, '');
  assert.equal(h.states[3], false);
  assert.equal(h.calls.length, 1);
});
