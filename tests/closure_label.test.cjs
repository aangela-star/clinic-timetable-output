// Formal schema distinction between an explicit clinic-rest label (診所休息) and an ordinary
// single-session cancellation (停診).
//
// SCOPE, stated honestly: this is a narrowly validated OPTIONAL LABEL on an existing `cancel`
// event. It is NOT an all-doctor clinic-closure feature. A `cancel` event removes exactly one
// baseline doctor from one clinic/date/slot; the label only changes the words printed for that
// cancellation. A slot with two baseline doctors, one cancelled with the label, still prints the
// other doctor — see the final test, which pins that limit rather than hiding it.
//
// December 2026 is the motivating case: 晉安 12/4 晚診 is a grey X (ordinary 停診) while
// 晉安/毅安 12/25 晚診 and 12/31 晚診 print (診所休息) on the source sheet. Today both encode as
// `cancel`, and because groupCell keys on [originalDoctorId,type,doctorId] the 晉安 Friday-eve
// pair even merges into one printed line. These tests fail before the change and pass after it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const M = require('../timetable-model.js');
const P = require('../timetable-poster.js');
const V = require('../timetable-view.js');
const D = require('../calendar-draft.js');
const L = require('../calendar-layout.js');
const { startEditor, DRAFT_KEY } = require('./helpers/calendar-editor-vm.cjs');

const META = new Function(`${fs.readFileSync(path.join(root, 'calendar-meta.js'), 'utf8')}; return TEST_DATA;`)();
const MONTH = '2026-12';
const LABEL = '診所休息';

// The seed baseline already matches the December source sheet for the cells under test:
// 晉安 週五 晚診 = 莊逸玫, 晉安 週四 晚診 = 王文達.
function december() {
  return M.init({ ...META, month: MONTH });
}

const cancelEvent = (over = {}) => ({
  id: 'e-cancel',
  date: '2026-12-04',
  clinicId: 'jin',
  slot: 'eve',
  type: 'cancel',
  originalDoctorId: 'zhuang-yimei',
  doctorId: null,
  ...over,
});

// jin 週五 晚診: 12/4 ordinary X, 12/25 explicit clinic rest. Same original doctor, same type,
// same (null) replacement -- the exact pair that merges today.
function jinFridayEve() {
  let s = december();
  s = M.putEvent(s, MONTH, cancelEvent({ id: 'jin-12-04-x' }), META);
  s = M.putEvent(s, MONTH, cancelEvent({ id: 'jin-12-25-rest', date: '2026-12-25', cancelLabel: LABEL }), META);
  return s;
}

function textsOf(layout) {
  return layout.commands.filter((c) => c.type === 'text').map((c) => c.text);
}

test('the allowlist is published by the model and holds exactly the printed clinic-rest words', () => {
  assert.ok(Array.isArray(M.CANCEL_LABELS), 'model must publish the allowlist');
  assert.deepEqual(M.CANCEL_LABELS, [LABEL]);
  assert.ok(Object.isFrozen(M.CANCEL_LABELS), 'allowlist must not be mutable by a caller');
});

test('a cancel event accepts the clinic-rest label and rejects any other wording', () => {
  const s = december();
  assert.doesNotThrow(() => M.putEvent(s, MONTH, cancelEvent({ cancelLabel: LABEL }), META));
  assert.doesNotThrow(() => M.putEvent(s, MONTH, cancelEvent({ cancelLabel: null }), META));
  assert.doesNotThrow(() => M.putEvent(s, MONTH, cancelEvent(), META), 'absent stays legal');

  for (const bad of ['休診', '診所休息 ', '（診所休息）', '(診所休息)', '全院休息', '', 'closure', 1, true, {}, []]) {
    assert.throws(
      () => M.putEvent(s, MONTH, cancelEvent({ cancelLabel: bad }), META),
      (e) => e.code === 'INVALID_CANCEL_LABEL',
      `must reject ${JSON.stringify(bad)}`,
    );
  }
});

