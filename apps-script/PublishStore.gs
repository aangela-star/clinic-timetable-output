/* Shared synchronous transaction engine. Caller MUST hold the durable store lock.
 * saveJob must flush before savePointer; pointer is one atomic record. */
function publishStoreOperation(io, op, input) {
  if (!['pointer','prepare','confirm','reconcile'].includes(op)) throw Error('INVALID_REQUEST');
  const pointer = io.pointer();
  if (pointer.targetPointerId !== 'jinan-website/current' || !Number.isSafeInteger(pointer.pointerVersion) || pointer.pointerVersion < 0 || pointer.pointerVersion >= Number.MAX_SAFE_INTEGER || typeof pointer.pointerEtag !== 'string' || !pointer.pointerEtag) throw Error('INVALID_BASELINE');
  if (op === 'pointer') return pointer;
  if (op === 'prepare') {
    if (input.targetPointerId !== 'jinan-website/current' || !input.session || !input.executorId) throw Error('INVALID_REQUEST');
    if (input.baseline.pointerVersion !== pointer.pointerVersion || input.baseline.pointerEtag !== pointer.pointerEtag || input.baseline.pngSha256 !== pointer.pngSha256) return {status:'STALE_BASELINE'};
    const approvalId = io.random();
    const job = Object.assign({}, input, {approvalId, nonce:io.random(), expiresAt:io.now()+300000, status:'PREPARED'});
    job.blobId = io.stage(input.pngBase64, input.pngSha256, input.monthKey);
    delete job.pngBase64;
    io.saveJob(job);
    return {status:'PREPARED', approvalId, nonce:job.nonce, pngSha256:job.pngSha256, baseline:job.baseline, targetPointerId:job.targetPointerId, executorId:job.executorId, confirmedBySession:job.session, expiresAt:job.expiresAt};
  }
  if (String(input.approvalId || '').startsWith('validation:')) return {status:'INVALID_APPROVAL'};
  const job = io.job(input.approvalId);
  if (job && job.purpose === 'clinic-prepare-validation-v1') return {status:'INVALID_APPROVAL'};
  if (!job || job.session !== input.session || job.nonce !== input.nonce || job.executorId !== input.executorId) return {status:'INVALID_APPROVAL'};
  if (op === 'reconcile' || job.status !== 'PREPARED') return {status:'RECONCILE', job, pointer};
  if (op !== 'confirm') throw Error('INVALID_REQUEST');
  if (job.expiresAt < io.now()) return {status:'EXPIRED_APPROVAL'};
  if (job.baseline.pointerVersion !== pointer.pointerVersion || job.baseline.pointerEtag !== pointer.pointerEtag || job.baseline.pngSha256 !== pointer.pngSha256) return {status:'STALE_BASELINE'};
  if (io.hashBlob(job.blobId) !== job.pngSha256) return {status:'INVALID_PNG'};
  // Durable intent BEFORE mutation. Any restart after this point reconciles only.
  job.status = 'MUTATING';
  io.saveJob(job);
  const next = {pointerVersion:pointer.pointerVersion+1, pointerEtag:io.random(), blobId:job.blobId, pngSha256:job.pngSha256, approvalId:job.approvalId, nonce:job.nonce, targetPointerId:job.targetPointerId};
  io.savePointer(next);
  job.status = 'CONSUMED';
  io.saveJob(job);
  return {status:'RECONCILE', job, pointer:next};
}
if (typeof module !== 'undefined') module.exports = {publishStoreOperation};

// Inert until separately approved Script Properties / Drive scope / deployment changes.
function publishRequest_(body) {
  if (PropertiesService.getScriptProperties().getProperty('PUBLISH_STORE_ENABLED') !== 'true') return json_({ok:false,error:'CMS_RESPONSE_CONTRACT_UNVERIFIED'});
  const lock=LockService.getScriptLock();
  if(!lock.tryLock(10000))return json_({ok:false,error:'STORE_LOCKED'});
  try {
    const configuredId=PropertiesService.getScriptProperties().getProperty('PUBLISH_SPREADSHEET_ID');
    if(typeof configuredId!=='string'||!configuredId.trim())throw Error('STORE_UNAVAILABLE');
    const ledgerId=configuredId.trim();
    const active=SpreadsheetApp.getActiveSpreadsheet();
    const activeId=active&&active.getId();
    if(typeof activeId!=='string'||!activeId.trim()||activeId.trim()===ledgerId)throw Error('STORE_UNAVAILABLE');
    const book=SpreadsheetApp.openById(ledgerId);
    const openedId=book&&book.getId();
    if(typeof openedId!=='string'||!openedId.trim()||openedId!==ledgerId)throw Error('STORE_UNAVAILABLE');
    // Public reads must never initialize ledger resources. Missing pointer means
    // an empty baseline; missing journal means no blob is available.
    const readOnly=body.op==='pointer'||body.op==='blob';
    function sheet(name) {return book.getSheetByName(name)||(readOnly?null:book.insertSheet(name));}
    const pointers=sheet('PublishPointer'), jobs=sheet('ConsumedNonces');
    function readPointer(){const v=pointers?pointers.getRange(1,1).getValue():null;return v?JSON.parse(v):{pointerVersion:0,pointerEtag:'empty',targetPointerId:'jinan-website/current'};}
    function jobRow(id){const rows=jobs.getDataRange().getValues();for(let i=0;i<rows.length;i++)if(rows[i][0]===id)return i+1;return 0;}
    function digest(bytes){return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,bytes).map(b=>('0'+((b+256)%256).toString(16)).slice(-2)).join('');}
    function blob(id){return DriveApp.getFileById(id).getBlob().getBytes();}
    const io={pointer:readPointer,random:()=>Utilities.getUuid(),now:()=>Date.now(),
      job:id=>{const row=jobRow(id);return row?JSON.parse(jobs.getRange(row,2).getValue()):null;},
      saveJob:j=>{jobs.getRange(jobRow(j.approvalId)||jobs.getLastRow()+1,1,1,2).setValues([[j.approvalId,JSON.stringify(j)]]);SpreadsheetApp.flush();},
      stage:(base64,sha,month)=>{const bytes=Utilities.base64Decode(base64);if(bytes.length>2500000||digest(bytes)!==sha)throw Error('INVALID_PNG');
        const folder=DriveApp.getFolderById(PropertiesService.getScriptProperties().getProperty('PUBLISH_FOLDER_ID'));
        const f=folder.createFile(Utilities.newBlob(bytes,'image/png','jinan-'+month+'-'+Utilities.getUuid()+'.png'));
        if(digest(blob(f.getId()))!==sha)throw Error('INVALID_PNG');return f.getId();},
      hashBlob:id=>digest(blob(id)),
      savePointer:p=>{pointers.getRange(1,1).setValue(JSON.stringify(p));SpreadsheetApp.flush();}
    };
    if(body.op==='blob') {
      if(!jobs)throw Error('NOT_FOUND');
      // Only known journal blobs can be served; never arbitrary Drive files.
      const rows=jobs.getDataRange().getValues();
      if(!rows.some(r=>r[1]&&JSON.parse(r[1]).blobId===body.input.blobId))throw Error('NOT_FOUND');
      return json_({ok:true,result:{base64:Utilities.base64Encode(blob(body.input.blobId))}});
    }
    return json_({ok:true,result:publishStoreOperation(io,body.op,body.input||{})});
  }catch(_){return json_({ok:false,error:'STORE_UNAVAILABLE'});}
  finally{lock.releaseLock();}
}
