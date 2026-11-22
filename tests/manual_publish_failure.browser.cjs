// Explicit opt-in local browser test; not part of the existing Node test glob.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require(process.env.MANUAL_PUBLISH_PLAYWRIGHT || 'playwright');

const root = path.resolve(__dirname, '..');
// The recorded /api/* traffic must be: at most one editor-mode probe (index.html's React shell
// fetches it, legacy.html does not), exactly ONE schedule GET, and nothing else -- no POST on any
// /api route, so no publish, no upload and no cloud save can hide in here.
// `expectedAction` is asserted EXACTLY, per page: legacy.html still puts `action=load` in its
// query string (the proxy ignores the client action and always chooses the read-only Apps Script
// action server-side), while the calendar editor sends `action=loadReadOnly`.
function assertReadOnlyApi(api, label, expectedAction) {
  const other = api.filter((c) => c.path !== '/api/schedule' && c.path !== '/api/editor-mode');
  assert.deepEqual(other, [], label + ': unexpected /api traffic');
  assert.deepEqual(api.filter((c) => c.method !== 'GET'), [],
    label + ': no non-GET API call is permitted (no publish, upload or cloud save)');
  const schedule = api.filter((c) => c.path === '/api/schedule');
  assert.equal(schedule.length, 1, label + ': expected exactly one schedule request, got ' + JSON.stringify(api));
  assert.equal(schedule[0].action, expectedAction,
    label + ': the schedule GET must use ' + expectedAction + ', got ' + schedule[0].action);
}

const evidence = process.env.MANUAL_PUBLISH_EVIDENCE || '/private/tmp/clinic-manual-publish-evidence';
const deps = process.env.MANUAL_PUBLISH_DEPS || path.join(evidence, 'dependencies');
const cdn = new Map([
  ['https://unpkg.com/react@18.3.1/umd/react.production.min.js', 'react.js'],
  ['https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js', 'react-dom.js'],
  ['https://unpkg.com/@babel/standalone@8.0.4/babel.min.js', 'babel.js'],
  ['https://cdn.tailwindcss.com/3.4.17', 'tailwind.js'],
  ['https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js', 'html2canvas.js'],
  ['https://unpkg.com/lucide@1.33.0/dist/umd/lucide.min.js', 'lucide.js']
]);
// legacy.html is the page whose controls these assertions describe (年份月份, 下載高清 PNG 海報);
// index.html is the calendar editor, which reaches the same manual-publish module through a
// dynamic import and has its own failure fallback. Both are served; everything else is blocked.
const legacyAssets = ['legacy.html', 'schedule-save-load-core.js', 'clinic-order.js', 'publish-core.js'];
const calendarAssets = ['index.html', 'calendar.css', 'calendar-assets.js', 'schedule-core.js',
  'timetable-model.js', 'calendar-layout.js', 'timetable-poster.js', 'timetable-view.js',
  'calendar-draft.js', 'calendar-meta.js', 'calendar-template.js', 'calendar-editor.js'];
const staticFiles = new Set(['manual-publish.mjs', ...legacyAssets, ...calendarAssets]);
const report = { results: [], screenshots: [], requests: {}, limitations: ['Fonts use local fallback; no external fonts fetched.', 'Authentication is a test-only module response fixture.', 'PNG uses unloaded local timetable, not production data.', 'No external navigation or publishing integration exercised.'] };
let origin;
const server = http.createServer((req, res) => {
  const name = new URL(req.url, origin).pathname.slice(1) || 'index.html';
  if (!staticFiles.has(name)) { res.writeHead(404); res.end(); return; }
  res.setHeader('Content-Type', name.endsWith('.html') ? 'text/html; charset=utf-8' : name.endsWith('.css') ? 'text/css; charset=utf-8' : name.endsWith('.json') ? 'application/json; charset=utf-8' : 'application/javascript; charset=utf-8');
  res.end(fs.readFileSync(path.join(root, name)));
});

