const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

process.env.CLINIC_SERVER_SECRET = 'test-only-secret-value-that-is-longer-than-32-characters';

const { createSessionToken } = require('../lib/server-session.js');
const { createHandler } = require('../api/publish.js');
const cmsModulePath = require.resolve('../lib/jinan-cms.js');
const {
  JINAN_CMS_CONFIG,
} = require('../lib/jinan-cms.js');
let { publishJinanCms } = require('../lib/jinan-cms.js');

function reloadJinanCmsModule() {
  delete require.cache[cmsModulePath];
  ({ publishJinanCms } = require('../lib/jinan-cms.js'));
}

function responseRecorder() {
  return {
    headers: {},
    statusCode: 0,
    setHeader(name, value) { this.headers[name] = value; },
    end(body) { this.body = JSON.parse(body); },
  };
}

function assertNoStoreJson(res) {
  assert.equal(res.headers['Content-Type'], 'application/json; charset=utf-8');
  assert.equal(res.headers['Cache-Control'], 'no-store');
}

function signedCookie() {
  return `clinic_timetable_session=${encodeURIComponent(createSessionToken())}`;
}

function chunk(type, data = Buffer.alloc(0)) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < CRC_TABLE.length; n += 1) {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function currentPreviewPngDataUrl() {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(2160, 0);
  ihdr.writeUInt32BE(3840, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const idat = getValidIdatPayload();
  return `data:image/png;base64,${Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND'),
  ]).toString('base64')}`;
}

let validIdatPayload;
function getValidIdatPayload() {
  if (!validIdatPayload) {
    validIdatPayload = zlib.deflateSync(Buffer.alloc((2160 * 4 + 1) * 3840));
  }
  return validIdatPayload;
}

function publicCompositeHtml() {
  return '<main><section>門診異動請以現場公告為準</section>'
    + '<div class="appointment"><a href="https://lin.ee/appointment">線上預約<img src="/img/icon-next.svg" alt=""></a></div>'
    + '<p class="text-center" style="text-align: center;">\r\n'
    + '\t<span style="font-size: 16px;"></span><strong><span style="font-size:16px;">----------------------------------------------------------</span></strong><br />\r\n'
    + '\t<span style="color: rgb(0, 0, 255); font-size: 26px; caret-color: rgb(0, 0, 255); background-color: rgb(255, 255, 0);">１１５年９月醫師常規門診、門診異動及週六門診時間，詳情請往下參閱！</span><br />\r\n'
    + '\t<img alt="" src="/upload/photo_2026-09-02 23_08_57(1).jpeg" /><br />\r\n'
    + '\t<br />\r\n'
    + '\t<img alt="" src="/upload/115毅安門診表.png" /><br />\r\n'
    + '\t<br />\r\n'
    + '\t<img alt="" src="/upload/115門診異動表(4).png" /><br />\r\n'
    + '\t<br />\r\n'
    + '\t<img alt="" src="/upload/115週六門診表.png" /></p>'
    + '<p><img src="/images/unrelated-footer.png" alt="map"></p></main>';
}

function loginHtml() {
  return `
    <form name="loginForm" action="https://www.tainanrehab.com/admin/login.php" method="POST" enctype="application/x-www-form-urlencoded">
      <input type="hidden" name="mode" value="login">
      <input type="text" name="username" value="">
      <input type="password" name="password" value="">
    </form>`;
}

async function runPublish({
  method = 'POST',
  body,
  headers = {},
  preflightPublish = async () => ({ ok: true }),
  loginOnlyJinanCms = async () => ({ result: 'PASS', reasonCode: 'NONE', stage: 'LOGIN_CONFIRMED' }),
} = {}) {
  let adapterCalls = 0;
  let diagnosticCalls = 0;
  const handler = createHandler({
    preflightPublish: async (payload) => {
      adapterCalls += 1;
      return preflightPublish(payload);
    },
    loginOnlyJinanCms: async () => {
      diagnosticCalls += 1;
      return loginOnlyJinanCms();
    },
  });
  const res = responseRecorder();
  await handler({ method, headers, body }, res);
  return { res, adapterCalls, diagnosticCalls };
}

test('publish POST requires an authenticated signed session before invoking adapter', async () => {
  const { res, adapterCalls } = await runPublish({
    body: {
      action: 'publish',
      channelIds: ['jinan-website'],
      primaryClinicId: 'clinic-1',
      title: '晉安門診表',
      pngDataUrl: 'data:image/png;base64,not-yet-validated',
    },
  });

  assert.equal(res.statusCode, 401);
  assert.equal(res.body.error, 'AUTH_REQUIRED');
  assert.equal(adapterCalls, 0);
});

test('diagnostic loginOnly requires authentication before invoking diagnostic adapter', async () => {
  const { res, adapterCalls, diagnosticCalls } = await runPublish({
    body: { diagnosticMode: 'loginOnly' },
    loginOnlyJinanCms: async () => {
      throw new Error('unauthorized diagnostic adapter must not run');
    },
  });

  assert.equal(res.statusCode, 401);
  assert.equal(res.body.error, 'AUTH_REQUIRED');
  assert.equal(adapterCalls, 0);
  assert.equal(diagnosticCalls, 0);
});

test('publish POST treats malformed session cookies as unauthenticated without invoking adapter', async () => {
  const { res, adapterCalls } = await runPublish({
    headers: { cookie: 'clinic_timetable_session=%' },
    body: {
      action: 'publish',
      channelIds: ['jinan-website'],
      primaryClinicId: 'clinic-1',
      title: '晉安門診表',
      pngDataUrl: currentPreviewPngDataUrl(),
    },
  });

  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.body, { ok: false, error: 'AUTH_REQUIRED', message: '請重新登入後再操作。' });
  assertNoStoreJson(res);
  assert.equal(adapterCalls, 0);
});

test('publish requires auth before method and rejects authenticated non-POST without adapter', async () => {
  const unauthenticated = await runPublish({
    method: 'GET',
    body: '{',
  });
  assert.equal(unauthenticated.res.statusCode, 401);
  assert.equal(unauthenticated.res.body.error, 'AUTH_REQUIRED');
  assert.equal(unauthenticated.adapterCalls, 0);

  const authenticated = await runPublish({
    method: 'GET',
    headers: { cookie: signedCookie() },
    body: '{',
  });
  assert.equal(authenticated.res.statusCode, 405);
  assert.equal(authenticated.res.headers.Allow, 'POST');
  assert.deepEqual(authenticated.res.body, { ok: false, error: 'METHOD_NOT_ALLOWED' });
  assertNoStoreJson(authenticated.res);
  assert.equal(authenticated.adapterCalls, 0);
});

test('diagnostic loginOnly accepts only the exact body and rejects request credentials before adapter', async () => {
  const invalidBodies = [
    {},
    [],
    null,
    { diagnosticMode: 'LOGIN_ONLY' },
    { diagnosticMode: 'loginOnly', username: 'browser-user' },
    { diagnosticMode: 'loginOnly', password: 'browser-password' },
    { diagnosticMode: 'loginOnly', credentials: { username: 'browser-user', password: 'browser-password' } },
    '{"diagnosticMode":"loginOnly","diagnosticMode":"loginOnly"}',
    '{"diagnosticMode":"loginOnly","extra":"blocked"}',
    '{',
  ];

  for (const body of invalidBodies) {
    const { res, adapterCalls, diagnosticCalls } = await runPublish({
      headers: { cookie: signedCookie() },
      body,
    });
    assert.equal(res.statusCode, 400, JSON.stringify(body));
    assert.deepEqual(res.body, { ok: false, error: 'INVALID_REQUEST' }, JSON.stringify(body));
    assertNoStoreJson(res);
    assert.equal(adapterCalls, 0, JSON.stringify(body));
    assert.equal(diagnosticCalls, 0, JSON.stringify(body));
  }
});

test('diagnostic loginOnly invokes only diagnostic adapter while normal publish still invokes only normal adapter', async () => {
  const diagnostic = await runPublish({
    headers: { cookie: signedCookie() },
    body: { diagnosticMode: 'loginOnly' },
    preflightPublish: async () => {
      throw new Error('normal adapter must not run for diagnostic mode');
    },
    loginOnlyJinanCms: async () => ({ result: 'PASS', reasonCode: 'NONE', stage: 'LOGIN_CONFIRMED', secret: 'drop-me' }),
  });

  assert.equal(diagnostic.res.statusCode, 200);
  assert.deepEqual(diagnostic.res.body, { result: 'PASS', reasonCode: 'NONE', stage: 'LOGIN_CONFIRMED' });
  assert.equal(diagnostic.adapterCalls, 0);
  assert.equal(diagnostic.diagnosticCalls, 1);

  const normalBody = {
    action: 'publish',
    channelIds: ['jinan-website'],
    primaryClinicId: 'clinic-1',
    title: '晉安門診表',
    pngDataUrl: currentPreviewPngDataUrl(),
  };
  const normal = await runPublish({
    headers: { cookie: signedCookie() },
    body: normalBody,
    preflightPublish: async () => ({ status: 'CMS_RESPONSE_CONTRACT_UNVERIFIED' }),
    loginOnlyJinanCms: async () => {
      throw new Error('diagnostic adapter must not run for normal publish');
    },
  });

  assert.equal(normal.res.statusCode, 409);
  assert.deepEqual(normal.res.body, {
    ok: false,
    error: 'CMS_RESPONSE_CONTRACT_UNVERIFIED',
    message: '晉安官網發布串接尚待完成最後驗證',
  });
  assert.equal(normal.adapterCalls, 1);
  assert.equal(normal.diagnosticCalls, 0);
});

test('diagnostic loginOnly route safely maps spoofed or throwing adapter results to VERIFY_FAILED', async () => {
  const spoofed = await runPublish({
    headers: { cookie: signedCookie() },
    body: { diagnosticMode: 'loginOnly' },
    loginOnlyJinanCms: async () => ({ result: 'FAIL', reasonCode: 'ATTACKER_CODE', stage: 'raw-url' }),
  });
  assert.equal(spoofed.res.statusCode, 200);
  assert.deepEqual(spoofed.res.body, { result: 'FAIL', reasonCode: 'VERIFY_FAILED', stage: 'CREDENTIALS' });

  const throwingGetter = {};
  Object.defineProperty(throwingGetter, 'result', {
    enumerable: true,
    get() { throw new Error('getter secret'); },
  });
  const thrown = await runPublish({
    headers: { cookie: signedCookie() },
    body: { diagnosticMode: 'loginOnly' },
    loginOnlyJinanCms: async () => throwingGetter,
  });
  assert.equal(thrown.res.statusCode, 200);
  assert.deepEqual(thrown.res.body, { result: 'FAIL', reasonCode: 'VERIFY_FAILED', stage: 'CREDENTIALS' });
});

test('diagnostic loginOnly snapshots stateful result getters once without leaking second values', async () => {
  let resultReads = 0;
  let reasonReads = 0;
  let stageReads = 0;
  const stateful = {};
  Object.defineProperties(stateful, {
    result: {
      enumerable: true,
      get() {
        resultReads += 1;
        return 'FAIL';
      },
    },
    reasonCode: {
      enumerable: true,
      get() {
        reasonReads += 1;
        return reasonReads === 1 ? 'VERIFY_FAILED' : 'UNSAFE_SECOND_VALUE';
      },
    },
    stage: {
      enumerable: true,
      get() {
        stageReads += 1;
        return stageReads === 1 ? 'CREDENTIALS' : 'LOGIN_CONFIRMED';
      },
    },
  });

  const { res } = await runPublish({
    headers: { cookie: signedCookie() },
    body: { diagnosticMode: 'loginOnly' },
    loginOnlyJinanCms: async () => stateful,
  });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { result: 'FAIL', reasonCode: 'VERIFY_FAILED', stage: 'CREDENTIALS' });
  assert.equal(resultReads, 1);
  assert.equal(reasonReads, 1);
  assert.equal(stageReads, 1);
  assert.equal(JSON.stringify(res.body).includes('UNSAFE_SECOND_VALUE'), false);
});

