const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');

const cmsModulePath = require.resolve('../lib/jinan-cms.js');
const cmsModule = require('../lib/jinan-cms.js');
const {
  JINAN_CMS_CONFIG,
  JINAN_CMS_RESULTS,
  buildSubmitRequest,
  buildUploadRequest,
  createAttemptRecord,
  createCookieJar,
  createDefaultFetchTransport,
  inspectPublicCurrent,
  markUploadRecorded,
  parseCmsEditorForm,
  parseLoginForm,
  parseSubmitResponse,
  parseUploadResponse,
  planRetry,
  planRollback,
  preflightPublish,
  preflightJinanCmsPublish,
  loginOnlyJinanCms,
  validateLoginPostResponse,
} = cmsModule;
let { publishJinanCms } = cmsModule;

function reloadJinanCmsModule() {
  delete require.cache[cmsModulePath];
  ({ publishJinanCms } = require('../lib/jinan-cms.js'));
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

function pngDataUrl() {
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

function pngBuffer() {
  return Buffer.from(pngDataUrl().slice('data:image/png;base64,'.length), 'base64');
}

function largePngBuffer() {
  const png = pngBuffer();
  const iend = png.length - 12;
  const padding = chunk('ruST', Buffer.alloc((1024 * 1024) + 1));
  return Buffer.concat([png.subarray(0, iend), padding, png.subarray(iend)]);
}

let validIdatPayload;
function getValidIdatPayload() {
  if (!validIdatPayload) {
    validIdatPayload = zlib.deflateSync(Buffer.alloc((2160 * 4 + 1) * 3840));
  }
  return validIdatPayload;
}

function freshEditorHtml(extra = '') {
  return `
    <form name="addAdminFrm" action="https://www.tainanrehab.com/admin/index.php?op=time&amp;sub=set" method="POST" enctype="multipart/form-data">
      <input type="hidden" name="mode" value="edit">
      <input type="hidden" name="csrf" value="fresh-token">
      <input type="hidden" name="version" value="42">
      <textarea name="note">${compositeTimetableNote()}</textarea>
      <input type="text" name="wtitle" value="SEO title">
      <input type="text" name="wkeyword" value="SEO keyword">
      <textarea name="wdescription">SEO description</textarea>
      <input type="submit" name="Submit" value="送出">
      ${extra}
    </form>`;
}

const TIMETABLE_OLD_IMAGES = Object.freeze([
  '/upload/photo_current.jpeg',
  '/upload/yian.png',
  '/upload/changes.png',
  '/upload/saturday.png',
]);

const REAL_LEGACY_TIMETABLE_OLD_IMAGES = Object.freeze([
  '/upload/photo_2026-09-02 23_08_57(1).jpeg',
  '/upload/115毅安門診表.png',
  '/upload/115門診異動表(4).png',
  '/upload/115週六門診表.png',
]);

function timetableBlock(images = TIMETABLE_OLD_IMAGES) {
  return '<p class="text-center" style="text-align: center;">\r\n'
    + '<span style="font-size: 18px;">門診時間如有異動，請以現場公告為準</span><br />\r\n'
    + '<span style="font-size: 24px;">１１５年９月醫師常規門診、門診異動及週六門診時間，詳情請往下參閱！</span><br />\r\n'
    + timetableImageTail(images)
    + '</p>';
}

function timetableImageTail(images = TIMETABLE_OLD_IMAGES) {
  const firstStyle = images[0] === TIMETABLE_OLD_IMAGES[0] ? ' style="width: 1280px; height: 720px;"' : '';
  return `<img alt="" src="${images[0]}"${firstStyle} /><br />\r\n`
    + '<br />\r\n'
    + `<img alt="" src="${images[1]}" /><br />\r\n`
    + '<br />\r\n'
    + `<img alt="" src="${images[2]}" /><br />\r\n`
    + '<br />\r\n'
    + `<img alt="" src="${images[3]}" />`;
}

function realProductionTimetableBlock(images = TIMETABLE_OLD_IMAGES) {
  const firstStyle = images[0] === TIMETABLE_OLD_IMAGES[0] ? ' style="width: 1280px; height: 720px;"' : '';
  return '<p class="text-center" style="text-align: center;">\r\n'
    + '\t<span style="font-size: 16px;"></span><strong><span style="font-size:16px;">----------------------------------------------------------</span></strong><br />\r\n'
    + '\t<span style="color: rgb(0, 0, 255); font-size: 26px; caret-color: rgb(0, 0, 255); background-color: rgb(255, 255, 0);">１１５年９月醫師常規門診、門診異動及週六門診時間，詳情請往下參閱！</span><br />\r\n'
    + `\t<img alt="" src="${images[0]}"${firstStyle} /><br />\r\n`
    + '\t<br />\r\n'
    + `\t<img alt="" src="${images[1]}" /><br />\r\n`
    + '\t<br />\r\n'
    + `\t<img alt="" src="${images[2]}" /><br />\r\n`
    + '\t<br />\r\n'
    + `\t<img alt="" src="${images[3]}" /></p>`;
}

function reviewerStaffTimetableNearMissBlock() {
  return '<p class="text-center" style="text-align: center;">\r\n'
    + '<span style="font-size: 18px;">醫師團隊活動照片；常規門診、門診異動與週六門診時間請見另頁。</span><br />\r\n'
    + '<img src="/upload/staff-1.png"><br>\r\n'
    + '<img src="/upload/staff-2.png"><br>\r\n'
    + '<img src="/upload/staff-3.png"><br>\r\n'
    + '<img src="/upload/staff-4.png">\r\n'
    + '</p>';
}

function realProductionCompositeNote(images = TIMETABLE_OLD_IMAGES) {
  return '<section class="notice">門診異動請以現場公告為準</section>'
    + '<div class="appointment"><a href="https://lin.ee/appointment">線上預約<img src="/img/icon-next.svg" alt=""></a></div>'
    + realProductionTimetableBlock(images)
    + '<p><img src="/images/unrelated-footer.png" alt="map"></p>';
}

function singleCompositeTimetableBlock(pathname = '/uploads/2026/jinan-composite.png') {
  return '<p class="text-center" style="text-align: center;">\r\n'
    + '<span style="font-size: 18px;">門診時間如有異動，請以現場公告為準</span><br />\r\n'
    + '<span style="font-size: 24px;">１１５年９月醫師常規門診、門診異動及週六門診時間，詳情請往下參閱！</span><br />\r\n'
    + `<img alt="" src="${pathname}" /></p>`;
}

function compositeTimetableNote(images = TIMETABLE_OLD_IMAGES) {
  return '<section class="notice">門診異動請以現場公告為準</section>'
    + '<div class="appointment"><a href="https://lin.ee/appointment">線上預約<img src="/images/line-icon.png" alt="LINE"></a></div>'
    + timetableBlock(images)
    + '<p><img src="/images/unrelated-footer.png" alt="map"></p>';
}

function freshCompositeEditorHtml({ note = compositeTimetableNote(), extra = '' } = {}) {
  return freshEditorHtml(extra).replace(
    compositeTimetableNote(),
    note,
  );
}

function publicCompositeHtml({ note = compositeTimetableNote(), head = '<title>晉安門診</title>' } = {}) {
  return `<!doctype html><html><head>${head}</head><body><main>${note}</main></body></html>`;
}

function loginHtml(action = JINAN_CMS_CONFIG.loginUrl, extra = '') {
  const actionAttr = action === null ? '' : ` action="${String(action).replace(/&/g, '&amp;')}"`;
  return `
    <form name="loginForm"${actionAttr} method="POST" enctype="application/x-www-form-urlencoded">
      <input type="hidden" name="mode" value="login">
      <input type="text" name="username" value="">
      <input type="password" name="password" value="">
      ${extra}
    </form>`;
}

const LOGIN_SUCCESS_LANDING_URL = `${JINAN_CMS_CONFIG.origin}/admin/index.php`;
const QUICK_UPLOAD_RESPONSE_URL = `${JINAN_CMS_CONFIG.quickUploadUrl}?command=QuickUpload&type=Images&CKEditor=note&CKEditorFuncNum=37&langCode=zh`;

function loginSuccessLandingResponse(setCookie = 'sid=landed; Path=/admin; HttpOnly') {
  const response = {
    status: 200,
    finalUrl: LOGIN_SUCCESS_LANDING_URL,
    body: '<a href="/admin/index.php?op=time&amp;sub=set">門診時間</a>',
  };
  if (setCookie) response.setCookie = [setCookie];
  return response;
}

function emptyLocationResponseCases(baseResponse) {
  return [
    { name: 'direct location empty', response: { ...baseResponse, location: '' } },
    { name: 'headers.location empty', response: { ...baseResponse, headers: { location: '' } } },
    { name: 'headers.Location empty', response: { ...baseResponse, headers: { Location: '' } } },
    { name: 'headers.LoCaTiOn empty', response: { ...baseResponse, headers: { LoCaTiOn: '' } } },
    {
      name: 'headers.get location empty',
      response: {
        ...baseResponse,
        headers: {
          get(name) {
            return String(name).toLowerCase() === 'location' ? '' : null;
          },
        },
      },
    },
  ];
}

function makeTransport(responses) {
  const calls = [];
  const transport = async (request) => {
    calls.push({
      method: request.method,
      url: request.url,
      hasCookie: Boolean(request.headers?.cookie),
      cookie: request.headers?.cookie || '',
      bodyKind: request.body instanceof URLSearchParams ? 'URLSearchParams' : typeof request.body,
    });
    const next = responses.shift();
    assert.notEqual(next, undefined, `missing fixture response for ${request.method} ${request.url}`);
    if (next instanceof Error) throw next;
    return next;
  };
  transport.calls = calls;
  return transport;
}

function uploadSuccessBody(pathname = '/uploads/2026/jinan.png', callbackNumber = 37, message = '') {
  return `<script type="text/javascript">window.parent.CKEDITOR.tools.callFunction(${callbackNumber},${JSON.stringify(pathname)},${JSON.stringify(message)});</script>`;
}

function publicHtml(pathname = '/uploads/2026/jinan.png') {
  return publicCompositeHtml({
    note: compositeTimetableNote().replace(
      timetableImageTail(),
      `<img src="${pathname}" />`,
    ),
  });
}

function publicRealProductionHtml(pathname = '/uploads/2026/jinan.png') {
  return publicCompositeHtml({
    note: realProductionCompositeNote().replace(
      realProductionTimetableBlock().match(/<img[\s\S]*<\/p>$/)[0].slice(0, -'</p>'.length),
      `<img src="${pathname}" />`,
    ),
  });
}

function publicHtmlWithTimetableReplacement(replacement) {
  return publicCompositeHtml({
    note: compositeTimetableNote().replace(timetableImageTail(), replacement),
  });
}

function percentEncodeLayers(value, layers) {
  let encoded = value;
  for (let index = 0; index < layers; index += 1) {
    encoded = encodeURIComponent(encoded).replace(/%2F/g, '/');
  }
  return encoded;
}

async function seedSubmitAmbiguity({ env, finalImagePath = '/uploads/2026/saved.png', logger = () => {} } = {}) {
  const transport = makeTransport([
    { status: 200, finalUrl: JINAN_CMS_CONFIG.publicUrl, body: publicCompositeHtml() },
    { status: 200, finalUrl: JINAN_CMS_CONFIG.loginUrl, body: loginHtml() },
    { status: 302, finalUrl: JINAN_CMS_CONFIG.loginUrl, location: '/admin/index.php', setCookie: ['sid=x; Path=/admin'] },
    loginSuccessLandingResponse(),
    { status: 200, finalUrl: JINAN_CMS_CONFIG.editorUrl, body: freshEditorHtml() },
    { status: 200, finalUrl: QUICK_UPLOAD_RESPONSE_URL, contentType: 'text/html', body: uploadSuccessBody(finalImagePath, 37) },
    { status: 200, finalUrl: JINAN_CMS_CONFIG.editorUrl, body: freshEditorHtml() },
    new Error('timeout after submit mutation'),
  ]);
  const result = await publishJinanCms({
    pngDataUrl: pngDataUrl(),
    callbackNumber: 37,
    env: env || {
      JINAN_CMS_PUBLISH_ENABLED: 'true',
      JINAN_CMS_USERNAME: 'synthetic-user',
      JINAN_CMS_PASSWORD: 'synthetic-password',
    },
    transport,
    logger,
  });
  assert.deepEqual(result, {
    status: 'MANUAL_CHECK_REQUIRED',
    orphanUploadRisk: true,
    finalImagePath,
  });
  assert.equal(transport.calls.filter((call) => call.url.includes('QuickUpload')).length, 1);
  assert.equal(transport.calls.filter((call) => call.method === 'POST' && call.url === JINAN_CMS_CONFIG.editorUrl).length, 1);
  return transport;
}

function assertCode(fn, code) {
  assert.throws(fn, (error) => error && error.code === code);
}

test('A. config exposes only public endpoints and env-name strings; result constants are complete', () => {
  assert.deepEqual(JINAN_CMS_CONFIG, {
    origin: 'https://www.tainanrehab.com',
    loginUrl: 'https://www.tainanrehab.com/admin/login.php',
    editorUrl: 'https://www.tainanrehab.com/admin/index.php?op=time&sub=set',
    publicUrl: 'https://www.tainanrehab.com/time.html',
    quickUploadUrl: 'https://www.tainanrehab.com/scripts/ckfinder/core/connector/php/connector.php',
    publishEnabledEnvName: 'JINAN_CMS_PUBLISH_ENABLED',
    usernameEnvName: 'JINAN_CMS_USERNAME',
    passwordEnvName: 'JINAN_CMS_PASSWORD',
  });
  assert.equal(JSON.stringify(JINAN_CMS_CONFIG).includes('secret'), false);
  assert.deepEqual(Object.keys(JINAN_CMS_RESULTS).sort(), [
    'ALREADY_PUBLISHED',
    'AUTH_FAILED',
    'CMS_RESPONSE_CONTRACT_UNVERIFIED',
    'FORM_CHANGED',
    'MANUAL_CHECK_REQUIRED',
    'PUBLISH_IN_PROGRESS',
    'PUBLISHED',
    'READY_FOR_UPLOAD',
    'SUBMIT_FAILED',
    'SUBMIT_SUCCEEDED',
    'UPLOAD_FAILED',
    'UPLOAD_SUCCEEDED',
    'VERIFY_FAILED',
  ].sort());
});

test('M1. concurrent publish rejects second invocation before PNG, credentials, or transport', async () => {
  reloadJinanCmsModule();
  let releaseFirst;
  const firstTransport = makeTransport([
    new Promise((resolve) => { releaseFirst = () => resolve({ status: 200, finalUrl: JINAN_CMS_CONFIG.publicUrl, body: publicCompositeHtml() }); }),
    { status: 200, finalUrl: JINAN_CMS_CONFIG.loginUrl, body: loginHtml() },
    { status: 302, finalUrl: JINAN_CMS_CONFIG.loginUrl, location: '/admin/index.php', setCookie: ['sid=x; Path=/admin'] },
    loginSuccessLandingResponse(),
    { status: 200, finalUrl: JINAN_CMS_CONFIG.editorUrl, body: freshEditorHtml() },
    { status: 200, finalUrl: QUICK_UPLOAD_RESPONSE_URL, contentType: 'text/html', body: uploadSuccessBody('/uploads/2026/jinan.png', 37) },
    { status: 200, finalUrl: JINAN_CMS_CONFIG.editorUrl, body: freshEditorHtml() },
    { status: 302, finalUrl: JINAN_CMS_CONFIG.editorUrl, location: '/admin/index.php?op=time&sub=set&mesCode=1' },
    { status: 200, finalUrl: JINAN_CMS_CONFIG.publicUrl, body: publicHtml('/uploads/2026/jinan.png') },
    { status: 200, finalUrl: `${JINAN_CMS_CONFIG.origin}/uploads/2026/jinan.png`, contentType: 'image/png', body: pngBuffer() },
  ]);
  let credentialsRead = 0;
  const env = {
    JINAN_CMS_PUBLISH_ENABLED: 'true',
    get JINAN_CMS_USERNAME() { credentialsRead += 1; return 'synthetic-user'; },
    get JINAN_CMS_PASSWORD() { credentialsRead += 1; return 'synthetic-password'; },
  };

  const first = publishJinanCms({
    pngDataUrl: pngDataUrl(),
    callbackNumber: 37,
    env,
    transport: firstTransport,
    sleep: async () => {},
  });
  await Promise.resolve();

  const secondTransport = makeTransport([new Error('second must not call')]);
  const second = await publishJinanCms({
    pngDataUrl: 'data:image/png;base64,not-parsed-while-blocked',
    env,
    transport: secondTransport,
  });
  assert.deepEqual(second, { status: 'PUBLISH_IN_PROGRESS' });
  assert.equal(secondTransport.calls.length, 0);
  assert.equal(credentialsRead, 2);

  const injectedCoordinatorTransport = makeTransport([new Error('injected coordinator must not bypass active lock')]);
  const injectedCoordinator = await publishJinanCms({
    pngDataUrl: 'data:image/png;base64,not-parsed-while-blocked',
    env,
    transport: injectedCoordinatorTransport,
    coordinator: { inFlight: false, ambiguous: null },
  });
  assert.deepEqual(injectedCoordinator, { status: 'PUBLISH_IN_PROGRESS' });
  assert.equal(injectedCoordinatorTransport.calls.length, 0);
  assert.equal(credentialsRead, 2);

  releaseFirst();
  assert.equal((await first).status, 'PUBLISHED');

  const laterTransport = makeTransport([
    { status: 200, finalUrl: JINAN_CMS_CONFIG.publicUrl, body: publicCompositeHtml() },
    { status: 200, finalUrl: JINAN_CMS_CONFIG.loginUrl, body: loginHtml() },
    { status: 302, finalUrl: JINAN_CMS_CONFIG.loginUrl, location: '/admin/index.php', setCookie: ['sid=x; Path=/admin'] },
    loginSuccessLandingResponse(),
    { status: 200, finalUrl: JINAN_CMS_CONFIG.editorUrl, body: freshEditorHtml() },
    { status: 200, finalUrl: QUICK_UPLOAD_RESPONSE_URL, contentType: 'text/html', body: uploadSuccessBody('/uploads/2026/later.png', 37) },
    { status: 200, finalUrl: JINAN_CMS_CONFIG.editorUrl, body: freshEditorHtml() },
    { status: 302, finalUrl: JINAN_CMS_CONFIG.editorUrl, location: '/admin/index.php?op=time&sub=set&mesCode=1' },
    { status: 200, finalUrl: JINAN_CMS_CONFIG.publicUrl, body: publicHtml('/uploads/2026/later.png') },
    { status: 200, finalUrl: `${JINAN_CMS_CONFIG.origin}/uploads/2026/later.png`, contentType: 'image/png', body: pngBuffer() },
  ]);
  const later = await publishJinanCms({
    pngDataUrl: pngDataUrl(),
    callbackNumber: 37,
    env,
    transport: laterTransport,
    sleep: async () => {},
  });
  assert.equal(later.status, 'PUBLISHED');
});

test('M1b. production module exposes no coordinator reset or factory hooks', () => {
  reloadJinanCmsModule();
  const exports = require('../lib/jinan-cms.js');
  assert.equal(exports.resetJinanCmsCoordinatorForTests, undefined);
  assert.equal(exports.createRuntimeCoordinator, undefined);
  assert.equal(exports.normalizeAmbiguousState, undefined);
});

test('B. parser accepts a fresh exact CMS editor form and returns a fresh field map', () => {
  const first = parseCmsEditorForm(freshEditorHtml());
  const second = parseCmsEditorForm(freshEditorHtml().replace('fresh-token', 'new-token'));

  assert.equal(first.action, JINAN_CMS_CONFIG.editorUrl);
  assert.equal(first.method, 'POST');
  assert.equal(first.enctype, 'multipart/form-data');
  assert.deepEqual(first.fields, {
    mode: 'edit',
    csrf: 'fresh-token',
    version: '42',
    note: compositeTimetableNote(),
    wtitle: 'SEO title',
    wkeyword: 'SEO keyword',
    wdescription: 'SEO description',
    Submit: '送出',
  });
  assert.notEqual(first.fields, second.fields);
  assert.equal(second.fields.csrf, 'new-token');
});

test('C. parser fails closed on changed form contracts and allows unknown hidden fields only', () => {
  const good = freshEditorHtml();
  const badCases = [
    good.replace('name="addAdminFrm"', 'name="otherFrm"'),
    `${good}${good}`,
    good.replace(JINAN_CMS_CONFIG.editorUrl.replace('&', '&amp;'), '/admin/index.php?op=time'),
    good.replace('method="POST"', 'method="GET"'),
    good.replace('enctype="multipart/form-data"', 'enctype="application/x-www-form-urlencoded"'),
    good.replace('name="wtitle"', 'name="note"'),
    good.replace(`<textarea name="note">${compositeTimetableNote()}</textarea>`, ''),
    good.replace('<input type="text" name="wkeyword" value="SEO keyword">', ''),
    good.replace('name="mode" value="edit"', 'name="mode" value="add"'),
    freshEditorHtml('<input type="text" name="unproven" value="x">'),
    freshEditorHtml('<select name="choice"><option>x</option></select>'),
  ];

  for (const html of badCases) assertCode(() => parseCmsEditorForm(html), 'FORM_CHANGED');
  assert.equal(parseCmsEditorForm(freshEditorHtml('<input type="hidden" name="extra" value="ok">')).fields.extra, 'ok');
});

test('C2. login parser accepts only the exact safe login contract and never exposes credential values', () => {
  for (const action of [null, '', '/admin/login.php', JINAN_CMS_CONFIG.loginUrl]) {
    const parsed = parseLoginForm(loginHtml(action));
    assert.deepEqual(parsed, {
      action: JINAN_CMS_CONFIG.loginUrl,
      method: 'POST',
      enctype: 'application/x-www-form-urlencoded',
      controls: [
        { tag: 'input', type: 'hidden', name: 'mode' },
        { tag: 'input', type: 'text', name: 'username' },
        { tag: 'input', type: 'password', name: 'password' },
      ],
    });
    assert.equal(JSON.stringify(parsed).includes('synthetic-password'), false);
  }

  const bad = [
    '<form></form>',
    `${loginHtml()}${loginHtml()}`,
    loginHtml('https://attacker.example/admin/login.php'),
    loginHtml('/admin/other.php'),
    loginHtml(null).replace('method="POST"', 'method="GET"'),
    loginHtml(null).replace('enctype="application/x-www-form-urlencoded"', 'enctype="multipart/form-data"'),
    loginHtml(null).replace('name="mode" value="login"', 'name="mode" value="edit"'),
    loginHtml(null).replace('type="text" name="username"', 'type="hidden" name="username"'),
    loginHtml(null).replace('type="password" name="password"', 'type="text" name="password"'),
    loginHtml(null, '<input type="hidden" name="csrf" value="x">'),
  ];
  for (const html of bad) assertCode(() => parseLoginForm(html), 'FORM_CHANGED');
});

test('C2b. form parsers ignore fake forms and controls in excluded or attribute contexts', () => {
  for (const wrapper of [
    (inner) => `<!-- ${inner} -->`,
    (inner) => `<script>const html = ${JSON.stringify(inner)};</script>`,
    (inner) => `<style>${inner}</style>`,
    (inner) => `<template>${inner}</template>`,
    (inner) => `<noscript>${inner}</noscript>`,
    (inner) => `<xmp>${inner}</xmp>`,
    (inner) => `<iframe>${inner}</iframe>`,
    (inner) => `<noembed>${inner}</noembed>`,
    (inner) => `<noframes>${inner}</noframes>`,
  ]) {
    assertCode(() => parseLoginForm(wrapper(loginHtml())), 'FORM_CHANGED');
    assertCode(() => parseCmsEditorForm(wrapper(freshEditorHtml())), 'FORM_CHANGED');
  }

  assertCode(() => parseCmsEditorForm(
    freshEditorHtml().replace(
      '<input type="text" name="wtitle" value="SEO title">',
      '<!-- <input type="text" name="wtitle" value="SEO title"> -->',
    ),
  ), 'FORM_CHANGED');
  assertCode(() => parseCmsEditorForm(
    freshEditorHtml().replace(
      '<input type="text" name="wtitle" value="SEO title">',
      '<script>const fake = \'<input type="text" name="wtitle" value="SEO title">\';</script>',
    ),
  ), 'FORM_CHANGED');
  assertCode(() => parseCmsEditorForm(
    freshEditorHtml().replace(
      '<input type="hidden" name="mode" value="edit">',
      '<template><input type="hidden" name="mode" value="edit"></template>',
    ),
  ), 'FORM_CHANGED');
  assertCode(() => parseCmsEditorForm(
    freshEditorHtml().replace(
      '<input type="text" name="wtitle" value="SEO title">',
      '<div data-html=\'<input type="text" name="wtitle" value="SEO title">\'></div>',
    ),
  ), 'FORM_CHANGED');
  assertCode(() => parseLoginForm(
    loginHtml(null).replace(
      '<input type="text" name="username" value="">',
      '<div data-html=\'<input type="text" name="username" value="">\'></div>',
    ),
  ), 'FORM_CHANGED');

  for (const html of [
    `<section><div>${freshEditorHtml()}</section></div>`,
    `<section>${freshEditorHtml()}</main>`,
    `<section>${freshEditorHtml()}`,
  ]) {
    assertCode(() => parseCmsEditorForm(html), 'FORM_CHANGED');
  }
});

test('C2c. loginOnly diagnostic succeeds after login landing only and never touches publish URLs', async () => {
  const transport = makeTransport([
    { status: 200, finalUrl: JINAN_CMS_CONFIG.loginUrl, body: loginHtml(), setCookie: ['sid=login; Path=/admin; HttpOnly'] },
    { status: 302, finalUrl: JINAN_CMS_CONFIG.loginUrl, location: '/admin/index.php', setCookie: ['sid=submitted; Path=/admin; HttpOnly'] },
    loginSuccessLandingResponse(),
    new Error('success must stop immediately after landing'),
  ]);

  const result = await loginOnlyJinanCms({
    env: {
      JINAN_CMS_USERNAME: 'synthetic-user',
      JINAN_CMS_PASSWORD: 'synthetic-password',
    },
    transport,
    logger: () => {},
  });

  assert.deepEqual(result, { result: 'PASS', reasonCode: 'NONE', stage: 'LOGIN_CONFIRMED' });
  assert.deepEqual(transport.calls.map((call) => `${call.method} ${call.url}`), [
    `GET ${JINAN_CMS_CONFIG.loginUrl}`,
    `POST ${JINAN_CMS_CONFIG.loginUrl}`,
    `GET ${LOGIN_SUCCESS_LANDING_URL}`,
  ]);
  assert.equal(transport.calls.filter((call) => call.method === 'POST' && call.url === JINAN_CMS_CONFIG.loginUrl).length, 1);
  assert.equal(transport.calls.filter((call) => call.url.includes('QuickUpload')).length, 0);
  assert.equal(transport.calls.filter((call) => call.method === 'POST' && call.url === JINAN_CMS_CONFIG.editorUrl).length, 0);
  assert.equal(transport.calls.some((call) => call.url === JINAN_CMS_CONFIG.publicUrl), false);
  assert.equal(transport.calls.some((call) => call.url === JINAN_CMS_CONFIG.editorUrl), false);
});

test('C2d. loginOnly diagnostic reads credentials only from runtime env and sends one POST maximum', async () => {
  let usernameReads = 0;
  let passwordReads = 0;
  const env = {
    get JINAN_CMS_USERNAME() {
      usernameReads += 1;
      return 'runtime-user';
    },
    get JINAN_CMS_PASSWORD() {
      passwordReads += 1;
      return 'runtime-password';
    },
  };
  const transport = makeTransport([
    { status: 200, finalUrl: JINAN_CMS_CONFIG.loginUrl, body: loginHtml() },
    { status: 200, finalUrl: JINAN_CMS_CONFIG.loginUrl, body: loginHtml() },
  ]);

  const result = await loginOnlyJinanCms({
    username: 'body-user-must-not-be-read',
    password: 'body-password-must-not-be-read',
    credentials: { username: 'nested-user', password: 'nested-password' },
    env,
    transport,
  });

  assert.deepEqual(result, { result: 'FAIL', reasonCode: 'AUTH_FAILED', stage: 'LOGIN_POST' });
  assert.equal(usernameReads, 1);
  assert.equal(passwordReads, 1);
  assert.equal(transport.calls.length, 2);
  assert.equal(transport.calls.filter((call) => call.method === 'POST').length, 1);
  assert.equal(String(transport.calls[1].bodyKind), 'URLSearchParams');
  assert.equal(transport.calls.some((call) => call.url.includes('QuickUpload')), false);
  assert.equal(transport.calls.some((call) => call.method === 'POST' && call.url === JINAN_CMS_CONFIG.editorUrl), false);
});

test('C2d0. loginOnly diagnostic treats missing runtime credentials as VERIFY_FAILED without transport', async () => {
  const transport = makeTransport([
    new Error('missing credentials must stop before transport'),
  ]);

  const result = await loginOnlyJinanCms({
    env: {
      JINAN_CMS_USERNAME: '',
      JINAN_CMS_PASSWORD: '',
    },
    transport,
    logger: () => {},
  });

  assert.deepEqual(result, { result: 'FAIL', reasonCode: 'VERIFY_FAILED', stage: 'CREDENTIALS' });
  assert.equal(transport.calls.length, 0);
});

test('C2e. loginOnly diagnostic failures keep safe reason provenance and perform no mutations', async () => {
  const cases = [
    ['login GET status mismatch', [
      { status: 503, finalUrl: JINAN_CMS_CONFIG.loginUrl, body: loginHtml() },
    ], { result: 'FAIL', reasonCode: 'VERIFY_FAILED', stage: 'LOGIN_PAGE' }],
    ['login form changed', [
      { status: 200, finalUrl: JINAN_CMS_CONFIG.loginUrl, body: '<form></form>' },
    ], { result: 'FAIL', reasonCode: 'FORM_CHANGED', stage: 'LOGIN_PAGE' }],
    ['recognized credential rejection', [
      { status: 200, finalUrl: JINAN_CMS_CONFIG.loginUrl, body: loginHtml() },
      { status: 200, finalUrl: JINAN_CMS_CONFIG.loginUrl, body: loginHtml() },
    ], { result: 'FAIL', reasonCode: 'AUTH_FAILED', stage: 'LOGIN_POST' }],
    ['login post status mismatch', [
      { status: 200, finalUrl: JINAN_CMS_CONFIG.loginUrl, body: loginHtml() },
      { status: 303, finalUrl: JINAN_CMS_CONFIG.loginUrl, location: '/admin/index.php' },
    ], { result: 'FAIL', reasonCode: 'LOGIN_POST_STATUS_MISMATCH', stage: 'LOGIN_POST' }],
    ['login post final URL mismatch', [
      { status: 200, finalUrl: JINAN_CMS_CONFIG.loginUrl, body: loginHtml() },
      { status: 302, finalUrl: LOGIN_SUCCESS_LANDING_URL, location: '/admin/index.php' },
    ], { result: 'FAIL', reasonCode: 'LOGIN_POST_FINAL_URL_MISMATCH', stage: 'LOGIN_POST' }],
    ['login post location mismatch', [
      { status: 200, finalUrl: JINAN_CMS_CONFIG.loginUrl, body: loginHtml() },
      { status: 302, finalUrl: JINAN_CMS_CONFIG.loginUrl, location: LOGIN_SUCCESS_LANDING_URL },
    ], { result: 'FAIL', reasonCode: 'LOGIN_POST_LOCATION_MISMATCH', stage: 'LOGIN_POST' }],
    ['landing status mismatch', [
      { status: 200, finalUrl: JINAN_CMS_CONFIG.loginUrl, body: loginHtml() },
      { status: 302, finalUrl: JINAN_CMS_CONFIG.loginUrl, location: '/admin/index.php' },
      { status: 503, finalUrl: LOGIN_SUCCESS_LANDING_URL, body: '' },
    ], { result: 'FAIL', reasonCode: 'LOGIN_LANDING_STATUS_MISMATCH', stage: 'LOGIN_CONFIRMED' }],
    ['landing URL mismatch', [
      { status: 200, finalUrl: JINAN_CMS_CONFIG.loginUrl, body: loginHtml() },
      { status: 302, finalUrl: JINAN_CMS_CONFIG.loginUrl, location: '/admin/index.php' },
      { status: 200, finalUrl: JINAN_CMS_CONFIG.loginUrl, body: '' },
    ], { result: 'FAIL', reasonCode: 'LOGIN_LANDING_URL_MISMATCH', stage: 'LOGIN_CONFIRMED' }],
    ['landing redirect drift', [
      { status: 200, finalUrl: JINAN_CMS_CONFIG.loginUrl, body: loginHtml() },
      { status: 302, finalUrl: JINAN_CMS_CONFIG.loginUrl, location: '/admin/index.php' },
      { status: 200, finalUrl: LOGIN_SUCCESS_LANDING_URL, location: '', body: '' },
    ], { result: 'FAIL', reasonCode: 'LOGIN_LANDING_REDIRECT_DRIFT', stage: 'LOGIN_CONFIRMED' }],
    ['transport error', [
      { status: 200, finalUrl: JINAN_CMS_CONFIG.loginUrl, body: loginHtml() },
      new Error('network secret must not leak'),
    ], { result: 'FAIL', reasonCode: 'VERIFY_FAILED', stage: 'LOGIN_POST' }],
  ];

  for (const [name, responses, expected] of cases) {
    const transport = makeTransport(responses);
    const result = await loginOnlyJinanCms({
      env: {
        JINAN_CMS_USERNAME: 'synthetic-user',
        JINAN_CMS_PASSWORD: 'synthetic-password',
      },
      transport,
      logger: () => {},
    });
    assert.deepEqual(result, expected, name);
    assert.equal(transport.calls.filter((call) => call.method === 'POST' && call.url === JINAN_CMS_CONFIG.loginUrl).length <= 1, true, name);
    assert.equal(transport.calls.filter((call) => call.url.includes('QuickUpload')).length, 0, name);
    assert.equal(transport.calls.filter((call) => call.method === 'POST' && call.url === JINAN_CMS_CONFIG.editorUrl).length, 0, name);
    assert.equal(transport.calls.some((call) => call.url === JINAN_CMS_CONFIG.publicUrl), false, name);
    assert.equal(transport.calls.some((call) => call.url === JINAN_CMS_CONFIG.editorUrl), false, name);
  }
});

test('C2f. loginOnly diagnostic ignores adversarial transport code spoofing and throwing getters', async () => {
  const spoof = new Error('transport secret');
  spoof.code = 'FORM_CHANGED';
  const transportSpoof = makeTransport([
    spoof,
  ]);
  assert.deepEqual(await loginOnlyJinanCms({
    env: {
      JINAN_CMS_USERNAME: 'synthetic-user',
      JINAN_CMS_PASSWORD: 'synthetic-password',
    },
    transport: transportSpoof,
  }), { result: 'FAIL', reasonCode: 'VERIFY_FAILED', stage: 'LOGIN_PAGE' });

  const bodyGetterResponse = {
    status: 200,
    finalUrl: JINAN_CMS_CONFIG.loginUrl,
  };
  Object.defineProperty(bodyGetterResponse, 'body', {
    enumerable: true,
    get() {
      const error = new Error('getter secret');
      error.code = 'FORM_CHANGED';
      throw error;
    },
  });
  const getterSpoof = makeTransport([
    bodyGetterResponse,
  ]);
  assert.deepEqual(await loginOnlyJinanCms({
    env: {
      JINAN_CMS_USERNAME: 'synthetic-user',
      JINAN_CMS_PASSWORD: 'synthetic-password',
    },
    transport: getterSpoof,
  }), { result: 'FAIL', reasonCode: 'VERIFY_FAILED', stage: 'LOGIN_PAGE' });

  assert.equal(transportSpoof.calls.some((call) => call.url.includes('QuickUpload')), false);
  assert.equal(getterSpoof.calls.some((call) => call.url.includes('QuickUpload')), false);
});

test('C3. editor parser allows same endpoint absent, empty, relative, or absolute action only', () => {
  for (const action of [null, '', '/admin/index.php?op=time&sub=set', JINAN_CMS_CONFIG.editorUrl]) {
    const html = freshEditorHtml().replace(
      / action="[^"]+"/,
      action === null ? '' : ` action="${String(action).replace(/&/g, '&amp;')}"`,
    );
    assert.equal(parseCmsEditorForm(html).action, JINAN_CMS_CONFIG.editorUrl);
  }

  for (const action of ['/admin/index.php?op=time', 'https://attacker.example/admin/index.php?op=time&sub=set']) {
    const html = freshEditorHtml().replace(/ action="[^"]+"/, ` action="${String(action).replace(/&/g, '&amp;')}"`);
    assertCode(() => parseCmsEditorForm(html), 'FORM_CHANGED');
  }
});

test('C4. parser fails closed on duplicate attributes case-insensitively without last-write wins', () => {
  const editor = freshEditorHtml();
  const expectedAction = JINAN_CMS_CONFIG.editorUrl.replace(/&/g, '&amp;');
  const badEditorCases = [
    editor.replace(`action="${expectedAction}"`, `action="https://attacker.example/admin/index.php?op=time&amp;sub=set" ACTION="${expectedAction}"`),
    editor.replace('method="POST"', 'method="GET" METHOD="POST"'),
    editor.replace('type="text" name="wtitle"', 'type="hidden" TYPE="text" name="wtitle"'),
    editor.replace('type="text" name="wtitle"', 'type="text" name="attacker" NAME="wtitle"'),
    editor.replace('name="mode" value="edit"', 'name="mode" value="add" VALUE="edit"'),
  ];
  for (const html of badEditorCases) assertCode(() => parseCmsEditorForm(html), 'FORM_CHANGED');

  const login = loginHtml();
  const badLoginCases = [
    login.replace('method="POST"', 'method="GET" METHOD="POST"'),
    login.replace('type="text" name="username"', 'type="hidden" TYPE="text" name="username"'),
    login.replace('type="text" name="username"', 'type="text" name="shadow" NAME="username"'),
    login.replace('name="mode" value="login"', 'name="mode" value="edit" VALUE="login"'),
  ];
  for (const html of badLoginCases) assertCode(() => parseLoginForm(html), 'FORM_CHANGED');
});

test('C5. form parser requires complete strict attribute sequencing', () => {
  assert.equal(parseLoginForm(loginHtml()).action, JINAN_CMS_CONFIG.loginUrl);
  assert.equal(parseCmsEditorForm(freshEditorHtml()).action, JINAN_CMS_CONFIG.editorUrl);

  for (const html of [
    loginHtml().replace('name="loginForm" action=', 'name="loginForm"action='),
    loginHtml().replace('type="hidden" name="mode"', 'type="hidden"name="mode"'),
    loginHtml().replace('name="loginForm"', 'name="loginForm",'),
    loginHtml().replace('name="mode" value="login"', 'name="mode" value="login";'),
    loginHtml().replace('name="username" value=""', 'name="username" value=">"'),
    loginHtml().replace('name="password" value=""', 'name="password" value="unterminated'),
    loginHtml().replace('name="password" value=""', 'name="password" value=<bad>'),
  ]) {
    assertCode(() => parseLoginForm(html), 'FORM_CHANGED');
  }

  assert.equal(parseCmsEditorForm(freshEditorHtml().replace(
    '<input type="hidden" name="csrf" value="fresh-token">',
    '<input type="hidden" name="csrf" value="fresh-token"/>',
  )).fields.csrf, 'fresh-token');
  assert.equal(parseCmsEditorForm(freshEditorHtml('<input type="hidden" name="extra" value="ok" data-flag/>')).fields.extra, 'ok');
  assert.equal(parseCmsEditorForm(freshEditorHtml('<input/>')).action, JINAN_CMS_CONFIG.editorUrl);
});

test('C6. parser keeps boolean attribute lookahead from consuming following attribute whitespace', () => {
  assert.equal(parseCmsEditorForm(freshEditorHtml('<input type="hidden" name="extra" value="ok" data-flag data-next="yes">')).fields.extra, 'ok');

  for (const html of [
    loginHtml().replace('type="hidden" name="mode"', 'type="hidden"disabled name="mode"'),
    freshEditorHtml('<input type="hidden" name="extra" value="ok" data-flag data-flag>'),
    freshEditorHtml('<input type="hidden" name="extra" value="ok" data-flag / data-next="bad">'),
  ]) {
    assertCode(() => parseCmsEditorForm(html), 'FORM_CHANGED');
  }
});

test('D. submit request validates final upload path without filename-target assumptions', () => {
  const parsed = parseCmsEditorForm(freshEditorHtml());
  for (const url of [
    'https://www.tainanrehab.com/upload/new.png',
    '//www.tainanrehab.com/upload/new.png',
    '/admin/new.png',
    '/upload/../x.png',
    '/upload/new.png?x=1',
    '/upload/new.png#x',
    '/upload/%2e%2e/x.png',
    '/upload/a%2fb.png',
    '/upload/a\\b.png',
    '/upload/a\u0000b.png',
  ]) {
    assertCode(() => buildSubmitRequest(parsed, url), 'FORM_CHANGED');
  }
});

test('D2. submit request replaces one proven timetable image collection with one composite image', () => {
  const parsed = parseCmsEditorForm(freshCompositeEditorHtml());
  const originalNote = parsed.fields.note;
  const request = buildSubmitRequest(parsed, '/uploads/2026/jinan-composite.png');
  const rewritten = request.multipartFields.note;

  assert.equal(request.method, 'POST');
  assert.equal(request.url, JINAN_CMS_CONFIG.editorUrl);
  assert.equal(request.multipartFields.wtitle, 'SEO title');
  assert.equal(request.multipartFields.wkeyword, 'SEO keyword');
  assert.equal(request.multipartFields.wdescription, 'SEO description');
  assert.equal(request.multipartFields.csrf, 'fresh-token');
  assert.equal(rewritten, originalNote.replace(
    timetableImageTail(),
    '<img src="/uploads/2026/jinan-composite.png" />',
  ));
  assert.equal(rewritten.includes('/images/line-icon.png'), true);
  assert.equal(rewritten.includes('https://lin.ee/appointment'), true);
  assert.equal(rewritten.includes('/images/unrelated-footer.png'), true);
  for (const oldImage of TIMETABLE_OLD_IMAGES) assert.equal(rewritten.includes(oldImage), false);
  assert.equal((rewritten.match(/\/uploads\/2026\/jinan-composite\.png/g) || []).length, 1);
  assert.equal(rewritten.includes('width: 1280px'), false);
  assert.equal(rewritten.includes('height: 720px'), false);
});

test('D2a. submit request replaces real production anchored timetable images and preserves prefix bytes', () => {
  const note = realProductionCompositeNote(REAL_LEGACY_TIMETABLE_OLD_IMAGES);
  const parsed = parseCmsEditorForm(freshCompositeEditorHtml({ note }));
  const request = buildSubmitRequest(parsed, '/uploads/2026/jinan-composite.png');
  const rewritten = request.multipartFields.note;
  const firstImage = '<img alt="" src="/upload/photo_2026-09-02 23_08_57(1).jpeg" />';
  const tailStart = note.indexOf(firstImage);
  const tailEnd = note.indexOf('</p>', tailStart);
  const prefix = note.slice(0, tailStart);
  const suffix = note.slice(tailEnd);

  assert.notEqual(tailStart, -1);
  assert.equal(rewritten, `${prefix}<img src="/uploads/2026/jinan-composite.png" />${suffix}`);
  assert.equal(rewritten.startsWith(prefix), true);
  assert.equal(rewritten.includes('<img src="/img/icon-next.svg" alt="">'), true);
  assert.equal(rewritten.includes('線上預約'), true);
  assert.equal(rewritten.includes('https://lin.ee/appointment'), true);
  assert.equal(rewritten.includes('<strong><span style="font-size:16px;">----------------------------------------------------------</span></strong>'), true);
  assert.equal(rewritten.includes('１１５年９月醫師常規門診、門診異動及週六門診時間，詳情請往下參閱！'), true);
  for (const oldImage of REAL_LEGACY_TIMETABLE_OLD_IMAGES) assert.equal(rewritten.includes(oldImage), false);
  assert.equal((rewritten.match(/\/uploads\/2026\/jinan-composite\.png/g) || []).length, 1);
});

test('D2a0. submit request rejects staff photo near-miss with weak timetable wording', () => {
  const note = '<section class="notice">門診異動請以現場公告為準</section>'
    + '<p class="text-center" style="text-align: center;">'
    + '<span>門診時間攝影紀錄</span><br />'
    + '<img src="/upload/staff1.png"><br>'
    + '<img src="/upload/staff2.png"><br>'
    + '<img src="/upload/staff3.png"><br>'
    + '<img src="/upload/staff4.png">'
    + '</p>'
    + '<p><img src="/images/unrelated-footer.png" alt="map"></p>';
  assertCode(
    () => buildSubmitRequest(parseCmsEditorForm(freshCompositeEditorHtml({ note })), '/uploads/2026/jinan-composite.png'),
    'FORM_CHANGED',
  );
});

test('D2a0r. submit request rejects exact reviewer staff prose and image structure', () => {
  const note = '<section class="notice">門診異動請以現場公告為準</section>'
    + reviewerStaffTimetableNearMissBlock()
    + '<p><img src="/images/unrelated-footer.png" alt="map"></p>';

  assertCode(
    () => buildSubmitRequest(parseCmsEditorForm(freshCompositeEditorHtml({ note })), '/uploads/2026/jinan-composite.png'),
    'FORM_CHANGED',
  );
});

test('D2a0b. submit request requires every stable timetable prefix phrase', () => {
  const stablePhrase = '１１５年９月醫師常規門診、門診異動及週六門診時間，詳情請往下參閱！';
  const cases = [
    ['醫師', (note) => note.replace(stablePhrase, stablePhrase.replace('醫師', '人員'))],
    ['常規門診', (note) => note.replace(stablePhrase, stablePhrase.replace('常規門診', '一般時段'))],
    ['門診異動', (note) => note.replace(stablePhrase, stablePhrase.replace('門診異動', '公告更新'))],
    ['週六門診', (note) => note.replace(stablePhrase, stablePhrase.replace('週六門診', '週末診療'))],
    ['時間', (note) => note
      .replace('門診時間如有異動，請以現場公告為準', '門診時段如有異動，請以現場公告為準')
      .replace(stablePhrase, stablePhrase.replace('時間', '時段'))],
  ];

  for (const [name, mutate] of cases) {
    const note = mutate(compositeTimetableNote());
    assertCode(
      () => buildSubmitRequest(parseCmsEditorForm(freshCompositeEditorHtml({ note })), '/uploads/2026/jinan-composite.png'),
      'FORM_CHANGED',
      name,
    );
  }
});

test('D2a0c. submit request accepts only confirmed timetable visible-text grammar', () => {
  const validCases = [
    ['real baseline separator variant', realProductionCompositeNote(REAL_LEGACY_TIMETABLE_OLD_IMAGES)],
    ['existing reminder fixture', compositeTimetableNote()],
    ['future ascii year month', compositeTimetableNote().replace(
      '１１５年９月醫師常規門診、門診異動及週六門診時間，詳情請往下參閱！',
      '116年10月醫師常規門診、門診異動及週六門診時間，詳情請往下參閱！',
    )],
    ['future full-width one digit month', compositeTimetableNote().replace(
      '１１５年９月醫師常規門診、門診異動及週六門診時間，詳情請往下參閱！',
      '１１６年１月醫師常規門診、門診異動及週六門診時間，詳情請往下參閱！',
    )],
    ['supported numeric entities', compositeTimetableNote().replace(
      '１１５年９月醫師常規門診、門診異動及週六門診時間，詳情請往下參閱！',
      '&#65297;&#65297;&#65301;年&#65305;月醫師常規門診、門診異動及週六門診時間，詳情請往下參閱&#65281;',
    )],
  ];

  for (const [name, note] of validCases) {
    assert.doesNotThrow(
      () => buildSubmitRequest(parseCmsEditorForm(freshCompositeEditorHtml({ note })), '/uploads/2026/jinan-composite.png'),
      name,
    );
  }
});

test('D2a0d. submit request rejects timetable visible-text grammar near misses', () => {
  const heading = '１１５年９月醫師常規門診、門診異動及週六門診時間，詳情請往下參閱！';
  const cases = [
    ['reviewer staff text', '<span style="font-size: 18px;">醫師團隊活動照片；常規門診、門診異動與週六門診時間請見另頁。</span>'],
    ['heading plus staff prose', `<span style="font-size: 18px;">${heading}醫師團隊活動照片</span>`],
    ['duplicate heading', `<span style="font-size: 18px;">${heading}</span><br /><span style="font-size: 18px;">${heading}</span>`],
    ['malformed year', '<span style="font-size: 18px;">１１年９月醫師常規門診、門診異動及週六門診時間，詳情請往下參閱！</span>'],
    ['malformed month', '<span style="font-size: 18px;">１１５年９９９月醫師常規門診、門診異動及週六門診時間，詳情請往下參閱！</span>'],
    ['punctuation change', '<span style="font-size: 18px;">１１５年９月醫師常規門診、門診異動及週六門診時間，詳情請往下參閱。</span>'],
    ['conjunction change', '<span style="font-size: 18px;">１１５年９月醫師常規門診、門診異動與週六門診時間，詳情請往下參閱！</span>'],
    ['omitted heading tail', '<span style="font-size: 18px;">１１５年９月醫師常規門診、門診異動及週六門診時間</span>'],
  ];

  for (const [name, prefix] of cases) {
    const note = '<section class="notice">門診異動請以現場公告為準</section>'
      + '<p class="text-center" style="text-align: center;">'
      + `${prefix}<br />`
      + timetableImageTail()
      + '</p>'
      + '<p><img src="/images/unrelated-footer.png" alt="map"></p>';
    assertCode(
      () => buildSubmitRequest(parseCmsEditorForm(freshCompositeEditorHtml({ note })), '/uploads/2026/jinan-composite.png'),
      'FORM_CHANGED',
      name,
    );
  }
});

test('D2a1. legacy existing timetable image source validation rejects dangerous ambiguity', () => {
  const badLegacySources = [
    '//www.tainanrehab.com/upload/old.png',
    'https://www.tainanrehab.com/upload/old.png',
    'https://evil.example/upload/old.png',
    '/images/old.png',
    '/upload/old.png?x=1',
    '/upload/old.png#x',
    '/upload/a\u0000b.png',
    '/upload/a\\b.png',
    '/upload/../old.png',
    '/upload/%2e%2e/old.png',
    '/upload/%252e%252e/old.png',
    '/upload/%2fsecret.png',
    '/upload/%252fsecret.png',
    '/upload/bad%zz.png',
    '/upload/literal%25percent.png',
  ];

  for (const legacySource of badLegacySources) {
    const note = realProductionCompositeNote([
      legacySource,
      REAL_LEGACY_TIMETABLE_OLD_IMAGES[1],
      REAL_LEGACY_TIMETABLE_OLD_IMAGES[2],
      REAL_LEGACY_TIMETABLE_OLD_IMAGES[3],
    ]);
    assertCode(
      () => buildSubmitRequest(parseCmsEditorForm(freshCompositeEditorHtml({ note })), '/uploads/2026/jinan-composite.png'),
      'FORM_CHANGED',
      legacySource,
    );
  }
});

test('D2b. submit request rejects unrelated unique two-image gallery without the timetable envelope', () => {
  const note = '<section class="notice">門診異動請以現場公告為準</section>'
    + '<div class="appointment"><a href="https://lin.ee/appointment">線上預約<img src="/images/line-icon.png" alt="LINE"></a></div>'
    + '<p class="gallery"><img src="/upload/gallery-a.png"><br><img src="/upload/gallery-b.png"></p>'
    + '<p><img src="/images/unrelated-footer.png" alt="map"></p>';
  assertCode(() => buildSubmitRequest(parseCmsEditorForm(freshCompositeEditorHtml({ note })), '/upload/new.png'), 'FORM_CHANGED');
});

test('D2c. submit request replaces one previously migrated anchored composite image with a later composite image', () => {
  const note = '<section class="notice">門診異動請以現場公告為準</section>'
    + '<div class="appointment"><a href="https://lin.ee/appointment">線上預約<img src="/images/line-icon.png" alt="LINE"></a></div>'
    + singleCompositeTimetableBlock('/uploads/2026/old-composite.png')
    + '<p><img src="/images/unrelated-footer.png" alt="map"></p>';
  const request = buildSubmitRequest(parseCmsEditorForm(freshCompositeEditorHtml({ note })), '/uploads/2026/new-composite.png');

  assert.equal(request.multipartFields.note, note.replace(
    '<img alt="" src="/uploads/2026/old-composite.png" />',
    '<img src="/uploads/2026/new-composite.png" />',
  ));
  assert.equal(request.multipartFields.note.includes('/uploads/2026/old-composite.png'), false);
});

test('D3. submit request rejects zero, multiple, and malformed timetable collections', () => {
  for (const note of [
    '<p><img src="/images/only-one.png"></p>',
    '<p>plain timetable text only</p>',
    '<p><img src="/a.png"><br><img src="/b.png"></p><p><img src="/c.png"><br><img src="/d.png"></p>',
    '<p><img src="/a.png">x<img src="/b.png"></p>',
    '<p><img src="/a.png"><span></span><img src="/b.png"></p>',
    '<p><a href="/x"><img src="/a.png"></a><br><img src="/b.png"></p>',
    '<p><img src="/a.png"><br><a href="/x">link</a><br><img src="/b.png"></p>',
    '<p><img src="/a.png"><br><img src="/b.png" hidden></p>',
    '<p><img src="/a.png"><br><img style="width:100%" src="/b.png"></p>',
    '<p><img src="/a.png"><br><div><img src="/b.png"></div></p>',
    '<p><img src="/a.png" src="/shadow.png"><br><img src="/b.png"></p>',
    '<p><img src="/a.png"data-x="y"><br><img src="/b.png"></p>',
    '<p><img src="/a.png"><br><img></p>',
    '<main><p><img src="/a.png"><br><img src="/b.png"></p>',
    '<main><span><img src="/a.png"><br><img src="/b.png"></main></span>',
    '<custom-widget/><p><img src="/a.png"><br><img src="/b.png"></p>',
    compositeTimetableNote(['/upload/a.png', '/upload/b.png', '/upload/c.png', '/upload/d.png']) + timetableBlock(['/upload/e.png', '/upload/f.png', '/upload/g.png', '/upload/h.png']),
    compositeTimetableNote(['/upload/a.png', '/upload/b.png', '/upload/c.png', '/upload/d.png']).replace(timetableBlock(['/upload/a.png', '/upload/b.png', '/upload/c.png', '/upload/d.png']), singleCompositeTimetableBlock('/upload/existing.png') + singleCompositeTimetableBlock('/upload/second.png')),
    compositeTimetableNote().replace('style="text-align: center;"', 'style="text-align: center; color: red;"'),
    compositeTimetableNote().replace('style="text-align: center;"', 'style="display: none; text-align: center;"'),
    compositeTimetableNote().replace('style="width: 1280px; height: 720px;"', 'style="width: 1280px; height: 720px; border: 0;"'),
    compositeTimetableNote().replace('style="width: 1280px; height: 720px;"', 'style="visibility: hidden;"'),
    compositeTimetableNote().replace('<span style="font-size: 24px;">１１５年９月醫師常規門診、門診異動及週六門診時間，詳情請往下參閱！</span>', '<em>１１５年９月醫師常規門診、門診異動及週六門診時間，詳情請往下參閱！</em>'),
    compositeTimetableNote().replace('<span style="font-size: 24px;">１１５年９月醫師常規門診、門診異動及週六門診時間，詳情請往下參閱！</span>', '<span hidden style="font-size: 24px;">１１５年９月醫師常規門診、門診異動及週六門診時間，詳情請往下參閱！</span>'),
    compositeTimetableNote().replace('<span style="font-size: 24px;">１１５年９月醫師常規門診、門診異動及週六門診時間，詳情請往下參閱！</span>', '<span style="display: none;">１１５年９月醫師常規門診、門診異動及週六門診時間，詳情請往下參閱！</span>'),
    compositeTimetableNote().replace('<span style="font-size: 24px;">１１５年９月醫師常規門診、門診異動及週六門診時間，詳情請往下參閱！</span>', '<a href="/time.html">１１５年９月醫師常規門診、門診異動及週六門診時間，詳情請往下參閱！</a>'),
    compositeTimetableNote().replace('<span style="font-size: 24px;">１１５年９月醫師常規門診、門診異動及週六門診時間，詳情請往下參閱！</span>', '<span style="font-size: 24px;">１１５年９月醫師常規門診、門診異動及週六門診時間，詳情請往下參閱！<img src="/upload/prefix.png"></span>'),
    compositeTimetableNote() + '<p class="text-center" style="text-align: center;">額外置中段落</p>',
  ]) {
    const html = freshCompositeEditorHtml({ note });
    assertCode(() => buildSubmitRequest(parseCmsEditorForm(html), '/upload/new.png'), 'FORM_CHANGED');
  }
});

test('D4. submit request rejects old image residue outside the proven collection', () => {
  const note = `${compositeTimetableNote()}<p>${TIMETABLE_OLD_IMAGES[1]}</p>`;
  assertCode(() => buildSubmitRequest(parseCmsEditorForm(freshCompositeEditorHtml({ note })), '/upload/new.png'), 'FORM_CHANGED');
});

test('D4b. submit request rejects percent-encoded old image residue outside the proven collection', () => {
  const oldImages = ['/upload/a%20b.png', '/upload/yian.png', '/upload/changes.png', '/upload/saturday.png'];
  const note = `${compositeTimetableNote(oldImages)}<p><img src="/upload/a%20b.png" alt="legacy copy"></p>`;
  assertCode(() => buildSubmitRequest(parseCmsEditorForm(freshCompositeEditorHtml({ note })), '/upload/new.png'), 'FORM_CHANGED');
});

test('D4c. submit request rejects old image residue in all source contexts before mutation', () => {
  const oldImages = ['/upload/a%20b.png', '/upload/yian.png', '/upload/changes.png', '/upload/saturday.png'];
  const base = compositeTimetableNote(oldImages);
  const cases = [
    ['img srcset candidate', '<p><img src="/images/footer.png" srcset="/upload/a%2520b.png 2x, /images/footer-large.png 3x"></p>'],
    ['picture source src and srcset', '<picture><source src="/upload/a%20b.png" srcset="/images/footer.png 1x, /upload/a%2520b.png 2x"><img src="/images/footer.png"></picture>'],
    ['hidden ancestor img src', '<div hidden><img src="/upload/a%2520b.png"></div>'],
    ['self-hidden img src', '<img hidden src="/upload/a%2520b.png">'],
    ['aria-hidden ancestor img src', '<div aria-hidden="true"><img src="/upload/a%2520b.png"></div>'],
    ['active href resource', '<a href="/upload/a%2520b.png">old</a>'],
    ['active other resource attr', '<object data="/upload/a%2520b.png"></object>'],
    ['comment residue', '<!-- <img src=/upload/a&#37;20b.png> -->'],
    ['script raw text residue', '<script>const old="/upload/a%2520b.png";</script>'],
    ['style raw text residue', '<style>.x{background:url("/upload/a%2520b.png")}</style>'],
    ['template raw text residue', '<template><img src="/upload/a%2520b.png"></template>'],
    ['noscript raw text residue', '<noscript><img src="/upload/a%2520b.png"></noscript>'],
    ['numeric entity percent', '<p>/upload/a&#37;20b.png</p>'],
  ];

  for (const [name, residue] of cases) {
    const note = `${base}${residue}`;
    assertCode(
      () => buildSubmitRequest(parseCmsEditorForm(freshCompositeEditorHtml({ note })), '/uploads/2026/new-composite.png'),
      'FORM_CHANGED',
      name,
    );
  }

  const slashImages = ['/upload/a/b.png', '/upload/yian.png', '/upload/changes.png', '/upload/saturday.png'];
  for (const residue of ['/upload/a&#47;b.png', '/upload/a&#x2f;b.png']) {
    const note = `${compositeTimetableNote(slashImages)}<p>${residue}</p>`;
    assertCode(
      () => buildSubmitRequest(parseCmsEditorForm(freshCompositeEditorHtml({ note })), '/uploads/2026/new-composite.png'),
      'FORM_CHANGED',
      residue,
    );
  }

  for (let layers = 1; layers <= 8; layers += 1) {
    const encoded = percentEncodeLayers('/upload/a b.png', layers);
    const oldLayeredImages = ['/upload/a b.png', '/upload/yian.png', '/upload/changes.png', '/upload/saturday.png'];
    const note = `${compositeTimetableNote(oldLayeredImages)}<p>${encoded}</p>`;
    assertCode(
      () => buildSubmitRequest(parseCmsEditorForm(freshCompositeEditorHtml({ note })), '/uploads/2026/new-composite.png'),
      'FORM_CHANGED',
      `percent layers ${layers}`,
    );
  }
});

test('D4d. submit request preserves unrelated image references while rejecting only legacy identities', () => {
  const parsed = parseCmsEditorForm(freshCompositeEditorHtml());
  const request = buildSubmitRequest(parsed, '/uploads/2026/new-composite.png');
  assert.equal(request.multipartFields.note.includes('/images/unrelated-footer.png'), true);
  assert.equal(request.multipartFields.note.includes('/images/line-icon.png'), true);
});

test('D5. parser decodes supported numeric entities and fails closed on unknown entity tokens', () => {
  const decimal = parseCmsEditorForm(freshEditorHtml('<input type="hidden" name="extra" value="a&#38;b">'));
  assert.equal(decimal.fields.extra, 'a&b');
  assert.equal(
    buildSubmitRequest(decimal, '/upload/new.png').multipartFields.extra,
    'a&b',
  );

  const hex = parseCmsEditorForm(freshEditorHtml('<input type="hidden" name="extra" value="a&#x26;b">'));
  assert.equal(hex.fields.extra, 'a&b');
  assert.equal(
    buildSubmitRequest(hex, '/upload/new.png').multipartFields.extra,
    'a&b',
  );

  for (const entity of ['&#0;', '&#x0;', '&#128;', '&#x80;', '&#x110000;', '&#55296;', '&#xD800;', '&#xzz;', '&#;', '&#38b', '&#x26b', '&#', '&copy;']) {
    assertCode(() => parseCmsEditorForm(freshEditorHtml(`<input type="hidden" name="extra" value="${entity}">`)), 'FORM_CHANGED');
  }

  const literalAmpersand = parseCmsEditorForm(freshEditorHtml('<input type="hidden" name="extra" value="a&b=1">'));
  assert.equal(literalAmpersand.fields.extra, 'a&b=1');
});

test('E. upload request builds exact QuickUpload descriptor with PNG metadata', () => {
  const request = buildUploadRequest({ png: Buffer.from('png'), callbackNumber: 37 });
  assert.equal(request.method, 'POST');
  assert.equal(request.url, `${JINAN_CMS_CONFIG.quickUploadUrl}?command=QuickUpload&type=Images&CKEditor=note&CKEditorFuncNum=37&langCode=zh`);
  assert.equal(request.multipartFieldName, 'upload');
  assert.deepEqual(request.file, {
    filename: 'jinan-clinic-timetable-composite.png',
    contentType: 'image/png',
    byteLength: 3,
    content: Buffer.from('png'),
  });
  assertCode(() => buildUploadRequest({ png: Buffer.from('png'), callbackNumber: -1 }), 'FORM_CHANGED');
  assertCode(() => buildUploadRequest({ png: Buffer.from('png'), callbackNumber: 1.2 }), 'FORM_CHANGED');
});

test('F. upload response parser verifies one complete CKEditor callback and fails closed', () => {
  const expectedRequestUrl = `${JINAN_CMS_CONFIG.quickUploadUrl}?command=QuickUpload&type=Images&CKEditor=note&CKEditorFuncNum=37&langCode=zh`;
  assert.deepEqual(parseUploadResponse({ status: 500, body: 'x' }), { status: 'UPLOAD_FAILED' });
  assert.deepEqual(parseUploadResponse({
    status: 200,
    finalUrl: expectedRequestUrl,
    contentType: 'Text/HTML; charset=utf-8',
    body: ` \n${uploadSuccessBody('/uploads/2026/jinan.png', 37)} ; \n`,
  }, expectedRequestUrl, 37), { status: 'UPLOAD_SUCCEEDED', finalImageUrl: '/uploads/2026/jinan.png' });
  assert.deepEqual(parseUploadResponse({
    status: 200,
    finalUrl: expectedRequestUrl,
    headers: { 'content-type': 'text/html' },
    body: 'window.parent.CKEDITOR.tools.callFunction(37,"/upload/new.png","")',
  }, expectedRequestUrl, 37), { status: 'UPLOAD_SUCCEEDED', finalImageUrl: '/upload/new.png' });
  assert.deepEqual(parseUploadResponse({
    status: 200,
    finalUrl: expectedRequestUrl,
    contentType: 'text/html',
    body: uploadSuccessBody('/uploads/2026/%E6%B8%AC%E8%A9%A6.png', 37),
  }, expectedRequestUrl, 37), { status: 'UPLOAD_SUCCEEDED', finalImageUrl: '/uploads/2026/%E6%B8%AC%E8%A9%A6.png' });
  assert.deepEqual(parseUploadResponse({
    status: 200,
    finalUrl: expectedRequestUrl,
    contentType: 'text/html',
    body: uploadSuccessBody('/upload/%E9%96%80%E8%A8%BA%20schedule.png', 37),
  }, expectedRequestUrl, 37), { status: 'UPLOAD_SUCCEEDED', finalImageUrl: '/upload/%E9%96%80%E8%A8%BA%20schedule.png' });

  let excessiveNestedUnicode = '%E6%B8%AC%E8%A9%A6.png';
  for (let index = 0; index < 10; index += 1) excessiveNestedUnicode = encodeURIComponent(excessiveNestedUnicode);

  for (const response of [
    { status: 201, contentType: 'text/html', body: uploadSuccessBody('/uploads/2026/jinan.png', 37) },
    { status: 200, contentType: 'application/json', body: uploadSuccessBody('/uploads/2026/jinan.png', 37) },
    { status: 200, finalUrl: 'https://attacker.example/x', contentType: 'text/html', body: uploadSuccessBody('/uploads/2026/jinan.png', 37) },
    { status: 200, finalUrl: `${expectedRequestUrl}&extra=1`, contentType: 'text/html', body: uploadSuccessBody('/uploads/2026/jinan.png', 37) },
    { status: 200, finalUrl: expectedRequestUrl, location: '/admin/index.php', contentType: 'text/html', body: uploadSuccessBody('/uploads/2026/jinan.png', 37) },
    { status: 200, contentType: 'text/html', body: uploadSuccessBody('/uploads/2026/jinan.png', 37) },
    { status: 200, contentType: 'text/html', body: `${uploadSuccessBody('/uploads/2026/jinan.png', 37)}${uploadSuccessBody('/uploads/other.png', 37)}` },
    { status: 200, contentType: 'text/html', body: `${uploadSuccessBody('/uploads/2026/jinan.png', 37)} alert(1)` },
    { status: 200, contentType: 'text/html', body: uploadSuccessBody('/uploads/2026/jinan.png', 38) },
    { status: 200, contentType: 'text/html', body: uploadSuccessBody('/uploads/2026/jinan.png', 37, 'ok') },
    { status: 200, contentType: 'text/html', body: uploadSuccessBody('https://www.tainanrehab.com/uploads/2026/jinan.png', 37) },
    { status: 200, contentType: 'text/html', body: uploadSuccessBody('//www.tainanrehab.com/uploads/2026/jinan.png', 37) },
    { status: 200, contentType: 'text/html', body: uploadSuccessBody('/uploads/2026/jinan.png?x=1', 37) },
    { status: 200, contentType: 'text/html', body: uploadSuccessBody('/uploads/../jinan.png', 37) },
    { status: 200, contentType: 'text/html', body: uploadSuccessBody('/uploads/%2e%2e/jinan.png', 37) },
    { status: 200, contentType: 'text/html', body: uploadSuccessBody('/uploads/%252e%252e/jinan.png', 37) },
    { status: 200, finalUrl: expectedRequestUrl, contentType: 'text/html', body: uploadSuccessBody('/uploads/%2525252e%2525252e/secret.png', 37) },
    { status: 200, finalUrl: expectedRequestUrl, contentType: 'text/html', body: uploadSuccessBody(`/uploads/${excessiveNestedUnicode}`, 37) },
    { status: 200, contentType: 'text/html', body: uploadSuccessBody('/uploads/a\\b.png', 37) },
    { status: 200, contentType: 'text/html', body: uploadSuccessBody('/uploads/a\u0085b.png', 37) },
    { status: 200, contentType: 'text/html', body: '<script>window.parent.CKEDITOR.tools.callFunction(37,"/uploads/bad.png","\\x")</script>' },
    { status: 200, contentType: 'text/html', body: '<script src="/x.js"></script>' },
    { status: 200, contentType: 'text/html', body: '<script async>window.parent.CKEDITOR.tools.callFunction(37,"/uploads/bad.png","")</script>' },
    { status: 200, contentType: 'text/html', body: 'ok' },
  ]) {
    assert.deepEqual(parseUploadResponse(response, expectedRequestUrl, 37), { status: 'CMS_RESPONSE_CONTRACT_UNVERIFIED' });
  }
  assert.notEqual(parseUploadResponse({ status: 200, body: 'published' }).status, 'PUBLISHED');
});

test('F2. submit response parser verifies exact safe redirect contract and fails closed', () => {
  assert.deepEqual(parseSubmitResponse({ status: 500, body: 'x' }), { status: 'SUBMIT_FAILED' });
  for (const location of [
    '/admin/index.php?op=time&sub=set&mesCode=1',
    'https://www.tainanrehab.com/admin/index.php?nonce=abc&op=time&sub=set&mesCode=1',
  ]) {
    assert.deepEqual(parseSubmitResponse({ status: 302, finalUrl: JINAN_CMS_CONFIG.editorUrl, location }, JINAN_CMS_CONFIG.editorUrl), { status: 'SUBMIT_SUCCEEDED' });
  }

  for (const response of [
    { status: 302, location: '/admin/index.php?op=time&sub=set&mesCode=1' },
    { status: 302, finalUrl: 'https://attacker.example/admin/index.php?op=time&sub=set', location: '/admin/index.php?op=time&sub=set&mesCode=1' },
    { status: 302, finalUrl: `${JINAN_CMS_CONFIG.editorUrl}&x=1`, location: '/admin/index.php?op=time&sub=set&mesCode=1' },
    { status: 200, location: '/admin/index.php?op=time&sub=set&mesCode=1' },
    { status: 301, location: '/admin/index.php?op=time&sub=set&mesCode=1' },
    { status: 302, location: '/admin/index.php?op=time&sub=set&mesCode=2' },
    { status: 302, location: '/admin/index.php?op=time&sub=set' },
    { status: 302, location: '/admin/index.php?op=time&op=time&sub=set&mesCode=1' },
    { status: 302, location: '/admin/index.php?op=time&sub=set&mesCode=1#ok' },
    { status: 302, location: 'http://www.tainanrehab.com/admin/index.php?op=time&sub=set&mesCode=1' },
    { status: 302, location: 'https://attacker.example/admin/index.php?op=time&sub=set&mesCode=1' },
    { status: 302, location: '/admin/other.php?op=time&sub=set&mesCode=1' },
    { status: 302, location: '//www.tainanrehab.com/admin/index.php?op=time&sub=set&mesCode=1' },
    { status: 302 },
  ]) {
    assert.deepEqual(parseSubmitResponse(response, JINAN_CMS_CONFIG.editorUrl), { status: 'CMS_RESPONSE_CONTRACT_UNVERIFIED' });
  }
  assert.notEqual(parseSubmitResponse({ status: 200, body: 'published' }).status, 'PUBLISHED');
});

test('G/H. offline preflight logs in read-only, parses protected editor, prepares only, and sanitizes output', async () => {
  const transport = makeTransport([
    { status: 200, finalUrl: JINAN_CMS_CONFIG.publicUrl, body: publicCompositeHtml() },
    { status: 200, finalUrl: JINAN_CMS_CONFIG.loginUrl, body: loginHtml(), setCookie: ['sid=login; Path=/admin; HttpOnly'] },
    { status: 302, finalUrl: JINAN_CMS_CONFIG.loginUrl, location: '/admin/index.php', setCookie: ['sid=protected-cookie; Path=/admin; HttpOnly'] },
    loginSuccessLandingResponse(),
    { status: 200, finalUrl: JINAN_CMS_CONFIG.editorUrl, body: freshEditorHtml() },
  ]);

  const result = await preflightJinanCmsPublish({
    pngDataUrl: pngDataUrl(),
    finalImageUrl: '/uploads/2026/jinan.png',
    env: { JINAN_CMS_USERNAME: 'synthetic-user', JINAN_CMS_PASSWORD: 'synthetic-password' },
    transport,
  });

  assert.equal(result.status, 'CMS_RESPONSE_CONTRACT_UNVERIFIED');
  assert.deepEqual(result.summary, {
    publicChecked: true,
    loginChecked: true,
    editorFormValid: true,
    pngValidated: true,
    uploadPrepared: true,
    submitPrepared: true,
    uploadSent: false,
    submitSent: false,
  });
  assert.deepEqual(transport.calls.map((call) => `${call.method} ${call.url}`), [
    `GET ${JINAN_CMS_CONFIG.publicUrl}`,
    `GET ${JINAN_CMS_CONFIG.loginUrl}`,
    `POST ${JINAN_CMS_CONFIG.loginUrl}`,
    `GET ${LOGIN_SUCCESS_LANDING_URL}`,
    `GET ${JINAN_CMS_CONFIG.editorUrl}`,
  ]);
  assert.equal(transport.calls.filter((call) => call.method === 'POST').length, 1);
  assert.equal(transport.calls.some((call) => call.url.includes('QuickUpload')), false);

  const json = JSON.stringify(result);
  for (const secret of ['synthetic-user', 'synthetic-password', 'protected-cookie', 'data:image/png', 'SEO title', 'SEO keyword', 'SEO description', TIMETABLE_OLD_IMAGES[0]]) {
    assert.equal(json.includes(secret), false);
  }
});

test('G2. preflight without finalImageUrl completes read-only checks and does not prepare submit', async () => {
  const transport = makeTransport([
    { status: 200, finalUrl: JINAN_CMS_CONFIG.publicUrl, body: publicCompositeHtml() },
    { status: 200, finalUrl: JINAN_CMS_CONFIG.loginUrl, body: loginHtml(), setCookie: ['sid=login; Path=/admin; HttpOnly'] },
    { status: 302, finalUrl: JINAN_CMS_CONFIG.loginUrl, location: '/admin/index.php', setCookie: ['sid=protected-cookie; Path=/admin; HttpOnly'] },
    loginSuccessLandingResponse(),
    { status: 200, finalUrl: JINAN_CMS_CONFIG.editorUrl, body: freshEditorHtml() },
  ]);

  const result = await preflightJinanCmsPublish({
    pngDataUrl: pngDataUrl(),
    env: { JINAN_CMS_USERNAME: 'synthetic-user', JINAN_CMS_PASSWORD: 'synthetic-password' },
    transport,
  });

  assert.equal(result.status, 'CMS_RESPONSE_CONTRACT_UNVERIFIED');
  assert.deepEqual(result.summary, {
    publicChecked: true,
    loginChecked: true,
    editorFormValid: true,
    pngValidated: true,
    uploadPrepared: true,
    submitPrepared: false,
    uploadSent: false,
    submitSent: false,
    freshSubmitBaseCaptured: true,
  });
  assert.deepEqual(transport.calls.map((call) => `${call.method} ${call.url}`), [
    `GET ${JINAN_CMS_CONFIG.publicUrl}`,
    `GET ${JINAN_CMS_CONFIG.loginUrl}`,
    `POST ${JINAN_CMS_CONFIG.loginUrl}`,
    `GET ${LOGIN_SUCCESS_LANDING_URL}`,
    `GET ${JINAN_CMS_CONFIG.editorUrl}`,
  ]);
  assert.equal(transport.calls.some((call) => call.url.includes('QuickUpload')), false);
});

test('G2b. preflight ingests manual login cookie and lets explicit editor GET prove auth', async () => {
  const transport = makeTransport([
    { status: 200, finalUrl: JINAN_CMS_CONFIG.publicUrl, body: publicCompositeHtml() },
    { status: 200, finalUrl: JINAN_CMS_CONFIG.loginUrl, body: loginHtml() },
    {
      status: 302,
      finalUrl: JINAN_CMS_CONFIG.loginUrl,
      body: publicCompositeHtml(),
      location: '/admin/index.php',
      setCookie: ['sid=protected-cookie; Path=/admin; HttpOnly'],
    },
    loginSuccessLandingResponse(),
    { status: 200, finalUrl: JINAN_CMS_CONFIG.editorUrl, body: freshEditorHtml() },
  ]);

  const result = await preflightJinanCmsPublish({
    pngDataUrl: pngDataUrl(),
    finalImageUrl: '/uploads/2026/jinan.png',
    env: { JINAN_CMS_USERNAME: 'synthetic-user', JINAN_CMS_PASSWORD: 'synthetic-password' },
    transport,
  });

  assert.equal(result.status, 'CMS_RESPONSE_CONTRACT_UNVERIFIED');
  assert.deepEqual(transport.calls.map((call) => `${call.method} ${call.url}`), [
    `GET ${JINAN_CMS_CONFIG.publicUrl}`,
    `GET ${JINAN_CMS_CONFIG.loginUrl}`,
    `POST ${JINAN_CMS_CONFIG.loginUrl}`,
    `GET ${LOGIN_SUCCESS_LANDING_URL}`,
    `GET ${JINAN_CMS_CONFIG.editorUrl}`,
  ]);
  assert.equal(transport.calls[3].cookie, 'sid=protected-cookie');
  assert.equal(transport.calls[4].cookie, 'sid=landed');
  assert.equal(transport.calls.some((call) => call.url.includes('QuickUpload')), false);
  assert.equal(transport.calls.some((call) => call.method === 'POST' && call.url.includes('op=time&sub=set')), false);
});

test('G2b1. preflight follows exact login success landing before editor and carries rotated PHPSESSID', async () => {
  const transport = makeTransport([
    { status: 200, finalUrl: JINAN_CMS_CONFIG.publicUrl, body: publicCompositeHtml() },
    { status: 200, finalUrl: JINAN_CMS_CONFIG.loginUrl, body: loginHtml(), setCookie: ['PHPSESSID=login; Path=/; HttpOnly'] },
    {
      status: 302,
      finalUrl: JINAN_CMS_CONFIG.loginUrl,
      body: '',
      location: '/admin/index.php',
      setCookie: ['PHPSESSID=submitted; Path=/; HttpOnly'],
    },
    {
      status: 200,
      finalUrl: `${JINAN_CMS_CONFIG.origin}/admin/index.php`,
      body: '<a href="/admin/index.php?op=time&amp;sub=set">門診時間</a>',
      setCookie: ['PHPSESSID=landed; Path=/; HttpOnly'],
    },
    { status: 200, finalUrl: JINAN_CMS_CONFIG.editorUrl, body: freshEditorHtml() },
  ]);

  const result = await preflightJinanCmsPublish({
    pngDataUrl: pngDataUrl(),
    finalImageUrl: '/uploads/2026/jinan.png',
    env: { JINAN_CMS_USERNAME: 'synthetic-user', JINAN_CMS_PASSWORD: 'synthetic-password' },
    transport: async (request) => {
      if (request.url === JINAN_CMS_CONFIG.editorUrl && request.headers?.cookie !== 'PHPSESSID=landed') {
        return {
          status: 302,
          finalUrl: JINAN_CMS_CONFIG.editorUrl,
          location: '/admin/login.php',
          body: '',
        };
      }
      return transport(request);
    },
  });

  assert.equal(result.status, 'CMS_RESPONSE_CONTRACT_UNVERIFIED');
  assert.deepEqual(transport.calls.map((call) => `${call.method} ${call.url}`), [
    `GET ${JINAN_CMS_CONFIG.publicUrl}`,
    `GET ${JINAN_CMS_CONFIG.loginUrl}`,
    `POST ${JINAN_CMS_CONFIG.loginUrl}`,
    `GET ${JINAN_CMS_CONFIG.origin}/admin/index.php`,
    `GET ${JINAN_CMS_CONFIG.editorUrl}`,
  ]);
  assert.equal(transport.calls.filter((call) => call.method === 'POST' && call.url === JINAN_CMS_CONFIG.loginUrl).length, 1);
  assert.equal(transport.calls[3].cookie, 'PHPSESSID=submitted');
  assert.equal(transport.calls[4].cookie, 'PHPSESSID=landed');
  assert.equal(transport.calls.some((call) => call.url.includes('QuickUpload')), false);
  assert.equal(transport.calls.some((call) => call.method === 'POST' && call.url.includes('op=time&sub=set')), false);
});

test('G2b1a. preflight fail-closes explicit login landing drift before editor or mutations', async () => {
  const minimalLandingTransport = makeTransport([
    { status: 200, finalUrl: JINAN_CMS_CONFIG.publicUrl, body: publicCompositeHtml() },
    { status: 200, finalUrl: JINAN_CMS_CONFIG.loginUrl, body: loginHtml(), setCookie: ['PHPSESSID=login; Path=/; HttpOnly'] },
    {
      status: 302,
      finalUrl: JINAN_CMS_CONFIG.loginUrl,
      body: '',
      location: '/admin/index.php',
      setCookie: ['PHPSESSID=submitted; Path=/; HttpOnly'],
    },
    { status: 200, finalUrl: LOGIN_SUCCESS_LANDING_URL, body: '<main>synthetic landing</main>' },
    { status: 200, finalUrl: JINAN_CMS_CONFIG.editorUrl, body: freshEditorHtml() },
  ]);

  const minimalLandingResult = await preflightJinanCmsPublish({
    pngDataUrl: pngDataUrl(),
    finalImageUrl: '/uploads/2026/jinan.png',
    env: { JINAN_CMS_USERNAME: 'synthetic-user', JINAN_CMS_PASSWORD: 'synthetic-password' },
    transport: minimalLandingTransport,
  });

  assert.equal(minimalLandingResult.status, 'CMS_RESPONSE_CONTRACT_UNVERIFIED');
  assert.deepEqual(minimalLandingTransport.calls.map((call) => `${call.method} ${call.url}`), [
    `GET ${JINAN_CMS_CONFIG.publicUrl}`,
    `GET ${JINAN_CMS_CONFIG.loginUrl}`,
    `POST ${JINAN_CMS_CONFIG.loginUrl}`,
    `GET ${LOGIN_SUCCESS_LANDING_URL}`,
    `GET ${JINAN_CMS_CONFIG.editorUrl}`,
  ]);
  assert.equal(minimalLandingTransport.calls.filter((call) => call.method === 'POST' && call.url === JINAN_CMS_CONFIG.loginUrl).length, 1);
  assert.equal(minimalLandingTransport.calls.filter((call) => call.method === 'GET' && call.url === LOGIN_SUCCESS_LANDING_URL).length, 1);
  assert.equal(minimalLandingTransport.calls.some((call) => call.url.includes('QuickUpload')), false);
  assert.equal(minimalLandingTransport.calls.some((call) => call.method === 'POST' && call.url.includes('op=time&sub=set')), false);

  const cases = [
    { status: 302, finalUrl: LOGIN_SUCCESS_LANDING_URL, body: '<main>synthetic landing</main>' },
    { status: 200, finalUrl: `${LOGIN_SUCCESS_LANDING_URL}?next=1`, body: '<main>synthetic landing</main>' },
    { status: 200, finalUrl: LOGIN_SUCCESS_LANDING_URL, location: '/admin/index.php', body: '<main>synthetic landing</main>' },
  ];

  for (const landingResponse of cases) {
    const transport = makeTransport([
      { status: 200, finalUrl: JINAN_CMS_CONFIG.publicUrl, body: publicCompositeHtml() },
      { status: 200, finalUrl: JINAN_CMS_CONFIG.loginUrl, body: loginHtml(), setCookie: ['PHPSESSID=login; Path=/; HttpOnly'] },
      {
        status: 302,
        finalUrl: JINAN_CMS_CONFIG.loginUrl,
        body: '',
        location: '/admin/index.php',
        setCookie: ['PHPSESSID=submitted; Path=/; HttpOnly'],
      },
      landingResponse,
    ]);

    const result = await preflightJinanCmsPublish({
      pngDataUrl: pngDataUrl(),
      finalImageUrl: '/uploads/2026/jinan.png',
      env: { JINAN_CMS_USERNAME: 'synthetic-user', JINAN_CMS_PASSWORD: 'synthetic-password' },
      transport,
    });

    assert.equal(result.status, 'VERIFY_FAILED');
    assert.deepEqual(transport.calls.map((call) => `${call.method} ${call.url}`), [
      `GET ${JINAN_CMS_CONFIG.publicUrl}`,
      `GET ${JINAN_CMS_CONFIG.loginUrl}`,
      `POST ${JINAN_CMS_CONFIG.loginUrl}`,
      `GET ${LOGIN_SUCCESS_LANDING_URL}`,
    ]);
    assert.equal(transport.calls.filter((call) => call.method === 'POST' && call.url === JINAN_CMS_CONFIG.loginUrl).length, 1);
    assert.equal(transport.calls.filter((call) => call.method === 'GET' && call.url === LOGIN_SUCCESS_LANDING_URL).length, 1);
    assert.equal(transport.calls.some((call) => call.url.includes('QuickUpload')), false);
    assert.equal(transport.calls.some((call) => call.method === 'POST' && call.url.includes('op=time&sub=set')), false);
  }
});

test('G2b1b. preflight fail-closes present empty login landing Location before editor or mutations', async () => {
  for (const { name, response: landingResponse } of emptyLocationResponseCases({
    status: 200,
    finalUrl: LOGIN_SUCCESS_LANDING_URL,
    body: '<main>synthetic landing</main>',
  })) {
    const transport = makeTransport([
      { status: 200, finalUrl: JINAN_CMS_CONFIG.publicUrl, body: publicCompositeHtml() },
      { status: 200, finalUrl: JINAN_CMS_CONFIG.loginUrl, body: loginHtml(), setCookie: ['PHPSESSID=login; Path=/; HttpOnly'] },
      {
        status: 302,
        finalUrl: JINAN_CMS_CONFIG.loginUrl,
        body: '',
        location: '/admin/index.php',
        setCookie: ['PHPSESSID=submitted; Path=/; HttpOnly'],
      },
      landingResponse,
    ]);

    const result = await preflightJinanCmsPublish({
      pngDataUrl: pngDataUrl(),
      finalImageUrl: '/uploads/2026/jinan.png',
      env: { JINAN_CMS_USERNAME: 'synthetic-user', JINAN_CMS_PASSWORD: 'synthetic-password' },
      transport,
    });

    assert.equal(result.status, 'VERIFY_FAILED', name);
    assert.deepEqual(transport.calls.map((call) => `${call.method} ${call.url}`), [
      `GET ${JINAN_CMS_CONFIG.publicUrl}`,
      `GET ${JINAN_CMS_CONFIG.loginUrl}`,
      `POST ${JINAN_CMS_CONFIG.loginUrl}`,
      `GET ${LOGIN_SUCCESS_LANDING_URL}`,
    ], name);
    assert.equal(transport.calls.length, 4, name);
    assert.equal(transport.calls.filter((call) => call.method === 'GET' && call.url === JINAN_CMS_CONFIG.editorUrl).length, 0, name);
    assert.equal(transport.calls.some((call) => call.url.includes('QuickUpload')), false, name);
    assert.equal(transport.calls.some((call) => call.method === 'POST' && call.url.includes('op=time&sub=set')), false, name);
  }
});

test('G2b2. preflight classifies manual editor redirect to login as auth failure', async () => {
  for (const location of ['/admin/login.php', JINAN_CMS_CONFIG.loginUrl]) {
    const transport = makeTransport([
      { status: 200, finalUrl: JINAN_CMS_CONFIG.publicUrl, body: publicCompositeHtml() },
      { status: 200, finalUrl: JINAN_CMS_CONFIG.loginUrl, body: loginHtml() },
      {
        status: 302,
        finalUrl: JINAN_CMS_CONFIG.loginUrl,
        body: publicCompositeHtml(),
        location: '/admin/index.php',
        setCookie: ['sid=login-attempt; Path=/admin; HttpOnly'],
      },
      loginSuccessLandingResponse(),
      {
        status: 302,
        finalUrl: JINAN_CMS_CONFIG.editorUrl,
        body: publicCompositeHtml(),
        location,
      },
    ]);

    const result = await preflightJinanCmsPublish({
      pngDataUrl: pngDataUrl(),
      finalImageUrl: '/uploads/2026/jinan.png',
      env: { JINAN_CMS_USERNAME: 'synthetic-user', JINAN_CMS_PASSWORD: 'synthetic-password' },
      transport,
    });

    assert.equal(result.status, 'AUTH_FAILED');
    assert.deepEqual(transport.calls.map((call) => `${call.method} ${call.url}`), [
      `GET ${JINAN_CMS_CONFIG.publicUrl}`,
      `GET ${JINAN_CMS_CONFIG.loginUrl}`,
      `POST ${JINAN_CMS_CONFIG.loginUrl}`,
      `GET ${LOGIN_SUCCESS_LANDING_URL}`,
      `GET ${JINAN_CMS_CONFIG.editorUrl}`,
    ]);
    assert.equal(transport.calls.some((call) => call.url.includes('QuickUpload')), false);
    assert.equal(transport.calls.some((call) => call.method === 'POST' && call.url.includes('op=time&sub=set')), false);
  }
});

test('G2b3. preflight accepts only exact editor 200 without redirect Location as authenticated', async () => {
  const transport = makeTransport([
    { status: 200, finalUrl: JINAN_CMS_CONFIG.publicUrl, body: publicCompositeHtml() },
    { status: 200, finalUrl: JINAN_CMS_CONFIG.loginUrl, body: loginHtml() },
    {
      status: 302,
      finalUrl: JINAN_CMS_CONFIG.loginUrl,
      body: publicCompositeHtml(),
      location: '/admin/index.php',
      setCookie: ['sid=protected-cookie; Path=/admin; HttpOnly'],
    },
    loginSuccessLandingResponse(),
    { status: 200, finalUrl: JINAN_CMS_CONFIG.editorUrl, body: freshEditorHtml() },
  ]);

  const result = await preflightJinanCmsPublish({
    pngDataUrl: pngDataUrl(),
    finalImageUrl: '/uploads/2026/jinan.png',
    env: { JINAN_CMS_USERNAME: 'synthetic-user', JINAN_CMS_PASSWORD: 'synthetic-password' },
    transport,
  });

  assert.equal(result.status, 'CMS_RESPONSE_CONTRACT_UNVERIFIED');
  assert.equal(transport.calls.length, 5);
});

test('G2b4. preflight fail-closes unsafe or ambiguous editor redirects', async () => {
  const cases = [
    { status: 302, finalUrl: JINAN_CMS_CONFIG.editorUrl, location: 'https://attacker.example/admin/login.php' },
    { status: 302, finalUrl: JINAN_CMS_CONFIG.editorUrl, location: 'ftp://www.tainanrehab.com/admin/login.php' },
    { status: 302, finalUrl: JINAN_CMS_CONFIG.editorUrl, location: 'http://[::1' },
    { status: 302, finalUrl: JINAN_CMS_CONFIG.editorUrl },
    { status: 302, finalUrl: JINAN_CMS_CONFIG.editorUrl, location: '/admin/login.php?next=1' },
    { status: 302, finalUrl: JINAN_CMS_CONFIG.editorUrl, location: '/admin/login.php#expired' },
    { status: 302, finalUrl: JINAN_CMS_CONFIG.editorUrl, location: '/admin/index.php' },
    { status: 302, finalUrl: JINAN_CMS_CONFIG.editorUrl, location: '//www.tainanrehab.com/admin/login.php' },
    { status: 302, finalUrl: JINAN_CMS_CONFIG.loginUrl, location: '/admin/index.php' },
    { status: 302, finalUrl: `${JINAN_CMS_CONFIG.loginUrl}?next=1`, location: '/admin/login.php' },
    { status: 200, finalUrl: JINAN_CMS_CONFIG.editorUrl, location: '/admin/login.php', body: freshEditorHtml() },
    { status: 200, finalUrl: `${JINAN_CMS_CONFIG.editorUrl}&x=1`, body: freshEditorHtml() },
    { status: 500, finalUrl: JINAN_CMS_CONFIG.editorUrl, body: freshEditorHtml() },
  ];

  for (const editorResponse of cases) {
    const transport = makeTransport([
      { status: 200, finalUrl: JINAN_CMS_CONFIG.publicUrl, body: publicCompositeHtml() },
      { status: 200, finalUrl: JINAN_CMS_CONFIG.loginUrl, body: loginHtml() },
      {
        status: 302,
        finalUrl: JINAN_CMS_CONFIG.loginUrl,
        body: publicCompositeHtml(),
        location: '/admin/index.php',
        setCookie: ['sid=protected-cookie; Path=/admin; HttpOnly'],
      },
      loginSuccessLandingResponse(),
      editorResponse,
    ]);

    const result = await preflightJinanCmsPublish({
      pngDataUrl: pngDataUrl(),
      finalImageUrl: '/uploads/2026/jinan.png',
      env: { JINAN_CMS_USERNAME: 'synthetic-user', JINAN_CMS_PASSWORD: 'synthetic-password' },
      transport,
    });

    assert.equal(result.status, 'VERIFY_FAILED');
    assert.equal(transport.calls.length, 5);
    assert.equal(transport.calls.some((call) => call.url.includes('QuickUpload')), false);
    assert.equal(transport.calls.some((call) => call.method === 'POST' && call.url.includes('op=time&sub=set')), false);
  }
});

test('G2c. preflight rejects unsafe login POST Location before landing, editor, or mutations', async () => {
  const cases = [
    { name: '200 with success Location', response: { status: 200, finalUrl: JINAN_CMS_CONFIG.loginUrl, location: '/admin/index.php' } },
    { name: '301', response: { status: 301, finalUrl: JINAN_CMS_CONFIG.loginUrl, location: '/admin/index.php' } },
    { name: '303', response: { status: 303, finalUrl: JINAN_CMS_CONFIG.loginUrl, location: '/admin/index.php' } },
    { name: '307', response: { status: 307, finalUrl: JINAN_CMS_CONFIG.loginUrl, location: '/admin/index.php' } },
    { name: '308', response: { status: 308, finalUrl: JINAN_CMS_CONFIG.loginUrl, location: '/admin/index.php' } },
    { name: 'finalUrl editor', response: { status: 302, finalUrl: JINAN_CMS_CONFIG.editorUrl, location: '/admin/index.php' } },
    { name: 'absolute Location', response: { status: 302, finalUrl: JINAN_CMS_CONFIG.loginUrl, location: LOGIN_SUCCESS_LANDING_URL } },
    { name: 'protocol-relative Location', response: { status: 302, finalUrl: JINAN_CMS_CONFIG.loginUrl, location: '//www.tainanrehab.com/admin/index.php' } },
    { name: 'backslash Location', response: { status: 302, finalUrl: JINAN_CMS_CONFIG.loginUrl, location: '\\admin\\index.php' } },
    { name: 'malformed scheme Location', response: { status: 302, finalUrl: JINAN_CMS_CONFIG.loginUrl, location: 'https://[::1' } },
    { name: 'dot-segment Location', response: { status: 302, finalUrl: JINAN_CMS_CONFIG.loginUrl, location: '/admin/../admin/index.php' } },
    { name: 'percent-encoded dot-segment Location', response: { status: 302, finalUrl: JINAN_CMS_CONFIG.loginUrl, location: '/admin/%2e%2e/admin/index.php' } },
    { name: 'query Location', response: { status: 302, finalUrl: JINAN_CMS_CONFIG.loginUrl, location: '/admin/index.php?op=time' } },
    { name: 'fragment Location', response: { status: 302, finalUrl: JINAN_CMS_CONFIG.loginUrl, location: '/admin/index.php#top' } },
    { name: 'credentials Location', response: { status: 302, finalUrl: JINAN_CMS_CONFIG.loginUrl, location: 'https://user:pass@www.tainanrehab.com/admin/index.php' } },
    { name: 'alternate host Location', response: { status: 302, finalUrl: JINAN_CMS_CONFIG.loginUrl, location: 'https://attacker.example/admin/index.php' } },
    { name: 'alternate scheme Location', response: { status: 302, finalUrl: JINAN_CMS_CONFIG.loginUrl, location: 'http://www.tainanrehab.com/admin/index.php' } },
    { name: 'leading whitespace Location', response: { status: 302, finalUrl: JINAN_CMS_CONFIG.loginUrl, location: ' /admin/index.php' } },
    { name: 'trailing whitespace Location', response: { status: 302, finalUrl: JINAN_CMS_CONFIG.loginUrl, location: '/admin/index.php ' } },
  ];

  for (const { name, response } of cases) {
    const transport = makeTransport([
      { status: 200, finalUrl: JINAN_CMS_CONFIG.publicUrl, body: publicCompositeHtml() },
      { status: 200, finalUrl: JINAN_CMS_CONFIG.loginUrl, body: loginHtml() },
      {
        body: publicCompositeHtml(),
        setCookie: ['sid=protected-cookie; Path=/admin; HttpOnly'],
        ...response,
      },
    ]);

    const result = await preflightJinanCmsPublish({
      pngDataUrl: pngDataUrl(),
      finalImageUrl: '/uploads/2026/jinan.png',
      env: { JINAN_CMS_USERNAME: 'synthetic-user', JINAN_CMS_PASSWORD: 'synthetic-password' },
      transport,
    });

    assert.equal(result.status, 'VERIFY_FAILED', name);
    assert.deepEqual(transport.calls.map((call) => `${call.method} ${call.url}`), [
      `GET ${JINAN_CMS_CONFIG.publicUrl}`,
      `GET ${JINAN_CMS_CONFIG.loginUrl}`,
      `POST ${JINAN_CMS_CONFIG.loginUrl}`,
    ], name);
    assert.equal(transport.calls.filter((call) => call.method === 'POST' && call.url === JINAN_CMS_CONFIG.loginUrl).length, 1, name);
    assert.equal(transport.calls.filter((call) => call.method === 'GET' && call.url === LOGIN_SUCCESS_LANDING_URL).length, 0, name);
    assert.equal(transport.calls.filter((call) => call.method === 'GET' && call.url === JINAN_CMS_CONFIG.editorUrl).length, 0, name);
    assert.equal(transport.calls.some((call) => call.url.includes('QuickUpload')), false, name);
    assert.equal(transport.calls.some((call) => call.method === 'POST' && call.url.includes('op=time&sub=set')), false, name);
  }
});

test('G2c1. preflight fail-closes login POST responses without explicit finalUrl before landing or mutations', async () => {
  const cases = [
    { name: 'missing finalUrl', response: { status: 302, location: '/admin/index.php' } },
    { name: 'empty finalUrl', response: { status: 302, finalUrl: '', location: '/admin/index.php' } },
    { name: 'response.url only', response: { status: 302, url: JINAN_CMS_CONFIG.loginUrl, location: '/admin/index.php' } },
  ];

  for (const { name, response } of cases) {
    const transport = makeTransport([
      { status: 200, finalUrl: JINAN_CMS_CONFIG.publicUrl, body: publicCompositeHtml() },
      { status: 200, finalUrl: JINAN_CMS_CONFIG.loginUrl, body: loginHtml() },
      response,
    ]);

    const result = await preflightJinanCmsPublish({
      pngDataUrl: pngDataUrl(),
      finalImageUrl: '/uploads/2026/jinan.png',
      env: { JINAN_CMS_USERNAME: 'synthetic-user', JINAN_CMS_PASSWORD: 'synthetic-password' },
      transport,
    });

    assert.equal(result.status, 'VERIFY_FAILED', name);
    assert.deepEqual(transport.calls.map((call) => `${call.method} ${call.url}`), [
      `GET ${JINAN_CMS_CONFIG.publicUrl}`,
      `GET ${JINAN_CMS_CONFIG.loginUrl}`,
      `POST ${JINAN_CMS_CONFIG.loginUrl}`,
    ], name);
    assert.equal(transport.calls.filter((call) => call.method === 'GET' && call.url === LOGIN_SUCCESS_LANDING_URL).length, 0, name);
    assert.equal(transport.calls.filter((call) => call.method === 'GET' && call.url === JINAN_CMS_CONFIG.editorUrl).length, 0, name);
    assert.equal(transport.calls.some((call) => call.url.includes('QuickUpload')), false, name);
    assert.equal(transport.calls.some((call) => call.method === 'POST' && call.url.includes('op=time&sub=set')), false, name);
  }
});

test('G2c2. preflight fail-closes login landing responses without explicit finalUrl before editor or mutations', async () => {
  const cases = [
    { name: 'missing finalUrl', response: { status: 200, body: '<a href="/admin/index.php?op=time&amp;sub=set">門診時間</a>' } },
    { name: 'empty finalUrl', response: { status: 200, finalUrl: '', body: '<a href="/admin/index.php?op=time&amp;sub=set">門診時間</a>' } },
    { name: 'response.url only', response: { status: 200, url: LOGIN_SUCCESS_LANDING_URL, body: '<a href="/admin/index.php?op=time&amp;sub=set">門診時間</a>' } },
  ];

  for (const { name, response } of cases) {
    const transport = makeTransport([
      { status: 200, finalUrl: JINAN_CMS_CONFIG.publicUrl, body: publicCompositeHtml() },
      { status: 200, finalUrl: JINAN_CMS_CONFIG.loginUrl, body: loginHtml() },
      { status: 302, finalUrl: JINAN_CMS_CONFIG.loginUrl, location: '/admin/index.php', setCookie: ['sid=x; Path=/admin'] },
      response,
    ]);

    const result = await preflightJinanCmsPublish({
      pngDataUrl: pngDataUrl(),
      finalImageUrl: '/uploads/2026/jinan.png',
      env: { JINAN_CMS_USERNAME: 'synthetic-user', JINAN_CMS_PASSWORD: 'synthetic-password' },
      transport,
    });

    assert.equal(result.status, 'VERIFY_FAILED', name);
    assert.deepEqual(transport.calls.map((call) => `${call.method} ${call.url}`), [
      `GET ${JINAN_CMS_CONFIG.publicUrl}`,
      `GET ${JINAN_CMS_CONFIG.loginUrl}`,
      `POST ${JINAN_CMS_CONFIG.loginUrl}`,
      `GET ${LOGIN_SUCCESS_LANDING_URL}`,
    ], name);
    assert.equal(transport.calls.filter((call) => call.method === 'GET' && call.url === LOGIN_SUCCESS_LANDING_URL).length, 1, name);
    assert.equal(transport.calls.filter((call) => call.method === 'GET' && call.url === JINAN_CMS_CONFIG.editorUrl).length, 0, name);
    assert.equal(transport.calls.some((call) => call.url.includes('QuickUpload')), false, name);
    assert.equal(transport.calls.some((call) => call.method === 'POST' && call.url.includes('op=time&sub=set')), false, name);
  }
});

test('G2c2a. publish login-submit does not log unallowlisted transport errorCode text', async () => {
  const logs = [];
  const adversarialError = new Error('transport exploded');
  adversarialError.errorCode = 'secret=query-secret header=Authorization cookie=sid-cookie-secret';
  const transport = makeTransport([
    { status: 200, finalUrl: JINAN_CMS_CONFIG.publicUrl, body: publicCompositeHtml() },
    { status: 200, finalUrl: JINAN_CMS_CONFIG.loginUrl, body: loginHtml(), setCookie: ['sid=login-cookie-secret; Path=/admin; HttpOnly'] },
    adversarialError,
  ]);

  const result = await publishJinanCms({
    pngDataUrl: pngDataUrl(),
    callbackNumber: 37,
    env: {
      JINAN_CMS_PUBLISH_ENABLED: 'true',
      JINAN_CMS_USERNAME: 'synthetic-user-secret',
      JINAN_CMS_PASSWORD: 'synthetic-password-secret',
    },
    transport,
    logger: (event) => logs.push(event),
  });

  assert.equal(result.status, 'VERIFY_FAILED');
  assert.equal(transport.calls.length, 3);
  assert.equal(transport.calls.some((call) => call.url.includes('QuickUpload')), false);
  assert.equal(transport.calls.some((call) => call.method === 'POST' && call.url.includes('op=time&sub=set')), false);

  const loginSubmitLog = logs.find((event) => event.stage === 'login-submit');
  assert.ok(loginSubmitLog);
  assert.equal(loginSubmitLog.status, 'VERIFY_FAILED');
  assert.equal(loginSubmitLog.errorCode, 'VERIFY_FAILED');

  const serialized = JSON.stringify(logs);
  for (const forbidden of [
    'synthetic-user-secret',
    'synthetic-password-secret',
    'query-secret',
    'Authorization',
    'sid-cookie-secret',
    'login-cookie-secret',
    'transport exploded',
  ]) {
    assert.equal(serialized.includes(forbidden), false, `leaked ${forbidden}`);
  }
});

test('G2c2b. publish login-submit does not trust allowlisted transport errorCode spoofing', async () => {
  const logs = [];
  const adversarialError = new Error('transport exploded');
  adversarialError.errorCode = 'LOGIN_POST_STATUS_MISMATCH';
  const transport = makeTransport([
    { status: 200, finalUrl: JINAN_CMS_CONFIG.publicUrl, body: publicCompositeHtml() },
    { status: 200, finalUrl: JINAN_CMS_CONFIG.loginUrl, body: loginHtml(), setCookie: ['sid=login-cookie-secret; Path=/admin; HttpOnly'] },
    adversarialError,
  ]);

  const result = await publishJinanCms({
    pngDataUrl: pngDataUrl(),
    callbackNumber: 37,
    env: {
      JINAN_CMS_PUBLISH_ENABLED: 'true',
      JINAN_CMS_USERNAME: 'synthetic-user-secret',
      JINAN_CMS_PASSWORD: 'synthetic-password-secret',
    },
    transport,
    logger: (event) => logs.push(event),
  });

  assert.equal(result.status, 'VERIFY_FAILED');
  assert.equal(transport.calls.length, 3);
  assert.equal(transport.calls.some((call) => call.url.includes('QuickUpload')), false);
  assert.equal(transport.calls.some((call) => call.method === 'POST' && call.url.includes('op=time&sub=set')), false);

  const loginSubmitLog = logs.find((event) => event.stage === 'login-submit');
  assert.ok(loginSubmitLog);
  assert.equal(loginSubmitLog.status, 'VERIFY_FAILED');
  assert.equal(loginSubmitLog.errorCode, 'VERIFY_FAILED');

  const serialized = JSON.stringify(logs);
  for (const forbidden of [
    'synthetic-user-secret',
    'synthetic-password-secret',
    'login-cookie-secret',
    'transport exploded',
    'stack',
    'Error:',
  ]) {
    assert.equal(serialized.includes(forbidden), false, `leaked ${forbidden}`);
  }
});

test('G2c2c. publish login-submit handles transport errorCode getter that throws', async () => {
  const logs = [];
  const adversarialError = new Error('transport exploded');
  Object.defineProperty(adversarialError, 'errorCode', {
    enumerable: true,
    get() {
      throw new Error('getter leaked query-secret header-secret cookie-secret');
    },
  });
  const transport = makeTransport([
    { status: 200, finalUrl: JINAN_CMS_CONFIG.publicUrl, body: publicCompositeHtml() },
    { status: 200, finalUrl: JINAN_CMS_CONFIG.loginUrl, body: loginHtml(), setCookie: ['sid=login-cookie-secret; Path=/admin; HttpOnly'] },
    adversarialError,
  ]);

  const result = await publishJinanCms({
    pngDataUrl: pngDataUrl(),
    callbackNumber: 37,
    env: {
      JINAN_CMS_PUBLISH_ENABLED: 'true',
      JINAN_CMS_USERNAME: 'synthetic-user-secret',
      JINAN_CMS_PASSWORD: 'synthetic-password-secret',
    },
    transport,
    logger: (event) => logs.push(event),
  });

  assert.equal(result.status, 'VERIFY_FAILED');
  assert.equal(transport.calls.length, 3);
  assert.equal(transport.calls.some((call) => call.url.includes('QuickUpload')), false);
  assert.equal(transport.calls.some((call) => call.method === 'POST' && call.url.includes('op=time&sub=set')), false);

  const loginSubmitLog = logs.find((event) => event.stage === 'login-submit');
  assert.ok(loginSubmitLog);
  assert.equal(loginSubmitLog.status, 'VERIFY_FAILED');
  assert.equal(loginSubmitLog.errorCode, 'VERIFY_FAILED');

  const serialized = JSON.stringify(logs);
  for (const forbidden of [
    'synthetic-user-secret',
    'synthetic-password-secret',
    'login-cookie-secret',
    'transport exploded',
    'getter leaked',
    'query-secret',
    'header-secret',
    'cookie-secret',
    'stack',
    'Error:',
  ]) {
    assert.equal(serialized.includes(forbidden), false, `leaked ${forbidden}`);
  }
});

test('G2c2d. publish login-submit handles thrown object errorCode getter that throws', async () => {
  const logs = [];
  const calls = [];
  const adversarialError = {};
  Object.defineProperty(adversarialError, 'errorCode', {
    enumerable: true,
    get() {
      throw new Error('getter leaked query-secret header-secret cookie-secret');
    },
  });
  const responses = [
    { status: 200, finalUrl: JINAN_CMS_CONFIG.publicUrl, body: publicCompositeHtml() },
    { status: 200, finalUrl: JINAN_CMS_CONFIG.loginUrl, body: loginHtml(), setCookie: ['sid=login-cookie-secret; Path=/admin; HttpOnly'] },
    adversarialError,
  ];
  const transport = async (request) => {
    calls.push({ method: request.method, url: request.url });
    const next = responses.shift();
    assert.notEqual(next, undefined, `missing fixture response for ${request.method} ${request.url}`);
    if (next === adversarialError) throw adversarialError;
    return next;
  };

  const result = await publishJinanCms({
    pngDataUrl: pngDataUrl(),
    callbackNumber: 37,
    env: {
      JINAN_CMS_PUBLISH_ENABLED: 'true',
      JINAN_CMS_USERNAME: 'synthetic-user-secret',
      JINAN_CMS_PASSWORD: 'synthetic-password-secret',
    },
    transport,
    logger: (event) => logs.push(event),
  });

  assert.equal(result.status, 'VERIFY_FAILED');
  assert.equal(calls.length, 3);
  assert.equal(calls.some((call) => call.url.includes('QuickUpload')), false);
  assert.equal(calls.some((call) => call.method === 'POST' && call.url.includes('op=time&sub=set')), false);

  const loginSubmitLog = logs.find((event) => event.stage === 'login-submit');
  assert.ok(loginSubmitLog);
  assert.equal(loginSubmitLog.status, 'VERIFY_FAILED');
  assert.equal(loginSubmitLog.errorCode, 'VERIFY_FAILED');

  const serialized = JSON.stringify(logs);
  for (const forbidden of [
    'synthetic-user-secret',
    'synthetic-password-secret',
    'login-cookie-secret',
    'getter leaked',
    'query-secret',
    'header-secret',
    'cookie-secret',
    'stack',
    'Error:',
  ]) {
    assert.equal(serialized.includes(forbidden), false, `leaked ${forbidden}`);
  }
});

async function assertPublishLoginDiagnostic({ name, loginPostResponse, landingResponse, expectedErrorCode, expectedCalls = 3 }) {
  const logs = [];
  const transportResponses = [
    { status: 200, finalUrl: JINAN_CMS_CONFIG.publicUrl, body: publicCompositeHtml() },
    { status: 200, finalUrl: JINAN_CMS_CONFIG.loginUrl, body: loginHtml(), setCookie: ['sid=login-cookie-secret; Path=/admin; HttpOnly'] },
    {
      body: '<main>login-post-body-secret</main>',
      setCookie: ['sid=post-cookie-secret; Path=/admin; HttpOnly'],
      ...loginPostResponse,
    },
  ];
  if (landingResponse) {
    transportResponses.push({
      body: '<main>landing-body-secret</main>',
      setCookie: ['sid=landing-cookie-secret; Path=/admin; HttpOnly'],
      ...landingResponse,
    });
  }
  const transport = makeTransport(transportResponses);

  const result = await publishJinanCms({
    pngDataUrl: pngDataUrl(),
    callbackNumber: 37,
    env: {
      JINAN_CMS_PUBLISH_ENABLED: 'true',
      JINAN_CMS_USERNAME: 'synthetic-user-secret',
      JINAN_CMS_PASSWORD: 'synthetic-password-secret',
    },
    transport,
    logger: (event) => logs.push(event),
  });

  assert.equal(result.status, 'VERIFY_FAILED', name);
  assert.equal(transport.calls.length, expectedCalls, name);
  assert.equal(transport.calls.some((call) => call.url.includes('QuickUpload')), false, name);
  assert.equal(transport.calls.some((call) => call.method === 'POST' && call.url.includes('op=time&sub=set')), false, name);

  const loginSubmitLog = logs.find((event) => event.stage === 'login-submit');
  assert.ok(loginSubmitLog, name);
  assert.equal(loginSubmitLog.status, 'VERIFY_FAILED', name);
  assert.equal(loginSubmitLog.errorCode, expectedErrorCode, name);

  const serialized = JSON.stringify(logs);
  for (const forbidden of [
    'synthetic-user-secret',
    'synthetic-password-secret',
    'login-cookie-secret',
    'post-cookie-secret',
    'landing-cookie-secret',
    'login-post-body-secret',
    'landing-body-secret',
    'csrf-token-secret',
    'query-secret',
    'header-secret',
    'raw-location-secret',
    'user:pass',
    'attacker.example',
    'stack',
    'Error:',
  ]) {
    assert.equal(serialized.includes(forbidden), false, `${name} leaked ${forbidden}`);
  }
}

test('G2c3. publish login POST diagnostics use exact safe reason codes and deterministic precedence', async () => {
  await assertPublishLoginDiagnostic({
    name: 'post status has precedence',
    loginPostResponse: {
      status: 500,
      finalUrl: `${JINAN_CMS_CONFIG.loginUrl}?token=query-secret`,
      headers: { Location: '/admin/index.php?raw-location-secret=1', 'X-Debug': 'header-secret' },
    },
    expectedErrorCode: 'LOGIN_POST_STATUS_MISMATCH',
  });

  await assertPublishLoginDiagnostic({
    name: 'post final URL precedes Location',
    loginPostResponse: {
      status: 302,
      finalUrl: `${JINAN_CMS_CONFIG.loginUrl}?token=query-secret`,
      location: '/admin/index.php?raw-location-secret=1',
    },
    expectedErrorCode: 'LOGIN_POST_FINAL_URL_MISMATCH',
  });

  await assertPublishLoginDiagnostic({
    name: 'post Location mismatch',
    loginPostResponse: {
      status: 302,
      finalUrl: JINAN_CMS_CONFIG.loginUrl,
      location: '/admin/index.php?raw-location-secret=1',
    },
    expectedErrorCode: 'LOGIN_POST_LOCATION_MISMATCH',
  });
});

test('G2c4. publish login landing diagnostics use exact safe reason codes and deterministic precedence', async () => {
  const successfulPost = {
    status: 302,
    finalUrl: JINAN_CMS_CONFIG.loginUrl,
    location: '/admin/index.php',
  };

  await assertPublishLoginDiagnostic({
    name: 'landing status has precedence',
    loginPostResponse: successfulPost,
    landingResponse: {
      status: 302,
      finalUrl: `${LOGIN_SUCCESS_LANDING_URL}?token=query-secret`,
      headers: { location: '/admin/index.php?raw-location-secret=1', 'X-Debug': 'header-secret' },
    },
    expectedErrorCode: 'LOGIN_LANDING_STATUS_MISMATCH',
    expectedCalls: 4,
  });

  await assertPublishLoginDiagnostic({
    name: 'landing URL precedes redirect drift',
    loginPostResponse: successfulPost,
    landingResponse: {
      status: 200,
      finalUrl: `${LOGIN_SUCCESS_LANDING_URL}?token=query-secret`,
      location: '/admin/index.php?raw-location-secret=1',
    },
    expectedErrorCode: 'LOGIN_LANDING_URL_MISMATCH',
    expectedCalls: 4,
  });

  await assertPublishLoginDiagnostic({
    name: 'landing redirect drift',
    loginPostResponse: successfulPost,
    landingResponse: {
      status: 200,
      finalUrl: LOGIN_SUCCESS_LANDING_URL,
      location: '/admin/index.php?raw-location-secret=1',
    },
    expectedErrorCode: 'LOGIN_LANDING_REDIRECT_DRIFT',
    expectedCalls: 4,
  });
});

test('G2d. login POST response validator allows only exact evidenced success contract', () => {
  for (const response of [
    { status: 302, finalUrl: JINAN_CMS_CONFIG.loginUrl, location: '/admin/index.php' },
  ]) {
    assert.doesNotThrow(() => validateLoginPostResponse(response));
  }

  for (const response of [
    { status: 200, finalUrl: JINAN_CMS_CONFIG.loginUrl },
    { status: 200, finalUrl: JINAN_CMS_CONFIG.loginUrl, location: '/admin/index.php' },
    { status: 401, finalUrl: JINAN_CMS_CONFIG.loginUrl },
    { status: 301, finalUrl: JINAN_CMS_CONFIG.loginUrl, location: '/admin/index.php' },
    { status: 303, finalUrl: JINAN_CMS_CONFIG.loginUrl, location: '/admin/index.php' },
    { status: 307, finalUrl: JINAN_CMS_CONFIG.loginUrl, location: '/admin/index.php' },
    { status: 308, finalUrl: JINAN_CMS_CONFIG.loginUrl, location: '/admin/index.php' },
    { status: 302, finalUrl: `${JINAN_CMS_CONFIG.loginUrl}?next=1`, location: '/admin/index.php' },
    { status: 302, finalUrl: JINAN_CMS_CONFIG.editorUrl, location: '/admin/index.php' },
    { status: 302, finalUrl: JINAN_CMS_CONFIG.loginUrl, location: LOGIN_SUCCESS_LANDING_URL },
    { status: 302, finalUrl: JINAN_CMS_CONFIG.loginUrl, location: '//www.tainanrehab.com/admin/index.php' },
    { status: 302, finalUrl: JINAN_CMS_CONFIG.loginUrl, location: '\\admin\\index.php' },
    { status: 302, finalUrl: JINAN_CMS_CONFIG.loginUrl, location: 'https://attacker.example/admin/index.php' },
    { status: 302, finalUrl: JINAN_CMS_CONFIG.loginUrl, location: 'http://www.tainanrehab.com/admin/index.php' },
    { status: 302, finalUrl: JINAN_CMS_CONFIG.loginUrl, location: 'https://user:pass@www.tainanrehab.com/admin/index.php' },
    { status: 302, finalUrl: JINAN_CMS_CONFIG.loginUrl, location: 'http://[::1' },
    { status: 302, finalUrl: JINAN_CMS_CONFIG.loginUrl, location: '/admin/../admin/index.php' },
    { status: 302, finalUrl: JINAN_CMS_CONFIG.loginUrl, location: '/admin/%2e%2e/admin/index.php' },
    { status: 302, finalUrl: JINAN_CMS_CONFIG.loginUrl, location: '/admin/index.php?op=time' },
    { status: 302, finalUrl: JINAN_CMS_CONFIG.loginUrl, location: '/admin/index.php#top' },
    { status: 302, finalUrl: JINAN_CMS_CONFIG.loginUrl, location: '/time.html' },
    { status: 302, finalUrl: JINAN_CMS_CONFIG.loginUrl, location: ' /admin/index.php' },
    { status: 302, finalUrl: JINAN_CMS_CONFIG.loginUrl, location: '/admin/index.php ' },
    { status: 302, location: '/admin/index.php' },
    { status: 302, finalUrl: '', location: '/admin/index.php' },
    { status: 302, url: JINAN_CMS_CONFIG.loginUrl, location: '/admin/index.php' },
  ]) {
    assertCode(() => validateLoginPostResponse(response), 'VERIFY_FAILED');
  }
});

test('G3. preflightPublish export is the fail-closed safe preflight alias', async () => {
  assert.equal(typeof preflightPublish, 'function');
  assert.equal(preflightPublish, preflightJinanCmsPublish);
  assert.equal((await preflightPublish({ pngDataUrl: pngDataUrl(), env: {} })).status, 'AUTH_FAILED');
});

test('G. preflight fail-closes auth, verification, and form failures', async () => {
  const authTransport = makeTransport([
    { status: 200, finalUrl: JINAN_CMS_CONFIG.publicUrl, body: publicCompositeHtml() },
    { status: 200, finalUrl: JINAN_CMS_CONFIG.loginUrl, body: loginHtml() },
    { status: 200, finalUrl: JINAN_CMS_CONFIG.loginUrl, body: loginHtml() },
  ]);
  assert.equal((await preflightJinanCmsPublish({
    pngDataUrl: pngDataUrl(),
    finalImageUrl: '/upload/new.png',
    env: { JINAN_CMS_USERNAME: 'u', JINAN_CMS_PASSWORD: 'p' },
    transport: authTransport,
  })).status, 'AUTH_FAILED');
  assert.deepEqual(authTransport.calls.map((call) => `${call.method} ${call.url}`), [
    `GET ${JINAN_CMS_CONFIG.publicUrl}`,
    `GET ${JINAN_CMS_CONFIG.loginUrl}`,
    `POST ${JINAN_CMS_CONFIG.loginUrl}`,
  ]);

  const publicFailure = makeTransport([new Error('offline')]);
  assert.equal((await preflightJinanCmsPublish({
    pngDataUrl: pngDataUrl(),
    finalImageUrl: '/upload/new.png',
    env: { JINAN_CMS_USERNAME: 'u', JINAN_CMS_PASSWORD: 'p' },
    transport: publicFailure,
  })).status, 'VERIFY_FAILED');

  const formFailure = makeTransport([
    { status: 200, finalUrl: JINAN_CMS_CONFIG.publicUrl, body: publicCompositeHtml() },
    { status: 200, finalUrl: JINAN_CMS_CONFIG.loginUrl, body: loginHtml() },
    { status: 302, finalUrl: JINAN_CMS_CONFIG.loginUrl, location: '/admin/index.php', setCookie: ['sid=x; Path=/admin'] },
    loginSuccessLandingResponse(),
    { status: 200, finalUrl: JINAN_CMS_CONFIG.editorUrl, body: '<form name="addAdminFrm"></form>' },
  ]);
  assert.equal((await preflightJinanCmsPublish({
    pngDataUrl: pngDataUrl(),
    finalImageUrl: '/upload/new.png',
    env: { JINAN_CMS_USERNAME: 'u', JINAN_CMS_PASSWORD: 'p' },
    transport: formFailure,
  })).status, 'FORM_CHANGED');
});

test('G6. preflight classifies only structurally exact login form credential rejection as AUTH_FAILED', async () => {
  const cases = [
    { name: 'blank 200 login body', response: { status: 200, finalUrl: JINAN_CMS_CONFIG.loginUrl, body: '' } },
    { name: 'malformed 200 login body', response: { status: 200, finalUrl: JINAN_CMS_CONFIG.loginUrl, body: '<form></form>' } },
    { name: 'WAF-like 200 login body', response: { status: 200, finalUrl: JINAN_CMS_CONFIG.loginUrl, body: '<html><title>Access denied</title></html>' } },
    { name: '201 exact login form no location', response: { status: 201, finalUrl: JINAN_CMS_CONFIG.loginUrl, body: loginHtml() } },
  ];

  for (const { name, response } of cases) {
    const transport = makeTransport([
      { status: 200, finalUrl: JINAN_CMS_CONFIG.publicUrl, body: publicCompositeHtml() },
      { status: 200, finalUrl: JINAN_CMS_CONFIG.loginUrl, body: loginHtml() },
      response,
    ]);

    const result = await preflightJinanCmsPublish({
      pngDataUrl: pngDataUrl(),
      finalImageUrl: '/upload/new.png',
      env: { JINAN_CMS_USERNAME: 'u', JINAN_CMS_PASSWORD: 'p' },
      transport,
    });

    assert.equal(result.status, 'VERIFY_FAILED', name);
    assert.deepEqual(transport.calls.map((call) => `${call.method} ${call.url}`), [
      `GET ${JINAN_CMS_CONFIG.publicUrl}`,
      `GET ${JINAN_CMS_CONFIG.loginUrl}`,
      `POST ${JINAN_CMS_CONFIG.loginUrl}`,
    ], name);
    assert.equal(transport.calls.filter((call) => call.method === 'GET' && call.url === LOGIN_SUCCESS_LANDING_URL).length, 0, name);
    assert.equal(transport.calls.filter((call) => call.method === 'GET' && call.url === JINAN_CMS_CONFIG.editorUrl).length, 0, name);
    assert.equal(transport.calls.some((call) => call.url.includes('QuickUpload')), false, name);
    assert.equal(transport.calls.some((call) => call.method === 'POST' && call.url.includes('op=time&sub=set')), false, name);
  }
});

test('G6a. preflight fail-closes exact login-form credential rejection with present empty Location', async () => {
  for (const { name, response: loginPostResponse } of emptyLocationResponseCases({
    status: 200,
    finalUrl: JINAN_CMS_CONFIG.loginUrl,
    body: loginHtml(),
  })) {
    const transport = makeTransport([
      { status: 200, finalUrl: JINAN_CMS_CONFIG.publicUrl, body: publicCompositeHtml() },
      { status: 200, finalUrl: JINAN_CMS_CONFIG.loginUrl, body: loginHtml() },
      loginPostResponse,
    ]);

    const result = await preflightJinanCmsPublish({
      pngDataUrl: pngDataUrl(),
      finalImageUrl: '/upload/new.png',
      env: { JINAN_CMS_USERNAME: 'u', JINAN_CMS_PASSWORD: 'p' },
      transport,
    });

    assert.equal(result.status, 'VERIFY_FAILED', name);
    assert.deepEqual(transport.calls.map((call) => `${call.method} ${call.url}`), [
      `GET ${JINAN_CMS_CONFIG.publicUrl}`,
      `GET ${JINAN_CMS_CONFIG.loginUrl}`,
      `POST ${JINAN_CMS_CONFIG.loginUrl}`,
    ], name);
    assert.equal(transport.calls.length, 3, name);
    assert.equal(transport.calls.filter((call) => call.method === 'GET' && call.url === LOGIN_SUCCESS_LANDING_URL).length, 0, name);
    assert.equal(transport.calls.filter((call) => call.method === 'GET' && call.url === JINAN_CMS_CONFIG.editorUrl).length, 0, name);
    assert.equal(transport.calls.some((call) => call.url.includes('QuickUpload')), false, name);
    assert.equal(transport.calls.some((call) => call.method === 'POST' && call.url.includes('op=time&sub=set')), false, name);
  }
});

test('G4. preflight validates login GET form before sending credentials', async () => {
  const transport = makeTransport([
    { status: 200, finalUrl: JINAN_CMS_CONFIG.publicUrl, body: publicCompositeHtml() },
    { status: 200, finalUrl: JINAN_CMS_CONFIG.loginUrl, body: '<form></form>' },
  ]);
  const result = await preflightJinanCmsPublish({
    pngDataUrl: pngDataUrl(),
    finalImageUrl: '/upload/new.png',
    env: { JINAN_CMS_USERNAME: 'synthetic-user', JINAN_CMS_PASSWORD: 'synthetic-password' },
    transport,
  });
  assert.equal(result.status, 'FORM_CHANGED');
  assert.deepEqual(transport.calls.map((call) => call.method), ['GET', 'GET']);
});

test('G5. preflight rejects structurally anchored non-timetable staff gallery before credentials', async () => {
  reloadJinanCmsModule();
  const staffGallery = '<section class="notice">門診異動請以現場公告為準</section>'
    + '<div class="appointment"><a href="https://lin.ee/appointment">線上預約<img src="/images/line-icon.png" alt="LINE"></a></div>'
    + '<p class="text-center" style="text-align: center;">\r\n'
    + '<span style="font-size: 18px;">團隊相片</span><br />\r\n'
    + '<strong><span style="font-size: 24px;">員工合照</span></strong><br />\r\n'
    + timetableImageTail(['/upload/staff-1.png', '/upload/staff-2.png', '/upload/staff-3.png', '/upload/staff-4.png'])
    + '</p>'
    + '<p><img src="/images/unrelated-footer.png" alt="map"></p>';
  const transport = makeTransport([
    { status: 200, finalUrl: JINAN_CMS_CONFIG.publicUrl, body: publicCompositeHtml({ note: staffGallery }) },
    { status: 200, finalUrl: JINAN_CMS_CONFIG.loginUrl, body: loginHtml() },
    { status: 302, finalUrl: JINAN_CMS_CONFIG.loginUrl, location: '/admin/index.php', setCookie: ['sid=x; Path=/admin'] },
    loginSuccessLandingResponse(),
    { status: 200, finalUrl: JINAN_CMS_CONFIG.editorUrl, body: freshCompositeEditorHtml({ note: staffGallery }) },
  ]);

  const result = await preflightJinanCmsPublish({
    pngDataUrl: pngDataUrl(),
    finalImageUrl: '/uploads/2026/jinan.png',
    env: { JINAN_CMS_USERNAME: 'synthetic-user', JINAN_CMS_PASSWORD: 'synthetic-password' },
    transport,
  });

  assert.deepEqual(result, { status: 'FORM_CHANGED' });
  assert.equal(transport.calls.some((call) => call.url.includes('QuickUpload')), false);
});

test('M. publish pipeline gate-disabled returns unverified before credentials or transport', async () => {
  const transport = makeTransport([new Error('must not call')]);
  const result = await publishJinanCms({
    pngDataUrl: pngDataUrl(),
    env: {
      JINAN_CMS_PUBLISH_ENABLED: 'false',
      JINAN_CMS_USERNAME: 'synthetic-user',
      JINAN_CMS_PASSWORD: 'synthetic-password',
    },
    transport,
  });

  assert.deepEqual(result, { status: 'CMS_RESPONSE_CONTRACT_UNVERIFIED' });
  assert.equal(transport.calls.length, 0);
});

test('M2. publish pipeline succeeds only after verified upload, submit redirect, and fresh public match', async () => {
  const transport = makeTransport([
    { status: 200, finalUrl: JINAN_CMS_CONFIG.publicUrl, body: publicCompositeHtml({ note: realProductionCompositeNote() }) },
    { status: 200, finalUrl: JINAN_CMS_CONFIG.loginUrl, body: loginHtml(), setCookie: ['sid=login; Path=/admin; HttpOnly'] },
    { status: 302, finalUrl: JINAN_CMS_CONFIG.loginUrl, location: '/admin/index.php', setCookie: ['sid=x; Path=/admin'] },
    loginSuccessLandingResponse(),
    { status: 200, finalUrl: JINAN_CMS_CONFIG.editorUrl, body: freshCompositeEditorHtml({ note: realProductionCompositeNote() }).replace('fresh-token', 'before-upload') },
    { status: 200, finalUrl: QUICK_UPLOAD_RESPONSE_URL, contentType: 'text/html; charset=utf-8', body: uploadSuccessBody('/uploads/2026/jinan.png', 37) },
    { status: 200, finalUrl: JINAN_CMS_CONFIG.editorUrl, body: freshCompositeEditorHtml({ note: realProductionCompositeNote() }).replace('fresh-token', 'after-upload') },
    { status: 302, finalUrl: JINAN_CMS_CONFIG.editorUrl, location: '/admin/index.php?op=time&sub=set&mesCode=1' },
    { status: 200, finalUrl: JINAN_CMS_CONFIG.publicUrl, body: publicCompositeHtml({ note: realProductionCompositeNote() }) },
    { status: 200, finalUrl: JINAN_CMS_CONFIG.publicUrl, body: publicRealProductionHtml('/uploads/2026/jinan.png') },
    { status: 200, finalUrl: `${JINAN_CMS_CONFIG.origin}/uploads/2026/jinan.png`, contentType: 'image/png', body: pngBuffer() },
  ]);
  const sleeps = [];

  const result = await publishJinanCms({
    pngDataUrl: pngDataUrl(),
    callbackNumber: 37,
    env: {
      JINAN_CMS_PUBLISH_ENABLED: 'true',
      JINAN_CMS_USERNAME: 'synthetic-user',
      JINAN_CMS_PASSWORD: 'synthetic-password',
    },
    transport,
    sleep: async (ms) => { sleeps.push(ms); },
    verificationDelaysMs: [5, 10],
  });

  assert.deepEqual(result, {
    status: 'PUBLISHED',
    channels: [{ id: 'jinan-website', ok: true }],
  });
  assert.deepEqual(transport.calls.map((call) => `${call.method} ${call.url}`), [
    `GET ${JINAN_CMS_CONFIG.publicUrl}`,
    `GET ${JINAN_CMS_CONFIG.loginUrl}`,
    `POST ${JINAN_CMS_CONFIG.loginUrl}`,
    `GET ${LOGIN_SUCCESS_LANDING_URL}`,
    `GET ${JINAN_CMS_CONFIG.editorUrl}`,
    `POST ${JINAN_CMS_CONFIG.quickUploadUrl}?command=QuickUpload&type=Images&CKEditor=note&CKEditorFuncNum=37&langCode=zh`,
    `GET ${JINAN_CMS_CONFIG.editorUrl}`,
    `POST ${JINAN_CMS_CONFIG.editorUrl}`,
    `GET ${JINAN_CMS_CONFIG.publicUrl}`,
    `GET ${JINAN_CMS_CONFIG.publicUrl}`,
    `GET ${JINAN_CMS_CONFIG.origin}/uploads/2026/jinan.png`,
  ]);
  assert.equal(transport.calls.filter((call) => call.url.includes('QuickUpload')).length, 1);
  assert.equal(transport.calls.filter((call) => call.method === 'POST' && call.url === JINAN_CMS_CONFIG.editorUrl).length, 1);
  assert.deepEqual(sleeps, [5]);
  const json = JSON.stringify(result);
  for (const secret of ['synthetic-user', 'synthetic-password', 'protected-cookie', 'data:image/png', 'after-upload', '/uploads/2026/jinan.png']) {
    assert.equal(json.includes(secret), false);
  }
});

test('M2a. publish pipeline preserves percent-encoded QuickUpload path through public verification', async () => {
  reloadJinanCmsModule();
  const finalPath = '/uploads/2026/a%20b.png';
  const transport = makeTransport([
    { status: 200, finalUrl: JINAN_CMS_CONFIG.publicUrl, body: publicCompositeHtml() },
    { status: 200, finalUrl: JINAN_CMS_CONFIG.loginUrl, body: loginHtml(), setCookie: ['sid=login; Path=/admin; HttpOnly'] },
    { status: 302, finalUrl: JINAN_CMS_CONFIG.loginUrl, location: '/admin/index.php', setCookie: ['sid=x; Path=/admin'] },
    loginSuccessLandingResponse(),
    { status: 200, finalUrl: JINAN_CMS_CONFIG.editorUrl, body: freshEditorHtml().replace('fresh-token', 'before-upload') },
    { status: 200, finalUrl: QUICK_UPLOAD_RESPONSE_URL, contentType: 'text/html; charset=utf-8', body: uploadSuccessBody(finalPath, 37) },
    { status: 200, finalUrl: JINAN_CMS_CONFIG.editorUrl, body: freshEditorHtml().replace('fresh-token', 'after-upload') },
    { status: 302, finalUrl: JINAN_CMS_CONFIG.editorUrl, location: '/admin/index.php?op=time&sub=set&mesCode=1' },
    { status: 200, finalUrl: JINAN_CMS_CONFIG.publicUrl, body: publicHtml(finalPath) },
    { status: 200, finalUrl: `${JINAN_CMS_CONFIG.origin}${finalPath}`, contentType: 'image/png', body: pngBuffer() },
  ]);

  const result = await publishJinanCms({
    pngDataUrl: pngDataUrl(),
    callbackNumber: 37,
    env: {
      JINAN_CMS_PUBLISH_ENABLED: 'true',
      JINAN_CMS_USERNAME: 'synthetic-user',
      JINAN_CMS_PASSWORD: 'synthetic-password',
    },
    transport,
    sleep: async () => {},
  });

  assert.deepEqual(result, {
    status: 'PUBLISHED',
    channels: [{ id: 'jinan-website', ok: true }],
  });
  assert.equal(transport.calls.some((call) => call.method === 'POST'
    && call.url === JINAN_CMS_CONFIG.editorUrl), true);
  assert.equal(transport.calls.at(-1).url, `${JINAN_CMS_CONFIG.origin}${finalPath}`);
});

test('M2b. publish pipeline performs post-submit public verification anonymously', async () => {
  const transport = makeTransport([
    { status: 200, finalUrl: JINAN_CMS_CONFIG.publicUrl, body: publicCompositeHtml() },
    { status: 200, finalUrl: JINAN_CMS_CONFIG.loginUrl, body: loginHtml(), setCookie: ['sid=login; Path=/admin; HttpOnly'] },
    { status: 302, finalUrl: JINAN_CMS_CONFIG.loginUrl, location: '/admin/index.php', setCookie: ['sid=x; Path=/admin'] },
    loginSuccessLandingResponse(),
    { status: 200, finalUrl: JINAN_CMS_CONFIG.editorUrl, body: freshEditorHtml().replace('fresh-token', 'before-upload') },
    { status: 200, finalUrl: QUICK_UPLOAD_RESPONSE_URL, contentType: 'text/html; charset=utf-8', body: uploadSuccessBody('/uploads/2026/jinan.png', 37) },
    { status: 200, finalUrl: JINAN_CMS_CONFIG.editorUrl, body: freshEditorHtml().replace('fresh-token', 'after-upload') },
    { status: 302, finalUrl: JINAN_CMS_CONFIG.editorUrl, location: '/admin/index.php?op=time&sub=set&mesCode=1' },
    { status: 200, finalUrl: JINAN_CMS_CONFIG.publicUrl, body: publicHtml('/uploads/2026/jinan.png') },
    { status: 200, finalUrl: `${JINAN_CMS_CONFIG.origin}/uploads/2026/jinan.png`, contentType: 'image/png', body: pngBuffer() },
  ]);

  const result = await publishJinanCms({
    pngDataUrl: pngDataUrl(),
    callbackNumber: 37,
    env: {
      JINAN_CMS_PUBLISH_ENABLED: 'true',
      JINAN_CMS_USERNAME: 'synthetic-user',
      JINAN_CMS_PASSWORD: 'synthetic-password',
    },
    transport,
    sleep: async () => {},
  });

  assert.equal(result.status, 'PUBLISHED');
  const postSubmitPublicCalls = transport.calls
    .slice(8)
    .filter((call) => call.method === 'GET' && call.url === JINAN_CMS_CONFIG.publicUrl);
  assert.equal(postSubmitPublicCalls.length, 1);
  assert.equal(postSubmitPublicCalls.every((call) => call.hasCookie === false && call.cookie === ''), true);
});

test('M2b2. post-submit final image GET does not inherit anonymous public page cookies', async () => {
  reloadJinanCmsModule();
  const transport = makeTransport([
    { status: 200, finalUrl: JINAN_CMS_CONFIG.publicUrl, body: publicCompositeHtml() },
    { status: 200, finalUrl: JINAN_CMS_CONFIG.loginUrl, body: loginHtml(), setCookie: ['sid=login; Path=/admin; HttpOnly'] },
    { status: 302, finalUrl: JINAN_CMS_CONFIG.loginUrl, location: '/admin/index.php', setCookie: ['sid=x; Path=/admin'] },
    loginSuccessLandingResponse(),
    { status: 200, finalUrl: JINAN_CMS_CONFIG.editorUrl, body: freshEditorHtml().replace('fresh-token', 'before-upload') },
    { status: 200, finalUrl: QUICK_UPLOAD_RESPONSE_URL, contentType: 'text/html; charset=utf-8', body: uploadSuccessBody('/uploads/2026/jinan.png', 37) },
    { status: 200, finalUrl: JINAN_CMS_CONFIG.editorUrl, body: freshEditorHtml().replace('fresh-token', 'after-upload') },
    { status: 302, finalUrl: JINAN_CMS_CONFIG.editorUrl, location: '/admin/index.php?op=time&sub=set&mesCode=1' },
    {
      status: 200,
      finalUrl: JINAN_CMS_CONFIG.publicUrl,
      body: publicHtml('/uploads/2026/jinan.png'),
      setCookie: ['anonymous_public=1; Path=/; HttpOnly'],
    },
    { status: 200, finalUrl: `${JINAN_CMS_CONFIG.origin}/uploads/2026/jinan.png`, contentType: 'image/png', body: pngBuffer() },
  ]);

  const result = await publishJinanCms({
    pngDataUrl: pngDataUrl(),
    callbackNumber: 37,
    env: {
      JINAN_CMS_PUBLISH_ENABLED: 'true',
      JINAN_CMS_USERNAME: 'synthetic-user',
      JINAN_CMS_PASSWORD: 'synthetic-password',
    },
    transport,
    sleep: async () => {},
  });

  assert.equal(result.status, 'PUBLISHED');
  const imageCall = transport.calls.at(-1);
  assert.equal(imageCall.url, `${JINAN_CMS_CONFIG.origin}/uploads/2026/jinan.png`);
  assert.equal(imageCall.cookie, '');
  assert.equal(imageCall.hasCookie, false);
});

test('M2g. post-submit public verification rejects altered percent encodings and hidden or duplicate final paths', async () => {
  for (const [name, body] of [
    ['decoded path', publicHtml('/uploads/2026/a b.png')],
    ['different encoding', publicHtml('/uploads/2026/a%2520b.png')],
    ['duplicate exact path', publicHtml('/uploads/2026/a%20b.png').replace('<img src="/uploads/2026/a%20b.png" />', '<img src="/uploads/2026/a%20b.png"><img src="/uploads/2026/a%20b.png">')],
    ['hidden exact path', publicHtml('/uploads/2026/a%20b.png').replace('<img src="/uploads/2026/a%20b.png" />', '<img hidden src="/uploads/2026/a%20b.png">')],
  ]) {
    reloadJinanCmsModule();
    const transport = makeTransport([
      { status: 200, finalUrl: JINAN_CMS_CONFIG.publicUrl, body: publicCompositeHtml() },
      { status: 200, finalUrl: JINAN_CMS_CONFIG.loginUrl, body: loginHtml() },
      { status: 302, finalUrl: JINAN_CMS_CONFIG.loginUrl, location: '/admin/index.php', setCookie: ['sid=x; Path=/admin'] },
      loginSuccessLandingResponse(),
      { status: 200, finalUrl: JINAN_CMS_CONFIG.editorUrl, body: freshEditorHtml() },
      { status: 200, finalUrl: QUICK_UPLOAD_RESPONSE_URL, contentType: 'text/html', body: uploadSuccessBody('/uploads/2026/a%20b.png', 37) },
      { status: 200, finalUrl: JINAN_CMS_CONFIG.editorUrl, body: freshEditorHtml() },
      { status: 302, finalUrl: JINAN_CMS_CONFIG.editorUrl, location: '/admin/index.php?op=time&sub=set&mesCode=1' },
      { status: 200, finalUrl: JINAN_CMS_CONFIG.publicUrl, body },
      { status: 200, finalUrl: JINAN_CMS_CONFIG.publicUrl, body },
      { status: 200, finalUrl: JINAN_CMS_CONFIG.publicUrl, body },
    ]);
    const result = await publishJinanCms({
      pngDataUrl: pngDataUrl(),
      callbackNumber: 37,
      env: {
        JINAN_CMS_PUBLISH_ENABLED: 'true',
        JINAN_CMS_USERNAME: 'synthetic-user',
        JINAN_CMS_PASSWORD: 'synthetic-password',
      },
      transport,
      sleep: async () => {},
      verificationDelaysMs: [1, 2],
    });
    assert.deepEqual(result, {
      status: 'MANUAL_CHECK_REQUIRED',
      orphanUploadRisk: true,
      finalImagePath: '/uploads/2026/a%20b.png',
    }, name);
    assert.equal(transport.calls.some((call) => call.url === `${JINAN_CMS_CONFIG.origin}/uploads/2026/a%20b.png`), false, name);
  }
});

test('M2c. publish pipeline blocks mutation when editor drifts from initial public baseline before upload', async () => {
  reloadJinanCmsModule();
  const driftedNote = compositeTimetableNote()
    .replace('門診異動請以現場公告為準', '門診異動已被後台改寫')
    .replace('https://lin.ee/appointment', 'https://lin.ee/changed-appointment')
    .replace('/images/unrelated-footer.png', '/images/changed-footer.png');
  const transport = makeTransport([
    { status: 200, finalUrl: JINAN_CMS_CONFIG.publicUrl, body: publicCompositeHtml() },
    { status: 200, finalUrl: JINAN_CMS_CONFIG.loginUrl, body: loginHtml() },
    { status: 302, finalUrl: JINAN_CMS_CONFIG.loginUrl, location: '/admin/index.php', setCookie: ['sid=x; Path=/admin'] },
    loginSuccessLandingResponse(),
    { status: 200, finalUrl: JINAN_CMS_CONFIG.editorUrl, body: freshCompositeEditorHtml({ note: driftedNote }) },
  ]);

  const result = await publishJinanCms({
    pngDataUrl: pngDataUrl(),
    callbackNumber: 37,
    env: {
      JINAN_CMS_PUBLISH_ENABLED: 'true',
      JINAN_CMS_USERNAME: 'synthetic-user',
      JINAN_CMS_PASSWORD: 'synthetic-password',
    },
    transport,
  });

  assert.deepEqual(result, { status: 'FORM_CHANGED' });
  assert.equal(transport.calls.some((call) => call.url.includes('QuickUpload')), false);
  assert.equal(transport.calls.some((call) => call.method === 'POST' && call.url === JINAN_CMS_CONFIG.editorUrl), false);
});

test('M2d. publish pipeline blocks submit when fresh editor drifts after upload', async () => {
  reloadJinanCmsModule();
  const driftedNote = compositeTimetableNote()
    .replace('門診異動請以現場公告為準', '門診異動已被後台改寫')
    .replace('https://lin.ee/appointment', 'https://lin.ee/changed-appointment')
    .replace('/images/unrelated-footer.png', '/images/changed-footer.png');
  const transport = makeTransport([
    { status: 200, finalUrl: JINAN_CMS_CONFIG.publicUrl, body: publicCompositeHtml() },
    { status: 200, finalUrl: JINAN_CMS_CONFIG.loginUrl, body: loginHtml() },
    { status: 302, finalUrl: JINAN_CMS_CONFIG.loginUrl, location: '/admin/index.php', setCookie: ['sid=x; Path=/admin'] },
    loginSuccessLandingResponse(),
    { status: 200, finalUrl: JINAN_CMS_CONFIG.editorUrl, body: freshEditorHtml() },
    { status: 200, finalUrl: QUICK_UPLOAD_RESPONSE_URL, contentType: 'text/html', body: uploadSuccessBody('/uploads/2026/drift.png', 37) },
    { status: 200, finalUrl: JINAN_CMS_CONFIG.editorUrl, body: freshCompositeEditorHtml({ note: driftedNote }) },
  ]);

  const result = await publishJinanCms({
    pngDataUrl: pngDataUrl(),
    callbackNumber: 37,
    env: {
      JINAN_CMS_PUBLISH_ENABLED: 'true',
      JINAN_CMS_USERNAME: 'synthetic-user',
      JINAN_CMS_PASSWORD: 'synthetic-password',
    },
    transport,
  });

  assert.deepEqual(result, {
    status: 'MANUAL_CHECK_REQUIRED',
    orphanUploadRisk: true,
    finalImagePath: '/uploads/2026/drift.png',
  });
  assert.equal(transport.calls.filter((call) => call.url.includes('QuickUpload')).length, 1);
  assert.equal(transport.calls.filter((call) => call.method === 'POST' && call.url === JINAN_CMS_CONFIG.editorUrl).length, 0);
});

test('M2e. publish pipeline requires the complete editor note to occur exactly once in initial public baseline', async () => {
  for (const [name, publicBody] of [
    ['collection-only baseline omits preserved editor note bytes', publicCompositeHtml({ note: timetableBlock() })],
    ['duplicate complete note baseline is ambiguous', publicCompositeHtml({ note: compositeTimetableNote() + compositeTimetableNote() })],
  ]) {
    reloadJinanCmsModule();
    const transport = makeTransport([
      { status: 200, finalUrl: JINAN_CMS_CONFIG.publicUrl, body: publicBody },
      { status: 200, finalUrl: JINAN_CMS_CONFIG.loginUrl, body: loginHtml() },
      { status: 302, finalUrl: JINAN_CMS_CONFIG.loginUrl, location: '/admin/index.php', setCookie: ['sid=x; Path=/admin'] },
      loginSuccessLandingResponse(),
      { status: 200, finalUrl: JINAN_CMS_CONFIG.editorUrl, body: freshEditorHtml() },
    ]);

    const result = await publishJinanCms({
      pngDataUrl: pngDataUrl(),
      callbackNumber: 37,
      env: {
        JINAN_CMS_PUBLISH_ENABLED: 'true',
        JINAN_CMS_USERNAME: 'synthetic-user',
        JINAN_CMS_PASSWORD: 'synthetic-password',
      },
      transport,
    });

    assert.deepEqual(result, { status: 'FORM_CHANGED' }, name);
    assert.equal(transport.calls.some((call) => call.url.includes('QuickUpload')), false, name);
    assert.equal(transport.calls.some((call) => call.method === 'POST' && call.url === JINAN_CMS_CONFIG.editorUrl), false, name);
  }
});

test('M2f. post-submit public verification rejects any extra content in the replacement range', async () => {
  for (const [name, replacement] of [
    ['extra text', 'updated<img src="/uploads/2026/jinan.png" />'],
    ['script tag', '<script></script><img src="/uploads/2026/jinan.png" />'],
    ['br tag', '<img src="/uploads/2026/jinan.png" /><br />'],
    ['unrelated wrapper tag', '<span><img src="/uploads/2026/jinan.png" /></span>'],
    ['unrelated image', '<img src="/uploads/2026/other.png" /><img src="/uploads/2026/jinan.png" />'],
  ]) {
    reloadJinanCmsModule();
    const transport = makeTransport([
      { status: 200, finalUrl: JINAN_CMS_CONFIG.publicUrl, body: publicCompositeHtml() },
      { status: 200, finalUrl: JINAN_CMS_CONFIG.loginUrl, body: loginHtml() },
      { status: 302, finalUrl: JINAN_CMS_CONFIG.loginUrl, location: '/admin/index.php', setCookie: ['sid=x; Path=/admin'] },
      loginSuccessLandingResponse(),
      { status: 200, finalUrl: JINAN_CMS_CONFIG.editorUrl, body: freshEditorHtml() },
      { status: 200, finalUrl: QUICK_UPLOAD_RESPONSE_URL, contentType: 'text/html', body: uploadSuccessBody('/uploads/2026/jinan.png', 37) },
      { status: 200, finalUrl: JINAN_CMS_CONFIG.editorUrl, body: freshEditorHtml() },
      { status: 302, finalUrl: JINAN_CMS_CONFIG.editorUrl, location: '/admin/index.php?op=time&sub=set&mesCode=1' },
      { status: 200, finalUrl: JINAN_CMS_CONFIG.publicUrl, body: publicHtmlWithTimetableReplacement(replacement) },
      { status: 200, finalUrl: JINAN_CMS_CONFIG.publicUrl, body: publicHtmlWithTimetableReplacement(replacement) },
      { status: 200, finalUrl: JINAN_CMS_CONFIG.publicUrl, body: publicHtmlWithTimetableReplacement(replacement) },
    ]);

    const result = await publishJinanCms({
      pngDataUrl: pngDataUrl(),
      callbackNumber: 37,
      env: {
        JINAN_CMS_PUBLISH_ENABLED: 'true',
        JINAN_CMS_USERNAME: 'synthetic-user',
        JINAN_CMS_PASSWORD: 'synthetic-password',
      },
      transport,
      sleep: async () => {},
    });

    assert.deepEqual(result, {
      status: 'MANUAL_CHECK_REQUIRED',
      orphanUploadRisk: true,
      finalImagePath: '/uploads/2026/jinan.png',
    }, name);
    assert.equal(transport.calls.filter((call) => call.url.includes('QuickUpload')).length, 1, name);
    assert.equal(transport.calls.filter((call) => call.method === 'POST' && call.url === JINAN_CMS_CONFIG.editorUrl).length, 1, name);
  }
});

test('M2e. post-submit verification rejects public page drift, old residue, and ambiguous final images', async () => {
  const badPages = [
    ['text drift', publicHtml('/uploads/2026/final.png').replace('門診異動請以現場公告為準', '門診異動已被改寫')],
    ['link drift', publicHtml('/uploads/2026/final.png').replace('https://lin.ee/appointment', 'https://example.invalid')],
    ['unrelated image drift', publicHtml('/uploads/2026/final.png').replace('/images/unrelated-footer.png', '/images/changed.png')],
    ['old residue', publicHtml('/uploads/2026/final.png').replace('</main>', `${TIMETABLE_OLD_IMAGES[0]}</main>`)],
    ['wrong final image', publicCompositeHtml({ note: compositeTimetableNote().replace(TIMETABLE_OLD_IMAGES[0], '/uploads/2026/final.png') })],
    ['multiple final images', publicHtml('/uploads/2026/final.png').replace('<img src="/uploads/2026/final.png" />', '<img src="/uploads/2026/final.png"><br><img src="/uploads/2026/final.png">')],
    ['hidden final image', publicHtml('/uploads/2026/final.png').replace('<img src="/uploads/2026/final.png" />', '<img hidden src="/uploads/2026/final.png">')],
  ];

  for (const [name, body] of badPages) {
    reloadJinanCmsModule();
    const transport = makeTransport([
      { status: 200, finalUrl: JINAN_CMS_CONFIG.publicUrl, body: publicCompositeHtml() },
      { status: 200, finalUrl: JINAN_CMS_CONFIG.loginUrl, body: loginHtml() },
      { status: 302, finalUrl: JINAN_CMS_CONFIG.loginUrl, location: '/admin/index.php', setCookie: ['sid=x; Path=/admin'] },
      loginSuccessLandingResponse(),
      { status: 200, finalUrl: JINAN_CMS_CONFIG.editorUrl, body: freshEditorHtml() },
      { status: 200, finalUrl: QUICK_UPLOAD_RESPONSE_URL, contentType: 'text/html', body: uploadSuccessBody('/uploads/2026/final.png', 37) },
      { status: 200, finalUrl: JINAN_CMS_CONFIG.editorUrl, body: freshEditorHtml() },
      { status: 302, finalUrl: JINAN_CMS_CONFIG.editorUrl, location: '/admin/index.php?op=time&sub=set&mesCode=1' },
      { status: 200, finalUrl: JINAN_CMS_CONFIG.publicUrl, body },
      { status: 200, finalUrl: JINAN_CMS_CONFIG.publicUrl, body },
      { status: 200, finalUrl: JINAN_CMS_CONFIG.publicUrl, body },
    ]);

    const result = await publishJinanCms({
      pngDataUrl: pngDataUrl(),
      callbackNumber: 37,
      env: {
        JINAN_CMS_PUBLISH_ENABLED: 'true',
        JINAN_CMS_USERNAME: 'synthetic-user',
        JINAN_CMS_PASSWORD: 'synthetic-password',
      },
      transport,
      sleep: async () => {},
      verificationDelaysMs: [1, 2],
    });
    assert.deepEqual(result, {
      status: 'MANUAL_CHECK_REQUIRED',
      orphanUploadRisk: true,
      finalImagePath: '/uploads/2026/final.png',
    }, name);
    assert.equal(transport.calls.filter((call) => call.url.includes('QuickUpload')).length, 1, name);
    assert.equal(transport.calls.filter((call) => call.method === 'POST' && call.url === JINAN_CMS_CONFIG.editorUrl).length, 1, name);
    assert.equal(transport.calls.some((call) => call.url === `${JINAN_CMS_CONFIG.origin}/uploads/2026/final.png`), false, name);
  }
});

test('M2e2. post-submit verification rejects encoded legacy residue outside replacement', async () => {
  reloadJinanCmsModule();
  const oldImages = ['/upload/a%20b.png', '/upload/yian.png', '/upload/changes.png', '/upload/saturday.png'];
  const note = compositeTimetableNote(oldImages);
  const body = publicCompositeHtml({
    note: note.replace(timetableImageTail(oldImages), '<img src="/uploads/2026/final.png" />')
      + '<aside><img src="/upload/a%20b.png" alt="legacy copy"></aside>',
  });
  const transport = makeTransport([
    { status: 200, finalUrl: JINAN_CMS_CONFIG.publicUrl, body: publicCompositeHtml({ note }) },
    { status: 200, finalUrl: JINAN_CMS_CONFIG.loginUrl, body: loginHtml() },
    { status: 302, finalUrl: JINAN_CMS_CONFIG.loginUrl, location: '/admin/index.php', setCookie: ['sid=x; Path=/admin'] },
    loginSuccessLandingResponse(),
    { status: 200, finalUrl: JINAN_CMS_CONFIG.editorUrl, body: freshCompositeEditorHtml({ note }) },
    { status: 200, finalUrl: QUICK_UPLOAD_RESPONSE_URL, contentType: 'text/html', body: uploadSuccessBody('/uploads/2026/final.png', 37) },
    { status: 200, finalUrl: JINAN_CMS_CONFIG.editorUrl, body: freshCompositeEditorHtml({ note }) },
    { status: 302, finalUrl: JINAN_CMS_CONFIG.editorUrl, location: '/admin/index.php?op=time&sub=set&mesCode=1' },
    { status: 200, finalUrl: JINAN_CMS_CONFIG.publicUrl, body },
    { status: 200, finalUrl: JINAN_CMS_CONFIG.publicUrl, body },
    { status: 200, finalUrl: JINAN_CMS_CONFIG.publicUrl, body },
  ]);

  const result = await publishJinanCms({
    pngDataUrl: pngDataUrl(),
    callbackNumber: 37,
    env: {
      JINAN_CMS_PUBLISH_ENABLED: 'true',
      JINAN_CMS_USERNAME: 'synthetic-user',
      JINAN_CMS_PASSWORD: 'synthetic-password',
    },
    transport,
    sleep: async () => {},
    verificationDelaysMs: [1, 2],
  });

  assert.deepEqual(result, {
    status: 'MANUAL_CHECK_REQUIRED',
    orphanUploadRisk: true,
    finalImagePath: '/uploads/2026/final.png',
  });
  assert.equal(transport.calls.some((call) => call.url === `${JINAN_CMS_CONFIG.origin}/uploads/2026/final.png`), false);
});

test('M2e3. post-submit verification rejects entity and multi-encoded legacy residue outside replacement', async () => {
  for (const [name, residueSrc] of [
    ['entity-encoded percent', '/upload/a&#37;20b.png'],
    ['multi-encoded percent', '/upload/a%2520b.png'],
  ]) {
    reloadJinanCmsModule();
    const oldImages = ['/upload/a%20b.png', '/upload/yian.png', '/upload/changes.png', '/upload/saturday.png'];
    const note = compositeTimetableNote(oldImages);
    const body = publicCompositeHtml({
      note: note.replace(timetableImageTail(oldImages), '<img src="/uploads/2026/final.png" />')
        + `<aside><img src="${residueSrc}" alt="legacy copy"></aside>`,
    });
    const transport = makeTransport([
      { status: 200, finalUrl: JINAN_CMS_CONFIG.publicUrl, body: publicCompositeHtml({ note }) },
      { status: 200, finalUrl: JINAN_CMS_CONFIG.loginUrl, body: loginHtml() },
      { status: 302, finalUrl: JINAN_CMS_CONFIG.loginUrl, location: '/admin/index.php', setCookie: ['sid=x; Path=/admin'] },
      loginSuccessLandingResponse(),
      { status: 200, finalUrl: JINAN_CMS_CONFIG.editorUrl, body: freshCompositeEditorHtml({ note }) },
      { status: 200, finalUrl: QUICK_UPLOAD_RESPONSE_URL, contentType: 'text/html', body: uploadSuccessBody('/uploads/2026/final.png', 37) },
      { status: 200, finalUrl: JINAN_CMS_CONFIG.editorUrl, body: freshCompositeEditorHtml({ note }) },
      { status: 302, finalUrl: JINAN_CMS_CONFIG.editorUrl, location: '/admin/index.php?op=time&sub=set&mesCode=1' },
      { status: 200, finalUrl: JINAN_CMS_CONFIG.publicUrl, body },
      { status: 200, finalUrl: JINAN_CMS_CONFIG.publicUrl, body },
      { status: 200, finalUrl: JINAN_CMS_CONFIG.publicUrl, body },
    ]);
    const result = await publishJinanCms({
      pngDataUrl: pngDataUrl(),
      callbackNumber: 37,
      env: {
        JINAN_CMS_PUBLISH_ENABLED: 'true',
        JINAN_CMS_USERNAME: 'synthetic-user',
        JINAN_CMS_PASSWORD: 'synthetic-password',
      },
      transport,
      sleep: async () => {},
      verificationDelaysMs: [1, 2],
    });
    assert.equal(result.status, 'MANUAL_CHECK_REQUIRED', name);
    assert.equal(transport.calls.some((call) => call.url === `${JINAN_CMS_CONFIG.origin}/uploads/2026/final.png`), false, name);
  }
});

test('M2e4. post-submit verification rejects old image residue in all public source contexts', async () => {
  const oldImages = ['/upload/a%20b.png', '/upload/yian.png', '/upload/changes.png', '/upload/saturday.png'];
  const baseNote = compositeTimetableNote(oldImages);
  const publicWithoutCollection = baseNote.replace(timetableImageTail(oldImages), '<img src="/uploads/2026/final.png" />');
  const cases = [
    ['img srcset candidate', '<p><img src="/images/footer.png" srcset="/upload/a%2520b.png 2x, /images/footer-large.png 3x"></p>'],
    ['picture source src/srcset', '<picture><source src="/upload/a%20b.png" srcset="/images/footer.png 1x, /upload/a%2520b.png 2x"><img src="/images/footer.png"></picture>'],
    ['hidden ancestor img', '<div hidden><img src="/upload/a%2520b.png"></div>'],
    ['self-hidden img', '<img hidden src="/upload/a%2520b.png">'],
    ['aria-hidden ancestor img', '<div aria-hidden="true"><img src="/upload/a%2520b.png"></div>'],
    ['active href', '<a href="/upload/a%2520b.png">old</a>'],
    ['active data attr', '<object data="/upload/a%2520b.png"></object>'],
    ['comment residue', '<!-- <img src=/upload/a&#37;20b.png> -->'],
    ['script raw text', '<script>const old="/upload/a%2520b.png";</script>'],
    ['style raw text', '<style>.x{background:url("/upload/a%2520b.png")}</style>'],
    ['template raw text', '<template><img src="/upload/a%2520b.png"></template>'],
    ['noscript raw text', '<noscript><img src="/upload/a%2520b.png"></noscript>'],
    ['numeric entity percent', '<p>/upload/a&#37;20b.png</p>'],
  ];

  for (const [name, residue] of cases) {
    reloadJinanCmsModule();
    const body = publicCompositeHtml({ note: `${publicWithoutCollection}${residue}` });
    const transport = makeTransport([
      { status: 200, finalUrl: JINAN_CMS_CONFIG.publicUrl, body: publicCompositeHtml({ note: baseNote }) },
      { status: 200, finalUrl: JINAN_CMS_CONFIG.loginUrl, body: loginHtml() },
      { status: 302, finalUrl: JINAN_CMS_CONFIG.loginUrl, location: '/admin/index.php', setCookie: ['sid=x; Path=/admin'] },
      loginSuccessLandingResponse(),
      { status: 200, finalUrl: JINAN_CMS_CONFIG.editorUrl, body: freshCompositeEditorHtml({ note: baseNote }) },
      { status: 200, finalUrl: QUICK_UPLOAD_RESPONSE_URL, contentType: 'text/html', body: uploadSuccessBody('/uploads/2026/final.png', 37) },
      { status: 200, finalUrl: JINAN_CMS_CONFIG.editorUrl, body: freshCompositeEditorHtml({ note: baseNote }) },
      { status: 302, finalUrl: JINAN_CMS_CONFIG.editorUrl, location: '/admin/index.php?op=time&sub=set&mesCode=1' },
      { status: 200, finalUrl: JINAN_CMS_CONFIG.publicUrl, body },
      { status: 200, finalUrl: JINAN_CMS_CONFIG.publicUrl, body },
      { status: 200, finalUrl: JINAN_CMS_CONFIG.publicUrl, body },
    ]);
    const result = await publishJinanCms({
      pngDataUrl: pngDataUrl(),
      callbackNumber: 37,
      env: {
        JINAN_CMS_PUBLISH_ENABLED: 'true',
        JINAN_CMS_USERNAME: 'synthetic-user',
        JINAN_CMS_PASSWORD: 'synthetic-password',
      },
      transport,
      sleep: async () => {},
      verificationDelaysMs: [1, 2],
    });
    assert.equal(result.status, 'MANUAL_CHECK_REQUIRED', name);
    assert.equal(transport.calls.some((call) => call.url === `${JINAN_CMS_CONFIG.origin}/uploads/2026/final.png`), false, name);
  }
});

test('M2e5. post-submit verification rejects numeric slash entities and 1-8 layer percent residue', async () => {
  const cases = [
    ['slash decimal', ['/upload/a/b.png', '/upload/yian.png', '/upload/changes.png', '/upload/saturday.png'], '/upload/a&#47;b.png'],
    ['slash hex', ['/upload/a/b.png', '/upload/yian.png', '/upload/changes.png', '/upload/saturday.png'], '/upload/a&#x2f;b.png'],
  ];
  for (let layers = 1; layers <= 8; layers += 1) {
    cases.push([
      `percent layers ${layers}`,
      ['/upload/a b.png', '/upload/yian.png', '/upload/changes.png', '/upload/saturday.png'],
      percentEncodeLayers('/upload/a b.png', layers),
    ]);
  }

  for (const [name, oldImages, residue] of cases) {
    reloadJinanCmsModule();
    const baseNote = compositeTimetableNote(oldImages);
    const publicWithoutCollection = baseNote.replace(timetableImageTail(oldImages), '<img src="/uploads/2026/final.png" />');
    const body = publicCompositeHtml({ note: `${publicWithoutCollection}<p>${residue}</p>` });
    const transport = makeTransport([
      { status: 200, finalUrl: JINAN_CMS_CONFIG.publicUrl, body: publicCompositeHtml({ note: baseNote }) },
      { status: 200, finalUrl: JINAN_CMS_CONFIG.loginUrl, body: loginHtml() },
      { status: 302, finalUrl: JINAN_CMS_CONFIG.loginUrl, location: '/admin/index.php', setCookie: ['sid=x; Path=/admin'] },
      loginSuccessLandingResponse(),
      { status: 200, finalUrl: JINAN_CMS_CONFIG.editorUrl, body: freshCompositeEditorHtml({ note: baseNote }) },
      { status: 200, finalUrl: QUICK_UPLOAD_RESPONSE_URL, contentType: 'text/html', body: uploadSuccessBody('/uploads/2026/final.png', 37) },
      { status: 200, finalUrl: JINAN_CMS_CONFIG.editorUrl, body: freshCompositeEditorHtml({ note: baseNote }) },
      { status: 302, finalUrl: JINAN_CMS_CONFIG.editorUrl, location: '/admin/index.php?op=time&sub=set&mesCode=1' },
      { status: 200, finalUrl: JINAN_CMS_CONFIG.publicUrl, body },
      { status: 200, finalUrl: JINAN_CMS_CONFIG.publicUrl, body },
      { status: 200, finalUrl: JINAN_CMS_CONFIG.publicUrl, body },
    ]);
    const result = await publishJinanCms({
      pngDataUrl: pngDataUrl(),
      callbackNumber: 37,
      env: {
        JINAN_CMS_PUBLISH_ENABLED: 'true',
        JINAN_CMS_USERNAME: 'synthetic-user',
        JINAN_CMS_PASSWORD: 'synthetic-password',
      },
      transport,
      sleep: async () => {},
      verificationDelaysMs: [1, 2],
    });
    assert.equal(result.status, 'MANUAL_CHECK_REQUIRED', name);
    assert.equal(transport.calls.some((call) => call.url === `${JINAN_CMS_CONFIG.origin}/uploads/2026/final.png`), false, name);
  }
});

test('M2f. post-submit verification rejects uploaded image resource contract failures', async () => {
  const imageResponses = [
    ['status', { status: 404, finalUrl: `${JINAN_CMS_CONFIG.origin}/uploads/2026/final.png`, contentType: 'image/png', body: pngBuffer() }],
    ['redirect', { status: 200, finalUrl: `${JINAN_CMS_CONFIG.origin}/uploads/2026/final.png`, location: '/other.png', contentType: 'image/png', body: pngBuffer() }],
    ['final url', { status: 200, finalUrl: `${JINAN_CMS_CONFIG.origin}/uploads/2026/other.png`, contentType: 'image/png', body: pngBuffer() }],
    ['mime', { status: 200, finalUrl: `${JINAN_CMS_CONFIG.origin}/uploads/2026/final.png`, contentType: 'text/plain', body: pngBuffer() }],
    ['empty', { status: 200, finalUrl: `${JINAN_CMS_CONFIG.origin}/uploads/2026/final.png`, contentType: 'image/png', body: Buffer.alloc(0) }],
    ['invalid png', { status: 200, finalUrl: `${JINAN_CMS_CONFIG.origin}/uploads/2026/final.png`, contentType: 'image/png', body: Buffer.from('not-png') }],
  ];

  for (const [name, imageResponse] of imageResponses) {
    reloadJinanCmsModule();
    const transport = makeTransport([
      { status: 200, finalUrl: JINAN_CMS_CONFIG.publicUrl, body: publicCompositeHtml() },
      { status: 200, finalUrl: JINAN_CMS_CONFIG.loginUrl, body: loginHtml() },
      { status: 302, finalUrl: JINAN_CMS_CONFIG.loginUrl, location: '/admin/index.php', setCookie: ['sid=x; Path=/admin'] },
      loginSuccessLandingResponse(),
      { status: 200, finalUrl: JINAN_CMS_CONFIG.editorUrl, body: freshEditorHtml() },
      { status: 200, finalUrl: QUICK_UPLOAD_RESPONSE_URL, contentType: 'text/html', body: uploadSuccessBody('/uploads/2026/final.png', 37) },
      { status: 200, finalUrl: JINAN_CMS_CONFIG.editorUrl, body: freshEditorHtml() },
      { status: 302, finalUrl: JINAN_CMS_CONFIG.editorUrl, location: '/admin/index.php?op=time&sub=set&mesCode=1' },
      { status: 200, finalUrl: JINAN_CMS_CONFIG.publicUrl, body: publicHtml('/uploads/2026/final.png') },
      imageResponse,
    ]);

    const result = await publishJinanCms({
      pngDataUrl: pngDataUrl(),
      callbackNumber: 37,
      env: {
        JINAN_CMS_PUBLISH_ENABLED: 'true',
        JINAN_CMS_USERNAME: 'synthetic-user',
        JINAN_CMS_PASSWORD: 'synthetic-password',
      },
      transport,
      sleep: async () => {},
    });
    assert.deepEqual(result, {
      status: 'MANUAL_CHECK_REQUIRED',
      orphanUploadRisk: true,
      finalImagePath: '/uploads/2026/final.png',
    }, name);
    assert.equal(transport.calls.filter((call) => call.url.includes('QuickUpload')).length, 1, name);
    assert.equal(transport.calls.filter((call) => call.method === 'POST' && call.url === JINAN_CMS_CONFIG.editorUrl).length, 1, name);
  }
});

test('M2f2. post-submit image resource verification accepts valid PNG up to publish contract limit', async () => {
  reloadJinanCmsModule();
  const largePng = largePngBuffer();
  assert.equal(largePng.length > 1024 * 1024, true);
  assert.equal(largePng.length <= 15 * 1024 * 1024, true);
  const transport = makeTransport([
    { status: 200, finalUrl: JINAN_CMS_CONFIG.publicUrl, body: publicCompositeHtml() },
    { status: 200, finalUrl: JINAN_CMS_CONFIG.loginUrl, body: loginHtml() },
    { status: 302, finalUrl: JINAN_CMS_CONFIG.loginUrl, location: '/admin/index.php', setCookie: ['sid=x; Path=/admin'] },
    loginSuccessLandingResponse(),
    { status: 200, finalUrl: JINAN_CMS_CONFIG.editorUrl, body: freshEditorHtml() },
    { status: 200, finalUrl: QUICK_UPLOAD_RESPONSE_URL, contentType: 'text/html', body: uploadSuccessBody('/uploads/2026/final.png', 37) },
    { status: 200, finalUrl: JINAN_CMS_CONFIG.editorUrl, body: freshEditorHtml() },
    { status: 302, finalUrl: JINAN_CMS_CONFIG.editorUrl, location: '/admin/index.php?op=time&sub=set&mesCode=1' },
    { status: 200, finalUrl: JINAN_CMS_CONFIG.publicUrl, body: publicHtml('/uploads/2026/final.png') },
    { status: 200, finalUrl: `${JINAN_CMS_CONFIG.origin}/uploads/2026/final.png`, contentType: 'image/png', body: largePng },
  ]);

  const result = await publishJinanCms({
    pngDataUrl: pngDataUrl(),
    callbackNumber: 37,
    env: {
      JINAN_CMS_PUBLISH_ENABLED: 'true',
      JINAN_CMS_USERNAME: 'synthetic-user',
      JINAN_CMS_PASSWORD: 'synthetic-password',
    },
    transport,
    sleep: async () => {},
  });

  assert.deepEqual(result, {
    status: 'PUBLISHED',
    channels: [{ id: 'jinan-website', ok: true }],
  });
});

test('M2f3. default transport post-submit image resource verification accepts valid PNG above HTML body limit', async () => {
  reloadJinanCmsModule();
  const originalFetch = global.fetch;
  const largePng = largePngBuffer();
  const responses = [
    { status: 200, url: JINAN_CMS_CONFIG.publicUrl, body: publicCompositeHtml(), contentType: 'text/html' },
    { status: 200, url: JINAN_CMS_CONFIG.loginUrl, body: loginHtml(), contentType: 'text/html', setCookie: ['sid=login; Path=/admin; HttpOnly'] },
    { status: 302, url: JINAN_CMS_CONFIG.loginUrl, body: '', location: '/admin/index.php', setCookie: ['sid=x; Path=/admin; HttpOnly'] },
    { status: 200, url: LOGIN_SUCCESS_LANDING_URL, body: '<a href="/admin/index.php?op=time&amp;sub=set">門診時間</a>', contentType: 'text/html' },
    { status: 200, url: JINAN_CMS_CONFIG.editorUrl, body: freshEditorHtml(), contentType: 'text/html' },
    { status: 200, url: `${JINAN_CMS_CONFIG.quickUploadUrl}?command=QuickUpload&type=Images&CKEditor=note&CKEditorFuncNum=37&langCode=zh`, body: uploadSuccessBody('/uploads/2026/large.png', 37), contentType: 'text/html' },
    { status: 200, url: JINAN_CMS_CONFIG.editorUrl, body: freshEditorHtml(), contentType: 'text/html' },
    { status: 302, url: JINAN_CMS_CONFIG.editorUrl, body: '', location: '/admin/index.php?op=time&sub=set&mesCode=1' },
    { status: 200, url: JINAN_CMS_CONFIG.publicUrl, body: publicHtml('/uploads/2026/large.png'), contentType: 'text/html' },
    { status: 200, url: `${JINAN_CMS_CONFIG.origin}/uploads/2026/large.png`, bytes: largePng, contentType: 'image/png' },
  ];
  const calls = [];

  try {
    global.fetch = async (url, options = {}) => {
      calls.push({ url, method: options.method });
      const response = responses.shift();
      assert.equal(url, response.url);
      const textBody = response.body || '';
      const byteBody = response.bytes || Buffer.from(textBody);
      return {
        status: response.status,
        url: response.url,
        headers: {
          get(name) {
            const lower = String(name).toLowerCase();
            if (lower === 'content-length') return String(byteBody.length);
            if (lower === 'content-type') return response.contentType || null;
            if (lower === 'location') return response.location || null;
            return null;
          },
          getSetCookie: () => response.setCookie || [],
        },
        async text() {
          assert.equal(response.bytes, undefined);
          return textBody;
        },
        async arrayBuffer() {
          assert.ok(response.bytes);
          return byteBody.buffer.slice(byteBody.byteOffset, byteBody.byteOffset + byteBody.byteLength);
        },
      };
    };

    const result = await publishJinanCms({
      pngDataUrl: pngDataUrl(),
      callbackNumber: 37,
      env: {
        JINAN_CMS_PUBLISH_ENABLED: 'true',
        JINAN_CMS_USERNAME: 'synthetic-user',
        JINAN_CMS_PASSWORD: 'synthetic-password',
      },
      sleep: async () => {},
    });

    assert.deepEqual(result, {
      status: 'PUBLISHED',
      channels: [{ id: 'jinan-website', ok: true }],
    });
    assert.equal(largePng.length > 1024 * 1024, true);
    assert.equal(calls.at(-1).url, `${JINAN_CMS_CONFIG.origin}/uploads/2026/large.png`);
    assert.equal(responses.length, 0);
  } finally {
    global.fetch = originalFetch;
  }
});

test('M3. publish pipeline stops at each failed phase and never retries mutations', async () => {
  const env = {
    JINAN_CMS_PUBLISH_ENABLED: 'true',
    JINAN_CMS_USERNAME: 'synthetic-user',
    JINAN_CMS_PASSWORD: 'synthetic-password',
  };
  const cases = [
    ['invalid png', [], { pngDataUrl: 'data:image/png;base64,bad' }, 'VERIFY_FAILED'],
    ['initial public unavailable', [{ status: 302, finalUrl: JINAN_CMS_CONFIG.publicUrl, location: '/time.html', body: publicCompositeHtml() }], {}, 'VERIFY_FAILED'],
    ['login form changed', [
      { status: 200, finalUrl: JINAN_CMS_CONFIG.publicUrl, body: publicCompositeHtml() },
      { status: 200, finalUrl: JINAN_CMS_CONFIG.loginUrl, body: '<form></form>' },
    ], {}, 'FORM_CHANGED'],
    ['login post network ambiguity', [
      { status: 200, finalUrl: JINAN_CMS_CONFIG.publicUrl, body: publicCompositeHtml() },
      { status: 200, finalUrl: JINAN_CMS_CONFIG.loginUrl, body: loginHtml() },
      new Error('timeout after login mutation'),
    ], {}, 'VERIFY_FAILED'],
    ['editor auth failed', [
      { status: 200, finalUrl: JINAN_CMS_CONFIG.publicUrl, body: publicCompositeHtml() },
      { status: 200, finalUrl: JINAN_CMS_CONFIG.loginUrl, body: loginHtml() },
      { status: 302, finalUrl: JINAN_CMS_CONFIG.loginUrl, location: '/admin/index.php', setCookie: ['sid=x; Path=/admin'] },
      loginSuccessLandingResponse(),
      { status: 302, finalUrl: JINAN_CMS_CONFIG.editorUrl, location: '/admin/login.php' },
    ], {}, 'AUTH_FAILED'],
    ['upload contract unknown', [
      { status: 200, finalUrl: JINAN_CMS_CONFIG.publicUrl, body: publicCompositeHtml() },
      { status: 200, finalUrl: JINAN_CMS_CONFIG.loginUrl, body: loginHtml() },
      { status: 302, finalUrl: JINAN_CMS_CONFIG.loginUrl, location: '/admin/index.php', setCookie: ['sid=x; Path=/admin'] },
      loginSuccessLandingResponse(),
      { status: 200, finalUrl: JINAN_CMS_CONFIG.editorUrl, body: freshEditorHtml() },
      { status: 200, contentType: 'text/html', body: 'ok' },
    ], {}, 'MANUAL_CHECK_REQUIRED'],
    ['upload non-2xx', [
      { status: 200, finalUrl: JINAN_CMS_CONFIG.publicUrl, body: publicCompositeHtml() },
      { status: 200, finalUrl: JINAN_CMS_CONFIG.loginUrl, body: loginHtml() },
      { status: 302, finalUrl: JINAN_CMS_CONFIG.loginUrl, location: '/admin/index.php', setCookie: ['sid=x; Path=/admin'] },
      loginSuccessLandingResponse(),
      { status: 200, finalUrl: JINAN_CMS_CONFIG.editorUrl, body: freshEditorHtml() },
      { status: 500, contentType: 'text/html', body: 'no' },
    ], {}, 'MANUAL_CHECK_REQUIRED'],
    ['fresh editor after upload changed', [
      { status: 200, finalUrl: JINAN_CMS_CONFIG.publicUrl, body: publicCompositeHtml() },
      { status: 200, finalUrl: JINAN_CMS_CONFIG.loginUrl, body: loginHtml() },
      { status: 302, finalUrl: JINAN_CMS_CONFIG.loginUrl, location: '/admin/index.php', setCookie: ['sid=x; Path=/admin'] },
      loginSuccessLandingResponse(),
      { status: 200, finalUrl: JINAN_CMS_CONFIG.editorUrl, body: freshEditorHtml() },
      { status: 200, finalUrl: QUICK_UPLOAD_RESPONSE_URL, contentType: 'text/html', body: uploadSuccessBody('/uploads/2026/jinan.png', 37) },
      { status: 200, finalUrl: JINAN_CMS_CONFIG.editorUrl, body: '<form></form>' },
    ], {}, 'MANUAL_CHECK_REQUIRED'],
    ['submit ambiguity', [
      { status: 200, finalUrl: JINAN_CMS_CONFIG.publicUrl, body: publicCompositeHtml() },
      { status: 200, finalUrl: JINAN_CMS_CONFIG.loginUrl, body: loginHtml() },
      { status: 302, finalUrl: JINAN_CMS_CONFIG.loginUrl, location: '/admin/index.php', setCookie: ['sid=x; Path=/admin'] },
      loginSuccessLandingResponse(),
      { status: 200, finalUrl: JINAN_CMS_CONFIG.editorUrl, body: freshEditorHtml() },
      { status: 200, finalUrl: QUICK_UPLOAD_RESPONSE_URL, contentType: 'text/html', body: uploadSuccessBody('/uploads/2026/jinan.png', 37) },
      { status: 200, finalUrl: JINAN_CMS_CONFIG.editorUrl, body: freshEditorHtml() },
      new Error('timeout after submit mutation'),
    ], {}, 'MANUAL_CHECK_REQUIRED'],
  ];

  for (const [name, responses, options, expectedStatus] of cases) {
    reloadJinanCmsModule();
    const transport = makeTransport(responses);
    const result = await publishJinanCms({
      pngDataUrl: pngDataUrl(),
      callbackNumber: 37,
      env,
      transport,
      sleep: async () => {},
      ...options,
    });
    assert.equal(result.status, expectedStatus, name);
    if (expectedStatus === 'MANUAL_CHECK_REQUIRED') assert.equal(result.orphanUploadRisk, true, name);
    assert.equal(transport.calls.filter((call) => call.url.includes('QuickUpload')).length <= 1, true, name);
    assert.equal(transport.calls.filter((call) => call.method === 'POST' && call.url === JINAN_CMS_CONFIG.editorUrl).length <= 1, true, name);
  }
});

test('M4. publish pipeline exhausts bounded public verification GET retries safely', async () => {
  reloadJinanCmsModule();
  const transport = makeTransport([
    { status: 200, finalUrl: JINAN_CMS_CONFIG.publicUrl, body: publicCompositeHtml() },
    { status: 200, finalUrl: JINAN_CMS_CONFIG.loginUrl, body: loginHtml() },
    { status: 302, finalUrl: JINAN_CMS_CONFIG.loginUrl, location: '/admin/index.php', setCookie: ['sid=x; Path=/admin'] },
    loginSuccessLandingResponse(),
    { status: 200, finalUrl: JINAN_CMS_CONFIG.editorUrl, body: freshEditorHtml() },
    { status: 200, finalUrl: QUICK_UPLOAD_RESPONSE_URL, contentType: 'text/html', body: uploadSuccessBody('/uploads/2026/jinan.png', 37) },
    { status: 200, finalUrl: JINAN_CMS_CONFIG.editorUrl, body: freshEditorHtml() },
    { status: 302, finalUrl: JINAN_CMS_CONFIG.editorUrl, location: '/admin/index.php?op=time&sub=set&mesCode=1' },
    { status: 200, finalUrl: JINAN_CMS_CONFIG.publicUrl, body: publicCompositeHtml() },
    { status: 200, finalUrl: JINAN_CMS_CONFIG.publicUrl, body: publicCompositeHtml() },
    { status: 200, finalUrl: JINAN_CMS_CONFIG.publicUrl, body: publicCompositeHtml() },
  ]);
  const sleeps = [];
  const result = await publishJinanCms({
    pngDataUrl: pngDataUrl(),
    callbackNumber: 37,
    env: {
      JINAN_CMS_PUBLISH_ENABLED: 'true',
      JINAN_CMS_USERNAME: 'synthetic-user',
      JINAN_CMS_PASSWORD: 'synthetic-password',
    },
    transport,
    sleep: async (ms) => { sleeps.push(ms); },
    verificationDelaysMs: [1, 2, 999],
  });

  assert.equal(result.status, 'MANUAL_CHECK_REQUIRED');
  assert.equal(result.orphanUploadRisk, true);
  assert.equal(result.finalImagePath, '/uploads/2026/jinan.png');
  assert.equal(transport.calls.filter((call) => call.method === 'GET' && call.url === JINAN_CMS_CONFIG.publicUrl).length, 4);
  assert.deepEqual(sleeps, [1, 2]);
});

test('M4b. post-submit public verification delay failures retain ambiguity and block mutation retry', async () => {
  const env = {
    JINAN_CMS_PUBLISH_ENABLED: 'true',
    JINAN_CMS_USERNAME: 'synthetic-user',
    JINAN_CMS_PASSWORD: 'synthetic-password',
  };

  for (const [name, options] of [
    ['sleep rejection', {
      sleep: async (ms) => {
        if (ms === 7) throw new Error('timer failed');
      },
      verificationDelaysMs: [7, 11],
    }],
    ['delay element getter throws', {
      sleep: async () => {},
      verificationDelaysMs: (() => {
        const delays = [7, 11];
        Object.defineProperty(delays, 0, {
          get() {
            throw new Error('delay access failed');
          },
        });
        return delays;
      })(),
    }],
  ]) {
    reloadJinanCmsModule();
    let credentialsRead = 0;
    const envWithGetters = {
      JINAN_CMS_PUBLISH_ENABLED: 'true',
      get JINAN_CMS_USERNAME() { credentialsRead += 1; return env.JINAN_CMS_USERNAME; },
      get JINAN_CMS_PASSWORD() { credentialsRead += 1; return env.JINAN_CMS_PASSWORD; },
    };
    const logs = [];
    const transport = makeTransport([
      { status: 200, finalUrl: JINAN_CMS_CONFIG.publicUrl, body: publicCompositeHtml() },
      { status: 200, finalUrl: JINAN_CMS_CONFIG.loginUrl, body: loginHtml() },
      { status: 302, finalUrl: JINAN_CMS_CONFIG.loginUrl, location: '/admin/index.php', setCookie: ['sid=x; Path=/admin'] },
      loginSuccessLandingResponse(),
      { status: 200, finalUrl: JINAN_CMS_CONFIG.editorUrl, body: freshEditorHtml() },
      { status: 200, finalUrl: QUICK_UPLOAD_RESPONSE_URL, contentType: 'text/html', body: uploadSuccessBody('/uploads/2026/post-submit-delay.png', 37) },
      { status: 200, finalUrl: JINAN_CMS_CONFIG.editorUrl, body: freshEditorHtml() },
      { status: 302, finalUrl: JINAN_CMS_CONFIG.editorUrl, location: '/admin/index.php?op=time&sub=set&mesCode=1' },
      { status: 200, finalUrl: JINAN_CMS_CONFIG.publicUrl, body: publicCompositeHtml() },
    ]);

    const first = await publishJinanCms({
      pngDataUrl: pngDataUrl(),
      callbackNumber: 37,
      env: envWithGetters,
      transport,
      logger: (event) => logs.push(event),
      ...options,
    });
    assert.deepEqual(first, {
      status: 'MANUAL_CHECK_REQUIRED',
      orphanUploadRisk: true,
      finalImagePath: '/uploads/2026/post-submit-delay.png',
    }, name);
    assert.equal(transport.calls.filter((call) => call.url.includes('QuickUpload')).length, 1, name);
    assert.equal(transport.calls.filter((call) => call.method === 'POST' && call.url === JINAN_CMS_CONFIG.editorUrl).length, 1, name);
    assert.equal(
      logs.some((event) => event.stage === 'public-verification'
        && event.status === 'MANUAL_CHECK_REQUIRED'
        && event.errorCode === 'VERIFY_FAILED'
        && event.finalImagePath === '/uploads/2026/post-submit-delay.png'
        && event.orphanUploadRisk === true),
      true,
      name,
    );

    credentialsRead = 0;
    const retryTransport = makeTransport([
      { status: 200, finalUrl: JINAN_CMS_CONFIG.publicUrl, body: publicCompositeHtml() },
    ]);
    const retry = await publishJinanCms({
      pngDataUrl: pngDataUrl(),
      callbackNumber: 37,
      env: envWithGetters,
      transport: retryTransport,
      logger: () => {},
    });
    assert.deepEqual(retry, {
      status: 'MANUAL_CHECK_REQUIRED',
      orphanUploadRisk: true,
      finalImagePath: '/uploads/2026/post-submit-delay.png',
    }, name);
    assert.equal(credentialsRead, 0, name);
    assert.deepEqual(retryTransport.calls.map((call) => `${call.method} ${call.url} ${call.cookie}`), [
      `GET ${JINAN_CMS_CONFIG.publicUrl} `,
    ], name);
    assert.equal(retryTransport.calls.filter((call) => call.url.includes('QuickUpload')).length, 0, name);
    assert.equal(retryTransport.calls.filter((call) => call.method === 'POST').length, 0, name);
  }
});

test('M5. post-upload fresh editor failure records and reuses one final image path without re-upload', async () => {
  reloadJinanCmsModule();
  const logs = [];
  const transport = makeTransport([
    { status: 200, finalUrl: JINAN_CMS_CONFIG.publicUrl, body: publicCompositeHtml() },
    { status: 200, finalUrl: JINAN_CMS_CONFIG.loginUrl, body: loginHtml() },
    { status: 302, finalUrl: JINAN_CMS_CONFIG.loginUrl, location: '/admin/index.php', setCookie: ['sid=x; Path=/admin'] },
    loginSuccessLandingResponse(),
    { status: 200, finalUrl: JINAN_CMS_CONFIG.editorUrl, body: freshEditorHtml() },
    { status: 200, finalUrl: QUICK_UPLOAD_RESPONSE_URL, contentType: 'text/html', body: uploadSuccessBody('/uploads/2026/reuse.png', 37) },
    { status: 500, finalUrl: JINAN_CMS_CONFIG.editorUrl, body: publicCompositeHtml() },
  ]);

  const result = await publishJinanCms({
    pngDataUrl: pngDataUrl(),
    callbackNumber: 37,
    env: {
      JINAN_CMS_PUBLISH_ENABLED: 'true',
      JINAN_CMS_USERNAME: 'synthetic-user',
      JINAN_CMS_PASSWORD: 'synthetic-password',
    },
    transport,
    logger: (event) => logs.push(event),
  });

  assert.equal(result.status, 'MANUAL_CHECK_REQUIRED');
  assert.equal(result.orphanUploadRisk, true);
  assert.equal(result.finalImagePath, '/uploads/2026/reuse.png');
  assert.equal(transport.calls.filter((call) => call.url.includes('QuickUpload')).length, 1);
  assert.equal(transport.calls.filter((call) => call.method === 'POST' && call.url === JINAN_CMS_CONFIG.editorUrl).length, 0);
  assert.equal(logs.some((event) => event.status === 'MANUAL_CHECK_REQUIRED' && event.finalImagePath === '/uploads/2026/reuse.png'), true);
});

test('M6. submit ambiguity and verification failure require manual check with orphan risk and no mutation retry', async () => {
  for (const [name, tailResponses] of [
    ['submit response lost', [new Error('timeout after submit mutation')]],
    ['public verification never proves match', [
      { status: 302, finalUrl: JINAN_CMS_CONFIG.editorUrl, location: '/admin/index.php?op=time&sub=set&mesCode=1' },
      { status: 200, finalUrl: JINAN_CMS_CONFIG.publicUrl, body: publicCompositeHtml() },
      { status: 200, finalUrl: JINAN_CMS_CONFIG.publicUrl, body: publicCompositeHtml() },
      { status: 200, finalUrl: JINAN_CMS_CONFIG.publicUrl, body: publicCompositeHtml() },
    ]],
  ]) {
    reloadJinanCmsModule();
    const transport = makeTransport([
      { status: 200, finalUrl: JINAN_CMS_CONFIG.publicUrl, body: publicCompositeHtml() },
      { status: 200, finalUrl: JINAN_CMS_CONFIG.loginUrl, body: loginHtml() },
      { status: 302, finalUrl: JINAN_CMS_CONFIG.loginUrl, location: '/admin/index.php', setCookie: ['sid=x; Path=/admin'] },
      loginSuccessLandingResponse(),
      { status: 200, finalUrl: JINAN_CMS_CONFIG.editorUrl, body: freshEditorHtml() },
      { status: 200, finalUrl: QUICK_UPLOAD_RESPONSE_URL, contentType: 'text/html', body: uploadSuccessBody('/uploads/2026/ambiguous.png', 37) },
      { status: 200, finalUrl: JINAN_CMS_CONFIG.editorUrl, body: freshEditorHtml() },
      ...tailResponses,
    ]);
    const result = await publishJinanCms({
      pngDataUrl: pngDataUrl(),
      callbackNumber: 37,
      env: {
        JINAN_CMS_PUBLISH_ENABLED: 'true',
        JINAN_CMS_USERNAME: 'synthetic-user',
        JINAN_CMS_PASSWORD: 'synthetic-password',
      },
      transport,
      sleep: async () => {},
      verificationDelaysMs: [1, 2],
    });
    assert.equal(result.status, 'MANUAL_CHECK_REQUIRED', name);
    assert.equal(result.orphanUploadRisk, true, name);
    assert.equal(result.finalImagePath, '/uploads/2026/ambiguous.png', name);
    assert.equal(transport.calls.filter((call) => call.url.includes('QuickUpload')).length, 1, name);
    assert.equal(transport.calls.filter((call) => call.method === 'POST' && call.url === JINAN_CMS_CONFIG.editorUrl).length, 1, name);
  }
});

test('M7. unresolved ambiguous prior state does anonymous public check before credentials or mutation', async () => {
  reloadJinanCmsModule();
  let credentialsRead = 0;
  const logs = [];
  const env = {
    JINAN_CMS_PUBLISH_ENABLED: 'true',
    get JINAN_CMS_USERNAME() { credentialsRead += 1; return 'synthetic-user'; },
    get JINAN_CMS_PASSWORD() { credentialsRead += 1; return 'synthetic-password'; },
  };
  await seedSubmitAmbiguity({ env, finalImagePath: '/uploads/2026/saved.png', logger: (event) => logs.push(event) });
  assert.equal(credentialsRead, 2);
  credentialsRead = 0;

  const unprovenTransport = makeTransport([
    { status: 200, finalUrl: JINAN_CMS_CONFIG.publicUrl, body: publicCompositeHtml() },
  ]);
  const unproven = await publishJinanCms({
    pngDataUrl: pngDataUrl(),
    env,
    transport: unprovenTransport,
  });
  assert.deepEqual(unproven, {
    status: 'MANUAL_CHECK_REQUIRED',
    orphanUploadRisk: true,
    finalImagePath: '/uploads/2026/saved.png',
  });
  assert.deepEqual(unprovenTransport.calls.map((call) => `${call.method} ${call.url} ${call.cookie}`), [
    `GET ${JINAN_CMS_CONFIG.publicUrl} `,
  ]);
  assert.equal(credentialsRead, 0);

  logs.length = 0;
  const provenTransport = makeTransport([
    { status: 200, finalUrl: JINAN_CMS_CONFIG.publicUrl, body: publicHtml('/uploads/2026/saved.png') },
    { status: 200, finalUrl: `${JINAN_CMS_CONFIG.origin}/uploads/2026/saved.png`, contentType: 'image/png', body: pngBuffer() },
  ]);
  const proven = await publishJinanCms({
    pngDataUrl: pngDataUrl(),
    env,
    transport: provenTransport,
    logger: (event) => logs.push(event),
  });
  assert.deepEqual(proven, {
    status: 'PUBLISHED',
    channels: [{ id: 'jinan-website', ok: true }],
  });
  assert.equal(credentialsRead, 0);
  assert.equal(provenTransport.calls.filter((call) => call.url.includes('QuickUpload')).length, 0);
  assert.equal(
    logs.some((event) => event.stage === 'prior-ambiguous-public-verification'
      && event.status === 'PUBLISHED'
      && event.finalImagePath === '/uploads/2026/saved.png'
      && event.orphanUploadRisk === false),
    true,
  );
});

test('M7d. prior ambiguous recovery final image GET does not inherit anonymous public page cookies', async () => {
  reloadJinanCmsModule();
  let credentialsRead = 0;
  const env = {
    JINAN_CMS_PUBLISH_ENABLED: 'true',
    get JINAN_CMS_USERNAME() { credentialsRead += 1; return 'synthetic-user'; },
    get JINAN_CMS_PASSWORD() { credentialsRead += 1; return 'synthetic-password'; },
  };
  await seedSubmitAmbiguity({ env, finalImagePath: '/uploads/2026/saved.png' });
  credentialsRead = 0;

  const transport = makeTransport([
    {
      status: 200,
      finalUrl: JINAN_CMS_CONFIG.publicUrl,
      body: publicHtml('/uploads/2026/saved.png'),
      setCookie: ['anonymous_public=1; Path=/; HttpOnly'],
    },
    { status: 200, finalUrl: `${JINAN_CMS_CONFIG.origin}/uploads/2026/saved.png`, contentType: 'image/png', body: pngBuffer() },
  ]);
  const result = await publishJinanCms({
    pngDataUrl: pngDataUrl(),
    env,
    transport,
    logger: () => {},
  });

  assert.equal(result.status, 'PUBLISHED');
  assert.equal(credentialsRead, 0);
  assert.deepEqual(transport.calls.map((call) => `${call.method} ${call.url} ${call.cookie}`), [
    `GET ${JINAN_CMS_CONFIG.publicUrl} `,
    `GET ${JINAN_CMS_CONFIG.origin}/uploads/2026/saved.png `,
  ]);
  assert.equal(transport.calls.some((call) => call.url.includes('QuickUpload')), false);
  assert.equal(transport.calls.some((call) => call.method === 'POST'), false);
});

test('M7c. ambiguous prior state returns manual check when proven image GET throws before credentials or mutation', async () => {
  reloadJinanCmsModule();
  let credentialsRead = 0;
  const env = {
    JINAN_CMS_PUBLISH_ENABLED: 'true',
    get JINAN_CMS_USERNAME() { credentialsRead += 1; return 'synthetic-user'; },
    get JINAN_CMS_PASSWORD() { credentialsRead += 1; return 'synthetic-password'; },
  };
  await seedSubmitAmbiguity({ env, finalImagePath: '/uploads/2026/saved.png' });
  credentialsRead = 0;

  const transport = makeTransport([
    { status: 200, finalUrl: JINAN_CMS_CONFIG.publicUrl, body: publicHtml('/uploads/2026/saved.png') },
    new Error('image GET failed'),
  ]);
  const result = await publishJinanCms({
    pngDataUrl: pngDataUrl(),
    env,
    transport,
  });

  assert.deepEqual(result, {
    status: 'MANUAL_CHECK_REQUIRED',
    orphanUploadRisk: true,
    finalImagePath: '/uploads/2026/saved.png',
  });
  assert.equal(credentialsRead, 0);
  assert.deepEqual(transport.calls.map((call) => `${call.method} ${call.url} ${call.cookie}`), [
    `GET ${JINAN_CMS_CONFIG.publicUrl} `,
    `GET ${JINAN_CMS_CONFIG.origin}/uploads/2026/saved.png `,
  ]);
  assert.equal(transport.calls.some((call) => call.url.includes('QuickUpload')), false);
  assert.equal(transport.calls.some((call) => call.method === 'POST'), false);
});

test('M7b. options.coordinator cannot bypass retained ambiguous state', async () => {
  reloadJinanCmsModule();
  await seedSubmitAmbiguity({ finalImagePath: '/uploads/2026/strict.png' });
  const transport = makeTransport([
    { status: 200, finalUrl: JINAN_CMS_CONFIG.publicUrl, body: publicCompositeHtml() },
  ]);
  const result = await publishJinanCms({
    pngDataUrl: pngDataUrl(),
    env: {
      JINAN_CMS_PUBLISH_ENABLED: 'true',
      JINAN_CMS_USERNAME: 'synthetic-user',
      JINAN_CMS_PASSWORD: 'synthetic-password',
    },
    transport,
    coordinator: { inFlight: false, ambiguous: null },
    logger: () => {},
  });
  assert.deepEqual(result, {
    status: 'MANUAL_CHECK_REQUIRED',
    orphanUploadRisk: true,
    finalImagePath: '/uploads/2026/strict.png',
  });
  assert.deepEqual(transport.calls.map((call) => `${call.method} ${call.url}`), [
    `GET ${JINAN_CMS_CONFIG.publicUrl}`,
  ]);
});

test('M8. unknown upload-response loss reports orphan risk and blocks runtime-local mutation retry', async () => {
  reloadJinanCmsModule();
  const transport = makeTransport([
    { status: 200, finalUrl: JINAN_CMS_CONFIG.publicUrl, body: publicCompositeHtml() },
    { status: 200, finalUrl: JINAN_CMS_CONFIG.loginUrl, body: loginHtml() },
    { status: 302, finalUrl: JINAN_CMS_CONFIG.loginUrl, location: '/admin/index.php', setCookie: ['sid=x; Path=/admin'] },
    loginSuccessLandingResponse(),
    { status: 200, finalUrl: JINAN_CMS_CONFIG.editorUrl, body: freshEditorHtml() },
    new Error('timeout after upload mutation'),
  ]);
  const env = {
    JINAN_CMS_PUBLISH_ENABLED: 'true',
    JINAN_CMS_USERNAME: 'synthetic-user',
    JINAN_CMS_PASSWORD: 'synthetic-password',
  };
  const first = await publishJinanCms({
    pngDataUrl: pngDataUrl(),
    callbackNumber: 37,
    env,
    transport,
  });
  assert.deepEqual(first, {
    status: 'MANUAL_CHECK_REQUIRED',
    orphanUploadRisk: true,
  });

  const retryTransport = makeTransport([
    { status: 200, finalUrl: JINAN_CMS_CONFIG.publicUrl, body: publicHtml('/uploads/2026/unknown-but-present.png') },
  ]);
  const retry = await publishJinanCms({
    pngDataUrl: pngDataUrl(),
    callbackNumber: 37,
    env,
    transport: retryTransport,
  });
  assert.deepEqual(retry, {
    status: 'MANUAL_CHECK_REQUIRED',
    orphanUploadRisk: true,
  });
  assert.equal(retryTransport.calls.length, 1);
  assert.equal(retryTransport.calls[0].url, JINAN_CMS_CONFIG.publicUrl);
});

test('M8b. dispatched upload failure responses become ambiguous and block re-upload', async () => {
  const env = {
    JINAN_CMS_PUBLISH_ENABLED: 'true',
    JINAN_CMS_USERNAME: 'synthetic-user',
    JINAN_CMS_PASSWORD: 'synthetic-password',
  };

  for (const [name, uploadResponse] of [
    ['non-2xx upload response', { status: 500, contentType: 'text/html', body: 'no' }],
    ['malformed upload response', { status: 200, contentType: 'text/html', body: 'ok' }],
  ]) {
    reloadJinanCmsModule();
    const transport = makeTransport([
      { status: 200, finalUrl: JINAN_CMS_CONFIG.publicUrl, body: publicCompositeHtml() },
      { status: 200, finalUrl: JINAN_CMS_CONFIG.loginUrl, body: loginHtml() },
      { status: 302, finalUrl: JINAN_CMS_CONFIG.loginUrl, location: '/admin/index.php', setCookie: ['sid=x; Path=/admin'] },
      loginSuccessLandingResponse(),
      { status: 200, finalUrl: JINAN_CMS_CONFIG.editorUrl, body: freshEditorHtml() },
      uploadResponse,
    ]);

    const first = await publishJinanCms({
      pngDataUrl: pngDataUrl(),
      callbackNumber: 37,
      env,
      transport,
    });
    assert.deepEqual(first, {
      status: 'MANUAL_CHECK_REQUIRED',
      orphanUploadRisk: true,
    }, name);
    assert.equal(transport.calls.filter((call) => call.url.includes('QuickUpload')).length, 1, name);

    const retryTransport = makeTransport([
      { status: 200, finalUrl: JINAN_CMS_CONFIG.publicUrl, body: publicHtml('/uploads/2026/unverified.png') },
    ]);
    const retry = await publishJinanCms({
      pngDataUrl: pngDataUrl(),
      callbackNumber: 37,
      env,
      transport: retryTransport,
    });
    assert.deepEqual(retry, {
      status: 'MANUAL_CHECK_REQUIRED',
      orphanUploadRisk: true,
    }, name);
    assert.deepEqual(retryTransport.calls.map((call) => `${call.method} ${call.url}`), [
      `GET ${JINAN_CMS_CONFIG.publicUrl}`,
    ], name);
    assert.equal(retryTransport.calls.filter((call) => call.url.includes('QuickUpload')).length, 0, name);
  }
});

test('M8c. pre-dispatch upload request validation fails closed without orphan state', async () => {
  reloadJinanCmsModule();
  const env = {
    JINAN_CMS_PUBLISH_ENABLED: 'true',
    JINAN_CMS_USERNAME: 'synthetic-user',
    JINAN_CMS_PASSWORD: 'synthetic-password',
  };
  const invalidTransport = makeTransport([
    { status: 200, finalUrl: JINAN_CMS_CONFIG.publicUrl, body: publicCompositeHtml() },
    { status: 200, finalUrl: JINAN_CMS_CONFIG.loginUrl, body: loginHtml() },
    { status: 302, finalUrl: JINAN_CMS_CONFIG.loginUrl, location: '/admin/index.php', setCookie: ['sid=x; Path=/admin'] },
    loginSuccessLandingResponse(),
    { status: 200, finalUrl: JINAN_CMS_CONFIG.editorUrl, body: freshEditorHtml() },
    new Error('invalid callback must not dispatch upload'),
  ]);

  const invalid = await publishJinanCms({
    pngDataUrl: pngDataUrl(),
    callbackNumber: -1,
    env,
    transport: invalidTransport,
  });
  assert.deepEqual(invalid, { status: 'FORM_CHANGED' });
  assert.equal(invalid.orphanUploadRisk, undefined);
  assert.equal(invalidTransport.calls.filter((call) => call.url.includes('QuickUpload')).length, 0);

  const validTransport = makeTransport([
    { status: 200, finalUrl: JINAN_CMS_CONFIG.publicUrl, body: publicCompositeHtml() },
    { status: 200, finalUrl: JINAN_CMS_CONFIG.loginUrl, body: loginHtml() },
    { status: 302, finalUrl: JINAN_CMS_CONFIG.loginUrl, location: '/admin/index.php', setCookie: ['sid=x; Path=/admin'] },
    loginSuccessLandingResponse(),
    { status: 200, finalUrl: JINAN_CMS_CONFIG.editorUrl, body: freshEditorHtml() },
    { status: 200, finalUrl: QUICK_UPLOAD_RESPONSE_URL, contentType: 'text/html', body: uploadSuccessBody('/uploads/2026/valid-after-invalid.png', 37) },
    { status: 200, finalUrl: JINAN_CMS_CONFIG.editorUrl, body: freshEditorHtml() },
    { status: 302, finalUrl: JINAN_CMS_CONFIG.editorUrl, location: '/admin/index.php?op=time&sub=set&mesCode=1' },
    { status: 200, finalUrl: JINAN_CMS_CONFIG.publicUrl, body: publicHtml('/uploads/2026/valid-after-invalid.png') },
    { status: 200, finalUrl: `${JINAN_CMS_CONFIG.origin}/uploads/2026/valid-after-invalid.png`, contentType: 'image/png', body: pngBuffer() },
  ]);
  const valid = await publishJinanCms({
    pngDataUrl: pngDataUrl(),
    callbackNumber: 37,
    env,
    transport: validTransport,
    sleep: async () => {},
  });
  assert.equal(valid.status, 'PUBLISHED');
  assert.equal(validTransport.calls.filter((call) => call.url.includes('QuickUpload')).length, 1);
});

test('M9. structured logs are allowlisted and logger failures are harmless', async () => {
  reloadJinanCmsModule();
  const forbiddenValues = [
    'synthetic-user',
    'synthetic-password',
    'protected-cookie',
    'data:image/png',
    '晉安門診表',
    'fresh-token',
    'window.parent.CKEDITOR',
    'timeout after submit mutation',
  ];
  const logs = [];
  const transport = makeTransport([
    { status: 200, finalUrl: JINAN_CMS_CONFIG.publicUrl, body: publicCompositeHtml() },
    { status: 200, finalUrl: JINAN_CMS_CONFIG.loginUrl, body: loginHtml(), setCookie: ['sid=protected-cookie; Path=/admin'] },
    { status: 302, finalUrl: JINAN_CMS_CONFIG.loginUrl, location: '/admin/index.php', setCookie: ['sid=x; Path=/admin'] },
    loginSuccessLandingResponse(),
    { status: 200, finalUrl: JINAN_CMS_CONFIG.editorUrl, body: freshEditorHtml() },
    { status: 200, finalUrl: QUICK_UPLOAD_RESPONSE_URL, contentType: 'text/html', body: uploadSuccessBody('/uploads/2026/logged.png', 37) },
    { status: 200, finalUrl: JINAN_CMS_CONFIG.editorUrl, body: freshEditorHtml() },
    new Error('timeout after submit mutation'),
  ]);

  const result = await publishJinanCms({
    pngDataUrl: pngDataUrl(),
    callbackNumber: 37,
    env: {
      JINAN_CMS_PUBLISH_ENABLED: 'true',
      JINAN_CMS_USERNAME: 'synthetic-user',
      JINAN_CMS_PASSWORD: 'synthetic-password',
    },
    transport,
    logger: (event) => {
      logs.push(event);
      throw new Error('logger failure should be swallowed');
    },
  });

  assert.equal(result.status, 'MANUAL_CHECK_REQUIRED');
  assert.equal(logs.length > 0, true);
  for (const event of logs) {
    assert.deepEqual(Object.keys(event).sort(), ['attemptId', 'errorCode', 'finalImagePath', 'orphanUploadRisk', 'stage', 'status'].sort());
    const json = JSON.stringify(event);
    for (const value of forbiddenValues) assert.equal(json.includes(value), false, value);
    assert.match(event.attemptId, /^jinan-[0-9a-f-]+$/);
  }
  assert.equal(logs.some((event) => event.stage === 'submit' && event.status === 'MANUAL_CHECK_REQUIRED'), true);
});

test('M9b. async logger rejections are swallowed without changing publish flow', async () => {
  reloadJinanCmsModule();
  const forbiddenValues = [
    'synthetic-user',
    'synthetic-password',
    'protected-cookie',
    'data:image/png',
    '晉安門診表',
    'fresh-token',
    'window.parent.CKEDITOR',
    'timeout after submit mutation',
  ];
  const logs = [];
  const unhandledRejections = [];
  const onUnhandledRejection = (reason) => {
    unhandledRejections.push(reason);
  };
  const asyncFailures = [
    () => Promise.reject(new Error('async logger failure should be swallowed')),
    () => ({
      get then() {
        throw new Error('then getter failure should be swallowed');
      },
    }),
    () => ({
      then(resolve) {
        resolve(Promise.reject(new Error('assimilated rejection should be swallowed')));
      },
    }),
    () => ({
      then(_resolve, reject) {
        reject(new Error('hostile reject should be swallowed'));
        throw new Error('hostile throw after reject should be swallowed');
      },
    }),
  ];
  const transport = makeTransport([
    { status: 200, finalUrl: JINAN_CMS_CONFIG.publicUrl, body: publicCompositeHtml() },
    { status: 200, finalUrl: JINAN_CMS_CONFIG.loginUrl, body: loginHtml(), setCookie: ['sid=protected-cookie; Path=/admin'] },
    { status: 302, finalUrl: JINAN_CMS_CONFIG.loginUrl, location: '/admin/index.php', setCookie: ['sid=x; Path=/admin'] },
    loginSuccessLandingResponse(),
    { status: 200, finalUrl: JINAN_CMS_CONFIG.editorUrl, body: freshEditorHtml() },
    { status: 200, finalUrl: QUICK_UPLOAD_RESPONSE_URL, contentType: 'text/html', body: uploadSuccessBody('/uploads/2026/logged.png', 37) },
    { status: 200, finalUrl: JINAN_CMS_CONFIG.editorUrl, body: freshEditorHtml() },
    new Error('timeout after submit mutation'),
  ]);

  process.on('unhandledRejection', onUnhandledRejection);
  try {
    const result = await publishJinanCms({
      pngDataUrl: pngDataUrl(),
      callbackNumber: 37,
      env: {
        JINAN_CMS_PUBLISH_ENABLED: 'true',
        JINAN_CMS_USERNAME: 'synthetic-user',
        JINAN_CMS_PASSWORD: 'synthetic-password',
      },
      transport,
      logger: (event) => {
        logs.push(event);
        return asyncFailures[(logs.length - 1) % asyncFailures.length]();
      },
    });
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(result.status, 'MANUAL_CHECK_REQUIRED');
    assert.equal(logs.length > 0, true);
    assert.equal(transport.calls.length, 8);
    assert.deepEqual(unhandledRejections, []);
    for (const event of logs) {
      assert.deepEqual(Object.keys(event).sort(), ['attemptId', 'errorCode', 'finalImagePath', 'orphanUploadRisk', 'stage', 'status'].sort());
      const json = JSON.stringify(event);
      for (const value of forbiddenValues) assert.equal(json.includes(value), false, value);
      assert.match(event.attemptId, /^jinan-[0-9a-f-]+$/);
    }
    assert.equal(logs.some((event) => event.stage === 'submit' && event.status === 'MANUAL_CHECK_REQUIRED'), true);
  } finally {
    process.off('unhandledRejection', onUnhandledRejection);
    reloadJinanCmsModule();
  }
});

test('I. pure retry/idempotency and public-current inspection model', () => {
  const attempt = createAttemptRecord('attempt-1');
  assert.deepEqual(attempt, { id: 'attempt-1', uploadedImageUrl: null, status: 'READY_FOR_UPLOAD' });

  const uploaded = markUploadRecorded(attempt, '/uploads/2026/jinan.png');
  assert.deepEqual(uploaded, { id: 'attempt-1', uploadedImageUrl: '/uploads/2026/jinan.png', status: 'UPLOAD_SUCCEEDED' });
  assertCode(() => markUploadRecorded(uploaded, '/uploads/other.png'), 'FORM_CHANGED');
  assert.deepEqual(planRetry(uploaded), {
    reuseUpload: true,
    requiresFreshEditorGetBeforeSubmit: true,
    uploadUrl: '/uploads/2026/jinan.png',
  });
  assert.deepEqual(planRetry({ ...uploaded, status: 'READY_FOR_UPLOAD' }), {
    reuseUpload: false,
    requiresFreshEditorGetBeforeSubmit: true,
    uploadUrl: null,
  });

  assert.deepEqual(inspectPublicCurrent({
    response: { status: 200, finalUrl: JINAN_CMS_CONFIG.publicUrl, body: '<img src="/uploads/2026/jinan.png">' },
    savedTargetUrl: '/uploads/2026/jinan.png',
  }), { status: 'ALREADY_PUBLISHED' });
  for (const response of [
    { status: 500, finalUrl: JINAN_CMS_CONFIG.publicUrl, body: '<img src="/uploads/2026/jinan.png">' },
    { status: 200, finalUrl: 'https://attacker.example/time.html', body: '<img src="/uploads/2026/jinan.png">' },
    { status: 200, finalUrl: JINAN_CMS_CONFIG.publicUrl, body: '<img src="/uploads/other.png">' },
  ]) {
    assert.notEqual(inspectPublicCurrent({ response, savedTargetUrl: '/uploads/2026/jinan.png' }).status, 'ALREADY_PUBLISHED');
  }
});

test('I2. public-current inspection requires one visible exact image src match only', () => {
  assert.deepEqual(inspectPublicCurrent({
    response: { status: 200, finalUrl: JINAN_CMS_CONFIG.publicUrl, body: '<main><img src="/uploads/2026/jinan.png"></main>' },
    savedTargetUrl: '/uploads/2026/jinan.png',
  }), { status: 'ALREADY_PUBLISHED' });

  for (const body of [
    '<!-- <img src="/uploads/2026/jinan.png"> -->',
    '<script>const x = "<img src=\\"/uploads/2026/jinan.png\\">";</script>',
    '<style>.x{background:url("/uploads/2026/jinan.png")}</style>',
    '<template><img src="/uploads/2026/jinan.png"></template>',
    '<p>/uploads/2026/jinan.png</p>',
    '<img data-src="/uploads/2026/jinan.png">',
    '<img src="/uploads/2026/jinan.png" hidden>',
    '<img src="/uploads/2026/jinan.png" aria-hidden="true">',
    '<img src="/uploads/2026/jinan.png" style="display:none">',
    '<img src="/uploads/2026/jinan.png"><img src="/uploads/2026/jinan.png">',
    '<img src="/uploads/2026/other.png">',
  ]) {
    assert.notEqual(inspectPublicCurrent({
      response: { status: 200, finalUrl: JINAN_CMS_CONFIG.publicUrl, body },
      savedTargetUrl: '/uploads/2026/jinan.png',
    }).status, 'ALREADY_PUBLISHED');
  }

  assert.notEqual(inspectPublicCurrent({
    response: { status: 200, finalUrl: `${JINAN_CMS_CONFIG.publicUrl}?x=1`, body: '<img src="/uploads/2026/jinan.png">' },
    savedTargetUrl: '/uploads/2026/jinan.png',
  }).status, 'ALREADY_PUBLISHED');
});

test('I3. public-current inspection returns unverified on duplicate or malformed img attributes', () => {
  for (const body of [
    '<img src="/uploads/other.png" SRC="/uploads/2026/jinan.png">',
    '<img src="/uploads/2026/jinan.png"data-x="y">',
    '<img alt="x"hidden src="/uploads/2026/jinan.png">',
  ]) {
    assert.deepEqual(inspectPublicCurrent({
      response: { status: 200, finalUrl: JINAN_CMS_CONFIG.publicUrl, body },
      savedTargetUrl: '/uploads/2026/jinan.png',
    }), { status: 'CMS_RESPONSE_CONTRACT_UNVERIFIED' });
  }
});

test('I4. public-current inspection fails closed for unclosed or malformed excluded HTML contexts', () => {
  for (const body of [
    '<!-- <img src="/uploads/2026/jinan.png">',
    '<script><img src="/uploads/2026/jinan.png"></script x><img src="/uploads/2026/jinan.png">',
    '<style><img src="/uploads/2026/jinan.png"></style x><img src="/uploads/2026/jinan.png">',
    '<plaintext><img src="/uploads/2026/jinan.png">',
  ]) {
    assert.deepEqual(inspectPublicCurrent({
      response: { status: 200, finalUrl: JINAN_CMS_CONFIG.publicUrl, body },
      savedTargetUrl: '/uploads/2026/jinan.png',
    }), { status: 'CMS_RESPONSE_CONTRACT_UNVERIFIED' });
  }
});

test('I5. public-current inspection ignores excluded and attribute-contained img text', () => {
  assert.deepEqual(inspectPublicCurrent({
    response: {
      status: 200,
      finalUrl: JINAN_CMS_CONFIG.publicUrl,
      body: '<main data-html=\'<img src="/uploads/2026/jinan.png">\'><!-- <img src="/uploads/2026/jinan.png"> -->'
        + '<script>const x = "<img src=\\"/uploads/2026/jinan.png\\">";</script>'
        + '<style>.x{background:url("/uploads/2026/jinan.png")}</style>'
        + '<template><img src="/uploads/2026/jinan.png"></template>'
        + '<img src="/uploads/2026/jinan.png"></main>',
    },
    savedTargetUrl: '/uploads/2026/jinan.png',
  }), { status: 'ALREADY_PUBLISHED' });

  for (const body of [
    '<main data-html=\'<img src="/uploads/2026/jinan.png">\'></main>',
    '<!-- <img src="/uploads/2026/jinan.png"> --><script>const x="/uploads/2026/jinan.png";</script>',
    '<template><img src="/uploads/2026/jinan.png"></template>',
  ]) {
    assert.notEqual(inspectPublicCurrent({
      response: { status: 200, finalUrl: JINAN_CMS_CONFIG.publicUrl, body },
      savedTargetUrl: '/uploads/2026/jinan.png',
    }).status, 'ALREADY_PUBLISHED');
  }
});

test('I6. public-current inspection fail-closes ordinary HTML nesting and accepts balanced and void tags', () => {
  for (const body of [
    '<main><div><img src="/uploads/2026/jinan.png"></div>',
    '<main><span><img src="/uploads/2026/jinan.png"></main></span>',
    '</section><main><img src="/uploads/2026/jinan.png"></main>',
    '<div hidden/><img src="/uploads/2026/jinan.png">',
    '<custom-widget/><img src="/uploads/2026/jinan.png">',
  ]) {
    assert.deepEqual(inspectPublicCurrent({
      response: { status: 200, finalUrl: JINAN_CMS_CONFIG.publicUrl, body },
      savedTargetUrl: '/uploads/2026/jinan.png',
    }), { status: 'CMS_RESPONSE_CONTRACT_UNVERIFIED' });
  }

  for (const body of [
    '<main><div><img src="/uploads/2026/jinan.png"></div></main>',
    '<main><br><img src="/uploads/2026/jinan.png"><hr><input type="hidden" name="x"></main>',
  ]) {
    assert.deepEqual(inspectPublicCurrent({
      response: { status: 200, finalUrl: JINAN_CMS_CONFIG.publicUrl, body },
      savedTargetUrl: '/uploads/2026/jinan.png',
    }), { status: 'ALREADY_PUBLISHED' });
  }
});

test('I7. public-current inspection fail-closes hidden target images on self or inherited ancestors', () => {
  for (const body of [
    '<main><img hidden alt="x" src="/uploads/2026/jinan.png"></main>',
    '<main><img alt="x" hidden src="/uploads/2026/jinan.png"></main>',
    '<main hidden><img src="/uploads/2026/jinan.png"></main>',
    '<main aria-hidden="true"><section><img src="/uploads/2026/jinan.png"></section></main>',
    '<main style="display:none"><img src="/uploads/2026/jinan.png"></main>',
    '<main style="display/**/:none"><img src="/uploads/2026/jinan.png"></main>',
    '<main style="dis/**/play: none !important"><img src="/uploads/2026/jinan.png"></main>',
    '<main style="DISPLAY: NONE !IMPORTANT"><img src="/uploads/2026/jinan.png"></main>',
    '<main style="visibility:hidden"><img src="/uploads/2026/jinan.png"></main>',
    '<main style="visibility:collapse !important"><img src="/uploads/2026/jinan.png"></main>',
    '<main style="vis/**/ibility : hidden ! important"><img src="/uploads/2026/jinan.png"></main>',
    '<main style="content-visibility:hidden"><img src="/uploads/2026/jinan.png"></main>',
    '<main style="content/**/-visibility : hidden !important"><img src="/uploads/2026/jinan.png"></main>',
    '<main style="opacity:0"><img src="/uploads/2026/jinan.png"></main>',
    '<main style="opacity:+0.000e2 ! important"><img src="/uploads/2026/jinan.png"></main>',
    '<main style="display/* unterminated"><img src="/uploads/2026/jinan.png"></main>',
    '<main style="vis\\69 bility:hidden"><img src="/uploads/2026/jinan.png"></main>',
    '<main style="--v:hidden;visibility:var(--v)"><img src="/uploads/2026/jinan.png"></main>',
    '<main style="opacity:calc(0)"><img src="/uploads/2026/jinan.png"></main>',
    '<main style="text-align:center"><img src="/uploads/2026/jinan.png"></main>',
    '<main><img style="display/**/: none !important" src="/uploads/2026/jinan.png"></main>',
    '<main><img style="visibility:hidden" src="/uploads/2026/jinan.png"></main>',
    '<main><img style="visibility:collapse !important" src="/uploads/2026/jinan.png"></main>',
    '<main><img style="content-visibility:hidden" src="/uploads/2026/jinan.png"></main>',
    '<main><img style="opacity:.0" src="/uploads/2026/jinan.png"></main>',
    '<main><img style="opacity:-0.0e-2 !important" src="/uploads/2026/jinan.png"></main>',
    '<main><img style="display/* unterminated" src="/uploads/2026/jinan.png"></main>',
    '<main><img style="vis\\69 bility:hidden" src="/uploads/2026/jinan.png"></main>',
    '<main><img style="--v:hidden;visibility:var(--v)" src="/uploads/2026/jinan.png"></main>',
    '<main><img style="opacity:calc(0)" src="/uploads/2026/jinan.png"></main>',
    '<main><img style="text-align:center" src="/uploads/2026/jinan.png"></main>',
    '<main hidden><img src="/uploads/2026/jinan.png"></main><img src="/uploads/2026/jinan.png">',
  ]) {
    assert.deepEqual(inspectPublicCurrent({
      response: { status: 200, finalUrl: JINAN_CMS_CONFIG.publicUrl, body },
      savedTargetUrl: '/uploads/2026/jinan.png',
    }), { status: 'CMS_RESPONSE_CONTRACT_UNVERIFIED' });
  }

  assert.deepEqual(inspectPublicCurrent({
    response: {
      status: 200,
      finalUrl: JINAN_CMS_CONFIG.publicUrl,
      body: '<main><!-- <img src="/uploads/2026/jinan.png"> -->'
        + '<script>const x="/uploads/2026/jinan.png";</script>'
        + '<style>.x{background:url("/uploads/2026/jinan.png")}</style>'
        + '<template><img src="/uploads/2026/jinan.png"></template>'
        + '<section><img src="/uploads/2026/jinan.png"></section></main>',
    },
    savedTargetUrl: '/uploads/2026/jinan.png',
  }), { status: 'ALREADY_PUBLISHED' });

  for (const body of [
    '<main style=""><img src="/uploads/2026/jinan.png"></main>',
    '<main style=" \n\t\r\f "><img src="/uploads/2026/jinan.png"></main>',
    '<main><img style="" src="/uploads/2026/jinan.png"></main>',
    '<main><img style=" \n\t\r\f " src="/uploads/2026/jinan.png"></main>',
  ]) {
    assert.deepEqual(inspectPublicCurrent({
      response: { status: 200, finalUrl: JINAN_CMS_CONFIG.publicUrl, body },
      savedTargetUrl: '/uploads/2026/jinan.png',
    }), { status: 'ALREADY_PUBLISHED' });
  }
});

test('K. cookie jar scopes Path, Secure, expiry, deletion, and same-name ordering', () => {
  const jar = createCookieJar();
  jar.ingest(JINAN_CMS_CONFIG.loginUrl, [
    'sid=public; Path=/; HttpOnly',
    'sid=admin; Path=/admin; HttpOnly',
    'gone=old; Path=/admin; Max-Age=0',
    'past=old; Path=/admin; Expires=Wed, 21 Oct 2015 07:28:00 GMT',
    'secure=only; Path=/admin; Secure',
  ]);

  assert.equal(jar.header(JINAN_CMS_CONFIG.editorUrl), 'sid=admin; secure=only; sid=public');
  assert.equal(jar.header(JINAN_CMS_CONFIG.publicUrl), 'sid=public');
  assert.equal(jar.header('http://www.tainanrehab.com/admin/index.php?op=time&sub=set'), 'sid=admin; sid=public');

  const json = JSON.stringify(jar);
  for (const value of ['admin', 'public', 'only', 'old']) assert.equal(json.includes(value), false);
});

test('L. default fetch transport never follows redirects and returns Location plus Set-Cookie values', async () => {
  const originalFetch = global.fetch;
  const fetchCalls = [];
  try {
    global.fetch = async (url, options = {}) => {
      fetchCalls.push({ url, options });
      return {
        status: 302,
        url,
        text: async () => 'manual body',
        headers: {
          get: (name) => {
            const lower = String(name).toLowerCase();
            if (lower === 'location') return '/admin/index.php';
            if (lower === 'content-length') return '11';
            return null;
          },
          getSetCookie: () => ['sid=protected-cookie; Path=/admin; HttpOnly'],
        },
      };
    };

    const transport = createDefaultFetchTransport();
    const response = await transport({
      method: 'POST',
      url: JINAN_CMS_CONFIG.loginUrl,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams('mode=login'),
    });

    assert.equal(fetchCalls.length, 1);
    assert.equal(fetchCalls[0].options.redirect, 'manual');
    assert.deepEqual(response, {
      status: 302,
      finalUrl: JINAN_CMS_CONFIG.loginUrl,
      body: 'manual body',
      bytes: null,
      setCookie: ['sid=protected-cookie; Path=/admin; HttpOnly'],
      location: '/admin/index.php',
      contentType: null,
    });
  } finally {
    global.fetch = originalFetch;
  }
});

test('L1b. default fetch transport can return bounded binary response bytes', async () => {
  const originalFetch = global.fetch;
  const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
  try {
    global.fetch = async () => ({
      status: 200,
      url: `${JINAN_CMS_CONFIG.origin}/uploads/2026/jinan.png`,
      headers: {
        get: (name) => {
          const lower = String(name).toLowerCase();
          if (lower === 'content-type') return 'image/png';
          if (lower === 'content-length') return '4';
          return null;
        },
        getSetCookie: () => [],
      },
      async arrayBuffer() {
        return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      },
      async text() {
        throw new Error('binary response must not be read as text');
      },
    });

    const transport = createDefaultFetchTransport({ timeoutMs: 1000, maxBodyBytes: 10, maxImageBodyBytes: 10 });
    const result = await transport({
      method: 'GET',
      url: `${JINAN_CMS_CONFIG.origin}/uploads/2026/jinan.png`,
      responseType: 'bytes',
    });
    assert.equal(result.body, '');
    assert.deepEqual(result.bytes, Buffer.from(bytes));
  } finally {
    global.fetch = originalFetch;
  }
});

test('L1c. default fetch transport streams split binary bytes within the body limit', async () => {
  const originalFetch = global.fetch;
  try {
    global.fetch = async () => ({
      status: 200,
      url: `${JINAN_CMS_CONFIG.origin}/uploads/2026/jinan.png`,
      headers: { get: () => null, getSetCookie: () => [] },
      body: {
        getReader() {
          const chunks = [new Uint8Array([1, 2]), new Uint8Array([3]), new Uint8Array([4, 5])];
          return {
            async read() {
              return chunks.length > 0 ? { done: false, value: chunks.shift() } : { done: true };
            },
            async cancel() {},
          };
        },
      },
      async arrayBuffer() {
        throw new Error('streaming binary response must not use arrayBuffer');
      },
    });
    const transport = createDefaultFetchTransport({ timeoutMs: 1000, maxBodyBytes: 1024, maxImageBodyBytes: 5 });
    const result = await transport({
      method: 'GET',
      url: `${JINAN_CMS_CONFIG.origin}/uploads/2026/jinan.png`,
      responseType: 'bytes',
    });
    assert.deepEqual(result.bytes, Buffer.from([1, 2, 3, 4, 5]));
  } finally {
    global.fetch = originalFetch;
  }
});

test('L1d. default fetch transport cancels oversized streaming binary response immediately', async () => {
  const originalFetch = global.fetch;
  let reads = 0;
  let cancelled = false;
  try {
    global.fetch = async () => ({
      status: 200,
      url: `${JINAN_CMS_CONFIG.origin}/uploads/2026/jinan.png`,
      headers: { get: () => null, getSetCookie: () => [] },
      body: {
        getReader() {
          const chunks = [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5, 6]), new Uint8Array([7])];
          return {
            async read() {
              reads += 1;
              return chunks.length > 0 ? { done: false, value: chunks.shift() } : { done: true };
            },
            async cancel() {
              cancelled = true;
            },
          };
        },
      },
      async arrayBuffer() {
        throw new Error('oversized streaming binary response must not use arrayBuffer');
      },
    });
    const transport = createDefaultFetchTransport({ timeoutMs: 1000, maxBodyBytes: 1024, maxImageBodyBytes: 5 });
    await assert.rejects(
      () => transport({
        method: 'GET',
        url: `${JINAN_CMS_CONFIG.origin}/uploads/2026/jinan.png`,
        responseType: 'bytes',
      }),
      /too large/i,
    );
    assert.equal(cancelled, true);
    assert.equal(reads, 2);
  } finally {
    global.fetch = originalFetch;
  }
});

