'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const out=path.join(__dirname,'../docs/timetable-parser-fix-20261008');
const {contract:c,sha,proposeTwoOnly}=require(path.join(out,'realhtml-contract.cjs'));
const {targetFingerprint:f}=require('../lib/publish-target');
const raw=fs.readFileSync(path.join(out,'real-public.html'));
const proposal=fs.readFileSync(path.join(out,'proposal-two-preserve-third.NOT-APPROVABLE.html'));
const images=[...raw.toString('utf8').matchAll(/<img\b[^>]*>/g)].map(m=>m[0]);
const uploads=images.filter(s=>s.includes('/upload/'));
const drift=b=>assert.throws(()=>proposeTwoOnly(b),/^Error: REALHTML_BASELINE_DRIFT$/);
const mutate=(a,b)=>{assert.ok(raw.includes(Buffer.from(a)));return Buffer.from(raw.toString('utf8').replace(a,b));};
test('recovered real bytes and exact ordered raw tags pinned independently',()=>{
 assert.equal(raw.length,22098);assert.equal(sha(raw),'6eca7c113577973e4831a6dc224e8a09ec952fd51613a66d0f82f82d71c45001');
 assert.equal(uploads.length,3);assert.match(uploads[0],/晉安復健科診所10月/);assert.match(uploads[1],/毅安診所10月/);assert.equal(uploads[2],c.third.raw);
 assert.equal(c.start,15261);assert.equal(c.end,15435);
 assert.equal(sha(raw.subarray(c.start,c.end)),'0db0f748f9944522b40bce81c5970609cacc1caab7c7ccd6131014588c2cf583');
 assert.deepEqual(raw.subarray(c.start,c.end),fs.readFileSync(path.join(out,'selected-two.raw.html')));
 assert.equal(raw.subarray(c.start,c.end).toString().replace(uploads[0],'').replace(uploads[1],''),'<br />\r\n\t<br />\r\n\t<br />\r\n\t');
 for(const m of c.images){assert.equal(sha(raw.subarray(m.start,m.end)),m.sha256);assert.equal(raw.subarray(m.start,m.end).toString(),m.raw);}
});
test('two-only offline proposal preserves every outside byte and unresolved third',()=>{
 assert.deepEqual(proposeTwoOnly(raw),proposal);assert.equal(sha(proposal),c.proposalSha256);
 const n=Buffer.byteLength(c.replacement);
 assert.deepEqual(proposal.subarray(0,c.start),raw.subarray(0,c.start));
 assert.deepEqual(proposal.subarray(c.start+n),raw.subarray(c.end));
 assert.deepEqual(proposal.subarray(c.start+n,c.start+n+c.third.end-c.third.start),fs.readFileSync(path.join(out,'third-unresolved.raw.html')));
 const after=[...proposal.toString().matchAll(/<img\b[^>]*>/g)].map(m=>m[0]);
 assert.deepEqual(after,images.flatMap(s=>s===uploads[0]?[c.replacement]:s===uploads[1]?[]:[s]));
 assert.equal(after.filter(s=>s.includes(c.imageUrl)).length,1);
 assert.equal(c.third.role,'UNKNOWN');
});
for(const [name,a,b] of [
 ['clinic order',uploads[0],uploads[1]],['first image month','晉安復健科診所10月','晉安復健科診所11月'],
 ['second image month','毅安診所10月','毅安診所11月'],['heading month','１１５年10月','１１５年11月'],
 ['SEO title month','115年10月','115年11月'],['third entity spelling','&amp;#27589;','&#27589;'],
 ['missing third',uploads[2],''],['extra group image',uploads[1],uploads[1]+'<img src="/extra.jpg" />'],
 ['duplicate target group',uploads[0],uploads[0]+uploads[0]],['unrelated logo','img/logo.png','img/other.png'],
 ['intervening breaks',uploads[0]+'<br />',uploads[0]],['newline normalization','\r\n','\n'],
 ['unrelated appended image','</body>','<img src="/extra.jpg" /></body>']
])test('real contract fails closed: '+name,()=>drift(mutate(a,b)));
test('actual swap, full month drift, truncated body, and repeat apply fail closed',()=>{
 drift(Buffer.from(raw.toString().replace(uploads[0],'SWAP').replace(uploads[1],uploads[0]).replace('SWAP',uploads[1])));
 drift(Buffer.from(raw.toString().replaceAll('10月','11月')));drift(raw.subarray(0,-1));drift(proposal);
});
// Test-only URL; the variant substitutes exactly one src, never removes a tag.
const mockImage='https://mock.invalid/poster.png';
const firstSrc=uploads[0].match(/src="([^"]+)"/)[1];
const three=raw.toString().replace(firstSrc,mockImage);
const two=proposal.toString().replace(c.imageUrl,mockImage);
test('real full-page three-image compatibility, singleton and byte preservation',()=>{
 const before=Buffer.from(raw.toString().split(firstSrc)[0]);
 const after=Buffer.from(raw.toString().split(firstSrc)[1]);
 assert.deepEqual(Buffer.from(three),Buffer.concat([before,Buffer.from(mockImage),after]));
 const tags=[...three.matchAll(/<img\b[^>]*>/g)].map(m=>m[0]);
 assert.deepEqual(tags,images.map(s=>s===uploads[0]?s.replace(firstSrc,mockImage):s));
 assert.equal(tags.filter(s=>s.includes(mockImage)).length,1);
 assert.ok(tags.includes(uploads[1]));assert.ok(tags.includes(uploads[2]));
 const fingerprint=f(three,c.pageUrl,mockImage);
 assert.match(fingerprint,/^[a-f0-9]{64}$/);assert.equal(f(three,c.pageUrl,mockImage),fingerprint);
 assert.throws(()=>f(three.replace(uploads[1],uploads[1].replace(/src="[^"]+"/,'src="'+mockImage+'"')),c.pageUrl,mockImage),/PUBLIC_BASELINE_DRIFT/);
});
test('raw unwired fixture still rejects with the production image URL',()=>{
 assert.throws(()=>f(raw.toString(),c.pageUrl,c.imageUrl),/^Error: PUBLIC_BASELINE_DRIFT$/);
});
test('unapproved real proposals fail mock verification without an approved target hash',async()=>{
 const {createPublicVerifier}=require('../lib/publish-provider');
 for(const html of [three,two])for(const targetSha256 of [undefined,'0'.repeat(64)]){
  let calls=0;
  const verifier=createPublicVerifier({pageUrl:c.pageUrl,imageUrl:mockImage,targetSha256,
   pageSha256:sha(Buffer.from(html)), // Whole-page pin is not a production fallback.
   fetchImpl:async url=>{calls++;assert.equal(url,c.pageUrl);return new Response(html,{headers:{'content-type':'text/html'}});}});
  await assert.rejects(verifier.publicRead(),/PUBLIC_BASELINE_DRIFT/);assert.equal(calls,1);
 }
});
test('empirical fingerprints: target style differs, sibling breaks/month/order do not',()=>{
 const base=f(three,c.pageUrl,mockImage),other=f(two,c.pageUrl,mockImage);
 // Difference is the target style, not br position (br is a void sibling).
 assert.notEqual(base,other);
 const styled=three.replace('<img alt="" src="'+mockImage+'" />','<img alt="" src="'+mockImage+'" style="max-width:100%;height:auto;" />');
 assert.equal(f(styled,c.pageUrl,mockImage),other);
 const changedMonth=three.replaceAll('10月','11月');
 const swapped=three.replace(uploads[1],'SWAP').replace(uploads[2],uploads[1]).replace('SWAP',uploads[2]);
 const breaks=three.replace(uploads[0].replace(firstSrc,mockImage)+'<br />',uploads[0].replace(firstSrc,mockImage)+'<br /><br />');
 for(const html of [changedMonth,swapped,breaks]){assert.notEqual(html,three);assert.equal(f(html,c.pageUrl,mockImage),base);}
});
test('LOCAL legacy whole-page mock pin rejects image, month, and order drift',async()=>{
 const {createPublicVerifier}=require('../lib/publish-provider');
 const pageUrl='http://127.0.0.1:12345/time.html',imageUrl='http://127.0.0.1:12345/poster.png';
 const html=three.replace(mockImage,imageUrl),pageSha256=sha(Buffer.from(html));
 const check=content=>createPublicVerifier({pageUrl,imageUrl,pageSha256,
  fetchImpl:async url=>{assert.equal(url,pageUrl);return new Response(content,{headers:{'content-type':'text/html'}});}}).checkPage();
 await check(html);
 for(const drifted of [html.replace(uploads[1],uploads[1].replace('.jpg','-changed.jpg')),html.replaceAll('10月','11月'),html.replace(uploads[1],'SWAP').replace(uploads[2],uploads[1]).replace('SWAP',uploads[2])]){
  assert.notEqual(drifted,html);await assert.rejects(check(drifted),/PUBLIC_BASELINE_DRIFT/);
 }
});
