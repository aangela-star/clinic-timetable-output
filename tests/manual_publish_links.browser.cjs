// Fully intercepted synthetic fixture: never forwards any request or reads real auth config.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),evidence=path.resolve(process.env.MANUAL_PUBLISH_EVIDENCE||path.join(root,'.local/manual-links/browser'));
const {chromium}=require(process.env.MANUAL_PUBLISH_PLAYWRIGHT||'playwright');
const assetRoot=process.env.MANUAL_LINKS_ASSETS||'/Users/iaiangela/Projects/clinic-timetable-parser-fix-20261008/.local/timetable-resume-integration/browser';
const {inspect}=require('../docs/exception-delete-release/asset-tools.cjs');
const assets=new Map(JSON.parse(fs.readFileSync(path.join(assetRoot,'asset-manifest.json'))).map(a=>{const b=fs.readFileSync(path.join(assetRoot,a.file));return [a.url,{body:b,contentType:inspect(a,b).contentType,headers:{'access-control-allow-origin':'*'}}];}));
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const origin='https://manual-links.test',report={cases:[],screenshots:[],forwardedRequests:0,network:[]};
const fixture=()=>({title:'2099/01 測試專用',note:'合成測試資料，非正式門診資訊',clinics:[{id:'clinic-1',name:'晉安測試診所',theme:'teal'},{id:'clinic-2',name:'毅安測試診所',theme:'blue'}].map(c=>({...c,changes:['測試異動，非正式公告'],schedule:Object.fromEntries(['週一','週二','週三','週四','週五','週六'].map(d=>[d,{'早診':'測試','午診':'測試','晚診':'測試'}]))}))});
let browser;
async function setup(mode,viewport){
 const context=await browser.newContext({viewport,deviceScaleFactor:1,acceptDownloads:true,serviceWorkers:'block',isMobile:viewport.width<500,hasTouch:viewport.width<1100});
 let stored=fixture(),release,api=[],errors=[],moduleRequests=0;
 const gate=new Promise(r=>release=r);
 await context.routeWebSocket(/.*/,ws=>ws.close());
 await context.route('**/*',async route=>{
  const req=route.request(),u=new URL(req.url());report.network.push({mode,url:req.url(),method:req.method()});
  const send=(body,contentType='application/javascript')=>route.fulfill({contentType,body:typeof body==='object'&&!Buffer.isBuffer(body)?JSON.stringify(body):body});
  if(assets.has(req.url())&&req.method()==='GET')return route.fulfill(assets.get(req.url()));
  if(u.origin!==origin){if(mode==='popup'&&req.isNavigationRequest())return send('<!doctype html><title>本機連結攔截</title>本機測試，未連線平台','text/html');return route.abort();}
  if(u.pathname==='/fixture')return send(`<!doctype html><html lang="zh-Hant"><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><script src="https://unpkg.com/react@18.3.1/umd/react.production.min.js"></script><script src="https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js"></script><script src="https://cdn.tailwindcss.com/3.4.17"></script><div id="root" style="max-width:760px;margin:auto"></div><script type="module">import Manual from './manual-publish.mjs';ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(Manual,{clinicName:'毅安測試診所',monthKey:'2099-01',posterTitle:'2099/01 測試專用'}));</script></html>`,'text/html');
  if(u.pathname==='/auth-config.js')return send('/* synthetic test auth only */');
  if(u.pathname==='/auth-gate.js')return send('window.AuthGate={isAuthenticated:()=>true,logout:()=>{}};');
  if(u.pathname==='/schedule-api-config.js')return send('window.SCHEDULE_SAVE_LOAD_CONFIG={webAppUrl:location.origin+"/api/schedule"};');
  if(u.pathname.startsWith('/api/')){
   api.push({path:u.pathname,method:req.method()});
   assert.equal(u.pathname,'/api/schedule','No publishing API permitted');
   if(req.method()==='GET')return send({ok:true,found:true,data:stored},'application/json');
   const body=req.postDataJSON();assert.equal(body.action,'save');stored=body.data;return send({ok:true,updatedAt:'2099-01-01T00:00:00Z'},'application/json');
  }
  if(u.pathname==='/manual-publish.mjs'){
   moduleRequests++;
   if(['delay','load-failure','render-failure'].includes(mode))await gate;
   if(mode==='load-failure')return route.abort();
   if(mode==='render-failure')return send('export default function(){throw new Error("Synthetic render failure")}');
   return send(fs.readFileSync(path.join(root,'manual-publish.mjs')));
  }
  if(u.pathname==='/')return send((mode==='baseline'?require('node:child_process').execFileSync('/usr/bin/git',['show','1f465c900dbd94c77ab8930cc25cff9d8d221057:index.html'],{cwd:root}):fs.readFileSync(path.join(root,'index.html'))),'text/html');
  const name=decodeURIComponent(u.pathname.slice(1));
  if(['schedule-save-load-core.js','clinic-order.js','publish-core.js'].includes(name))return send(fs.readFileSync(path.join(root,name)));
  if(/^docs\/assets\/website-guide\/0[1-5]-[a-z-]+\.png$/.test(name))return send(fs.readFileSync(path.join(root,name)),'image/png');
  return route.abort();
 });
 const page=await context.newPage();page.setDefaultTimeout(20000);await page.clock.setFixedTime(new Date('2099-01-15T04:00:00Z')); page.on('pageerror',e=>errors.push(e.message));
 return {context,page,api,errors,release,stored:()=>stored,moduleRequests:()=>moduleRequests};
}
async function shot(page,name){const p=path.join(evidence,name+'.png');await page.screenshot({path:p,fullPage:true});report.screenshots.push(p);}
async function download(page,name){
 await page.evaluate(async()=>{await document.fonts.ready;});
 const promise=page.waitForEvent('download',{timeout:120000});await page.getByRole('button',{name:'下載高清 PNG 海報',exact:true}).click();
 const d=await promise,p=path.join(evidence,name+'.png');await d.saveAs(p);assert.equal(await d.failure(),null);
 const b=fs.readFileSync(p);assert.equal(b.readUInt32BE(16),2160);assert.equal(b.readUInt32BE(20),3840);
 return {file:p,sha256:sha(b),bytes:b.length,width:2160,height:3840};
}
(async()=>{fs.mkdirSync(evidence,{recursive:true});try{
 browser=await chromium.launch({headless:true});
 if(process.argv.includes('--red')){
  const t=await setup('red',{width:1440,height:1000});await t.page.goto(origin+'/fixture');await t.page.locator('article').first().waitFor();await shot(t.page,'red-four-cards');assert.equal(await t.page.locator('article').count(),5);await t.context.close();return;
 }
 for(const [device,viewport] of [['desktop',{width:1440,height:1000}],['ipad',{width:1024,height:1366}],['phone',{width:390,height:844}]]){
  const t=await setup('popup',viewport),p=t.page;await p.goto(origin+'/?month=2099-01');await p.getByText('已載入 2099-01 門診資料。',{exact:true}).waitFor();
  const region=p.getByRole('region',{name:'手動發布',exact:true});await region.waitFor();assert.equal(await region.locator('article').count(),5);assert.equal(await region.locator('details[open]').count(),0);assert.equal(await region.locator('button').count(),1);assert.equal(await region.locator('input').count(),0);
  assert.match(await region.textContent(),/晉安測試診所/);assert.match(await region.textContent(),/2099-01/);
  const before=JSON.stringify(t.api);
  for(const article of await region.locator('article').all()){
   const s=article.locator('summary');await s.focus();await p.keyboard.press('Enter');assert.equal(await article.locator('details').getAttribute('open'),'');await p.keyboard.press('Space');assert.equal(await article.locator('details').getAttribute('open'),null);
  }
  for(const a of await region.locator('article > a').all()){
   assert.equal(await a.getAttribute('rel'),'noopener noreferrer');const promised=t.context.waitForEvent('page');await a.click();const popup=await promised;await popup.waitForLoadState();assert.equal(await popup.evaluate(()=>window.opener),null);await popup.close();
  }
  assert.equal(JSON.stringify(t.api),before,'manual actions make no API calls');
  const priority=p.locator('select').filter({has:p.locator('option[value="clinic-2"]')});await priority.selectOption('clinic-2');assert.match(await region.locator('[data-manual-context]').textContent(),/毅安測試診所/);assert.equal(await priority.inputValue(),'clinic-2');
  await p.locator('input[type=month]').fill('2099-02');assert.match(await region.locator('[data-manual-context]').textContent(),/2099-02/);assert.match(await region.locator('[data-manual-context]').textContent(),/2099\/01/);await p.locator('input[type=month]').fill('2099-01');await priority.selectOption('clinic-1');
  for(const el of await region.locator('article').all()){assert.ok(await el.evaluate(e=>e.scrollWidth<=e.clientWidth),'card overflow');}
  const downloadButton=p.getByRole('button',{name:'下載高清 PNG 海報',exact:true});
  await downloadButton.evaluate(el=>el.scrollIntoView({block:'start'}));
  assert.ok(await region.locator('[data-manual-context]').evaluate(el=>{const r=el.getBoundingClientRect();const parent=el.closest('.overflow-y-auto').getBoundingClientRect();return r.top>=0&&r.bottom<=Math.min(innerHeight,parent.bottom);}), 'selected context visible beside existing download at trigger time');
  await shot(p,device+'-download-context');
  await region.scrollIntoViewIfNeeded();await shot(p,device+'-integrated');
  await p.goto(origin+'/fixture');await p.locator('article').first().waitFor();assert.match(await p.locator('[data-manual-context]').textContent(),/毅安測試診所/);await shot(p,device+'-cards');assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'fixture has no horizontal overflow');
  assert.deepEqual(t.errors,[]);report.cases.push({name:device,status:'PASS',manualApiCalls:0,enabledPopups:4});await t.context.close();
 }
 for(const mode of ['baseline','current']){
  const t=await setup(mode,{width:1440,height:1000});await t.page.goto(origin+'/?month=2099-01');await t.page.getByText('已載入 2099-01 門診資料。',{exact:true}).waitFor();report[mode+'Png']=await download(t.page,mode+'-actual-download');assert.deepEqual(t.errors,[]);await t.context.close();
 }
 const a=fs.readFileSync(report.baselinePng.file),b=fs.readFileSync(report.currentPng.file);report.pngBytesEqual=a.equals(b);report.pngByteDifferences=Math.abs(a.length-b.length)+a.subarray(0,Math.min(a.length,b.length)).reduce((n,v,i)=>n+(v!==b[i]),0);const decodeContext=await setup('decode',{width:1440,height:1000});const decoder=decodeContext.page;await decoder.goto(origin+'/fixture');
 report.pngDecoded=await decoder.evaluate(async encoded=>{
  const arrays=await Promise.all(encoded.map(async src=>{const i=new Image();i.src='data:image/png;base64,'+src;await i.decode();const c=document.createElement('canvas');c.width=i.width;c.height=i.height;const g=c.getContext('2d');g.drawImage(i,0,0);return g.getImageData(0,0,c.width,c.height).data;}));
  let differentPixels=0,differentChannels=0,nonWhitePixels=0;
  for(let i=0;i<arrays[0].length;i+=4){let different=false;for(let j=0;j<4;j++){if(arrays[0][i+j]!==arrays[1][i+j]){different=true;differentChannels++;}}if(different)differentPixels++;if(arrays[0][i]<245||arrays[0][i+1]<245||arrays[0][i+2]<245)nonWhitePixels++;}
  const hashes=await Promise.all(arrays.map(async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(n=>n.toString(16).padStart(2,'0')).join('')));
  return {differentPixels,differentChannels,nonWhitePixels,rgbaSha256:hashes};
 },[a.toString('base64'),b.toString('base64')]);await decodeContext.context.close();
 assert.equal(report.pngBytesEqual,true,'actual before/after download bytes');assert.equal(report.pngDecoded.differentPixels,0);assert.ok(report.pngDecoded.nonWhitePixels>1000);
 for(const mode of ['delay','load-failure','render-failure']){
  const t=await setup(mode,{width:1440,height:1000}),p=t.page;await p.goto(origin+'/?month=2099-01',{waitUntil:'domcontentloaded'});await p.getByText('已載入 2099-01 門診資料。',{exact:true}).waitFor();await p.getByText('正在載入手動發布說明…',{exact:true}).waitFor();
  const title=p.locator('section').filter({has:p.getByText('年份月份',{exact:true})}).locator('input');await title.fill('2099/01 未儲存測試');const original=await title.elementHandle();
  await download(p,mode+'-pending-download');t.release();
  if(mode==='delay')await p.getByRole('region',{name:'手動發布',exact:true}).waitFor();else await p.getByRole('status').filter({hasText:'手動發布說明暫時無法使用'}).waitFor();
  assert.equal(await original.evaluate(el=>el.isConnected),true);assert.equal(await title.inputValue(),'2099/01 未儲存測試');await title.fill('2099/01 失敗後編輯');assert.equal(await p.locator('main').filter({hasText:'2099/01 失敗後編輯'}).count(),2);
  await p.getByRole('button',{name:'儲存本月門診',exact:true}).click();await p.getByText(/已儲存 2099-01 門診資料/).waitFor();assert.equal(t.stored().title,'2099/01 失敗後編輯');await title.fill('2099/01 載入前測試');await p.getByRole('button',{name:'載入本月門診',exact:true}).click();await p.getByText('已載入 2099-01 門診資料。',{exact:true}).waitFor();assert.equal(await title.inputValue(),'2099/01 失敗後編輯');
  const png=await download(p,mode+'-after-download');await p.locator('button').filter({hasText:'下載高清 PNG 海報'}).scrollIntoViewIfNeeded();await shot(p,mode+'-editor');assert.deepEqual(t.errors,[]);assert.equal(t.moduleRequests(),1);assert.deepEqual(t.api.map(x=>x.method),['GET','POST','GET']);report.cases.push({name:mode,status:'PASS',preservedUnsavedNode:true,saveLoad:'mocked via actual UI',png});await t.context.close();
 }
 report.status='PASS';
}catch(e){report.status='FAIL';report.error=e.stack;process.exitCode=1;}finally{if(browser)await browser.close();fs.writeFileSync(path.join(evidence,'results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,cases:report.cases,error:report.error,pngBytesEqual:report.pngBytesEqual}));}})();