test('L1e. default fetch transport requires bounded Content-Length before binary arrayBuffer fallback', async () => {
  const originalFetch = global.fetch;
  const cases = [
    [null, Buffer.from([1, 2, 3]), false],
    ['bad', Buffer.from([1, 2, 3]), false],
    ['6', Buffer.from([1, 2, 3, 4, 5, 6]), false],
    ['5', Buffer.from([1, 2, 3, 4, 5]), true],
    ['5', Buffer.from([1, 2, 3, 4]), false],
  ];
  try {
    for (const [contentLength, bodyBytes, shouldPass] of cases) {
      global.fetch = async () => ({
        status: 200,
        url: `${JINAN_CMS_CONFIG.origin}/uploads/2026/jinan.png`,
        headers: {
          get(name) {
            return name.toLowerCase() === 'content-length' ? contentLength : null;
          },
          getSetCookie: () => [],
        },
        async arrayBuffer() {
          return bodyBytes.buffer.slice(bodyBytes.byteOffset, bodyBytes.byteOffset + bodyBytes.byteLength);
        },
      });
      const transport = createDefaultFetchTransport({ timeoutMs: 1000, maxBodyBytes: 1024, maxImageBodyBytes: 5 });
      if (shouldPass) {
        const result = await transport({
          method: 'GET',
          url: `${JINAN_CMS_CONFIG.origin}/uploads/2026/jinan.png`,
          responseType: 'bytes',
        });
        assert.deepEqual(result.bytes, bodyBytes);
      } else {
        await assert.rejects(
          () => transport({
            method: 'GET',
            url: `${JINAN_CMS_CONFIG.origin}/uploads/2026/jinan.png`,
            responseType: 'bytes',
          }),
          /content-length|too large/i,
        );
      }
    }
  } finally {
    global.fetch = originalFetch;
  }
});