test('publish POST rejects malformed JSON string body without throwing or logging request body', async () => {
  const originalError = console.error;
  const logged = [];
  console.error = (...args) => { logged.push(args.join(' ')); };
  try {
    const { res, adapterCalls } = await runPublish({
      headers: { cookie: signedCookie() },
      body: '{"action":"publish","secret":"must-not-log"',
    });

    assert.equal(res.statusCode, 400);
    assert.deepEqual(res.body, { ok: false, error: 'INVALID_REQUEST' });
    assertNoStoreJson(res);
    assert.equal(adapterCalls, 0);
    assert.equal(logged.join('\n').includes('must-not-log'), false);
  } finally {
    console.error = originalError;
  }
});

test('publish POST fails closed on invalid action, title, and channel selections before adapter', async () => {
  const valid = {
    action: 'publish',
    channelIds: ['jinan-website'],
    primaryClinicId: 'clinic-1',
    title: '晉安門診表',
    pngDataUrl: currentPreviewPngDataUrl(),
  };
  const cases = [
    ['missing action', { action: undefined }, 'INVALID_REQUEST'],
    ['wrong action', { action: 'preview' }, 'INVALID_REQUEST'],
    ['missing title', { title: undefined }, 'INVALID_REQUEST'],
    ['blank title', { title: '  \t\n' }, 'INVALID_REQUEST'],
    ['duplicate channel', { channelIds: ['jinan-website', 'jinan-website'] }, 'INVALID_REQUEST'],
    ['multiple channels', { channelIds: ['jinan-website', 'line'] }, 'INVALID_REQUEST'],
    ['unknown channel', { channelIds: ['unknown'] }, 'INVALID_REQUEST'],
    ['missing channels', { channelIds: undefined }, 'INVALID_REQUEST'],
    ['empty channels', { channelIds: [] }, 'CHANNEL_REQUIRED'],
  ];

  for (const [name, patch, expectedError] of cases) {
    const body = { ...valid, ...patch };
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) delete body[key];
    }
    const { res, adapterCalls } = await runPublish({
      headers: { cookie: signedCookie() },
      body,
    });
    assert.equal(res.statusCode, 400, name);
    assert.equal(res.body.error, expectedError, name);
    assertNoStoreJson(res);
    assert.equal(adapterCalls, 0, name);
  }
});

