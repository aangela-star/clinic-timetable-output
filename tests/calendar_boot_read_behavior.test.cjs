// PR18 BLOCKER 2 (and the frontend half of BLOCKER 1), tested by EXECUTING calendar-editor.js.
//
// The earlier startup-read tests asserted on source text, so they could not show what the editor
// does with a slow, aborted, stale or refused response. These run the real editor in a VM with a
// fake DOM, a controllable clock, controllable timers and a controllable fetch.
//
// BLOCKER 2: the boot read set the shared `busy` flag, which also arms the beforeunload warning
// and makes window.calendarCanLeave() (used by 登出 / 雲端登入 in index.html) return false. On a
// slow network a clean device could not navigate for up to 15 seconds and was told it had unsaved
// work it did not have.
//
// SCOPE: a mock DOM and a mock cloud. Not a browser, not production.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startEditor, DRAFT_KEY, LAST_MONTH_KEY, M, TEST_DATA } = require('./helpers/calendar-editor-vm.cjs');

const MONTH = '2026-11';
const CLOUD_MARKER = '雲端丙';   // 3 characters: a longer name renders as 姓名待排版 and makes the poster fatal

// A cloud payload shaped exactly like envelope() produces, containing a doctor that exists in no
// local seed, so its presence on screen proves cloud content was adopted.
function cloudPayload(month = MONTH) {
  let state = M.init(TEST_DATA);
  if (!M.month(state, month)) state = M.createSourceMonth(state, month, TEST_DATA);
  state = M.addDoctor(state, { id: 'cloud-only', name: CLOUD_MARKER, color: '#114477' });
  state = M.setCell(state, month, 'jin', 0, 'am', { status: 'scheduled', doctorIds: ['cloud-only'] }, TEST_DATA);
  const months = { [month]: state.months[month] };
  return {
    ok: true,
    found: true,
    readOnly: true,
    month,
    updatedAt: '2026-11-22T00:00:00.000Z',
    data: {
      title: month,
      note: '月曆版；儲存不等於發布',
      clinics: TEST_DATA.clinics,
      calendarVersion: 1,
      calendar: { state: { ...state, months }, currentMonth: month,
        view: { template: 'calendar', format: 'dual', clinicId: 'jin', topClinicId: 'jin' } },
    },
  };
}

function localDraft(month = '2026-10') {
  return JSON.stringify({ state: M.init(TEST_DATA), currentMonth: month,
    view: { template: 'calendar', format: 'dual', clinicId: 'jin', topClinicId: 'jin' } });
}

function makeDirty(h) {
  // The real <input type="color"> has a value; the fake DOM starts empty, so set both fields the
  // operator would have filled.
  h.el('new-doctor-color').value = '#215f70';
  const el = h.el('new-doctor-name');
  el.value = '臨時輸入';
  el.dispatch('input');
}

// --- BLOCKER 2: the boot read must not look like unsaved work ---------------------------------

test('a clean device can navigate away while the startup read is still in flight', async () => {
  const h = startEditor({});
  await h.settle();
  assert.equal(h.requests.length, 1, 'the boot read should be in flight');
  assert.equal(h.requests[0].settled, false);

  assert.equal(h.canLeave(), true, 'SPA navigation must not be blocked by a read with nothing to lose');
  assert.equal(h.windowEvent('beforeunload').defaultPrevented, false,
    'the unsaved-work dialog must not be armed by the startup read');
  h.destroy();
});

test('unsaved local input still blocks navigation during the startup read', async () => {
  const h = startEditor({});
  await h.settle();
  makeDirty(h);
  assert.equal(h.canLeave(), false, 'real unsaved work must still block');
  assert.equal(h.windowEvent('beforeunload').defaultPrevented, true);
  assert.match(h.text('status'), /切換已取消/);
  h.destroy();
});

test('navigation stays possible after the startup read finishes, fails or times out', async () => {
  for (const finish of [
    (h) => h.reply(h.requests[0], { json: cloudPayload() }),
    (h) => h.reply(h.requests[0], { status: 401, json: { ok: false } }),
    (h) => h.runTimers(),
  ]) {
    const h = startEditor({});
    await h.settle();
    finish(h);
    await h.settle();
    assert.equal(h.canLeave(), true);
    assert.equal(h.windowEvent('beforeunload').defaultPrevented, false);
    assert.equal(h.el('cloud-load').disabled, false, 'the cloud buttons must be released');
    h.destroy();
  }
});

