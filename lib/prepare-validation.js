// Server-only issuance for one explicitly approved operator session and operation.
const {createHash, createHmac, timingSafeEqual, randomBytes} = require('node:crypto');
const {hasValidSession, getServerSecret} = require('./server-session');

const {MAX_BODY_BYTES} = require('./publish-store-adapter');
const PINS = Object.freeze({
  project:'1n8b6OLv_LyOONJeLGCbCDUnudpUGgM7PsbSUVvpUqm8l1j_m4rTJNETB',
  deployment:'AKfycbz5OXGNDZJWEj2-W1g-1r_SISPjYYcI-7gsUsivt3Rx7-zY6AzpQqqZTIFROVKMU1eh3w',
  deploymentEndpoint:'https://script.google.com/macros/s/AKfycbz5OXGNDZJWEj2-W1g-1r_SISPjYYcI-7gsUsivt3Rx7-zY6AzpQqqZTIFROVKMU1eh3w/exec',
  ledger:'1mphbqFGjstnF_SOrBVG242d4MH2aN274QGtGyjdN9Gg',
  folder:'1mbllfD0z51GgTDsVaKypendQVy_6lG9r',
  schedule:'1wugjTcB9R2x_KlnJESZF6h0z1KNT3NcE5zkFDLrqSzg',
  pngSha256:'f78a1ed1cb91a89cea9962efd5de76ae0d07702c801ce391664640cec402725d',
  pngBytes:781588, width:2160, height:3840,
  purpose:'clinic-prepare-validation-v1', executorId:'vercel-isolated-prepare-validation-v1',
});
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
function exact(value, keys) {
  return value && typeof value==='object' && !Array.isArray(value)
    && Object.keys(value).sort().join(',')===keys.split(',').sort().join(',');
}
const OPERATOR_COOKIE = '__Secure-clinic_validation_operator';
const APPROVAL_WINDOW = 8*60*60*1000;
function operatorToken(req) {
  const values=String(req.headers.cookie||'').split(';').map(x=>x.trim()).filter(x=>x.startsWith(OPERATOR_COOKIE+'='));
  if(values.length!==1)return null;
  const token=values[0].slice(OPERATOR_COOKIE.length+1);
  return /^[a-f0-9]{64}$/.test(token)?token:null;
}
function operatorIdentity(req) {
  const token=operatorToken(req);
  if(!token)throw Error('INVALID_CAPABILITY');
  return createHash('sha256').update(token).digest('hex');
}
function approvedScope(config, session, operationId, now) {
  const start=config.PREPARE_VALIDATION_APPROVED_AT, end=config.PREPARE_VALIDATION_APPROVED_UNTIL;
  if(config.PREPARE_VALIDATION_ISSUANCE_ENABLED!=='true'
    || typeof session!=='string' || !/^[a-f0-9]{64}$/.test(session)
    || config.PREPARE_VALIDATION_APPROVED_SESSION_SHA256!==session
    || typeof operationId!=='string' || !UUID.test(operationId)
    || config.PREPARE_VALIDATION_APPROVED_OPERATION_ID!==operationId
    || typeof start!=='string' || !/^[0-9]{13}$/.test(start)
    || typeof end!=='string' || !/^[0-9]{13}$/.test(end)
    || Number(start)>now || Number(end)<=now || Number(end)<=Number(start)
    || Number(end)-Number(start)>APPROVAL_WINDOW)throw Error('INVALID_CAPABILITY');
  return {purpose:PINS.purpose,operationId,session,executorId:PINS.executorId,deploymentEndpoint:PINS.deploymentEndpoint,iat:now,exp:Math.min(now+300000,Number(end))};
}
// Reject duplicate keys at every nesting depth, including escaped key aliases.
function strictJson(raw) {
  if(typeof raw!=='string')raw=JSON.stringify(raw);
  const stack=[];
  for(let i=0;i<raw.length;i++) {
    const c=raw[i];
    if(c==='{' || c==='[')stack.push(c==='{'?new Set():null);
    else if(c==='}' || c===']')stack.pop();
    else if(c==='"') {
      const start=i++;
      for(;i<raw.length;i++){if(raw[i]==='\\'){i++;continue;}if(raw[i]==='"')break;}
      let next=i+1;while(/\s/.test(raw[next]||''))next++;
      if(raw[next]===':') {
        const key=JSON.parse(raw.slice(start,i+1)),set=stack[stack.length-1];
        if(!set || set.has(key))throw Error('INVALID_REQUEST');set.add(key);
      }
    }
  }
  return JSON.parse(raw);
}
function validBaseline(b) {
  return (exact(b,'pointerVersion,pointerEtag') || exact(b,'pointerVersion,pointerEtag,pngSha256'))
    && Number.isSafeInteger(b.pointerVersion) && b.pointerVersion>=0 && b.pointerVersion<Number.MAX_SAFE_INTEGER
    && typeof b.pointerEtag==='string' && /^[a-zA-Z0-9_-]{1,128}$/.test(b.pointerEtag)
    && (!Object.hasOwn(b,'pngSha256') || (typeof b.pngSha256==='string' && /^[a-f0-9]{64}$/.test(b.pngSha256)));
}
function verifyCapability(token, authority, session, now) {
  if(typeof authority!=='string' || authority.length<32 || typeof token!=='string' || token.length>2048)throw Error('INVALID_CAPABILITY');
  const parts=token.split('.');
  if(parts.length!==2 || !/^[A-Za-z0-9_-]+$/.test(parts[0]) || !/^[A-Za-z0-9_-]{43}$/.test(parts[1]))throw Error('INVALID_CAPABILITY');
  const expected=createHmac('sha256',authority).update(parts[0]).digest('base64url');
  if(!timingSafeEqual(Buffer.from(expected),Buffer.from(parts[1])))throw Error('INVALID_CAPABILITY');
  const p=JSON.parse(Buffer.from(parts[0],'base64url').toString('utf8'));
  if(!exact(p,'purpose,operationId,session,executorId,deploymentEndpoint,iat,exp') || p.purpose!==PINS.purpose
    || p.deploymentEndpoint!==PINS.deploymentEndpoint || p.executorId!==PINS.executorId || typeof p.operationId!=='string' || !UUID.test(p.operationId) || !/^[a-f0-9]{64}$/.test(p.session)
    || p.session!==session || !Number.isSafeInteger(p.iat) || !Number.isSafeInteger(p.exp)
    || p.iat>now || p.exp<=now || p.exp<=p.iat || p.exp-p.iat>300000)throw Error('INVALID_CAPABILITY');
  return p;
}
// Dependency injection is code-only. The deployed route always uses the frozen pins.
function createPreparationValidator({pngBytes=PINS.pngBytes,pngSha256=PINS.pngSha256}={}) {
  return input=>{
    if(!exact(input,'baseline,data,monthKey,pngDataUrl,pngSha256,targetPointerId')
      || typeof input.monthKey!=='string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(input.monthKey) || input.targetPointerId!=='jinan-website/current'
      || !validBaseline(input.baseline)
      || !exact(input.data,'title,note,clinics') || typeof input.data.title!=='string' || !input.data.title.trim() || input.data.title.length>100
      || /[\u0000-\u001f\u007f-\u009f]/.test(input.data.title) || typeof input.data.note!=='string'
      || input.data.note.length>10000 || !Array.isArray(input.data.clinics) || !input.data.clinics.length)throw Error('INVALID_REQUEST');
    const {png}=require('./publish-contract').parsePngDataUrl(input.pngDataUrl);
    const sha=createHash('sha256').update(png).digest('hex');
    if(png.length!==pngBytes || sha!==pngSha256 || sha!==input.pngSha256)throw Error('INVALID_PNG');
    return {baseline:input.baseline,data:input.data,monthKey:input.monthKey,
      targetPointerId:input.targetPointerId,pngBase64:png.toString('base64'),pngSha256:sha};
  };
}
// Approved code chooses the credential destination. Neither config nor HTTP input
// supplies a URL. ContentService may redirect its response, never the POST body.
function createValidationTransport({secret,fetchImpl=fetch}) {
  return {async request(payload) {
    const signal=AbortSignal.timeout(25000);
    let response=await fetchImpl(PINS.deploymentEndpoint,{method:'POST',redirect:'manual',
      credentials:'omit',referrerPolicy:'no-referrer',signal,
      headers:{'Content-Type':'text/plain;charset=UTF-8'},body:JSON.stringify({...payload,secret})});
    if(response.status===302 || response.status===303) {
      const location=response.headers.get('location');
      let next;
      try {next=new URL(location);}catch(_){throw Error('STORE_UNAVAILABLE');}
      if(next.protocol!=='https:' || next.hostname!=='script.googleusercontent.com'
        || next.port || next.username || next.password || next.hash || next.pathname!=='/macros/echo')throw Error('STORE_UNAVAILABLE');
      // Exactly one bounded response GET, with no body, cookie, secret or capability.
      response=await fetchImpl(next.href,{method:'GET',redirect:'manual',credentials:'omit',referrerPolicy:'no-referrer',signal});
    }
    if(!response.ok || (response.status>=300 && response.status<400))throw Error('STORE_UNAVAILABLE');
    const {readBounded}=require('./publish-http');
    const result=JSON.parse((await readBounded(response,MAX_BODY_BYTES)).toString('utf8'));
    if(!result || result.ok!==true)throw Error('STORE_UNAVAILABLE');
    return result;
  }};
}
function createValidationHandler({config=process.env,authenticate=hasValidSession,identity=operatorIdentity,
  now=Date.now,getAuthority=()=>process.env.PREPARE_VALIDATION_AUTHORITY_SECRET,
  getSecret=getServerSecret,request,validate=createPreparationValidator()}={}) {
  return async function(req,res) {
    const send=(code,body)=>{res.statusCode=code;res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/json');res.end(JSON.stringify(body));};
    if(config.PREPARE_VALIDATION_ENABLED!=='true' || !(['preview','development'].includes(config.VERCEL_ENV) || (config.VERCEL_ENV==='production' && config.PREPARE_VALIDATION_PRODUCTION_ENABLED==='true')))return send(403,{ok:false,error:'VALIDATION_DISABLED'});
    try {if(!authenticate(req))throw Error();}catch(_){return send(401,{ok:false,error:'AUTH_REQUIRED'});}
    if(req.method!=='POST')return send(405,{ok:false,error:'METHOD_NOT_ALLOWED'});
    let origin;
    try {origin=new URL(config.PREPARE_VALIDATION_ORIGIN);if(origin.protocol!=='https:' || origin.origin!==config.PREPARE_VALIDATION_ORIGIN || origin.username || origin.password)throw Error();}
    catch(_){return send(403,{ok:false,error:'VALIDATION_DISABLED'});}
    if(typeof req.headers['content-type']!=='string' || !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type'])
      || req.headers.origin!==origin.origin || req.headers.host!==origin.host || req.headers['x-validation-capability']!==undefined)return send(400,{ok:false,error:'INVALID_REQUEST'});
    let b, cap;
    try {
      if(Buffer.byteLength(typeof req.body==='string'?req.body:JSON.stringify(req.body||{}))>MAX_BODY_BYTES)return send(413,{ok:false,error:'BODY_TOO_LARGE'});
      const raw=typeof req.body==='string'?req.body:JSON.stringify(req.body);
      const length=req.headers['content-length'];
      if(length!==undefined && (typeof length!=='string' || !/^(0|[1-9][0-9]{0,7})$/.test(length) || Number(length)>MAX_BODY_BYTES || Number(length)!==Buffer.byteLength(raw)))throw Error();
      b=strictJson(raw);
      if(!exact(b,b?.op==='session'?'op':b?.op==='prepare'?'op,operationId,input':'op,operationId') || !['session','authorize','prepare','status','reconcile'].includes(b.op))throw Error();
    }catch(_){return send(400,{ok:false,error:'INVALID_REQUEST'});}
    if(b.op==='session') {
      let token=operatorToken(req);
      if(!token){token=randomBytes(32).toString('hex');res.setHeader('Set-Cookie',`${OPERATOR_COOKIE}=${token}; Path=/api/prepare-validation; HttpOnly; Secure; SameSite=Strict; Max-Age=28800`);}
      return send(200,{ok:true,status:'OPERATOR_SESSION',sessionSha256:createHash('sha256').update(token).digest('hex')});
    }
    let capability;
    try {
      cap=approvedScope(config,identity(req),b.operationId,now());
      const authority=getAuthority();
      if(typeof authority!=='string' || authority.length<32 || authority===getSecret())throw Error();
      const payload=Buffer.from(JSON.stringify(cap)).toString('base64url');
      capability=payload+'.'+createHmac('sha256',authority).update(payload).digest('base64url');
      verifyCapability(capability,authority,cap.session,now());
    }catch(_){return send(403,{ok:false,error:'INVALID_CAPABILITY'});}
    if(b.op==='authorize')return send(200,{ok:true,status:'AUTHORIZED',operationId:cap.operationId,authorizationExpiresAt:Number(config.PREPARE_VALIDATION_APPROVED_UNTIL)});
    let input;
    if(b.op==='prepare') {
      try {input=validate(b.input);}catch(e){return send(400,{ok:false,error:e.code==='INVALID_PNG'||e.message==='INVALID_PNG'?'INVALID_PNG':'INVALID_REQUEST'});}
    }
    try {
      const transport=request || createValidationTransport({secret:getSecret()}).request;
      const response=await transport({action:'prepareValidation',op:b.op,capability,...(input?{input}:{})});
      const r=response?.ok===true && response.result;
      if(r && ['SAVE_REQUIRED','STALE_BASELINE','INVALID_PNG','INVALID_APPROVAL','INVALID_REQUEST','TARGET_IDENTITY_UNKNOWN'].includes(r.status))return send(409,{ok:false,error:r.status,operationId:cap.operationId});
      if(!r || !['NOT_FOUND','PREPARED','EXPIRED_APPROVAL','MANUAL_CHECK_REQUIRED'].includes(r.status))throw Error();
      if(['PREPARED','EXPIRED_APPROVAL'].includes(r.status) && (typeof r.approvalId!=='string'
        || !/^validation:[a-zA-Z0-9-]{1,128}$/.test(r.approvalId) || typeof r.nonce!=='string'
        || !/^[a-zA-Z0-9-]{1,128}$/.test(r.nonce) || !Number.isSafeInteger(r.expiresAt) || r.expiresAt<=0 || r.expiresAt>now()+300000
        || typeof r.pngSha256!=='string' || !/^[a-f0-9]{64}$/.test(r.pngSha256)))throw Error();
      const out={ok:true,status:r.status,operationId:cap.operationId};
      if(['PREPARED','EXPIRED_APPROVAL'].includes(r.status)) {
        for(const k of ['approvalId','nonce','pngSha256','expiresAt'])out[k]=r[k];
      }
      return send(200,out);
    }catch(_){return send(409,{ok:false,error:'MANUAL_CHECK_REQUIRED',operationId:cap.operationId});}
  };
}
module.exports={createValidationTransport,OPERATOR_COOKIE,operatorIdentity,approvedScope,strictJson,PINS,verifyCapability,createValidationHandler,createPreparationValidator};
