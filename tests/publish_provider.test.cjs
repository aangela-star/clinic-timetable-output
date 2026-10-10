const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),vm=require('node:vm');
const {createProvider,createPublicVerifier}=require('../lib/publish-provider');
const {targetFingerprint}=require('../lib/publish-target');
const {LocalStore,hash}=require('../lib/publish-store-mock');
const fixture={require,Buffer};vm.runInNewContext(fs.readFileSync(require.resolve('./publish_contract.test.cjs'),'utf8').split("test('")[0]+';globalThis.png=validPngBuffer();',fixture);
const pageUrl='https://www.tainanrehab.com/time.html',imageUrl='https://clinic-timetable-output.vercel.app/api/publish-image';
const html=`<html><body><img src="${imageUrl}" style="width:675px;height:1200px"></body></html>`;
const config={PUBLISH_IMAGE_ENABLED:'true',PUBLISH_FLOW_ENABLED:'true',PUBLISH_PUBLIC_PAGE_URL:pageUrl,PUBLISH_PUBLIC_IMAGE_URL:imageUrl,PUBLISH_PUBLIC_TARGET_SHA256:targetFingerprint(html,pageUrl,imageUrl)};
function setup() {
 const root=fs.mkdtempSync(os.tmpdir()+'/publish-factory-'),store=new LocalStore(root),calls=[];
 const state={html,drop:false},data={title:'SYNTHETIC MOCK',note:'',clinics:[]};
 const fetchImpl=async(url,options)=>{
  calls.push({url,method:options.method});
  if(options.method==='GET')return new Response(url===pageUrl?state.html:await store.bytes((await store.call('pointer')).blobId),{headers:{'Content-Type':url===pageUrl?'text/html':'image/png'}});
  const b=JSON.parse(options.body);assert.equal(b.secret,'synthetic-only-secret');assert.equal(options.redirect,'manual');assert.ok(options.signal);
  if(b.action==='load')return Response.json({ok:true,found:true,month:b.month,schemaVersion:1,data});
  const result=b.op==='blob'?{base64:(await store.bytes(b.input.blobId)).toString('base64')}:await store.call(b.op,b.input);
  if(b.op==='confirm'&&state.drop)throw Error('SYNTHETIC dropped response');
  return Response.json({ok:true,result});
 };
 const provider=createProvider({config,fetchImpl,getSecret:()=> 'synthetic-only-secret'});
 return {provider,store,state,calls,data,fetchImpl};
}
async function prepare(s){return s.provider.adapter.handle('prepare',{baseline:await s.store.call('pointer'),data:s.data,monthKey:'2099-01',pngDataUrl:'data:image/png;base64,'+fixture.png.toString('base64'),pngSha256:hash(fixture.png),targetPointerId:'jinan-website/current'},'session');}
const binding=p=>({approvalId:p.approvalId,nonce:p.nonce});
test('factory defaults and incomplete configuration fail closed without transport calls',async()=>{
 for(const c of [{},{PUBLISH_FLOW_ENABLED:'true'},{...config,PUBLISH_PUBLIC_PAGE_URL:'https://evil.invalid/time.html'},{...config,PUBLISH_PUBLIC_TARGET_SHA256:''}]){
  let calls=0;const p=createProvider({config:c,getSecret:()=> 'synthetic',fetchImpl:()=>{calls++;throw Error();}});
  assert.equal((await p.adapter.handle('pointer')).status,'CMS_RESPONSE_CONTRACT_UNVERIFIED');assert.equal(calls,0);assert.equal(Boolean(p.store),c.PUBLISH_IMAGE_ENABLED==='true');
 }
 const imageOnly=createProvider({config:{PUBLISH_IMAGE_ENABLED:'true'},getSecret:()=> 'synthetic'});assert.ok(imageOnly.store);assert.equal((await imageOnly.adapter.handle('pointer')).status,'CMS_RESPONSE_CONTRACT_UNVERIFIED');
});
test('real factory composes saved facts, page binding, transport, hash, CAS and dropped response reconciliation',async()=>{
 const s=setup(),p=await prepare(s);assert.equal(p.status,'PREPARED');assert.equal((await s.store.call('pointer')).pointerVersion,0);
 s.state.drop=true;assert.equal((await s.provider.adapter.handle('confirm',binding(p),'session')).status,'PUBLISHED');
 assert.equal((await s.provider.adapter.handle('confirm',binding(p),'session')).status,'PUBLISHED');assert.equal((await s.store.call('pointer')).pointerVersion,1);
 assert.ok(s.calls.some(c=>c.url===pageUrl));assert.ok(s.calls.some(c=>c.url===imageUrl));
});
test('page drift blocks mutation even with correct own-route image; configuration drift cannot adopt approval',async()=>{
 const s=setup(),p=await prepare(s);s.state.html=html.replace('width:675px','width:676px');
 assert.equal((await s.provider.adapter.handle('confirm',binding(p),'session')).status,'MANUAL_CHECK_REQUIRED');assert.equal((await s.store.call('pointer')).pointerVersion,0);
 const changed=createProvider({config:{...config,PUBLISH_PUBLIC_TARGET_SHA256:targetFingerprint(s.state.html,pageUrl,imageUrl)},getSecret:()=> 'synthetic-only-secret',fetchImpl:s.fetchImpl});
 assert.equal((await changed.adapter.handle('confirm',binding(p),'session')).status,'INVALID_APPROVAL');assert.equal((await s.store.call('pointer')).pointerVersion,0);
});
test('strict target verification rejects wrong src, duplicate image, base, srcset, redirects, MIME and bytes drift',async()=>{
 for(const content of [html.replace(imageUrl,'https://wrong.invalid/x.png'),html+html,html+'<base href="https://evil.invalid/">',html.replace(' style=',' srcset="x.png 2x" style=')]){
  const v=createPublicVerifier({pageUrl,imageUrl,targetSha256:config.PUBLISH_PUBLIC_TARGET_SHA256,fetchImpl:async()=>new Response(content,{headers:{'Content-Type':'text/html'}})});await assert.rejects(v.checkPage());
 }
 for(const r of [{ok:true,url:'https://wrong.invalid/',headers:new Headers({'Content-Type':'text/html'})},new Response(html,{headers:{'Content-Type':'text/plain'}}),new Response('changed',{headers:{'Content-Type':'text/html'}})]){
  await assert.rejects(createPublicVerifier({pageUrl,imageUrl,targetSha256:config.PUBLISH_PUBLIC_TARGET_SHA256,fetchImpl:async()=>r}).checkPage());
 }
});
test('fixed image handler refuses bytes inconsistent with pointer hash',async()=>{
 const {createImageHandler}=require('../api/publish-image');let status;
 const res={set statusCode(v){status=v;},setHeader(){},end(){}};
 await createImageHandler({store:{call:async()=>({targetPointerId:'jinan-website/current',pngSha256:'0'.repeat(64),blobId:'synthetic'}),bytes:async()=>fixture.png}})({method:'GET'},res);assert.equal(status,404);
});