test('an explicit cloud action is still excluded while the startup read runs, with feedback', async () => {
  const h = startEditor({});
  await h.settle();
  assert.equal(h.el('cloud-load').disabled, true, 'the cloud buttons are disabled during the boot read');
  assert.equal(h.el('cloud-save').disabled, true);

  // Even if a click gets through (a stale enabled button, a scripted click), it must not start a
  // second overlapping request, and the operator must be told why nothing happened.
  h.click('cloud-load');
  h.click('cloud-save');
  await h.settle();
  assert.equal(h.requests.length, 1, `a concurrent cloud action started another request: ${h.requests.length}`);
  assert.match(h.text('cloud-status'), /開啟時.*讀取|請稍候/);
  h.destroy();
});

test('the startup read runs exactly once', async () => {
  const h = startEditor({});
  await h.settle();
  h.reply(h.requests[0], { json: { ok: true, found: false, readOnly: true, month: MONTH } });
  await h.settle();
  assert.equal(h.requests.length, 1);
  h.destroy();
});

// --- teardown and staleness ------------------------------------------------------------------

test('tearing the editor down cancels the read and a late response changes nothing', async () => {
  const h = startEditor({});
  await h.settle();
  const before = h.text('cloud-status');
  const storageBefore = JSON.stringify([...h.storage]);

  h.destroy();
  assert.equal(h.timers.size, 0, 'the abort timer must be cleared on teardown');
  assert.equal(h.hasCanLeave(), false, 'calendarCanLeave must be removed on teardown');
  assert.equal(h.windowHandlerCount('beforeunload'), 0, 'window listeners must be removed');

  h.reply(h.requests[0], { json: cloudPayload() });
  await h.settle();

  assert.equal(h.text('cloud-status'), before, 'a response after teardown must not write to the DOM');
  assert.ok(!h.el('clinics').innerHTML.includes(CLOUD_MARKER), 'a response after teardown must not render');
  assert.equal(JSON.stringify([...h.storage]), storageBefore, 'a response after teardown must not write storage');
});

test('a local save during the read makes the response stale, and the response is not applied', async () => {
  const h = startEditor({});
  await h.settle();
  makeDirty(h);
  h.click('save-all');
  assert.match(h.text('status'), /已儲存全部目前輸入到本機草稿/);
  const draftAfterSave = h.storage.get(DRAFT_KEY);

  h.reply(h.requests[0], { json: cloudPayload() });
  await h.settle();

  assert.match(h.text('cloud-status'), /已過期/);
  assert.ok(!h.el('clinics').innerHTML.includes(CLOUD_MARKER), 'the stale response was applied anyway');
  assert.equal(h.storage.get(DRAFT_KEY), draftAfterSave, 'the local draft was modified by a stale response');
  assert.equal(h.storage.has(LAST_MONTH_KEY), false, 'a stale read must not remember a month');
  h.destroy();
});

// --- timeout classification (review finding P3) ------------------------------------------------

test('a timeout while the response BODY is still streaming is reported as a timeout', async () => {
  const h = startEditor({});
  await h.settle();
  // Headers arrived; the body is still streaming when the 15s abort fires.
  const releaseBody = h.reply(h.requests[0], { json: cloudPayload(), holdBody: true });
  await h.settle();
  h.runTimers();            // the 15s abort lands first
  await h.settle();
  releaseBody();            // then the body finishes arriving
  await h.settle();

  assert.match(h.text('cloud-status'), /CLOUD_TIMEOUT|逾時/);
  assert.ok(!/不是有效 JSON|登入頁/.test(h.text('cloud-status')),
    `a timeout must not be reported as an intercepted login page: ${h.text('cloud-status')}`);
  h.destroy();
});

test('a genuinely malformed body is still reported as malformed', async () => {
  const h = startEditor({});
  await h.settle();
  h.reply(h.requests[0], { body: '<html>login</html>' });
  await h.settle();
  assert.match(h.text('cloud-status'), /不是有效 JSON/);
  assert.match(h.text('cloud-status'), /不是雲端內容/);
  h.destroy();
});

// --- BLOCKER 1, frontend side -----------------------------------------------------------------

