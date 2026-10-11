// Explicit opt-in local browser test; not part of the existing Node test glob.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require(process.env.MANUAL_PUBLISH_PLAYWRIGHT || 'playwright');

const root = path.resolve(__dirname, '..');
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
const staticFiles = new Set(['index.html', 'manual-publish.mjs', 'schedule-save-load-core.js', 'clinic-order.js', 'publish-core.js']);
const report = { results: [], screenshots: [], requests: {}, limitations: ['Fonts use local fallback; no external fonts fetched.', 'Authentication is a test-only module response fixture.', 'PNG uses unloaded local timetable, not production data.', 'No external navigation or publishing integration exercised.'] };
let origin;
const server = http.createServer((req, res) => {
  const name = new URL(req.url, origin).pathname.slice(1) || 'index.html';
  if (!staticFiles.has(name)) { res.writeHead(404); res.end(); return; }
  res.setHeader('Content-Type', name.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/javascript; charset=utf-8');
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
    for (const mode of ['load-failure', 'render-failure']) {
      const viewport = { width: 1440, height: 1000 };
      let releaseModule;
      const moduleGate = new Promise(resolve => { releaseModule = resolve; });
      let moduleRequests = 0;
      const context = await browser.newContext({ viewport, deviceScaleFactor: 1, acceptDownloads: true, serviceWorkers: 'block' });
      const api = [], blocked = [], errors = [];
      await context.addInitScript(() => {
        window.manualTestStorageAttempts = [];
        for (const method of ['getItem', 'setItem', 'removeItem', 'clear', 'key']) {
          Storage.prototype[method] = function () {
            window.manualTestStorageAttempts.push({ method, stack: new Error().stack });
            throw new Error('Storage disabled in isolated manual test');
          };
        }
      });
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
          if (mode === 'load-failure') return route.abort('failed');
          return route.fulfill({ contentType: 'application/javascript', body: 'export default function ManualPublishSection() { throw new Error("manual-render-fixture"); }' });
        }
        if (url.pathname === '/auth-config.js') return route.fulfill({ contentType: 'application/javascript', body: '/* No real auth configuration is read. */' });
        if (url.pathname === '/auth-gate.js') return route.fulfill({ contentType: 'application/javascript', body: 'window.AuthGate = { isAuthenticated: () => true, logout: () => {} };' });
        if (url.pathname === '/schedule-api-config.js') return route.fulfill({ contentType: 'application/javascript', body: 'window.SCHEDULE_SAVE_LOAD_CONFIG = { webAppUrl: location.origin + "/api/schedule" };' });
        if (url.pathname.startsWith('/api/')) {
          api.push({ method: request.method(), path: url.pathname, action: url.searchParams.get('action') });
          if (url.pathname === '/api/schedule' && request.method() === 'GET' && url.searchParams.get('action') === 'load') {
            return route.fulfill({ contentType: 'application/json', body: '{"ok":true,"found":false}' });
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
        await page.goto(origin, { waitUntil: 'domcontentloaded' });
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
        assert.deepEqual(api, [{ method: 'GET', path: '/api/schedule', action: 'load' }]);
        assert.deepEqual(await page.evaluate(() => window.manualTestStorageAttempts), storageBefore);
        assert.equal(context.pages().length, 1);
        assert.deepEqual(errors, [], 'boundary contains failure without uncaught page errors');
        report.results.push(mode + ': original input/unsaved edit survives, subsequent editing + preview + real PNG 2160x3840 PASS');
        report.requests[mode] = { mockedApi: api, blocked, runtimeErrors: errors, moduleRequests };
      } catch (error) {
        report.results.push(mode + ': FAIL: ' + error.message);
      } finally { releaseModule(); }
      await context.close();
    }
    assert.ok(report.results.length === 2 && report.results.every(result => result.endsWith('PASS')), report.results.join('\n'));
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