test('the label is refused on substitute and add events', () => {
  const s = december();
  assert.throws(
    () => M.putEvent(s, MONTH, { id: 'sub', date: '2026-12-25', clinicId: 'jin', slot: 'eve', type: 'substitute', originalDoctorId: 'zhuang-yimei', doctorId: 'wang-wenda', cancelLabel: LABEL }, META),
    (e) => e.code === 'CANCEL_LABEL_NOT_ALLOWED',
  );
  assert.throws(
    () => M.putEvent(s, MONTH, { id: 'add', date: '2026-12-25', clinicId: 'jin', slot: 'eve', type: 'add', originalDoctorId: null, doctorId: 'wang-wenda', cancelLabel: LABEL }, META),
    (e) => e.code === 'CANCEL_LABEL_NOT_ALLOWED',
  );
  // An explicit null is the "no label" encoding and must stay legal on every type.
  assert.doesNotThrow(() => M.putEvent(s, MONTH, { id: 'sub', date: '2026-12-25', clinicId: 'jin', slot: 'eve', type: 'substitute', originalDoctorId: 'zhuang-yimei', doctorId: 'wang-wenda', cancelLabel: null }, META));
});

test('validateState accepts a labelled month and rejects a tampered label', () => {
  const s = jinFridayEve();
  assert.doesNotThrow(() => M.validateState(s, META));
  const tampered = structuredClone(s);
  tampered.months[MONTH].events.find((e) => e.id === 'jin-12-25-rest').cancelLabel = '隨意字樣';
  assert.throws(() => M.validateState(tampered, META), (e) => e.code === 'INVALID_CANCEL_LABEL');
});

test('resolveDay keeps cancel semantics and carries the label through', () => {
  const s = jinFridayEve();
  const rest = M.resolveDay(s, META, 'jin', '2026-12-25', 'eve');
  const plain = M.resolveDay(s, META, 'jin', '2026-12-04', 'eve');

  for (const r of [rest, plain]) {
    assert.equal(r.status, 'cancel', 'status stays cancel -- no new resolved status is introduced');
    assert.deepEqual(r.doctors, [], 'a cancellation still leaves no doctor');
    assert.equal(r.issues.length, 0);
  }
  assert.equal(rest.changes[0].cancelLabel, LABEL);
  assert.ok(!plain.changes[0].cancelLabel, 'the X cell carries no label');
});

test('groupCell separates the clinic-rest cell from the ordinary X cell on the same weekday', () => {
  const s = jinFridayEve();
  const g = M.groupCell(s, MONTH, 'jin', 4, 'eve', META);

  assert.equal(g.groups.length, 2, '12/4 X and 12/25 clinic rest must not merge into one line');
  assert.equal(g.issues.length, 0);
  assert.equal(g.complete, true, 'two groups is still a complete, printable cell');

  const [first, second] = g.groups;
  assert.deepEqual(first.dates, ['2026-12-04']);
  assert.ok(!first.cancelLabel, 'the X group stays unlabelled');
  assert.deepEqual(second.dates, ['2026-12-25']);
  assert.equal(second.cancelLabel, LABEL);
});

test('two unlabelled cancellations still merge, so legacy grouping is unchanged', () => {
  let s = december();
  s = M.putEvent(s, MONTH, cancelEvent({ id: 'a', date: '2026-12-04' }), META);
  s = M.putEvent(s, MONTH, cancelEvent({ id: 'b', date: '2026-12-11' }), META);
  const g = M.groupCell(s, MONTH, 'jin', 4, 'eve', META);
  assert.equal(g.groups.length, 1);
  assert.deepEqual(g.groups[0].dates, ['2026-12-04', '2026-12-11']);
});

test('two labelled cancellations of the same doctor merge into one clinic-rest line', () => {
  let s = december();
  s = M.putEvent(s, MONTH, cancelEvent({ id: 'a', date: '2026-12-11', cancelLabel: LABEL }), META);
  s = M.putEvent(s, MONTH, cancelEvent({ id: 'b', date: '2026-12-25', cancelLabel: LABEL }), META);
  const g = M.groupCell(s, MONTH, 'jin', 4, 'eve', META);
  assert.equal(g.groups.length, 1);
  assert.deepEqual(g.groups[0].dates, ['2026-12-11', '2026-12-25']);
  assert.equal(g.groups[0].cancelLabel, LABEL);
});