test('publish POST rejects non-plain bodies, duplicate keys, missing keys, and extra trust-boundary fields before PNG parsing', async () => {
  const valid = {
    action: 'publish',
    channelIds: ['jinan-website'],
    primaryClinicId: 'clinic-1',
    title: '晉安門診表',
    pngDataUrl: currentPreviewPngDataUrl(),
  };
  const invalidPng = 'data:image/png;base64,not-yet-validated';
  const withInvalidPng = { ...valid, pngDataUrl: invalidPng };
  const nonPlain = new Date();
  nonPlain.action = 'publish';
  nonPlain.channelIds = ['jinan-website'];
  nonPlain.primaryClinicId = 'clinic-1';
  nonPlain.title = '晉安門診表';
  nonPlain.pngDataUrl = invalidPng;

  const cases = [
    ['array body', [{ ...withInvalidPng }]],
    ['null body', null],
    ['non-plain object', nonPlain],
    ['missing primaryClinicId', { action: 'publish', channelIds: ['jinan-website'], title: '晉安門診表', pngDataUrl: invalidPng }],
    ['missing pngDataUrl', { action: 'publish', channelIds: ['jinan-website'], primaryClinicId: 'clinic-1', title: '晉安門診表' }],
    ['extra env', { ...withInvalidPng, env: { JINAN_CMS_USERNAME: 'browser-user' } }],
    ['extra transport', { ...withInvalidPng, transport: {} }],
    ['extra finalImageUrl', { ...withInvalidPng, finalImageUrl: 'https://attacker.example/image.png' }],
    ['extra callbackNumber', { ...withInvalidPng, callbackNumber: '0912345678' }],
    ['extra retry state', { ...withInvalidPng, retryState: { attempt: 2 } }],
    ['duplicate action in JSON', '{"action":"preview","action":"publish","channelIds":["jinan-website"],"primaryClinicId":"clinic-1","title":"晉安門診表","pngDataUrl":"data:image/png;base64,not-yet-validated"}'],
  ];

  for (const [name, body] of cases) {
    const { res, adapterCalls } = await runPublish({
      headers: { cookie: signedCookie() },
      body,
    });
    assert.equal(res.statusCode, 400, name);
    assert.deepEqual(res.body, { ok: false, error: 'INVALID_REQUEST' }, name);
    assertNoStoreJson(res);
    assert.equal(adapterCalls, 0, name);
  }
});

