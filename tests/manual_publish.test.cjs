const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
async function render() {
  const { default: ManualPublishSection } = await import('../manual-publish.mjs');
  globalThis.React = { createElement: (tag, props, ...children) => ({ tag, props: props || {}, children: children.flat(Infinity) }) };
  try { return ManualPublishSection(); } finally { delete globalThis.React; }
}
function nodes(node) {
  return typeof node === 'object' && node ? [node, ...node.children.flatMap(nodes)] : [];
}
function text(node) {
  return typeof node === 'object' && node ? node.children.map(text).join('') : String(node ?? '');
}

test('manual section renders five labelled destinations, safe supplied/verified links and no disabled destinations below PNG download', async () => {
  const tree = await render();
  const all = nodes(tree);
  assert.deepEqual(all.filter(n => n.tag === 'h3').map(text), ['晉安官網後台', '毅安官網後台', '晉安 FB 粉專', '毅安 FB 粉專', 'FarBar 院內顯示']);
  assert.ok(text(tree).includes('開啟連結不代表已發布。完成操作後，請到公開頁面或實際顯示確認。'));
  const links = all.filter(n => n.tag === 'a');
  assert.ok(links.some(n => n.props.href === 'https://www.tainanrehab.com/admin/index.php?op=time&sub=set'));
  for (const link of links) {
    assert.equal(link.props.target, '_blank');
    assert.equal(link.props.rel, 'noopener noreferrer');
    assert.equal(link.props.onClick, undefined);
  }
  const disabled = all.filter(n => n.tag === 'button' && n.props.disabled);
  assert.equal(disabled.length, 0);
  assert.equal(links.filter(n => /facebook/.test(n.props.href)).length, 2);
  const html = fs.readFileSync(path.join(root, 'legacy.html'), 'utf8');
  assert.ok(html.includes('React.lazy(() => import("./manual-publish.mjs"))'));
  assert.ok(html.indexOf('<ManualPublishSection clinicName=') > html.indexOf('下載高清 PNG 海報'));
});

test('each destination has its own native disclosure with honest platform-specific operating guidance', async () => {
  const all = nodes(await render());
  const articles = all.filter(n => n.tag === 'article');
  for (const article of articles) {
    const details = nodes(article).filter(n => n.tag === 'details');
    assert.equal(details.length, 1, text(article));
    assert.equal(details[0].props.open, undefined, 'manual initially collapsed');
    assert.equal(details[0].children[0].tag, 'summary');
    assert.ok(text(details[0].children[0]).includes(text(nodes(article).find(n => n.tag === 'h3'))));
  }
  const jinan = text(articles[0]);
  for (const phrase of ['單擊', '工具列', '不要雙擊', '核准 PNG', '上傳至伺服器', '尺寸', '確定', '尚未提交整頁', '訊息確認', '送出', '一次', '公開頁', '可能已送出', '不重送']) assert.ok(jinan.includes(phrase), phrase);
  assert.ok(!/675|1200/.test(jinan), 'prior pilot dimensions must not become future defaults');
  assert.ok(nodes(articles[0]).some(n => n.props.href === 'https://www.tainanrehab.com/time.html'));
  for (const phrase of ['尚未驗證', '停止', '後台登入URL：使用者提供', '內部換圖流程/截圖：待確認', '操作流程']) assert.ok(text(articles[1]).includes(phrase), phrase);
  for (const article of articles.slice(3, 4)) {
    for (const phrase of ['介面可能變更', '管理介面尚未驗證', '專屬公開頁', '診所', '月份', '公告', '預覽', '操作人員', '公開', '不重複']) assert.ok(text(article).includes(phrase), phrase);
  }
});

test('website guides give safe everyday instructions and keep Yian publishing pending', async () => {
  const articles = nodes(await render()).filter(n => n.tag === 'article');
  const jinan = text(articles[0]);
  for (const phrase of ['既有帳號', '不記錄密碼', '下載舊圖片', '截圖只是比對參考', '不是完整還原備份', '上傳」分頁', '上傳至伺服器」一次', '保留既有顯示設定', '不裁切', '手機或無痕視窗', '登入失敗', '過期', '模糊', '主管']) assert.ok(jinan.includes(phrase), phrase);
  assert.ok(!/URL|hash|SHA-256|衍生圖|CKEditor/.test(jinan), 'technical checks belong in administrator notes');
  assert.match(jinan, /已上傳或不確定.*停止.*主管.*不重複上傳/);
  assert.match(jinan, /訊息確認.*下方.*送出.*一次/);
  const yian = text(articles[1]);
  assert.ok(yian.includes('準備與驗收清單草稿，後台換圖步驟待確認'));
  assert.ok(yian.includes('不是管理後台入口'));
  assert.ok(yian.includes('先確認主管指定更新哪張，保留其他圖，不用單一 PNG 覆蓋整頁多圖'));
  const links = nodes(articles[1]).filter(n => n.tag === 'a');
  assert.equal(links.length, 2);
  const backend = links.shift();
  assert.equal(backend.props.href, 'https://www.ian-tainan.com/admin/login.php');
  assert.equal(backend.props.target, '_blank');
  assert.equal(backend.props.rel, 'noopener noreferrer');
  assert.ok(yian.includes('開啟連結不授權自動登入、上傳或送出。'));
  assert.equal(links[0].props.href, 'https://www.ian-tainan.com/time.html');
  assert.equal(text(links[0]), '開啟毅安公開門診表（新分頁）');
  assert.ok(!nodes(articles[1]).some(n => n.tag === 'button' && n.props.disabled));
});

