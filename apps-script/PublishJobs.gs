// Disabled until explicitly approved and configured. Never touches SpreadsheetApp.
function publishJobTransition_(body, store, lock) {
  lock.acquire();
  try {
    if (body.action === 'publishJob.enqueue') {
      var id = body.job.jobId, prior = store.get(id);
      if (prior) {
        if (JSON.stringify(prior.job) !== JSON.stringify(body.job)) throw new Error('JOB_ID_CONFLICT');
        return {ok:true, jobId:id, status:prior.status};
      }
      store.put(id, {job:body.job, status:'ready'});
      return {ok:true, jobId:id, status:'ready'};
    }
    if (body.action === 'publishJob.claim') {
      var ids = store.ids();
      if (ids.some(function(id) { return store.get(id).status === 'claimed'; })) throw new Error('CLAIM_REQUIRES_RECONCILIATION');
      for (var i=0;i<ids.length;i++) {
        var record=store.get(ids[i]);
        if (record.status !== 'ready') continue;
        record.status='claimed'; record.claimId=body.claimId; record.claimedAt=new Date().toISOString();
        store.put(ids[i],record); // Persist before returning bytes. No claim expiry / automatic reclaim.
        return {ok:true, job:record.job, claimId:body.claimId};
      }
      return {ok:true, job:null};
    }
    if (body.action === 'publishJob.finish') {
      var record=store.get(body.jobId);
      if (!record || record.claimId !== body.claimId) throw new Error('CLAIM_MISMATCH');
      if (record.status !== 'claimed') {
        if (JSON.stringify(record.result) === JSON.stringify(body.result)) {store.put(body.jobId,record);return {ok:true,status:record.status};}
        throw new Error('TERMINAL_JOB');
      }
      record.result=body.result;
      record.status=body.result.status === 'PUBLISHED' ? 'published' : 'manual-check';
      store.put(body.jobId,record);
      return {ok:true,status:record.status};
    }
    throw new Error('INVALID_ACTION');
  } finally { lock.release(); }
}

function publishJobDriveStore_(folderId) {
  var root=DriveApp.getFolderById(folderId);
  if(root.getSharingAccess()!==DriveApp.Access.PRIVATE)throw new Error('HANDOFF_FOLDER_NOT_PRIVATE');
  function folder(id) {
    var it=root.getFoldersByName(id), found=it.hasNext()?it.next():null;
    if(it.hasNext()) throw new Error('DUPLICATE_JOB_FOLDER');
    return found;
  }
  function file(dir,name) {
    var it=dir.getFilesByName(name),found=it.hasNext()?it.next():null;
    if(it.hasNext()) throw new Error('DUPLICATE_JOB_FILE');
    return found;
  }
  return {
    ids:function() {var it=root.getFolders(),ids=[];while(it.hasNext()){ids.push(it.next().getName());if(ids.length>500)throw new Error('CAPACITY_REQUIRES_REVIEW');}return ids;},
    get:function(id) {
      var dir=folder(id);if(!dir)return null;
      var state=file(dir,'state.json'),job=file(dir,'job.json');
      if(!state||!job)throw new Error('INCOMPLETE_JOB');
      var record=JSON.parse(state.getBlob().getDataAsString());record.job=JSON.parse(job.getBlob().getDataAsString());return record;
    },
    put:function(id,record) {
      var dir=folder(id);
      if(!dir){dir=root.createFolder(id);dir.createFile('job.json',JSON.stringify(record.job),MimeType.PLAIN_TEXT);}
      var immutable=file(dir,'job.json');
      if(!immutable||immutable.getBlob().getDataAsString()!==JSON.stringify(record.job))throw new Error('JOB_ID_CONFLICT');
      var state={status:record.status};
      ['claimId','claimedAt','result'].forEach(function(k){if(record[k]!==undefined)state[k]=record[k];});
      var existing=file(dir,'state.json');
      if(existing)existing.setContent(JSON.stringify(state));else dir.createFile('state.json',JSON.stringify(state),MimeType.PLAIN_TEXT);
      // Result is inside durable state; companion is repairable if this last write fails.
      if(record.result){var result=file(dir,'result.json');if(result)result.setContent(JSON.stringify(record.result));else dir.createFile('result.json',JSON.stringify(record.result),MimeType.PLAIN_TEXT);}
    }
  };
}