test('publish POST validates exact field semantics before invoking adapter', async () => {
  const valid = {
    action: 'publish',
    channelIds: ['jinan-website'],
    primaryClinicId: 'clinic-1',
    title: '晉安門診表',
    pngDataUrl: 'data:image/png;base64,not-yet-validated',
  };
  const cases = [
    ['action whitespace', { action: ' publish' }, 'INVALID_REQUEST'],
    ['channelIds not array', { channelIds: 'jinan-website' }, 'INVALID_REQUEST'],
    ['wrong channel case', { channelIds: ['JINAN-WEBSITE'] }, 'INVALID_REQUEST'],
    ['primaryClinicId not string', { primaryClinicId: 1 }, 'INVALID_REQUEST'],
    ['title only trims to too long', { title: ` ${'a'.repeat(101)} ` }, 'INVALID_REQUEST'],
    ['title C0 control', { title: '晉安\u0001門診表' }, 'INVALID_REQUEST'],
    ['title C1 control', { title: '晉安\u0085門診表' }, 'INVALID_REQUEST'],
    ['pngDataUrl not string', { pngDataUrl: 123 }, 'INVALID_REQUEST'],
  ];

  for (const [name, patch, expectedError] of cases) {
    const { res, adapterCalls } = await runPublish({
      headers: { cookie: signedCookie() },
      body: { ...valid, ...patch },
    });
    assert.equal(res.statusCode, 400, name);
    assert.equal(res.body.error, expectedError, name);
    assertNoStoreJson(res);
    assert.equal(adapterCalls, 0, name);
  }
});

