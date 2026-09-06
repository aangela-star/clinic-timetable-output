const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const {executeJob}=require('../runner/publish-runner.cjs');
const {hash}=require('../lib/publish-job-validation');
const {createPublishJob}=require('../publish-core');
const fixture={require,Buffer};
vm.runInNewContext(fs.readFileSync(require.resolve('./publish_contract.test.cjs'),'utf8').split("test('")[0]+`;globalThis.source=validPngBuffer();globalThis.small=pngBuffer([chunk('IHDR',ihdr({width:675,height:1200})),chunk('IDAT',zlib.deflateSync(Buffer.alloc((675*4+1)*1200))),chunk('IEND')]);`,fixture);
async function setup(mode='success'){
 const old='/upload/baseline.png',next='/upload/new.png';
 const before=`<html><h1>unchanged</h1><img alt="" src="${old}" style="width: 675px; height: 1200px;" /><footer>unchanged</footer></html>`;
 const baseline={pageUrl:'https://www.tainanrehab.com/time.html',imagePath:old,imageDimensions:{width:675,height:1200},imageBytes:fixture.small.length,imageSha256:hash(fixture.small),verifiedAt:new Date().toISOString(),requiresRevalidation:true};
 const job=await createPublishJob({channelIds:['jinan-website'],primaryClinicId:'clinic-1',title:'115/九月',monthKey:'2026-09',humanConfirmed:true,pngDataUrl:'data:image/png;base64,'+fixture.source.toString('base64'),baseline},webcrypto);
 let submitted=false;const calls=[];
 const driver={session:async()=>{calls.push('session');return mode!=='session';},upload:async()=>{calls.push('upload');if(mode==='upload')throw Error('UPLOAD_FAILED');return next;},verifyDerived:async()=>mode!=='derived',apply:async()=>true,submitOnce:async()=>{calls.push('submit');submitted=true;if(mode==='ambiguous')throw Error('timeout raw secret');}};
 const fetchImpl=async url=>{
  let bytes=fixture.small;
  if(url.endsWith('time.html'))bytes=Buffer.from(submitted?before.replace(old,next)+(mode==='public'?'changed':''):before);
  if(mode==='drift'&&url.endsWith('time.html'))bytes=Buffer.from(before.replace(old,'/upload/changed.png'));
  return {ok:true,body:(async function*(){yield bytes;})()};
 };
 return {job,driver,fetchImpl,calls,root:fs.mkdtempSync(path.join(os.tmpdir(),'runner-test-'))};
}
for(const [mode,expected] of [['success','PUBLISHED'],['session','SESSION_EXPIRED'],['upload','UPLOAD_FAILED'],['derived','DERIVED_IMAGE_MISMATCH'],['ambiguous','SUBMIT_AMBIGUOUS'],['public','PUBLIC_VERIFY_FAILED'],['drift','BASELINE_DRIFT']]){
 test('runner '+mode+' keeps one-shot fail-closed behavior',async()=>{
  const s=await setup(mode);const r=await executeJob(s.job,{...s,allowWrites:true});
  assert.equal(r.status==='PUBLISHED'?r.status:r.code,expected);
  assert.ok(s.calls.filter(x=>x==='upload').length<=1);assert.ok(s.calls.filter(x=>x==='submit').length<=1);
  if(['drift','session'].includes(mode))assert.ok(!s.calls.includes('upload'));
  const result=JSON.parse(fs.readFileSync(path.join(s.root,s.job.jobId,'result.json')));assert.deepEqual(result,r);
  assert.ok(!JSON.stringify(r).includes('raw secret'));
 });
}
test('restart / replay / duplicate sync event never executes second upload',async()=>{
 const s=await setup();await executeJob(s.job,{...s,allowWrites:true});
 const second=await executeJob(s.job,{...s,allowWrites:true});assert.equal(second.code,'REPLAY_BLOCKED');assert.equal(s.calls.filter(x=>x==='upload').length,1);
});
test('invalid PNG hash, invalid JSON shape rejected before CMS',async()=>{
 const s=await setup();for(const job of [null,{}, {...s.job,png:{...s.job.png,sha256:'0'.repeat(64)}}]){const r=await executeJob(job,{...s,allowWrites:true});assert.equal(r.code,'INVALID_JOB');}assert.deepEqual(s.calls,[]);
});
test('dry run validates local/public bytes without any browser calls',async()=>{
 const s=await setup();const r=await executeJob(s.job,{...s,allowWrites:false});assert.equal(r.status,'DRY_RUN_PASS');assert.deepEqual(s.calls,[]);
});