(async () => {
  fs.mkdirSync(evidence, { recursive: true });
  for (const filename of cdn.values()) assert.ok(fs.statSync(path.join(deps, filename)).size > 1000, 'Missing dependency: ' + filename);
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  origin = 'http://127.0.0.1:' + server.address().port;
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    // The first two are the original legacy-editor failure coverage, now naming its page
    // explicitly. The third is NEW coverage of the SAME dynamic-import failure boundary inside the
    // current calendar editor (index.html), added rather than swapped.
    const profiles = [
      { mode: 'load-failure', page: '/legacy.html', action: 'load', storage: 'blocked', kind: 'legacy' },
      { mode: 'render-failure', page: '/legacy.html', action: 'load', storage: 'blocked', kind: 'legacy' },
      { mode: 'calendar-load-failure', page: '/index.html', action: 'loadReadOnly', storage: 'recorded', kind: 'calendar' },
    ];
    for (const profile of profiles) {
      const mode = profile.mode;
      const viewport = { width: 1440, height: 1000 };
      let releaseModule;
      const moduleGate = new Promise(resolve => { releaseModule = resolve; });
      let moduleRequests = 0;
      const context = await browser.newContext({ viewport, deviceScaleFactor: 1, acceptDownloads: true, serviceWorkers: 'block' });
      const api = [], blocked = [], errors = [];
      if (profile.storage === 'blocked') {
        await context.addInitScript(() => {
          window.manualTestStorageAttempts = [];
          for (const method of ['getItem', 'setItem', 'removeItem', 'clear', 'key']) {
            Storage.prototype[method] = function () {
              window.manualTestStorageAttempts.push({ method, stack: new Error().stack });
              throw new Error('Storage disabled in isolated manual test');
            };
          }
        });
      } else {
        // The calendar editor cannot run without its own local draft storage, so storage is
        // RECORDED and allowed here, with the key kept so the assertions can still prove nothing
        // outside clinic-timetable.* is written.
        await context.addInitScript(() => {
          window.manualTestStorageAttempts = [];
          for (const method of ['getItem', 'setItem', 'removeItem', 'clear', 'key']) {
            const real = Storage.prototype[method];
            Storage.prototype[method] = function (...args) {
              window.manualTestStorageAttempts.push({ method, key: args[0], stack: new Error().stack });
              return real.apply(this, args);
            };
          }
        });
        // Deterministic "current month": the calendar editor derives its boot month from the
        // device clock. Timers stay real so the startup read's 15 s abort can still fire.
        await context.addInitScript(() => {
          const FIXED = 1795000000000; // 2026-11-22T08:26:40.000Z
          const RealDate = Date;
          function FixedDate(...args) {
            return args.length ? new RealDate(...args) : new RealDate(FIXED);
          }
          FixedDate.prototype = RealDate.prototype;
          FixedDate.now = () => FIXED;
          FixedDate.parse = RealDate.parse;
          FixedDate.UTC = RealDate.UTC;
          window.Date = FixedDate;
        });
      }
      await context.route('**/*', async route => {
        const request = route.request();
        const url = new URL(request.url());
        if (cdn.has(request.url()) && request.method() === 'GET') {
          return route.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(path.join(deps, cdn.get(request.url()))) });
        }
        if (url.origin !== origin) { blocked.push(request.url()); return route.abort(); }
        if (url.pathname === '/manual-publish.mjs') {
          moduleRequests++;
          await moduleGate;
          if (mode === 'load-failure' || mode === 'calendar-load-failure') return route.abort('failed');
          return route.fulfill({ contentType: 'application/javascript', body: 'export default function ManualPublishSection() { throw new Error("manual-render-fixture"); }' });
        }
        if (url.pathname === '/auth-config.js') return route.fulfill({ contentType: 'application/javascript', body: '/* No real auth configuration is read. */' });
        if (url.pathname === '/auth-gate.js') return route.fulfill({ contentType: 'application/javascript', body: 'window.AuthGate = { isAuthenticated: () => true, logout: () => {} };' });
        if (url.pathname === '/schedule-api-config.js') return route.fulfill({ contentType: 'application/javascript', body: 'window.SCHEDULE_SAVE_LOAD_CONFIG = { webAppUrl: location.origin + "/api/schedule" };' });
        if (url.pathname.startsWith('/api/')) {
          const action = url.searchParams.get('action');
          api.push({ method: request.method(), path: url.pathname, action, month: url.searchParams.get('month') });
          // Mirrors the real proxy: a GET is answered on the read-only Apps Script path, and a
          // read-only answer carries readOnly:true (api/schedule.js fails closed without it).
          if (url.pathname === '/api/schedule' && request.method() === 'GET'
            && action === profile.action) {
            // Mirrors the real proxy: a GET is answered on the read-only Apps Script path, and a
            // read-only answer carries readOnly:true (api/schedule.js fails closed without it).
            const month = url.searchParams.get('month');
            return route.fulfill({ contentType: 'application/json',
              body: action === 'loadReadOnly'
                ? JSON.stringify({ ok: true, found: false, readOnly: true, month, storage: 'MONTH_MISSING' })
                : '{"ok":true,"found":false}' });
          }
          // index.html's shell probes this before mounting the editor; answering it keeps the
          // recorded traffic honest instead of leaving an aborted request in the list.
          if (url.pathname === '/api/editor-mode' && request.method() === 'GET') {
            return route.fulfill({ contentType: 'application/json', body: '{"preview":false}' });
          }
          return route.abort();
        }
        if (request.method() !== 'GET' || !staticFiles.has(url.pathname.slice(1) || 'index.html')) { blocked.push(request.url()); return route.abort(); }
        return route.continue();
      });
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message));
      page.setDefaultTimeout(5000);
      try {
        if (profile.kind === 'calendar') {
          // The calendar editor reaches manual-publish.mjs through a dynamic import and catches a
          // failed import itself (no React error boundary involved). The rest of the editor must
          // keep working: unsaved input survives, the preview still renders, the real PNG export
          // still produces a 2160 x 3840 file, and nothing is published or uploaded.
          await page.goto(origin + profile.page, { waitUntil: 'domcontentloaded' });
          // 新增醫師姓名 lives in a collapsed <details>; open it the way an operator would.
          await page.locator('summary').filter({ hasText: '醫師設定' }).click();
          const nameInput = page.locator('#new-doctor-name');
          await nameInput.waitFor();
          await nameInput.fill('測試未儲存輸入');
          const originalInput = await nameInput.elementHandle();
          const storageBefore = await page.evaluate(() => window.manualTestStorageAttempts);
          releaseModule();
          const fallback = page.locator('#manual-publish');
          await fallback.filter({ hasText: '手動發布說明暫時無法載入' }).waitFor();
          const fallbackText = await fallback.textContent();
          assert.match(fallbackText, /請重新開啟或使用舊版入口/);
          assert.match(fallbackText, /尚未發布/, 'the fallback must say nothing was published');
          assert.equal(await originalInput.evaluate((el) => el.isConnected), true,
            'the editor input survives, no remount');
          assert.equal(await nameInput.inputValue(), '測試未儲存輸入', 'unsaved input survives');
          // Still editable afterwards, and the draft-state warning still tracks it.
          await nameInput.fill('失敗後仍可編輯');
          assert.equal(await nameInput.inputValue(), '失敗後仍可編輯');
          assert.match(await page.locator('#draft-state').textContent(), /尚未儲存/);
          assert.ok((await page.locator('#clinics').innerHTML()).includes('<svg'), 'the preview still renders');
          await fallback.scrollIntoViewIfNeeded();
          const shot = path.join(evidence, mode + '-fallback.png');
          await page.screenshot({ path: shot, fullPage: true });
          report.screenshots.push(shot);
          // The calendar editor deliberately refuses to export while there is unsaved input
          // (guardSwitch), so the operator path after a failed manual-publish import is: save the
          // local draft, then export. Both must still work with the manual section broken.
          await page.locator('#save-all').click();
          assert.match(await page.locator('#status').textContent(), /已儲存全部目前輸入/);
          assert.match(await page.locator('#draft-state').textContent(), /目前沒有未儲存輸入/);
          // The roster is re-rendered from the saved draft; names live in input VALUES, so read
          // them rather than the markup.
          const rosterNames = await page.locator('#doctor-settings input[maxlength="20"]')
            .evaluateAll((inputs) => inputs.map((input) => input.value));
          assert.ok(rosterNames.includes('失敗後仍可編輯'),
            'the saved edit must be re-rendered after the failure: ' + JSON.stringify(rosterNames));
          // The real export rasterises a 2160 x 3840 canvas and waits on document.fonts; that is
          // slower than this suite's 5 s default timeout.
          const downloadPromise = page.waitForEvent('download', { timeout: 120000 });
          await page.getByRole('button', { name: '下載高清 PNG', exact: true }).click({ timeout: 30000 });
          const download = await downloadPromise;
          assert.match(download.suggestedFilename(), /2026-11/);
          const pngPath = path.join(evidence, mode + '-png.png');
          await download.saveAs(pngPath);
          const png = fs.readFileSync(pngPath);
          assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
          assert.equal(png.readUInt32BE(16), 2160);
          assert.equal(png.readUInt32BE(20), 3840);
          assert.equal(moduleRequests, 1);
          assertReadOnlyApi(api, mode + ' traffic after the run', profile.action);
          const storageAfter = await page.evaluate(() => window.manualTestStorageAttempts);
          assert.deepEqual(storageAfter
            .filter((a) => a.method !== 'getItem' && a.method !== 'key')
            .filter((a) => !/^clinic-timetable\./.test(a.key || ''))
            .map((a) => ({ method: a.method, key: a.key })),
          [], 'no key outside clinic-timetable.* may be written or removed');
          assert.ok(storageAfter.length >= storageBefore.length);
          assert.equal(context.pages().length, 1);
          assert.deepEqual(errors, [], 'the import failure must not surface as an uncaught page error');
          report.results.push(mode + ': calendar editor contains the failed manual-publish import, '
            + 'input/unsaved edit survives, preview + real PNG 2160x3840 PASS');
        } else {
          await page.goto(origin + profile.page, { waitUntil: 'domcontentloaded' });
          const title = page.locator('section').filter({ has: page.getByText('年份月份', { exact: true }) }).locator('input');
          await title.fill('2099/01 未儲存測試');
          const originalInput = await title.elementHandle();
          await page.getByText('正在載入手動發布說明…', { exact: true }).waitFor();
          const storageBefore = await page.evaluate(() => window.manualTestStorageAttempts);
          releaseModule();
          const fallback = page.getByRole('status').filter({ hasText: '手動發布說明暫時無法使用' });
          try { await fallback.waitFor(); } catch (error) {
            const screenshot = path.join(evidence, mode + '-red.png');
            await page.screenshot({ path: screenshot, fullPage: true });
            report.screenshots.push(screenshot);
            throw new Error(mode + ': fallback missing; original input connected=' + await originalInput.evaluate(el => el.isConnected) + '; runtime errors=' + JSON.stringify(errors));
          }
          assert.match(await fallback.textContent(), /既有編輯、預覽與 PNG 下載不受影響/);
          assert.match(await fallback.textContent(), /未進行任何發布/);
          assert.equal(await originalInput.evaluate(el => el.isConnected), true, 'original editor input survives, no remount');
          assert.equal(await title.inputValue(), '2099/01 未儲存測試', 'unsaved input survives');
          await title.fill('2099/02 失敗後仍可編輯');
          const preview = page.locator('main').filter({ hasText: '2099/02 失敗後仍可編輯' });
          assert.equal(await preview.count(), 2, 'capture and visible preview update');
          assert.equal(await preview.last().isVisible(), true);
          await fallback.scrollIntoViewIfNeeded();
          const screenshot = path.join(evidence, mode + '-fallback.png');
          await page.screenshot({ path: screenshot, fullPage: true });
          report.screenshots.push(screenshot);
          const downloadPromise = page.waitForEvent('download');
          await page.getByRole('button', { name: '下載高清 PNG 海報', exact: true }).click();
          const download = await downloadPromise;
          assert.match(download.suggestedFilename(), /2099-02 失敗後仍可編輯/);
          const pngPath = path.join(evidence, mode + '-png.png');
          await download.saveAs(pngPath);
          const png = fs.readFileSync(pngPath);
          assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
          assert.equal(png.readUInt32BE(16), 2160);
          assert.equal(png.readUInt32BE(20), 3840);
          assert.equal(moduleRequests, 1);
          assertReadOnlyApi(api, mode + ' traffic after the run', profile.action);
          assert.deepEqual(await page.evaluate(() => window.manualTestStorageAttempts), storageBefore);
          assert.equal(context.pages().length, 1);
          assert.deepEqual(errors, [], 'boundary contains failure without uncaught page errors');
          report.results.push(mode + ': original input/unsaved edit survives, subsequent editing + preview + real PNG 2160x3840 PASS');
        }
        report.requests[mode] = { mockedApi: api, blocked, runtimeErrors: errors, moduleRequests };
      } catch (error) {
        report.results.push(mode + ': FAIL: ' + error.message);
      } finally { releaseModule(); }
      await context.close();
    }
    assert.ok(report.results.length === profiles.length && report.results.every(result => result.endsWith('PASS')), report.results.join('\n'));
    report.status = 'PASS';
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
    report.serverStopped = !server.listening;
    fs.writeFileSync(path.join(evidence, 'failure-browser-report.json'), JSON.stringify(report, null, 2) + '\n');
  }
  console.log(JSON.stringify(report, null, 2));
})().catch(error => {
  report.status = 'BLOCKED_OR_FAILED';
  report.error = error.message;
  report.serverStopped = !server.listening;
  fs.mkdirSync(evidence, { recursive: true });
  fs.writeFileSync(path.join(evidence, 'failure-browser-report.json'), JSON.stringify(report, null, 2) + '\n');
  console.error(error);
  process.exitCode = 1;
  if (server.listening) server.close();
});