test('approval identity uses same last-cookie-wins decoding as authenticated session',()=>{
 const {sessionIdentity}=require('../lib/publish-api');
 const identity=cookie=>sessionIdentity({headers:{cookie}});
 assert.equal(identity('clinic_timetable_session=ignored; clinic_timetable_session=synthetic%2Etoken'),identity('clinic_timetable_session=synthetic.token'));
 assert.notEqual(identity('clinic_timetable_session=ignored; clinic_timetable_session=synthetic.token'),identity('clinic_timetable_session=ignored'));
});

test('bounded upstream reader rejects declared and streamed overflow',async()=>{
 const {readBounded}=require('../lib/publish-http');
 await assert.rejects(readBounded(new Response('x',{headers:{'Content-Length':'100'}}),2));
 await assert.rejects(readBounded(new Response('xxx'),2));
 assert.equal((await readBounded(new Response('ok'),2)).toString(),'ok');
});
test('reconciliation rejects pointer version drift even if approved bytes and identity remain',async()=>{
 const s=setup(),p=await prepare(s);assert.equal((await s.provider.adapter.handle('confirm',binding(p),'session')).status,'PUBLISHED');
 const pointer=await s.store.call('pointer');s.store.write('pointer.json',{...pointer,pointerVersion:pointer.pointerVersion+1});
 assert.equal((await s.provider.adapter.handle('reconcile',binding(p),'session')).status,'MANUAL_CHECK_REQUIRED');
});

