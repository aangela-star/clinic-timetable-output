const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),vm=require('node:vm');
const {targetFingerprint}=require('../lib/publish-target');
const {LocalStore,hash}=require('../lib/publish-store-mock');
const {createAdapter,createAppsScriptTransport,MAX_BODY_BYTES}=require('../lib/publish-store-adapter');
const fixture={require,Buffer};vm.runInNewContext(fs.readFileSync(require.resolve('./publish_contract.test.cjs'),'utf8').split("test('")[0]+';globalThis.png=validPngBuffer();',fixture);
const data={title:'115/九月',note:'',clinics:[]};
function setup(faults={}){const root=fs.mkdtempSync(os.tmpdir()+'/publish-test-');const store=new LocalStore(root,faults);const adapter=createAdapter({enabled:true,store,mock:true,readSchedule:async()=>data,publicRead:async()=>store.bytes((await store.call('pointer')).blobId)});return{root,store,adapter};}
async function prepare(s,session='a',patch={}){return s.adapter.handle('prepare',{baseline:await s.store.call('pointer'),data,monthKey:'2026-09',pngDataUrl:'data:image/png;base64,'+fixture.png.toString('base64'),pngSha256:hash(fixture.png),targetPointerId:'jinan-website/current',...patch},session);}
const binding=p=>({approvalId:p.approvalId,nonce:p.nonce});
test('default disabled makes zero calls',async()=>{assert.equal((await createAdapter({store:{call(){throw Error('network');}}}).handle('pointer')).status,'CMS_RESPONSE_CONTRACT_UNVERIFIED');});
test('prepare never changes pointer; session/nonce theft, tamper, save equality and size rejected',async()=>{const s=setup();const p=await prepare(s);assert.equal((await s.store.call('pointer')).pointerVersion,0);assert.equal((await s.adapter.handle('confirm',binding(p),'thief')).status,'INVALID_APPROVAL');assert.equal((await s.adapter.handle('confirm',{...binding(p),nonce:'stolen'},'a')).status,'INVALID_APPROVAL');assert.equal((await prepare(s,'a',{pngSha256:'bad'})).status,'INVALID_PNG');assert.equal((await prepare(s,'a',{data:{title:'SYNTHETIC MOCK'}})).status,'SAVE_REQUIRED');assert.equal((await prepare(s,'a',{data:{title:''}})).status,'INVALID_REQUEST');assert.equal((await prepare(s,'a',{pngDataUrl:'x'.repeat(3400000)})).status,'BODY_TOO_LARGE');});
test('independent instances concurrent confirms CAS once, duplicates reconcile',async()=>{const s=setup();const p=await prepare(s),q=await prepare(s,'b');const other={...s,store:new LocalStore(s.root)};other.adapter=createAdapter({enabled:true,store:other.store,publicRead:async()=>other.store.bytes((await other.store.call('pointer')).blobId)});const results=await Promise.all([s.adapter.handle('confirm',binding(p),'a'),other.adapter.handle('confirm',binding(q),'b')]);assert.deepEqual(results.map(r=>r.status).sort(),['PUBLISHED','STALE_BASELINE']);assert.equal((await s.store.call('pointer')).pointerVersion,1);assert.equal((await other.adapter.handle('confirm',binding(p),'a')).status,'PUBLISHED');assert.equal((await s.store.call('pointer')).pointerVersion,1);});
for(const fault of ['dropResponse','afterPointer','beforePointer','cache'])test('restart reconciliation: '+fault,async()=>{const s=setup();const p=await prepare(s);s.store.faults[fault]=true;const first=await s.adapter.handle('confirm',binding(p),'a');assert.equal(first.status,['dropResponse','afterPointer'].includes(fault)?'PUBLISHED':'MANUAL_CHECK_REQUIRED');const restarted=new LocalStore(s.root);const a=createAdapter({enabled:true,store:restarted,publicRead:async()=>restarted.bytes((await restarted.call('pointer')).blobId)});const r=await a.handle('confirm',binding(p),'a');assert.equal(r.status,fault==='beforePointer'?'MANUAL_CHECK_REQUIRED':'PUBLISHED');assert.equal((await restarted.call('pointer')).pointerVersion,fault==='beforePointer'?0:1);});
test('localhost HTTP auth, save, prepare, confirm, public image, limits',async t=>{const {createHarness}=require('../tools/mock-publish-store-server');const {server,store}=createHarness(fs.mkdtempSync(os.tmpdir()+'/publish-http-'));try {await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});} catch(e) {if(e.code==='EPERM'){t.skip('Sandbox prohibits localhost listener (EPERM); HTTP acceptance remains unverified');return;}throw e;}t.after(()=>server.close());const base='http://127.0.0.1:'+server.address().port;let cookie='';async function call(url,body){const r=await fetch(base+url,{method:body?'POST':'GET',headers:{cookie,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});return {r,b:await r.json()};}assert.equal((await call('/api/publish?pointer=jinan-website')).r.status,401);const login=await call('/api/auth',{});cookie=login.r.headers.get('set-cookie').split(';')[0];await call('/api/schedule',{action:'save',month:'2026-09',data});const baselineResponse=await call('/api/publish?pointer=jinan-website');assert.equal(baselineResponse.r.status,200);assert.equal(baselineResponse.b.status,'BASELINE');const b=baselineResponse.b.baseline;const p=(await call('/api/publish',{op:'prepare',input:{baseline:b,data,monthKey:'2026-09',pngDataUrl:'data:image/png;base64,'+fixture.png.toString('base64'),pngSha256:hash(fixture.png),targetPointerId:'jinan-website/current'}})).b;assert.ok(p.ok);const r=await call('/api/publish',{op:'confirm',input:binding(p)});assert.equal(r.b.status,'PUBLISHED');assert.equal(r.b.mock,true);assert.equal(r.r.headers.get('cache-control'),'no-store');const image=await fetch(base+'/api/publish-image');assert.equal(hash(Buffer.from(await image.arrayBuffer())),hash(fixture.png));assert.match(await(await fetch(base+'/public/jinan')).text(),/MOCK.*675px/);assert.equal((await call('/api/publish',{op:'confirm',input:binding(p)})).b.status,'PUBLISHED');assert.equal((await store.call('pointer')).pointerVersion,1);assert.equal((await call('/api/publish',{x:'x'.repeat(MAX_BODY_BYTES)})).r.status,413);});
test('Apps Script VM transport actually persists Drive blob / journal / pointer under lock',async()=>{
 const sheets=new Map(),files=new Map();let locked=false;
 const sheet=()=>{const rows=[];return{getLastRow:()=>rows.length,getDataRange:()=>({getValues:()=>rows}),getRange:(r,c,n=1,m=1)=>({getValue:()=>rows[r-1]?.[c-1]||'',setValue:v=>{assert.ok(locked);(rows[r-1]??=[])[c-1]=v;},setValues:vs=>{assert.ok(locked);vs.forEach((row,i)=>row.forEach((v,j)=>(rows[r+i-1]??=[])[c+j-1]=v));}})};};
 const crypto=require('node:crypto');const ctx={module:{exports:{}},Date,JSON,Error,PropertiesService:{getScriptProperties:()=>({getProperty:k=>k==='PUBLISH_STORE_ENABLED'?'true':k==='CLINIC_SERVER_SECRET'?'synthetic-test-only':'folder'})},LockService:{getScriptLock:()=>({tryLock:()=>{assert.ok(!locked);locked=true;return true;},releaseLock:()=>{locked=false;}})},SpreadsheetApp:{flush(){assert.ok(locked);},getActiveSpreadsheet:()=>({getSheetByName:n=>sheets.get(n),insertSheet:n=>{const s=sheet();sheets.set(n,s);return s;}})},Utilities:{getUuid:()=>crypto.randomUUID(),DigestAlgorithm:{SHA_256:'sha256'},computeDigest:(_,b)=>[...crypto.createHash('sha256').update(Buffer.from(b)).digest()],base64Decode:s=>[...Buffer.from(s,'base64')],base64Encode:b=>Buffer.from(b).toString('base64'),newBlob:b=>({getBytes:()=>b})},DriveApp:{getFolderById:()=>({createFile:b=>{const id=crypto.randomUUID();files.set(id,b);return{getId:()=>id};}}),getFileById:id=>({getBlob:()=>files.get(id)})},json_:x=>x};
 vm.runInNewContext(fs.readFileSync('apps-script/PublishStore.gs','utf8'),ctx);
 const transport=createAppsScriptTransport({enabled:true,url:'mock://apps-script',secret:'synthetic-test-only',fetchImpl:async(_,options)=>{const body=JSON.parse(options.body);assert.equal(body.action,'publish');return{ok:true,json:async()=>ctx.publishRequest_(body)};}});
 const baseline=await transport.call('pointer');const p=await transport.call('prepare',{baseline,session:'a',executorId:'server',targetPointerId:'jinan-website/current',monthKey:'2026-09',pngBase64:fixture.png.toString('base64'),pngSha256:hash(fixture.png)});assert.equal((await transport.call('pointer')).pointerVersion,0);const r=await transport.call('confirm',{...binding(p),session:'a',executorId:'server'});assert.equal(r.pointer.pointerVersion,1);assert.equal(hash(await transport.bytes(r.job.blobId)),hash(fixture.png));assert.equal(files.size,1);assert.ok(sheets.has('ConsumedNonces'));
 // Exercise actual authenticated Apps Script dispatch plus the production factory, without credentials.
 vm.runInNewContext(fs.readFileSync('apps-script/Code.gs','utf8'),ctx);ctx.json_=x=>x;
 assert.equal(ctx.doPost({postData:{contents:JSON.stringify({action:'publish',op:'pointer',secret:'wrong'})}}).ok,false);
 const {createProvider}=require('../lib/publish-provider');
 const pageUrl='https://www.tainanrehab.com/time.html',imageUrl='https://clinic-timetable-output.vercel.app/api/publish-image';
 const html='<img src="'+imageUrl+'" style="width:675px;height:1200px">';
 const factory=createProvider({config:{PUBLISH_IMAGE_ENABLED:'true',PUBLISH_FLOW_ENABLED:'true',PUBLISH_PUBLIC_PAGE_URL:pageUrl,PUBLISH_PUBLIC_IMAGE_URL:imageUrl,PUBLISH_PUBLIC_TARGET_SHA256:targetFingerprint(html,pageUrl,imageUrl)},getSecret:()=> 'synthetic-test-only',fetchImpl:async(url,options)=>{
  if(options.method==='GET')return new Response(url===pageUrl?html:await transport.bytes((await transport.call('pointer')).blobId),{headers:{'Content-Type':url===pageUrl?'text/html':'image/png'}});
  const body=JSON.parse(options.body);
  if(body.action==='load')return Response.json({ok:true,found:true,month:body.month,schemaVersion:1,data});
  return Response.json(ctx.doPost({postData:{contents:options.body}}));
 }});
 const job=await factory.adapter.handle('prepare',{baseline:await transport.call('pointer'),data,monthKey:'2026-09',pngDataUrl:'data:image/png;base64,'+fixture.png.toString('base64'),pngSha256:hash(fixture.png),targetPointerId:'jinan-website/current'},'vm-session');
 assert.equal(job.status,'PREPARED');
 assert.equal((await factory.adapter.handle('confirm',binding(job),'vm-session')).status,'PUBLISHED');
 assert.equal((await factory.adapter.handle('confirm',binding(job),'vm-session')).status,'PUBLISHED');
 assert.equal((await transport.call('pointer')).pointerVersion,2);assert.equal(files.size,2);

});
test('in-process publish API uses same contract and redacts journal/provider fields',async()=>{
 const s=setup();const {createPublishApi}=require('../lib/publish-api');const api=createPublishApi({adapter:s.adapter,identity:()=> 'a'});
 async function invoke(body,method='POST'){let output;const headers={};await api({method,body,headers:{'content-type':'application/json',host:'localhost'}},{setHeader:(k,v)=>headers[k]=v,end:v=>output=JSON.parse(v)});assert.equal(headers['Cache-Control'],'no-store');return output;}
 const b=await invoke('','GET');assert.deepEqual(await invoke('  \n','GET'),b);assert.deepEqual(Object.keys(b.baseline).sort(),['pointerEtag','pointerVersion']);
 const input={baseline:b.baseline,data,monthKey:'2026-09',pngDataUrl:'data:image/png;base64,'+fixture.png.toString('base64'),pngSha256:hash(fixture.png),targetPointerId:'jinan-website/current'};
 const p=await invoke({op:'prepare',input});assert.ok(p.ok);assert.equal(p.confirmedBySession,undefined);assert.equal(p.executorId,undefined);
 assert.equal((await invoke({op:'confirm',input:binding(p)})).status,'PUBLISHED');
 assert.equal((await invoke({op:'confirm',input:{...binding(p),enabled:true}})).error,'INVALID_REQUEST');
 assert.equal((await invoke('x'.repeat(MAX_BODY_BYTES+1))).error,'BODY_TOO_LARGE');
});
test('Apps Script transaction engine stays byte identical to tested Node engine',()=>{
 assert.ok(fs.readFileSync('apps-script/PublishStore.gs','utf8').startsWith(fs.readFileSync('lib/publish-store-engine.js','utf8')));
});
test('actual process death after pointer persistence: restart reads journal without reacquiring abandoned write lock',async()=>{
 const s=setup(),p=await prepare(s);
 const {spawnSync}=require('node:child_process');
 const code=`const {LocalStore}=require('./lib/publish-store-mock');const s=new LocalStore(process.argv[1]);const original=s.write.bind(s);s.write=(name,value)=>{original(name,value);if(name==='pointer.json')process.exit(91);};s.call('confirm',JSON.parse(process.argv[2]));`;
 const child=spawnSync(process.execPath,['-e',code,s.root,JSON.stringify({...binding(p),session:'a',executorId:'vercel-publish-v1'})]);assert.equal(child.status,91);
 assert.ok(fs.existsSync(s.root+'/lock'));
 const r=await s.adapter.handle('reconcile',binding(p),'a');assert.equal(r.status,'PUBLISHED');assert.equal((await s.store.call('pointer')).pointerVersion,1);
});

