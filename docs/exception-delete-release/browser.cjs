'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict'),cp=require('node:child_process');
const {runtime:expectedRuntime,inspect:inspectAsset}=require('./asset-tools.cjs');
const SRC=path.resolve(__dirname,'../..'), ASSETS=path.resolve(process.argv.find(a=>a.startsWith('--assets='))?.slice(9)||path.join(SRC,'../clinic-timetable-parser-fix-20261008/.local/timetable-resume-integration/browser'));
const phase=process.argv[2]||'full',ROOT=path.join(SRC,'.local/release-prep',phase);assert.ok(!fs.existsSync(ROOT),'Use a new evidence phase name; never overwrite retained results');fs.mkdirSync(ROOT,{recursive:true});
const DEPS=path.resolve(process.argv.find(a=>a.startsWith('--deps='))?.slice(7)||'/Users/iaiangela/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules');
const {chromium}=require(path.join(DEPS,'playwright'));
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const write=(n,x)=>fs.writeFileSync(path.join(ROOT,n),JSON.stringify(x,null,2)+'\n');
const git=(...a)=>cp.execFileSync('/usr/bin/git',['-C',SRC,...a],{encoding:'utf8'}).trim();
function snapshot(){
 const files=git('ls-files','--cached','--others','--exclude-standard').split('\n').filter(p=>!p.startsWith('docs/exception-delete-release/')&&p!=='auth-config.js'&&!/(^|\/)(\.env[^/]*|\.git|node_modules|\.local)(\/|$)/.test(p));
 return {head:git('rev-parse','HEAD'),branch:git('branch','--show-current'),status:git('status','--short'),files:Object.fromEntries(files.map(p=>[p,sha(fs.readFileSync(path.join(SRC,p)))]))};
}
const before=snapshot();write('source-before.json',before);assert.equal(before.head,'31a426a188d0af580e4442b0bb197d966198290a');assert.equal(before.branch,'fix/timetable-exception-delete-release');
// Process-local temporary directory only; no shell configuration or environment files modified.
fs.mkdirSync(path.join(ROOT,'tmp'),{recursive:true});process.env.TMPDIR=path.join(ROOT,'tmp');
const launchOptions={chromiumSandbox:true,downloadsPath:path.join(ROOT,'downloads'),ignoreDefaultArgs:['--unsafely-disable-devtools-self-xss-warnings','--enable-unsafe-swiftshader']};
const result={status:'NOT_RUN',cases:[],limitations:['No product print control exists: print is an explicitly mocked direct window.print invocation.','Authentication config/response are synthetic; no real auth, CMS, Google, GAS, publish or image endpoints are contacted.','Production target fingerprint does not cover siblings/month/order. Browser regression does not establish production publication readiness.']};
let browser;const network=[],consoleLog=[];
(async()=>{try{
 if(process.argv.includes('--probe')){
  browser=await chromium.launch(launchOptions);result.status='BROWSER_PROBE_PASS';return;
 }
 const manifest=JSON.parse(fs.readFileSync(path.join(ASSETS,'asset-manifest.json')));
 const required=[...fs.readFileSync(path.join(SRC,'index.html'),'utf8').matchAll(/(?:src|href)="(https:\/\/[^"]+)"/g)].map(m=>m[1]);
 const assets=new Map();
 for(const a of manifest){const b=fs.readFileSync(path.join(ASSETS,a.file));const verified=inspectAsset(a,b);assets.set(a.url,{body:b,contentType:verified.contentType,headers:{'access-control-allow-origin':'*'}});}
 for(const u of required)assert.ok(assets.has(u),'Missing exact index URL '+u);
 browser=await chromium.launch(launchOptions);
 for(const [device,viewport] of [['desktop',{width:1440,height:1000}],['mobile',{width:390,height:844}]]){
  const ctx=await browser.newContext({viewport,isMobile:device==='mobile',hasTouch:device==='mobile',serviceWorkers:'block',acceptDownloads:true});
  try{
   let stored={title:'TEST ONLY',note:'TEST SYNTHETIC — NOT FOR CLINICAL USE',clinics:[1,2].map(i=>({id:'clinic-'+i,name:'TEST CLINIC '+i,theme:i===1?'teal':'blue',changes:i===1?['','  TEST FIRST  ','TEST MIDDLE','TEST LAST',' \t\u3000']:['TEST OTHER',''],schedule:Object.fromEntries(['週一','週二','週三','週四','週五','週六'].map(d=>[d,{'早診':'TEST','午診':'TEST','晚診':'TEST'}]))}))};
   let saves=0,loads=0,publishes=0;const errors=[];const start=network.length;
   await ctx.routeWebSocket(/.*/,ws=>{network.push({device,url:ws.url(),decision:'blocked-websocket'});ws.close();});
   const origin='https://timetable.test';
   const sources=new Set(['auth-gate.js','schedule-api-config.js','schedule-save-load-core.js','clinic-order.js','publish-core.js']);
   await ctx.route('**/*',async route=>{
    const req=route.request(),u=new URL(req.url());const entry={device,url:req.url(),method:req.method(),decision:'blocked'};network.push(entry);
    const fulfill=(body,contentType='application/json',status=200)=>route.fulfill({status,contentType,body:typeof body==='object'&&!Buffer.isBuffer(body)?JSON.stringify(body):body});
    if(assets.has(req.url())&&req.method()==='GET'){entry.decision='local-static';return route.fulfill(assets.get(req.url()));}
    if(u.origin===origin){
     if(req.method()==='GET'&&u.pathname==='/'){entry.decision='unchanged-index';return fulfill(fs.readFileSync(path.join(SRC,'index.html')),'text/html');}
     if(req.method()==='GET'&&sources.has(u.pathname.slice(1))){entry.decision='unchanged-source';return fulfill(fs.readFileSync(path.join(SRC,u.pathname.slice(1))),'application/javascript');}
     if(u.pathname==='/auth-config.js'){entry.decision='synthetic-auth-config';return fulfill('window.CLINIC_AUTH_CONFIG=Object.freeze({passwordSha256Hex:"'+sha('TEST-ONLY')+'"});','application/javascript');}
     if(u.pathname==='/api/auth'&&req.method()==='POST'){assert.deepEqual(req.postDataJSON(),{password:'TEST-ONLY'});entry.decision='mock-auth';return fulfill({ok:true});}
     if(u.pathname==='/api/schedule'&&req.method()==='GET'){loads++;entry.decision='mock-load';return fulfill({ok:true,found:true,data:stored});}
     if(u.pathname==='/api/schedule'&&req.method()==='POST'){const b=req.postDataJSON();assert.equal(b.action,'save');assert.ok(b.data.clinics.every(c=>c.name.startsWith('TEST CLINIC')));stored=structuredClone(b.data);saves++;entry.decision='mock-save';return fulfill({ok:true,updatedAt:'2026-10-08T00:00:00Z'});}
     if(u.pathname.startsWith('/api/publish')||u.pathname==='/api/prepare-validation'){publishes++;entry.decision='mock-deny-publish';return fulfill({ok:false,error:'TEST_PUBLISH_FORBIDDEN'},'application/json',403);}
     if(u.pathname==='/favicon.ico'){entry.decision='local-empty';return fulfill('','image/x-icon',204);}
    }
    // No route.continue/fetch exists: unknown Google/identity/CMS/GAS and all other destinations abort.
    return route.abort('blockedbyclient');
   });
   await ctx.addInitScript(()=>{window.__printCalls=0;window.print=()=>{window.__printCalls++;};});
   const page=await ctx.newPage();page.setDefaultTimeout(45000);
   page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>consoleLog.push({device,type:m.type(),text:m.text()}));
   await page.goto(origin,{waitUntil:'load'});
   await page.locator('input[type=password]').fill('TEST-ONLY');await page.getByRole('button',{name:'登入',exact:true}).click();
   await page.locator('textarea').waitFor();await page.waitForFunction(()=>document.querySelector('textarea')?.value.includes('TEST SYNTHETIC'));
   const runtime=await page.evaluate(()=>({react:React.version,reactDOM:ReactDOM.version,babel:Babel.version}));assert.deepEqual(runtime,expectedRuntime);
   const clinics=page.locator('section').filter({has:page.getByPlaceholder('在此輸入新增異動...')});
   const rows=c=>clinics.nth(c).locator('div.flex.gap-2.mb-2').filter({has:page.locator('input:not([placeholder])')});
   const values=c=>rows(c).locator('input').evaluateAll(xs=>xs.map(x=>x.value));
   const remove=async(c,i)=>{const button=rows(c).nth(i).getByRole('button',{name:'刪除',exact:true});assert.equal(await button.count(),1,'Missing accessible per-row 刪除 button');assert.equal(await button.getAttribute('type'),'button');const box=await button.boundingBox();assert.ok(box.width>=44&&box.height>=44,'44px touch target');await button.click();};
   const initial=structuredClone(stored),other=await values(1);
   assert.deepEqual(await values(0),initial.clinics[0].changes);
   await remove(0,0);assert.deepEqual(await values(0),initial.clinics[0].changes.slice(1));
   await remove(0,1);assert.deepEqual(await values(0),['  TEST FIRST  ','TEST LAST',' \t\u3000']);
   await remove(0,2);await remove(0,1);await remove(0,0);assert.deepEqual(await values(0),[]);
   assert.deepEqual(await values(1),other);assert.equal(saves,0);assert.equal(loads,1);assert.equal(publishes,0);assert.deepEqual(stored,initial);
   // Explicit save/load verifies the empty array through the actual UI contract.
   const save=async()=>{await page.getByRole('button',{name:'儲存本月門診',exact:true}).click();await page.getByText(/已儲存 .* 門診資料/).waitFor();};
   const load=async()=>{await page.getByRole('button',{name:'載入本月門診',exact:true}).click();await page.getByText(/已載入 .* 門診資料/).waitFor();};
   await save();assert.deepEqual(stored,{...initial,clinics:[{...initial.clinics[0],changes:[]},initial.clinics[1]]});
   await load();assert.deepEqual(await values(0),[]);
   const plus=c=>clinics.nth(c).locator('button').filter({has:page.locator('svg.lucide-plus, i[data-lucide="plus"]')});
   await plus(0).click();assert.deepEqual(await values(0),['']);await rows(0).nth(0).locator('input').fill('  TEST FIRST  ');
   await plus(0).click();await rows(0).nth(1).locator('input').fill(' \t\u3000');await plus(0).click();
   assert.deepEqual(await values(1),other);
   // Also exercise the second clinic, including its legacy blank row.
   await remove(1,1);assert.deepEqual(await values(0),['  TEST FIRST  ',' \t\u3000','']);
   await plus(1).click();assert.deepEqual(await values(1),other);
   assert.equal(saves,1);assert.equal(loads,2);assert.equal(publishes,0);
   await save();const saved=structuredClone(stored);await rows(0).nth(0).locator('input').fill('TEST UNSAVED');await load();
   assert.deepEqual(await values(0),saved.clinics[0].changes);assert.deepEqual(await values(1),saved.clinics[1].changes);
   assert.deepEqual(saved,{...initial,clinics:[{...initial.clinics[0],changes:['  TEST FIRST  ',' \t\u3000','']},initial.clinics[1]]});
   if(!phase.startsWith('delete-')){
    for(const poster of await page.locator('main').all()){
     const bullets=poster.locator('span').filter({hasText:/^•$/});
     assert.equal(await bullets.count(),2,'Whitespace-only exception rows must not render empty bullets');
     assert.deepEqual(await bullets.evaluateAll(xs=>xs.map(x=>x.nextElementSibling.textContent)),['  TEST FIRST  ','TEST OTHER']);
    }
   }
   if(!phase.startsWith('delete-')){
    await rows(0).nth(0).locator('input').fill('   ');
    for(const poster of await page.locator('main').all()){
     assert.equal(await poster.locator('span').filter({hasText:/^•$/}).count(),1,'All-blank clinic renders no bullets');
     assert.equal((await poster.textContent()).split('門診異動').length-1,2,'Existing section titles remain');
    }
    await rows(0).nth(0).locator('input').fill('  TEST FIRST  ');
    assert.equal(saves,2);assert.equal(loads,3);assert.equal(publishes,0);
   }
   await page.screenshot({path:path.join(ROOT,device+'-editor.png'),fullPage:true});
   assert.equal(await page.locator('main').count(),2,'Expected capture poster and live preview');const preview=page.locator('main').nth(1);await preview.scrollIntoViewIfNeeded();assert.ok((await preview.textContent()).includes(saved.note));assert.ok((await preview.textContent()).includes('TEST CLINIC 1'));
   const fonts=await page.evaluate(async()=>{await document.fonts.ready;return [...document.fonts].map(f=>({family:f.family,weight:f.weight,status:f.status}));});assert.equal(fonts.filter(f=>f.family==='Noto Sans TC'&&f.status==='loaded').length,3,'All three poster font weights must load');await page.screenshot({path:path.join(ROOT,device+'-preview.png'),fullPage:true});
   const pending=page.waitForEvent('download',{timeout:120000});await page.getByRole('button',{name:'下載高清 PNG 海報',exact:true}).click();const download=await pending;
   const pngPath=path.join(ROOT,device+'-download.png');await download.saveAs(pngPath);assert.equal(await download.failure(),null);
   const png=fs.readFileSync(pngPath);assert.equal(png.subarray(0,8).toString('hex'),'89504e470d0a1a0a');assert.equal(png.readUInt32BE(16),2160);assert.equal(png.readUInt32BE(20),3840);
   const decoded=await page.evaluate(async b64=>{const i=new Image();i.src='data:image/png;base64,'+b64;await i.decode();const c=document.createElement('canvas');c.width=i.width;c.height=i.height;const g=c.getContext('2d');g.drawImage(i,0,0);const b=g.getImageData(0,0,c.width,c.height).data;let different=0;for(let n=0;n<b.length;n+=400)if(b[n]!==b[0]||b[n+1]!==b[1]||b[n+2]!==b[2])different++;return {width:i.width,height:i.height,different};},png.toString('base64'));
   assert.equal(decoded.width,2160);assert.equal(decoded.height,3840);assert.ok(decoded.different>100,'PNG is not blank');
   await page.evaluate(()=>window.print());assert.equal(await page.evaluate(()=>window.__printCalls),1);
   assert.deepEqual(errors,[]);assert.equal(publishes,0);assert.ok(network.slice(start).every(e=>!e.decision.startsWith('blocked')));
   result.cases.push({device,status:'PASS',runtime,saves,loads,publishes,print:'mock invoked once; no product print UI',png:{file:path.basename(pngPath),sha256:sha(png),bytes:png.length,...decoded},fonts,preview:device+'-preview.png'});
  }finally{await ctx.close();}
 }
 result.status='PASS_WITH_PRINT_LIMITATION';result.forwardedRequests=0;result.realPublishes=0;
}catch(e){result.status='BLOCKED_OR_FAILED';result.error=e.stack;process.exitCode=1;}finally{
 try { if(browser)await browser.close(); } catch(e) {result.cleanupError=String(e);process.exitCode=1;} const after=snapshot();write('source-after.json',after);result.sourceUnchanged=JSON.stringify(before.files)===JSON.stringify(after.files);if(!result.sourceUnchanged){result.status='FAIL_SOURCE_CHANGED';process.exitCode=1;}
 write(process.argv.includes('--probe')?'browser-probe.json':'results.json',result);write('network-log.json',network);write('browser-console.json',consoleLog);console.log(JSON.stringify(result,null,2));
}})();
