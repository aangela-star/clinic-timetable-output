const test=require('node:test'),assert=require('node:assert/strict');
const {createHandler}=require('../api/publish-jobs');
const {createSessionToken}=require('../lib/server-session');
process.env.CLINIC_SERVER_SECRET='test-only-'.repeat(8);
async function call(handler,{method='POST',body={},auth=true}={}){
 let result;const res={setHeader(){},end(text){result={status:this.statusCode,body:JSON.parse(text)};}};
 await handler({method,body,headers:{cookie:auth?'clinic_timetable_session='+createSessionToken():''}},res);return result;
}
test('handoff API enforces auth before gate and never calls CMS',async()=>{
 let calls=0;const h=createHandler({env:{},fetchImpl:async()=>{calls++;throw Error();}});
 assert.equal((await call(h,{auth:false})).status,401);assert.equal((await call(h)).body.error,'HANDOFF_DISABLED');assert.equal(calls,0);
});
test('invalid JSON and secret-containing job cannot reach Google',async()=>{
 let calls=0;const h=createHandler({env:{PUBLISH_HANDOFF_ENABLED:'true'},fetchImpl:async()=>{calls++;throw Error();}});
 assert.equal((await call(h,{body:'{broken'})).status,400);
 assert.equal((await call(h,{body:{password:'no'}})).status,400);assert.equal(calls,0);
});
test('unsupported methods rejected without upstream',async()=>{
 const h=createHandler({env:{PUBLISH_HANDOFF_ENABLED:'true'},fetchImpl:()=>{throw Error();}});
 assert.equal((await call(h,{method:'DELETE'})).status,405);
});

test('authenticated device forwards immutable job only to Google and returns receipt',async()=>{
 const fs=require('node:fs'),vm=require('node:vm');const {webcrypto}=require('node:crypto');
 const fixture={require,Buffer};vm.runInNewContext(fs.readFileSync(require.resolve('./publish_contract.test.cjs'),'utf8').split("test('")[0]+';globalThis.png=validPngBuffer();',fixture);
 const job=await require('../publish-core').createPublishJob({channelIds:['jinan-website'],primaryClinicId:'clinic-1',title:'115/九月',monthKey:'2026-09',humanConfirmed:true,pngDataUrl:'data:image/png;base64,'+fixture.png.toString('base64')},webcrypto);
 const calls=[];const h=createHandler({env:{PUBLISH_HANDOFF_ENABLED:'true'},fetchImpl:async(url,opts)=>{calls.push({url,body:JSON.parse(opts.body)});return {ok:true,json:async()=>({ok:true,jobId:job.jobId,status:'ready'})};}});
 const r=await call(h,{body:job});assert.equal(r.status,200);assert.equal(r.body.status,'ready');assert.equal(calls.length,1);
 assert.ok(calls[0].url.startsWith('https://script.google.com/'));assert.deepEqual(calls[0].body.job,job);
 assert.equal(calls[0].body.secret,process.env.CLINIC_SERVER_SECRET);assert.ok(!JSON.stringify(r.body).includes(process.env.CLINIC_SERVER_SECRET));
 const bad=createHandler({env:{PUBLISH_HANDOFF_ENABLED:'true'},fetchImpl:async()=>{throw Error('credential raw');}});
 assert.deepEqual((await call(bad,{body:job})).body,{ok:false,error:'HANDOFF_REQUIRES_CHECK'});
});