function handlePublishJob_(body) {
  try {
    var props=PropertiesService.getScriptProperties();
    if(props.getProperty('PUBLISH_HANDOFF_ENABLED')!=='true')throw new Error('HANDOFF_DISABLED');
    var enqueue=body.action==='publishJob.enqueue';
    var secret=props.getProperty(enqueue?'CLINIC_SERVER_SECRET':'PUBLISH_RUNNER_SECRET');
    if(!secret||secret.length<32||body.secret!==secret)throw new Error('UNAUTHORIZED');
    var uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    if(enqueue) {
      // Vercel performs full PNG/schema validation. Apps Script rejects malformed forwarding.
      var j=body.job;
      if(!j||!uuid.test(j.jobId)||j.schemaVersion!==1||j.channelId!=='jinan-website'||j.primaryClinicId!=='clinic-1'||j.humanConfirmed!==true||j.status!=='READY_FOR_BROWSER_EXECUTION')throw new Error('INVALID_JOB');
      if(Object.keys(j).sort().join()!==['schemaVersion','jobId','createdAt','status','channelId','primaryClinicId','title','monthKey','humanConfirmed','png','baseline'].sort().join())throw new Error('INVALID_JOB');
      if(!j.png||Object.keys(j.png).sort().join()!==['dataUrl','sha256','dimensions','bytes'].sort().join())throw new Error('INVALID_JOB');
      if(JSON.stringify(j).length>3500000)throw new Error('JOB_TOO_LARGE');
      if(!j.baseline||Object.keys(j.baseline).sort().join()!==['pageUrl','imagePath','imageDimensions','imageBytes','imageSha256','verifiedAt','requiresRevalidation'].sort().join())throw new Error('INVALID_JOB');
      [j.png.dimensions,j.baseline.imageDimensions].forEach(function(d){if(!d||Object.keys(d).sort().join()!=='height,width')throw new Error('INVALID_JOB');});
      var raw=Utilities.base64Decode(String(j.png.dataUrl).replace(/^data:image\/png;base64,/,''));
      var digest=Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,raw).map(function(b){return ('0'+((b+256)%256).toString(16)).slice(-2);}).join('');
      if(raw.length!==j.png.bytes||digest!==j.png.sha256)throw new Error('INVALID_JOB');
    } else {
      if(!uuid.test(body.claimId))throw new Error('INVALID_CLAIM');
      if(body.action==='publishJob.finish') {
        var r=body.result;
        if(!uuid.test(body.jobId)||!r||r.jobId!==body.jobId||!['PUBLISHED','FAILED','MANUAL_CHECK_REQUIRED'].includes(r.status))throw new Error('INVALID_RESULT');
        var allowed=['jobId','finishedAt','status','code','publicImagePath','dimensions','bytes','sha256','pageUnchanged'];
        if(Object.keys(r).some(function(k){return allowed.indexOf(k)<0;})||JSON.stringify(r).length>2000)throw new Error('INVALID_RESULT');
        if(r.code&&!['INVALID_JOB','BASELINE_DRIFT','SESSION_EXPIRED','UPLOAD_FAILED','DERIVED_IMAGE_MISMATCH','SUBMIT_AMBIGUOUS','PUBLIC_VERIFY_FAILED','BROWSER_RUNTIME_UNAVAILABLE','REPLAY_BLOCKED'].includes(r.code))throw new Error('INVALID_RESULT');
        if(!Number.isFinite(Date.parse(r.finishedAt)))throw new Error('INVALID_RESULT');
        if(r.status==='PUBLISHED'&&(!/^\/upload\/[^/\\?#]+\.png$/.test(r.publicImagePath)||r.pageUnchanged!==true||!r.dimensions||r.dimensions.width!==675||r.dimensions.height!==1200||!/^[a-f0-9]{64}$/.test(r.sha256)||!Number.isSafeInteger(r.bytes)||r.bytes<=0))throw new Error('INVALID_RESULT');
        if(r.dimensions&&Object.keys(r.dimensions).sort().join()!=='height,width')throw new Error('INVALID_RESULT');
      }
    }
    var folderId=props.getProperty('PUBLISH_HANDOFF_FOLDER_ID');if(!folderId)throw new Error('HANDOFF_NOT_CONFIGURED');
    var scriptLock=LockService.getScriptLock();
    return json_(publishJobTransition_(body,publishJobDriveStore_(folderId),{
      acquire:function(){if(!scriptLock.tryLock(10000))throw new Error('HANDOFF_BUSY');},
      release:function(){if(scriptLock.hasLock())scriptLock.releaseLock();}
    }));
  } catch(e) {return json_({ok:false,error:'HANDOFF_REQUIRES_CHECK'});}
}
