#!/usr/bin/env node
'use strict';
// Explicit one-shot, read-only public verification. Never claims a Google job or opens CMS.
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const {executeJob}=require('./publish-runner.cjs');
(async()=>{
 try{
  const file=process.argv[2];if(!file)throw Error('JOB_FILE_REQUIRED');
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'jinan-dry-run-'));
  const result=await executeJob(JSON.parse(fs.readFileSync(file,'utf8')),{root,allowWrites:false});
  console.log(JSON.stringify({root,...result}));if(result.status!=='DRY_RUN_PASS')process.exitCode=1;
 }catch{console.log(JSON.stringify({status:'FAILED',code:'INVALID_JOB'}));process.exitCode=1;}
})();
