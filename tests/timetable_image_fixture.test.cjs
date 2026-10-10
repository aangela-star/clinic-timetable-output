const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {candidate,imageUrl}=require('../docs/timetable-image-delivery-20261003/fixture/candidate.cjs');
const before=fs.readFileSync('docs/timetable-image-delivery-20261003/fixture/before.html','utf8');
test('offline exact two-image group becomes one responsive combined poster; surrounding bytes unchanged',()=>{
 const after=candidate(before),group=/<div id="timetable-images">[\s\S]*?<\/div>/;
 assert.equal(after.replace(group,''),before.replace(group,''));
 assert.equal((after.match(/<img /g)||[]).length,1);assert.ok(after.includes(imageUrl));
 assert.ok(after.includes('width="2160" height="3840"'));assert.ok(after.includes('height:auto'));
 assert.equal((after.match(/１１５年10月醫師門診表/g)||[]).length,3);
 assert.equal(candidate(before,{neutralText:true}),after.replaceAll('１１５年10月醫師門診表','醫師門診表'));
});
for(const [name,html] of [
 ['month',before.replaceAll('10月','11月')],['slot',before.replace('未命名(1).png','未命名.png')],
 ['order',before.replace('未命名(1).png','TEMP').replace('未命名1.png','未命名(1).png').replace('TEMP','未命名1.png')],
 ['duplicate',before.replace('</div>','<img src="/upload/未命名1.png"></div>')],['notice',before.replace('SYNTHETIC NOTICE','CHANGED')],
 ['already transformed',candidate(before)]
])test('offline fixture rejects drift: '+name,()=>assert.throws(()=>candidate(html),/FIXTURE_DRIFT/));
