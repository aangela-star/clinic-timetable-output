const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function harness() {
  const objects = new Map(); let locked = false;
  const store = {get:id=>objects.get(id),put:(id,v)=>objects.set(id,JSON.parse(JSON.stringify(v))),ids:()=>[...objects.keys()]};
  const context={}; vm.runInNewContext(fs.readFileSync('apps-script/PublishJobs.gs','utf8'),context);
  const call=body=>context.publishJobTransition_(body,store,{acquire(){if(locked)throw Error('BUSY');locked=true;},release(){locked=false;}});
  return {call,objects,context};
}
const id='6426208f-c8ef-4407-9f8b-92bf7d8cc7ac';
const job={jobId:id};
test('duplicate job is idempotent; changed same ID fails closed',()=>{
 const h=harness();h.call({action:'publishJob.enqueue',job});h.call({action:'publishJob.enqueue',job});
 assert.equal(h.objects.size,1);assert.throws(()=>h.call({action:'publishJob.enqueue',job:{...job,title:'changed'}}));
});
test('claim race, repeated event and restart cannot reclaim a job',()=>{
 const h=harness();h.call({action:'publishJob.enqueue',job});
 assert.equal(h.call({action:'publishJob.claim',claimId:'one'}).job.jobId,id);
 assert.throws(()=>h.call({action:'publishJob.claim',claimId:'two'}));
 assert.throws(()=>h.call({action:'publishJob.claim',claimId:'one'}));
 assert.equal(h.objects.get(id).status,'claimed');
});
test('only original claim can complete; ambiguous work is terminal',()=>{
 const h=harness();h.call({action:'publishJob.enqueue',job});h.call({action:'publishJob.claim',claimId:'one'});
 assert.throws(()=>h.call({action:'publishJob.finish',jobId:id,claimId:'wrong',result:{status:'MANUAL_CHECK_REQUIRED'}}));
 h.call({action:'publishJob.finish',jobId:id,claimId:'one',result:{status:'MANUAL_CHECK_REQUIRED'}});
 assert.equal(h.objects.get(id).status,'manual-check');
 assert.equal(h.call({action:'publishJob.claim',claimId:'two'}).job,null);
});

test('simultaneous claim requests yield one claimant',async()=>{
 const h=harness();h.call({action:'publishJob.enqueue',job});
 const results=await Promise.allSettled(['one','two'].map(claimId=>Promise.resolve().then(()=>h.call({action:'publishJob.claim',claimId}))));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
});
test('failed persistence before claim response cannot authorize browser work',()=>{
 const h=harness();h.call({action:'publishJob.enqueue',job});
 let released=false;
 assert.throws(()=>h.context.publishJobTransition_({action:'publishJob.claim',claimId:'one'},{ids:()=>[id],get:()=>({job,status:'ready'}),put:()=>{throw Error('storage failed');}},{acquire(){},release(){released=true;}}));assert.equal(released,true);
});
test('result write replay is idempotent and conflicting result is rejected',()=>{
 const h=harness();h.call({action:'publishJob.enqueue',job});h.call({action:'publishJob.claim',claimId:'one'});
 const finish={action:'publishJob.finish',jobId:id,claimId:'one',result:{status:'PUBLISHED'}};
 h.call(finish);h.call(finish);assert.equal(h.objects.get(id).status,'published');
 assert.throws(()=>h.call({...finish,result:{status:'FAILED'}}));
});
