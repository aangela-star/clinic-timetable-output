const test=require('node:test'),assert=require('node:assert/strict');
const {createAppsScriptTransport}=require('../lib/publish-store-adapter');
const url='https://script.google.com/macros/s/synthetic/exec';
const responseUrl='https://script.googleusercontent.com/macros/echo?user_content_key=synthetic';
for(const status of [302,303])test('publish response redirect '+status+' shares deadline and strips credentials',async()=>{
 const calls=[];
 const store=createAppsScriptTransport({enabled:true,url,secret:'synthetic-only',fetchImpl:async(u,o)=>{calls.push([u,o]);return calls.length===1?new Response(null,{status,headers:{location:responseUrl}}):Response.json({ok:true,result:{pointerVersion:0}});}});
 assert.equal((await store.call('confirm',{})).pointerVersion,0);
 assert.equal(calls.length,2);assert.equal(calls[0][1].method,'POST');assert.equal(calls[1][0],responseUrl);
 assert.equal(calls[1][1].signal,calls[0][1].signal);
 assert.deepEqual(Object.keys(calls[1][1]).sort(),['credentials','method','redirect','referrerPolicy','signal']);
 assert.equal(calls[1][1].method,'GET');assert.equal(calls[1][1].credentials,'omit');assert.equal(calls[1][1].redirect,'manual');
});
for(const [status,location] of [[301,responseUrl],[307,responseUrl],[308,responseUrl],...[null,'/macros/echo','http://script.googleusercontent.com/macros/echo','https://script.googleusercontent.com.evil.invalid/macros/echo','https://user:pass@script.googleusercontent.com/macros/echo','https://script.googleusercontent.com:444/macros/echo',responseUrl+'#x','https://script.googleusercontent.com/other',url].map(u=>[302,u])])test('publish refuses unsafe redirect '+status+' '+location,async()=>{
 let calls=0;const store=createAppsScriptTransport({enabled:true,url,secret:'synthetic',fetchImpl:async()=>{calls++;return new Response(null,{status,headers:location?{location}:{}});}});
 await assert.rejects(store.call('confirm',{}),/STORE_UNAVAILABLE/);assert.equal(calls,1);
});
for(const mode of ['chain','lost','timeout'])test('publish redirect '+mode+' never retries a write',async()=>{
 let posts=0,gets=0;
 const store=createAppsScriptTransport({enabled:true,url,secret:'synthetic',fetchImpl:async(_,o)=>{
  if(o.method==='POST'){posts++;return new Response(null,{status:302,headers:{location:responseUrl}});}
  gets++;if(mode==='chain')return new Response(null,{status:302,headers:{location:responseUrl}});
  throw mode==='timeout'?new DOMException('synthetic','TimeoutError'):Error('synthetic');
 }});
 await assert.rejects(store.call('confirm',{}));assert.equal(posts,1);assert.equal(gets,1);
});

test('redirect response fetch consumes the same overall 25s deadline',async()=>{
 const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),deadlines=[];
 const context={URL,module:{exports:{}},require:n=>n.startsWith('.')?require(path.resolve('lib',n)):require(n),Buffer,setTimeout,
  AbortSignal:{timeout:ms=>{deadlines.push(ms);return AbortSignal.timeout(20);}}};
 vm.runInNewContext(fs.readFileSync('lib/publish-store-adapter.js','utf8'),context);
 let posts=0,gets=0;
 const store=context.module.exports.createAppsScriptTransport({enabled:true,url,secret:'synthetic',fetchImpl:async(_,o)=>{
  if(o.method==='POST'){posts++;await new Promise(r=>setTimeout(r,5));return new Response(null,{status:303,headers:{location:responseUrl}});}
  gets++;return new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>resolve(Response.json({ok:true,result:{}})),100);
   const abort=()=>{clearTimeout(timer);reject(o.signal.reason);};
   if(o.signal.aborted)abort();else o.signal.addEventListener('abort',abort,{once:true});
  });
 }});
 await assert.rejects(store.call('confirm',{}),e=>e.name==='TimeoutError');assert.deepEqual(deadlines,[25000]);assert.equal(posts,1);assert.equal(gets,1);
});