test('local latency and repeated confirms preserve exact bytes and one blob/version',async()=>{
 const s=setup({latencyMs:2}),start=Date.now(),p=await prepare(s);
 for(let i=0;i<2;i++)assert.equal((await s.adapter.handle('confirm',binding(p),'a')).status,'PUBLISHED');
 assert.ok(Date.now()-start>=2);assert.equal((await s.store.call('pointer')).pointerVersion,1);
 assert.equal(fs.readdirSync(s.root).filter(n=>n.startsWith('blob-')).length,1);
 assert.deepEqual(await s.store.bytes((await s.store.call('pointer')).blobId),fixture.png);
});
test('transient first engine write has no effects; confirm fault reconciles without retry',async()=>{
 const s=setup({transientOnce:true});await assert.rejects(prepare(s),/STORE_UNAVAILABLE/);
 assert.equal(fs.readdirSync(s.root).length,0);
 const p=await prepare(s);s.store.transientUsed=false;
 let confirms=0;const original=s.store.call.bind(s.store);s.store.call=(op,input)=>{if(op==='confirm')confirms++;return original(op,input);};
 assert.equal((await s.adapter.handle('confirm',binding(p),'a')).status,'MANUAL_CHECK_REQUIRED');assert.equal(confirms,1);
 assert.equal((await s.store.call('pointer')).pointerVersion,0);
 assert.equal((await s.adapter.handle('reconcile',binding(p),'a')).status,'MANUAL_CHECK_REQUIRED');assert.equal(confirms,1);
 // Explicit simulated second caller; never an automatic retry.
 assert.equal((await s.adapter.handle('confirm',binding(p),'a')).status,'PUBLISHED');assert.equal(confirms,2);
 assert.equal(fs.readdirSync(s.root).filter(n=>n.startsWith('blob-')).length,1);
});
test('AbortError confirm remains ambiguous and reconciliation does not mutate',async()=>{
 const s=setup(),p=await prepare(s);s.store.faults.timeout='confirm';let confirms=0;
 const original=s.store.call.bind(s.store);s.store.call=(op,input)=>{if(op==='confirm')confirms++;return original(op,input);};
 assert.equal((await s.adapter.handle('confirm',binding(p),'a')).status,'MANUAL_CHECK_REQUIRED');
 const before=fs.readdirSync(s.root).map(n=>[n,hash(fs.readFileSync(s.root+'/'+n))]);
 assert.equal((await s.adapter.handle('reconcile',binding(p),'a')).status,'MANUAL_CHECK_REQUIRED');
 assert.deepEqual(fs.readdirSync(s.root).map(n=>[n,hash(fs.readFileSync(s.root+'/'+n))]),before);assert.equal(confirms,1);
});
test('HTTP harness never supplies simulation faults',()=>{
 const {createHarness}=require('../tools/mock-publish-store-server');
 const h=createHarness(fs.mkdtempSync(os.tmpdir()+'/publish-no-fault-'));assert.deepEqual(h.store.faults,{});h.server.close();
});
test('production transport deadline actually aborts delayed fetch using VM-only short clock',async()=>{
 const deadlines=[],context={module:{exports:{}},require:n=>n.startsWith('.')?require(require('node:path').resolve('lib',n)):require(n),Buffer,setTimeout,
  AbortSignal:{timeout:ms=>{deadlines.push(ms);return AbortSignal.timeout(5);}}};
 vm.runInNewContext(fs.readFileSync('lib/publish-store-adapter.js','utf8'),context);
 const transport=context.module.exports.createAppsScriptTransport({enabled:true,url:'https://synthetic.invalid',secret:'synthetic',fetchImpl:async(_,o)=>new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>resolve(Response.json({ok:true,result:{}})),100);
  o.signal.addEventListener('abort',()=>{clearTimeout(timer);reject(o.signal.reason);},{once:true});
 })});
 await assert.rejects(transport.call('confirm',{}),e=>e.name==='TimeoutError');assert.deepEqual(deadlines,[25000]);
});