test('the poster prints 診所休息 for the labelled date and 停診 for the X date', () => {
  const layout = L.make(jinFridayEve(), MONTH, META, M);
  const texts = textsOf(layout);

  assert.ok(texts.includes(LABEL), 'the clinic-rest words must reach the drawn output');
  assert.ok(texts.includes('停診'), 'the ordinary X must still print 停診');
  assert.ok(texts.includes('4 '), '12/4 prints on its own line');
  assert.ok(texts.includes('25 '), '12/25 prints on its own line');
  assert.ok(!texts.includes('4、25 '), 'the two dates must no longer share a merged line');
  assert.equal(layout.fatal, false);
  // The seed baseline leaves both clinics' Saturday rotations unannounced, which warns on its own.
  // What matters here is that the label itself adds nothing: the SAME two events, with the label
  // and without it, must produce the identical warning list.
  let unlabelled = december();
  unlabelled = M.putEvent(unlabelled, MONTH, cancelEvent({ id: 'jin-12-04-x' }), META);
  unlabelled = M.putEvent(unlabelled, MONTH, cancelEvent({ id: 'jin-12-25-rest', date: '2026-12-25' }), META);
  assert.deepEqual(layout.warnings, L.make(unlabelled, MONTH, META, M).warnings,
    'the clinic-rest label must not introduce a layout warning');
  assert.ok(!layout.warnings.some((w) => w.includes('週五')), 'the labelled Friday-eve cell warns about nothing');

  const svg = L.svg(layout);
  assert.ok(svg.includes(LABEL));
  assert.ok(svg.includes('停診'));
});

test('the clinic-rest line fits the cell for this month, and a long one still fails closed', () => {
  // 328.0px is the worst case for DECEMBER (at most two dates share a group), not in general.
  const width = L.measure('4、25 ', 42, true).width + L.measure(LABEL, 50, true).width;
  assert.ok(width < 510 - 24, `December's worst clinic-rest line ${width}px must fit 486px`);

  // 診所休息 is wider than 停診, so enough dates in one labelled group overflow the cell. That must
  // trip the existing generic guard -- data kept, printing blocked -- not silently truncate.
  let many = december();
  for (const day of ['04', '11', '18', '25']) {
    many = M.putEvent(many, MONTH, cancelEvent({ id: `rest-${day}`, date: `2026-12-${day}`, cancelLabel: LABEL }), META);
  }
  const overflowGroups = M.groupCell(many, MONTH, 'jin', 4, 'eve', META);
  assert.equal(overflowGroups.groups.length, 1, 'four labelled dates share one group');
  const longLine = L.measure('4、11、18、25 ', 42, true).width + L.measure(LABEL, 50, true).width;
  assert.ok(longLine > 510 - 24, `a four-date clinic-rest line is ${longLine}px and must overflow 486px`);
  const overflow = L.make(many, MONTH, META, M);
  assert.equal(overflow.fatal, true, 'an overflowing clinic-rest line must block printing');
  assert.ok(overflow.warnings.some((w) => w.includes('版面容量')), overflow.warnings.join(' | '));
  const g = M.groupCell(jinFridayEve(), MONTH, 'jin', 4, 'eve', META);
  const cell = L.make(jinFridayEve(), MONTH, META, M)
    .cellBounds.find((c) => c.clinicId === 'jin' && c.day === 4 && c.slot === 'eve');
  assert.equal(g.groups.length, 2);
  assert.equal(cell.complete, true);
  assert.equal(cell.fatal, false);
});