test('colleague Markdown separates real Jinan workflow, blocked Yian draft and administrator details', () => {
  const guide = fs.readFileSync(path.join(root, 'docs/官網門診表操作手冊.md'), 'utf8');
  const [colleague, advanced] = guide.split('## 進階備註：僅供管理員');
  assert.ok(advanced);
  assert.ok(!/SHA-256|hash|衍生圖|675/.test(colleague));
  assert.match(advanced, /675 × 1200/);
  assert.match(advanced, /不是要求重新縮放 PNG.*不是所有官網的通用尺寸/);
  assert.match(colleague, /截圖只是比對參考，不是完整還原備份/);
  assert.match(colleague, /準備與驗收清單草稿，後台換圖步驟待確認/);
  assert.match(colleague, /這是公開頁，不是管理後台入口/);
  assert.equal((colleague.match(/^\d\. /gm) || []).length, 8);
  assert.ok(colleague.indexOf('**上傳一次。**') < colleague.indexOf('**整頁送出一次。**'));
  assert.ok(colleague.indexOf('**整頁送出一次。**') < colleague.indexOf('**到公開頁驗收。**'));
  for (const phrase of ['登入失敗', '月份或檔案過期', '圖片模糊', '可能已送出', '不重試', '不刪除舊圖片', '不修改其他欄位', '手機或無痕視窗']) assert.ok(colleague.includes(phrase), phrase);
  assert.ok((colleague.match(/^- \[ \]/gm) || []).length >= 10);
});


test('both manuals identify the verified Yian public page and preserve all four images', () => {
  for (const file of ['docs/官網門診表操作手冊.md', 'docs/MANUAL_PUBLISH_LOCAL.md']) {
    const guide = fs.readFileSync(path.join(root, file), 'utf8');
    assert.ok(guide.includes('https://www.ian-tainan.com/time.html'));
    assert.ok(guide.includes('先確認主管指定更新哪張，保留其他圖，不用單一 PNG 覆蓋整頁多圖'));
    for (const name of ['毅安門診表', '晉安門診表', '門診異動表', '週六門診表']) assert.ok(guide.includes(name));
    assert.ok(!/公開門診表網址(?:未知|尚未驗證)|另行確認的公開門診表網址/.test(guide));
    assert.ok(guide.includes('https://www.ian-tainan.com/admin/login.php'));
    assert.ok(guide.includes('後台登入URL：使用者提供'));
    assert.ok(guide.includes('內部換圖流程/截圖：待確認'));
    assert.ok(!guide.includes('目前未知：後台網址'));
  }
});


test('Jinan Facebook supplied entry is enabled safely alongside the supplied Yian public page', async () => {
  const articles = nodes(await render()).filter(n => n.tag === 'article');
  const jinan = nodes(articles[2]);
  const links = jinan.filter(n => n.tag === 'a');
  assert.equal(links.length, 1);
  assert.equal(links[0].props.href, 'https://www.facebook.com/tainanrehab');
  assert.equal(links[0].props.target, '_blank');
  assert.equal(links[0].props.rel, 'noopener noreferrer');
  assert.equal(links[0].props.onClick, undefined);
  assert.equal(jinan.filter(n => n.tag === 'button').length, 0);
  assert.equal(nodes(articles[3]).filter(n => n.tag === 'a').length, 1);
  assert.equal(nodes(articles[3]).find(n => n.tag === 'a').props.href, 'https://www.facebook.com/IANCLINICTAINAN/?locale=zh_TW');
  assert.equal(nodes(articles[3]).filter(n => n.tag === 'button').length, 0);
});


test('Jinan inline and Markdown guide cover the approved manual-only employee workflow', async () => {
  const article = nodes(await render()).filter(n => n.tag === 'article')[2];
  const inline = text(article);
  assert.ok(inline.includes('文字操作指引，介面名稱可能不同；圖解待補'));
  const markdown = fs.readFileSync(path.join(root, 'docs/晉安Facebook門診發布手冊.md'), 'utf8');
  for (const guide of [inline, markdown]) {
    for (const phrase of ['診所、月份', '核准 PNG', '核准文字', 'https://www.facebook.com/tainanrehab', '粉專權限', '切換為晉安', '粉專名稱', '建立貼文', '相片／影片', '裝置或版本', '主管', '個人頁面', '另一間診所', '高解析度', '預覽', '下載', '醫師、日期或時間', '不裁切', '清楚可讀', '授權員工', '手動發布一次', '新貼文', '可能需要登入', '不保證未登入', '結果不明', '既有貼文', '不重複發布', '不使用權杖', '不會自動發文']) assert.ok(guide.includes(phrase), phrase);
    assert.ok(guide.indexOf('診所、月份') < guide.indexOf('https://www.facebook.com/tainanrehab'));
    assert.ok(guide.indexOf('手動發布一次') < guide.lastIndexOf('https://www.facebook.com/tainanrehab'));
    assert.ok(!/professional_dashboard|status\/|!\[|<img/.test(guide));
  }
  assert.equal(nodes(article).filter(n => n.tag === 'img').length, 0);
});
