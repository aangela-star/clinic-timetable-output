// PR18 BLOCKER 1, proxy side. api/schedule.js is the only thing a browser can reach, and its GET
// used to forward the Apps Script 'load' action, which can insert the Schedules sheet and write
// its header row. The GET now asks for the dedicated read-only action and FAILS CLOSED: if the
// deployed backend does not serve it (or does not state that it served it), the read stops. It
// must never retry the legacy action, because that is exactly the path that can write.
//
// The last test chains the REAL proxy handler to the REAL apps-script/Code.gs running in a VM
// whose spreadsheet traps every mutation. That is an end-to-end check of repository source
// against a mock backend; the actually deployed Apps Script remains unverified.
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.CLINIC_SERVER_SECRET = 'test-only-secret-value-that-is-longer-than-32-characters';
const { createSessionToken } = require('../lib/server-session.js');
const handler = require('../api/schedule.js');
const { HEADERS, secret, schedule, createHarness } = require('./helpers/apps-script-vm.cjs');

function responseRecorder() {
  return {
    headers: {},
    statusCode: 0,
    setHeader(name, value) { this.headers[name] = value; },
    end(body) { this.body = JSON.parse(body); },
  };
}

function authedGet(month = '2026-11') {
  return {
    method: 'GET',
    headers: { cookie: `clinic_timetable_session=${encodeURIComponent(createSessionToken())}` },
    query: { month, action: 'load' },
  };
}

// Replace global fetch with a recorder for the duration of one call.
async function withUpstream(reply, fn) {
  const original = global.fetch;
  const calls = [];
  global.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    calls.push({ url: String(url), body });
    const result = await reply(body, calls.length);
    return {
      ok: result.status === undefined ? true : result.status < 400,
      status: result.status || 200,
      headers: { get: () => 'application/json' },
      text: async () => (typeof result.text === 'string' ? result.text : JSON.stringify(result.payload)),
    };
  };
  try { return await fn(calls); } finally { global.fetch = original; }
}

test('authenticated GET asks Apps Script for the read-only action, never the legacy load', async () => {
  await withUpstream(() => ({ payload: { ok: true, found: false, readOnly: true, month: '2026-11', storage: 'MONTH_MISSING' } }),
    async (calls) => {
      const res = responseRecorder();
      await handler(authedGet(), res);
      assert.equal(calls.length, 1, 'exactly one upstream request');
      assert.equal(calls[0].body.action, 'loadReadOnly');
      assert.equal(calls[0].body.month, '2026-11');
      assert.equal(calls[0].body.secret, process.env.CLINIC_SERVER_SECRET);
      assert.equal(res.statusCode, 200);
      assert.equal(res.body.found, false);
      assert.equal(res.body.readOnly, true);
    });
});

test('a client-supplied action cannot steer the proxy back onto a writable path', async () => {
  for (const action of ['load', 'save', 'publish', 'loadReadOnly', undefined]) {
    await withUpstream(() => ({ payload: { ok: true, found: false, readOnly: true, month: '2026-11' } }),
      async (calls) => {
        const req = authedGet();
        req.query.action = action;
        await handler(req, responseRecorder());
        assert.equal(calls[0].body.action, 'loadReadOnly', `client action ${action} leaked through`);
      });
  }
});

test('an Apps Script deployment without the read-only action fails closed, with no legacy retry', async () => {
  // This is verbatim what the repository Code.gs returns for an action it does not know, which is
  // what a deployment predating this change does with 'loadReadOnly'
  // (see apps_script_read_only_load.test.cjs: that refusal happens before any sheet access).
  await withUpstream(() => ({ payload: { ok: false, error: 'UNSUPPORTED_ACTION' } }), async (calls) => {
    const res = responseRecorder();
    await handler(authedGet(), res);
    assert.equal(calls.length, 1, 'the proxy must not retry with another action');
    assert.equal(res.body.ok, false);
    assert.equal(res.body.error, 'READ_ONLY_LOAD_UNSUPPORTED');
    assert.match(res.body.message, /唯讀/);
    assert.equal(res.statusCode, 502);
    assert.ok(!('data' in res.body) && !('found' in res.body), 'no schedule content may be implied');
  });
});

test('a backend that answers a read without claiming read-only is refused', async () => {
  for (const payload of [
    { ok: true, found: true, month: '2026-11', data: schedule('115/11月', 'x') },
    { ok: true, found: false, month: '2026-11', readOnly: 'yes' },
    { ok: true, found: false, month: '2026-11', readOnly: false },
  ]) {
    await withUpstream(() => ({ payload }), async (calls) => {
      const res = responseRecorder();
      await handler(authedGet(), res);
      assert.equal(calls.length, 1);
      assert.equal(res.statusCode, 502);
      assert.equal(res.body.error, 'READ_ONLY_LOAD_UNVERIFIED');
      assert.ok(!res.body.data, 'content from an unverified read must not be forwarded');
    });
  }
});

