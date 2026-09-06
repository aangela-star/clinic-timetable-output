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

test('authenticated GET forwards explicit version read actions and blocks migration actions', async () => {
  const originalFetch = global.fetch;
  const forwardedBodies = [];
  global.fetch = async (_url, options) => {
    forwardedBodies.push(JSON.parse(options.body));
    return {
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      text: async () => JSON.stringify({ ok: true, found: false }),
    };
  };
  try {
    const latestRes = responseRecorder();
    await handler(authenticatedRequest({ query: { action: 'loadLatestForMonth', monthKey: '2026-09' } }), latestRes);
    assert.equal(latestRes.statusCode, 200);
    assert.deepEqual(forwardedBodies.pop(), {
      action: 'loadLatestForMonth',
      monthKey: '2026-09',
      secret: process.env.CLINIC_SERVER_SECRET,
    });

    const versionRes = responseRecorder();
    await handler(authenticatedRequest({ query: { action: 'loadVersion', versionId: 'sv_abc123' } }), versionRes);
    assert.equal(versionRes.statusCode, 200);
    assert.deepEqual(forwardedBodies.pop(), {
      action: 'loadVersion',
      versionId: 'sv_abc123',
      secret: process.env.CLINIC_SERVER_SECRET,
    });

    const listRes = responseRecorder();
    await handler(authenticatedRequest({ query: { action: 'listVersions', monthKey: '2026-09' } }), listRes);
    assert.equal(listRes.statusCode, 200);
    assert.deepEqual(forwardedBodies.pop(), {
      action: 'listVersions',
      monthKey: '2026-09',
      secret: process.env.CLINIC_SERVER_SECRET,
    });

    const missingMonth = responseRecorder();
    await handler(authenticatedRequest({ query: { action: 'listVersions' } }), missingMonth);
    assert.equal(missingMonth.statusCode, 400);
    assert.equal(missingMonth.body.error, 'INVALID_MONTH_KEY');

    const blocked = responseRecorder();
    await handler(authenticatedRequest({ query: { action: 'migrateLegacySchedulesToVersions', monthKey: '2026-09' } }), blocked);
    assert.equal(blocked.statusCode, 400);
    assert.equal(blocked.body.error, 'UNSUPPORTED_ACTION');
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

test('authenticated POST forwards saveVersion and setCurrentVersion allowlisted fields only', async () => {
  const originalFetch = global.fetch;
  const data = { title: '115/9月', note: '', clinics: [{ id: 'clinic-1' }, { id: 'clinic-2' }] };
  const forwardedBodies = [];
  global.fetch = async (_url, options) => {
    forwardedBodies.push(JSON.parse(options.body));
    return {
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      text: async () => JSON.stringify({ ok: true }),
    };
  };
  try {
    const saveVersionRes = responseRecorder();
    await handler(authenticatedRequest({
      method: 'POST',
      body: {
        action: 'saveVersion',
        monthKey: '2026-09',
        schemaVersion: 1,
        saveRequestId: 'req-1',
        parentVersionId: null,
        expectedLatestVersionId: 'sv_latest',
        data,
        migration: true,
      },
    }), saveVersionRes);
    assert.equal(saveVersionRes.statusCode, 200);
    assert.deepEqual(forwardedBodies.pop(), {
      action: 'saveVersion',
      monthKey: '2026-09',
      schemaVersion: 1,
      saveRequestId: 'req-1',
      parentVersionId: null,
      expectedLatestVersionId: 'sv_latest',
      data,
      secret: process.env.CLINIC_SERVER_SECRET,
    });

    const currentRes = responseRecorder();
    await handler(authenticatedRequest({
      method: 'POST',
      body: {
        action: 'setCurrentVersion',
        versionId: 'sv_next',
        expectedCurrentVersionId: null,
        data,
      },
    }), currentRes);
    assert.equal(currentRes.statusCode, 200);
    assert.deepEqual(forwardedBodies.pop(), {
      action: 'setCurrentVersion',
      versionId: 'sv_next',
      expectedCurrentVersionId: null,
      secret: process.env.CLINIC_SERVER_SECRET,
    });

    const blocked = responseRecorder();
    await handler(authenticatedRequest({ method: 'POST', body: { action: 'rollbackVersionMigration' } }), blocked);
    assert.equal(blocked.statusCode, 400);
    assert.equal(blocked.body.error, 'UNSUPPORTED_ACTION');
  } finally {
    global.fetch = originalFetch;
  }
});

test('schedule proxy rejects oversized bodies and bounded IDs before upstream call', async () => {
  const originalFetch = global.fetch;
  let fetchCalls = 0;
  global.fetch = async () => { fetchCalls += 1; };
  try {
    const longVersion = responseRecorder();
    await handler(authenticatedRequest({ query: { action: 'loadVersion', versionId: `sv_${'x'.repeat(129)}` } }), longVersion);
    assert.equal(longVersion.statusCode, 400);
    assert.equal(longVersion.body.error, 'INVALID_VERSION_ID');

    const longRequest = responseRecorder();
    await handler(authenticatedRequest({
      method: 'POST',
      body: { action: 'saveVersion', monthKey: '2026-09', saveRequestId: 'r'.repeat(129), data: {} },
    }), longRequest);
    assert.equal(longRequest.statusCode, 400);
    assert.equal(longRequest.body.error, 'INVALID_SAVE_REQUEST_ID');

    const oversized = responseRecorder();
    await handler(authenticatedRequest({
      method: 'POST',
      body: JSON.stringify({ action: 'save', month: '2026-09', data: { note: 'x'.repeat(250001) } }),
    }), oversized);
    assert.equal(oversized.statusCode, 413);
    assert.equal(oversized.body.error, 'REQUEST_TOO_LARGE');
    assert.equal(fetchCalls, 0);
  } finally {
    global.fetch = originalFetch;
  }
});

test('schedule proxy responses are no-store', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    status: 200,
    headers: { get: () => 'application/json' },
    text: async () => JSON.stringify({ ok: true, found: false }),
  });
  try {
    const res = responseRecorder();
    await handler(authenticatedRequest(), res);
    assert.equal(res.headers['Cache-Control'], 'no-store');
  } finally {
    global.fetch = originalFetch;
  }
});
