const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');

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
  validateLoginPostResponse,
} = require('../lib/jinan-cms.js');

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
      <textarea name="note"><p><img src="/upload/115晉安門診表.png"></p></textarea>
      <input type="text" name="wtitle" value="SEO title">
      <input type="text" name="wkeyword" value="SEO keyword">
      <textarea name="wdescription">SEO description</textarea>
      <input type="submit" name="Submit" value="送出">
      ${extra}
    </form>`;
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
    if (next instanceof Error) throw next;
    return next;
  };
  transport.calls = calls;
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
    usernameEnvName: 'JINAN_CMS_USERNAME',
    passwordEnvName: 'JINAN_CMS_PASSWORD',
  });
  assert.equal(JSON.stringify(JINAN_CMS_CONFIG).includes('secret'), false);
  assert.deepEqual(Object.keys(JINAN_CMS_RESULTS).sort(), [
    'ALREADY_PUBLISHED',
    'AUTH_FAILED',
    'CMS_RESPONSE_CONTRACT_UNVERIFIED',
    'FORM_CHANGED',
    'PUBLISHED',
    'READY_FOR_UPLOAD',
    'SUBMIT_FAILED',
    'UPLOAD_FAILED',
    'VERIFY_FAILED',
  ].sort());
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
    note: '<p><img src="/upload/115晉安門診表.png"></p>',
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
    good.replace('<textarea name="note"><p><img src="/upload/115晉安門診表.png"></p></textarea>', ''),
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

  assertCode(() => buildSubmitRequest(
    parseCmsEditorForm(freshEditorHtml().replace(
      '<p><img src="/upload/115晉安門診表.png"></p>',
      '<p><img hidden src="/upload/115晉安門診表.png"></p>',
    )),
    '/upload/new.png',
  ), 'FORM_CHANGED');

  for (const html of [
    loginHtml().replace('type="hidden" name="mode"', 'type="hidden"disabled name="mode"'),
    freshEditorHtml('<input type="hidden" name="extra" value="ok" data-flag data-flag>'),
    freshEditorHtml('<input type="hidden" name="extra" value="ok" data-flag / data-next="bad">'),
  ]) {
    assertCode(() => parseCmsEditorForm(html), 'FORM_CHANGED');
  }
});

test('D. submit request preserves fields and changes only the single protected image reference', () => {
  const parsed = parseCmsEditorForm(freshEditorHtml());
  const request = buildSubmitRequest(parsed, '/uploads/2026/jinan.png');

  assert.equal(request.method, 'POST');
  assert.equal(request.url, JINAN_CMS_CONFIG.editorUrl);
  assert.deepEqual(request.multipartFields, {
    ...parsed.fields,
    note: '<p><img src="/uploads/2026/jinan.png"></p>',
  });
  assert.equal(parsed.fields.note.includes('/upload/115晉安門診表.png'), true);

  assertCode(() => buildSubmitRequest(parseCmsEditorForm(freshEditorHtml().replace('/upload/115晉安門診表.png', '/other.png')), '/upload/new.png'), 'FORM_CHANGED');
  assertCode(() => buildSubmitRequest(parseCmsEditorForm(freshEditorHtml().replace('</p>', '/upload/115晉安門診表.png</p>')), '/upload/new.png'), 'FORM_CHANGED');
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

test('D2. submit request replaces only one exact protected image src attribute', () => {
  assert.equal(
    buildSubmitRequest(parseCmsEditorForm(freshEditorHtml()), '/upload/new.png').multipartFields.note,
    '<p><img src="/upload/new.png"></p>',
  );

  assert.equal(
    buildSubmitRequest(
      parseCmsEditorForm(freshEditorHtml().replace(
        '<p><img src="/upload/115晉安門診表.png"></p>',
        '<p><img data-src="/lazy.png" src="/upload/115晉安門診表.png"></p>',
      )),
      '/upload/new.png',
    ).multipartFields.note,
    '<p><img data-src="/lazy.png" src="/upload/new.png"></p>',
  );

  assert.equal(
    buildSubmitRequest(
      parseCmsEditorForm(freshEditorHtml().replace(
        '<p><img src="/upload/115晉安門診表.png"></p>',
        '<p><img\nsrc="/upload/115晉安門診表.png" /></p>',
      )),
      '/upload/new.png',
    ).multipartFields.note,
    '<p><img\nsrc="/upload/new.png" /></p>',
  );

  assert.equal(
    buildSubmitRequest(
      parseCmsEditorForm(freshEditorHtml().replace(
        '<p><img src="/upload/115晉安門診表.png"></p>',
        '<p><img data-x="literal src=other" SRC = "/upload/115晉安門診表.png"></p>',
      )),
      '/upload/new.png',
    ).multipartFields.note,
    '<p><img data-x="literal src=other" SRC = "/upload/new.png"></p>',
  );

  for (const note of [
    '<p>/upload/115晉安門診表.png</p>',
    '<script>const path="/upload/115晉安門診表.png";</script><p><img src="/other.png"></p>',
    '<p><img data-src="/upload/115晉安門診表.png" src="/other.png"></p>',
    '<p><img data-x="literal src=&#39;/upload/115晉安門診表.png&#39;" src="/other.png"></p>',
    '<p><img data-x="literal src=/upload/115晉安門診表.png"></p>',
    '<p data-src="/upload/115晉安門診表.png"><img src="/other.png"></p>',
    '<p><img alt="/upload/115晉安門診表.png" src="/other.png"></p>',
    '<p><img src="/upload/115晉安門診表.png" alt="unterminated></p>',
    '<p><img src="/upload/115晉安門診表.png" src="/other.png"></p>',
    '<p><img src="/upload/115晉安門診表.png"data-x="y"></p>',
    '<p><img alt="x"data-x="y" src="/upload/115晉安門診表.png"></p>',
    '<p><img alt="x"hidden src="/upload/115晉安門診表.png"></p>',
    '<p><img src="/upload/115晉安門診表.png"><img src="/upload/115晉安門診表.png"></p>',
  ]) {
    const html = freshEditorHtml().replace('<p><img src="/upload/115晉安門診表.png"></p>', note);
    assertCode(() => buildSubmitRequest(parseCmsEditorForm(html), '/upload/new.png'), 'FORM_CHANGED');
  }
});

test('D2b. submit request discovers only visible real img tags and preserves excluded bytes', () => {
  for (const note of [
    '<!-- <img src="/upload/115晉安門診表.png"> -->',
    '<script>const path="/upload/115晉安門診表.png";</script>',
    '<style>.x{background:url("/upload/115晉安門診表.png")}</style>',
    '<template><img src="/upload/115晉安門診表.png"></template>',
  ]) {
    const html = freshEditorHtml().replace('<p><img src="/upload/115晉安門診表.png"></p>', note);
    assertCode(() => buildSubmitRequest(parseCmsEditorForm(html), '/upload/new.png'), 'FORM_CHANGED');
  }

  const excluded = [
    '<!-- <img src="/upload/115晉安門診表.png"> -->',
    '<script>const img = "<img src=\\"/upload/115晉安門診表.png\\">";</script>',
    '<style>.x{background:url("/upload/115晉安門診表.png")}</style>',
    '<template><img src="/upload/115晉安門診表.png"></template>',
  ].join('');
  const note = `<section data-html='<img src="/not-the-target.png">'`
    + `>${excluded}<p><img src="/upload/115晉安門診表.png"></p></section>`;
  const html = freshEditorHtml().replace('<p><img src="/upload/115晉安門診表.png"></p>', note);
  const rewritten = buildSubmitRequest(parseCmsEditorForm(html), '/upload/new.png').multipartFields.note;
  assert.equal(rewritten, `<section data-html='<img src="/not-the-target.png">'`
    + `>${excluded}<p><img src="/upload/new.png"></p></section>`);

  for (const malformed of [
    '<script><img src="/upload/115晉安門診表.png"></script x><p><img src="/upload/115晉安門診表.png"></p>',
    '<style><img src="/upload/115晉安門診表.png"></style x><p><img src="/upload/115晉安門診表.png"></p>',
    '<script><p><img src="/upload/115晉安門診表.png"></p>',
    '<!-- <img src="/upload/115晉安門診表.png"> <p><img src="/upload/115晉安門診表.png"></p>',
  ]) {
    const malformedHtml = freshEditorHtml().replace('<p><img src="/upload/115晉安門診表.png"></p>', malformed);
    assertCode(() => buildSubmitRequest(parseCmsEditorForm(malformedHtml), '/upload/new.png'), 'FORM_CHANGED');
  }
});

test('D2c. submit request fail-closes ordinary HTML nesting and accepts balanced and void tags', () => {
  for (const note of [
    '<main><p><img src="/upload/115晉安門診表.png"></p>',
    '<main><div><img src="/upload/115晉安門診表.png"></div>',
    '<main><span><img src="/upload/115晉安門診表.png"></main></span>',
    '</section><main><img src="/upload/115晉安門診表.png"></main>',
    '<div hidden/><img src="/upload/115晉安門診表.png">',
    '<custom-widget/><img src="/upload/115晉安門診表.png">',
  ]) {
    const html = freshEditorHtml().replace('<p><img src="/upload/115晉安門診表.png"></p>', note);
    assertCode(() => buildSubmitRequest(parseCmsEditorForm(html), '/upload/new.png'), 'FORM_CHANGED');
  }

  for (const [note, expected] of [
    [
      '<main><div><img src="/upload/115晉安門診表.png"></div></main>',
      '<main><div><img src="/upload/new.png"></div></main>',
    ],
    [
      '<main><br><img src="/upload/115晉安門診表.png"><hr><input type="hidden" name="x"></main>',
      '<main><br><img src="/upload/new.png"><hr><input type="hidden" name="x"></main>',
    ],
  ]) {
    const html = freshEditorHtml().replace('<p><img src="/upload/115晉安門診表.png"></p>', note);
    assert.equal(buildSubmitRequest(parseCmsEditorForm(html), '/upload/new.png').multipartFields.note, expected);
  }
});

test('D2d. submit request fail-closes hidden target images on self or inherited ancestors', () => {
  for (const note of [
    '<p><img hidden alt="x" src="/upload/115晉安門診表.png"></p>',
    '<p><img alt="x" hidden src="/upload/115晉安門診表.png"></p>',
    '<section hidden><img src="/upload/115晉安門診表.png"></section>',
    '<section aria-hidden="true"><div><img src="/upload/115晉安門診表.png"></div></section>',
    '<section style="color:red; display:none"><img src="/upload/115晉安門診表.png"></section>',
    '<section style="display/**/:none"><img src="/upload/115晉安門診表.png"></section>',
    '<section style="dis/**/play:none"><img src="/upload/115晉安門診表.png"></section>',
    '<section style="DISPLAY: NONE !IMPORTANT"><img src="/upload/115晉安門診表.png"></section>',
    '<section style="display/* unterminated"><img src="/upload/115晉安門診表.png"></section>',
    '<p><img style="display/**/: none !important" src="/upload/115晉安門診表.png"></p>',
    '<p><img style="display/* unterminated" src="/upload/115晉安門診表.png"></p>',
    '<section hidden><img src="/upload/115晉安門診表.png"></section><p><img src="/upload/115晉安門診表.png"></p>',
  ]) {
    const html = freshEditorHtml().replace('<p><img src="/upload/115晉安門診表.png"></p>', note);
    assertCode(() => buildSubmitRequest(parseCmsEditorForm(html), '/upload/new.png'), 'FORM_CHANGED');
  }

  const excluded = '<!-- <img src="/upload/115晉安門診表.png"> -->'
    + '<script>const x="/upload/115晉安門診表.png";</script>'
    + '<style>.x{background:url("/upload/115晉安門診表.png")}</style>'
    + '<template><img src="/upload/115晉安門診表.png"></template>';
  const note = `<main>${excluded}<section><img src="/upload/115晉安門診表.png"></section></main>`;
  const html = freshEditorHtml().replace('<p><img src="/upload/115晉安門診表.png"></p>', note);
  assert.equal(
    buildSubmitRequest(parseCmsEditorForm(html), '/upload/new.png').multipartFields.note,
    `<main>${excluded}<section><img src="/upload/new.png"></section></main>`,
  );
});

test('D3. parser decodes supported numeric entities and fails closed on unknown entity tokens', () => {
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
    filename: '115晉安門診表.png',
    contentType: 'image/png',
    byteLength: 3,
    content: Buffer.from('png'),
  });
  assertCode(() => buildUploadRequest({ png: Buffer.from('png'), callbackNumber: -1 }), 'FORM_CHANGED');
  assertCode(() => buildUploadRequest({ png: Buffer.from('png'), callbackNumber: 1.2 }), 'FORM_CHANGED');
});

test('F. response parsers never guess publication success', () => {
  assert.deepEqual(parseUploadResponse({ status: 500, body: 'x' }), { status: 'UPLOAD_FAILED' });
  assert.deepEqual(parseSubmitResponse({ status: 500, body: 'x' }), { status: 'SUBMIT_FAILED' });
  assert.deepEqual(parseUploadResponse({ status: 200, body: 'ok' }), { status: 'CMS_RESPONSE_CONTRACT_UNVERIFIED' });
  assert.deepEqual(parseSubmitResponse({ status: 204, body: '' }), { status: 'CMS_RESPONSE_CONTRACT_UNVERIFIED' });
  assert.notEqual(parseUploadResponse({ status: 200, body: 'published' }).status, 'PUBLISHED');
  assert.notEqual(parseSubmitResponse({ status: 200, body: 'published' }).status, 'PUBLISHED');
});

test('G/H. offline preflight logs in read-only, parses protected editor, prepares only, and sanitizes output', async () => {
  const transport = makeTransport([
    { status: 200, finalUrl: JINAN_CMS_CONFIG.publicUrl, body: '<html>public</html>' },
    { status: 200, finalUrl: JINAN_CMS_CONFIG.loginUrl, body: loginHtml(), setCookie: ['sid=login; Path=/admin; HttpOnly'] },
    { status: 302, finalUrl: JINAN_CMS_CONFIG.editorUrl, body: '', setCookie: ['sid=protected-cookie; Path=/admin; HttpOnly'] },
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
    `GET ${JINAN_CMS_CONFIG.editorUrl}`,
  ]);
  assert.equal(transport.calls.filter((call) => call.method === 'POST').length, 1);
  assert.equal(transport.calls.some((call) => call.url.includes('QuickUpload')), false);

  const json = JSON.stringify(result);
  for (const secret of ['synthetic-user', 'synthetic-password', 'protected-cookie', 'data:image/png', 'SEO title', 'SEO keyword', 'SEO description', '/upload/115晉安門診表.png']) {
    assert.equal(json.includes(secret), false);
  }
});

test('G2. preflight without finalImageUrl completes read-only checks and does not prepare submit', async () => {
  const transport = makeTransport([
    { status: 200, finalUrl: JINAN_CMS_CONFIG.publicUrl, body: '<html>public</html>' },
    { status: 200, finalUrl: JINAN_CMS_CONFIG.loginUrl, body: loginHtml(), setCookie: ['sid=login; Path=/admin; HttpOnly'] },
    { status: 302, finalUrl: JINAN_CMS_CONFIG.editorUrl, body: '', setCookie: ['sid=protected-cookie; Path=/admin; HttpOnly'] },
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
    `GET ${JINAN_CMS_CONFIG.editorUrl}`,
  ]);
  assert.equal(transport.calls.some((call) => call.url.includes('QuickUpload')), false);
});

test('G2b. preflight ingests manual login cookie and lets explicit editor GET prove auth', async () => {
  const transport = makeTransport([
    { status: 200, finalUrl: JINAN_CMS_CONFIG.publicUrl, body: '<html>public</html>' },
    { status: 200, finalUrl: JINAN_CMS_CONFIG.loginUrl, body: loginHtml() },
    {
      status: 302,
      finalUrl: JINAN_CMS_CONFIG.loginUrl,
      body: '',
      location: '/admin/index.php',
      setCookie: ['sid=protected-cookie; Path=/admin; HttpOnly'],
    },
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
    `GET ${JINAN_CMS_CONFIG.editorUrl}`,
  ]);
  assert.equal(transport.calls[3].cookie, 'sid=protected-cookie');
  assert.equal(transport.calls.some((call) => call.url.includes('QuickUpload')), false);
  assert.equal(transport.calls.some((call) => call.method === 'POST' && call.url.includes('op=time&sub=set')), false);
});

test('G2b2. preflight classifies manual editor redirect to login as auth failure', async () => {
  for (const location of ['/admin/login.php', JINAN_CMS_CONFIG.loginUrl]) {
    const transport = makeTransport([
      { status: 200, finalUrl: JINAN_CMS_CONFIG.publicUrl, body: '<html>public</html>' },
      { status: 200, finalUrl: JINAN_CMS_CONFIG.loginUrl, body: loginHtml() },
      {
        status: 302,
        finalUrl: JINAN_CMS_CONFIG.loginUrl,
        body: '',
        location: '/admin/index.php',
        setCookie: ['sid=login-attempt; Path=/admin; HttpOnly'],
      },
      {
        status: 302,
        finalUrl: JINAN_CMS_CONFIG.editorUrl,
        body: '',
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
      `GET ${JINAN_CMS_CONFIG.editorUrl}`,
    ]);
    assert.equal(transport.calls.some((call) => call.url.includes('QuickUpload')), false);
    assert.equal(transport.calls.some((call) => call.method === 'POST' && call.url.includes('op=time&sub=set')), false);
  }
});

test('G2b3. preflight accepts only exact editor 200 without redirect Location as authenticated', async () => {
  const transport = makeTransport([
    { status: 200, finalUrl: JINAN_CMS_CONFIG.publicUrl, body: '<html>public</html>' },
    { status: 200, finalUrl: JINAN_CMS_CONFIG.loginUrl, body: loginHtml() },
    {
      status: 302,
      finalUrl: JINAN_CMS_CONFIG.loginUrl,
      body: '',
      location: '/admin/index.php',
      setCookie: ['sid=protected-cookie; Path=/admin; HttpOnly'],
    },
    { status: 200, finalUrl: JINAN_CMS_CONFIG.editorUrl, body: freshEditorHtml() },
  ]);

  const result = await preflightJinanCmsPublish({
    pngDataUrl: pngDataUrl(),
    finalImageUrl: '/uploads/2026/jinan.png',
    env: { JINAN_CMS_USERNAME: 'synthetic-user', JINAN_CMS_PASSWORD: 'synthetic-password' },
    transport,
  });

  assert.equal(result.status, 'CMS_RESPONSE_CONTRACT_UNVERIFIED');
  assert.equal(transport.calls.length, 4);
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
      { status: 200, finalUrl: JINAN_CMS_CONFIG.publicUrl, body: '<html>public</html>' },
      { status: 200, finalUrl: JINAN_CMS_CONFIG.loginUrl, body: loginHtml() },
      {
        status: 302,
        finalUrl: JINAN_CMS_CONFIG.loginUrl,
        body: '',
        location: '/admin/index.php',
        setCookie: ['sid=protected-cookie; Path=/admin; HttpOnly'],
      },
      editorResponse,
    ]);

    const result = await preflightJinanCmsPublish({
      pngDataUrl: pngDataUrl(),
      finalImageUrl: '/uploads/2026/jinan.png',
      env: { JINAN_CMS_USERNAME: 'synthetic-user', JINAN_CMS_PASSWORD: 'synthetic-password' },
      transport,
    });

    assert.equal(result.status, 'VERIFY_FAILED');
    assert.equal(transport.calls.length, 4);
    assert.equal(transport.calls.some((call) => call.url.includes('QuickUpload')), false);
    assert.equal(transport.calls.some((call) => call.method === 'POST' && call.url.includes('op=time&sub=set')), false);
  }
});

test('G2c. preflight rejects unsafe login POST Location before editor GET', async () => {
  const transport = makeTransport([
    { status: 200, finalUrl: JINAN_CMS_CONFIG.publicUrl, body: '<html>public</html>' },
    { status: 200, finalUrl: JINAN_CMS_CONFIG.loginUrl, body: loginHtml() },
    {
      status: 302,
      finalUrl: JINAN_CMS_CONFIG.loginUrl,
      body: '',
      location: 'https://attacker.example/admin/index.php',
      setCookie: ['sid=protected-cookie; Path=/admin; HttpOnly'],
    },
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
  ]);
});

test('G2d. login POST response validator allows only exact final URLs and safe admin Locations', () => {
  for (const response of [
    { status: 200, finalUrl: JINAN_CMS_CONFIG.loginUrl },
    { status: 302, finalUrl: JINAN_CMS_CONFIG.loginUrl, location: '/admin/index.php' },
    { status: 303, finalUrl: JINAN_CMS_CONFIG.editorUrl, location: JINAN_CMS_CONFIG.editorUrl },
  ]) {
    assert.doesNotThrow(() => validateLoginPostResponse(response));
  }

  for (const response of [
    { status: 401, finalUrl: JINAN_CMS_CONFIG.loginUrl },
    { status: 302, finalUrl: `${JINAN_CMS_CONFIG.loginUrl}?next=1`, location: '/admin/index.php' },
    { status: 302, finalUrl: JINAN_CMS_CONFIG.loginUrl, location: 'https://attacker.example/admin/index.php' },
    { status: 302, finalUrl: JINAN_CMS_CONFIG.loginUrl, location: 'ftp://www.tainanrehab.com/admin/index.php' },
    { status: 302, finalUrl: JINAN_CMS_CONFIG.loginUrl, location: 'http://[::1' },
    { status: 302, finalUrl: JINAN_CMS_CONFIG.loginUrl, location: '/time.html' },
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
    { status: 200, finalUrl: JINAN_CMS_CONFIG.publicUrl, body: '' },
    { status: 200, finalUrl: JINAN_CMS_CONFIG.loginUrl, body: loginHtml() },
    { status: 200, finalUrl: JINAN_CMS_CONFIG.loginUrl, body: '' },
    { status: 200, finalUrl: JINAN_CMS_CONFIG.loginUrl, body: '<form></form>' },
  ]);
  assert.equal((await preflightJinanCmsPublish({
    pngDataUrl: pngDataUrl(),
    finalImageUrl: '/upload/new.png',
    env: { JINAN_CMS_USERNAME: 'u', JINAN_CMS_PASSWORD: 'p' },
    transport: authTransport,
  })).status, 'AUTH_FAILED');

  const publicFailure = makeTransport([new Error('offline')]);
  assert.equal((await preflightJinanCmsPublish({
    pngDataUrl: pngDataUrl(),
    finalImageUrl: '/upload/new.png',
    env: { JINAN_CMS_USERNAME: 'u', JINAN_CMS_PASSWORD: 'p' },
    transport: publicFailure,
  })).status, 'VERIFY_FAILED');

  const formFailure = makeTransport([
    { status: 200, finalUrl: JINAN_CMS_CONFIG.publicUrl, body: '' },
    { status: 200, finalUrl: JINAN_CMS_CONFIG.loginUrl, body: loginHtml() },
    { status: 302, finalUrl: JINAN_CMS_CONFIG.editorUrl, body: '', setCookie: ['sid=x; Path=/admin'] },
    { status: 200, finalUrl: JINAN_CMS_CONFIG.editorUrl, body: '<form name="addAdminFrm"></form>' },
  ]);
  assert.equal((await preflightJinanCmsPublish({
    pngDataUrl: pngDataUrl(),
    finalImageUrl: '/upload/new.png',
    env: { JINAN_CMS_USERNAME: 'u', JINAN_CMS_PASSWORD: 'p' },
    transport: formFailure,
  })).status, 'FORM_CHANGED');
});

test('G4. preflight validates login GET form before sending credentials', async () => {
  const transport = makeTransport([
    { status: 200, finalUrl: JINAN_CMS_CONFIG.publicUrl, body: '' },
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

test('I. pure retry/idempotency and public-current inspection model', () => {
  const attempt = createAttemptRecord('attempt-1');
  assert.deepEqual(attempt, { id: 'attempt-1', uploadedImageUrl: null, status: 'READY_FOR_UPLOAD' });

  const uploaded = markUploadRecorded(attempt, '/uploads/2026/jinan.png');
  assert.equal(uploaded.uploadedImageUrl, '/uploads/2026/jinan.png');
  assertCode(() => markUploadRecorded(uploaded, '/uploads/other.png'), 'FORM_CHANGED');
  assert.deepEqual(planRetry(uploaded), {
    reuseUpload: true,
    requiresFreshEditorGetBeforeSubmit: true,
    uploadUrl: '/uploads/2026/jinan.png',
    modelOnly: true,
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
    '<main style="display/* unterminated"><img src="/uploads/2026/jinan.png"></main>',
    '<main><img style="display/**/: none !important" src="/uploads/2026/jinan.png"></main>',
    '<main><img style="display/* unterminated" src="/uploads/2026/jinan.png"></main>',
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
          get: (name) => (String(name).toLowerCase() === 'location' ? '/admin/index.php' : null),
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
      setCookie: ['sid=protected-cookie; Path=/admin; HttpOnly'],
      location: '/admin/index.php',
    });
  } finally {
    global.fetch = originalFetch;
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