test('a Saturday rotation cancellation prints the label instead of falling through to 無醫師', () => {
  let s = december();
  s = M.setRotation(s, MONTH, { clinicId: 'jin', date: '2026-12-05', slot: 'am', status: 'scheduled', doctorIds: ['liu-jinwei'] }, META);
  s = M.setRotation(s, MONTH, { clinicId: 'jin', date: '2026-12-12', slot: 'am', status: 'scheduled', doctorIds: ['liu-jinwei'] }, META);
  s = M.setRotation(s, MONTH, { clinicId: 'jin', date: '2026-12-19', slot: 'am', status: 'scheduled', doctorIds: ['liu-jinwei'] }, META);
  s = M.setRotation(s, MONTH, { clinicId: 'jin', date: '2026-12-26', slot: 'am', status: 'scheduled', doctorIds: ['liu-jinwei'] }, META);
  s = M.putEvent(s, MONTH, { id: 'sat-rest', date: '2026-12-05', clinicId: 'jin', slot: 'am', type: 'cancel', originalDoctorId: 'liu-jinwei', doctorId: null, cancelLabel: LABEL }, META);
  s = M.putEvent(s, MONTH, { id: 'sat-x', date: '2026-12-12', clinicId: 'jin', slot: 'am', type: 'cancel', originalDoctorId: 'liu-jinwei', doctorId: null }, META);

  const texts = textsOf(L.make(s, MONTH, META, M));
  assert.ok(texts.includes(LABEL), 'the labelled Saturday must print the clinic-rest words');
  assert.ok(texts.includes('停診'), 'the unlabelled Saturday must still print 停診');
  assert.ok(!texts.includes('無醫師'), 'a cancellation must never degrade to 無醫師');
});

// ---------------------------------------------------------------------------------------------
// A Saturday rotation cell prints ONE line per date, so it has no group structure to carry a
// second wording. Two ways a labelled cancellation can therefore fail to reach the poster, both
// reachable with fully valid data that validateState accepts and that raises no SLOT_CONFLICT:
//
//   A. two cancellations on the SAME date with different original doctors, only one labelled --
//      the date resolves to cancel/no-doctor and a single neutral word has to stand for both;
//   B. a labelled cancellation that removes only ONE of the date's doctors -- the date still
//      prints the remaining doctor's name, and the words have nowhere to go at all.
//
// Printing 停診 (A) or just the doctor's name (B) understates an explicit 診所休息 silently, on a
// poster that still reports complete/printable. These must fail closed instead.
// ---------------------------------------------------------------------------------------------
function saturdayRotation(doctorIds) {
  let s = december();
  for (const date of M.saturdayDates(MONTH)) {
    s = M.setRotation(s, MONTH, { clinicId: 'jin', date, slot: 'am', status: 'scheduled', doctorIds }, META);
  }
  return s;
}
const satCancel = (over) => ({ date: '2026-12-05', clinicId: 'jin', slot: 'am', type: 'cancel', doctorId: null, ...over });

function saturdayCell(layout) {
  return layout.cellBounds.find((c) => c.clinicId === 'jin' && c.day === 5 && c.slot === 'am');
}

test('BLOCKER: disagreeing cancellation wording on ONE Saturday date fails closed', () => {
  let s = saturdayRotation(['liu-jinwei', 'wang-wenda']);
  s = M.putEvent(s, MONTH, satCancel({ id: 'rest', originalDoctorId: 'liu-jinwei', cancelLabel: LABEL }), META);
  s = M.putEvent(s, MONTH, satCancel({ id: 'plain', originalDoctorId: 'wang-wenda' }), META);
  assert.doesNotThrow(() => M.validateState(s, META), 'the state under test must be fully valid');
  const r = M.resolveDay(s, META, 'jin', '2026-12-05', 'am');
  assert.equal(r.status, 'cancel');
  assert.equal(r.doctors.length, 0);
  assert.equal(r.issues.length, 0, 'the model raises no issue -- only the renderer can catch this');

  const layout = L.make(s, MONTH, META, M);
  const texts = textsOf(layout);
  assert.ok(!texts.includes('停診'),
    'the neutral 停診 must NOT be printed in place of an explicit 診所休息');
  assert.ok(texts.includes('異動待處理'), 'the date must be marked for handling instead');
  assert.equal(layout.fatal, true, 'an unrenderable label must block printing, not pass as complete');
  assert.equal(saturdayCell(layout).complete, false);
  assert.equal(saturdayCell(layout).fatal, true);
  assert.ok(layout.warnings.some((w) => w.includes('2026-12-05') && w.includes(LABEL)),
    `a warning must name the date and the wording: ${layout.warnings.join(' | ')}`);

  // Both outputs that leave the page must refuse.
  for (const view of [{ template: 'calendar', format: 'dual', clinicId: 'jin', topClinicId: 'jin' },
                      { template: 'calendar', format: 'a4', clinicId: 'jin', topClinicId: 'jin' }]) {
    assert.equal(V.render(s, MONTH, META, M, P, view, { stampDraft: true }).printable, false);
    assert.equal(V.renderPrint(s, MONTH, META, M, P, view).printable, false);
  }
});

