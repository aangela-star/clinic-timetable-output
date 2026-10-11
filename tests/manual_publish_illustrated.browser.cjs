// No loopback server: intercepted fixture requests only, then actual offline file:// HTML.
// Fresh headless Chromium; never uses a user profile or real CMS/auth.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {chromium} = require(process.env.MANUAL_PUBLISH_PLAYWRIGHT || 'playwright');
const root = path.resolve(__dirname, '..');
const evidence = process.env.MANUAL_PUBLISH_EVIDENCE;
assert.ok(evidence, 'Set a new evidence directory');
const deps = process.env.MANUAL_PUBLISH_DEPS;
const origin = 'http://127.0.0.1:48123'; // All requests fulfilled/aborted; no listener or network.
const images = fs.readdirSync(path.join(root, 'docs/assets/website-guide')).filter(f => f.endsWith('.png'));
const report = { status: 'RUNNING', results: [], screenshots: [], externalRequests: [], backendPopups: [] };
const fixture = `<!doctype html><html lang="zh-Hant"><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{margin:0;font:16px/1.6 system-ui}main{max-width:980px;padding:16px;margin:auto}article{padding:12px;border:1px solid #ccc;margin:12px 0}img{max-width:100%}</style><main id="root"></main><script src="/react.js"></script><script src="/react-dom.js"></script><script type="module">import Guide from '/manual-publish.mjs';ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(Guide));</script></html>`;
let browser;
(async () => {
  fs.mkdirSync(evidence, {recursive:true});
  browser = await chromium.launch({headless:true});
  for (const [mode, viewport] of [['desktop',{width:1440,height:1000}],['mobile',{width:390,height:844}]]) {
    const context = await browser.newContext({viewport,serviceWorkers:'block'});
    let failImages = false;
    const errors=[];
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.protocol === 'file:') return route.continue();
      // Supplied backend navigation is fulfilled entirely in memory; never contact the website.
      if (url.href === 'https://www.facebook.com/tainanrehab') {
        report.facebookPopups ??= [];
        report.facebookPopups.push({mode, url:url.href, method:route.request().method(), intercepted:true});
        return route.fulfill({contentType:'text/html',body:'<!doctype html><title>Local Facebook fixture</title><p>Mock only</p>'});
      }
      if (url.href === 'https://www.ian-tainan.com/admin/login.php') {
        report.backendPopups.push({mode, url:url.href, method:route.request().method(), intercepted:true});
        return route.fulfill({contentType:'text/html',body:'<!doctype html><title>Local blocked backend fixture</title><p>Local fixture only — no website connection.</p>'});
      }
      if (url.origin !== origin) {report.externalRequests.push(url.href);return route.abort();}
      if (url.pathname === '/fixture') return route.fulfill({contentType:'text/html',body:fixture});
      if (['/react.js','/react-dom.js'].includes(url.pathname)) return route.fulfill({contentType:'application/javascript',body:fs.readFileSync(path.join(deps,url.pathname.slice(1)))});
      if (url.pathname === '/manual-publish.mjs') return route.fulfill({contentType:'application/javascript',body:fs.readFileSync(path.join(root,'manual-publish.mjs'))});
      const file = images.find(f => url.pathname === '/docs/assets/website-guide/'+f);
      if (file && !failImages) return route.fulfill({contentType:'image/png',body:fs.readFileSync(path.join(root,'docs/assets/website-guide',file))});
      return route.abort();
    });
    const page = await context.newPage();page.on('pageerror', e => errors.push(e.message));
    await page.goto(origin+'/fixture');
    const yian = page.getByRole('article',{name:'毅安官網後台',exact:true});
    await yian.locator('summary').click();
    const backend = yian.getByRole('link',{name:'開啟毅安官網後台（新分頁）',exact:true});
    assert.equal(await backend.getAttribute('href'),'https://www.ian-tainan.com/admin/login.php');
    assert.equal(await backend.getAttribute('target'),'_blank');
    assert.equal(await backend.getAttribute('rel'),'noopener noreferrer');
    assert.match(await yian.textContent(),/後台登入URL：使用者提供/);
    assert.match(await yian.textContent(),/內部換圖流程\/截圖：待確認/);
    for (const name of ['毅安 FB 粉專']) {
      const fb=page.getByRole('article',{name,exact:true});
      assert.ok(await fb.getByRole('button').isDisabled());
      assert.equal(await fb.locator('a').count(),0);
    }
    const backendShot=path.join(evidence,mode+'-yian-backend.png');
    await page.screenshot({path:backendShot,fullPage:true});report.screenshots.push(backendShot);
    const backendPopupPromise=context.waitForEvent('page');await backend.click();
    const backendPopup=await backendPopupPromise;await backendPopup.waitForLoadState();
    assert.equal(backendPopup.url(),'https://www.ian-tainan.com/admin/login.php');
    assert.equal(await backendPopup.title(),'Local blocked backend fixture');
    assert.equal(await backendPopup.evaluate(()=>window.opener),null);
    assert.equal(page.url(),origin+'/fixture');await backendPopup.close();
    report.results.push(mode+': supplied backend opens isolated new tab in intercepted fixture; Yian Facebook link disabled PASS');
    await yian.locator('summary').click();
    const facebook = page.getByRole('article',{name:'晉安 FB 粉專',exact:true});
    const fbLink = facebook.getByRole('link');
    assert.equal(await fbLink.getAttribute('href'),'https://www.facebook.com/tainanrehab');
    assert.equal(await fbLink.getAttribute('target'),'_blank');
    assert.equal(await fbLink.getAttribute('rel'),'noopener noreferrer');
    const fbDetails = facebook.locator('details'), fbSummary = facebook.locator('summary');
    assert.equal(await fbDetails.evaluate(el=>el.open),false);
    await fbSummary.click();assert.equal(await fbDetails.evaluate(el=>el.open),true);
    assert.match(await facebook.textContent(),/文字操作指引，介面名稱可能不同；圖解待補/);
    assert.equal(await facebook.locator('ol li').count(),8);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    const fbShot=path.join(evidence,mode+'-jinan-facebook-guide.png');
    await page.screenshot({path:fbShot,fullPage:true});report.screenshots.push(fbShot);
    await fbSummary.click();assert.equal(await fbDetails.evaluate(el=>el.open),false);
    await fbSummary.focus();await page.keyboard.press('Enter');assert.equal(await fbDetails.evaluate(el=>el.open),true);
    await page.keyboard.press('Space');assert.equal(await fbDetails.evaluate(el=>el.open),false);
    const fbPopupPromise=context.waitForEvent('page');await fbLink.click();
    const fbPopup=await fbPopupPromise;await fbPopup.waitForLoadState();
    assert.equal(fbPopup.url(),'https://www.facebook.com/tainanrehab');
    assert.equal(await fbPopup.title(),'Local Facebook fixture');
    assert.equal(await fbPopup.evaluate(()=>window.opener),null);
    assert.equal(page.url(),origin+'/fixture');
    const popupImage=path.join(evidence,mode+'-jinan-facebook-mock-popup.png');
    await fbPopup.screenshot({path:popupImage});report.screenshots.push(popupImage);
    await fbPopup.close();
    report.results.push(mode+': Jinan exact safe Facebook link, true intercepted popup, mouse/keyboard guide, Yian disabled PASS');
    const jinan = page.getByRole('article',{name:'晉安官網後台',exact:true});
    await jinan.locator('summary').click();
    assert.equal(await jinan.locator('img').count(),5);
    for (const img of await jinan.locator('img').all()) {
      await img.scrollIntoViewIfNeeded();
      await img.evaluate(el => el.decode());
      assert.ok(await img.evaluate(el => el.naturalWidth > 0 && el.getBoundingClientRect().width <= document.documentElement.clientWidth));
    }
    assert.equal(await jinan.locator('[data-missing-screenshot]').count(),2);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    const appShot=path.join(evidence,mode+'-illustrated.png');await page.screenshot({path:appShot,fullPage:true});report.screenshots.push(appShot);
    const popupPromise=context.waitForEvent('page');await jinan.locator('figure a').first().click();const popup=await popupPromise;
    await popup.waitForLoadState();assert.ok(popup.url().endsWith('/01-login.png'));assert.equal(await popup.evaluate(() => window.opener),null);await popup.close();
    failImages=true;await page.reload();await jinan.locator('summary').click();
    await jinan.locator('img').first().scrollIntoViewIfNeeded();
    assert.ok(await jinan.getByText('缺圖待補：上傳分頁內容', {exact:false}).isVisible());
    assert.equal(await jinan.locator('ol li').count(),8);
    await page.screenshot({path:path.join(evidence,mode+'-image-failure.png'),fullPage:true});
    // Offline document: deny network explicitly. Data images require no routes or assets.
    await context.setOffline(true);
    await page.goto(pathToFileURL(path.join(root,'docs/官網門診表操作手冊.html')).href);
    for (const img of await page.locator('img').all()) await img.evaluate(el => el.decode());
    assert.equal(await page.locator('img').count(),5);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    const manualURL=page.url();
    const manualBackend=page.locator('a[href="https://www.ian-tainan.com/admin/login.php"]');
    assert.equal(await manualBackend.count(),1);
    assert.equal(await manualBackend.getAttribute('target'),'_blank');
    assert.equal(await manualBackend.getAttribute('rel'),'noopener noreferrer');
    await manualBackend.scrollIntoViewIfNeeded();
    const anchorShot=path.join(evidence,mode+'-offline-backend-anchor.png');
    await page.screenshot({path:anchorShot});report.screenshots.push(anchorShot);
    const manualPopupPromise=context.waitForEvent('page');await manualBackend.click();
    const manualPopup=await manualPopupPromise;await manualPopup.waitForLoadState();
    assert.equal(manualPopup.url(),'https://www.ian-tainan.com/admin/login.php');
    assert.equal(await manualPopup.title(),'Local blocked backend fixture');
    assert.equal(await manualPopup.evaluate(()=>window.opener),null);
    assert.equal(page.url(),manualURL);
    assert.ok(await manualBackend.isVisible());
    const popupShot=path.join(evidence,mode+'-offline-backend-popup.png');
    await manualPopup.screenshot({path:popupShot});report.screenshots.push(popupShot);
    await manualPopup.close();
    report.results.push(mode+': actual offline generated manual backend anchor opens safe intercepted popup; opener null and source unchanged PASS');
    const offlineShot=path.join(evidence,mode+'-offline.png');await page.screenshot({path:offlineShot,fullPage:true});report.screenshots.push(offlineShot);
    await page.emulateMedia({media:'print'});
    await page.screenshot({path:path.join(evidence,mode+'-offline-print.png'),fullPage:true});
    assert.deepEqual(errors,[]);
    await context.close();report.results.push(mode+': images, enlargement, no overflow, missing-image fallback, offline and print PASS');
  }
  assert.deepEqual(report.facebookPopups.map(p=>p.method),['GET','GET']);
  assert.deepEqual(report.backendPopups.map(p=>p.method),['GET','GET','GET','GET']);
  assert.deepEqual(report.externalRequests,[]);report.status='PASS';
})().catch(e => {report.status='BLOCKED_OR_FAILED';report.error=e.message;process.exitCode=1;}).finally(async()=>{
  if(browser) await browser.close();
  fs.writeFileSync(path.join(evidence,'illustrated-browser-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
});
