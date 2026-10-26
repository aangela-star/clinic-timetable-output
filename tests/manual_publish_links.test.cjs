const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
async function render(props = {clinicName:'毅安測試診所', monthKey:'2099-01', posterTitle:'2099/01 測試專用'}) {
  globalThis.React = {createElement:(tag,props,...children)=>({tag,props:props||{},children:children.flat(Infinity)})};
  try { return (await import('../manual-publish.mjs')).default(props); } finally {delete globalThis.React;}
}
const nodes = n => n && typeof n === 'object' ? [n,...n.children.flatMap(nodes)] : [];
const text = n => n && typeof n === 'object' ? n.children.map(text).join('') : String(n??'');
test('five cards expose only known destinations with no success controls', async()=>{
 const all=nodes(await render()),cards=all.filter(n=>n.tag==='article');
 assert.deepEqual(cards.map(n=>n.props['aria-labelledby']),['jinan-web-title','yian-web-title','jinan-fb-title','yian-fb-title','farbar-title']);
 assert.equal(all.filter(n=>n.tag==='button').length,0);
 assert.equal(cards.filter(c=>c.children.some(n=>n && n.tag==='a')).length,5);
 assert.equal(all.filter(n=>n.tag==='input').length,0);
 for(const a of all.filter(n=>n.tag==='a')){assert.equal(a.props.target,'_blank');assert.equal(a.props.rel,'noopener noreferrer');assert.equal(a.props.onClick,undefined);}
 for(const c of cards){assert.equal(nodes(c).filter(n=>n.tag==='details').length,1);assert.equal(nodes(c).find(n=>n.tag==='details').props.open,undefined);assert.ok(nodes(c).some(n=>n.props['data-entry-status']));}
});
test('FarBar exact navigation target is distinct from unverified upload/save and has no public URL',async()=>{
 const c=nodes(await render()).find(n=>n.props['aria-labelledby']==='farbar-title');assert.ok(c);
 const links=nodes(c).filter(n=>n.tag==='a');assert.equal(links.length,1);
 assert.equal(links[0].props.href,'https://w3.farbar.ai/channels/channel30/cms31/editChannel.php?chcode=rG2vq&cntcode=NVJkF&');
 assert.match(text(links[0]),/頻道管理入口/);
 for(const s of ['台南毅安／門診時間','上傳／儲存流程尚未驗證','未確認前不上傳、不儲存','實際／頻道顯示'])assert.ok(text(c).includes(s),s);
});
test('clinic, selected month and poster title stay explicit and read-only',async()=>{
 const a=await render(),b=await render({clinicName:'晉安測試診所',monthKey:'2099-02',posterTitle:'2099/01 測試專用'});
 for(const s of ['毅安測試診所','2099-01','2099/01 測試專用','先選擇診所，再用上方現有預覽／下載'])assert.ok(text(a).includes(s),s);
 assert.match(text(b),/晉安測試診所/);assert.match(text(b),/2099-02/);assert.match(text(b),/2099\/01 測試專用/);
 assert.match(text(await render({})),/尚未選擇/);
});
test('FB operation remains conditional and no apparent publication success is rendered',async()=>{
 const tree=await render();const fb=nodes(tree).find(n=>n.props['aria-labelledby']==='jinan-fb-title');
 assert.match(text(fb),/新增貼文或更換既有相片.*尚未確認/);
 assert.match(text(fb),/若本次經確認採用新增貼文/);
 assert.doesNotMatch(text(tree),/✓.*(?:已發布|發布完成)|發布成功|已完成發布/);
});
test('manual module has no API, storage, download, business state or hidden publication side effects',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../manual-publish.mjs'),'utf8');
 assert.doesNotMatch(source,/\b(fetch|XMLHttpRequest|WebSocket|sendBeacon|localStorage|sessionStorage|useState|useEffect|handleDownload)\b|\/api\/|html2canvas|\.click\(/);
 const html=fs.readFileSync(path.join(__dirname,'../legacy.html'),'utf8');
 assert.match(html,/<ManualPublishSection clinicName=\{data\.clinics\.find/);
 assert.match(html,/monthKey=\{monthKey\} posterTitle=\{data\.title\}/);
});

test('Yian Facebook preserves the exact user-confirmed public URL and unverified workflow',async()=>{
 const c=nodes(await render()).find(n=>n.props['aria-labelledby']==='yian-fb-title');
 const links=nodes(c).filter(n=>n.tag==='a');assert.equal(links.length,1);
 assert.equal(links[0].props.href,'https://www.facebook.com/IANCLINICTAINAN/?locale=zh_TW');
 assert.equal(text(links[0]),'開啟毅安 FB 粉專（新分頁）');
 assert.equal(links[0].props.target,'_blank');assert.equal(links[0].props.rel,'noopener noreferrer');
 assert.equal(links[0].props.onClick,undefined);
 for(const phrase of ['使用者提供','公開頁','不是已驗證的管理編輯入口','管理介面尚未驗證','「毅安」粉專','新增貼文或更換既有相片','尚未確認','未確認前請停止','本區開啟連結不會發布','不重複發布或上傳'])assert.ok(text(c).includes(phrase),phrase);
 assert.doesNotMatch(text(c),/連結待提供|入口待確認|發布成功|已完成發布/);
});