test('L2. default fetch transport streams split UTF-8 safely within the body limit', async () => {
  const originalFetch = global.fetch;
  const encoder = new TextEncoder();
  const bytes = encoder.encode('A你B');
  try {
    global.fetch = async () => ({
      status: 200,
      url: JINAN_CMS_CONFIG.publicUrl,
      headers: { get: () => null, getSetCookie: () => [] },
      body: {
        getReader() {
          const chunks = [
            bytes.slice(0, 2),
            bytes.slice(2, 4),
            bytes.slice(4),
          ];
          return {
            async read() {
              return chunks.length > 0 ? { done: false, value: chunks.shift() } : { done: true };
            },
            async cancel() {},
          };
        },
      },
    });

    const transport = createDefaultFetchTransport({ timeoutMs: 1000, maxBodyBytes: 5 });
    const result = await transport({ method: 'GET', url: JINAN_CMS_CONFIG.publicUrl });
    assert.equal(result.body, 'A你B');
  } finally {
    global.fetch = originalFetch;
  }
});

test('L3. default fetch transport cancels streaming responses immediately above max bytes', async () => {
  const originalFetch = global.fetch;
  let reads = 0;
  let cancelled = false;
  try {
    global.fetch = async () => ({
      status: 200,
      url: JINAN_CMS_CONFIG.publicUrl,
      headers: { get: () => null, getSetCookie: () => [] },
      body: {
        getReader() {
          const chunks = [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5, 6]), new Uint8Array([7])];
          return {
            async read() {
              reads += 1;
              return chunks.length > 0 ? { done: false, value: chunks.shift() } : { done: true };
            },
            async cancel() {
              cancelled = true;
            },
          };
        },
      },
      async text() {
        throw new Error('must not materialize oversized response');
      },
    });

    const transport = createDefaultFetchTransport({ timeoutMs: 1000, maxBodyBytes: 5 });
    await assert.rejects(
      () => transport({ method: 'GET', url: JINAN_CMS_CONFIG.publicUrl }),
      /too large/i,
    );
    assert.equal(cancelled, true);
    assert.equal(reads, 2);
  } finally {
    global.fetch = originalFetch;
  }
});