test('BLOCKER: a labelled Saturday cancellation that leaves a doctor on duty fails closed', () => {
  let s = saturdayRotation(['liu-jinwei', 'wang-wenda']);
  s = M.putEvent(s, MONTH, satCancel({ id: 'rest', originalDoctorId: 'liu-jinwei', cancelLabel: LABEL }), META);
  assert.doesNotThrow(() => M.validateState(s, META));
  const r = M.resolveDay(s, META, 'jin', '2026-12-05', 'am');
  assert.deepEqual(r.doctors.map((d) => d.id), ['wang-wenda'], 'a doctor genuinely remains on duty');

  const layout = L.make(s, MONTH, META, M);
  const texts = textsOf(layout);
  assert.ok(texts.includes('異動待處理'), 'the date must be marked for handling');
  assert.ok(!texts.includes('異動'), 'the bare 異動 marker must not stand in for the dropped wording');
  assert.equal(layout.fatal, true);
  assert.ok(layout.warnings.some((w) => w.includes('2026-12-05') && w.includes(LABEL)),
    layout.warnings.join(' | '));
});

test('agreeing clinic-rest wording on one Saturday date still prints faithfully', () => {
  let s = saturdayRotation(['liu-jinwei', 'wang-wenda']);
  s = M.putEvent(s, MONTH, satCancel({ id: 'a', originalDoctorId: 'liu-jinwei', cancelLabel: LABEL }), META);
  s = M.putEvent(s, MONTH, satCancel({ id: 'b', originalDoctorId: 'wang-wenda', cancelLabel: LABEL }), META);

  const layout = L.make(s, MONTH, META, M);
  const texts = textsOf(layout);
  assert.ok(texts.includes(LABEL), 'one agreed wording for the whole date is renderable');
  assert.ok(!texts.includes('異動待處理'), 'and must not be treated as a problem');
  assert.equal(saturdayCell(layout).fatal, false);
  // 毅安's own Saturday rotation is unannounced in the seed and warns independently, so scope this
  // to the clinic under test.
  assert.ok(!layout.warnings.some((w) => w.startsWith('晉安') && w.includes('2026-12-05')),
    layout.warnings.join(' | '));
});

test('unlabelled Saturday cancellations behave exactly as they did before the label existed', () => {
  let s = saturdayRotation(['liu-jinwei', 'wang-wenda']);
  s = M.putEvent(s, MONTH, satCancel({ id: 'a', originalDoctorId: 'liu-jinwei' }), META);
  s = M.putEvent(s, MONTH, satCancel({ id: 'b', originalDoctorId: 'wang-wenda' }), META);
  const both = L.make(s, MONTH, META, M);
  assert.ok(textsOf(both).includes('停診'), 'two ordinary cancellations still print 停診');
  assert.equal(saturdayCell(both).fatal, false, 'and must not be made fatal by the new guard');

  // One ordinary cancellation leaving a doctor on duty keeps the old 異動 marker.
  let one = saturdayRotation(['liu-jinwei', 'wang-wenda']);
  one = M.putEvent(one, MONTH, satCancel({ id: 'a', originalDoctorId: 'liu-jinwei' }), META);
  const layout = L.make(one, MONTH, META, M);
  assert.ok(textsOf(layout).includes('異動'), 'the unlabelled partial cancellation still reads 異動');
  assert.equal(saturdayCell(layout).fatal, false);
});

