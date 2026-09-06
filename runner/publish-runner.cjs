'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {validateJob,hash,imagePath}=require('../lib/publish-job-validation');
const {capture,matches,getBytes,dimensions}=require('../lib/jinan-public-baseline');
function durable(file,value){
 const tmp=file+'.tmp';const fd=fs.openSync(tmp,'w',0o600);
 try{fs.writeFileSync(fd,Buffer.isBuffer(value)||typeof value==='string'?value:JSON.stringify(value,null,2));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 fs.renameSync(tmp,file);const dir=fs.openSync(path.dirname(file),'r');try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}
}
const CODES=new Set(['INVALID_JOB','BASELINE_DRIFT','SESSION_EXPIRED','UPLOAD_FAILED','DERIVED_IMAGE_MISMATCH','SUBMIT_AMBIGUOUS','PUBLIC_VERIFY_FAILED','BROWSER_RUNTIME_UNAVAILABLE','REPLAY_BLOCKED']);
async function executeJob(raw,{root,driver,fetchImpl=fetch,allowWrites=false}={}){
 let parsed;try{parsed=validateJob(raw);}catch{return {jobId:raw?.jobId||null,status:'FAILED',code:'INVALID_JOB',finishedAt:new Date().toISOString()};}
 const {job,png}=parsed,dir=path.join(root,job.jobId);fs.mkdirSync(root,{recursive:true,mode:0o700});
 try{fs.mkdirSync(dir,{mode:0o700});}catch(e){if(e.code==='EEXIST')return {jobId:job.jobId,status:'MANUAL_CHECK_REQUIRED',code:'REPLAY_BLOCKED',finishedAt:new Date().toISOString()};throw e;}
 let stage='PREPARED';const state={jobId:job.jobId,stage,uploadAttempts:0,submitAttempts:0};
 function mark(next){stage=next;state.stage=next;durable(path.join(dir,'state.json'),state);}
 durable(path.join(dir,'job.json'),job);
 let result;
 try{
  const before=await capture(fetchImpl);
  if(!matches(before.baseline,job.baseline))throw Error('BASELINE_DRIFT');
  durable(path.join(dir,'source.png'),png);
  durable(path.join(dir,'baseline.png'),before.image);
  durable(path.join(dir,'baseline.html'),before.page.toString('utf8'));
  durable(path.join(dir,'baseline.json'),before.baseline);
  mark('BASELINE_VERIFIED');
  if(!allowWrites){result={status:'DRY_RUN_PASS',code:'NO_CMS_OPERATIONS'};}
  else {
   if(!driver)throw Error('BROWSER_RUNTIME_UNAVAILABLE');
   if(!await driver.session())throw Error('SESSION_EXPIRED');
   state.uploadAttempts=1;mark('UPLOAD_DISPATCHING');
   const mediaPath=await driver.upload(path.join(dir,'source.png'));
   if(!imagePath(mediaPath)||mediaPath===job.baseline.imagePath)throw Error('UPLOAD_FAILED');
   const derived=await getBytes('https://www.tainanrehab.com'+encodeURI(mediaPath),fetchImpl);
   const d=dimensions(derived);if(d.width!==675||d.height!==1200)throw Error('DERIVED_IMAGE_MISMATCH');
   durable(path.join(dir,'derived.png'),derived);
   if(await driver.verifyDerived({source:path.join(dir,'source.png'),derived:path.join(dir,'derived.png')})!==true)throw Error('DERIVED_IMAGE_MISMATCH');
   state.mediaPath=mediaPath;state.derivedSha256=hash(derived);mark('DERIVED_VERIFIED');
   // Browser adapter must verify editor draft differs only by this exact img src.
   if(await driver.apply({oldPath:job.baseline.imagePath,newPath:mediaPath,width:675,height:1200,baselineHtml:path.join(dir,'baseline.html')})!==true)throw Error('PUBLIC_VERIFY_FAILED');
   const fresh=await capture(fetchImpl);if(!fresh.page.equals(before.page)||!fresh.image.equals(before.image))throw Error('BASELINE_DRIFT');
   state.submitAttempts=1;mark('SUBMIT_DISPATCHING');
   await driver.submitOnce();
   mark('SUBMIT_RETURNED');
   const after=await capture(fetchImpl);
   const expected=before.page.toString('utf8').replace('src="'+job.baseline.imagePath+'"','src="'+mediaPath+'"');
   if(after.page.toString('utf8')!==expected||after.target.src!==mediaPath||!after.image.equals(derived))throw Error('PUBLIC_VERIFY_FAILED');
   durable(path.join(dir,'after.html'),after.page.toString('utf8'));
   result={status:'PUBLISHED',publicImagePath:mediaPath,dimensions:d,bytes:derived.length,sha256:hash(derived),pageUnchanged:true};
  }
 }catch(e){
  const code=stage==='SUBMIT_DISPATCHING'?'SUBMIT_AMBIGUOUS':CODES.has(e.message)?e.message:'PUBLIC_VERIFY_FAILED';
  result={status:'MANUAL_CHECK_REQUIRED',code};
 }
 result={jobId:job.jobId,finishedAt:new Date().toISOString(),...result};
 durable(path.join(dir,'result.json'),result);mark(result.status);
 return result;
}
async function pickup({client,root,driver,allowWrites=false}){
 // Do not claim real work unless explicitly enabled and an adapter is available.
 if(!allowWrites||!driver)throw Error('RUNNER_NOT_ACTIVATED');
 fs.mkdirSync(root,{recursive:true,mode:0o700});
 const claimId=randomUUID();
 const pending=path.join(root,'pickup-pending.json');
 const fd=fs.openSync(pending,'wx',0o600);try{fs.writeFileSync(fd,JSON.stringify({claimId}));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 // A restart/timeout leaves this receipt; never silently claim another job.
 const claim=await client({action:'publishJob.claim',claimId});
 if(!claim.ok)throw Error('CLAIM_REQUIRES_RECONCILIATION');
 if(!claim.job){fs.unlinkSync(pending);return null;}
 durable(pending,{claimId,jobId:claim.job.jobId});
 const result=await executeJob(claim.job,{root,driver,allowWrites});
 const response=await client({action:'publishJob.finish',claimId,jobId:claim.job.jobId,result});
 if(!response.ok)throw Error('RESULT_WRITE_REQUIRES_RECONCILIATION');
 fs.unlinkSync(pending);return result;
}
module.exports={executeJob,pickup,durable};
