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
// Separate containers make accidental use of the bound schedule workbook observable.
function appsScriptHarness(options={}) {
 const crypto=require('node:crypto'),events=[],files=new Map();let locked=false;
 const props={PUBLISH_STORE_ENABLED:'true',PUBLISH_SPREADSHEET_ID:' ledger ',PUBLISH_FOLDER_ID:'folder',CLINIC_SERVER_SECRET:'synthetic-test-only',...options.props};
 function touch(label,write=false){events.push(label);if(write){assert.ok(locked,label);if(options.denyWrites)throw Error('READ_ATTEMPTED_WRITE');}if(options.failAt===label)throw Error('injected');}
 function workbook(id,label){
  const sheets=new Map();
  function sheet(){const rows=[];return {rows,
   getLastRow(){touch(label+'.lastRow');return rows.length;},
   getDataRange(){touch(label+'.dataRange');return {getValues:()=>rows.map(r=>r.slice())};},
   setFrozenRows(){touch(label+'.freeze',true);},
   deleteRow(r){touch(label+'.delete',true);rows.splice(r-1,1);},
   getRange(r,c,n=1,m=1){touch(label+'.range');const values=()=>Array.from({length:n},(_,i)=>Array.from({length:m},(_,j)=>rows[r+i-1]?.[c+j-1]??''));return {
    getValue:()=>values()[0][0],getValues:values,getDisplayValues:()=>values().map(row=>row.map(String)),
    setNumberFormat(){touch(label+'.format',true);},
    setValue(v){touch(label+'.write',true);(rows[r-1]??=[])[c-1]=v;},
    setValues(vs){touch(label+'.write',true);vs.forEach((row,i)=>row.forEach((v,j)=>(rows[r+i-1]??=[])[c+j-1]=v));}
   };}
  };}
  return {sheets,getId(){touch(label+'.id');return id;},getSheetByName(n){touch(label+'.sheet');return sheets.get(n);},insertSheet(n){touch(label+'.insert',true);const s=sheet();sheets.set(n,s);return s;}};
 }
 const schedule=workbook('schedule','schedule'),ledger=workbook('ledger','ledger');
 const ctx={Date,JSON,Error,
  PropertiesService:{getScriptProperties:()=>({getProperty:k=>{events.push('property.'+k);return props[k];}})},
  LockService:{getScriptLock:()=>({tryLock(ms){events.push('lock');assert.equal(ms,10000);assert.equal(locked,false);locked=options.lockAvailable!==false;return locked;},hasLock:()=>locked,releaseLock(){assert.ok(locked);events.push('release');locked=false;}})},
  SpreadsheetApp:{getActiveSpreadsheet(){touch('active');return Object.hasOwn(options,'active')?options.active:schedule;},openById(id){touch('open');assert.ok(locked);assert.equal(id,'ledger');return Object.hasOwn(options,'opened')?options.opened:ledger;},flush(){touch('flush',true);}},
  Utilities:{getUuid:()=>crypto.randomUUID(),DigestAlgorithm:{SHA_256:'sha256'},computeDigest:(_,b)=>[...crypto.createHash('sha256').update(Buffer.from(b)).digest()],base64Decode:s=>[...Buffer.from(s,'base64')],base64Encode:b=>Buffer.from(b).toString('base64'),newBlob:b=>({getBytes:()=>b})},
  DriveApp:{getFolderById(id){touch('drive.folder',true);assert.equal(id,'folder');return {createFile(b){touch('drive.create',true);const id=crypto.randomUUID();files.set(id,b);return {getId:()=>id};}};},getFileById(id){touch('drive.read');return {getBlob:()=>files.get(id)};}},json_:x=>x
 };
 vm.createContext(ctx);vm.runInContext(fs.readFileSync('apps-script/PublishStore.gs','utf8'),ctx);
 vm.runInContext(fs.readFileSync('apps-script/Code.gs','utf8'),ctx);ctx.json_=x=>x;
 const post=body=>ctx.doPost({postData:{contents:JSON.stringify({secret:'synthetic-test-only',...body})}});
 const call=(op,input={})=>post({action:'publish',op,input});
 return {ctx,props,events,files,schedule,ledger,post,call,options,isLocked:()=>locked};
}
test('Apps Script VM transport actually persists Drive blob / journal / pointer under lock',async()=>{
 const h=appsScriptHarness(),{ctx,files}=h,sheets=h.ledger.sheets;
 const transport=createAppsScriptTransport({enabled:true,url:'mock://apps-script',secret:'synthetic-test-only',fetchImpl:async(_,options)=>{const body=JSON.parse(options.body);assert.equal(body.action,'publish');return{ok:true,json:async()=>ctx.publishRequest_(body)};}});
 const baseline=await transport.call('pointer');const p=await transport.call('prepare',{baseline,session:'a',executorId:'server',targetPointerId:'jinan-website/current',monthKey:'2026-09',pngBase64:fixture.png.toString('base64'),pngSha256:hash(fixture.png)});assert.equal((await transport.call('pointer')).pointerVersion,0);const r=await transport.call('confirm',{...binding(p),session:'a',executorId:'server'});assert.equal(r.pointer.pointerVersion,1);assert.equal(hash(await transport.bytes(r.job.blobId)),hash(fixture.png));assert.equal(files.size,1);assert.ok(sheets.has('ConsumedNonces'));
 // Exercise actual authenticated Apps Script dispatch plus the production factory, without credentials.
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
 assert.ok(h.events.filter(e=>e.startsWith('schedule.')).every(e=>e==='schedule.id'));
 assert.equal(h.schedule.sheets.size,0);assert.equal(h.isLocked(),false);

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

const invalidLedgerConfigs=[
 ['unset',{props:{PUBLISH_SPREADSHEET_ID:undefined}}],
 ['null property',{props:{PUBLISH_SPREADSHEET_ID:null}}],
 ['empty',{props:{PUBLISH_SPREADSHEET_ID:''}}],
 ['blank',{props:{PUBLISH_SPREADSHEET_ID:' \t\n '}}],
 ['nonstring property',{props:{PUBLISH_SPREADSHEET_ID:123}}],
 ['same schedule',{props:{PUBLISH_SPREADSHEET_ID:' schedule '}}],
 ['null active',{active:null}],['active throws',{failAt:'active'}],
 ['active ID throws',{failAt:'schedule.id'}],['active missing getId',{active:{}}],
 ...[undefined,null,'',' \t',123,{}].map(id=>['active identity '+JSON.stringify(id),{active:{getId:()=>id}}]),
 ['trimmed same active',{active:{getId:()=> ' ledger '}}],
 ['inaccessible ledger',{failAt:'open'}],['null ledger',{opened:null}],
 ['ledger missing getId',{opened:{}}],['ledger ID throws',{failAt:'ledger.id'}],
 ...[undefined,null,'',' \t',123,{},'other',' ledger '].map(id=>['opened identity '+JSON.stringify(id),{opened:{getId:()=>id}}])
];
for(const [name,options] of invalidLedgerConfigs)test('Apps Script independent ledger fails closed: '+name,()=>{
 for(const op of ['pointer','prepare','confirm','reconcile','blob']){
  const h=appsScriptHarness(options);
  assert.equal(h.call(op).error,'STORE_UNAVAILABLE',op);
  assert.equal(h.isLocked(),false);assert.equal(h.events.at(-1),'release');
  assert.equal(h.events.filter(e=>e==='release').length,1);
  assert.ok(!h.events.some(e=>/\.(sheet|insert|range|dataRange|write)|^drive\.|^flush$/.test(e)),h.events.join(','));
  assert.equal(h.files.size,0);assert.equal(h.schedule.sheets.size,0);assert.equal(h.ledger.sheets.size,0);
  assert.ok(h.events.filter(e=>e.startsWith('schedule.')).every(e=>e==='schedule.id'));
  if(!name.startsWith('opened identity')&&!['inaccessible ledger','null ledger','ledger missing getId','ledger ID throws'].includes(name))assert.ok(!h.events.includes('open'));
  if(!h.events.includes('open'))assert.ok(!h.events.includes('ledger.id'));
 }
});
test('Apps Script disabled and denied lock perform zero workbook or Drive access',()=>{
 for(const options of [{props:{PUBLISH_STORE_ENABLED:undefined}},{lockAvailable:false}]){
  const h=appsScriptHarness(options);assert.equal(h.call('pointer').error,options.lockAvailable===false?'STORE_LOCKED':'CMS_RESPONSE_CONTRACT_UNVERIFIED');
  assert.ok(h.events.every(e=>e.startsWith('property.')||e==='lock'));assert.equal(h.isLocked(),false);
  assert.ok(!h.events.includes('property.PUBLISH_SPREADSHEET_ID'));
 }
});
function vmPrepare(h,baseline=h.call('pointer').result){return h.call('prepare',{baseline,session:'a',executorId:'server',targetPointerId:'jinan-website/current',monthKey:'2026-09',pngBase64:fixture.png.toString('base64'),pngSha256:hash(fixture.png)}).result;}
const vmBinding=p=>({...binding(p),session:'a',executorId:'server'});
test('Apps Script independent ledger CAS, nonce, duplicate, reconcile and journal-only blob reads',()=>{
 const h=appsScriptHarness(),p=vmPrepare(h),q=vmPrepare(h);
 assert.equal(h.call('pointer').result.pointerVersion,0);
 for(const patch of [{session:'thief'},{nonce:'wrong'},{executorId:'wrong'}])assert.equal(h.call('confirm',{...vmBinding(p),...patch}).result.status,'INVALID_APPROVAL');
 const before=h.events.length;assert.equal(h.call('blob',{blobId:'unregistered'}).error,'STORE_UNAVAILABLE');
 assert.ok(!h.events.slice(before).includes('drive.read'));
 const r=h.call('confirm',vmBinding(p)).result;assert.equal(r.job.status,'CONSUMED');assert.equal(r.pointer.pointerVersion,1);
 assert.equal(h.call('confirm',vmBinding(q)).result.status,'STALE_BASELINE');
 const writes=h.events.filter(e=>e.endsWith('.write')).length;
 assert.equal(h.call('confirm',vmBinding(p)).result.status,'RECONCILE');
 assert.equal(h.call('reconcile',vmBinding(p)).result.job.status,'CONSUMED');
 assert.equal(h.call('blob',{blobId:r.job.blobId}).result.base64,fixture.png.toString('base64'));
 assert.equal(h.events.filter(e=>e.endsWith('.write')).length,writes);
 assert.equal(h.call('pointer').result.pointerVersion,1);assert.equal(h.files.size,2);
 assert.deepEqual([...h.ledger.sheets.keys()],['PublishPointer','ConsumedNonces']);
 assert.equal(h.schedule.sheets.size,0);assert.ok(h.events.filter(e=>e.startsWith('schedule.')).every(e=>e==='schedule.id'));
 assert.equal(h.events.filter(e=>e==='lock').length,h.events.filter(e=>e==='release').length);
 const confirmEvents=h.events.slice(before);assert.ok(confirmEvents.includes('flush'));
 assert.ok(h.events.indexOf('ledger.id')<h.events.indexOf('ledger.sheet'));
 const firstWrite=confirmEvents.indexOf('ledger.write');
 assert.deepEqual(confirmEvents.slice(firstWrite).filter(e=>e==='ledger.write'||e==='flush').slice(0,6),['ledger.write','flush','ledger.write','flush','ledger.write','flush']);
});
for(const failAt of ['ledger.sheet','ledger.insert','ledger.range','drive.folder','drive.create','drive.read','ledger.write','flush'])test('Apps Script releases lock after '+failAt+' failure',()=>{
 const h=appsScriptHarness({failAt});const result=h.call('prepare',{baseline:{pointerVersion:0,pointerEtag:'empty'},session:'a',executorId:'server',targetPointerId:'jinan-website/current',monthKey:'2026-09',pngBase64:fixture.png.toString('base64'),pngSha256:hash(fixture.png)});
 assert.equal(result.error,'STORE_UNAVAILABLE');assert.ok(h.events.includes(failAt));assert.equal(h.events.at(-1),'release');assert.equal(h.isLocked(),false);
 assert.equal(h.schedule.sheets.size,0);
});
test('deployed Code.gs and PublishStore.gs together Save/Load without ledger property',()=>{
 const h=appsScriptHarness({props:{PUBLISH_SPREADSHEET_ID:undefined}});
 const saved={title:'SYNTHETIC MOCK',note:'local isolation',clinics:[{schedule:{},changes:[]}]};
 const save=()=>h.post({action:'save',month:'2026-09',data:saved});
 const load=()=>h.post({action:'load',month:'2026-09'});
 assert.equal(save().ok,true);assert.deepEqual(load().data,saved);
 assert.equal(h.call('pointer').error,'STORE_UNAVAILABLE');
 assert.equal(save().ok,true);assert.deepEqual(load().data,saved);
 assert.deepEqual([...h.schedule.sheets.keys()],['Schedules']);assert.equal(h.ledger.sheets.size,0);
 assert.equal(h.files.size,0);assert.ok(!h.events.includes('open'));
 // With an explicit independent ledger, publish and subsequent Save/Load remain isolated.
 h.props.PUBLISH_SPREADSHEET_ID='ledger';const rows=JSON.stringify(h.schedule.sheets.get('Schedules').rows);
 const start=h.events.length,p=vmPrepare(h),r=h.call('confirm',vmBinding(p)).result;
 assert.equal(JSON.stringify(h.schedule.sheets.get('Schedules').rows),rows);
 assert.ok(h.events.slice(start).filter(e=>e.startsWith('schedule.')).every(e=>e==='schedule.id'));
 assert.equal(save().ok,true);assert.deepEqual(load().data,saved);
 assert.equal(JSON.stringify(h.call('pointer').result),JSON.stringify(r.pointer));assert.equal(h.isLocked(),false);
});

test('Apps Script ledger preserves MUTATING intent after pointer failure; reconciliation never retries',()=>{
 const h=appsScriptHarness(),p=vmPrepare(h);
 const pointer=h.ledger.sheets.get('PublishPointer'),getRange=pointer.getRange;
 pointer.getRange=(...args)=>{const range=getRange(...args);range.setValue=()=>{throw Error('pointer failure');};return range;};
 assert.equal(h.call('confirm',vmBinding(p)).error,'STORE_UNAVAILABLE');assert.equal(h.isLocked(),false);
 pointer.getRange=getRange;
 const writes=h.events.filter(e=>e.endsWith('.write')).length;
 for(const op of ['reconcile','confirm']){const r=h.call(op,vmBinding(p)).result;assert.equal(r.job.status,'MUTATING');assert.equal(r.pointer.pointerVersion,0);}
 assert.equal(h.events.filter(e=>e.endsWith('.write')).length,writes);assert.equal(h.files.size,1);
});

// Read contract: absent pointer is an empty baseline; absent journal cannot serve a blob.
for(const present of [[],['PublishPointer'],['ConsumedNonces'],['PublishPointer','ConsumedNonces']])test('public reads never initialize sheets: '+present.join(','),()=>{
 const h=appsScriptHarness();
 vmPrepare(h);
 for(const name of [...h.ledger.sheets.keys()])if(!present.includes(name))h.ledger.sheets.delete(name);
 h.events.length=0;h.options.denyWrites=true;
 const p=h.call('pointer');assert.equal(p.ok,true);assert.equal(p.result.pointerVersion,0);
 assert.equal(h.call('blob',{blobId:'unknown'}).error,'STORE_UNAVAILABLE');
 assert.ok(!h.events.some(e=>/insert|write|flush|drive.create|drive.folder/.test(e)),h.events.join(','));
 assert.deepEqual([...h.ledger.sheets.keys()],present);assert.equal(h.isLocked(),false);
});
test('public reads preserve populated pointer and journal and fail closed on read errors',()=>{
 const h=appsScriptHarness(),p=vmPrepare(h),r=h.call('confirm',vmBinding(p)).result;
 const before=JSON.stringify([...h.ledger.sheets].map(([n,s])=>[n,s.rows]));
 h.options.denyWrites=true;h.events.length=0;
 assert.equal(h.call('pointer').result.pngSha256,r.pointer.pngSha256);
 assert.equal(h.call('blob',{blobId:r.job.blobId}).result.base64,fixture.png.toString('base64'));
 for(const [op,failAt] of [['pointer','ledger.sheet'],['pointer','ledger.range'],['blob','ledger.dataRange'],['blob','drive.read']]){
  h.options.failAt=failAt;assert.equal(h.call(op,{blobId:r.job.blobId}).error,'STORE_UNAVAILABLE');assert.equal(h.isLocked(),false);
 }
 assert.equal(JSON.stringify([...h.ledger.sheets].map(([n,s])=>[n,s.rows])),before);
 assert.ok(!h.events.some(e=>/insert|write|flush|drive.create|drive.folder/.test(e)));
});

test('anonymous image GET through GAS VM never creates resources on empty or populated ledger',async()=>{
 const {createImageHandler}=require('../api/publish-image');
 for(const populated of [false,true]){
  const h=appsScriptHarness();if(populated){const p=vmPrepare(h);h.call('confirm',vmBinding(p));}
  h.options.denyWrites=true;h.events.length=0;
  const store=createAppsScriptTransport({enabled:true,url:'https://synthetic.invalid',secret:'synthetic-test-only',fetchImpl:async(_,o)=>Response.json(h.post(JSON.parse(o.body)))});
  let body;const res={statusCode:200,setHeader(){},end:b=>body=b};
  await createImageHandler({store})({method:'GET'},res);
  assert.equal(res.statusCode,populated?200:404);
  if(populated)assert.deepEqual(body,fixture.png);else {assert.equal(body,undefined);assert.equal(h.ledger.sheets.size,0);assert.equal(h.files.size,0);}
  assert.ok(!h.events.some(e=>/insert|write|flush|drive.create|drive.folder/.test(e)),h.events.join(','));
 }
});
test('malformed pointer and journal reads fail closed without repair writes',()=>{
 for(const op of ['pointer','blob']){
  const h=appsScriptHarness(),p=vmPrepare(h),r=h.call('confirm',vmBinding(p)).result;
  if(op==='pointer')h.ledger.sheets.get('PublishPointer').rows[0][0]='malformed';
  else h.ledger.sheets.get('ConsumedNonces').rows[0][1]='malformed';
  h.options.denyWrites=true;h.events.length=0;
  assert.equal(h.call(op,{blobId:r.job.blobId}).error,'STORE_UNAVAILABLE');assert.equal(h.isLocked(),false);
  assert.ok(!h.events.some(e=>/insert|write|flush|drive.create|drive.folder/.test(e)));
 }
});
