const test=require('node:test');
const assert=require('node:assert/strict');
const {createAppsScriptTransport,createPointerOnlyAdapter,MAX_BODY_BYTES}=require('../lib/publish-store-adapter');
const unknown={status:'BASELINE',classification:'UNKNOWN'};
const canary='SYNTHETIC_REASON_CANARY_https://private.invalid/body';
const empty={pointerVersion:0,pointerEtag:'empty',targetPointerId:'jinan-website/current'};
const providerCodes=['UNAUTHORIZED','SERVER_SECRET_NOT_CONFIGURED','CMS_RESPONSE_CONTRACT_UNVERIFIED','STORE_LOCKED','STORE_UNAVAILABLE'];
const providerReasons=['PROVIDER_UNAUTHORIZED','PROVIDER_SERVER_SECRET_NOT_CONFIGURED','PROVIDER_PUBLISH_DISABLED','PROVIDER_STORE_LOCKED','PROVIDER_STORE_UNAVAILABLE'];
const redirect=(location='https://script.googleusercontent.com/macros/echo?fixture=1',status=302)=>new Response(null,{status,headers:{location}});
const cases=[
 ['network',()=>{throw Error(canary);},'HTTP_TRANSPORT_ERROR'],
 ['timeout',()=>{throw new DOMException(canary,'TimeoutError');},'HTTP_TRANSPORT_ERROR'],
 ['HTTP HTML',()=>new Response(canary,{status:503}),'HTTP_TRANSPORT_ERROR'],
 ['bad location',()=>redirect('%%%'),'REDIRECT_INVALID'],
 ['wrong host',()=>redirect('https://private.invalid/macros/echo'),'REDIRECT_INVALID'],
 ['unsafe protocol',()=>redirect('http://script.googleusercontent.com/macros/echo'),'REDIRECT_INVALID'],
 ['wrong redirect status',()=>redirect(undefined,307),'REDIRECT_INVALID'],
 ['chained redirect',()=>redirect(),'REDIRECT_INVALID',2],
 ['redirect GET failure',i=>{if(i===1)return redirect();throw Error(canary);},'HTTP_TRANSPORT_ERROR',2],
 ['HTML',()=>new Response('<html>'+canary),'JSON_INVALID'],
 ['malformed JSON',()=>new Response('{'+canary),'JSON_INVALID'],
 ['stream failure',()=>new Response(new ReadableStream({start(c){c.error(Error(canary));}})),'HTTP_TRANSPORT_ERROR'],
 ['declared oversized',()=>new Response('{}',{headers:{'content-length':String(MAX_BODY_BYTES+1)}}),'HTTP_TRANSPORT_ERROR'],
 ['stream oversized',()=>new Response(' '.repeat(MAX_BODY_BYTES+1)),'HTTP_TRANSPORT_ERROR'],
 ...[null,[],42,{}, {ok:false,error:canary},{ok:false,error:'toString'},{ok:'false',error:'UNAUTHORIZED'},{ok:true},{ok:true,result:null},{ok:true,result:[]},{ok:true,result:42}].map((v,i)=>['envelope '+i,()=>Response.json(v),'ENVELOPE_INVALID']),
 ...providerCodes.map((code,i)=>['provider '+code,()=>Response.json({ok:false,error:code,message:canary}),providerReasons[i]]),
 ['shape',()=>Response.json({ok:true,result:{secret:canary}}),'POINTER_SHAPE_INVALID'],
];
async function exercise(make){
 const calls=[];
 const store=createAppsScriptTransport({enabled:true,url:'https://script.google.com/macros/s/fixture/exec',secret:'synthetic-secret',fetchImpl:async(url,options)=>{calls.push(options);return make(calls.length);}});
 const adapter=createPointerOnlyAdapter({store});
 const result=await adapter.handle('pointer');
 for(const op of ['prepare','confirm','reconcile','blob','bytes'])assert.deepEqual(await adapter.handle(op),{status:'CMS_RESPONSE_CONTRACT_UNVERIFIED'});
 assert.equal(calls[0].method,'POST');assert.equal(JSON.parse(calls[0].body).op,'pointer');
 if(calls[1]){assert.equal(calls[1].method,'GET');assert.equal(calls[1].body,undefined);assert.equal(calls[1].signal,calls[0].signal);}
 return {result,calls};
}
for(const [name,make,reason,count=1] of cases)test('reason stage: '+name,async()=>{
 const {result,calls}=await exercise(make);
 assert.deepEqual(result,{...unknown,reason});assert.equal(calls.length,count);
 assert.equal(JSON.stringify(result).includes(canary),false);
});
test('private provenance never inspects or trusts thrown values',async()=>{
 let touched=0;
 const getter=Object.defineProperty({},'reason',{get(){touched++;throw Error(canary);}});
 const proxy=new Proxy({},{get(){touched++;throw Error(canary);},getPrototypeOf(){touched++;throw Error(canary);},ownKeys(){touched++;throw Error(canary);}});
 const revoked=Proxy.revocable({},{});revoked.revoke();
 for(const failure of [getter,proxy,revoked.proxy,null,undefined,canary,{reason:'PROVIDER_UNAUTHORIZED'},Error(canary)]){
  const adapter=createPointerOnlyAdapter({store:{call:async()=>{throw failure;}}});
  assert.deepEqual(await adapter.handle('pointer'),unknown);
 }
 assert.equal(touched,0);
});
test('valid replies including contradictory error never infer provider failure',async()=>{
 for(const pointer of [empty,{pointerVersion:1,pointerEtag:'11111111-2222-4333-8444-555555555555',pngSha256:'a'.repeat(64),targetPointerId:'jinan-website/current'}]){
  const {result,calls}=await exercise(()=>Response.json({ok:true,error:'UNAUTHORIZED',result:pointer}));
  assert.deepEqual(result,pointer===empty?{status:'BASELINE',classification:'VERIFIED_EMPTY'}:{status:'BASELINE',baseline:{pointerVersion:1,pointerEtag:pointer.pointerEtag,pngSha256:pointer.pngSha256}});
  assert.equal(calls.length,1);
 }
});
test('closed reason list is exhaustive and immutable',()=>{
 const {POINTER_REASONS}=require('../lib/publish-store-adapter');
 assert.deepEqual([...POINTER_REASONS].sort(),[...new Set(cases.map(c=>c[2]))].sort());
 assert.ok(Object.isFrozen(POINTER_REASONS));
});
function recorder(){return {headers:{},setHeader(k,v){this.headers[k]=v;},end(body){this.body=JSON.parse(body);}};}
test('API only passes closed reasons for GET UNKNOWN BASELINE',async()=>{
 const {createPublishApi}=require('../lib/publish-api');
 for(const reason of ['PROVIDER_UNAUTHORIZED',canary,{},null])for(const classification of ['UNKNOWN','VERIFIED_EMPTY',undefined])for(const method of ['GET','POST']){
  const res=recorder();
  await createPublishApi({identity:()=> 'synthetic',adapter:{handle:async()=>({status:'BASELINE',classification,reason})}})({method,headers:{'content-type':'application/json'},body:method==='POST'?{op:'confirm',input:{}}:undefined},res);
  assert.equal(res.body.reason,method==='GET' && classification==='UNKNOWN' && reason==='PROVIDER_UNAUTHORIZED'?reason:undefined);
 }
});
test('all reasons cross real authenticated route without logs or extra operations',async()=>{
 process.env.CLINIC_SERVER_SECRET='synthetic-session-secret-for-offline-tests-only-123456';
 const {createSessionToken}=require('../lib/server-session');
 const {createHandler}=require('../api/publish');
 const provider=require('../lib/publish-provider'),original=provider.createProvider;
 const logs=[],saved={log:console.log,warn:console.warn,error:console.error};
 for(const key of Object.keys(saved))console[key]=(...args)=>logs.push(args);
 let constructions=0,calls=[];
 try {
  const handler=createHandler();
  provider.createProvider=()=>{constructions++;assert.fail('unauthenticated construction');};
  const unauth=recorder();await handler({method:'GET',query:{pointer:'jinan-website'},headers:{}},unauth);
  assert.equal(unauth.statusCode,401);assert.equal(constructions,0);
  const cookie='clinic_timetable_session='+encodeURIComponent(createSessionToken());
  for(const [name,make,reason,count=1] of cases){
   calls=[];
   provider.createProvider=()=>original({config:{PUBLISH_IMAGE_ENABLED:'true'},getSecret:()=> 'synthetic-secret',fetchImpl:async(_,options)=>{calls.push(options);return make(calls.length);}});
   const res=recorder();await handler({method:'GET',query:{pointer:'jinan-website'},headers:{cookie}},res);
   assert.equal(res.statusCode,200,name);assert.deepEqual(res.body,{ok:true,...unknown,reason},name);
   assert.equal(res.headers['Cache-Control'],'no-store');assert.equal(calls.length,count);
   assert.equal(JSON.stringify(res.body).includes(canary),false);assert.equal(JSON.stringify(res.body).includes('synthetic-secret'),false);
   assert.equal(JSON.parse(calls[0].body).op,'pointer');
   const closed=recorder();await handler({method:'POST',headers:{cookie,'content-type':'application/json'},body:{op:'confirm',input:{}}},closed);
   assert.equal(closed.statusCode,409);assert.equal(calls.length,count);
  }
  assert.deepEqual(logs,[]);
 } finally {provider.createProvider=original;Object.assign(console,saved);}
});
test('body bound accepts exactly MAX_BODY_BYTES and valid one-hop replies',async()=>{
 const text=JSON.stringify({ok:true,result:empty});
 for(const redirectStatus of [302,303]){
  const {result,calls}=await exercise(i=>i===1?redirect(undefined,redirectStatus):new Response(text+' '.repeat(MAX_BODY_BYTES-Buffer.byteLength(text))));
  assert.deepEqual(result,{status:'BASELINE',classification:'VERIFIED_EMPTY'});assert.equal(calls.length,2);
 }
});
test('unstaged missing response and json-only read errors remain untagged',async()=>{
 for(const make of [()=>undefined,()=>({ok:true,json:async()=>{throw Error(canary);}})]){
  const {result,calls}=await exercise(make);assert.deepEqual(result,unknown);assert.equal(calls.length,1);
 }
});
test('fetch failures do not inspect hostile errors or trust their reason',async()=>{
 let reads=0;
 const hostile=new Proxy({reason:'PROVIDER_UNAUTHORIZED'},{get(){reads++;throw Error(canary);},getPrototypeOf(){reads++;throw Error(canary);}});
 const {result,calls}=await exercise(()=>{throw hostile;});
 assert.deepEqual(result,{...unknown,reason:'HTTP_TRANSPORT_ERROR'});assert.equal(calls.length,1);assert.equal(reads,0);
});
test('success error with missing result remains an envelope failure',async()=>{
 const {result}=await exercise(()=>Response.json({ok:true,error:'UNAUTHORIZED'}));
 assert.deepEqual(result,{...unknown,reason:'ENVELOPE_INVALID'});
});
