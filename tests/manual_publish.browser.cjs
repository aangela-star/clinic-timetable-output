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
// `expectedAction` is asserted EXACTLY, per page, rather than accepting either read action:
// legacy.html still puts `action=load` in its query string (the proxy ignores the client action
// and always chooses the read-only Apps Script action server-side), while the calendar editor
// sends `action=loadReadOnly` to match what the proxy actually does.
function assertReadOnlyApi(api, label, expectedAction) {
  const other = api.filter((c) => c.path !== '/api/schedule' && c.path !== '/api/editor-mode');
  assert.deepEqual(other, [], label + ': unexpected /api traffic');
  assert.deepEqual(api.filter((c) => c.method !== 'GET'), [],
    label + ': no non-GET API call is permitted (no publish, upload or cloud save)');
  const editorMode = api.filter((c) => c.path === '/api/editor-mode');
  assert.ok(editorMode.length <= 1, label + ': editor-mode probed more than once');
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
// index.html is now the calendar editor, which ships the same manual-publish section through a
// dynamic import, so its own first-party assets are served too. Everything here is a repo file on
// the test origin; every other request is still either a stubbed CDN bundle or blocked.
const legacyAssets = ['legacy.html', 'schedule-save-load-core.js', 'clinic-order.js', 'publish-core.js'];
const calendarAssets = ['index.html', 'calendar.css', 'calendar-assets.js', 'schedule-core.js',
  'timetable-model.js', 'calendar-layout.js', 'timetable-poster.js', 'timetable-view.js',
  'calendar-draft.js', 'calendar-meta.js', 'calendar-template.js', 'calendar-editor.js'];
const staticFiles = new Set(['manual-publish.mjs', ...legacyAssets, ...calendarAssets]);
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
  res.setHeader('Content-Type', name.endsWith('.png') ? 'image/png' : name.endsWith('.html') ? 'text/html; charset=utf-8' : name.endsWith('.css') ? 'text/css; charset=utf-8' : name.endsWith('.json') ? 'application/json; charset=utf-8' : 'application/javascript; charset=utf-8');
  res.end(fs.readFileSync(path.join(root, name)));
});