test('the saved November envelope still validates and renders with no label anywhere', () => {
  const nov = JSON.parse(fs.readFileSync(path.join(root, 'tests/fixtures/cloud-sync-20261122/november-2026.json'), 'utf8'));
  const s = M.validateState(nov.state, META);
  const month = nov.currentMonth;

  for (const e of s.months[month].events) {
    assert.ok(!Object.hasOwn(e, 'cancelLabel'), 'the field must not be injected into saved data');
  }
  const r = P.render(s, month, META, M);
  assert.ok(!r.clinics.includes(LABEL), 'an unlabelled month prints no clinic-rest words');
  assert.ok(r.clinics.includes('停診'), 'November cancellations still print 停診');
});

test('an unlabelled December month renders byte-identically to before the field existed', () => {
  let s = december();
  s = M.putEvent(s, MONTH, cancelEvent({ id: 'x' }), META);
  const withAbsent = P.render(s, MONTH, META, M).clinics;

  let t = december();
  t = M.putEvent(t, MONTH, cancelEvent({ id: 'x', cancelLabel: null }), META);
  const withNull = P.render(t, MONTH, META, M).clinics;

  assert.equal(withNull, withAbsent, 'null and absent must be the same printed output');
});

test('the draft and cloud envelope round-trip the label without widening other events', () => {
  const s = jinFridayEve();
  // The export/import payload shape used by both the JSON backup and the cloud envelope.
  const payload = JSON.parse(JSON.stringify({ state: s, currentMonth: MONTH, view: { template: 'calendar', format: 'dual', clinicId: 'jin', topClinicId: 'jin' } }));
  const back = M.validateState(payload.state, META);
  const events = back.months[MONTH].events;

  assert.equal(events.find((e) => e.id === 'jin-12-25-rest').cancelLabel, LABEL);
  assert.ok(!Object.hasOwn(events.find((e) => e.id === 'jin-12-04-x'), 'cancelLabel'),
    'an ordinary cancellation must not gain a null field in the saved payload');

  const envelope = { title: MONTH, note: '月曆版；儲存不等於發布', clinics: META.clinics, calendarVersion: 1, calendar: payload };
  const reread = M.validateState(JSON.parse(JSON.stringify(envelope)).calendar.state, META);
  assert.equal(reread.months[MONTH].events.find((e) => e.id === 'jin-12-25-rest').cancelLabel, LABEL);
});

test('applyBatch carries the label from a collected UI batch into validated state', () => {
  const s = december();
  const next = D.applyBatch(s, MONTH, META, M, {
    event: cancelEvent({ id: 'batched', date: '2026-12-25', cancelLabel: LABEL }),
  });
  assert.equal(next.months[MONTH].events[0].cancelLabel, LABEL);
  const cleared = D.applyBatch(next, MONTH, META, M, {
    event: cancelEvent({ id: 'batched', date: '2026-12-25' }),
  });
  assert.ok(!Object.hasOwn(cleared.months[MONTH].events[0], 'cancelLabel'),
    're-saving without a label must remove the field, not keep a stale one');
});

// ---------------------------------------------------------------------------------------------
// Real editor, run inside the VM harness: the operator-facing path.
// ---------------------------------------------------------------------------------------------

function decemberDraft() {
  let s = december();
  s = M.putEvent(s, MONTH, cancelEvent({ id: 'jin-12-04-x' }), META);
  return JSON.stringify({ state: s, currentMonth: MONTH, view: { template: 'calendar', format: 'dual', clinicId: 'jin', topClinicId: 'jin' } });
}

const readDraft = (app) => JSON.parse(app.storage.get(DRAFT_KEY));

test('the editor offers the clinic-rest label only for a cancellation', () => {
  const app = startEditor({ draft: decemberDraft() });
  try {
    const select = app.el('cancel-label');
    assert.deepEqual(select.options.map((o) => o.value), ['', LABEL],
      'exactly one extra wording is offered, plus ordinary 停診');

    app.set('type', 'cancel');
    assert.equal(select.disabled, false, 'enabled for a cancellation');

    app.set('type', 'substitute');
    assert.equal(select.disabled, true, 'disabled for a substitution');
    assert.equal(select.value, '', 'and cleared, so a stale label cannot be submitted');
  } finally { app.destroy(); }
});