test('publish POST requires at least one selected channel before invoking adapter', async () => {
  const { res, adapterCalls } = await runPublish({
    headers: { cookie: signedCookie() },
    body: {
      action: 'publish',
      channelIds: [],
      primaryClinicId: 'clinic-1',
      title: '晉安門診表',
      pngDataUrl: 'data:image/png;base64,not-yet-validated',
    },
  });

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'CHANNEL_REQUIRED');
  assert.equal(adapterCalls, 0);
});

test('publish POST requires Jinan as primary clinic and preserves submitted value', async () => {
  const { res, adapterCalls } = await runPublish({
    headers: { cookie: signedCookie() },
    body: {
      action: 'publish',
      channelIds: ['jinan-website'],
      primaryClinicId: 'clinic-2',
      title: '晉安門診表',
      pngDataUrl: 'data:image/png;base64,not-yet-validated',
    },
  });

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'PRIMARY_CLINIC_REQUIRED');
  assert.equal(res.body.primaryClinicId, 'clinic-2');
  assert.equal(adapterCalls, 0);
});

test('publish POST sends a new frozen sanitized adapter payload with only allowed keys', async () => {
  const originalBody = {
    action: 'publish',
    channelIds: ['jinan-website'],
    primaryClinicId: 'clinic-1',
    title: '  晉安門診表  ',
    pngDataUrl: currentPreviewPngDataUrl(),
  };
  let capturedPayload;

  const { res, adapterCalls } = await runPublish({
    headers: { cookie: signedCookie() },
    body: originalBody,
    preflightPublish: async (payload) => {
      capturedPayload = payload;
      return { status: 'CMS_RESPONSE_CONTRACT_UNVERIFIED' };
    },
  });

  assert.equal(adapterCalls, 1);
  assert.equal(res.statusCode, 409);
  assert.notEqual(capturedPayload, originalBody);
  assert.deepEqual(Object.keys(capturedPayload), [
    'action',
    'channelIds',
    'primaryClinicId',
    'title',
    'pngDataUrl',
  ]);
  assert.equal(Object.isFrozen(capturedPayload), true);
  assert.notEqual(capturedPayload.channelIds, originalBody.channelIds);
  assert.equal(Object.isFrozen(capturedPayload.channelIds), true);
  assert.deepEqual(capturedPayload, {
    action: 'publish',
    channelIds: ['jinan-website'],
    primaryClinicId: 'clinic-1',
    title: '晉安門診表',
    pngDataUrl: originalBody.pngDataUrl,
  });
});

