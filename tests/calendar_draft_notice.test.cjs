// PR18 review finding P5. 下載高清 PNG uses V.render(), which leaves the reserved draft-notice
// slot blank; only renderPrint() filled it. So an incomplete month exported as a clean-looking
// 2160x3840 PNG with no global "not official" marking, while the same month printed with one.
// Individual cells still said 未公布, but the distributable artifact lost the whole-sheet stamp.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const M = require('../timetable-model.js');
const P = require('../timetable-poster.js');
const V = require('../timetable-view.js');

const repoRoot = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(repoRoot, p), 'utf8');
const META = new Function(`${read('calendar-meta.js')}; return TEST_DATA;`)();
const view = { template: 'calendar', format: 'dual', clinicId: 'jin', topClinicId: 'jin' };
const IMAGE_NOTICE = '草稿：含未公布或待確認，非正式公告';
const PRINT_NOTICE = '列印草稿：含未公布或待確認，非正式公告';

// A seeded month leaves Saturday rotations unannounced, so it is genuinely incomplete.
const incomplete = () => M.createSourceMonth(M.init(META), '2026-11', META);
// The shipped November candidate is complete: every slot is stated.
const complete = () => M.validateState(
  JSON.parse(read('tests/fixtures/cloud-sync-20261122/november-2026.json')).state, META);

test('an incomplete month rendered for an image carries the non-official stamp', () => {
  const r = V.render(incomplete(), '2026-11', META, M, P, view, { stampDraft: true });
  assert.equal(r.complete, false);
  assert.ok(r.clinics.includes(IMAGE_NOTICE),
    'an incomplete month exported as an image must be marked as a draft');
  // Both clinics are on the sheet, so both get the stamp.
  assert.equal(r.clinics.split(IMAGE_NOTICE).length - 1, META.clinics.length);
});

test('a complete month is never stamped, even when a stamp is requested', () => {
  const r = V.render(complete(), '2026-11', META, M, P, view, { stampDraft: true });
  assert.equal(r.complete, true);
  for (const banned of [IMAGE_NOTICE, PRINT_NOTICE, '草稿', '測試']) {
    assert.ok(!r.clinics.includes(banned), `a finished poster must not render: ${banned}`);
  }
});

test('the on-screen preview render is unchanged: no stamp unless one is asked for', () => {
  const plain = V.render(incomplete(), '2026-11', META, M, P, view);
  assert.ok(!plain.clinics.includes(IMAGE_NOTICE));
  assert.ok(!plain.clinics.includes(PRINT_NOTICE));
  // The draft-notice slot stays present and blank, as before.
  const slot = plain.layout.commands.filter((c) => c.role === 'draft-notice');
  assert.equal(slot.length, META.clinics.length);
  for (const c of slot) assert.equal(c.text, '');
});

test('the print stamp keeps its own wording and position', () => {
  const r = V.renderPrint(incomplete(), '2026-11', META, M, P, view);
  assert.ok(r.clinics.includes(PRINT_NOTICE));
  const stamped = r.layout.commands.filter((c) => c.role === 'draft-notice');
  for (const c of stamped) {
    assert.equal(c.text, PRINT_NOTICE);
    assert.ok(c.x < 3368 && c.x > 2000, `the notice must be right-aligned inside the sheet: x=${c.x}`);
  }
});

test('a stamped image render still carries the real schedule content', () => {
  const r = V.render(incomplete(), '2026-11', META, M, P, view, { stampDraft: true });
  for (const kept of ['未公布', '早診', '週六', ...META.clinics.map((c) => c.name)]) {
    assert.ok(r.clinics.includes(kept), `stamping dropped content: ${kept}`);
  }
  assert.equal(r.printable, !r.fatal);
});

test('the PNG download asks for the stamp; the screen preview does not', () => {
  const s = read('calendar-editor.js');
  const download = s.slice(s.indexOf("$('download-png').addEventListener"));
  assert.match(download, /V\.render\([^)]*\{\.\.\.view,template:'calendar',format:'dual'\},\{stampDraft:true\}\)/,
    'the PNG export must request the incomplete-month stamp');
  const draw = s.slice(s.indexOf('function drawPoster()'), s.indexOf('function refreshAll()'));
  assert.ok(!draw.includes('stampDraft'), 'the on-screen preview must not be re-worded');
});
