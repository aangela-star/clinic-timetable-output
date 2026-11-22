// Runs the REAL calendar-editor.js (and the real model/poster/view/draft modules) inside a Node
// VM with a minimal fake DOM, a controllable clock, controllable timers and a controllable fetch.
//
// Why this exists: the PR18 review correctly objected that the startup-read tests asserted on
// source text ("textual order is not control flow"). These helpers execute the code, so a test
// can observe what the editor actually does with a slow, aborted, stale or refused response.
//
// SCOPE: this is a MOCK environment. It is not a browser and not production. Browser behaviour is
// covered separately by the isolated Chromium acceptance run; production remains unverified.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const repoRoot = path.resolve(__dirname, '..', '..');
const read = (file) => fs.readFileSync(path.join(repoRoot, file), 'utf8');

const M = require('../../timetable-model.js');
const P = require('../../timetable-poster.js');
const V = require('../../timetable-view.js');
const D = require('../../calendar-draft.js');
const ScheduleSaveLoadCore = require('../../schedule-save-load-core.js');
const TEST_DATA = new Function(`${read('calendar-meta.js')}; return TEST_DATA;`)();

const DRAFT_KEY = 'clinic-timetable.calendar-integrated-draft.v1';
const LAST_MONTH_KEY = ScheduleSaveLoadCore.LAST_SCHEDULE_MONTH_STORAGE_KEY;

class El {
  constructor(tag = 'div') {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.handlers = new Map();
    this.dataset = {};
    this.style = {};
    this.attributes = {};
    this.files = [];
    this.own = '';
    this.value = '';
    this.disabled = false;
    this.hidden = false;
    this.checked = false;
    this.className = '';
    this.innerHTML = '';
    const set = new Set();
    this.classList = {
      add: (c) => set.add(c),
      remove: (c) => set.delete(c),
      contains: (c) => set.has(c),
      toggle: (c, on) => {
        const next = on === undefined ? !set.has(c) : !!on;
        if (next) set.add(c); else set.delete(c);
        return next;
      },
    };
  }

  get textContent() { return this.own + this.children.map((c) => c.textContent || '').join(''); }

  set textContent(value) { this.own = String(value); this.children = []; }

  append(...nodes) { this.children.push(...nodes); }

  prepend(...nodes) { this.children.unshift(...nodes); }

  replaceChildren(...nodes) { this.children = [...nodes]; this.own = ''; }

  add(option) { this.children.push(option); }

  get options() { return this.children.filter((c) => c.tagName === 'OPTION'); }

  setAttribute(name, value) { this.attributes[name] = String(value); }

  getAttribute(name) { return Object.hasOwn(this.attributes, name) ? this.attributes[name] : null; }

  addEventListener(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, []);
    this.handlers.get(type).push(fn);
  }

  removeEventListener(type, fn) {
    const list = this.handlers.get(type) || [];
    const at = list.indexOf(fn);
    if (at >= 0) list.splice(at, 1);
  }

  dispatch(type, extra = {}) {
    const event = { type, target: this, bubbles: true, defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; }, ...extra };
    for (const fn of [...(this.handlers.get(type) || [])]) fn(event);
    return event;
  }

  click() { return this.dispatch('click'); }
}

