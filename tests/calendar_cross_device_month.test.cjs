// Regression: cross-device calendar month divergence (Mac/iPhone showed 2026-10 while Windows showed 2026-11).
// Root cause: calendar-editor.js pinned its boot month to the hardcoded TEST_DATA.month ('2026-10')
// whenever the device had no local draft, and never consulted the real current month or the
// 'clinic-timetable.last-schedule-month' key that rememberLoadedMonth/rememberSavedMonth already wrote.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const core = require('../schedule-save-load-core.js');
const repoRoot = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(repoRoot, p), 'utf8');

// A device whose browser clock says November 2026, with a controllable localStorage.
function novemberRuntime(stored) {
  const map = new Map(Object.entries(stored || {}));
  return {
    Date: class extends Date { constructor() { super(2026, 10, 22, 12); } },
    localStorage: {
      getItem: (k) => (map.has(k) ? map.get(k) : null),
      setItem: (k, v) => map.set(k, String(v)),
    },
  };
}

test('fresh device with no draft boots the real current month, not the hardcoded source month', () => {
  // This is the Mac/iPhone case: empty localStorage, clock in November.
  assert.equal(core.resolveCalendarBootMonth(novemberRuntime(), { metaMonth: '2026-10' }), '2026-11');
});

test('a device that previously loaded or saved a cloud month reuses it', () => {
  // rememberLoadedMonth / rememberSavedMonth write this key; before the fix nothing ever read it.
  const runtime = novemberRuntime({ [core.LAST_SCHEDULE_MONTH_STORAGE_KEY]: '2026-12' });
  assert.equal(core.resolveCalendarBootMonth(runtime, { metaMonth: '2026-10' }), '2026-12');
});

test('an existing local draft still wins so unsaved device work is never silently moved', () => {
  const runtime = novemberRuntime({ [core.LAST_SCHEDULE_MONTH_STORAGE_KEY]: '2026-12' });
  assert.equal(
    core.resolveCalendarBootMonth(runtime, { metaMonth: '2026-10', draftMonth: '2026-09' }),
    '2026-09',
  );
});

test('a corrupt remembered month is ignored rather than crashing the editor', () => {
  const runtime = novemberRuntime({ [core.LAST_SCHEDULE_MONTH_STORAGE_KEY]: 'not-a-month' });
  assert.equal(core.resolveCalendarBootMonth(runtime, { metaMonth: '2026-10' }), '2026-11');
});

test('blocked storage degrades to the current month instead of the hardcoded source month', () => {
  const runtime = novemberRuntime();
  Object.defineProperty(runtime, 'localStorage', { get() { throw new Error('storage blocked'); } });
  assert.equal(core.resolveCalendarBootMonth(runtime, { metaMonth: '2026-10' }), '2026-11');
});