test('the editor saves, lists, renders, retains and removes the clinic-rest label', () => {
  const app = startEditor({ draft: decemberDraft() });
  try {
    app.set('clinic', 'jin');
    app.set('date', '2026-12-25');
    app.set('slot', 'eve');
    app.set('type', 'cancel');
    app.set('original', 'zhuang-yimei');
    app.set('cancel-label', LABEL);
    app.el('event-form').dispatch('submit');

    const saved = readDraft(app).state.months[MONTH].events;
    const rest = saved.find((e) => e.date === '2026-12-25');
    assert.equal(rest.cancelLabel, LABEL, 'the label reaches the local draft');
    assert.ok(!Object.hasOwn(saved.find((e) => e.date === '2026-12-04'), 'cancelLabel'));

    // The operator-visible event list must distinguish the two.
    const list = app.text('event-list');
    assert.ok(list.includes(LABEL), 'the event list names the clinic-rest label');
    assert.ok(list.includes('停診'), 'the ordinary cancellation still reads 停診');

    // And so must the preview the operator approves.
    const svg = app.el('clinics').innerHTML;
    assert.ok(svg.includes(LABEL));
    assert.ok(svg.includes('停診'));
    assert.ok(!svg.includes('4、25'), 'the two Friday-eve dates are no longer merged');

    // Retention: re-opening the saved event must show the label it was saved with.
    const row = app.el('event-list').children.find((li) => li.textContent.includes(LABEL));
    row.children.find((c) => c.textContent === '編輯').click();
    assert.equal(app.el('cancel-label').value, LABEL, 'editing an event restores its label');
    assert.equal(app.el('cancel-label').disabled, false);

    // Removal: clearing the select and re-saving drops the field.
    app.set('cancel-label', '');
    app.el('event-form').dispatch('submit');
    const after = readDraft(app).state.months[MONTH].events.find((e) => e.date === '2026-12-25');
    assert.ok(!Object.hasOwn(after, 'cancelLabel'), 'clearing the label removes it');
    assert.ok(!app.el('clinics').innerHTML.includes(LABEL), 'and the preview reverts to 停診');
    assert.ok(app.el('clinics').innerHTML.includes('4、25'), 'the dates merge again once both are ordinary');
  } finally { app.destroy(); }
});

test('cancelling the event form clears a half-entered label', () => {
  const app = startEditor({ draft: decemberDraft() });
  try {
    app.set('type', 'cancel');
    app.set('cancel-label', LABEL);
    app.click('reset');
    assert.equal(app.el('cancel-label').value, '', 'the abandoned label must not survive the reset');
  } finally { app.destroy(); }
});

test('the editor exports and re-imports the label through the real backup path', async () => {
  const app = startEditor({ draft: decemberDraft() });
  try {
    app.set('clinic', 'jin');
    app.set('date', '2026-12-25');
    app.set('slot', 'eve');
    app.set('type', 'cancel');
    app.set('original', 'zhuang-yimei');
    app.set('cancel-label', LABEL);
    app.el('event-form').dispatch('submit');

    app.click('export-draft');
    assert.match(app.text('status'), /已下載本機草稿備份/, 'the export must succeed, not report an error');
    const exported = JSON.parse(app.blobs[app.blobs.length - 1].text);
    assert.equal(exported.state.months[MONTH].events.find((e) => e.date === '2026-12-25').cancelLabel, LABEL);
  } finally { app.destroy(); }

  // A fresh editor imports that same file and must end up with the label, rendered.
  const fresh = startEditor({});
  try {
    let s = december();
    s = M.putEvent(s, MONTH, cancelEvent({ id: 'jin-12-04-x' }), META);
    s = M.putEvent(s, MONTH, cancelEvent({ id: 'jin-12-25-rest', date: '2026-12-25', cancelLabel: LABEL }), META);
    const file = JSON.stringify({ state: s, currentMonth: MONTH, view: { template: 'calendar', format: 'dual', clinicId: 'jin', topClinicId: 'jin' } });

    fresh.el('import-draft').files = [{ text: async () => file }];
    fresh.el('import-draft').dispatch('change');
    await fresh.settle();

    assert.match(fresh.text('status'), /已匯入有效本機備份/);
    assert.equal(readDraft(fresh).state.months[MONTH].events.find((e) => e.date === '2026-12-25').cancelLabel, LABEL);
    assert.ok(fresh.el('clinics').innerHTML.includes(LABEL), 'the imported label renders immediately');
  } finally { fresh.destroy(); }
});