test('baseline hash and stored target drift cannot move pointer',async()=>{
 const s=setup(),p=await prepare(s);await s.provider.adapter.handle('confirm',binding(p),'session');
 const pointer=await s.store.call('pointer');
 const wrong=await s.provider.adapter.handle('prepare',{baseline:{...pointer,pngSha256:'0'.repeat(64)},data:s.data,monthKey:'2099-01',pngDataUrl:'data:image/png;base64,'+fixture.png.toString('base64'),pngSha256:hash(fixture.png),targetPointerId:'jinan-website/current'},'session');
 assert.equal(wrong.status,'STALE_BASELINE');
 const q=await prepare(s);s.store.write('pointer.json',{...pointer,targetPointerId:'another-target'});
 assert.equal((await s.provider.adapter.handle('confirm',binding(q),'session')).status,'MANUAL_CHECK_REQUIRED');
 assert.equal((await s.store.call('pointer')).pointerVersion,1);
});

// Exercise the exported production route and its lazy provider composition with
// explicit synthetic configuration; never read or modify process.env or secrets.
test('real image route preserves bytes with invalid/incomplete flow config while flow stays disabled',async()=>{
 const s=setup(),prepared=await prepare(s);
 assert.equal((await s.provider.adapter.handle('confirm',binding(prepared),'session')).status,'PUBLISHED');
 const configs=[
  {...config,PUBLISH_PUBLIC_PAGE_URL:undefined},
  {...config,PUBLISH_PUBLIC_IMAGE_URL:'not a URL'},
  {...config,PUBLISH_PUBLIC_PAGE_URL:'https://wrong.invalid/'},
  {...config,PUBLISH_PUBLIC_IMAGE_URL:'https://wrong.invalid/image'},
  {...config,PUBLISH_PUBLIC_TARGET_SHA256:''},
  {...config,PUBLISH_FLOW_ENABLED:'false'},
 ];
 for(const c of configs){
  const provider=()=>createProvider({config:c,fetchImpl:s.fetchImpl,getSecret:()=> 'synthetic-only-secret'});
  assert.equal((await provider().adapter.handle('pointer')).status,'CMS_RESPONSE_CONTRACT_UNVERIFIED');
  const context={module:{exports:{}},require:name=>name==='../lib/publish-provider'?{createProvider:provider}:require(name)};
  vm.runInNewContext(fs.readFileSync(require.resolve('../api/publish-image'),'utf8'),context);
  const headers={};let body;const res={statusCode:200,setHeader:(k,v)=>headers[k]=v,end:b=>body=b};
  await context.module.exports({method:'GET'},res);
  assert.equal(res.statusCode,200);assert.deepEqual(body,fixture.png);assert.equal(headers['Cache-Control'],'no-store');
  assert.equal(headers['Content-Type'],'image/png');
 }
 const broken=createProvider({config,getSecret:()=>{throw Error('synthetic unavailable');}});
 assert.equal(broken.store,undefined);
});

test('confirm INVALID_PNG is pre-mutation; ambiguous prior intent never returns safe-clear code',async()=>{
 const s=setup(),p=await prepare(s),before=await s.store.call('pointer');
 const name='job-'+p.approvalId+'.json',job=s.store.read(name);
 s.store.write('blob-'+job.blobId+'.json',{base64:Buffer.from('corrupt synthetic').toString('base64')});
 assert.equal((await s.provider.adapter.handle('confirm',binding(p),'session')).status,'INVALID_PNG');
 assert.deepEqual(await s.store.call('pointer'),before);
 assert.deepEqual(s.store.read(name),job);
 s.store.write(name,{...job,status:'MUTATING'});
 assert.equal((await s.provider.adapter.handle('confirm',binding(p),'session')).status,'MANUAL_CHECK_REQUIRED');
 assert.deepEqual(await s.store.call('pointer'),before);
});

test('unrelated page edits preserve approval and byte verification',async()=>{
 const s=setup(),p=await prepare(s);s.state.html=s.state.html.replace('</body>','<footer>New announcement <img src="/unrelated.png"></footer></body>');
 assert.equal((await s.provider.adapter.handle('confirm',binding(p),'session')).status,'PUBLISHED');
});
test('public verifier enforces overflow, redirect, no-store, and exact bytes',async()=>{
 for(const response of [new Response('x',{headers:{'content-type':'text/html','content-length':'1000001'}}),new Response('x'.repeat(1000001),{headers:{'content-type':'text/html'}})]){
  await assert.rejects(createPublicVerifier({pageUrl,imageUrl,targetSha256:config.PUBLISH_PUBLIC_TARGET_SHA256,fetchImpl:async()=>response}).checkPage());
 }
 const v=createPublicVerifier({pageUrl,imageUrl,targetSha256:config.PUBLISH_PUBLIC_TARGET_SHA256,fetchImpl:async(url,o)=>{
  assert.equal(o.redirect,'error');assert.equal(o.cache,'no-store');assert.ok(o.signal);
  return new Response(url===pageUrl?html:fixture.png,{headers:{'content-type':url===pageUrl?'text/html':'image/png'}});
 }});assert.deepEqual(await v.publicRead(),fixture.png);
});

