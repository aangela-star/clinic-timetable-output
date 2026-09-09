/* Isolated validation journal only. Caller holds ScriptLock throughout read/CAS,
 * durable intent + readback, Drive staging and final journal persistence.
 * An INTENT is permanently non-retryable: it may represent an orphan Drive blob. */
function validationOperation(io, op, input) {
  if (!['prepare','status','reconcile'].includes(op)) throw Error('INVALID_REQUEST');
  const manual = {status:'MANUAL_CHECK_REQUIRED'};
  function result(j) {
    if (!j || j.operationId !== input.operationId || j.purpose !== 'clinic-prepare-validation-v1'
      || !j.session || !j.executorId || !j.requestSha256 || typeof j.pngSha256 !== 'string' || !j.pngSha256) return manual;
    if (j.session !== input.session || j.executorId !== input.executorId) return {status:'INVALID_APPROVAL'};
    if (op === 'prepare' && j.requestSha256 !== input.requestSha256) return {status:'INVALID_APPROVAL'};
    if (j.status !== 'PREPARED' || typeof j.blobId !== 'string' || !j.blobId
      || typeof j.approvalId !== 'string' || !j.approvalId.startsWith('validation:')
      || typeof j.nonce !== 'string' || !j.nonce || !Number.isSafeInteger(j.expiresAt)) return manual;
    return {status:j.expiresAt <= io.now() ? 'EXPIRED_APPROVAL' : 'PREPARED',
      approvalId:j.approvalId, nonce:j.nonce, expiresAt:j.expiresAt, pngSha256:j.pngSha256};
  }
  try {
    const old = io.read(input.operationId);
    if (old) return result(old);
    if (op !== 'prepare') return {status:'NOT_FOUND'};
    const job = {purpose:'clinic-prepare-validation-v1', operationId:input.operationId,
      session:input.session, executorId:input.executorId, requestSha256:input.requestSha256,
      pngSha256:input.pngSha256, approvalId:'validation:'+io.random(), nonce:io.random(),
      expiresAt:io.now()+300000, status:'INTENT'};
    io.save(job);
    // Read after flush must prove the exact intent before any Drive creation.
    if (JSON.stringify(io.read(input.operationId)) !== JSON.stringify(job)) return manual;
    job.blobId = io.stage(input.pngBase64, input.operationId);
    io.verify(job.blobId);
    job.status = 'PREPARED';
    io.save(job);
    if (JSON.stringify(io.read(input.operationId)) !== JSON.stringify(job)) return manual;
    return result(job);
  } catch (_) {
    return manual;
  }
}
if (typeof module !== 'undefined') module.exports = {validationOperation};

