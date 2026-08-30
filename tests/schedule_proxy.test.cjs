const test = require('node:test');
const assert = require('node:assert/strict');

process.env.CLINIC_SERVER_SECRET = 'test-only-secret-value-that-is-longer-than-32-characters';
const { createSessionToken } = require('../lib/server-session.js');
const handler = require('../api/schedule.js');

function responseRecorder() {
  return {
    headers: {},
    statusCode: 0,
    setHeader(name, value) { this.headers[name] = value; },
    end(body) { this.body = JSON.parse(body); },
  };
}

function authenticatedRequest(overrides) {
  return {
    method: 'GET',
    headers: { cookie: `clinic_timetable_session=${encodeURIComponent(createSessionToken())}` },
    query: { month: '2026-08' },
    ...overrides,
  };
}

test('schedule proxy rejects unauthenticated load without contacting Apps Script', async () => {
  const originalFetch = global.fetch;
  let fetchCalls = 0;
  global.fetch = async () => { fetchCalls += 1; };
  try {
    const res = responseRecorder();
    await handler({ method: 'GET', headers: {}, query: { month: '2026-08' } }, res);
    assert.equal(res.statusCode, 401);
    assert.equal(res.body.error, 'AUTH_REQUIRED');
    assert.equal(fetchCalls, 0);
  } finally {
    global.fetch = originalFetch;
  }
});

test('authenticated load forwards month and server-only secret to Apps Script', async () => {
  const originalFetch = global.fetch;
  let forwarded;
  global.fetch = async (_url, options) => {
    forwarded = JSON.parse(options.body);
    return {
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      text: async () => JSON.stringify({ ok: true, found: false, month: '2026-08' }),
    };
  };
  try {
    const res = responseRecorder();
    await handler(authenticatedRequest(), res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(forwarded, {
      action: 'load',
      month: '2026-08',
      secret: process.env.CLINIC_SERVER_SECRET,
    });
    assert.equal(res.body.found, false);
  } finally {
    global.fetch = originalFetch;
  }
});

test('authenticated save forwards schedule data and returns Apps Script result', async () => {
  const originalFetch = global.fetch;
  const data = { title: '115/8月', note: '', clinics: [{}] };
  let forwarded;
  global.fetch = async (_url, options) => {
    forwarded = JSON.parse(options.body);
    return {
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      text: async () => JSON.stringify({ ok: true, month: '2026-08', schemaVersion: 1 }),
    };
  };
  try {
    const res = responseRecorder();
    await handler(authenticatedRequest({
      method: 'POST',
      body: { action: 'save', month: '2026-08', schemaVersion: 1, data },
    }), res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(forwarded, {
      action: 'save',
      month: '2026-08',
      schemaVersion: 1,
      data,
      secret: process.env.CLINIC_SERVER_SECRET,
    });
    assert.equal(res.body.ok, true);
  } finally {
    global.fetch = originalFetch;
  }
});
