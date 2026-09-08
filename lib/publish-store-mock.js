const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {publishStoreOperation} = require('./publish-store-engine');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
class LocalStore {
  constructor(root, faults = {}) { this.root=root; this.faults=faults; fs.mkdirSync(root,{recursive:true}); }
  read(name, fallback) { try { return JSON.parse(fs.readFileSync(path.join(this.root,name),'utf8')); } catch(e) { if(e.code==='ENOENT') return fallback; throw e; } }
  write(name, value) { const tmp=path.join(this.root,crypto.randomUUID()+'.tmp'); const fd=fs.openSync(tmp,'wx',0o600); try {fs.writeFileSync(fd,JSON.stringify(value));fs.fsyncSync(fd);} finally {fs.closeSync(fd);} fs.renameSync(tmp,path.join(this.root,name)); const dir=fs.openSync(this.root,'r'); try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);} }
  async call(op,input={}) {
    // Read-only recovery remains available even if a killed writer left its lock directory.
    // Atomic file renames make each read complete; inconsistent snapshots fail verification.
    if (op === 'pointer') return this.read('pointer.json',{pointerVersion:0,pointerEtag:'empty',targetPointerId:'jinan-website/current'});
    if (op === 'reconcile') {
      if(!/^[a-f0-9-]{36}$/.test(input.approvalId||'')) return {status:'INVALID_APPROVAL'};
      const job=this.read('job-'+input.approvalId+'.json',null);
      if(!job || job.session!==input.session || job.nonce!==input.nonce || job.executorId!==input.executorId) return {status:'INVALID_APPROVAL'};
      return {status:'RECONCILE',job,pointer:await this.call('pointer')};
    }
    const lock=path.join(this.root,'lock');
    for(let i=0;;i++) {try{fs.mkdirSync(lock);break;}catch(e){if(e.code!=='EEXIST'||i>200)throw Error('STORE_LOCKED'); await new Promise(r=>setTimeout(r,5));}}
    try {
      const id = value => {if(!/^[a-f0-9-]{36}$/.test(value||''))throw Error('INVALID_ID');return value;};
      const io={
        pointer:()=>this.read('pointer.json',{pointerVersion:0,pointerEtag:'empty',targetPointerId:'jinan-website/current'}),
        random:()=>crypto.randomUUID(), now:()=>Date.now(),
        job:a=>this.read('job-'+id(a)+'.json',null),
        saveJob:j=>this.write('job-'+id(j.approvalId)+'.json',j),
        stage:(base64,sha,month)=>{const bytes=Buffer.from(base64,'base64');if(hash(bytes)!==sha)throw Error('INVALID_PNG');const blobId=crypto.randomUUID();this.write('blob-'+blobId+'.json',{base64,sha,month});return blobId;},
        hashBlob:a=>hash(Buffer.from(this.read('blob-'+id(a)+'.json',{}).base64||'','base64')),
        savePointer:p=>{if(this.faults.beforePointer)throw Error('CRASH');this.write('pointer.json',p);if(this.faults.afterPointer)throw Error('CRASH');}
      };
      const result=publishStoreOperation(io,op,input);
      if(op==='confirm'&&this.faults.dropResponse)throw Error('DROPPED');
      return result;
    } finally {fs.rmdirSync(lock);}
  }
  async bytes(blobId) {if(this.faults.cache)return Buffer.from('stale'); if(!/^[a-f0-9-]{36}$/.test(blobId||''))throw Error('NOT_FOUND');return Buffer.from(this.read('blob-'+blobId+'.json',{}).base64||'','base64');}
}
module.exports={LocalStore,hash};