test('a refused label is reported to the operator in words, not as a bare error code', () => {
  const source = fs.readFileSync(path.join(root, 'calendar-editor.js'), 'utf8');
  // fail() sets message to the bare code, so an unmapped code surfaces as "INVALID_CANCEL_LABEL".
  for (const code of ['INVALID_CANCEL_LABEL', 'CANCEL_LABEL_NOT_ALLOWED']) {
    assert.match(source, new RegExp(`${code}:'[^']+'`), `${code} needs an operator-facing message`);
  }
});

test('an imported backup carrying an invented label is refused and nothing is overwritten', async () => {
  const app = startEditor({ draft: decemberDraft() });
  try {
    const before = app.storage.get(DRAFT_KEY);
    let s = december();
    s = M.putEvent(s, MONTH, cancelEvent({ id: 'bad' }), META);
    const tampered = JSON.parse(JSON.stringify({ state: s, currentMonth: MONTH, view: { template: 'calendar', format: 'dual', clinicId: 'jin', topClinicId: 'jin' } }));
    tampered.state.months[MONTH].events[0].cancelLabel = '本院今日全面停止服務';

    app.el('import-draft').files = [{ text: async () => JSON.stringify(tampered) }];
    app.el('import-draft').dispatch('change');
    await app.settle();

    assert.equal(app.storage.get(DRAFT_KEY), before, 'the existing draft must be left untouched');
    assert.ok(!app.text('status').includes('已匯入'), 'and the import must not report success');
  } finally { app.destroy(); }
});

test('the cloud save envelope carries the label and a cloud load restores it', async () => {
  const app = startEditor({ draft: decemberDraft(), cloudUrl: 'http://127.0.0.1:0/api/schedule' });
  try {
    // Let the automatic startup read finish first; a cloud action is refused while it is in flight.
    await app.settle();
    app.reply(app.requests[0], { json: { ok: true, found: false } });
    await app.settle();

    app.set('clinic', 'jin');
    app.set('date', '2026-12-25');
    app.set('slot', 'eve');
    app.set('type', 'cancel');
    app.set('original', 'zhuang-yimei');
    app.set('cancel-label', LABEL);
    app.el('event-form').dispatch('submit');

    app.click('cloud-save');
    await app.settle();
    // The pre-save read-only check, then the POST.
    const read = app.requests.find((r) => r.url.includes('loadReadOnly') && !r.settled);
    app.reply(read, { json: { ok: true, found: false } });
    await app.settle();

    const post = app.requests.find((r) => r.init && r.init.method === 'POST');
    assert.ok(post, 'a cloud save must have been attempted');
    const body = JSON.parse(post.init.body);
    assert.equal(body.data.calendarVersion, 1, 'the envelope shape is unchanged');
    assert.equal(body.data.calendar.state.months[MONTH].events.find((e) => e.date === '2026-12-25').cancelLabel, LABEL);
  } finally { app.destroy(); }
});

// ---------------------------------------------------------------------------------------------
// The honest limit of this change.
// ---------------------------------------------------------------------------------------------

test('the label is per-cancellation, not a whole-cell closure: a second doctor still prints', () => {
  let s = december();
  s = M.setCell(s, MONTH, 'jin', 4, 'eve', { status: 'scheduled', doctorIds: ['zhuang-yimei', 'wang-wenda'] }, META);
  s = M.putEvent(s, MONTH, cancelEvent({ id: 'one-of-two', date: '2026-12-25', cancelLabel: LABEL }), META);

  const r = M.resolveDay(s, META, 'jin', '2026-12-25', 'eve');
  assert.deepEqual(r.doctors.map((d) => d.id), ['wang-wenda'],
    'cancelling one doctor with the clinic-rest label does NOT close the session');

  const texts = textsOf(L.make(s, MONTH, META, M));
  assert.ok(texts.includes(LABEL));
  assert.ok(texts.includes('王文達'), 'the remaining doctor is still printed -- this is a known limit');
});
