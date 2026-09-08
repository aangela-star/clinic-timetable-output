// Optional localhost-only browser check using an existing Playwright + Chromium.
import assert from 'node:assert/strict';
import {parseArgs} from 'node:util';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
const sha=b=>createHash('sha256').update(b).digest('hex');
const {values}=parseArgs({options:{'playwright-module':{type:'string'},port:{type:'string',default:'4174'}}});
const {chromium}=await import(values['playwright-module']?pathToFileURL(resolve(values['playwright-module'])).href:'playwright');
const browser=await chromium.launch();
assert.match(values.port,/^\d{4,5}$/);
const base='http://127.0.0.1:'+values.port;
const safeCodes=new Set(['BASELINE','PREPARED','PUBLISHED','INVALID_REQUEST','SAVE_REQUIRED','STALE_BASELINE','BODY_TOO_LARGE','EXPIRED_APPROVAL','INVALID_APPROVAL','AUTH_REQUIRED','INVALID_PNG','MANUAL_CHECK_REQUIRED','CMS_RESPONSE_CONTRACT_UNVERIFIED']);
try {
 for(const [device,viewport] of [['desktop',{width:1400,height:1000}],['mobile',{width:390,height:844}]]){
  const context=await browser.newContext({viewport,isMobile:device==='mobile',hasTouch:device==='mobile'});
  const diagnostics={device,phase:'login',api:[],pageErrors:[]};
  let publicContext;
  try{
   const page=await context.newPage();
   page.on('pageerror',error=>{if(diagnostics.pageErrors.length<10)diagnostics.pageErrors.push(['TypeError','ReferenceError','SyntaxError','RangeError'].includes(error.name)?error.name:'Error');});
   page.on('response',async response=>{
    const url=new URL(response.url());if(url.origin!==base||!['/api/publish','/api/schedule','/api/auth'].includes(url.pathname))return;
    const entry={route:url.pathname,http:response.status()};diagnostics.api.push(entry);if(diagnostics.api.length>20)diagnostics.api.shift();
    try{const body=await response.json();entry.code=safeCodes.has(body.error)?body.error:safeCodes.has(body.status)?body.status:body.ok===true?'OK':'OTHER';}catch{entry.code='NON_JSON';}
   });
   await page.goto(base);
   await page.locator('input[type=password]').fill('MOCK');
   await page.getByRole('button',{name:'登入',exact:true}).click();
   diagnostics.phase='save';
   await page.locator('input[type=month]').fill(device==='desktop'?'2099-01':'2099-02');
   await page.getByRole('button',{name:'儲存本月門診',exact:true}).waitFor();
   await page.waitForFunction(()=>!document.querySelector('input[type=month]').disabled);
   await page.locator('section').filter({has:page.getByText('年份月份',{exact:true})}).locator('input').fill('SYNTHETIC MOCK '+device);
   let approvedHash,approvedBytes,binding;
   page.on('request',r=>{if(new URL(r.url()).pathname==='/api/publish'&&r.method()==='POST'){
    const b=r.postDataJSON();if(b.op==='prepare'){approvedHash=b.input.pngSha256;approvedBytes=Buffer.from(b.input.pngDataUrl.split(',')[1],'base64');assert.equal(sha(approvedBytes),approvedHash);assert.match(b.input.data.title,/^SYNTHETIC MOCK/);for(const c of b.input.data.clinics)for(const slots of Object.values(c.schedule))assert.ok(Object.values(slots).every(v=>v===''));}
    if(b.op==='confirm')binding=b.input;
   }});
   await page.getByRole('button',{name:'儲存本月門診',exact:true}).click();
   await page.getByText(/^已儲存 \d{4}-\d{2} 門診資料（/).waitFor({timeout:30000});
   diagnostics.phase='prepare';
   await page.getByRole('button',{name:'發布',exact:true}).click();
   await page.getByText('MOCK 本機模擬：圖片已準備，確認後僅更新本機頁面。',{exact:true}).waitFor({timeout:60000});
   await page.getByRole('checkbox').check();
   let confirms=0;page.on('request',r=>{if(new URL(r.url()).pathname==='/api/publish'&&r.method()==='POST'&&r.postDataJSON()?.op==='confirm')confirms++;});
   diagnostics.phase='confirm';
   await page.getByRole('button',{name:'確認發布',exact:true}).click();
   await page.getByText('MOCK 本機模擬發布完成，未發布至正式官網。',{exact:true}).waitFor({timeout:30000});
   assert.equal(confirms,1);
   const pointer=await (await context.request.get(base+'/api/publish?pointer=jinan-website')).json();
   const duplicate=await (await context.request.post(base+'/api/publish',{data:{op:'confirm',input:binding}})).json();
   assert.equal(duplicate.status,'PUBLISHED');
   assert.deepEqual((await (await context.request.get(base+'/api/publish?pointer=jinan-website')).json()).baseline,pointer.baseline);
   diagnostics.phase='anonymous-image';
   publicContext=await browser.newContext({viewport});
   assert.equal((await publicContext.cookies()).length,0);
   const publicPage=await publicContext.newPage();await publicPage.goto(base+'/public/jinan');
   assert.equal(await publicPage.locator('img').evaluate(i=>i.src),base+'/api/publish-image');
   await publicPage.locator('img').evaluate(async i=>{await i.decode();});
   assert.deepEqual(await publicPage.locator('img').evaluate(i=>[i.naturalWidth,i.naturalHeight]),[2160,3840]);
   const publicBytes=await (await publicContext.request.get(base+'/api/publish-image')).body();
   assert.equal(sha(publicBytes),approvedHash);assert.deepEqual(publicBytes,approvedBytes);
   diagnostics.phase='ambiguous-confirm';
   await page.getByRole('button',{name:'關閉發布確認',exact:true}).click();
   await page.getByRole('button',{name:'發布',exact:true}).click();
   await page.getByText('MOCK 本機模擬：圖片已準備，確認後僅更新本機頁面。',{exact:true}).waitFor({timeout:60000});
   await page.getByRole('checkbox').check();
   await page.route('**/api/publish',async route=>{
    if(route.request().method()==='POST'&&route.request().postDataJSON()?.op==='confirm'){
     const r=await route.fetch();assert.equal((await r.json()).status,'PUBLISHED');await route.abort('failed');
    }else await route.continue();
   });
   await page.getByRole('button',{name:'確認發布',exact:true}).click();
   await page.getByText('MANUAL_CHECK_REQUIRED：需要人工確認，請停止操作，不要重複點擊；請人工檢查公開頁面與 CMS。',{exact:true}).waitFor({timeout:30000});
   assert.ok(await page.evaluate(()=>sessionStorage.getItem('publishPending')));
   await page.getByRole('button',{name:'關閉發布確認',exact:true}).click();
   await page.getByRole('button',{name:'發布',exact:true}).click();
   await page.getByText('MOCK 本機模擬：已確認上次發布完成；請關閉後再操作。',{exact:true}).waitFor({timeout:30000});
   assert.equal(confirms,2); // one user confirmation per job; reconciliation never confirms
   assert.equal(await page.evaluate(()=>sessionStorage.getItem('publishPending')),null);
   const after=await (await context.request.get(base+'/api/publish?pointer=jinan-website')).json();
   assert.equal(after.baseline.pointerVersion,pointer.baseline.pointerVersion+1);
   assert.equal(sha(await (await publicContext.request.get(base+'/api/publish-image')).body()),approvedHash);
   console.log(`MOCK ${device} bytes/hash, single confirmation, duplicate and ambiguous reconciliation PASS`);
  }catch{
   // Never emit raw errors, response bodies, DOM, PNGs, cookies, bindings or console logs.
   console.error(JSON.stringify(diagnostics));throw Error(`MOCK ${device} failed at ${diagnostics.phase}; safe diagnostics above`);
  }finally{await publicContext?.close();await context.close();}
 }
}finally{await browser.close();}
