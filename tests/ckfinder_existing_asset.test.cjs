const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const { createHash } = require('node:crypto');
const { TARGET_URL, NAME, buildCopyRequest, simulateOverwrite } = require('../lib/ckfinder-existing-asset');

function chunk(type, data = Buffer.alloc(0)) {
  const b = Buffer.alloc(data.length + 12); b.writeUInt32BE(data.length); b.write(type, 4); data.copy(b, 8);
  let crc = 0xffffffff;
  for (const n of b.subarray(4, -4)) { crc ^= n; for (let i=0;i<8;i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  b.writeUInt32BE((crc ^ 0xffffffff) >>> 0, b.length - 4); return b;
}
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(2160); ihdr.writeUInt32BE(3840,4); ihdr[8]=8; ihdr[9]=6;
const png = Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',ihdr),chunk('IDAT',zlib.deflateSync(Buffer.alloc((2160*4+1)*3840))),chunk('IEND')]);
const dataUrl = `data:image/png;base64,${png.toString('base64')}`;
const old = Buffer.from('synthetic-original-jpeg-bytes');
const digest = (b) => createHash('sha256').update(b).digest('hex');
function fixture(overrides = {}) {
  const reads=[],writes=[],backups=[];
  let targetReads=0;
  const opts = { mode:'mock', folder:'/stage-1/', pngDataUrl:dataUrl,
    anonymousRead: async (r) => {
      reads.push(r); const target=r.url===TARGET_URL;
      const bytes=target && ++targetReads<=2 ? old : png;
      return {status:200,url:r.url,contentType:bytes===old?'image/jpeg':'image/png',bytes};
    },
    copy:async(r)=>{writes.push(r);return {status:200,url:r.url,contentType:'text/xml',body:'<Connector resourceType="Images"><CopyFiles copied="1"/><Error number="0"/></Connector>'};},
    preserveBackup:async(b)=>{backups.push(b);return {sha256:digest(b.bytes),verified:true};},
    ...overrides };
  return {opts,reads,writes,backups};
}
test('exact CopyFiles overwrite contract preserves basename and root target; no QuickUpload',()=>{
 const r=buildCopyRequest('/stage-1/');const u=new URL(r.url),b=new URLSearchParams(r.body);
 assert.equal(u.searchParams.get('command'),'CopyFiles');assert.equal(u.searchParams.get('currentFolder'),'/');
 assert.equal(b.get('files[0][name]'),NAME);assert.equal(b.get('files[0][options]'),'overwrite');assert.equal(b.get('files[0][folder]'),'/stage-1/');
 assert.equal([...b].length,4);assert.equal(r.method,'POST');
 for(const f of ['/','/../','/a/b/','/%2e%2e/','https://evil/','/a?x/'])assert.throws(()=>buildCopyRequest(f));
});
test('no execution without explicit mock mode and all injected dependencies',async()=>{
 assert.equal((await simulateOverwrite()).status,'CONTRACT_ONLY');
 const f=fixture({mode:'production'});assert.equal((await simulateOverwrite(f.opts)).status,'CONTRACT_ONLY');assert.equal(f.reads.length,0);
});
test('backup before single overwrite, fixed URL, anonymous exact PNG readback',async()=>{
 const f=fixture();assert.deepEqual(await simulateOverwrite(f.opts),{status:'VERIFIED_MOCK',targetUrl:TARGET_URL});
 assert.equal(f.writes.length,1);assert.equal(f.backups.length,1);assert.deepEqual(f.backups[0].bytes,old);
 assert.equal(f.reads.every(r=>r.credentials==='omit'&&r.redirect==='error'&&!r.headers.cookie),true);
 assert.equal(f.reads.at(-1).url,TARGET_URL);assert.equal(f.reads.length,5);
});
for(const reason of ['bad-png','root-folder','backup-failed','staging-mismatch','target-drift','staging-drift'])test(`precondition ${reason} blocks all writes`,async()=>{
 const f=fixture();const read=f.opts.anonymousRead;let n=0;
 if(reason==='bad-png')f.opts.pngDataUrl='data:image/png;base64,eA==';
 if(reason==='root-folder')f.opts.folder='/';
 if(reason==='backup-failed')f.opts.preserveBackup=async()=>({verified:false});
 f.opts.anonymousRead=async(r)=>{const v=await read(r);n++;
  if((reason==='staging-mismatch'&&n===1)||(reason==='target-drift'&&n===3)||(reason==='staging-drift'&&n===4))v.bytes=Buffer.from('changed');return v;};
 assert.equal((await simulateOverwrite(f.opts)).status,'PRECONDITION_FAILED');assert.equal(f.writes.length,0);
});
for(const reason of ['timeout','error','partial','renamed','redirect','malformed','wrong-hash','jpeg-mime','read-error'])test(`post-dispatch ${reason} fails closed without retry`,async()=>{
 const f=fixture();const copy=f.opts.copy,read=f.opts.anonymousRead;let n=0;
 f.opts.copy=async(r)=>{const v=await copy(r);
  if(reason==='timeout')throw Error('secret text');
  if(reason==='error')v.body=v.body.replace('number="0"','number="103"');
  if(reason==='partial')v.body=v.body.replace('copied="1"','copied="0"');
  if(reason==='renamed')v.body=v.body.replace('copied="1"','copied="1" renamed="1"');
  if(reason==='redirect')v.location='/login';if(reason==='malformed')v.body='<html>login</html>';return v;};
 f.opts.anonymousRead=async(r)=>{const v=await read(r);n++;if(n===5){if(reason==='wrong-hash')v.bytes=Buffer.from('different');if(reason==='jpeg-mime')v.contentType='image/jpeg';if(reason==='read-error')throw Error('secret');}return v;};
 const result=await simulateOverwrite(f.opts);assert.equal(result.status,'MANUAL_CHECK_REQUIRED');assert.equal(f.writes.length,1);assert.equal(JSON.stringify(result).includes('secret'),false);
});