function validationPins_() {
  return {
    project:'1n8b6OLv_LyOONJeLGCbCDUnudpUGgM7PsbSUVvpUqm8l1j_m4rTJNETB',
    deployment:'AKfycbz5OXGNDZJWEj2-W1g-1r_SISPjYYcI-7gsUsivt3Rx7-zY6AzpQqqZTIFROVKMU1eh3w',
    deploymentEndpoint:'https://script.google.com/macros/s/AKfycbz5OXGNDZJWEj2-W1g-1r_SISPjYYcI-7gsUsivt3Rx7-zY6AzpQqqZTIFROVKMU1eh3w/exec',
    ledger:'1mphbqFGjstnF_SOrBVG242d4MH2aN274QGtGyjdN9Gg',
    folder:'1mbllfD0z51GgTDsVaKypendQVy_6lG9r',
    schedule:'1wugjTcB9R2x_KlnJESZF6h0z1KNT3NcE5zkFDLrqSzg',
    pngSha256:'f78a1ed1cb91a89cea9962efd5de76ae0d07702c801ce391664640cec402725d',
    pngBytes:781588, width:2160, height:3840,
    purpose:'clinic-prepare-validation-v1', executorId:'vercel-isolated-prepare-validation-v1'
  };
}
function validationExact_(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join(',') === keys.split(',').sort().join(',');
}
function validationDigest_(bytes) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,bytes)
    .map(b=>('0'+((b+256)%256).toString(16)).slice(-2)).join('');
}
function validationCanonical_(value) {
  if (Array.isArray(value)) return value.map(validationCanonical_);
  if (value && typeof value === 'object') {
    // Preserve every JSON key (including __proto__) as data in facts and digests.
    const out = Object.create(null);
    Object.keys(value).sort().forEach(k=>{out[k]=validationCanonical_(value[k]);});
    return out;
  }
  return value;
}
function validationCapability_(token, props) {
  const key=props.getProperty('PREPARE_VALIDATION_AUTHORITY_SECRET'), pins=validationPins_();
  if (typeof key!=='string' || key.length<32 || key===props.getProperty('CLINIC_SERVER_SECRET')
    || typeof token!=='string' || token.length>2048) throw Error('INVALID_CAPABILITY');
  const parts=token.split('.');
  if (parts.length!==2 || !/^[A-Za-z0-9_-]+$/.test(parts[0]) || !/^[A-Za-z0-9_-]{43}$/.test(parts[1])) throw Error('INVALID_CAPABILITY');
  const expected=Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(parts[0],key)).replace(/=+$/,'');
  let diff=expected.length^parts[1].length;
  for(let i=0;i<expected.length;i++)diff|=expected.charCodeAt(i)^parts[1].charCodeAt(i);
  if(diff!==0)throw Error('INVALID_CAPABILITY');
  const p=JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString());
  const now=Date.now();
  if(!validationExact_(p,'purpose,operationId,session,executorId,deploymentEndpoint,iat,exp') || p.deploymentEndpoint!==pins.deploymentEndpoint || p.purpose!==pins.purpose || p.executorId!==pins.executorId
    || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(p.operationId)
    || !/^[a-f0-9]{64}$/.test(p.session) || !Number.isSafeInteger(p.iat) || !Number.isSafeInteger(p.exp)
    || p.iat>now || p.exp<=now || p.exp<=p.iat || p.exp-p.iat>300000)throw Error('INVALID_CAPABILITY');
  const start=props.getProperty('PREPARE_VALIDATION_APPROVED_AT'), end=props.getProperty('PREPARE_VALIDATION_APPROVED_UNTIL');
  if(props.getProperty('PREPARE_VALIDATION_ENABLED')!=='true' || props.getProperty('PREPARE_VALIDATION_ISSUANCE_ENABLED')!=='true'
    || props.getProperty('PREPARE_VALIDATION_APPROVED_SESSION_SHA256')!==p.session
    || props.getProperty('PREPARE_VALIDATION_APPROVED_OPERATION_ID')!==p.operationId
    || typeof start!=='string' || !/^[0-9]{13}$/.test(start) || typeof end!=='string' || !/^[0-9]{13}$/.test(end)
    || Number(start)>now || Number(end)<=now || Number(end)<=Number(start) || Number(end)-Number(start)>28800000
    || p.iat<Number(start) || p.exp>Number(end))throw Error('INVALID_CAPABILITY');
  return p;
}
function validationPng_(bytes, hash, pin) {
  // Optional pin is a code-only synthetic test dependency, never request/property data.
  pin=pin||validationPins_();
  const b=bytes.map(x=>(x+256)%256);
  const u32=i=>b[i]*16777216+b[i+1]*65536+b[i+2]*256+b[i+3];
  if(b.length!==pin.pngBytes || hash!==pin.pngSha256 || validationDigest_(bytes)!==pin.pngSha256
    || b.slice(0,8).join(',')!=='137,80,78,71,13,10,26,10' || u32(8)!==13
    || b.slice(12,16).join(',')!=='73,72,68,82' || u32(16)!==2160 || u32(20)!==3840)throw Error('INVALID_PNG');
}
function prepareValidationRequest_(body, raw) {
  try {
    if(typeof raw!=='string' || raw.length>3500000)throw Error();
    body=validationStrictJson_(raw);
  } catch (_) {return json_({ok:false,error:'INVALID_REQUEST'});}
  return validationRequest_(body, validationPng_);
}
// Not an HTTP entry point. Only the fixed wrapper above is called by doPost.
function validationRequest_(body, verifyPng) {
  let lock;
  const reply=status=>json_({ok:true,result:{status}});
  try {
    const props=PropertiesService.getScriptProperties(), pins=validationPins_();
    if(props.getProperty('PREPARE_VALIDATION_ENABLED')!=='true')return json_({ok:false,error:'VALIDATION_DISABLED'});
    assertServerSecret_(body.secret);
    if(!['prepare','status','reconcile'].includes(body.op)
      || !validationExact_(body,body.op==='prepare'?'action,secret,op,capability,input':'action,secret,op,capability')
      || body.action!=='prepareValidation')return json_({ok:false,error:'INVALID_REQUEST'});
    let cap;
    try {cap=validationCapability_(body.capability,props);}
    catch(_){return json_({ok:false,error:'INVALID_CAPABILITY'});}
    // Compare actual local configuration AND runtime identity before any write.
    // No caller-selected target, fallback workbook, URL, or folder is accepted.
    if(props.getProperty('PUBLISH_SPREADSHEET_ID')!==pins.ledger
      || props.getProperty('PUBLISH_FOLDER_ID')!==pins.folder
      || props.getProperty('PREPARE_VALIDATION_DEPLOYMENT_ID')!==pins.deployment
      || ScriptApp.getScriptId()!==pins.project)throw Error('TARGET_MISMATCH');
    // The signed endpoint binds approved server intent; it is not runtime invocation
    // attestation. Trust approved Vercel code's fixed destination and secret custody.
    // ScriptApp.getService().getUrl() is not authoritative and is deliberately unused.
    lock=LockService.getScriptLock();
    if(!lock.tryLock(10000)){lock=null;return reply('MANUAL_CHECK_REQUIRED');}
    const book=SpreadsheetApp.openById(pins.ledger);
    if(book.getId()!==pins.ledger || book.getId()===pins.schedule)throw Error('TARGET_MISMATCH');
    const journal=book.getSheetByName('PrepareValidationJournal');
    // Missing/partial schema is never repaired by validation, including prepare.
    if(!journal)return reply('MANUAL_CHECK_REQUIRED');
    function readRows() {
      const rows=journal.getDataRange().getValues();
      if(!rows.length || rows[0][0]!=='operation_id' || rows[0][1]!=='validation_json')throw Error('INVALID_JOURNAL');
      return rows;
    }
    function locate(id) {
      const rows=readRows(),found=[];
      for(let i=1;i<rows.length;i++) {
        if(Boolean(rows[i][0])!==Boolean(rows[i][1]))throw Error('INVALID_JOURNAL');
        if(rows[i][0]===id)found.push(i);
      }
      if(found.length>1)throw Error('INVALID_JOURNAL');
      return {rows,index:found.length?found[0]:-1};
    }
    function read(id) {
      const found=locate(id);
      if(found.index<0)return null;
      const j=JSON.parse(found.rows[found.index][1]);
      if(!j || j.operationId!==id)throw Error('INVALID_JOURNAL');
      return j;
    }
    const binding={operationId:cap.operationId,session:cap.session,executorId:cap.executorId};
    const io={read,now:()=>Date.now(),random:()=>Utilities.getUuid()};
    // Readonly branch cannot reach schedule initialization, Drive or any save function.
    if(body.op!=='prepare')return json_({ok:true,result:validationOperation(io,body.op,binding)});
    const input=body.input;
    if(!validationExact_(input,'baseline,data,monthKey,pngBase64,pngSha256,targetPointerId')
      || input.targetPointerId!=='jinan-website/current' || !validationBaseline_(input.baseline)
      || !validationExact_(input.data,'title,note,clinics') || typeof input.data.note!=='string' || input.data.note.length>10000)return reply('INVALID_REQUEST');
    validateMonthKey_(input.monthKey);
    validateScheduleData_(input.data);
    assertMonthTitleMatch_(input.monthKey,input.data.title);
    if(!input.data.title.trim() || input.data.title.length>100 || /[\u0000-\u001f\u007f-\u009f]/.test(input.data.title))return reply('INVALID_REQUEST');
    const base64=input.pngBase64;
    if(typeof base64!=='string' || base64.length>Math.ceil(2500000/3)*4
      || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64))return reply('INVALID_PNG');
    const bytes=Utilities.base64Decode(base64);
    try{verifyPng(bytes,input.pngSha256);}catch(_){return reply('INVALID_PNG');}
    const requestSha256=validationDigest_(JSON.stringify(validationCanonical_({baseline:input.baseline,
      monthKey:input.monthKey,data:input.data,targetPointerId:input.targetPointerId,pngSha256:input.pngSha256})));
    Object.assign(binding,{requestSha256,pngBase64:base64,pngSha256:input.pngSha256});
    // Existing operation reconciles before checking a baseline/schedule that may have changed.
    if(read(cap.operationId))return json_({ok:true,result:validationOperation(io,'prepare',binding)});
    const pointers=book.getSheetByName('PublishPointer');
    if(!pointers)return reply('MANUAL_CHECK_REQUIRED');
    const v=pointers.getRange(1,1).getValue();
    const pointer=v?JSON.parse(v):{pointerVersion:0,pointerEtag:'empty',targetPointerId:'jinan-website/current'};
    if(pointer.targetPointerId!=='jinan-website/current' || !Number.isSafeInteger(pointer.pointerVersion)
      || pointer.pointerVersion<0 || pointer.pointerVersion>=Number.MAX_SAFE_INTEGER || typeof pointer.pointerEtag!=='string' || !pointer.pointerEtag)throw Error('INVALID_BASELINE');
    if(!input.baseline || input.baseline.pointerVersion!==pointer.pointerVersion
      || input.baseline.pointerEtag!==pointer.pointerEtag || input.baseline.pngSha256!==pointer.pngSha256)return reply('STALE_BASELINE');
    // Formal workbook read only: never call getScheduleSheet_ / load (they can initialize).
    const formal=SpreadsheetApp.openById(pins.schedule);
    if(formal.getId()!==pins.schedule)throw Error('TARGET_MISMATCH');
    const sheet=formal.getSheetByName('Schedules');
    if(!sheet)return reply('SAVE_REQUIRED');
    const rows=sheet.getDataRange().getValues();
    if(!rows.length || rows[0].slice(0,4).join('|')!=='month_key|data_json|schema_version|updated_at')return reply('SAVE_REQUIRED');
    const matches=findMonthRows_(sheet,input.monthKey);
    if(!matches.length)return reply('SAVE_REQUIRED');
    const savedRow=rows[matches[matches.length-1]-1];
    if(Number(savedRow[2])!==1)return reply('SAVE_REQUIRED');
    const saved=JSON.parse(savedRow[1]);
    validateScheduleData_(saved);
    assertMonthTitleMatch_(input.monthKey,saved.title);
    const facts=x=>JSON.stringify(validationCanonical_({title:x.title,note:x.note,clinics:x.clinics}));
    if(facts(input.data)!==facts(saved))return reply('SAVE_REQUIRED');
    const folder=DriveApp.getFolderById(pins.folder);
    if(folder.getId()!==pins.folder)throw Error('TARGET_MISMATCH');
    io.save=j=>{
      validationCapability_(body.capability,props);
      const found=locate(j.operationId);
      journal.getRange(found.index<0?found.rows.length+1:found.index+1,1,1,2)
        .setValues([[j.operationId,JSON.stringify(j)]]);
      SpreadsheetApp.flush();
    };
    io.stage=()=>{
      validationCapability_(body.capability,props);
      return folder.createFile(Utilities.newBlob(bytes,'image/png','validation-'+cap.operationId+'.png')).getId();
    };
    io.verify=id=>verifyPng(DriveApp.getFileById(id).getBlob().getBytes(),input.pngSha256);
    return json_({ok:true,result:validationOperation(io,'prepare',binding)});
  } catch (_) {
    return reply('MANUAL_CHECK_REQUIRED');
  } finally {
    if(lock)lock.releaseLock();
  }
}

function validationStrictJson_(raw) {
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

function validationBaseline_(b) {
  return (validationExact_(b,'pointerVersion,pointerEtag') || validationExact_(b,'pointerVersion,pointerEtag,pngSha256'))
    && Number.isSafeInteger(b.pointerVersion) && b.pointerVersion>=0 && b.pointerVersion<Number.MAX_SAFE_INTEGER
    && typeof b.pointerEtag==='string' && /^[a-zA-Z0-9_-]{1,128}$/.test(b.pointerEtag)
    && (!Object.prototype.hasOwnProperty.call(b,'pngSha256') || (typeof b.pngSha256==='string' && /^[a-f0-9]{64}$/.test(b.pngSha256)));
}