test('publish POST rejects malformed or non-PNG data URL before invoking adapter', async () => {
  const { res, adapterCalls } = await runPublish({
    headers: { cookie: signedCookie() },
    body: {
      action: 'publish',
      channelIds: ['jinan-website'],
      primaryClinicId: 'clinic-1',
      title: '晉安門診表',
      pngDataUrl: 'data:image/jpeg;base64,not-png',
    },
  });

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'INVALID_PNG');
  assert.equal(adapterCalls, 0);
});

test('publish POST catches adapter exceptions as generic VERIFY_FAILED without leaking details', async () => {
  const originalError = console.error;
  const logged = [];
  console.error = (...args) => { logged.push(args.join(' ')); };
  try {
    const { res, adapterCalls } = await runPublish({
      headers: { cookie: signedCookie() },
      body: {
        action: 'publish',
        channelIds: ['jinan-website'],
        primaryClinicId: 'clinic-1',
        title: '晉安門診表',
        pngDataUrl: currentPreviewPngDataUrl(),
      },
      preflightPublish: async () => {
        throw new Error('synthetic adapter secret stack data:image/png credential');
      },
    });

    assert.equal(adapterCalls, 1);
    assert.equal(res.statusCode, 502);
    assert.deepEqual(res.body, { ok: false, error: 'VERIFY_FAILED' });
    assertNoStoreJson(res);
    const responseJson = JSON.stringify(res.body);
    assert.equal(responseJson.includes('synthetic adapter secret'), false);
    assert.equal(responseJson.includes('data:image/png'), false);
    assert.equal(responseJson.includes('credential'), false);
    assert.equal(logged.join('\n').includes('synthetic adapter secret'), false);
  } finally {
    console.error = originalError;
  }
});

test('publish POST fail-closes when CMS response contract is unverified', async () => {
  const { res, adapterCalls } = await runPublish({
    headers: { cookie: signedCookie() },
    body: {
      action: 'publish',
      channelIds: ['jinan-website'],
      primaryClinicId: 'clinic-1',
      title: '晉安門診表',
      pngDataUrl: currentPreviewPngDataUrl(),
    },
    preflightPublish: async () => ({ status: 'CMS_RESPONSE_CONTRACT_UNVERIFIED' }),
  });

  assert.equal(adapterCalls, 1);
  assert.equal(res.statusCode, 409);
  assert.deepEqual(res.body, {
    ok: false,
    error: 'CMS_RESPONSE_CONTRACT_UNVERIFIED',
    message: '晉安官網發布串接尚待完成最後驗證',
  });
});