async function checkSection(page, context, mode, api, blocked, page_profile) {
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
  const download = page.getByRole('button', { name: page_profile.pngButton, exact: true });
  const downloadHandle = await download.elementHandle();
  assert.ok(await section.evaluate((el, button) => !!(button.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING), downloadHandle));
  await section.locator('a').first().focus();
  await page.keyboard.press('Tab');
  assert.equal(await page.locator(':focus').textContent(), labels[0] + '操作手冊');
  const beforeStorage = await page.evaluate(() => window.manualTestStorageAttempts);
  if (page_profile.storage === 'blocked') {
    // legacy.html touches no storage at startup, so the only probe is Babel's own.
    assert.equal(beforeStorage.length, 1, 'only Babel startup probes storage');
    assert.equal(beforeStorage[0].method, 'getItem');
    assert.ok(beforeStorage[0].stack.includes('https://unpkg.com/@babel/standalone@8.0.4/babel.min.js'));
  } else {
    // The calendar editor legitimately reads its own local draft key on open. Storage is recorded
    // and allowed here, but it must only touch that editor's own keys, and the manual-publish
    // interactions below must still add nothing (asserted against beforeStorage at the end).
    const keys = beforeStorage.filter((attempt) => attempt.key).map((attempt) => attempt.key);
    assert.ok(keys.includes('clinic-timetable.calendar-integrated-draft.v1'),
      'the calendar editor is expected to read its own local draft key: ' + JSON.stringify(keys));
    // The vendor bundles probe their own debug switches on load; those two reads are named here
    // rather than blanket-allowed, so any other foreign key still fails.
    const vendorReadProbes = new Set(['debug', 'DEBUG']);
    assert.deepEqual(keys.filter((key) => !key.startsWith('clinic-timetable.') && !vendorReadProbes.has(key)),
      [], 'unexpected foreign storage key: ' + JSON.stringify(keys));
    // The safety property: nothing outside the editor's own keys may be WRITTEN or REMOVED.
    assert.deepEqual(beforeStorage
      .filter((attempt) => attempt.method !== 'getItem' && attempt.method !== 'key')
      .filter((attempt) => !/^clinic-timetable\./.test(attempt.key || ''))
      .map((attempt) => ({ method: attempt.method, key: attempt.key })),
    [], 'no key outside clinic-timetable.* may be written or removed');
  }
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
    // PROFILES. The first two are the original legacy-editor coverage, now naming its page
    // explicitly instead of relying on index.html having been that page. The third is NEW
    // coverage of the same manual-publish section inside the current calendar editor, which is
    // what index.html serves today -- added rather than swapped, so neither page loses coverage.
    const profiles = yianOnly
      ? [{ mode: 'desktop', viewport: { width: 700, height: 1000 }, page: '/legacy.html',
        pngButton: '下載高清 PNG 海報', storage: 'blocked', action: 'load' }]
      : [
        { mode: 'legacy-desktop', viewport: { width: 1440, height: 1000 }, page: '/legacy.html',
          pngButton: '下載高清 PNG 海報', storage: 'blocked', action: 'load', png: true },
        { mode: 'legacy-mobile', viewport: { width: 390, height: 844 }, page: '/legacy.html',
          pngButton: '下載高清 PNG 海報', storage: 'blocked', action: 'load' },
        { mode: 'calendar-desktop', viewport: { width: 1440, height: 1000 }, page: '/index.html',
          pngButton: '下載高清 PNG', storage: 'recorded', action: 'loadReadOnly',
          png: true, calendar: true },
      ];
    for (const profile of profiles) {
      const { mode, viewport } = profile;
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
        // The calendar editor cannot run without its own local draft storage, so here storage is
        // RECORDED and allowed instead of disabled. Every attempt keeps its key so the assertions
        // can still prove nothing outside clinic-timetable.* is touched.
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
      }
      if (profile.calendar) {
        // Deterministic "current month". The calendar editor derives its boot month from the
        // device clock (ScheduleSaveLoadCore.getInitialMonthKey), so without this the expected
        // month would change with the calendar date. Timers are left real: the editor's startup
        // read has a 15 s abort that must still be able to fire.
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
        if (url.pathname === '/auth-config.js') return route.fulfill({ contentType: 'application/javascript', body: '/* No real auth configuration is read. */' });
        if (url.pathname === '/auth-gate.js') return route.fulfill({ contentType: 'application/javascript', body: 'window.AuthGate = { isAuthenticated: () => true, logout: () => {} };' });
        if (url.pathname === '/schedule-api-config.js') return route.fulfill({ contentType: 'application/javascript', body: 'window.SCHEDULE_SAVE_LOAD_CONFIG = { webAppUrl: location.origin + "/api/schedule" };' });
        if (url.pathname === '/manual-fixture') return route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<!doctype html><html lang="zh-Hant"><head><meta name="viewport" content="width=device-width, initial-scale=1"><script src="https://unpkg.com/react@18.3.1/umd/react.production.min.js"></script><script src="https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js"></script><script src="https://cdn.tailwindcss.com/3.4.17"></script></head><body style="background:#f1f5f9"><main id="fixture" style="max-width:450px;margin:0 auto;padding:12px"></main><script type="module">import ManualPublishSection from '/manual-publish.mjs'; ReactDOM.createRoot(document.getElementById('fixture')).render(React.createElement(ManualPublishSection));</script></body></html>` });
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
      await page.goto(origin + profile.page, { waitUntil: 'networkidle' });
      await page.getByRole('region', { name: '手動發布', exact: true }).waitFor();
      const overview = path.join(evidence, mode + '-overview.png');
      await page.screenshot({ path: overview, fullPage: true });
      report.screenshots.push(overview);
      await checkSection(page, context, mode, api, blocked, profile);
      const startupStorageBlocked = await page.evaluate(() => window.manualTestStorageAttempts);
      assertReadOnlyApi(api, mode + ' startup traffic', profile.action);
      if (profile.calendar) {
        // The calendar editor's automatic startup read, observed in a real browser: it must be the
        // read-only action, on the month the pinned device clock makes current, and it must not
        // claim to have loaded cloud content when the mock says the month is absent.
        const schedule = api.filter((c) => c.path === '/api/schedule');
        assert.equal(schedule[0].action, 'loadReadOnly', 'the calendar boot read must be read-only');
        assert.equal(schedule[0].month, '2026-11', 'the boot read must use the pinned current month');
        const cloudStatus = await page.locator('#cloud-status').textContent();
        assert.match(cloudStatus, /雲端目前沒有 2026-11/, cloudStatus);
        assert.match(cloudStatus, /不是雲端內容/, cloudStatus);
        assert.equal(await page.locator('#manual-publish').getByRole('region', { name: '手動發布', exact: true }).count(),
          1, 'the manual-publish section must be mounted by the calendar editor itself');
        report.results.push(mode + ': calendar editor boot read is month=2026-11 action=loadReadOnly, '
          + 'no cloud content claimed, manual-publish section mounted PASS');
      }
      if (profile.png) {
        const downloadPromise = page.waitForEvent('download');
        await page.getByRole('button', { name: profile.pngButton, exact: true }).click();
        const download = await downloadPromise;
        const pngPath = path.join(evidence, mode + '-png-regression.png');
        await download.saveAs(pngPath);
        const png = fs.readFileSync(pngPath);
        assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
        assert.equal(png.readUInt32BE(16), 2160);
        assert.equal(png.readUInt32BE(20), 3840);
        report.results.push(mode + ': real ' + profile.pngButton + ' download produced a 2160 × 3840 PNG PASS');
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
      assertReadOnlyApi(api, mode + ' traffic after the run', profile.action);
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
