const {parsePngDataUrl} = require('./publish-contract');
const {readBounded}=require('./publish-http');
const {createHash} = require('node:crypto');
const {savedScheduleEqual,reconcilePublishOutcome} = require('../publish-core');
const MAX_BODY_BYTES=3500000, MAX_PNG_BYTES=2500000;
const hash=b=>createHash('sha256').update(b).digest('hex');
// Diagnostic reads never enable the publishing adapter or return upstream payloads.
function classifyPointerBaseline(pointer) {
  const unknown={status:'BASELINE',classification:'UNKNOWN'};
  if(!pointer || Object.getPrototypeOf(pointer)!==Object.prototype)return unknown;
  const keys=Reflect.ownKeys(pointer);
  const allowed=['pointerVersion','pointerEtag','targetPointerId','pngSha256','blobId','approvalId','nonce'];
  if(keys.some(k=>!allowed.includes(k) || !Object.hasOwn(Object.getOwnPropertyDescriptor(pointer,k),'value'))
    || pointer.targetPointerId!=='jinan-website/current')return unknown;
  if(Object.is(pointer.pointerVersion,0) && pointer.pointerEtag==='empty' && keys.length===3) {
    return {status:'BASELINE',classification:'VERIFIED_EMPTY'};
  }
  // Both existing stores generate UUID etags. Do not echo arbitrary upstream text.
  const uuid=value=>typeof value==='string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
  if(!Number.isSafeInteger(pointer.pointerVersion) || pointer.pointerVersion<=0 || pointer.pointerVersion>=Number.MAX_SAFE_INTEGER
    || !uuid(pointer.pointerEtag) || typeof pointer.pngSha256!=='string' || !/^[a-f0-9]{64}$/.test(pointer.pngSha256)
    || (Object.hasOwn(pointer,'blobId') && (typeof pointer.blobId!=='string' || !/^[A-Za-z0-9_-]{1,256}$/.test(pointer.blobId)))
    || ['approvalId','nonce'].some(k=>Object.hasOwn(pointer,k) && !uuid(pointer[k])))return unknown;
  return {status:'BASELINE',baseline:{pointerVersion:pointer.pointerVersion,pointerEtag:pointer.pointerEtag,pngSha256:pointer.pngSha256}};
}
function createPointerOnlyAdapter({store}) {
  return {async handle(op) {
    if(op!=='pointer')return {status:'CMS_RESPONSE_CONTRACT_UNVERIFIED'};
    try {return classifyPointerBaseline(await store.call('pointer'));}
    catch(_) {return {status:'BASELINE',classification:'UNKNOWN'};}
  }};
}
function createAdapter({enabled=false,store,readSchedule,executorId='vercel-publish-v1',mock=false,publicRead,checkPage}={}) {
  async function verify(result) {
    if(result.status!=='RECONCILE')return result;
    const j=result.job;
    for(let i=0;i<3;i++) {
      try {
        const p=await store.call('pointer');
        const bytes=await store.bytes(j.blobId);
        const current=await publicRead();
        const after=await store.call('pointer');
        if(reconcilePublishOutcome(j,{...p,verifiedSha256:hash(bytes)}).status==='PUBLISHED' && reconcilePublishOutcome(j,{...after,verifiedSha256:hash(current)}).status==='PUBLISHED' && after.pointerEtag===p.pointerEtag) return {status:'PUBLISHED',mock};
      }catch(_){}
      if(i<2)await new Promise(r=>setTimeout(r,20*(i+1)));
    }
    return {status:'MANUAL_CHECK_REQUIRED'};
  }
  return {async handle(op,input,session) {
    if(!enabled)return {status:'CMS_RESPONSE_CONTRACT_UNVERIFIED'};
    if(checkPage && ['pointer','prepare','confirm'].includes(op)){try{await checkPage();}catch(_){return {status:'MANUAL_CHECK_REQUIRED'};}}
    if(op==='pointer')return {status:'BASELINE',baseline:await store.call('pointer'),mock};
    if(op==='prepare') {
      if(!input || Object.keys(input).sort().join(',')!=='baseline,data,monthKey,pngDataUrl,pngSha256,targetPointerId' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(input.monthKey))return {status:'INVALID_REQUEST'};
      if(typeof input.data?.title!=='string'||!input.data.title.trim()||input.data.title.length>100||/[\u0000-\u001f\u007f-\u009f]/.test(input.data.title))return {status:'INVALID_REQUEST'};
      if(typeof input.pngDataUrl!=='string'||input.pngDataUrl.length>Math.ceil(MAX_PNG_BYTES/3)*4+22)return {status:'BODY_TOO_LARGE'};
      const {png}=parsePngDataUrl(input.pngDataUrl);
      if(hash(png)!==input.pngSha256)return {status:'INVALID_PNG'};
      if(!savedScheduleEqual(input.data,await readSchedule(input.monthKey)))return {status:'SAVE_REQUIRED'};
      return store.call('prepare',{baseline:input.baseline,monthKey:input.monthKey,pngBase64:png.toString('base64'),pngSha256:hash(png),targetPointerId:input.targetPointerId,factsSha256:hash(Buffer.from(JSON.stringify(input.data))),session,executorId});
    }
    if(!['confirm','reconcile'].includes(op)||Object.keys(input).sort().join(',')!=='approvalId,nonce')return {status:'INVALID_REQUEST'};
    const binding={...input,session,executorId};
    try{return await verify(await store.call(op,binding));}
    catch(_){try{return await verify(await store.call('reconcile',binding));}catch(_){return {status:'MANUAL_CHECK_REQUIRED'};}}
  }};
}
// One request per operation. Timeouts after a write are ambiguous: caller reconciles only.
function createAppsScriptTransport({url,secret,fetchImpl=fetch,enabled=false}) {
  async function request(payload) {
    if(!enabled)throw Error('DISABLED');
    // One overall 25s budget, including ContentService response redirect/body.
    const signal=AbortSignal.timeout(25000);
    let response=await fetchImpl(url,{method:'POST',redirect:'manual',credentials:'omit',referrerPolicy:'no-referrer',headers:{'Content-Type':'text/plain;charset=UTF-8'},signal,body:JSON.stringify({...payload,secret})});
    if(response.status===302 || response.status===303) {
      let next;
      try {next=new URL(response.headers.get('location'));}catch(_){throw Error('STORE_UNAVAILABLE');}
      if(next.protocol!=='https:' || next.hostname!=='script.googleusercontent.com'
        || next.port || next.username || next.password || next.hash || next.pathname!=='/macros/echo')throw Error('STORE_UNAVAILABLE');
      // Match prepare-validation: one credential-free GET, never replay the POST.
      response=await fetchImpl(next.href,{method:'GET',redirect:'manual',credentials:'omit',referrerPolicy:'no-referrer',signal});
    }
    if(!response.ok || (response.status>=300 && response.status<400))throw Error('STORE_UNAVAILABLE');
    const result=response.body?.getReader?JSON.parse((await readBounded(response,MAX_BODY_BYTES)).toString('utf8')):await response.json();
    if(!result || result.ok!==true)throw Error('STORE_UNAVAILABLE');
    return result;
  }
  async function call(op,input={}) {
    if(!['pointer','prepare','confirm','reconcile','blob'].includes(op))throw Error('INVALID_REQUEST');
    const result=await request({action:'publish',op,input});
    if(!result.result || typeof result.result!=='object')throw Error('STORE_UNAVAILABLE');
    return result.result;
  }
  return {request,call,async bytes(blobId){
    const {base64}=await call('blob',{blobId});
    if(typeof base64!=='string'||base64.length>Math.ceil(MAX_PNG_BYTES/3)*4||! /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64))throw Error('INVALID_PNG');
    return Buffer.from(base64,'base64');
  }};
}
module.exports={classifyPointerBaseline,createPointerOnlyAdapter,createAdapter,createAppsScriptTransport,MAX_BODY_BYTES,MAX_PNG_BYTES};
