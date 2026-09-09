const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { PINS, verifyCapability, createValidationHandler } = require('../lib/prepare-validation');
const authority = 'synthetic-validation-authority-'.repeat(2);
const session = 'a'.repeat(64);
const now = 1800000000000;
const operationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
function token(patch = {}, key = authority) {
  const payload = Buffer.from(JSON.stringify({purpose:PINS.purpose, operationId, session,
    executorId:PINS.executorId, deploymentEndpoint:PINS.deploymentEndpoint, iat:now, exp:now+300000, ...patch})).toString('base64url');
  return payload+'.'+crypto.createHmac('sha256',key).update(payload).digest('base64url');
}
test('distinct scoped capability binds operation, session, executor, purpose and expiry', () => {
  assert.equal(verifyCapability(token(), authority, session, now).operationId, operationId);
  for (const patch of [{deploymentEndpoint:'https://wrong.invalid/exec'}, {deploymentEndpoint:undefined}, {purpose:'publish'}, {executorId:'other'}, {session:'b'.repeat(64)},
    {exp:now}, {iat:now+1}, {exp:now+300001}, {operationId:'not-uuid'}, {admin:true}]) {
    assert.throws(()=>verifyCapability(token(patch),authority,session,now));
  }
  assert.throws(()=>verifyCapability(token({},'shared-app-secret'),authority,session,now));
  assert.throws(()=>verifyCapability(token()+'x',authority,session,now));
});
async function invoke(handler, body={op:'status',operationId}, patch={}) {
  const res={headers:{},setHeader(k,v){this.headers[k]=v;},end(v){this.body=JSON.parse(v);}};
  await handler({method:'POST',headers:{host:'validation.invalid',origin:'https://validation.invalid',
    'content-type':'application/json'},body,...patch},res);
  return res;
}
function setup(patch={}) {
  const calls=[];
  const handler=createValidationHandler({config:{PREPARE_VALIDATION_ENABLED:'true',VERCEL_ENV:'preview',PREPARE_VALIDATION_ORIGIN:'https://validation.invalid',PREPARE_VALIDATION_ISSUANCE_ENABLED:'true',PREPARE_VALIDATION_APPROVED_SESSION_SHA256:session,PREPARE_VALIDATION_APPROVED_OPERATION_ID:operationId,PREPARE_VALIDATION_APPROVED_AT:String(now-10000),PREPARE_VALIDATION_APPROVED_UNTIL:String(now+3600000)},
    authenticate:()=>true,identity:()=>session,now:()=>now,getAuthority:()=>authority,
    getSecret:()=> 'synthetic-shared-secret',request:async payload=>{calls.push(payload);return {ok:true,result:{status:'NOT_FOUND',operationId}};},...patch});
  return {handler,calls};
}
test('endpoint default off and production denied independently of IMAGE/FLOW; shared session alone insufficient',async()=>{
  for(const config of [{},{PREPARE_VALIDATION_ENABLED:'true',VERCEL_ENV:'production'}]) {
    const s=setup({config});assert.equal((await invoke(s.handler)).body.error,'VALIDATION_DISABLED');assert.equal(s.calls.length,0);
  }
  const s=setup();assert.equal((await invoke(s.handler)).body.status,'NOT_FOUND');
  assert.equal(s.calls[0].action,'prepareValidation');
  for(const patch of [{method:'GET'},{headers:{}},{body:'{'},{body:{op:'confirm',operationId}},
    {body:{op:'pointer',operationId}},{body:{op:'bootstrap',operationId}},
    {body:{op:'status',operationId,input:{}}},{body:{op:'status',operationId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'}}]) {
    const h=setup();assert.notEqual((await invoke(h.handler,undefined,patch)).statusCode,200);assert.equal(h.calls.length,0);
  }
  const h=setup({authenticate:()=>false});assert.equal((await invoke(h.handler)).statusCode,401);assert.equal(h.calls.length,0);
});
module.exports={token,authority,session,now,operationId,invoke,setup};
const fs=require('node:fs'),vm=require('node:vm');
const fixture={require,Buffer};vm.runInNewContext(fs.readFileSync(require.resolve('./publish_contract.test.cjs'),'utf8').split("test('")[0]+';globalThis.png=validPngBuffer();',fixture);
const png=fixture.png,sha=crypto.createHash('sha256').update(png).digest('hex');
const input={monthKey:'2026-09',data:{title:'115/9月',note:'synthetic',clinics:[{schedule:{},changes:[]}]},
 baseline:{pointerVersion:0,pointerEtag:'empty'},targetPointerId:'jinan-website/current',
 pngDataUrl:'data:image/png;base64,'+png.toString('base64'),pngSha256:sha};
test('prepare validates full PNG and hash, pins approved source, transports once and never retries on response loss',async()=>{
  const {createPreparationValidator}=require('../lib/prepare-validation');
  const validate=createPreparationValidator({pngBytes:png.length,pngSha256:sha}); // Code-only synthetic seam.
  const h=setup({validate});
  assert.equal((await invoke(h.handler,{op:'prepare',operationId,input})).statusCode,200);
  assert.equal(h.calls.length,1);assert.equal(h.calls[0].input.pngBase64,png.toString('base64'));
  assert.equal(h.calls[0].input.pngDataUrl,undefined);
  const pinned=setup();assert.equal((await invoke(pinned.handler,{op:'prepare',operationId,input})).body.error,'INVALID_PNG');assert.equal(pinned.calls.length,0);
  for(const patch of [{pngSha256:'0'.repeat(64)},{pngDataUrl:input.pngDataUrl.slice(0,-8)+'AAAAAAAA'},
    {targetPointerId:'other'},{monthKey:'2026-13'},{data:{...input.data,title:''}},
    {baseline:{pointerVersion:-1,pointerEtag:'x'}},{ledger:PINS.schedule},{testMode:true}]) {
    const s=setup({validate});assert.notEqual((await invoke(s.handler,{op:'prepare',operationId,input:{...input,...patch}})).statusCode,200);assert.equal(s.calls.length,0);
  }
  let dispatches=0;const s=setup({validate,request:async()=>{dispatches++;throw Error('response lost');}});
  assert.equal((await invoke(s.handler,{op:'prepare',operationId,input})).body.error,'MANUAL_CHECK_REQUIRED');assert.equal(dispatches,1);
});
test('strict origin, duplicate keys, content type, limit, authority separation and no response internals',async()=>{
  for(const patch of [
    {headers:{host:'validation.invalid',origin:'https://evil.invalid','content-type':'application/json'}},
    {headers:{host:'validation.invalid',origin:'http://validation.invalid','content-type':'application/json'}},
    {body:'{"op":"confirm","op":"status","operationId":"'+operationId+'"}'},
    {body:'x'.repeat(3500001)}]) {
    const s=setup();assert.notEqual((await invoke(s.handler,undefined,patch)).statusCode,200);assert.equal(s.calls.length,0);
  }
  const s=setup({getSecret:()=>authority});assert.equal((await invoke(s.handler)).body.error,'INVALID_CAPABILITY');
  const h=setup({request:async()=>({ok:true,result:{status:'PREPARED',approvalId:'validation:synthetic',nonce:'synthetic',pngSha256:'a'.repeat(64),expiresAt:now+300000,blobId:'private',session,executorId:'private',secret:authority}})});
  const r=await invoke(h.handler);assert.deepEqual(Object.keys(r.body).sort(),['approvalId','expiresAt','nonce','ok','operationId','pngSha256','status']);
});
test('incomplete upstream approval fails closed and known validation rejection remains specific',async()=>{
  const incomplete=setup({request:async()=>({ok:true,result:{status:'PREPARED'}})});
  assert.equal((await invoke(incomplete.handler)).body.error,'MANUAL_CHECK_REQUIRED');
  for(const status of ['SAVE_REQUIRED','STALE_BASELINE','INVALID_PNG','INVALID_APPROVAL','INVALID_REQUEST']) {
    const h=setup({request:async()=>({ok:true,result:{status}})});
    const r=await invoke(h.handler);assert.equal(r.statusCode,409);assert.equal(r.body.error,status);
  }
});
test('operator enrollment is unprivileged; pinned metadata, lifetime, origin and explicit production gate govern issuance',async()=>{
  const {operatorIdentity,OPERATOR_COOKIE}=require('../lib/prepare-validation');
  const base=setup(); // Uses synthetic code-injected identity only for boundary unit cases.
  const allowed={PREPARE_VALIDATION_ENABLED:'true',VERCEL_ENV:'preview',PREPARE_VALIDATION_ORIGIN:'https://validation.invalid',
    PREPARE_VALIDATION_ISSUANCE_ENABLED:'true',PREPARE_VALIDATION_APPROVED_SESSION_SHA256:session,
    PREPARE_VALIDATION_APPROVED_OPERATION_ID:operationId,PREPARE_VALIDATION_APPROVED_AT:String(now-10000),PREPARE_VALIDATION_APPROVED_UNTIL:String(now+3600000)};
  for(const patch of [{PREPARE_VALIDATION_ISSUANCE_ENABLED:undefined},{PREPARE_VALIDATION_APPROVED_SESSION_SHA256:'b'.repeat(64)},
    {PREPARE_VALIDATION_APPROVED_OPERATION_ID:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'},
    {PREPARE_VALIDATION_APPROVED_AT:String(now+1)},{PREPARE_VALIDATION_APPROVED_UNTIL:String(now)},
    {PREPARE_VALIDATION_APPROVED_UNTIL:String(now+28800001)},{PREPARE_VALIDATION_APPROVED_UNTIL:'Infinity'},
    {PREPARE_VALIDATION_APPROVED_AT:'1e12'},{PREPARE_VALIDATION_ORIGIN:'https://validation.invalid/path'},
    {VERCEL_ENV:'production'},{VERCEL_ENV:'other',PREPARE_VALIDATION_PRODUCTION_ENABLED:'true'}]) {
    let secrets=0;const s=setup({config:{...allowed,...patch},getAuthority:()=>{secrets++;return authority;}});
    assert.notEqual((await invoke(s.handler,{op:'authorize',operationId})).statusCode,200);
    assert.equal(secrets,0);assert.equal(s.calls.length,0);
  }
  const production=setup({config:{...allowed,VERCEL_ENV:'production',PREPARE_VALIDATION_PRODUCTION_ENABLED:'true'}});
  assert.equal((await invoke(production.handler,{op:'authorize',operationId})).body.status,'AUTHORIZED');assert.equal(production.calls.length,0);
  let secrets=0;
  const enrolled=setup({identity:operatorIdentity,getAuthority:()=>{secrets++;return authority;}});
  const r=await invoke(enrolled.handler,{op:'session'});
  assert.equal(r.body.status,'OPERATOR_SESSION');assert.match(r.body.sessionSha256,/^[a-f0-9]{64}$/);
  assert.match(r.headers['Set-Cookie'],/HttpOnly; Secure; SameSite=Strict; Max-Age=28800/);
  assert.equal(secrets,0);assert.equal(enrolled.calls.length,0);
  assert.equal((await invoke(enrolled.handler,{op:'authorize',operationId})).body.error,'INVALID_CAPABILITY');
  const cookie=r.headers['Set-Cookie'].split(';')[0];
  assert.equal(operatorIdentity({headers:{cookie}}),r.body.sessionSha256);
  for(const malformed of ['',cookie+'; '+cookie,OPERATOR_COOKIE+'=x',OPERATOR_COOKIE+'=%61'.repeat(64)])assert.throws(()=>operatorIdentity({headers:{cookie:malformed}}));
  assert.equal(base.calls.length,0);
});
test('strict nested JSON, malformed lengths, spoofed hosts and browser capability injection never dispatch',async()=>{
  const headers={host:'validation.invalid',origin:'https://validation.invalid','content-type':'application/json'};
  const raw=JSON.stringify({op:'status',operationId});
  for(const length of ['-1','1.5','1e2',' 1','01','NaN','Infinity','999999999999999999999',['1'],'0']) {
    const h=setup();assert.equal((await invoke(h.handler,raw,{headers:{...headers,'content-length':length}})).statusCode,400);assert.equal(h.calls.length,0);
  }
  for(const extra of [{host:'evil.invalid',origin:'https://evil.invalid'},{host:'validation.invalid:443'},
    {'x-validation-capability':token()},{origin:['https://validation.invalid']}]) {
    const h=setup();assert.equal((await invoke(h.handler,raw,{headers:{...headers,...extra}})).statusCode,400);assert.equal(h.calls.length,0);
  }
  const {strictJson,createPreparationValidator}=require('../lib/prepare-validation');
  for(const json of ['{"a":{"x":1,"x":2}}','{"a":[{"x":1,"\\u0078":2}]}'])assert.throws(()=>strictJson(json));
  assert.deepEqual(strictJson('{"a":{"x":1},"b":{"x":2}}'),{a:{x:1},b:{x:2}});
  const validate=createPreparationValidator({pngBytes:png.length,pngSha256:sha});
  for(const patch of [{baseline:{...input.baseline,extra:true}},{baseline:{...input.baseline,pointerEtag:'x'.repeat(129)}},
    {baseline:{...input.baseline,pngSha256:42}},{data:{...input.data,owner:'pretend'}},{data:{...input.data,note:'x'.repeat(10001)}}])assert.throws(()=>validate({...input,...patch}));
});