test('the startup read requests the read-only action', async () => {
  const h = startEditor({});
  await h.settle();
  const url = new URL(h.requests[0].url);
  assert.equal(url.searchParams.get('action'), 'loadReadOnly');
  assert.equal(url.searchParams.get('month'), MONTH);
  assert.equal(h.requests[0].init.method, undefined, 'the boot read must be a GET');
  h.destroy();
});

test('a backend without the read-only path is refused, with no second attempt', async () => {
  const h = startEditor({});
  await h.settle();
  h.reply(h.requests[0], { status: 502,
    json: { ok: false, error: 'READ_ONLY_LOAD_UNSUPPORTED', message: '雲端後端尚未部署唯讀讀取路徑，已停止讀取。' } });
  await h.settle();

  assert.equal(h.requests.length, 1, 'the editor must not retry on another path');
  assert.match(h.text('cloud-status'), /READ_ONLY_LOAD_UNSUPPORTED|唯讀/);
  assert.match(h.text('cloud-status'), /不是雲端內容/);
  assert.ok(!/已於開啟時載入雲端/.test(h.text('cloud-status')), 'a refusal must never read as success');
  assert.equal(h.storage.has(LAST_MONTH_KEY), false);

  // And it must not have granted write eligibility: a cloud save must still be refused.
  h.click('cloud-save');
  await h.settle();
  h.reply(h.requests[1], { json: cloudPayload() });
  await h.settle();
  assert.equal(h.requests.filter((r) => r.init.method === 'POST').length, 0,
    'a refused startup read must not make the next save able to overwrite the cloud');
  assert.match(h.text('cloud-status'), /操作停止|未覆寫/);
  h.destroy();
});

// --- regressions the remediation must not break ------------------------------------------------

test('a found payload is still adopted on a device with no draft, and nothing is written', async () => {
  const h = startEditor({});
  await h.settle();
  h.reply(h.requests[0], { json: cloudPayload() });
  await h.settle();

  assert.match(h.text('cloud-status'), /已於開啟時載入雲端/);
  assert.ok(h.el('clinics').innerHTML.includes(CLOUD_MARKER), 'cloud content was not adopted');
  assert.equal(h.storage.has(DRAFT_KEY), false, 'the boot read must not persist a draft');
  assert.equal(h.storage.get(LAST_MONTH_KEY), MONTH, 'the loaded month should be remembered');
  assert.equal([...h.storage.keys()].filter((k) => k.includes('cloud-backup')).length, 0,
    'the boot read overwrites nothing, so it must not write backups');
  assert.equal(h.requests.filter((r) => r.init.method === 'POST').length, 0, 'no POST on boot');

  // Adoption DOES grant write eligibility: the operator has seen the cloud version.
  h.click('cloud-save');
  await h.settle();
  h.reply(h.requests[1], { json: cloudPayload() });
  await h.settle();
  const posts = h.requests.filter((r) => r.init.method === 'POST');
  assert.equal(posts.length, 1, `an adopted month must stay saveable: ${h.text('cloud-status')}`);
  h.destroy();
});

test('an existing local draft is preserved and never granted write eligibility', async () => {
  const draft = localDraft('2026-10');
  const h = startEditor({ draft });
  await h.settle();
  h.reply(h.requests[0], { json: cloudPayload('2026-10') });
  await h.settle();

  assert.equal(h.storage.get(DRAFT_KEY), draft, 'the local draft must be byte-identical');
  assert.match(h.text('cloud-status'), /雲端已有/);
  assert.ok(!h.el('clinics').innerHTML.includes(CLOUD_MARKER), 'the cloud version must not be adopted');
  assert.equal(h.text('baseline-month'), '2026-10');

  h.click('cloud-save');
  await h.settle();
  h.reply(h.requests[1], { json: cloudPayload('2026-10') });
  await h.settle();
  assert.equal(h.requests.filter((r) => r.init.method === 'POST').length, 0,
    'a preserved draft must not be able to overwrite the cloud without an explicit load');
  assert.equal(h.storage.get(DRAFT_KEY), draft, 'the local draft must still be byte-identical');
  h.destroy();
});

test('the passwordless preview never reads the cloud', async () => {
  const h = startEditor({ preview: true });
  await h.settle();
  assert.deepEqual(h.requests, []);
  assert.equal(h.el('cloud-load').disabled, true);
  assert.match(h.text('cloud-status'), /預覽版|免密碼/);
  h.destroy();
});
