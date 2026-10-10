const {createAdapter,MAX_BODY_BYTES}=require('./publish-store-adapter');
const {createHash}=require('node:crypto');
const disabled=createAdapter();
function sessionIdentity(req) {
  // Match server-session's last-cookie-wins and decoding semantics exactly.
  let token;
  for(const part of String(req.headers.cookie||'').split(';')) {
    const index=part.indexOf('=');
    if(index>=0 && part.slice(0,index).trim()==='clinic_timetable_session')token=decodeURIComponent(part.slice(index+1).trim());
  }
  if(!token)throw Error('AUTH_REQUIRED');return createHash('sha256').update(token).digest('hex');
}
function createPublishApi({adapter=disabled,identity=sessionIdentity}={}) {
  return async(req,res)=>{
    const send=(code,b)=>{res.statusCode=code;res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/json');res.end(JSON.stringify(b));};
    try {
      if(!['GET','POST'].includes(req.method))return send(405,{ok:false,error:'METHOD_NOT_ALLOWED'});
      if(req.method==='POST' && (!String(req.headers['content-type']||'').startsWith('application/json') || (req.headers.origin && req.headers.origin!==`http://${req.headers.host}` && req.headers.origin!==`https://${req.headers.host}`)))return send(400,{ok:false,error:'INVALID_REQUEST'});
      if(Buffer.byteLength(typeof req.body==='string'?req.body:JSON.stringify(req.body||{}))>MAX_BODY_BYTES)return send(413,{ok:false,error:'BODY_TOO_LARGE'});
      let b;
      try { b=typeof req.body==='string'?(req.body.trim()?JSON.parse(req.body):undefined):req.body; }
      catch(_) { return send(400,{ok:false,error:'INVALID_REQUEST'}); }
      if(req.method!=='GET' && (!b||Object.keys(b).sort().join(',')!=='input,op'))return send(400,{ok:false,error:'INVALID_REQUEST'});
      const r=await adapter.handle(req.method==='GET'?'pointer':b.op,b?.input,identity(req));
      const ok=['BASELINE','PREPARED','PUBLISHED'].includes(r.status);
      if(!ok)return send(r.status==='BODY_TOO_LARGE'?413:409,{ok:false,error:['CMS_RESPONSE_CONTRACT_UNVERIFIED','STALE_BASELINE','SAVE_REQUIRED','INVALID_PNG','INVALID_APPROVAL','EXPIRED_APPROVAL','BODY_TOO_LARGE','MANUAL_CHECK_REQUIRED'].includes(r.status)?r.status:'INVALID_REQUEST'});
      // Explicit public allowlist: never return provider journal, blobs, session, executor internals.
      const out={ok:true,status:r.status};
      for(const k of ['classification','baseline','approvalId','nonce','pngSha256','targetPointerId','expiresAt','mock'])if(r[k]!==undefined)out[k]=r[k];
      if(out.baseline) out.baseline={pointerVersion:out.baseline.pointerVersion,pointerEtag:out.baseline.pointerEtag,pngSha256:out.baseline.pngSha256};
      return send(200,out);
    }catch(_){return send(409,{ok:false,error:'MANUAL_CHECK_REQUIRED'});}
  };
}
module.exports={createPublishApi,sessionIdentity};
