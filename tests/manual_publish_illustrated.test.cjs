const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
function nodes(n) { return n && typeof n === 'object' ? [n, ...n.children.flatMap(nodes)] : []; }
function text(n) { return n && typeof n === 'object' ? n.children.map(text).join('') : String(n ?? ''); }
async function render() {
  const {default: Component} = await import('../manual-publish.mjs');
  globalThis.React = {createElement: (tag, props, ...children) => ({tag, props: props || {}, children: children.flat(Infinity)})};
  try { return Component(); } finally { delete globalThis.React; }
}
test('real illustrations are local, responsive and only in Jinan; every enlargement points at the displayed asset', async () => {
  const tree = await render(), articles = nodes(tree).filter(n => n.tag === 'article');
  const images = nodes(articles[0]).filter(n => n.tag === 'img');
  assert.equal(images.length, 5);
  for (const img of images) {
    assert.ok(fs.statSync(path.join(root, img.props.src)).size > 1000);
    assert.equal(img.props.style.maxWidth, '100%');
    assert.equal(img.props.style.height, 'auto');
    const anchor = nodes(articles[0]).find(n => n.tag === 'a' && n.props.href === img.props.src);
    assert.equal(anchor.props.target, '_blank'); assert.equal(anchor.props.rel, 'noopener noreferrer');
    assert.match(img.props.alt, /圖/);
  }
  for (const article of articles.slice(1)) assert.equal(nodes(article).filter(n => n.tag === 'img').length, 0);
  assert.equal(nodes(articles[1]).filter(n => n.tag === 'button' && n.props.disabled).length, 0);
  for (const article of articles.slice(3, 4)) assert.equal(nodes(article).filter(n => n.tag === 'a').length, 0);
});
test('missing screenshots and limits are explicit, and confirm is distinct from publication', async () => {
  const tree = await render();
  assert.deepEqual(nodes(tree).filter(n => n.props['data-missing-screenshot']).map(n => n.props['data-missing-screenshot']), ['upload', 'submit']);
  for (const phrase of ['115年9月僅為示例', '每次都要核對實際發布月份', '局部預覽不能證明原圖被裁切', '不是要手動輸入的固定網址', '只套用編輯器，尚未發布', '門診時間表內容', '不要雙擊']) assert.ok(text(tree).includes(phrase), phrase);
});
test('offline HTML embeds exactly the same five sanitized PNGs with no runtime dependencies', () => {
  const html = fs.readFileSync(path.join(root, 'docs/官網門診表操作手冊.html'), 'utf8');
  assert.ok(!/<script|<link|<iframe|<form|@import|url\(/i.test(html));
  const images = [...html.matchAll(/<img src="data:image\/png;base64,([^"]+)"/g)];
  assert.equal(images.length, 5);
  const files = fs.readdirSync(path.join(root, 'docs/assets/website-guide')).filter(f => f.endsWith('.png')).sort();
  images.forEach((m, i) => assert.deepEqual(Buffer.from(m[1], 'base64'), fs.readFileSync(path.join(root, 'docs/assets/website-guide', files[i]))));
  assert.match(html, /default-src 'none'/);
  assert.match(html, /@media print/); assert.match(html, /width=device-width, initial-scale=1/);
  assert.ok(!/user-scalable=no|maximum-scale=1/.test(html));
  assert.equal((html.match(/class="missing"/g) || []).length, 2);
  assert.ok(html.includes('https://www.ian-tainan.com/time.html'));
  assert.ok(html.includes('https://www.ian-tainan.com/admin/login.php'));
  assert.ok(html.includes('後台登入URL：使用者提供'));
  assert.ok(html.includes('內部換圖流程/截圖：待確認'));
});
test('Markdown relative images resolve and existing eight-step ordering survives image insertion', () => {
  const md = fs.readFileSync(path.join(root, 'docs/官網門診表操作手冊.md'), 'utf8');
  const images = [...md.matchAll(/!\[[^\]]+\]\(([^)]+)\)/g)];
  assert.equal(images.length, 5);
  for (const [, rel] of images) assert.ok(fs.existsSync(path.join(root, 'docs', rel)));
  assert.deepEqual([...md.matchAll(/^(\d)\. /gm)].map(m => +m[1]), [1,2,3,4,5,6,7,8]);
  assert.equal((md.match(/\*\*缺圖待補/g)||[]).length, 2);
});
