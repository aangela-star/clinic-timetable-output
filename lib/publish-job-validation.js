'use strict';
const {createHash}=require('node:crypto');
const {parsePngDataUrl}=require('./publish-contract');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const PAGE='https://www.tainanrehab.com/time.html';
const hash=b=>createHash('sha256').update(b).digest('hex');
function fail(){throw new Error('INVALID_JOB');}
function exact(o,keys){if(!o||Array.isArray(o)||Object.keys(o).sort().join()!==keys.sort().join())fail();}
function imagePath(s){return typeof s==='string'&&/^\/upload\/[^/\\?#\x00-\x1f]+\.png$/.test(s)&&!s.includes('..')&&!s.includes('%');}
function validateJob(job){
 exact(job,['schemaVersion','jobId','createdAt','status','channelId','primaryClinicId','title','monthKey','humanConfirmed','png','baseline']);
 if(job.schemaVersion!==1||!UUID.test(job.jobId)||!Number.isFinite(Date.parse(job.createdAt))||job.status!=='READY_FOR_BROWSER_EXECUTION'||job.channelId!=='jinan-website'||job.primaryClinicId!=='clinic-1'||job.humanConfirmed!==true||typeof job.title!=='string'||!job.title.trim()||job.title.length>100||!/^\d{4}-(0[1-9]|1[0-2])$/.test(job.monthKey))fail();
 exact(job.png,['dataUrl','sha256','dimensions','bytes']);exact(job.png.dimensions,['width','height']);
 if(job.png.dataUrl.length>3200000)fail();
 const {png,width,height}=parsePngDataUrl(job.png.dataUrl);
 if(job.png.sha256!==hash(png)||job.png.bytes!==png.length||job.png.dimensions.width!==width||job.png.dimensions.height!==height)fail();
 exact(job.baseline,['pageUrl','imagePath','imageDimensions','imageBytes','imageSha256','verifiedAt','requiresRevalidation']);
 const b=job.baseline;exact(b.imageDimensions,['width','height']);
 if(b.pageUrl!==PAGE||!imagePath(b.imagePath)||b.imageDimensions.width!==675||b.imageDimensions.height!==1200||!Number.isSafeInteger(b.imageBytes)||b.imageBytes<=0||!/^[a-f0-9]{64}$/.test(b.imageSha256)||!Number.isFinite(Date.parse(b.verifiedAt))||b.requiresRevalidation!==true)fail();
 return {job:JSON.parse(JSON.stringify(job)),png};
}
module.exports={validateJob,UUID,PAGE,hash,imagePath};
