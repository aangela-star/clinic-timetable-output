const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
const {PINS}=require('../lib/prepare-validation');
const authority='synthetic-validation-authority-'.repeat(2),shared='synthetic-shared-secret-'.repeat(2);
const operationId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',session='a'.repeat(64);
const sha=b=>crypto.createHash('sha256').update(Buffer.from(b)).digest('hex');
const fixture={require,Buffer};vm.runInNewContext(fs.readFileSync(require.resolve('./publish_contract.test.cjs'),'utf8').split("test('")[0]+';globalThis.png=validPngBuffer();',fixture);
const png=fixture.png;
const data={title:'115/9月',note:'SYNTHETIC ONLY',clinics:[{schedule:{},changes:[]}]};
const input={baseline:{pointerVersion:0,pointerEtag:'empty'},monthKey:'2026-09',data,
  targetPointerId:'jinan-website/current',pngBase64:png.toString('base64'),pngSha256:sha(png)};
function harness(options={}) {
  const events=[],files=new Map();let locked=false,writes=0;
  const props={CLINIC_SERVER_SECRET:shared,PREPARE_VALIDATION_ENABLED:'true',PREPARE_VALIDATION_AUTHORITY_SECRET:authority,
    PREPARE_VALIDATION_ISSUANCE_ENABLED:'true',PREPARE_VALIDATION_APPROVED_SESSION_SHA256:session,PREPARE_VALIDATION_APPROVED_OPERATION_ID:operationId,PREPARE_VALIDATION_APPROVED_AT:String(Date.now()-10000),PREPARE_VALIDATION_APPROVED_UNTIL:String(Date.now()+3600000),PREPARE_VALIDATION_DEPLOYMENT_ID:PINS.deployment,PUBLISH_SPREADSHEET_ID:PINS.ledger,PUBLISH_FOLDER_ID:PINS.folder,...options.props};
  function sheet(rows,label) {return {rows,getDataRange:()=>({getValues:()=>structuredClone(rows)}),getLastRow:()=>rows.length,
    getRange(r,c,n=1,m=1){return {getValue:()=>rows[r-1]?.[c-1]??'',getValues:()=>structuredClone(rows.slice(r-1,r-1+n).map(row=>row.slice(c-1,c-1+m))),
      getDisplayValues:()=>rows.slice(r-1,r-1+n).map(row=>row.slice(c-1,c-1+m).map(String)),
      setValues(v){assert.ok(locked);assert.equal(label,'journal');events.push('write');writes++;
        if(options.failWrite===writes)throw Error('quota');
        v.forEach((row,i)=>row.forEach((x,j)=>(rows[r-1+i]??=[])[c-1+j]=x));
      },setValue(){throw Error('FORBIDDEN setValue');}};}};}
  const journal=sheet([['operation_id','validation_json']],'journal');
  const pointer=sheet([[JSON.stringify({targetPointerId:'jinan-website/current',...input.baseline})]],'pointer');
  const schedules=sheet([['month_key','data_json','schema_version','updated_at'],['2026-09',JSON.stringify(data),1,'stamp']],'schedule');
  const ledger={getId:()=>options.openedId||PINS.ledger,getSheetByName:n=>n==='PrepareValidationJournal'?(options.missingJournal?null:journal):n==='PublishPointer'?pointer:null,
    insertSheet(){throw Error('FORBIDDEN insertSheet');}};
  const schedule={getId:()=>PINS.schedule,getSheetByName:()=>options.missingSchedule?null:schedules,insertSheet(){throw Error('FORBIDDEN schedule insert');}};
  const ctx={Date,JSON,Error,Number,String,
    PropertiesService:{getScriptProperties:()=>({getProperty:k=>props[k]})},
    ScriptApp:{getScriptId:()=>options.project||PINS.project,getService:()=>({getUrl:()=>options.url||`https://script.google.com/macros/s/${PINS.deployment}/exec`})},
    LockService:{getScriptLock:()=>({tryLock(){events.push('lock');if(locked||options.lockDenied)return false;locked=true;return true;},releaseLock(){assert.ok(locked);locked=false;events.push('release');}})},
    SpreadsheetApp:{getActiveSpreadsheet:()=>schedule,openById(id){events.push('open:'+id);assert.ok(locked);assert.ok([PINS.ledger,PINS.schedule].includes(id));return id===PINS.ledger?ledger:schedule;},
      flush(){assert.ok(locked);events.push('flush');if(options.failFlush===writes)throw Error('timeout');}},
    DriveApp:{getFolderById(id){events.push('folder');assert.equal(id,PINS.folder);return {getId:()=>options.folderId||id,createFile(blob){assert.ok(locked);events.push('stage');assert.ok(journal.rows.some(r=>String(r[1]).includes('INTENT')));
      if(options.reentrant)options.reentrant();const id='blob-'+files.size;files.set(id,blob);if(options.orphan)throw Error('response lost after create');return {getId:()=>id};}};},
      getFileById(id){events.push('blobRead');return {getBlob:()=>files.get(id)};}},
    Utilities:{getUuid:()=>crypto.randomUUID(),DigestAlgorithm:{SHA_256:'sha256'},computeDigest:(_,b)=>[...crypto.createHash('sha256').update(typeof b==='string'?b:Buffer.from(b)).digest()],
      computeHmacSha256Signature:(s,k)=>[...crypto.createHmac('sha256',k).update(s).digest()],base64Decode:s=>[...Buffer.from(s,'base64')],
      base64DecodeWebSafe:s=>[...Buffer.from(s,'base64url')],base64EncodeWebSafe:b=>Buffer.from(b).toString('base64url'),
      newBlob:b=>({getBytes:()=>b,getDataAsString:()=>Buffer.from(b).toString('utf8')})},json_:x=>x};
  vm.createContext(ctx);for(const file of ['Code.gs','PublishStore.gs','PrepareValidation.gs'])vm.runInContext(fs.readFileSync('apps-script/'+file,'utf8'),ctx);ctx.json_=x=>x;
  function capability(patch={},key=authority) {const p=Buffer.from(JSON.stringify({purpose:PINS.purpose,operationId,session,executorId:PINS.executorId,deploymentEndpoint:PINS.deploymentEndpoint,iat:Date.now()-1000,exp:Date.now()+200000,...patch})).toString('base64url');return p+'.'+crypto.createHmac('sha256',key).update(p).digest('base64url');}
  const body=(op='prepare',patch={})=>({action:'prepareValidation',secret:shared,op,capability:capability(),...(op==='prepare'?{input}:{}),...patch});
  const call=(op='prepare',patch={})=>ctx.validationRequest_(body(op,patch),(bytes,hash)=>ctx.validationPng_(bytes,hash,{pngBytes:png.length,pngSha256:sha(png)}));
  const post=(op='prepare',patch={})=>ctx.doPost({postData:{contents:JSON.stringify(body(op,patch))}});
  return {ctx,call,post,capability,props,events,files,journal,pointer,schedules,options};
}
test('authenticated Apps Script dispatcher default off, separate authority and exact runtime/configured pins before writes',()=>{
  const h=harness();assert.equal(h.post('status').result.status,'NOT_FOUND');
  assert.equal(h.post('prepare').result.status,'INVALID_PNG');assert.equal(h.files.size,0);
  for(const options of [{props:{PREPARE_VALIDATION_ENABLED:undefined}},
    {props:{PUBLISH_SPREADSHEET_ID:PINS.schedule}},{props:{PUBLISH_SPREADSHEET_ID:'wrong'}},
    {props:{PUBLISH_FOLDER_ID:'wrong'}},{props:{PREPARE_VALIDATION_DEPLOYMENT_ID:'wrong'}},
    {project:'wrong'},{openedId:PINS.schedule},{folderId:'wrong'},
    {props:{PREPARE_VALIDATION_AUTHORITY_SECRET:shared}}]) {
    const s=harness(options);const r=s.call();assert.notEqual(r.result?.status,'PREPARED');assert.equal(s.files.size,0);assert.ok(!s.events.includes('write'));
  }
  for(const patch of [{secret:'wrong'},{capability:'wrong'},{capability:h.capability({purpose:'publish'})},
    {capability:h.capability({executorId:'wrong'})},{capability:h.capability({},shared)}])assert.equal(h.post('status',patch).ok,false);
});
test('prepare durable, concurrent dispatch locked out, duplicate and response loss reconcile read-only by operation ID',async()=>{
  const h=harness();let concurrent;
  h.options.reentrant=()=>{concurrent=h.call();};
  const p=h.call().result;assert.equal(p.status,'PREPARED');assert.notEqual(concurrent.result?.status,'PREPARED');
  assert.equal(h.files.size,1);assert.equal(h.events.filter(e=>e==='write').length,2);
  const before=h.events.filter(e=>e==='write'||e==='stage'||e==='flush').length;
  for(const op of ['prepare','status','reconcile'])assert.deepEqual(h.call(op).result,p);
  assert.equal(h.events.filter(e=>e==='write'||e==='stage'||e==='flush').length,before);
  const results=await Promise.all([Promise.resolve().then(()=>h.call()),Promise.resolve().then(()=>h.call())]);
  assert.ok(results.every(r=>r.result.status==='PREPARED'));assert.equal(h.files.size,1);
  assert.equal(h.post('confirm').ok,false);assert.equal(h.post('pointer').ok,false);assert.equal(h.post('bootstrap').ok,false);
  // Normal publish cannot resolve a validation approval and must not mutate pointer.
  const normal=h.ctx.publishStoreOperation({pointer:()=>({...input.baseline,targetPointerId:'jinan-website/current'}),job:()=>null},'confirm',{approvalId:p.approvalId,nonce:p.nonce,session,executorId:PINS.executorId});
  assert.equal(normal.status,'INVALID_APPROVAL');
});
for(const options of [{failWrite:1},{failFlush:1},{failWrite:2},{failFlush:2},{orphan:true}])test('real wrapper journal/Drive fault '+JSON.stringify(options),()=>{
  const h=harness(options);assert.equal(h.call().result.status,'MANUAL_CHECK_REQUIRED');
  const before=h.events.filter(e=>e==='write'||e==='stage'||e==='flush').length;
  const status=h.call('reconcile').result.status;
  assert.equal(status,options.failWrite===1?'NOT_FOUND':options.failFlush===2?'PREPARED':'MANUAL_CHECK_REQUIRED');
  assert.equal(h.events.filter(e=>e==='write'||e==='stage'||e==='flush').length,before);
  if(options.failWrite!==1) {h.call();assert.equal(h.events.filter(e=>e==='stage').length,options.failFlush===1?0:1);}
});
test('readonly missing/partial/duplicate journal and absent schedule never bootstrap or repair',()=>{
  for(const options of [{missingJournal:true},{missingSchedule:true},{}]) {
    const h=harness(options);if(!options.missingJournal)h.journal.rows.push([operationId,'']);
    for(const op of ['status','reconcile'])assert.equal(h.call(op).result.status,'MANUAL_CHECK_REQUIRED');
    assert.ok(!h.events.includes('write'));assert.equal(h.files.size,0);
  }
  const h=harness();h.journal.rows.push([operationId,'{}'],[operationId,'{}']);assert.equal(h.call('status').result.status,'MANUAL_CHECK_REQUIRED');
});
test('schedule equality, PNG tamper and stale baseline prevent all staging',()=>{
  for(const patch of [{pngSha256:'0'.repeat(64)},{pngBase64:input.pngBase64.slice(0,-8)+'AAAAAAAA'},
    {data:{...data,note:'changed'}},{baseline:{pointerVersion:1,pointerEtag:'changed'}},{targetPointerId:'other'},
    {ledger:PINS.schedule},{monthKey:'2026-13'}]) {
    const h=harness();assert.notEqual(h.call('prepare',{input:{...input,...patch}}).result?.status,'PREPARED');assert.equal(h.files.size,0);assert.ok(!h.events.includes('write'));
  }
  const h=harness({missingSchedule:true});assert.equal(h.call().result.status,'SAVE_REQUIRED');assert.ok(!h.events.includes('write'));
});
// JSON text is essential: an object-literal __proto__ would not be an own data key.
const protoClinics=[
  '{"schedule":{},"changes":[],"__proto__":{"extra":"value"}}',
  '{"schedule":{},"changes":[],"__proto__":null}',
  '{"schedule":{},"changes":[],"__proto__":"value"}',
  '{"schedule":{"nested":[{"__proto__":{"extra":"value"}}]},"changes":[]}'
];
function rawProtoPrepare(h,clinicJson) {
  const body={action:'prepareValidation',secret:shared,op:'prepare',capability:h.capability(),input};
  const raw=JSON.stringify(body).replace(JSON.stringify(data.clinics),'['+clinicJson+']');
  return h.ctx.validationRequest_(h.ctx.validationStrictJson_(raw),
    (bytes,hash)=>h.ctx.validationPng_(bytes,hash,{pngBytes:png.length,pngSha256:sha(png)})).result;
}
const mutations=h=>h.events.filter(e=>['write','flush','stage'].includes(e));
test('raw JSON __proto__ saved-fact mismatch rejects both directions without writes or staging on retry',()=>{
  for(const clinicJson of protoClinics) {
    const stripped=JSON.stringify(JSON.parse(clinicJson),(k,v)=>k==='__proto__'?undefined:v);
    for(const [saved,requested] of [[stripped,clinicJson],[clinicJson,stripped]]) {
      const h=harness();h.schedules.rows[1][1]=JSON.stringify({...data,clinics:[JSON.parse(saved)]});
      for(let attempt=0;attempt<2;attempt++)assert.equal(rawProtoPrepare(h,requested).status,'SAVE_REQUIRED');
      assert.deepEqual(mutations(h),[]);assert.equal(h.files.size,0);assert.equal(h.journal.rows.length,1);
      assert.ok(!h.events.includes('folder'));
    }
  }
});
test('raw JSON __proto__ changed retries bind the digest with no new writes or restaging',()=>{
  for(const clinicJson of protoClinics) {
    const stripped=JSON.stringify(JSON.parse(clinicJson),(k,v)=>k==='__proto__'?undefined:v);
    for(const [initial,changed] of [[stripped,clinicJson],[clinicJson,stripped]]) {
      for(const options of [{},{orphan:true}]) {
        const h=harness(options);h.schedules.rows[1][1]=JSON.stringify({...data,clinics:[JSON.parse(initial)]});
        const first=rawProtoPrepare(h,initial);
        assert.equal(first.status,options.orphan?'MANUAL_CHECK_REQUIRED':'PREPARED');
        const before=mutations(h),rows=structuredClone(h.journal.rows);
        assert.equal(h.files.size,1);assert.equal(before.filter(e=>e==='stage').length,1);
        for(let attempt=0;attempt<2;attempt++)assert.equal(rawProtoPrepare(h,changed).status,'INVALID_APPROVAL');
        assert.deepEqual(rawProtoPrepare(h,initial),first);
        assert.equal(h.call('status').result.status,first.status);
        assert.equal(h.call('reconcile').result.status,first.status);
        assert.deepEqual(mutations(h),before);assert.deepEqual(h.journal.rows,rows);assert.equal(h.files.size,1);
      }
    }
  }
});
test('raw JSON __proto__ canonical objects retain own data recursively without prototype mutation',()=>{
  const h=harness(),raw='{"__proto__":{"extra":"value"},"nested":[{"__proto__":null},{"__proto__":"value"}],"constructor":{"prototype":{"extra":"data"}}}';
  const source=h.ctx.validationStrictJson_(raw),before=JSON.stringify(source);
  const hostPrototype=Object.getOwnPropertyDescriptors(Object.prototype);
  const vmPrototype=vm.runInContext('Object.getOwnPropertyDescriptors(Object.prototype)',h.ctx);
  const canonical=h.ctx.validationCanonical_(source);
  function check(original,actual) {
    if(!original || typeof original!=='object')return assert.equal(actual,original);
    if(Array.isArray(original))assert.ok(Array.isArray(actual));
    else assert.equal(Object.getPrototypeOf(actual),null);
    assert.deepEqual(Object.keys(actual).sort(),Object.keys(original).sort());
    for(const key of Object.keys(original)) {
      assert.ok(Object.hasOwn(actual,key));check(original[key],actual[key]);
    }
  }
  check(source,canonical);
  assert.deepEqual(JSON.parse(JSON.stringify(canonical)),JSON.parse(raw));
  assert.equal(JSON.stringify(source),before);assert.equal(Object.getPrototypeOf(source),Object.prototype);
  assert.equal(canonical.extra,undefined);
  assert.deepEqual(Object.getOwnPropertyDescriptors(Object.prototype),hostPrototype);
  assert.deepEqual(vm.runInContext('Object.getOwnPropertyDescriptors(Object.prototype)',h.ctx),vmPrototype);
});
test('all pins agree; cross-session recovery, expired capabilities and unsigned scope fail without writes',()=>{
  const h=harness();assert.deepEqual(JSON.parse(JSON.stringify(h.ctx.validationPins_())),PINS);
  h.call();const before=h.events.filter(e=>e==='write'||e==='stage'||e==='flush').length;
  assert.equal(h.call('status',{capability:h.capability({session:'b'.repeat(64)})}).error,'INVALID_CAPABILITY');
  for(const patch of [{exp:Date.now()-1},{iat:Date.now()+60000},{exp:Date.now()+600000},{executorId:'other'},
    {operationId:'bad'},{owner:'iai.canada.angela@gmail.com'}])assert.equal(h.post('status',{capability:h.capability(patch)}).ok,false);
  assert.equal(h.events.filter(e=>e==='write'||e==='stage'||e==='flush').length,before);
});
test('actual endpoint-to-Apps-Script transport: lost prepared response recovers without another write',async()=>{
  const {createValidationHandler,createPreparationValidator}=require('../lib/prepare-validation');
  const {createAppsScriptTransport}=require('../lib/publish-store-adapter');
  const h=harness();let dispatches=0,drop=true;
  const transport=createAppsScriptTransport({enabled:true,url:`https://script.google.com/macros/s/${PINS.deployment}/exec`,secret:shared,
    fetchImpl:async(url,options)=>{
      assert.equal(url,`https://script.google.com/macros/s/${PINS.deployment}/exec`);
      const body=JSON.parse(options.body);assert.equal(body.secret,shared);assert.equal(body.action,'prepareValidation');dispatches++;
      const result=h.ctx.validationRequest_(body,(bytes,hash)=>h.ctx.validationPng_(bytes,hash,{pngBytes:png.length,pngSha256:sha(png)}));
      if(drop){drop=false;throw Error('lost response after durable prepared');}
      return Response.json(result);
    }});
  const handler=createValidationHandler({config:{...h.props,VERCEL_ENV:'preview',PREPARE_VALIDATION_ORIGIN:'https://local.invalid'},authenticate:()=>true,identity:()=>session,
    getAuthority:()=>authority,getSecret:()=>shared,request:transport.request,validate:createPreparationValidator({pngBytes:png.length,pngSha256:sha(png)})});
  async function invoke(op) {
    const res={setHeader(){},end(s){this.body=JSON.parse(s);}};
    const prepareInput={...input,pngDataUrl:'data:image/png;base64,'+input.pngBase64};delete prepareInput.pngBase64;
    await handler({method:'POST',headers:{host:'local.invalid',origin:'https://local.invalid','content-type':'application/json'},
      body:{op,operationId,...(op==='prepare'?{input:prepareInput}:{})}},res);
    return res.body;
  }
  assert.equal((await invoke('prepare')).error,'MANUAL_CHECK_REQUIRED');assert.equal(dispatches,1);assert.equal(h.files.size,1);
  const writes=h.events.filter(e=>e==='write'||e==='stage'||e==='flush').length;
  const recovered=await invoke('reconcile');assert.equal(recovered.status,'PREPARED');assert.match(recovered.approvalId,/^validation:/);
  assert.equal(recovered.blobId,undefined);assert.equal((await invoke('status')).approvalId,recovered.approvalId);
  assert.equal((await invoke('prepare')).approvalId,recovered.approvalId);
  assert.equal(h.events.filter(e=>e==='write'||e==='stage'||e==='flush').length,writes);assert.equal(h.files.size,1);
});
test('service URL is not invocation attestation and does not replace signed endpoint or PNG checks',()=>{
  for(const url of [`https://script.google.com/macros/s/${PINS.deployment}/exec`,
    `https://script.google.com/macros/s/${PINS.deployment}/dev`,'https://script.google.com/macros/s/alias/exec',null]) {
    const h=harness();h.ctx.ScriptApp.getService=()=>({getUrl:()=>url});
    assert.equal(h.post().result.status,'INVALID_PNG');
    assert.equal(h.post('status').result.status,'NOT_FOUND');assert.equal(h.files.size,0);assert.ok(!h.events.includes('write'));
  }
});
test('write-side signed scope still requires independent approval metadata before any journal write',()=>{
  for(const patch of [{PREPARE_VALIDATION_ISSUANCE_ENABLED:'false'},
    {PREPARE_VALIDATION_APPROVED_SESSION_SHA256:'b'.repeat(64)},
    {PREPARE_VALIDATION_APPROVED_OPERATION_ID:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'},
    {PREPARE_VALIDATION_APPROVED_AT:String(Date.now()+60000)},
    {PREPARE_VALIDATION_APPROVED_UNTIL:String(Date.now()-1)},
    {PREPARE_VALIDATION_APPROVED_UNTIL:String(Date.now()+30000000)},
    {PREPARE_VALIDATION_APPROVED_UNTIL:'Infinity'}]) {
    const h=harness({props:patch});assert.equal(h.call().error,'INVALID_CAPABILITY');assert.deepEqual(h.events,[]);
  }
  const h=harness();
  const raw=JSON.stringify({action:'prepareValidation',secret:shared,op:'status',capability:h.capability()}).replace('"op":"status"','"op":"prepare","op":"status"');
  assert.equal(h.ctx.doPost({postData:{contents:raw}}).error,'INVALID_REQUEST');assert.deepEqual(h.events,[]);
});
test('authenticated synthetic enrollment -> owner metadata -> issuance -> prepare loss -> expired read-only recovery',async()=>{
  const {createValidationHandler,createPreparationValidator,OPERATOR_COOKIE}=require('../lib/prepare-validation');
  const {createAppsScriptTransport}=require('../lib/publish-store-adapter');
  // Actual session module, isolated fake server environment; no process credential reads or mutations.
  let clock=Date.now();const server={require,Buffer,process:{env:{CLINIC_SERVER_SECRET:shared}},module:{exports:{}}};
  vm.runInNewContext(fs.readFileSync('lib/server-session.js','utf8'),server);
  const auth=server.module.exports, login=auth.createSessionToken(clock);
  const h=harness();h.ctx.Date={now:()=>clock};
  delete h.props.PREPARE_VALIDATION_APPROVED_SESSION_SHA256;
  const config={...h.props,VERCEL_ENV:'preview',PREPARE_VALIDATION_ORIGIN:'https://local.invalid'};
  let dispatches=0,drop=true,secretReads=0;
  const transport=createAppsScriptTransport({enabled:true,url:`https://script.google.com/macros/s/${PINS.deployment}/exec`,secret:shared,
    fetchImpl:async(url,options)=>{
      const b=JSON.parse(options.body);assert.equal(b.secret,shared);assert.equal(url,`https://script.google.com/macros/s/${PINS.deployment}/exec`);
      assert.ok(!options.body.includes(authority));dispatches++;
      const result=h.ctx.validationRequest_(b,(bytes,hash)=>h.ctx.validationPng_(bytes,hash,{pngBytes:png.length,pngSha256:sha(png)}));
      if(drop){drop=false;throw Error('synthetic dropped response');}return Response.json(result);
    }});
  const handler=createValidationHandler({config,authenticate:auth.hasValidSession,now:()=>clock,
    getSecret:()=>shared,getAuthority:()=>{secretReads++;return authority;},request:transport.request,
    validate:createPreparationValidator({pngBytes:png.length,pngSha256:sha(png)})});
  let cookie='clinic_timetable_session='+encodeURIComponent(login);
  async function invoke(op,patch={}) {
    const res={headers:{},setHeader(k,v){this.headers[k]=v;},end(s){this.body=JSON.parse(s);}};
    const dataUrlInput={...input,pngDataUrl:'data:image/png;base64,'+input.pngBase64};delete dataUrlInput.pngBase64;
    await handler({method:'POST',headers:{host:'local.invalid',origin:'https://local.invalid','content-type':'application/json',cookie},
      body:{op,...(op==='session'?{}:{operationId}),...(op==='prepare'?{input:dataUrlInput}:{}),...patch}},res);
    const response=JSON.stringify(res.body);assert.ok(!response.includes(shared));assert.ok(!response.includes(authority));assert.ok(!response.includes(login));
    assert.equal(res.headers['Cache-Control'],'no-store');return res;
  }
  const enrollment=await invoke('session');cookie+='; '+enrollment.headers['Set-Cookie'].split(';')[0];
  assert.equal((await invoke('authorize')).body.error,'INVALID_CAPABILITY');assert.equal(secretReads,0);assert.equal(dispatches,0);
  // Simulates separately authenticated owner's metadata-only approval on BOTH fake boundaries.
  h.props.PREPARE_VALIDATION_APPROVED_SESSION_SHA256=enrollment.body.sessionSha256;
  config.PREPARE_VALIDATION_APPROVED_SESSION_SHA256=enrollment.body.sessionSha256;
  assert.equal((await invoke('session')).headers['Set-Cookie'],undefined); // no renewal
  assert.equal((await invoke('authorize')).body.status,'AUTHORIZED');assert.equal(dispatches,0);
  const originalCookie=cookie;cookie='clinic_timetable_session=forged; '+cookie.split('; ')[1];
  assert.equal((await invoke('authorize')).statusCode,401);cookie=originalCookie;
  assert.equal((await invoke('prepare')).body.error,'MANUAL_CHECK_REQUIRED');assert.equal(dispatches,1);assert.equal(h.files.size,1);
  const journal=JSON.parse(h.journal.rows[1][1]),before=h.events.filter(e=>['write','flush','stage'].includes(e)).length;
  assert.ok(!JSON.stringify(journal).includes(shared));assert.ok(!JSON.stringify(journal).includes(authority));
  clock+=300001;
  const recovered=(await invoke('status')).body;
  assert.equal(recovered.status,'EXPIRED_APPROVAL');assert.equal(recovered.expiresAt,journal.expiresAt);
  assert.equal(recovered.approvalId,journal.approvalId);assert.equal(recovered.blobId,undefined);
  assert.equal((await invoke('reconcile')).body.expiresAt,journal.expiresAt);
  assert.equal(h.events.filter(e=>['write','flush','stage'].includes(e)).length,before);assert.equal(h.files.size,1);
  cookie='clinic_timetable_session='+encodeURIComponent(login)+'; '+OPERATOR_COOKIE+'='+'0'.repeat(64);
  assert.equal((await invoke('status')).body.error,'INVALID_CAPABILITY');cookie=originalCookie;
  clock=Number(config.PREPARE_VALIDATION_APPROVED_UNTIL);
  assert.equal((await invoke('status')).body.error,'INVALID_CAPABILITY');assert.equal(h.files.size,1);
});
test('approval revocation or expiry immediately before persistence/staging leaves no new blob',()=>{
  for(const point of ['beforeIntent','afterIntent']) {
    const h=harness();
    if(point==='beforeIntent') {
      const get=h.ctx.DriveApp.getFolderById;
      h.ctx.DriveApp.getFolderById=id=>{const folder=get(id);h.props.PREPARE_VALIDATION_ISSUANCE_ENABLED='false';return folder;};
    } else {
      const flush=h.ctx.SpreadsheetApp.flush;
      h.ctx.SpreadsheetApp.flush=()=>{flush();h.props.PREPARE_VALIDATION_APPROVED_UNTIL=String(Date.now()-1);};
    }
    assert.equal(h.call().result.status,'MANUAL_CHECK_REQUIRED');assert.equal(h.files.size,0);
    assert.equal(h.events.filter(x=>x==='write').length,point==='beforeIntent'?0:1);
  }
});