test('L4. default fetch transport without a web stream requires bounded Content-Length', async () => {
  const originalFetch = global.fetch;
  const cases = [
    [null, 'abc', false],
    ['bad', 'abc', false],
    ['4', 'abcd', true],
    ['6', 'abcdef', false],
    ['4', 'abcde', false],
  ];
  try {
    for (const [contentLength, bodyText, shouldPass] of cases) {
      global.fetch = async () => ({
        status: 200,
        url: JINAN_CMS_CONFIG.publicUrl,
        headers: {
          get(name) {
            return name.toLowerCase() === 'content-length' ? contentLength : null;
          },
          getSetCookie: () => [],
        },
        async text() {
          return bodyText;
        },
      });
      const transport = createDefaultFetchTransport({ timeoutMs: 1000, maxBodyBytes: 5 });
      if (shouldPass) {
        const result = await transport({ method: 'GET', url: JINAN_CMS_CONFIG.publicUrl });
        assert.equal(result.body, bodyText);
      } else {
        await assert.rejects(
          () => transport({ method: 'GET', url: JINAN_CMS_CONFIG.publicUrl }),
          /content-length|too large/i,
        );
      }
    }
  } finally {
    global.fetch = originalFetch;
  }
});

test('L5. default fetch transport validates body limit and timeout options', () => {
  for (const options of [
    { timeoutMs: 0, maxBodyBytes: 100 },
    { timeoutMs: Number.POSITIVE_INFINITY, maxBodyBytes: 100 },
    { timeoutMs: 100, maxBodyBytes: 0 },
    { timeoutMs: 100, maxBodyBytes: 1.5 },
    { timeoutMs: 100, maxBodyBytes: Number.POSITIVE_INFINITY },
  ]) {
    assert.throws(() => createDefaultFetchTransport(options), /positive bounded integer/i);
  }
});

test('J. rollback plan is explicitly unsupported and non-mutating', () => {
  assert.deepEqual(planRollback(), {
    supported: false,
    operations: [],
    deletes: false,
    submits: false,
  });
});
