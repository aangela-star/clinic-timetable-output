const test=require('node:test'),assert=require('node:assert/strict');
const {validationOperation}=require('../apps-script/PrepareValidation.gs');
function harness(fault='') {
  const events=[],rows=new Map();let stages=0;
  const input={operationId:'op',session:'session',executorId:'executor',requestSha256:'request',pngSha256:'png',pngBase64:'synthetic'};
  const io={now:()=>100,random:()=> 'random',read:id=>rows.has(id)?structuredClone(rows.get(id)):null,
    save(j){events.push('save:'+j.status);if(fault==='beforeIntent')throw Error();
      if(fault==='afterStage'&&j.status==='PREPARED')throw Error();
      rows.set(j.operationId,structuredClone(j));if(fault==='ambiguousIntent'&&j.status==='INTENT')throw Error();},
    stage(){events.push('stage');stages++;if(fault==='orphan')throw Error('permission/quota/timeout after create');return 'blob';},
    verify:()=>{events.push('verify');if(fault==='verify')throw Error();},
  };
  return {io,input,rows,events,get stages(){return stages;}};
}
test('intent durable before stage; duplicate prepare and lost response recover one immutable approval',()=>{
  const h=harness(),first=validationOperation(h.io,'prepare',h.input);
  assert.equal(first.status,'PREPARED');assert.equal(first.expiresAt,300100);
  assert.deepEqual(h.events,['save:INTENT','stage','verify','save:PREPARED']);
  for(const op of ['prepare','status','reconcile'])assert.deepEqual(validationOperation(h.io,op,h.input),first);
  assert.equal(h.stages,1);assert.equal(h.events.length,4);
  assert.match(first.approvalId,/^validation:/);
});
for(const fault of ['beforeIntent','ambiguousIntent','afterStage','orphan','verify'])test('fail closed '+fault,()=>{
  const h=harness(fault);assert.equal(validationOperation(h.io,'prepare',h.input).status,'MANUAL_CHECK_REQUIRED');
  const before=h.events.length;
  for(const op of ['status','reconcile']) {
    const r=validationOperation(h.io,op,h.input);assert.equal(r.status,fault==='beforeIntent'?'NOT_FOUND':'MANUAL_CHECK_REQUIRED');
  }
  assert.equal(h.events.length,before);
  if(fault!=='beforeIntent')for(let i=0;i<3;i++)assert.equal(validationOperation(h.io,'prepare',h.input).status,'MANUAL_CHECK_REQUIRED');
  assert.equal(h.stages,['afterStage','orphan','verify'].includes(fault)?1:0);
});
test('readonly absent/partial journal; binding and changed retry rejected; expiry never mutates',()=>{
  const h=harness();assert.equal(validationOperation(h.io,'status',h.input).status,'NOT_FOUND');assert.deepEqual(h.events,[]);
  validationOperation(h.io,'prepare',h.input);
  for(const patch of [{session:'other'},{executorId:'other'},{requestSha256:'other'}])assert.equal(validationOperation(h.io,'prepare',{...h.input,...patch}).status,'INVALID_APPROVAL');
  const before=h.events.length;h.io.now=()=>300101;
  assert.equal(validationOperation(h.io,'reconcile',h.input).status,'EXPIRED_APPROVAL');assert.equal(h.events.length,before);
  h.rows.set('op',{operationId:'op'});assert.equal(validationOperation(h.io,'status',h.input).status,'MANUAL_CHECK_REQUIRED');
  for(const op of ['confirm','pointer','bootstrap','blob'])assert.throws(()=>validationOperation(h.io,op,h.input),/INVALID_REQUEST/);
});
test('normal confirm rejects validation purpose even if a validation journal were accidentally supplied',()=>{
  const {publishStoreOperation}=require('../lib/publish-store-engine');
  const pointer={targetPointerId:'jinan-website/current',pointerVersion:0,pointerEtag:'empty'};
  for(const marker of [{purpose:'clinic-prepare-validation-v1'},{approvalId:'validation:opaque'}]) {
    const job={approvalId:'opaque',session:'s',executorId:'e',nonce:'n',expiresAt:300000,status:'PREPARED',baseline:pointer,pngSha256:'hash',...marker};
    let mutations=0;
    const io={pointer:()=>pointer,job:()=>job,now:()=>0,hashBlob:()=> 'hash',random:()=> 'r',saveJob:()=>mutations++,savePointer:()=>mutations++};
    assert.equal(publishStoreOperation(io,'confirm',{approvalId:job.approvalId,session:'s',executorId:'e',nonce:'n'}).status,'INVALID_APPROVAL');
    assert.equal(mutations,0);
  }
});
test('partially persisted PREPARED records never claim a complete approval',()=>{
  for(const field of ['pngSha256','operationId','approvalId','nonce','expiresAt']) {
    const h=harness();validationOperation(h.io,'prepare',h.input);
    delete h.rows.get('op')[field];
    assert.equal(validationOperation(h.io,'reconcile',h.input).status,'MANUAL_CHECK_REQUIRED',field);
  }
});
test('intent/final readback ambiguity never restages; final persisted record recovers read only',()=>{
  for(const phase of ['initialRead','intentReadback','finalReadback']) {
    const h=harness();let reads=0;const read=h.io.read;
    h.io.read=id=>{reads++;if(reads===({initialRead:1,intentReadback:2,finalReadback:3})[phase])throw Error('synthetic read failure');return read(id);};
    assert.equal(validationOperation(h.io,'prepare',h.input).status,'MANUAL_CHECK_REQUIRED');
    const before=h.events.length;
    assert.equal(validationOperation(h.io,'status',h.input).status,phase==='initialRead'?'NOT_FOUND':phase==='intentReadback'?'MANUAL_CHECK_REQUIRED':'PREPARED');
    assert.equal(h.events.length,before);
    if(phase!=='initialRead')validationOperation(h.io,'prepare',h.input);
    assert.equal(h.stages,phase==='finalReadback'?1:0);
  }
  const h=harness(),read=h.io.read;let reads=0;
  h.io.read=id=>{const row=read(id);return ++reads===2?{...row,nonce:'different'}:row;};
  assert.equal(validationOperation(h.io,'prepare',h.input).status,'MANUAL_CHECK_REQUIRED');assert.equal(h.stages,0);
  assert.equal(validationOperation(h.io,'prepare',h.input).status,'MANUAL_CHECK_REQUIRED');assert.equal(h.stages,0);
});