test('publish POST maps adapter statuses without exposing adapter fields or PNG data', async () => {
  const routeSource = fs.readFileSync(path.join(__dirname, '..', 'api', 'publish.js'), 'utf8');

  const body = {
    action: 'publish',
    channelIds: ['jinan-website'],
    primaryClinicId: 'clinic-1',
    title: '晉安門診表',
    pngDataUrl: currentPreviewPngDataUrl(),
  };
  const cases = [
    ['AUTH_FAILED', 502, { ok: false, error: 'AUTH_FAILED' }],
    ['FORM_CHANGED', 409, { ok: false, error: 'FORM_CHANGED' }],
    ['VERIFY_FAILED', 502, { ok: false, error: 'VERIFY_FAILED' }],
    ['CMS_RESPONSE_CONTRACT_UNVERIFIED', 409, {
      ok: false,
      error: 'CMS_RESPONSE_CONTRACT_UNVERIFIED',
      message: '晉安官網發布串接尚待完成最後驗證',
    }],
    ['PUBLISH_IN_PROGRESS', 409, { ok: false, error: 'PUBLISH_IN_PROGRESS' }],
    ['MANUAL_CHECK_REQUIRED', 409, { ok: false, error: 'MANUAL_CHECK_REQUIRED', orphanUploadRisk: true }],
    ['ALREADY_PUBLISHED', 409, {
      ok: false,
      error: 'CMS_RESPONSE_CONTRACT_UNVERIFIED',
      message: '晉安官網發布串接尚待完成最後驗證',
    }],
    ['PUBLISHED', 200, { ok: true, status: 'PUBLISHED', channels: [{ id: 'jinan-website', ok: true }] }],
    ['READY_FOR_UPLOAD', 502, { ok: false, error: 'PUBLISH_FAILED' }],
    ['UPLOAD_FAILED', 502, { ok: false, error: 'UPLOAD_FAILED' }],
    ['SUBMIT_FAILED', 502, { ok: false, error: 'SUBMIT_FAILED' }],
    ['SOMETHING_NEW', 502, { ok: false, error: 'PUBLISH_FAILED' }],
    [undefined, 502, { ok: false, error: 'PUBLISH_FAILED' }],
  ];

  for (const [status, expectedStatusCode, expectedBody] of cases) {
    const { res, adapterCalls } = await runPublish({
      headers: { cookie: signedCookie() },
      body,
      preflightPublish: async () => ({
        status,
        secret: 'adapter-secret-must-not-leak',
        pngDataUrl: body.pngDataUrl,
        finalImagePath: '/uploads/adapter-must-not-leak.png',
        summary: { internal: true },
      }),
    });
    assert.equal(adapterCalls, 1, status);
    assert.equal(res.statusCode, expectedStatusCode, status);
    assert.deepEqual(res.body, expectedBody, status);
    assert.notDeepEqual(res.body, { ok: true, status: 'ALREADY_PUBLISHED' }, status);
    assertNoStoreJson(res);
    const json = JSON.stringify(res.body);
    assert.equal(json.includes('adapter-secret-must-not-leak'), false, status);
    assert.equal(json.includes('data:image/png'), false, status);
    assert.equal(json.includes('/uploads/adapter-must-not-leak.png'), false, status);
  }
});

test('publish POST maps real pipeline concurrent admission lock through route without duplicate mutation work', async () => {
  reloadJinanCmsModule();
  const body = {
    action: 'publish',
    channelIds: ['jinan-website'],
    primaryClinicId: 'clinic-1',
    title: '晉安門診表',
    pngDataUrl: currentPreviewPngDataUrl(),
  };
  let releaseFirst;
  const transportCalls = [];
  const firstPublicResponse = new Promise((resolve) => {
    releaseFirst = () => resolve({ status: 200, finalUrl: JINAN_CMS_CONFIG.publicUrl, body: publicCompositeHtml() });
  });
  const transport = async (request) => {
    transportCalls.push(request);
    if (transportCalls.length === 1) return firstPublicResponse;
    throw new Error('second concurrent route call must not reach transport');
  };
  const env = {
    JINAN_CMS_PUBLISH_ENABLED: 'true',
    JINAN_CMS_USERNAME: 'synthetic-user',
    JINAN_CMS_PASSWORD: 'synthetic-password',
  };
  const handler = createHandler({
    preflightPublish: (payload) => publishJinanCms({
      ...payload,
      env,
      transport,
      logger: () => {},
      sleep: async () => {},
    }),
  });
  const firstRes = responseRecorder();
  const secondRes = responseRecorder();

  const first = handler({ method: 'POST', headers: { cookie: signedCookie() }, body }, firstRes);
  await Promise.resolve();
  await handler({ method: 'POST', headers: { cookie: signedCookie() }, body }, secondRes);

  assert.equal(secondRes.statusCode, 409);
  assert.deepEqual(secondRes.body, { ok: false, error: 'PUBLISH_IN_PROGRESS' });
  assert.equal(transportCalls.length, 1);

  releaseFirst();
  await first;
  assert.equal(firstRes.statusCode, 502);
  assert.deepEqual(firstRes.body, { ok: false, error: 'VERIFY_FAILED' });
  reloadJinanCmsModule();
});

