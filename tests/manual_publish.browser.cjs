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
const imageFiles = fs.readdirSync(path.join(root, 'docs/assets/website-guide')).filter(f => f.endsWith('.png')).map(f => 'docs/assets/website-guide/' + f);
imageFiles.forEach(f => staticFiles.add(f));
staticFiles.add('docs/官網門診表操作手冊.html');
const yianOnly = process.env.MANUAL_PUBLISH_YIAN_ONLY === '1';
const labels = ['晉安官網後台', '毅安官網後台', '晉安 FB 粉專', '毅安 FB 粉專', 'FarBar 院內顯示'];
const report = { results: [], screenshots: [], requests: {}, limitations: ['Fonts use local fallback; no external fonts fetched.', 'Authentication is a test-only module response fixture.', 'PNG uses unloaded local timetable, not production data.', 'No external navigation or publishing integration exercised.'] };
let origin;
const server = http.createServer((req, res) => {
  const name = decodeURIComponent(new URL(req.url, origin).pathname).slice(1) || 'index.html';
  if (!staticFiles.has(name)) { res.writeHead(404); res.end(); return; }
  res.setHeader('Content-Type', name.endsWith('.png') ? 'image/png' : name.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/javascript; charset=utf-8');
  res.end(fs.readFileSync(path.join(root, name)));
});

async function checkSection(page, context, mode, api, blocked) {
  const section = page.getByRole('region', { name: '手動發布', exact: true });
  await section.waitFor();
  assert.deepEqual(await section.locator('h3').allTextContents(), labels);
  assert.equal(await section.getByText('開啟連結不代表已發布。完成操作後，請到公開頁面或實際顯示確認。', { exact: true }).count(), 1);
  assert.equal(await section.locator('button:disabled').count(), 0);
  assert.equal(await section.locator('article > a').count(), 5);
  const links = await section.locator('a').evaluateAll(elements => elements.map(a => ({ href: a.href, target: a.target, rel: a.rel })));
  assert.equal(links.filter(link => link.href.startsWith(origin)).length, 6, 'five local image enlargements and offline manual');
  assert.deepEqual(links.filter(link => !link.href.startsWith(origin)), [
    { href: 'https://www.tainanrehab.com/admin/index.php?op=time&sub=set', target: '_blank', rel: 'noopener noreferrer' },
    { href: 'https://www.tainanrehab.com/time.html', target: '_blank', rel: 'noopener noreferrer' },
    { href: 'https://www.ian-tainan.com/admin/login.php', target: '_blank', rel: 'noopener noreferrer' },
    { href: 'https://www.ian-tainan.com/time.html', target: '_blank', rel: 'noopener noreferrer' },
    { href: 'https://www.facebook.com/tainanrehab', target: '_blank', rel: 'noopener noreferrer' },
    { href: 'https://www.facebook.com/IANCLINICTAINAN/?locale=zh_TW', target: '_blank', rel: 'noopener noreferrer' },
    { href: 'https://w3.farbar.ai/channels/channel30/cms31/editChannel.php?chcode=rG2vq&cntcode=NVJkF&', target: '_blank', rel: 'noopener noreferrer' }
  ]);
  assert.ok(await section.evaluate(el => !!(document.querySelector('button').compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)));
  const download = page.getByRole('button', { name: '下載高清 PNG 海報', exact: true });
  const downloadHandle = await download.elementHandle();
  assert.ok(await section.evaluate((el, button) => !!(button.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING), downloadHandle));
  await section.locator('a').first().focus();
  await page.keyboard.press('Tab');
  assert.equal(await page.locator(':focus').textContent(), labels[0] + '操作手冊');
  const beforeStorage = await page.evaluate(() => window.manualTestStorageAttempts);
  assert.equal(beforeStorage.length, 1, 'only Babel startup probes storage');
  assert.equal(beforeStorage[0].method, 'getItem');
  assert.ok(beforeStorage[0].stack.includes('https://unpkg.com/@babel/standalone@8.0.4/babel.min.js'));
  const beforeApi = [...api];
  const beforeBlocked = [...blocked];
  for (let i = 0; i < labels.length; i++) {
    const article = section.getByRole('article', { name: labels[i], exact: true });
    const summary = article.locator('summary');
    const details = article.locator('details');
    assert.equal(await details.evaluate(el => el.open), false);
    await summary.click();
    assert.equal(await details.evaluate(el => el.open), true);
    assert.equal(await section.locator('details[open]').count(), 1);
    assert.ok(await article.locator('ol').isVisible());
    await summary.click();
    assert.equal(await details.evaluate(el => el.open), false);
    await summary.focus();
    await page.keyboard.press('Enter');
    assert.equal(await details.evaluate(el => el.open), true);
    await page.keyboard.press('Space');
    assert.equal(await details.evaluate(el => el.open), false);
    if (i < labels.length - 1) {
      await page.keyboard.press('Tab');
      if (i === 0) {
        assert.equal(await page.locator(':focus').getAttribute('href'), 'https://www.ian-tainan.com/admin/login.php');
        await page.keyboard.press('Tab');
      }
      if (i === 1) {
        assert.equal(await page.locator(':focus').getAttribute('href'), 'https://www.facebook.com/tainanrehab');
        await page.keyboard.press('Tab');
      }
      if (i === 2) {
        assert.equal(await page.locator(':focus').getAttribute('href'), 'https://www.facebook.com/IANCLINICTAINAN/?locale=zh_TW');
        await page.keyboard.press('Tab');
      }
      if (i === 3) {
        assert.equal(await page.locator(':focus').getAttribute('href'), 'https://w3.farbar.ai/channels/channel30/cms31/editChannel.php?chcode=rG2vq&cntcode=NVJkF&');
        await page.keyboard.press('Tab');
      }
      assert.equal(await page.locator(':focus').textContent(), labels[i + 1] + '操作手冊', 'each known destination precedes its disclosure in tab order');
    }
  }
  assert.deepEqual(api, beforeApi, 'manual interaction makes no API calls');
  assert.deepEqual(blocked, beforeBlocked, 'manual interaction makes no external requests');
  assert.equal(context.pages().length, 1, 'disclosures do not open external tools');
  assert.deepEqual(await page.evaluate(() => window.manualTestStorageAttempts), beforeStorage, 'manual interactions never attempt storage');
  await section.scrollIntoViewIfNeeded();
  const screenshot = path.join(evidence, mode + '-integrated.png');
  await page.screenshot({ path: screenshot, fullPage: true });
  report.screenshots.push(screenshot);
  report.results.push(mode + ': five entries, safe URLs, zero disabled destinations, warning, independent mouse/keyboard disclosures, tab order, no side effects PASS');
}

(async () => {
  fs.mkdirSync(evidence, { recursive: true });
  for (const filename of cdn.values()) assert.ok(fs.statSync(path.join(deps, filename)).size > 1000, 'Missing dependency: ' + filename);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  origin = 'http://127.0.0.1:' + server.address().port;
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    for (const [mode, viewport] of (yianOnly ? [['desktop', { width: 700, height: 1000 }]] : [['desktop', { width: 1440, height: 1000 }], ['mobile', { width: 390, height: 844 }]])) {
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
        if (url.pathname === '/auth-config.js') return route.fulfill({ contentType: 'application/javascript', body: '/* No real auth configuration is read. */' });
        if (url.pathname === '/auth-gate.js') return route.fulfill({ contentType: 'application/javascript', body: 'window.AuthGate = { isAuthenticated: () => true, logout: () => {} };' });
        if (url.pathname === '/schedule-api-config.js') return route.fulfill({ contentType: 'application/javascript', body: 'window.SCHEDULE_SAVE_LOAD_CONFIG = { webAppUrl: location.origin + "/api/schedule" };' });
        if (url.pathname === '/manual-fixture') return route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<!doctype html><html lang="zh-Hant"><head><meta name="viewport" content="width=device-width, initial-scale=1"><script src="https://unpkg.com/react@18.3.1/umd/react.production.min.js"></script><script src="https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js"></script><script src="https://cdn.tailwindcss.com/3.4.17"></script></head><body style="background:#f1f5f9"><main id="fixture" style="max-width:450px;margin:0 auto;padding:12px"></main><script type="module">import ManualPublishSection from '/manual-publish.mjs'; ReactDOM.createRoot(document.getElementById('fixture')).render(React.createElement(ManualPublishSection));</script></body></html>` });
        if (url.pathname.startsWith('/api/')) {
          api.push({ method: request.method(), path: url.pathname, action: url.searchParams.get('action') });
          if (url.pathname === '/api/schedule' && request.method() === 'GET' && url.searchParams.get('action') === 'load') {
            return route.fulfill({ contentType: 'application/json', body: '{"ok":true,"found":false}' });
          }
          return route.abort();
        }
        if (request.method() !== 'GET' || !staticFiles.has(decodeURIComponent(url.pathname).slice(1) || 'index.html')) { blocked.push(request.url()); return route.abort(); }
        return route.continue();
      });
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message));
      if (yianOnly) {
        await page.goto(origin + '/manual-fixture', { waitUntil: 'networkidle' });
        const section = page.getByRole('region', { name: '手動發布', exact: true });
        await section.waitFor();
        const yian = section.getByRole('article', { name: '毅安官網後台', exact: true });
        await yian.locator('summary').click();
        const link = yian.getByRole('link', { name: '開啟毅安公開門診表（新分頁）', exact: true });
        assert.ok(await link.isVisible());
        const publicLink = await link.evaluate(a => ({ href: a.href, label: a.textContent, target: a.target, rel: a.rel }));
        assert.deepEqual(publicLink, { href: 'https://www.ian-tainan.com/time.html', label: '開啟毅安公開門診表（新分頁）', target: '_blank', rel: 'noopener noreferrer' });
        assert.equal(await yian.getByRole('button').count(), 0);
        const backend = yian.locator('a').first();
        assert.equal(await backend.getAttribute('href'), 'https://www.ian-tainan.com/admin/login.php');
        assert.equal(await backend.getAttribute('target'), '_blank');
        assert.equal(await backend.getAttribute('rel'), 'noopener noreferrer');
        assert.equal(await yian.locator('a').count(), 2);
        assert.match(await yian.textContent(), /草稿，後台換圖步驟待確認/);
        assert.match(await yian.textContent(), /先確認主管指定更新哪張，保留其他圖，不用單一 PNG 覆蓋整頁多圖/);
        for (const name of labels.slice(3)) {
          const fb = section.getByRole('article', { name, exact: true });
          assert.ok(await fb.getByRole('button').isDisabled());
          assert.equal(await fb.locator('a').count(), 0);
        }
        assert.deepEqual(api, []);
        assert.deepEqual(blocked, []);
        assert.deepEqual(errors, []);
        assert.deepEqual(await page.evaluate(() => window.manualTestStorageAttempts), []);
        const screenshot = path.join(evidence, 'yi-an-public-manual.png');
        await page.screenshot({ path: screenshot, fullPage: true });
        report.screenshots.push(screenshot);
        report.results.push({ publicLink, adminSafeLink: true, yianFacebookDisabledWithoutLinks: true, fourImageCaution: true, noExternalRequests: true });
        report.requests[mode] = { mockedApi: api, blocked, runtimeErrors: errors };
        await context.close();
        continue;
      }
      await page.goto(origin, { waitUntil: 'networkidle' });
      await page.getByRole('region', { name: '手動發布', exact: true }).waitFor();
      const overview = path.join(evidence, mode + '-overview.png');
      await page.screenshot({ path: overview, fullPage: true });
      report.screenshots.push(overview);
      await checkSection(page, context, mode, api, blocked);
      const startupStorageBlocked = await page.evaluate(() => window.manualTestStorageAttempts);
      assert.deepEqual(api, [{ method: 'GET', path: '/api/schedule', action: 'load' }], 'only initial mocked schedule load');
      if (mode === 'desktop') {
        const downloadPromise = page.waitForEvent('download');
        await page.getByRole('button', { name: '下載高清 PNG 海報', exact: true }).click();
        const download = await downloadPromise;
        const pngPath = path.join(evidence, 'png-regression.png');
        await download.saveAs(pngPath);
        const png = fs.readFileSync(pngPath);
        assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
        assert.equal(png.readUInt32BE(16), 2160);
        assert.equal(png.readUInt32BE(20), 3840);
        report.results.push('unchanged handleDownload + real html2canvas: PNG 2160 × 3840 PASS');
      }
      // Separate screenshot fixture uses the exact production component with no app scroller,
      // so every manual line is visible in the evidence. Integrated screenshots remain above.
      await page.goto(origin + '/manual-fixture', { waitUntil: 'networkidle' });
      const section = page.getByRole('region', { name: '手動發布', exact: true });
      await section.waitFor();
      for (let i = 0; i < labels.length; i++) {
        const summary = section.locator('summary').nth(i);
        await summary.click();
        const screenshot = path.join(evidence, mode + '-manual-' + (i + 1) + '.png');
        await page.screenshot({ path: screenshot, fullPage: true });
        report.screenshots.push(screenshot);
        await summary.click();
      }
      assert.deepEqual(errors, [], mode + ' runtime errors');
      assert.deepEqual(api, [{ method: 'GET', path: '/api/schedule', action: 'load' }]);
      assert.deepEqual(await page.evaluate(() => window.manualTestStorageAttempts), []);
      report.requests[mode] = { mockedApi: api, blocked, runtimeErrors: errors, startupStorageBlocked };
      await context.close();
    }
    report.status = 'PASS';
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
    report.serverStopped = !server.listening;
    fs.writeFileSync(path.join(evidence, 'browser-report.json'), JSON.stringify(report, null, 2) + '\n');
  }
  console.log(JSON.stringify(report, null, 2));
})().catch(error => {
  report.status = 'BLOCKED_OR_FAILED';
  report.error = error.message;
  report.serverStopped = !server.listening;
  fs.mkdirSync(evidence, { recursive: true });
  fs.writeFileSync(path.join(evidence, 'browser-report.json'), JSON.stringify(report, null, 2) + '\n');
  console.error(error);
  process.exitCode = 1;
  if (server.listening) server.close();
});
