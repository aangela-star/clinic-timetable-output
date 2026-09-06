'use strict';
const {hasValidSession,getServerSecret}=require('../lib/server-session');
const {validateJob}=require('../lib/publish-job-validation');
const UPSTREAM='https://script.google.com/macros/s/AKfycbz5OXGNDZJWEj2-W1g-1r_SISPjYYcI-7gsUsivt3Rx7-zY6AzpQqqZTIFROVKMU1eh3w/exec';
function createHandler({fetchImpl=fetch,env=process.env}={}) {
 return async(req,res)=>{
  function reply(status,body){res.statusCode=status;res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');res.end(JSON.stringify(body));}
  try {
   if(!hasValidSession(req))return reply(401,{ok:false,error:'AUTH_REQUIRED'});
   if(!['GET','POST'].includes(req.method))return reply(405,{ok:false,error:'METHOD_NOT_ALLOWED'});
   if(env.PUBLISH_HANDOFF_ENABLED!=='true')return reply(503,{ok:false,error:'HANDOFF_DISABLED'});
   if(req.method==='GET'){const {capture}=require('../lib/jinan-public-baseline');return reply(200,{ok:true,baseline:(await capture(fetchImpl)).baseline});}
   const raw=typeof req.body==='string'?req.body:JSON.stringify(req.body);
   if(Buffer.byteLength(raw)>3500000)return reply(413,{ok:false,error:'JOB_TOO_LARGE'});
   let job;try{job=validateJob(JSON.parse(raw)).job;}catch{return reply(400,{ok:false,error:'INVALID_JOB'});}
   const response=await fetchImpl(UPSTREAM,{method:'POST',redirect:'follow',signal:AbortSignal.timeout(25000),headers:{'Content-Type':'text/plain;charset=UTF-8'},body:JSON.stringify({action:'publishJob.enqueue',secret:getServerSecret(),job})});
   const result=await response.json();
   if(!response.ok||!result.ok||result.jobId!==job.jobId||!['ready','claimed','published','manual-check'].includes(result.status))return reply(502,{ok:false,error:'HANDOFF_REQUIRES_CHECK'});
   return reply(200,{ok:true,jobId:job.jobId,status:result.status});
  } catch{return reply(502,{ok:false,error:'HANDOFF_REQUIRES_CHECK'});}
 };
}
module.exports=createHandler();module.exports.createHandler=createHandler;