test('frozen local harness legacy pin remains strict and cannot enable production verifier',async()=>{
 const page='http://127.0.0.1:4187/public/jinan',image='http://127.0.0.1:4187/api/publish-image';
 const content='<h1>MOCK</h1><img src="/api/publish-image">';
 const options={pageUrl:page,imageUrl:image,pageSha256:hash(Buffer.from(content)),fetchImpl:async()=>new Response(content,{headers:{'content-type':'text/html'}})};
 await createPublicVerifier(options).checkPage();
 await assert.rejects(createPublicVerifier({...options,fetchImpl:async()=>new Response(content+' ',{headers:{'content-type':'text/html'}})}).checkPage());
 await assert.rejects(createPublicVerifier({...options,pageUrl,imageUrl}).checkPage());
});
test('anonymous image handler repeated concurrent reads return exact bytes and freshness headers',async()=>{
 const s=setup(),p=await prepare(s);assert.equal((await s.provider.adapter.handle('confirm',binding(p),'session')).status,'PUBLISHED');
 const handler=require('../api/publish-image').createImageHandler({store:s.store});
 async function get(){const headers={};let bytes;const res={statusCode:200,setHeader:(k,v)=>headers[k]=v,end:b=>bytes=b};await handler({method:'GET'},res);
  assert.equal(res.statusCode,200);assert.equal(headers['Cache-Control'],'no-store');assert.equal(headers['X-Content-Type-Options'],'nosniff');assert.equal(headers['Content-Type'],'image/png');assert.deepEqual(bytes,fixture.png);assert.equal(bytes.length,fixture.png.length);assert.equal(hash(bytes),hash(fixture.png));}
 await get();await Promise.all([get(),get(),get()]);
 s.store.faults.cache=true;let status;await handler({method:'GET'},{set statusCode(v){status=v;},setHeader(){},end(){}});assert.equal(status,404);
});

test('image 503 classification: early failures make zero upstream calls; downstream failures are 404',async()=>{
 for(const kind of ['missing','false','TRUE',' true ','construction','gate-rejected','empty','bad-hash','success']){
  let secrets=0,calls=0;
  const early=['missing','false','TRUE',' true ','construction'].includes(kind);
  const c={PUBLISH_IMAGE_ENABLED:kind==='missing'?undefined:['false','TRUE',' true '].includes(kind)?kind:'true',PUBLISH_FLOW_ENABLED:'false'};
  const provider=()=>createProvider({config:c,getSecret:()=>{secrets++;if(kind==='construction')throw Error('SERVER_SECRET_NOT_CONFIGURED');return 'synthetic-only';},fetchImpl:async(_,o)=>{
   calls++;const {op}=JSON.parse(o.body);
   if(kind==='gate-rejected')return Response.json({ok:false,error:'CMS_RESPONSE_CONTRACT_UNVERIFIED'});
   if(op==='pointer')return Response.json({ok:true,result:kind==='empty'?{pointerVersion:0,pointerEtag:'empty'}:{blobId:'synthetic',targetPointerId:'jinan-website/current',pngSha256:kind==='bad-hash'?'0'.repeat(64):hash(fixture.png)}});
   if(kind==='empty')return Response.json({ok:false});
   return Response.json({ok:true,result:{base64:fixture.png.toString('base64')}});
  }});
  const context={module:{exports:{}},require:n=>n==='../lib/publish-provider'?{createProvider:provider}:require(n)};
  vm.runInNewContext(fs.readFileSync(require.resolve('../api/publish-image'),'utf8'),context);
  let body;const headers={},res={statusCode:200,setHeader:(k,v)=>headers[k]=v,end:b=>body=b};
  await context.module.exports({method:'GET'},res);
  assert.equal(res.statusCode,early?503:kind==='success'?200:404,kind);
  assert.equal(calls,early?0:kind==='gate-rejected'?1:2,kind);
  assert.equal(secrets,early&&kind!=='construction'?0:1,kind);
  assert.equal(headers['Cache-Control'],'no-store');assert.equal(headers['X-Content-Type-Options'],'nosniff');
  if(kind==='success')assert.deepEqual(body,fixture.png);else assert.equal(body,undefined);
 }
});