test('calendar editor boots through the shared resolver instead of pinning META.month', () => {
  const s = read('calendar-editor.js');
  // The boot declaration must go through the resolver; a META.month fallback inside the
  // createSourceMonth rescue path is still allowed.
  assert.match(s, /let state=M\.init\(META\),currentMonth=ScheduleSaveLoadCore\.resolveCalendarBootMonth\(/);
  assert.doesNotMatch(s, /let state=M\.init\(META\),currentMonth=META\.month/);
  // The boot month must be materialised in state, otherwise the editor renders a missing month.
  assert.match(s, /createSourceMonth/);
});

// --- startup cloud read -------------------------------------------------------------------
// Month alignment alone is NOT sync: before this, a fresh device opened on the right month but
// still rendered the built-in seed, never the cloud content. These guard the read contract.
test('editor performs a startup cloud read, gated to the authenticated editor', () => {
  const s = read('calendar-editor.js');
  assert.match(s, /async function bootCloudRead\(\)/);
  assert.match(s, /if\(!preview\)bootCloudRead\(\)/, 'boot read must not run in passwordless preview');
  // The boot read must not run in preview, must not overlap an operator cloud action or itself,
  // and must not start after teardown. Behavioural coverage: calendar_boot_read_behavior.test.cjs.
  assert.match(s, /if\(preview\|\|busy\|\|bootBusy\|\|bootStarted\|\|closed\)return/,
    'boot read must bail out in preview, while busy, while already running, or after teardown');
  // It must NOT reuse `busy`: that flag arms the beforeunload dialog and blocks SPA navigation.
  const bootBody = s.slice(s.indexOf('async function bootCloudRead()'), s.indexOf('if(!preview)bootCloudRead()'));
  assert.ok(!/(^|[^t])busy=true/.test(bootBody.replace(/bootBusy=true/g, '')),
    'the boot read must not set the operator-action busy flag');
  assert.match(s, /window\.calendarCanLeave=\(\)=>!busy&&guardSwitch\(\)/,
    'leaving must only be blocked by an operator cloud action, never by the startup read');
  assert.match(s, /listen\('beforeunload',e=>\{if\(dirty\|\|busy\)/,
    'the unsaved-work dialog must only be armed by real unsaved work or an operator action');
});

test('startup cloud read never writes: no POST and no draft persistence on boot', () => {
  const s = read('calendar-editor.js');
  const body = s.slice(s.indexOf('async function bootCloudRead()'), s.indexOf('if(!preview)bootCloudRead()'));
  assert.ok(body.length > 200, 'failed to isolate bootCloudRead body');
  assert.ok(!/method:'POST'/.test(body), 'boot read must not POST');
  assert.ok(!/D\.write\(/.test(body), 'boot read must not persist a draft');
  assert.ok(!/localStorage\.setItem/.test(body), 'boot read must not write localStorage directly');
  assert.ok(!/backupCloud\(/.test(body), 'boot read overwrites nothing, so it must not spam backups');
});

test('startup cloud read only adopts a validated FOUND envelope', () => {
  const s = read('calendar-editor.js');
  const body = s.slice(s.indexOf('async function bootCloudRead()'), s.indexOf('if(!preview)bootCloudRead()'));
  assert.match(body, /if\(!p\.found\)/, 'must handle not-found explicitly');
  assert.match(body, /calendarVersion!==1/, 'must refuse legacy payloads');
  assert.match(body, /M\.validateState\(incoming\.state,META\)/, 'must validate before adopting');
  assert.match(body, /if\(hadDraft\|\|dirty\)/, 'must preserve an existing local draft');
  // Every non-success branch has to name the source actually on screen.
  assert.ok((body.match(/不是雲端內容/g) || []).length >= 3,
    'missing/legacy/failed branches must each say the screen is not showing cloud content');
});

// The save path gates overwriting the cloud on `observed`: a month is only writable if this tab
// has seen that exact cloud fingerprint. If the startup read grants that for a payload it never
// adopted, a device holding an unrelated local draft could overwrite the cloud without the
// operator ever seeing the cloud version.
test('startup read grants write eligibility only after validated adoption', () => {
  const s = read('calendar-editor.js');
  const body = s.slice(s.indexOf('async function bootCloudRead()'), s.indexOf('if(!preview)bootCloudRead()'));
  const grants = [...body.matchAll(/observed\.set\(/g)].map((m) => m.index);
  assert.equal(grants.length, 1, 'bootCloudRead must grant write eligibility exactly once');
  const grant = grants[0];
  for (const [label, needle] of [
    ['not-found branch', 'if(!p.found)'],
    ['legacy-version branch', 'calendarVersion!==1'],
    ['preserved-draft branch', 'if(hadDraft||dirty)'],
    ['payload validation', 'M.validateState(incoming.state,META)'],
    ['adoption', 'refreshAll()'],
  ]) {
    const at = body.indexOf(needle);
    assert.ok(at >= 0, `missing ${label}`);
    assert.ok(at < grant, `write eligibility is granted before ${label}; it must come strictly after`);
  }
});

test('a late startup response cannot overwrite intervening local work', () => {
  const s = read('calendar-editor.js');
  const body = s.slice(s.indexOf('async function bootCloudRead()'), s.indexOf('if(!preview)bootCloudRead()'));
  assert.match(body, /const guard=\{month,raw:lastRaw,state,view,editing\}/, 'must snapshot pre-request inputs');
  // Every snapshotted input, plus dirty, has to be rechecked before anything is applied.
  const recheck = body.match(/if\(guard\.month!==currentMonth[^)]*\)\{/);
  assert.ok(recheck, 'missing staleness recheck');
  for (const part of ['guard.month!==currentMonth', 'guard.raw!==lastRaw', 'guard.state!==state',
    'guard.view!==view', 'guard.editing!==editing', 'dirty']) {
    assert.ok(recheck[0].includes(part), `staleness recheck does not cover ${part}`);
  }
  const at = body.indexOf('guard.month!==currentMonth');
  assert.ok(at < body.indexOf('M.validateState'), 'staleness must be rechecked before adopting');
});

test('startup read is bounded by a timeout so the editor never stays locked', () => {
  const s = read('calendar-editor.js');
  assert.match(s, /BOOT_CLOUD_TIMEOUT_MS=\d+/);
  assert.match(s, /new AbortController\(\)/);
  assert.match(s, /setTimeout\(\(\)=>control\.abort\(\),BOOT_CLOUD_TIMEOUT_MS\)/);
  assert.match(s, /finally\{clearTimeout\(timer\);bootTimer=null;bootControl=null;bootBusy=false;/,
    'the boot flag and the timer must always be released');
  // Teardown must not leave the abort timer pending or the request in flight.
  assert.match(s, /closed=true;if\(bootTimer\)clearTimeout\(bootTimer\);bootTimer=null;if\(bootControl\)bootControl\.abort\(\)/);
  assert.match(s, /CLOUD_TIMEOUT/, 'an aborted read must be reported as a timeout, not as offline');
});

test('cloud read failures are classified rather than surfacing a raw parse error', () => {
  const s = read('calendar-editor.js');
  for (const code of ['CLOUD_OFFLINE', 'CLOUD_UNAUTHORIZED', 'CLOUD_MALFORMED', 'CLOUD_ERROR']) {
    assert.ok(s.includes(code), `remote() must classify ${code}`);
  }
  assert.match(s, /r\.status===401\|\|r\.status===403/, 'unauthorised must be detected before JSON parsing');
});

test('public poster carries no test-copy or fixed-source announcement text', () => {
  const layout = read('calendar-layout.js');
  for (const banned of [
    '原始資料測試副本，非本月正式公告',
    '此為設計測試資料，請勿據此安排就醫。',
    '完整姓名、代診、停診、加診皆以文字清楚標示；顏色僅輔助辨識。',
    '來源固定版',
  ]) {
    assert.ok(!layout.includes(banned), `calendar-layout.js must not render: ${banned}`);
  }
});

test('removing the banner does not strip the real schedule content', () => {
  const layout = read('calendar-layout.js');
  // Doctors, substitutes, cancellations and additional clinics must still be rendered.
  for (const kept of ['代診', '停診', '加診', '未公布', '休診', '無醫師']) {
    assert.ok(layout.includes(kept), `calendar-layout.js must still render: ${kept}`);
  }
});

// Behavioural check on the real render pipeline, not a source grep: the banner must be gone from
// published output while an incomplete month still prints a visible "not official" notice.
test('rendered poster drops the banner but keeps the incomplete-print draft notice', () => {
  const M = require('../timetable-model.js');
  const P = require('../timetable-poster.js');
  const V = require('../timetable-view.js');
  const META = { month: '2026-11', days: ['週一', '週二', '週三', '週四', '週五', '週六'],
    slots: [['am', '早診', '08:30–11:30'], ['pm', '午診', '14:30–17:30'], ['eve', '晚診', '18:30–20:30']],
    clinics: [{ id: 'jin', name: '晉安復健科診所', theme: '' }, { id: 'yi', name: '毅安診所', theme: 'blue' }] };
  const state = M.init(META);
  const view = { template: 'calendar', format: 'dual', clinicId: 'jin', topClinicId: 'jin' };

  const svg = V.render(state, '2026-11', META, M, P, view).clinics;
  for (const banned of ['原始資料測試副本', '非本月正式公告', '此為設計測試資料', '請勿據此安排就醫',
    '顏色僅輔助辨識', '來源固定版']) {
    assert.ok(!svg.includes(banned), `published poster still renders: ${banned}`);
  }
  // Seeded months leave Saturday rotations unannounced, so this month is genuinely incomplete.
  const print = V.renderPrint(state, '2026-11', META, M, P, view);
  assert.equal(print.complete, false);
  assert.ok(print.clinics.includes('列印草稿：含未公布或待確認，非正式公告'),
    'an incomplete month must still print a visible non-official draft notice');
});

// --- residual test-fixture copy ----------------------------------------------------------------
// The editor shipped wording left over from when it was a fixture: a standing 「測試版，非正式門診
// 資訊。」 banner, an SVG aria-label that called every poster 非正式資訊, and a settings blurb
// asserting a 2026-07 provenance that is false for any other month. Those label real data as fake.
// Warnings that are genuinely conditional (incomplete month, unconfirmed slot, cloud not loaded)
// must survive, so these tests check both directions.
test('editor no longer carries a standing test-build banner', () => {
  const s = read('calendar-editor.js');
  assert.ok(!s.includes('測試版，非正式門診資訊'), 'the unconditional test banner must be gone');
  // A complete month shows nothing; the element is hidden rather than left as an empty bar.
  assert.match(s, /banner\.hidden=!notice/);
  for (const kept of ['有衝突／超出容量，請處理後列印。', '可列印標記草稿；含未公布／待確認，不代表完整正式公告。']) {
    assert.ok(s.includes(kept), `conditional warning must be kept: ${kept}`);
  }
});

test('poster aria-label describes the poster instead of disclaiming it', () => {
  const layout = read('calendar-layout.js');
  assert.ok(!layout.includes('示意預覽，非正式資訊'), 'aria-label must not brand every poster as unofficial');
  assert.match(layout, /aria-label="\$\{escape\(label\)\}"/);
  const L = require('../calendar-layout.js');
  const fake = { clinicIds: ['jin', 'yi'], month: '2026-11', width: 10, height: 10, commands: [] };
  assert.equal(/aria-label="([^"]*)"/.exec(L.svg(fake))[1], '雙院醫師門診表 2026-11');
  assert.equal(/aria-label="([^"]*)"/.exec(L.svg({ ...fake, clinicIds: ['jin'] }))[1], '單院醫師門診表 2026-11');
});

test('settings copy drops fixture wording and the stale 2026-07 provenance claim', () => {
  const markup = read('calendar-template.js');
  for (const banned of ['測試月份', '測試名稱', '測試海報', '測試事件', '測試草稿', '測試儲存鍵',
    'A4 測試稿', '整合驗收草稿', '內建來源：2026-07', '姓名依父端獨立看圖核對轉錄', 'test-banner']) {
    assert.ok(!markup.includes(banned), `calendar-template.js must not ship: ${banned}`);
  }
  // The parts that carry real meaning for a reader stay.
  for (const kept of ['黑點表示當時段無醫師，不代表全院休診', '醫師門診時間不等同復健服務時間',
    '這是本機儲存，不是雲端送出／官網發布', '舊資料保留原格式，不自動遷移',
    '週日資料未知；輪班待定不等於休診']) {
    assert.ok(markup.includes(kept), `calendar-template.js must keep: ${kept}`);
  }
});

test('the banner stylesheet hook is renamed with it', () => {
  assert.ok(!read('calendar.css').includes('test-banner'));
  assert.ok(read('calendar.css').includes('status-banner'));
});

test('saved roster entries are no longer prefixed as test fixtures', () => {
  const s = read('calendar-editor.js');
  assert.ok(!s.includes("'test-doctor-'"), 'new doctors must not be minted with a test- id');
  assert.ok(!s.includes("'test-event-'"), 'new events must not be minted with a test- id');
});

// --- `unconfirmed` must stay an honest "nothing is stated" state -------------------------------
// This guards the MODEL, not the November draft. A slot nobody has stated must never render as
// 休診 (a positive claim that the clinic is shut) and must keep the month incomplete so the print
// path stamps the non-official notice. The November draft no longer relies on this state for
// Saturday — the user confirmed those slots are closed — but the state itself must stay honest,
// because that is what any future unstated slot falls back to.
test('an unconfirmed slot renders as unconfirmed, never as 休診, and blocks completeness', () => {
  const M = require('../timetable-model.js');
  const P = require('../timetable-poster.js');
  const V = require('../timetable-view.js');
  const META = { month: '2026-11', days: ['週一', '週二', '週三', '週四', '週五', '週六'],
    slots: [['am', '早診', '08:30–11:30'], ['pm', '午診', '14:30–17:30'], ['eve', '晚診', '18:30–20:30']],
    clinics: [{ id: 'jin', name: '晉安復健科診所', theme: '' }, { id: 'yi', name: '毅安診所', theme: 'blue' }] };
  const view = { template: 'calendar', format: 'dual', clinicId: 'jin', topClinicId: 'jin' };
  let state = M.init(META);
  state = M.setCell(state, '2026-11', 'jin', 5, 'pm', { status: 'unconfirmed', doctorIds: [] }, META);

  const resolved = M.resolveDay(state, META, 'jin', '2026-11-07', 'pm');
  assert.equal(resolved.status, 'unknown', 'an unconfirmed slot must resolve as unknown, not closed');

  const r = V.render(state, '2026-11', META, M, P, view);
  assert.equal(r.complete, false, 'an unconfirmed slot must keep the month incomplete');
  assert.ok(r.warnings.some((w) => w.includes('週六') && w.includes('午診')),
    `missing a warning for the unconfirmed Saturday 午診: ${JSON.stringify(r.warnings)}`);
  assert.ok(V.renderPrint(state, '2026-11', META, M, P, view).clinics
    .includes('列印草稿：含未公布或待確認，非正式公告'));
});

// The user confirmed on 2026-11-22 that 「星期六下午晚上都一定是休診」, so the November draft now
// encodes those four baseline slots as `closed`. Two things must hold at once: the status really is
// `closed`, and the provenance still records the SOURCE CELLS AS BLANK with the closure attributed
// to the user. Encoding it as `closed` while claiming the images proved it would be fabricated
// evidence, so that claim is asserted against explicitly.
test('the shipped November draft closes Saturday 午/晚 on the user confirmation, not on the images', () => {
  const draft = JSON.parse(read('tests/fixtures/cloud-sync-20261122/november-2026.json'));
  const month = draft.state.months['2026-11'];
  for (const clinic of ['jin', 'yi']) {
    const saturday = month.clinics[clinic][5];
    assert.equal(saturday[0].status, 'rotation', `${clinic} Saturday 早診 is a published per-date rotation`);
    for (const [i, slot] of [[1, '午診'], [2, '晚診']]) {
      assert.equal(saturday[i].status, 'closed',
        `${clinic} Saturday ${slot} is confirmed closed by the user and must be encoded as closed`);
      assert.deepEqual(saturday[i].doctorIds, [], `${clinic} Saturday ${slot} must carry no doctor`);
    }
  }
  // Saturday morning is untouched: all 8 published per-date rotations stay scheduled.
  const rotations = month.rotations;
  assert.equal(rotations.length, 8);
  for (const r of rotations) {
    assert.equal(r.slot, 'am', 'only Saturday 早診 is a rotation');
    assert.equal(r.status, 'scheduled', `${r.clinicId} ${r.date} 早診 must stay a published assignment`);
    assert.equal(r.doctorIds.length, 1);
  }
  // The provenance has to keep the two facts apart.
  const closure = draft.state.source.saturdayClosure;
  assert.ok(closure, 'the draft must record how the Saturday closure was decided');
  assert.equal(closure.status, 'closed');
  assert.equal(closure.imageProvesClosure, false,
    'the source cells are blank; the images must never be credited with proving closure');
  assert.match(closure.confirmedBy, /user/);
  assert.equal(closure.confirmedOn, '2026-11-22');
  assert.match(closure.statement, /星期六/);
  assert.match(closure.sourceImageShows, /空白/);
  assert.equal(closure.renderedCellsAffected, 16);
  assert.match(closure.note, /使用者確認/, 'the note must name the user as the source of the closure');
  assert.match(closure.note, /不是從原圖推得/, 'the note must say the images are not the source');
  // The round-trip ledger keeps the source column blank for these cells and labels the reason.
  const ledger = read('tests/fixtures/cloud-sync-20261122/november-2026-ledger.md');
  const saturdayRows = ledger.split('\n').filter((l) => /\| (午診|晚診) \| \(空白\) \|/.test(l));
  assert.equal(saturdayRows.length, 16, `expected 16 blank Saturday 午/晚 ledger rows: ${saturdayRows.length}`);
  for (const row of saturdayRows) {
    assert.match(row, /使用者確認休診（原圖空白）/, `ledger row loses the attribution: ${row}`);
    assert.match(row, /\| 休診 \|/, `ledger row should render 休診: ${row}`);
  }
  // The question is answered, so it leaves openQuestions and is recorded as resolved with its
  // answer and answerer -- the history is kept, not deleted.
  assert.deepEqual(draft.state.source.openQuestions, [],
    'the Saturday-blank semantics was the only open data question and the user answered it');
  const resolved = draft.state.source.resolvedQuestions;
  assert.equal(resolved.length, 1);
  assert.match(resolved[0].question, /週六/);
  assert.match(resolved[0].answeredBy, /user/);
  assert.equal(resolved[0].answeredOn, '2026-11-22');
  assert.equal(resolved[0].previousEncoding, 'unconfirmed（待確認）');
  // No Saturday cell may be left in the old unconfirmed encoding anywhere in the shipped month.
  for (const clinic of ['jin', 'yi']) {
    for (const row of month.clinics[clinic]) {
      for (const cell of row) assert.notEqual(cell.status, 'unconfirmed', 'no cell may ship unconfirmed');
    }
  }
  // The doctor id must stay stable even though the printed name was corrected.
  const zhuang = draft.state.doctors.find((d) => d.id === 'zhuang-yimei');
  assert.ok(zhuang, 'the existing doctor id must be reused, not replaced');
  assert.equal(zhuang.name, '莊逸玟');
  // The historical built-in seed is left alone: the correction lives in the November draft only.
  assert.equal(JSON.parse(read('calendar-seed.json')).doctors.find((d) => d.id === 'zhuang-yimei').name,
    '莊逸玫', 'calendar-seed.json must not be edited by this work');
  const correction = draft.state.source.nameCorrections[0];
  assert.equal(correction.id, 'zhuang-yimei');
  assert.equal(correction.printedInNovember, '莊逸玟');
  assert.equal(correction.seedEdited, false);
  // Two AI reads plus one published page -- the sources must not be padded into four parties.
  assert.equal(correction.sources.length, 3);
  assert.equal(correction.sources.filter((x) => x.kind === 'ai-vision').length, 2);
  assert.equal(correction.sources.filter((x) => x.kind === 'published-page').length, 1);
  // Provenance must not claim a human checked the cells.
  const v = draft.state.source.imageVerification;
  assert.equal(v.humanCellByCellVerified, false);
  assert.equal(v.cellsCompared, 150);
  // Data semantics being settled is NOT approval: an empty openQuestions list must not be read as
  // permission to write to the cloud or publish.
  assert.equal(draft.state.source.approved, false, 'the month is still a candidate, not published');
  assert.equal(draft.state.source.status, 'pending-approval');
  assert.ok(!JSON.stringify(draft.state.source).includes('待人類核准'),
    'the name is settled for this draft; it must not be re-raised as an approval gate');
});

// With Saturday 午/晚 confirmed closed, nothing in the November draft is unstated any more, so the
// poster must come out as a finished one: complete, printable, no 未公布／待確認, and no draft stamp.
// Rendered through the real pipeline with the real META, in BOTH clinic orders.
test('the shipped November draft renders a complete, stamp-free poster in both clinic orders', () => {
  const M = require('../timetable-model.js');
  const P = require('../timetable-poster.js');
  const V = require('../timetable-view.js');
  const META = new Function(`${read('calendar-meta.js')}; return TEST_DATA;`)();
  const draft = JSON.parse(read('tests/fixtures/cloud-sync-20261122/november-2026.json'));
  const state = M.validateState(draft.state, META);

  for (const top of ['jin', 'yi']) {
    const view = { template: 'calendar', format: 'dual', clinicId: 'jin', topClinicId: top };
    const screen = V.render(state, '2026-11', META, M, P, view);
    assert.equal(screen.complete, true, `${top}-top poster is incomplete: ${JSON.stringify(screen.warnings)}`);
    assert.deepEqual(screen.warnings, [], `${top}-top poster still warns`);

    const print = V.renderPrint(state, '2026-11', META, M, P, view);
    assert.equal(print.complete, true, `${top}-top print is incomplete`);
    assert.equal(print.printable, true, `${top}-top print is not printable`);
    for (const banned of ['未公布', '待確認', '本診次尚未設定', '待處理，非完整海報',
      '列印草稿：含未公布或待確認，非正式公告', '測試', '草稿']) {
      assert.ok(!print.clinics.includes(banned), `${top}-top print still renders: ${banned}`);
    }
    // The closure itself must be visible, and both clinics must be on the sheet.
    assert.ok(print.clinics.includes('休診'), `${top}-top print must show 休診 for the closed slots`);
    for (const c of META.clinics) assert.ok(print.clinics.includes(c.name), `${top}-top print missing ${c.name}`);
  }
});

// A month the device has not downloaded yet is not in the 目前編輯月份 dropdown, so the operator
// has to know to use the 雲端月份 field instead. That is not discoverable on its own.
test('the month picker tells the operator how to reach a month they do not have locally', () => {
  const markup = read('calendar-template.js');
  // The markup lives inside a JS string literal, so its quotes are backslash-escaped.
  const hint = /<small id=\\"month-hint\\">([^<]*)<\/small>/.exec(markup);
  assert.ok(hint, 'the month controls must carry a hint element');
  assert.match(hint[1], /雲端月份/);
  assert.match(hint[1], /載入雲端月份/);
  // It must sit with the month picker, not somewhere unrelated.
  const controls = markup.indexOf('month-controls');
  assert.ok(controls >= 0 && markup.indexOf('month-hint') > controls
    && markup.indexOf('month-hint') < markup.indexOf('create-source-month'),
  'the hint must sit inside the month controls, next to the picker');
});
