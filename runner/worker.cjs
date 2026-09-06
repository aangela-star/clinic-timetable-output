#!/usr/bin/env node
'use strict';
const path=require('node:path');
const {pickup}=require('./publish-runner.cjs');
const {createClient}=require('./google-client.cjs');
const browser=require('./browser-driver.cjs');
(async()=>{
 try{
  if(process.env.PUBLISH_RUNNER_ENABLED!=='true'||!browser.available){console.log(JSON.stringify({status:'NOT_ACTIVATED',code:browser.reason||'RUNNER_DISABLED'}));return;}
  const root=process.env.PUBLISH_RUNNER_STATE_DIR;
  if(!root||!path.isAbsolute(root))throw Error('RUNNER_NOT_CONFIGURED');
  const result=await pickup({root,client:createClient({secret:process.env.PUBLISH_RUNNER_SECRET}),driver:browser,allowWrites:true});
  console.log(JSON.stringify(result?{jobId:result.jobId,status:result.status}:{status:'IDLE'}));
 }catch{console.log(JSON.stringify({status:'MANUAL_CHECK_REQUIRED',code:'RUNNER_REQUIRES_CHECK'}));process.exitCode=1;}
})();