test('default publish handler lazy-requires real publish pipeline and stays disabled with zero network by default', async () => {
  const publishModulePath = require.resolve('../api/publish.js');
  const originalFetch = global.fetch;
  const originalEnabled = process.env.JINAN_CMS_PUBLISH_ENABLED;
  const originalUsername = process.env.JINAN_CMS_USERNAME;
  const originalPassword = process.env.JINAN_CMS_PASSWORD;
  const calls = [];

  delete require.cache[cmsModulePath];
  delete require.cache[publishModulePath];
  try {
    delete process.env.JINAN_CMS_PUBLISH_ENABLED;
    process.env.JINAN_CMS_USERNAME = 'synthetic-user';
    process.env.JINAN_CMS_PASSWORD = 'synthetic-password';
    global.fetch = async (url, options = {}) => {
      calls.push({ method: options.method, url });
      throw new Error(`unexpected fetch call to ${url}`);
    };

    const defaultHandler = require('../api/publish.js');
    assert.equal(require.cache[cmsModulePath], undefined);

    const res = responseRecorder();
    await defaultHandler({
      method: 'POST',
      headers: { cookie: signedCookie() },
      body: {
        action: 'publish',
        channelIds: ['jinan-website'],
        primaryClinicId: 'clinic-1',
        title: '晉安門診表',
        pngDataUrl: currentPreviewPngDataUrl(),
      },
    }, res);

    assert.equal(typeof require.cache[cmsModulePath]?.exports?.publishJinanCms, 'function');
    assert.equal(
      require.cache[cmsModulePath].exports.preflightPublish,
      require.cache[cmsModulePath].exports.preflightJinanCmsPublish,
    );
    assert.equal(res.statusCode, 409);
    assert.deepEqual(res.body, {
      ok: false,
      error: 'CMS_RESPONSE_CONTRACT_UNVERIFIED',
      message: '晉安官網發布串接尚待完成最後驗證',
    });
    assert.deepEqual(calls, []);
    const responseJson = JSON.stringify(res.body);
    assert.equal(responseJson.includes('synthetic-user'), false);
    assert.equal(responseJson.includes('synthetic-password'), false);
    assert.equal(responseJson.includes('data:image/png'), false);
  } finally {
    global.fetch = originalFetch;
    if (originalEnabled === undefined) delete process.env.JINAN_CMS_PUBLISH_ENABLED;
    else process.env.JINAN_CMS_PUBLISH_ENABLED = originalEnabled;
    if (originalUsername === undefined) delete process.env.JINAN_CMS_USERNAME;
    else process.env.JINAN_CMS_USERNAME = originalUsername;
    if (originalPassword === undefined) delete process.env.JINAN_CMS_PASSWORD;
    else process.env.JINAN_CMS_PASSWORD = originalPassword;
  }
});

test('browser-served source files do not expose Jinan CMS credential boundaries', () => {
  const browserServedFiles = [
    'index.html',
    'publish-core.js',
    'auth-config.js',
    'auth-gate.js',
    'schedule-api-config.js',
    'schedule-save-load-core.js',
    'clinic-order.js',
  ];

  for (const file of browserServedFiles) {
    const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    assert.equal(source.includes('JINAN_CMS_USERNAME'), false, `${file} exposes CMS username env name`);
    assert.equal(source.includes('JINAN_CMS_PASSWORD'), false, `${file} exposes CMS password env name`);
    assert.equal(/JINAN_CMS_[A-Z_]*PASSWORD|CMS_[A-Z_]*PASSWORD|PASSWORD_[A-Z_]*CMS/.test(source), false, `${file} exposes a CMS password boundary`);
  }
});