// options -> { draft, lastMonth, now, preview, cloudUrl }
function startEditor(options = {}) {
  const storage = new Map();
  if (options.draft) storage.set(DRAFT_KEY, options.draft);
  if (options.lastMonth) storage.set(LAST_MONTH_KEY, options.lastMonth);

  const nowMs = Date.parse(options.now || '2026-11-22T12:00:00Z');
  class FixedDate extends Date {
    constructor(...args) { if (args.length) super(...args); else super(nowMs); }
    static now() { return nowMs; }
  }

  const byId = new Map();
  const bySelector = new Map();
  const document = {
    body: new El('body'),
    fonts: { ready: Promise.resolve() },
    getElementById(id) {
      if (!byId.has(id)) { const el = new El('div'); el.id = id; byId.set(id, el); }
      return byId.get(id);
    },
    createElement(tag) { return new El(tag); },
    createTextNode(text) { const n = new El('#text'); n.own = String(text); return n; },
    querySelector(selector) {
      if (!bySelector.has(selector)) bySelector.set(selector, new El('section'));
      return bySelector.get(selector);
    },
  };

  const windowHandlers = new Map();
  const timers = new Map();
  let timerSeq = 0;
  let uuidSeq = 0;
  const requests = [];
  const localStorage = {
    get length() { return storage.size; },
    key: (i) => [...storage.keys()][i] ?? null,
    getItem: (k) => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => { storage.set(k, String(v)); },
    removeItem: (k) => { storage.delete(k); },
  };

  const sandbox = {
    console,
    Date: FixedDate,
    localStorage,
    structuredClone,
    URL,
    AbortController,
    Option: class Option extends El {
      constructor(text, value) { super('option'); this.own = String(text); this.value = String(value); }
    },
    crypto: { randomUUID: () => `uuid-${++uuidSeq}` },
    setTimeout: (fn, ms) => { const id = ++timerSeq; timers.set(id, { fn, ms }); return id; },
    clearTimeout: (id) => { timers.delete(id); },
    document,
    TimetableModelV2: M,
    TimetablePosterV2: P,
    TimetableView: V,
    CalendarDraft: D,
    ScheduleSaveLoadCore,
    TEST_DATA,
    React: { createElement: (...a) => ({ a }) },
    ReactDOM: { createRoot: () => ({ render() {}, unmount() {} }) },
    addEventListener(type, fn) {
      if (!windowHandlers.has(type)) windowHandlers.set(type, []);
      windowHandlers.get(type).push(fn);
    },
    removeEventListener(type, fn) {
      const list = windowHandlers.get(type) || [];
      const at = list.indexOf(fn);
      if (at >= 0) list.splice(at, 1);
    },
    print() {},
    fetch(url, init = {}) {
      const entry = { url: String(url), init, signal: init.signal, settled: false };
      entry.promise = new Promise((resolve, reject) => {
        entry.resolve = resolve; entry.reject = reject;
      });
      if (init.signal) {
        init.signal.addEventListener('abort', () => {
          const error = new Error('The operation was aborted.');
          error.name = 'AbortError';
          if (!entry.settled) { entry.settled = true; entry.reject(error); }
        });
      }
      requests.push(entry);
      return entry.promise;
    },
  };

  const context = vm.createContext(sandbox);
  vm.runInContext('window=globalThis;window.localStorage=localStorage;window.Date=Date;', context);
  context.window.SCHEDULE_SAVE_LOAD_CONFIG = Object.freeze({
    webAppUrl: options.cloudUrl || 'http://127.0.0.1:0/api/schedule',
  });

  vm.runInContext(read('calendar-editor.js'), context, { filename: 'calendar-editor.js' });
  const destroy = context.window.startCalendarEditor({ preview: options.preview === true });

  const settle = async () => { for (let i = 0; i < 6; i += 1) await new Promise((r) => setImmediate(r)); };

  // A fetch reply shaped like the browser's: headers first, then an awaited body. `holdBody`
  // models a response whose headers have arrived while the body is still streaming; the returned
  // release function lets a test choose whether the abort or the body lands first.
  const reply = (entry, { status = 200, json, body, holdBody = false }) => {
    let release = () => {};
    const held = holdBody ? new Promise((r) => { release = r; }) : null;
    entry.settled = true;
    entry.resolve({
      ok: status < 400,
      status,
      json: async () => {
        if (held) await held;
        if (entry.signal && entry.signal.aborted) {
          const error = new Error('The operation was aborted.');
          error.name = 'AbortError';
          throw error;
        }
        if (typeof body === 'string') return JSON.parse(body);
        return json;
      },
    });
    return release;
  };

  return {
    context,
    requests,
    storage,
    timers,
    destroy,
    settle,
    reply,
    el: (id) => document.getElementById(id),
    text: (id) => document.getElementById(id).textContent,
    click: (id) => document.getElementById(id).click(),
    set: (id, value, type = 'change') => {
      const el = document.getElementById(id);
      el.value = value;
      return el.dispatch(type);
    },
    windowEvent: (type, extra = {}) => {
      const event = { type, defaultPrevented: false, returnValue: undefined,
        preventDefault() { this.defaultPrevented = true; }, ...extra };
      for (const fn of [...(windowHandlers.get(type) || [])]) fn(event);
      return event;
    },
    windowHandlerCount: (type) => (windowHandlers.get(type) || []).length,
    canLeave: () => context.window.calendarCanLeave && context.window.calendarCanLeave(),
    hasCanLeave: () => typeof context.window.calendarCanLeave === 'function',
    runTimers: () => { for (const [id, t] of [...timers]) { timers.delete(id); t.fn(); } },
    onlyRequest: () => requests[requests.length - 1],
  };
}

module.exports = { startEditor, DRAFT_KEY, LAST_MONTH_KEY, TEST_DATA, M, P, V };
