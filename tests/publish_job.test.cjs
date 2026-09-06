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

test('actual confirm handler downloads JSON without fetch and reports only not-published status', async () => {
  const html = fs.readFileSync(require.resolve('../index.html'), 'utf8');
  const handler = html.slice(html.indexOf('const handleConfirmPublish ='), html.indexOf('            useEffect(() => {', html.indexOf('const handleConfirmPublish =')));
  const statuses = [], downloads = [];
  const context = { publishReadiness:{canConfirm:true}, publishRequestInFlightRef:{current:false}, isPublishing:false,
    setIsPublishing(){}, setPublishStatus:s=>statuses.push(s), generatePublishPngDataUrl:async()=>pngDataUrl,
    selectedPublishChannelIds:['jinan-website'], primaryClinicId:'clinic-1', data:{title:'115/九月'}, monthKey:'2026-09',
    PublishCore:{...core, createPublishJob: x=>core.createPublishJob(x,webcrypto), downloadPublishJob:job=>downloads.push(job)},
    fetch(){throw Error('network forbidden');} };
  vm.runInNewContext(handler + ';globalThis.run = handleConfirmPublish;', context);
  await context.run();
  assert.equal(downloads.length,1);
  assert.equal(statuses.at(-1),'晉安官網發布工作包已建立，尚未發布。');
  assert.doesNotMatch(handler,/\/api\/publish|PUBLISHED/);
  context.generatePublishPngDataUrl=async()=>{throw Error('private error');};
  await context.run();
  assert.equal(downloads.length,1);
  assert.equal(statuses.at(-1),'工作包建立失敗，尚未發布；請重新確認後再試。');
  assert.equal(context.publishRequestInFlightRef.current,false);
});

test('browser download is one JSON snapshot with safe filename and object URL cleanup', async () => {
  const job = await core.createPublishJob(input(), webcrypto);
  let blob, link, clicked = 0, removed = 0, revoked;
  const sandbox = {module:{exports:{}}, Blob, setTimeout:fn=>fn(),
    URL:{createObjectURL:value=>{blob=value;return 'blob:job';},revokeObjectURL:value=>{revoked=value;}},
    document:{body:{appendChild:value=>{link=value;}},createElement:()=>({click(){clicked++;},remove(){removed++;}})}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../publish-core'), 'utf8'),sandbox);
  sandbox.module.exports.downloadPublishJob(job);
  assert.equal(clicked,1); assert.equal(removed,1); assert.equal(revoked,'blob:job');
  assert.equal(link.download,core.publishJobFilename(job));
  assert.equal(blob.type,'application/json');
  assert.deepEqual(JSON.parse(await blob.text()),job);
});
