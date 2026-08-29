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
  assert.match(code, /findMonthRow_\(sheet, monthKey\)/);
});

test('front end keeps load manual and preserves INITIAL_DATA fallback', () => {
  const html = read('index.html');
  assert.match(html, /useState\(INITIAL_DATA\)/);
  assert.match(html, /onClick=\{handleLoadSchedule\}/);
  assert.doesNotMatch(html, /useEffect\([^]*handleLoadSchedule/);
  assert.match(html, /尚無已儲存資料，目前畫面未變更/);
});

test('preview and PNG capture invariants remain present', () => {
  const html = read('index.html');
  assert.match(html, /width: '1080px', height: '1920px'/);
  assert.match(html, /scale: 2, useCORS: true, backgroundColor: "#f8fafc", width: 1080, height: 1920/);
  assert.match(html, /<PosterContent ref=\{captureRef\} data=\{data\} isForCapture=\{true\} \/>/);
  assert.match(html, /<PosterContent data=\{data\} isForCapture=\{false\} \/>/);
});
