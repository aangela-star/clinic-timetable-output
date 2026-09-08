const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash, webcrypto } = require('node:crypto');
const fs = require('node:fs');
const vm = require('node:vm');
const core = require('../publish-core');
// Real PNG fixture assembled by the existing PNG contract test helpers.
const fixtureSource = fs.readFileSync(require.resolve('./publish_contract.test.cjs'), 'utf8').split("test('")[0];
const fixture = { require, Buffer };
vm.runInNewContext(fixtureSource + '; globalThis.png = validPngBuffer();', fixture);
const pngDataUrl = 'data:image/png;base64,' + fixture.png.toString('base64');
const input = () => ({ channelIds: ['jinan-website'], primaryClinicId: 'clinic-1', title: '115/九月', monthKey: '2026-09', pngDataUrl, humanConfirmed: true });

test('job IDs unique, immutable snapshot, source SHA and complete baseline', async () => {
  const source = input();
  const pending = core.createPublishJob(source, webcrypto);
  source.title = 'changed'; source.channelIds.push('other');
  const job = await pending;
  const other = await core.createPublishJob(input(), webcrypto);
  assert.notEqual(job.jobId, other.jobId);
  assert.equal(job.title, '115/九月');
  assert.equal(job.status, 'READY_FOR_BROWSER_EXECUTION');
  assert.equal(job.channelId, 'jinan-website');
  assert.equal(job.humanConfirmed, true);
  assert.equal(job.png.sha256, createHash('sha256').update(fixture.png).digest('hex'));
  assert.deepEqual(job.png.dimensions, { width: 2160, height: 3840 });
  assert.equal(job.png.dataUrl, pngDataUrl);
  assert.equal(job.baseline.pageUrl, 'https://www.tainanrehab.com/time.html');
  assert.equal(job.baseline.imagePath, '/upload/115-九月_醫師門診表 (1).png');
  assert.deepEqual(job.baseline.imageDimensions, { width: 675, height: 1200 });
  assert.equal(job.baseline.imageBytes, 294076);
  assert.equal(job.baseline.imageSha256, '503cbde3c21bd37f0562154df3fa4029d08e65ce0c1f90b59d7af4980d17dc65');
  assert.equal(job.baseline.requiresRevalidation, true);
  assert.ok(Object.isFrozen(job) && Object.isFrozen(job.png) && Object.isFrozen(job.baseline.imageDimensions));
  assert.deepEqual(JSON.parse(JSON.stringify(job)), job);
  assert.match(core.publishJobFilename(job), /^jinan-publish-2026-09-[0-9a-f-]{36}\.json$/);
});

test('reject wrong/multiple channels, clinic, missing confirmation and invalid PNG', async () => {
  for (const patch of [{channelIds: []}, {channelIds:['other']}, {channelIds:['jinan-website','other']}, {primaryClinicId:'clinic-2'}, {humanConfirmed:false}, {pngDataUrl:'data:image/png;base64,YQ=='}, {monthKey:'../../x'}]) {
    await assert.rejects(core.createPublishJob({...input(), ...patch}, webcrypto));
  }
});

test('actual confirm sends prepared approval through same-origin API, no JSON download', async () => {
  const html = fs.readFileSync(require.resolve('../index.html'), 'utf8');
  const handler = html.slice(html.indexOf('const handleConfirmPublish ='), html.indexOf('            useEffect(() => {', html.indexOf('const handleConfirmPublish =')));
  const statuses = [], calls = [];
  const data={title:'115/九月'};
  const context = {publishReadiness:{canConfirm:true},publishRequestInFlightRef:{current:false},isPublishing:false,
    setIsPublishing(){},setPreparedPublish(){},setPublishStatus:s=>statuses.push(s),data,
    publishSnapshotRef:{current:data},monthKey:'2026-09',primaryClinicId:'clinic-1',preparedPublish:{approvalId:'server-id',nonce:'server-nonce',monthKey:'2026-09',primaryClinicId:'clinic-1'},
    PublishCore:core,sessionStorage:{setItem(){},removeItem(){}},getPublishFailureStatusText:()=> 'SAFE_FAILURE',
    fetch:async(url,options)=>{calls.push([url,JSON.parse(options.body)]);return{json:async()=>({status:'PUBLISHED',mock:true})};}};
  vm.runInNewContext(handler+';globalThis.run=handleConfirmPublish;',context);
  await context.run();
  assert.equal(calls.length,1);assert.equal(calls[0][0],'/api/publish');assert.equal(calls[0][1].op,'confirm');
  assert.match(statuses.at(-1),/MOCK/);assert.doesNotMatch(handler,/downloadPublishJob/);
  context.fetch=async()=>{throw Error('private');};await context.run();assert.equal(statuses.at(-1),'SAFE_FAILURE');
  assert.equal(context.publishRequestInFlightRef.current,false);
});
test('actual preparation handler stages automatically, blocks unsaved facts, and does not confirm',async()=>{
 const html=fs.readFileSync(require.resolve('../index.html'),'utf8');
 const source=html.slice(html.indexOf('const handleOpenPublish ='),html.indexOf('            const togglePublishChannel ='));
 const data={title:'115/九月',note:'',clinics:[]};const calls=[],statuses=[],prepared=[];
 const context={data,monthKey:'2026-09',primaryClinicId:'clinic-1',publishGenerationRef:{current:0},publishSnapshotRef:{current:null},latestPublishEditorRef:{current:{data,monthKey:'2026-09',primaryClinicId:'clinic-1'}},
 setSelectedPublishChannelIds(){},setPreparedPublish:p=>prepared.push(p),setPublishStatus:s=>statuses.push(s),setIsPublishDialogOpen(){},sessionStorage:{getItem:()=>null},
 generatePublishPngDataUrl:async()=>pngDataUrl,PublishCore:{...core,createPublishJob:x=>core.createPublishJob(x,webcrypto)},getPublishFailureStatusText:()=> 'SAFE_FAILURE',
 fetch:async(url,options)=>{calls.push([url,options]);return{json:async()=>url.startsWith('/api/schedule')?{found:true,data}:url.includes('?')?{ok:true,mock:true,baseline:{pointerVersion:0,pointerEtag:'empty'}}:{ok:true,approvalId:'server',nonce:'nonce'}};}};
 vm.runInNewContext(source+';globalThis.run=handleOpenPublish;',context);await context.run();
 assert.equal(calls.length,3);assert.equal(JSON.parse(calls[2][1].body).op,'prepare');assert.equal(prepared.at(-1).approvalId,'server');assert.match(statuses.at(-1),/MOCK/);
 context.fetch=async()=>({json:async()=>({found:false})});await context.run();assert.equal(statuses.at(-1),'請先儲存本月門診');assert.equal(prepared.at(-1),null);
});
