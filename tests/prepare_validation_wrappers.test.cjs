const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {createRequire}=require('node:module');
// Reuse only the synthetic Google services/PNG fixture; dispatch through real wrappers.
const fixtures={require:createRequire(require.resolve('./prepare_validation_apps_script.test.cjs')),Buffer,structuredClone};
vm.runInNewContext(fs.readFileSync('tests/prepare_validation_apps_script.test.cjs','utf8').split("\ntest('")[0]+
  ';globalThis.fixture={harness,png,sha,input,shared,authority,operationId};',fixtures);
const {harness,png,sha,input,shared,authority,operationId}=fixtures.fixture;
const endpoint='https://script.google.com/macros/s/AKfycbz5OXGNDZJWEj2-W1g-1r_SISPjYYcI-7gsUsivt3Rx7-zY6AzpQqqZTIFROVKMU1eh3w/exec';
function wrapped(options={}) {
  const h=harness(options),calls=[];
  const verify=h.ctx.validationPng_;
  h.ctx.validationPng_=(bytes,hash)=>verify(bytes,hash,{pngBytes:png.length,pngSha256:sha(png)});
  const config={...h.props,VERCEL_ENV:'production',PREPARE_VALIDATION_PRODUCTION_ENABLED:'true',PREPARE_VALIDATION_ORIGIN:'https://local.invalid',...options.config};
  const cache={};
  function load(path) {
    path=require.resolve(path);if(cache[path])return cache[path].exports;
    const mod={exports:{}};cache[path]=mod;
    const local=createRequire(path);
    const sandbox={module:mod,exports:mod.exports,Buffer,URL,AbortSignal,Response,process:{env:config},
      fetch:async(url,init)=>{calls.push({url,init});if(options.fetch)return options.fetch(url,init,h,calls);
        assert.equal(url,endpoint);return Response.json(h.ctx.doPost({postData:{contents:init.body}}));},
      require:name=>name.startsWith('.')?load(local.resolve(name)):local(name)};
    let source=fs.readFileSync(path,'utf8');
    // Only synthetic PNG verification pins change in test VM. Route, auth, transport,
    // capabilities and all target/runtime checks execute their shipped defaults.
    if(path.endsWith('/lib/prepare-validation.js'))source=source.replace('pngBytes=PINS.pngBytes,pngSha256=PINS.pngSha256',`pngBytes=${png.length},pngSha256='${sha(png)}'`);
    vm.runInNewContext(source,sandbox,{filename:path});return mod.exports;
  }
  const handler=load('../api/prepare-validation'),auth=load('../lib/server-session');
  let cookie='clinic_timetable_session='+encodeURIComponent(auth.createSessionToken());
  async function invoke(op,patch={}) {
    const res={headers:{},setHeader(k,v){this.headers[k]=v;},end(s){this.body=JSON.parse(s);}};
    const prepareInput={...input,pngDataUrl:'data:image/png;base64,'+input.pngBase64};delete prepareInput.pngBase64;
    await handler({method:'POST',headers:{host:'local.invalid',origin:'https://local.invalid','content-type':'application/json',cookie},
      body:{op,...(op==='session'?{}:{operationId}),...(op==='prepare'?{input:prepareInput}:{}),...patch}},res);
    return res;
  }
  async function enroll() {
    const r=await invoke('session');cookie+='; '+r.headers['Set-Cookie'].split(';')[0];
    config.PREPARE_VALIDATION_APPROVED_SESSION_SHA256=h.props.PREPARE_VALIDATION_APPROVED_SESSION_SHA256=r.body.sessionSha256;
  }
  return {h,calls,config,invoke,enroll};
}
test('R4 real exported production handler -> doPost -> prepare wrapper succeeds without invocation attestor',async()=>{
  const w=wrapped();await w.enroll();assert.equal((await w.invoke('authorize')).body.status,'AUTHORIZED');
  const r=await w.invoke('prepare');assert.equal(r.body.status,'PREPARED',JSON.stringify(r.body));
  assert.equal(w.h.files.size,1);assert.equal(w.h.events.filter(e=>e==='write').length,2);
  assert.equal((await w.invoke('reconcile')).body.approvalId,r.body.approvalId);assert.equal(w.h.files.size,1);
});
const mutations=w=>Array.from(w.h.events).filter(e=>['write','flush','stage'].includes(e));
for(const [label,options] of Object.entries({
  project:{project:'wrong'},ledgerProperty:{props:{PUBLISH_SPREADSHEET_ID:'wrong'}},
  formalAsLedger:{props:{PUBLISH_SPREADSHEET_ID:require('../lib/prepare-validation').PINS.schedule}},
  folderProperty:{props:{PUBLISH_FOLDER_ID:'wrong'}},deploymentProperty:{props:{PREPARE_VALIDATION_DEPLOYMENT_ID:'wrong'}},
  openedLedger:{openedId:'wrong'},openedFolder:{folderId:'wrong'},
  issuance:{props:{PREPARE_VALIDATION_ISSUANCE_ENABLED:'false'}}
}))test('R4 real wrappers reject '+label+' before any write',async()=>{
  const w=wrapped(options);await w.enroll();const r=await w.invoke('prepare');
  assert.notEqual(r.body.status,'PREPARED');assert.deepEqual(mutations(w),[]);assert.equal(w.h.files.size,0);
});
for(const service of ['ScriptApp','PropertiesService','SpreadsheetApp','DriveApp','LockService'])test('R4 unknown runtime '+service+' fails closed',async()=>{
  const w=wrapped();await w.enroll();w.h.ctx[service]=undefined;
  assert.notEqual((await w.invoke('prepare')).body.status,'PREPARED');assert.deepEqual(mutations(w),[]);
});
test('R4 actual opened formal workbook identity and isolation checked before writes',async()=>{
  for(const id of ['wrong',require('../lib/prepare-validation').PINS.ledger]) {
    const w=wrapped();await w.enroll();const open=w.h.ctx.SpreadsheetApp.openById;
    w.h.ctx.SpreadsheetApp.openById=requested=>{const book=open(requested);return requested===require('../lib/prepare-validation').PINS.schedule?{...book,getId:()=>id}:book;};
    assert.notEqual((await w.invoke('prepare')).body.status,'PREPARED');assert.deepEqual(mutations(w),[]);
  }
});
const crypto=require('node:crypto');
for(const patch of [{deploymentEndpoint:endpoint.replace('/exec','/dev')},{deploymentEndpoint:'https://script.google.com/macros/s/alias/exec'},
  {deploymentEndpoint:undefined},{executorId:'other'},{purpose:'publish'},{operationId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'},
  {session:'f'.repeat(64)},{exp:1}])test('R4 signed capability binding rejected '+JSON.stringify(patch),async()=>{
  const w=wrapped({fetch:async(url,init,h)=>{
    assert.equal(url,endpoint);const body=JSON.parse(init.body),cap=JSON.parse(Buffer.from(body.capability.split('.')[0],'base64url'));
    const encoded=Buffer.from(JSON.stringify({...cap,...patch})).toString('base64url');
    body.capability=encoded+'.'+crypto.createHmac('sha256',authority).update(encoded).digest('base64url');
    const r=h.ctx.doPost({postData:{contents:JSON.stringify(body)}});assert.equal(r.error,'INVALID_CAPABILITY');return Response.json(r);
  }});await w.enroll();assert.notEqual((await w.invoke('prepare')).body.status,'PREPARED');assert.deepEqual(mutations(w),[]);
});
test('R4 forged transport and authority rejected by real doPost',async()=>{
  for(const kind of ['transport','authority']) {
    const w=wrapped({fetch:async(url,init,h)=>{const b=JSON.parse(init.body);
      if(kind==='transport')b.secret='forged';else b.capability=b.capability.split('.')[0]+'.'+'a'.repeat(43);
      return Response.json(h.ctx.doPost({postData:{contents:JSON.stringify(b)}}));
    }});await w.enroll();assert.notEqual((await w.invoke('prepare')).body.status,'PREPARED');assert.deepEqual(mutations(w),[]);
  }
});
test('R4 fake attestation fields/env cannot grant scope or override fixed destination',async()=>{
  const w=wrapped({config:{PREPARE_VALIDATION_URL:'https://evil.invalid',PREPARE_VALIDATION_ATTESTOR:'approved',PREPARE_VALIDATION_ATTESTED_DEPLOYMENT:'approved'}});
  await w.enroll();
  for(const patch of [{attest:'approved'},{deploymentEndpoint:'https://evil.invalid'},{url:'https://evil.invalid'}]) {
    assert.equal((await w.invoke('prepare',patch)).body.error,'INVALID_REQUEST');assert.equal(w.calls.length,0);
  }
  w.config.PREPARE_VALIDATION_APPROVED_SESSION_SHA256='0'.repeat(64);
  assert.equal((await w.invoke('prepare')).body.error,'INVALID_CAPABILITY');assert.equal(w.calls.length,0);assert.deepEqual(mutations(w),[]);
  w.config.PREPARE_VALIDATION_APPROVED_SESSION_SHA256=w.h.props.PREPARE_VALIDATION_APPROVED_SESSION_SHA256;
  w.h.ctx.ScriptApp.getService=()=>{throw Error('not invocation metadata');};
  assert.equal((await w.invoke('prepare')).body.status,'PREPARED');assert.equal(w.calls[0].url,endpoint);
});
const responseUrl='https://script.googleusercontent.com/macros/echo?user_content_key=synthetic&lib=synthetic';
test('R4 successful Google response redirect uses one credential-free GET through actual wrappers',async()=>{
  let stored;
  const w=wrapped({fetch:async(url,init,h,calls)=>{
    assert.equal(init.redirect,'manual');assert.equal(init.credentials,'omit');
    if(calls.length===1) {assert.equal(url,endpoint);assert.equal(init.method,'POST');stored=h.ctx.doPost({postData:{contents:init.body}});
      return new Response(null,{status:302,headers:{location:responseUrl}});}
    assert.equal(url,responseUrl);assert.equal(init.method,'GET');assert.equal(init.body,undefined);assert.equal(init.headers,undefined);
    assert.equal(init.referrerPolicy,'no-referrer');return Response.json(stored);
  }});await w.enroll();assert.equal((await w.invoke('prepare')).body.status,'PREPARED');assert.equal(w.calls.length,2);assert.equal(w.h.files.size,1);
});
for(const [status,location] of [[307,responseUrl],[308,responseUrl],[301,responseUrl],[302,'https://evil.invalid/macros/echo'],
  [302,'http://script.googleusercontent.com/macros/echo'],[302,'https://script.googleusercontent.com.evil.invalid/macros/echo'],
  [302,'https://user:pass@script.googleusercontent.com/macros/echo'],[302,'https://script.googleusercontent.com:444/macros/echo'],
  [302,'https://script.googleusercontent.com/other'],[302,responseUrl+'#fragment'],[302,'/macros/echo'],[302,endpoint],[302,null]])
  test('R4 unsafe redirect rejected without credential replay '+status+' '+location,async()=>{
    const w=wrapped({fetch:async()=>new Response(null,{status,headers:location?{location}:{}})});await w.enroll();
    assert.equal((await w.invoke('prepare')).body.error,'MANUAL_CHECK_REQUIRED');assert.equal(w.calls.length,1);assert.deepEqual(mutations(w),[]);
  });
test('R4 redirect chain bounded and response loss never retries POST',async()=>{
  const w=wrapped({fetch:async(url,init,h,calls)=>{
    if(calls.length===1)h.ctx.doPost({postData:{contents:init.body}});
    return new Response(null,{status:303,headers:{location:responseUrl}});
  }});await w.enroll();assert.equal((await w.invoke('prepare')).body.error,'MANUAL_CHECK_REQUIRED');
  assert.equal(w.calls.length,2);assert.equal(w.calls.filter(x=>x.init.method==='POST').length,1);assert.equal(w.h.files.size,1);
});
test('R4 exported production route remains off without explicit opt-in',async()=>{
  const w=wrapped();await w.enroll();w.config.PREPARE_VALIDATION_PRODUCTION_ENABLED='false';
  assert.equal((await w.invoke('prepare')).body.error,'VALIDATION_DISABLED');assert.equal(w.calls.length,0);assert.deepEqual(mutations(w),[]);
});
test('R4 invalid or oversized response remains ambiguous without retry',async()=>{
  for(const response of [()=>new Response('not JSON'),()=>Response.json({ok:false}),
    ()=>new Response('{}',{headers:{'content-length':'3500001'}})]) {
    const w=wrapped({fetch:async()=>response()});await w.enroll();
    assert.equal((await w.invoke('prepare')).body.error,'MANUAL_CHECK_REQUIRED');assert.equal(w.calls.length,1);
  }
});
