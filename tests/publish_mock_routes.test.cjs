const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os');
const {Readable}=require('node:stream');
const {createHarness}=require('../tools/mock-publish-store-server');
test('socket-free real harness routes: empty GET, auth, methods, host and static allowlist',async t=>{
 const root=fs.mkdtempSync(os.tmpdir()+'/publish-routes-');t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const {server,store}=createHarness(root);const handler=server.listeners('request')[0];let cookie='';
 async function call(url,method='GET',body='',extra={}){
  const req=Readable.from(body?[Buffer.from(body)]:[]);Object.assign(req,{url,method,headers:{host:'127.0.0.1',cookie,'content-type':'application/json',...extra}});
  const res={statusCode:200,headers:{},setHeader(k,v){this.headers[k]=v;},end(b){this.body=b===undefined?'':String(b);}};
  await handler(req,res);return res;
 }
 assert.equal((await call('/api/publish?pointer=jinan-website')).statusCode,401);
 assert.equal((await call('/','GET','',{host:'evil.example'})).statusCode,403);
 assert.equal((await call('/api/auth')).statusCode,405);
 const login=await call('/api/auth','POST');cookie=login.headers['Set-Cookie'].split(';')[0];
 const baseline=await call('/api/publish?pointer=jinan-website');assert.equal(baseline.statusCode,200);assert.equal(JSON.parse(baseline.body).status,'BASELINE');
 assert.equal((await call('/api/publish','GET','  ')).statusCode,200);
 for(const route of ['/api/publish','/api/schedule']){
  const malformed=await call(route,'POST','{');assert.equal(malformed.statusCode,400);assert.deepEqual(JSON.parse(malformed.body),{ok:false,error:'INVALID_REQUEST'});
 }
 const data={title:'MOCK',clinics:[],note:''};
 assert.equal((await call('/api/schedule','POST',JSON.stringify({action:'save',month:'2026-09',data}))).statusCode,200);
 assert.deepEqual(JSON.parse((await call('/api/schedule?month=2026-09')).body).data,data);
 const prepared=await call('/api/publish','POST',JSON.stringify({op:'prepare',input:{}}));assert.equal(prepared.statusCode,409);
 for(const route of ['/api/auth','/api/schedule','/api/publish','/api/publish-image','/public/jinan','/'])assert.equal((await call(route,'DELETE')).statusCode,405);
 assert.equal((await call('/api/publish-image')).statusCode,404);
 assert.match((await call('/public/jinan')).body,/MOCK.*\/api\/publish-image/);
 assert.match((await call('/')).body,/data-environment="MOCK"/);
 assert.match((await call('/publish-core.js')).headers['Content-Type'],/javascript/);
 assert.match((await call('/auth-gate.js')).body,/verifyPassword/);
 for(const route of ['/private-data','/api/missing','/.publish-runs/pointer.json'])assert.equal((await call(route)).statusCode,404);
 assert.equal((await store.call('pointer')).pointerVersion,0);
});