test('a genuine backend error keeps its own code and message', async () => {
  await withUpstream(() => ({ payload: { ok: false, error: 'INVALID_SHEET_HEADERS', message: '欄位不符合預期' } }),
    async () => {
      const res = responseRecorder();
      await handler(authedGet(), res);
      assert.equal(res.statusCode, 400);
      assert.equal(res.body.error, 'INVALID_SHEET_HEADERS');
      assert.equal(res.body.message, '欄位不符合預期');
    });
});

test('a found read-only payload is forwarded unchanged', async () => {
  const data = schedule('115/11月', 'november');
  await withUpstream(() => ({ payload: { ok: true, found: true, readOnly: true, month: '2026-11', schemaVersion: 1, data, updatedAt: 'stamp' } }),
    async () => {
      const res = responseRecorder();
      await handler(authedGet(), res);
      assert.equal(res.statusCode, 200);
      assert.deepEqual(res.body, { ok: true, found: true, readOnly: true, month: '2026-11', schemaVersion: 1, data, updatedAt: 'stamp' });
    });
});

test('authentication is still required before anything reaches Apps Script', async () => {
  await withUpstream(() => ({ payload: { ok: true, readOnly: true } }), async (calls) => {
    const res = responseRecorder();
    await handler({ method: 'GET', headers: {}, query: { month: '2026-11' } }, res);
    assert.equal(res.statusCode, 401);
    assert.equal(res.body.error, 'AUTH_REQUIRED');
    assert.equal(calls.length, 0);
  });
});

test('an invalid month is rejected before anything reaches Apps Script', async () => {
  await withUpstream(() => ({ payload: { ok: true, readOnly: true } }), async (calls) => {
    const res = responseRecorder();
    await handler(authedGet('nope'), res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, 'INVALID_MONTH_KEY');
    assert.equal(calls.length, 0);
  });
});

test('the save path still forwards the save action untouched', async () => {
  const data = schedule('115/11月', 'save');
  await withUpstream(() => ({ payload: { ok: true, month: '2026-11', schemaVersion: 1 } }), async (calls) => {
    const res = responseRecorder();
    await handler({
      method: 'POST',
      headers: { cookie: `clinic_timetable_session=${encodeURIComponent(createSessionToken())}` },
      body: { action: 'save', month: '2026-11', schemaVersion: 1, data },
    }, res);
    assert.equal(calls[0].body.action, 'save');
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
  });
});

// --- end-to-end: real proxy -> real Code.gs in a mutation-trapping VM -------------------------
test('proxy GET through the real Code.gs never mutates the sheet, in any sheet state', async () => {
  const data = schedule('115/11月', 'november');
  const rows = [HEADERS, ['2026-11', JSON.stringify(data), 1, '2026-11-22T00:00:00.000Z']];
  const cases = [
    ['populated, month present', rows, 'populated', '2026-11', (b) => {
      assert.equal(b.ok, true); assert.equal(b.found, true); assert.deepEqual(b.data, data);
    }],
    ['populated, month absent', rows, 'populated', '2026-12', (b) => {
      assert.equal(b.ok, true); assert.equal(b.found, false); assert.equal(b.storage, 'MONTH_MISSING');
    }],
    ['sheet missing', [], 'missing', '2026-11', (b) => {
      assert.equal(b.ok, true); assert.equal(b.found, false); assert.equal(b.storage, 'SHEET_MISSING');
    }],
    ['sheet empty', [], 'empty', '2026-11', (b) => {
      assert.equal(b.ok, true); assert.equal(b.found, false); assert.equal(b.storage, 'SHEET_EMPTY');
    }],
    ['stored payload malformed', [HEADERS, ['2026-11', '{bad', 1, 's']], 'populated', '2026-11', (b) => {
      assert.equal(b.ok, false); assert.equal(b.error, 'INVALID_STORED_DATA');
    }],
    ['headers malformed', [['a', 'b', 'c', 'd'], ['2026-11', JSON.stringify(data), 1, 's']], 'populated', '2026-11', (b) => {
      assert.equal(b.ok, false); assert.equal(b.error, 'INVALID_SHEET_HEADERS');
    }],
  ];

  for (const [label, initialRows, sheetState, month, check] of cases) {
    const backend = createHarness(initialRows, { sheetState });
    const before = JSON.stringify(backend.rows);
    await withUpstream((body) => {
      // The VM backend authenticates with its own test-only script secret, exactly as the real
      // Apps Script does; the proxy's secret is swapped in here because the two are different
      // stores. The point of this test is the read path, and the UNAUTHORIZED case is covered
      // separately in apps_script_read_only_load.test.cjs.
      const out = backend.post({ ...body, secret });
      return { payload: out, status: out.ok ? 200 : 200 };
    }, async () => {
      const res = responseRecorder();
      await handler(authedGet(month), res);
      check(res.body, label);
      assert.deepEqual(backend.record, [], `${label}: mutation attempted: ${backend.record}`);
      assert.deepEqual(backend.lockCalls, [], `${label}: script lock taken`);
      assert.equal(JSON.stringify(backend.rows), before, `${label}: sheet rows changed`);
    });
  }
});
