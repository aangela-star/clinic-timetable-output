const assert = require('node:assert/strict');
const test = require('node:test');

const publisher = require('../website-publisher.js');

test('site configs contain the approved per-clinic contracts', () => {
  assert.deepEqual(publisher.SITE_CONFIGS.jinan, {
    id: 'jinan',
    clinicName: 'Jin-An',
    origin: 'https://www.tainanrehab.com',
    loginPath: '/admin/login.php',
    protectedEditorPath: '/admin/index.php?op=time&sub=set',
    publicVerificationPath: '/time.html',
    clinicPriority: ['jinan', 'yian'],
    credentialRef: 'JINAN_WEBSITE_PUBLISHER_CREDENTIALS',
  });
  assert.deepEqual(publisher.SITE_CONFIGS.yian, {
    id: 'yian',
    clinicName: 'Yi-An',
    origin: 'https://www.ian-tainan.com',
    loginPath: '/admin/login.php',
    protectedEditorPath: '/admin/index.php?op=time&sub=set',
    publicVerificationPath: '/time.html',
    clinicPriority: ['yian', 'jinan'],
    credentialRef: 'YIAN_WEBSITE_PUBLISHER_CREDENTIALS',
  });
});

test('login request builders use GET and an exact form-encoded POST payload', () => {
  const config = publisher.SITE_CONFIGS.jinan;
  assert.deepEqual(publisher.buildLoginPageRequest(config), {
    method: 'GET',
    url: 'https://www.tainanrehab.com/admin/login.php',
  });

  const request = publisher.buildLoginPostRequest(config, {
    username: 'user name',
    password: 'p&ss=word',
  });
  assert.deepEqual(request, {
    method: 'POST',
    url: 'https://www.tainanrehab.com/admin/login.php',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'mode=login&username=user+name&password=p%26ss%3Dword',
  });
});

const loginFormHtml = (overrides = {}) => `
  <form name="${overrides.name ?? 'loginForm'}"${overrides.id === null ? '' : ` id="${overrides.id ?? 'loginForm'}"`}
    action="${overrides.action ?? ''}" method="${overrides.method ?? 'POST'}"${overrides.enctype === null ? '' : ` enctype="${overrides.enctype ?? 'application/x-www-form-urlencoded'}"`}${overrides.onsubmit === undefined ? '' : ` onsubmit="${overrides.onsubmit}"`}>
    ${overrides.controls ?? `
      <input type="hidden" name="mode" value="${overrides.mode ?? 'login'}">
      <input type="text" name="username" id="username" value="private-user">
      <input type="password" name="password" id="password" value="private-password">`}
  </form>`;

test('login parser confirms the safe public contract for both sites without exposing credentials', () => {
  for (const config of Object.values(publisher.SITE_CONFIGS)) {
    const parsed = publisher.parseLoginForm(config, loginFormHtml());
    assert.deepEqual(parsed, {
      form: {
        name: 'loginForm',
        id: 'loginForm',
        action: '',
        actionUrl: `${config.origin}/admin/login.php`,
        method: 'POST',
        enctype: 'application/x-www-form-urlencoded',
      },
      controls: [
        { tag: 'input', type: 'hidden', name: 'mode' },
        { tag: 'input', type: 'text', name: 'username', id: 'username' },
        { tag: 'input', type: 'password', name: 'password', id: 'password' },
      ],
      mode: 'login',
    });
    assert.doesNotMatch(JSON.stringify(parsed), /private-user|private-password/);
  }
});

test('login parser applies the HTML default enctype and permits an absent id', () => {
  const parsed = publisher.parseLoginForm(
    publisher.SITE_CONFIGS.jinan,
    loginFormHtml({ id: null, enctype: null }),
  );
  assert.equal(parsed.form.id, null);
  assert.equal(parsed.form.enctype, 'application/x-www-form-urlencoded');
});

test('login parser rejects malformed forms and unexpected form attributes', () => {
  const config = publisher.SITE_CONFIGS.jinan;
  for (const html of [
    '',
    '<form name="loginForm">',
    loginFormHtml({ name: 'other' }),
    loginFormHtml({ id: 'other' }),
    loginFormHtml({ action: '/admin/login.php' }),
    loginFormHtml({ method: 'GET' }),
    loginFormHtml({ enctype: 'multipart/form-data' }),
    loginFormHtml({ onsubmit: '' }),
  ]) {
    assert.throws(() => publisher.parseLoginForm(config, html), /loginForm/);
  }
});

test('login parser rejects missing, duplicate, extra, or structurally wrong controls', () => {
  const config = publisher.SITE_CONFIGS.yian;
  const valid = [
    '<input type="hidden" name="mode" value="login">',
    '<input type="text" name="username" id="username" value="secret-user">',
    '<input type="password" name="password" id="password" value="secret-password">',
  ];
  const invalidControls = [
    valid.slice(0, 2),
    [...valid, valid[1]],
    [...valid, '<input type="submit" name="Submit">'],
    [valid[0], '<textarea name="username" id="username"></textarea>', valid[2]],
    [valid[0], '<input type="hidden" name="username" id="username">', valid[2]],
    [valid[0], '<input type="text" name="username" id="other">', valid[2]],
    [valid[0], valid[1], '<button name="password" id="password"></button>'],
  ];
  for (const controls of invalidControls) {
    assert.throws(
      () => publisher.parseLoginForm(config, loginFormHtml({ controls: controls.join('') })),
      /named controls/,
    );
  }
  assert.throws(() => publisher.parseLoginForm(config, loginFormHtml({ mode: 'logout' })), /mode/);
});

test('HTTP request execution uses an injected offline transport exactly once', async () => {
  const request = { method: 'GET', url: 'https://offline.invalid/dry-run' };
  const calls = [];
  const fakeTransport = {
    async request(descriptor) {
      calls.push(descriptor);
      return { status: 204, body: '' };
    },
  };

  assert.deepEqual(await publisher.sendHttpRequest(fakeTransport, request), {
    status: 204,
    body: '',
  });
  assert.equal(calls.length, 1);
  assert.strictEqual(calls[0], request);
});

test('cookie jar isolates origins and replaces rotated cookie metadata', () => {
  const jar = publisher.createCookieJar();
  jar.ingest('https://one.example', ['session=first; Path=/; HttpOnly']);
  jar.ingest('https://two.example', ['session=other; Path=/']);
  jar.ingest('https://one.example', ['session=replacement; Path=/admin; Secure']);

  assert.equal(jar.header('https://one.example'), 'session=replacement');
  assert.equal(jar.header('https://two.example'), 'session=other');
  assert.deepEqual(jar.metadata('https://one.example', 'session'), {
    path: '/admin',
    secure: true,
    httpOnly: false,
  });
});

test('same-origin login redirect is unauthenticated', () => {
  assert.equal(publisher.detectAuthenticatedState({
    config: publisher.SITE_CONFIGS.jinan,
    finalUrl: 'https://www.tainanrehab.com/admin/login.php?next=time',
    html: '',
  }), 'unauthenticated');
});

test('editor form and note markers identify an authenticated page', () => {
  assert.equal(publisher.detectAuthenticatedState({
    config: publisher.SITE_CONFIGS.jinan,
    finalUrl: 'https://www.tainanrehab.com/admin/index.php?op=time&sub=set',
    html: '<form name="addAdminFrm" id="addAdminFrm"><textarea name="note"></textarea></form>',
  }), 'authenticated');
});

test('id-only editor form marker is unknown', () => {
  assert.equal(publisher.detectAuthenticatedState({
    config: publisher.SITE_CONFIGS.jinan,
    finalUrl: 'https://www.tainanrehab.com/admin/index.php?op=time&sub=set',
    html: '<form id="addAdminFrm"><textarea name="note"></textarea></form>',
  }), 'unknown');
});

test('editor markers are not trusted on another origin or unrelated same-origin URL', () => {
  const html = '<form name="addAdminFrm"><textarea name="note"></textarea></form>';
  for (const finalUrl of [
    'https://attacker.example/admin/index.php?op=time&sub=set',
    'https://www.tainanrehab.com/admin/elsewhere.php',
    'https://www.tainanrehab.com/admin/index.php?op=time',
    'https://www.tainanrehab.com/admin/index.php?op=time&sub=other',
  ]) {
    assert.equal(publisher.detectAuthenticatedState({
      config: publisher.SITE_CONFIGS.jinan,
      finalUrl,
      html,
    }), 'unknown');
  }
});

test('unknown redirects and incomplete pages remain unknown', () => {
  assert.equal(publisher.detectAuthenticatedState({
    config: publisher.SITE_CONFIGS.jinan,
    finalUrl: 'https://www.tainanrehab.com/admin/elsewhere.php',
    html: '<form id="addAdminFrm"></form>',
  }), 'unknown');
  assert.equal(publisher.detectAuthenticatedState({
    config: publisher.SITE_CONFIGS.jinan,
    finalUrl: 'https://other.example/admin/login.php',
    html: '',
  }), 'unknown');
});

test('QuickUpload builder carries a dynamic callback number and upload field contract', () => {
  const request = publisher.buildQuickUploadRequest(publisher.SITE_CONFIGS.yian, 37);
  assert.deepEqual(request, {
    method: 'POST',
    url: 'https://www.ian-tainan.com/scripts/ckfinder/core/connector/php/connector.php?command=QuickUpload&type=Images&CKEditor=note&CKEditorFuncNum=37&langCode=zh',
    multipartFieldName: 'upload',
  });
  assert.match(request.url, /CKEditorFuncNum=37/);
  assert.doesNotMatch(request.url, /CKEditorFuncNum=0(?:&|$)/);
});

test('QuickUpload accepts callback number zero without hardcoding it', () => {
  const callbackNumber = 0;
  const request = publisher.buildQuickUploadRequest(publisher.SITE_CONFIGS.jinan, callbackNumber);
  assert.equal(new URL(request.url).searchParams.get('CKEditorFuncNum'), String(callbackNumber));
  assert.deepEqual(publisher.parseQuickUploadCallback(
    `window.parent.CKEDITOR.tools.callFunction(${callbackNumber}, '/uploads/zero.png', '');`,
    callbackNumber,
  ), { callbackNumber, relativeUrl: '/uploads/zero.png', message: '' });
});

test('QuickUpload rejects negative and non-integer callback numbers', () => {
  for (const callbackNumber of [-1, 1.5]) {
    assert.throws(() => publisher.buildQuickUploadRequest(
      publisher.SITE_CONFIGS.jinan,
      callbackNumber,
    ), /non-negative integer/);
    assert.throws(() => publisher.parseQuickUploadCallback(
      "window.parent.CKEDITOR.tools.callFunction(1, '/uploads/image.png', '');",
      callbackNumber,
    ), /non-negative integer/);
  }
});

test('classic QuickUpload callback returns its actual relative URL and message', () => {
  assert.deepEqual(publisher.parseQuickUploadCallback(
    "<script>window.parent.CKEDITOR.tools.callFunction(37, '/uploads/2026/clinic.png', 'uploaded');</script>",
    37,
  ), { callbackNumber: 37, relativeUrl: '/uploads/2026/clinic.png', message: 'uploaded' });
});

test('QuickUpload callback supports an empty message', () => {
  assert.deepEqual(publisher.parseQuickUploadCallback(
    "window.parent.CKEDITOR.tools.callFunction(8, '/uploads/image.png', '');",
    8,
  ), { callbackNumber: 8, relativeUrl: '/uploads/image.png', message: '' });
});

test('malformed or mismatched QuickUpload callbacks are rejected', () => {
  assert.throws(() => publisher.parseQuickUploadCallback('not a callback', 4), /Malformed/);
  assert.throws(() => publisher.parseQuickUploadCallback(
    "window.parent.CKEDITOR.tools.callFunction(5, '/uploads/image.png', '');",
    4,
  ), /callback number/);
  assert.throws(() => publisher.parseQuickUploadCallback(
    "window.parent.CKEDITOR.tools.callFunction(4, 'https://other.example/image.png', '');",
    4,
  ), /relative URL/);
});

test('CMS editor parser validates the exact form contract and extracts editable values', () => {
  const config = publisher.SITE_CONFIGS.jinan;
  const html = `
    <form name="addAdminFrm" id="addAdminFrm" action="" method="POST" enctype="multipart/form-data">
      <input type="hidden" name="mode" value="edit">
      <textarea id="note_92831" name="note">&lt;p&gt;September&lt;/p&gt;</textarea>
      <input type="text" name="wtitle" value="Clinic &amp; Schedule">
      <input type="text" name="wkeyword" value="rehab, timetable">
      <textarea name="wdescription">Monthly &amp; current</textarea>
      <input type="submit" name="Submit" value="送出">
      <input id="cke_92831" value="dynamic but unnamed">
    </form>`;

  assert.deepEqual(publisher.parseCmsEditorForm(config, html), {
    mode: 'edit',
    note: '<p>September</p>',
    wtitle: 'Clinic & Schedule',
    wkeyword: 'rehab, timetable',
    wdescription: 'Monthly & current',
  });
});

test('CMS editor parser rejects invalid form contracts and extra named controls', () => {
  const config = publisher.SITE_CONFIGS.jinan;
  const controls = '<input type="hidden" name="mode" value="edit"><textarea name="note"></textarea><input type="text" name="wtitle"><input type="text" name="wkeyword"><textarea name="wdescription"></textarea><input type="submit" name="Submit" value="send">';
  assert.throws(() => publisher.parseCmsEditorForm(config, `<form name="addAdminFrm" action="/save" method="POST" enctype="multipart/form-data">${controls}</form>`), /contract/);
  assert.throws(() => publisher.parseCmsEditorForm(config, `<form name="addAdminFrm" action="" method="POST" enctype="multipart/form-data">${controls}<input name="extra"></form>`), /named controls/);
  assert.throws(() => publisher.parseCmsEditorForm(config, `<form id="addAdminFrm" action="" method="POST" enctype="multipart/form-data">${controls}</form>`), /contract/);
});

test('CMS editor parser accepts equivalent current-editor actions and normalized method/enctype', () => {
  const config = publisher.SITE_CONFIGS.jinan;
  const controls = '<input type="hidden" name="mode" value="edit"><textarea name="note"></textarea><input type="text" name="wtitle"><input type="text" name="wkeyword"><textarea name="wdescription"></textarea><input type="submit" name="Submit" value="send">';
  const currentUrl = new URL(config.protectedEditorPath, config.origin).href;
  for (const action of [null, '', config.protectedEditorPath, currentUrl]) {
    const actionAttribute = action === null ? '' : ` action="${action.replaceAll('&', '&amp;')}"`;
    assert.equal(publisher.parseCmsEditorForm(config, `<form name="addAdminFrm"${actionAttribute} method="  pOsT " enctype=" Multipart/Form-Data ">${controls}</form>`).mode, 'edit');
  }
});

test('CMS editor parser rejects GET, wrong endpoint, and cross-origin actions', () => {
  const config = publisher.SITE_CONFIGS.jinan;
  const controls = '<input type="hidden" name="mode" value="edit"><textarea name="note"></textarea><input type="text" name="wtitle"><input type="text" name="wkeyword"><textarea name="wdescription"></textarea><input type="submit" name="Submit" value="send">';
  for (const [method, action] of [
    ['GET', ''],
    ['POST', '/admin/save.php'],
    ['POST', 'https://attacker.example/admin/index.php?op=time&sub=set'],
  ]) {
    assert.throws(() => publisher.parseCmsEditorForm(config, `<form name="addAdminFrm" action="${action.replaceAll('&', '&amp;')}" method="${method}" enctype="multipart/form-data">${controls}</form>`), /contract/);
  }
});

test('CMS editor parser enforces each approved tag, type, name, and mode contract', () => {
  const config = publisher.SITE_CONFIGS.jinan;
  const validControls = [
    '<input type="hidden" name="mode" value="edit">',
    '<textarea name="note"></textarea>',
    '<input type="text" name="wtitle">',
    '<input type="text" name="wkeyword">',
    '<textarea name="wdescription"></textarea>',
    '<input type="submit" name="Submit" value="send">',
  ];
  const form = (controls) => `<form name="addAdminFrm" action="" method="POST" enctype="multipart/form-data">${controls.join('')}</form>`;

  const wrongTag = [...validControls];
  wrongTag[1] = '<input type="text" name="note">';
  assert.throws(() => publisher.parseCmsEditorForm(config, form(wrongTag)), /named controls/);

  const wrongType = [...validControls];
  wrongType[2] = '<input type="hidden" name="wtitle">';
  assert.throws(() => publisher.parseCmsEditorForm(config, form(wrongType)), /named controls/);

  const duplicate = [...validControls, validControls[1]];
  assert.throws(() => publisher.parseCmsEditorForm(config, form(duplicate)), /named controls/);
  assert.throws(() => publisher.parseCmsEditorForm(config, form(validControls.slice(0, -1))), /named controls/);

  const wrongMode = [...validControls];
  wrongMode[0] = '<input type="hidden" name="mode" value="create">';
  assert.throws(() => publisher.parseCmsEditorForm(config, form(wrongMode)), /mode/);
});

test('main form builder returns exactly the approved fields and preserves caller content', () => {
  assert.deepEqual(publisher.buildMainFormPayload({
    note: '<p>caller supplied</p>',
    wtitle: 'Title',
    wkeyword: 'keywords',
    wdescription: 'Description',
  }), {
    mode: 'edit',
    note: '<p>caller supplied</p>',
    wtitle: 'Title',
    wkeyword: 'keywords',
    wdescription: 'Description',
    Submit: '送出',
  });
});

test('main form builder never permits workflow constants to be overridden', () => {
  assert.deepEqual(publisher.buildMainFormPayload({
    mode: 'delete',
    note: 'note',
    wtitle: 'title',
    wkeyword: 'keyword',
    wdescription: 'description',
    Submit: 'Delete everything',
    extra: 'not allowed',
  }), {
    mode: 'edit',
    note: 'note',
    wtitle: 'title',
    wkeyword: 'keyword',
    wdescription: 'description',
    Submit: '送出',
  });
});

const publicHtml = `
  <main><h1>2026 年 9 月門診時間</h1>
    <img src="/uploads/jinan-september.png">
    <img src='/uploads/yian-september.png'>
  </main>`;

test('public verification finds caller-specified month and expected relative images', () => {
  const result = publisher.verifyPublicPage({
    config: publisher.SITE_CONFIGS.jinan,
    html: publicHtml,
    monthText: '2026 年 9 月',
    imageUrlsByClinic: {
      jinan: '/uploads/jinan-september.png',
      yian: '/uploads/yian-september.png',
    },
  });
  assert.equal(result.monthFound, true);
  assert.deepEqual(result.missingImageUrls, []);
  assert.equal(result.imagesInExpectedOrder, true);
  assert.equal(result.verified, true);
});

test('public verification reports missing images and incorrect ordering', () => {
  const missing = publisher.verifyPublicPage({
    config: publisher.SITE_CONFIGS.jinan,
    html: '<p>September</p><img src="/uploads/jinan.png">',
    monthText: 'September',
    imageUrlsByClinic: { jinan: '/uploads/jinan.png', yian: '/uploads/yian.png' },
  });
  assert.deepEqual(missing.missingImageUrls, ['/uploads/yian.png']);
  assert.equal(missing.verified, false);

  const reversed = publisher.verifyPublicPage({
    config: publisher.SITE_CONFIGS.jinan,
    html: '<p>September</p><img src="/uploads/yian.png"><img src="/uploads/jinan.png">',
    monthText: 'September',
    imageUrlsByClinic: { jinan: '/uploads/jinan.png', yian: '/uploads/yian.png' },
  });
  assert.equal(reversed.imagesInExpectedOrder, false);
  assert.equal(reversed.verified, false);
});

test('public verification ignores month text in comments, scripts, and templates', () => {
  const images = '<img src="/uploads/jinan.png"><img src="/uploads/yian.png">';
  for (const hiddenMonth of [
    '<!-- September -->',
    '<script>const month = "September";</script>',
    '<template><p>September</p></template>',
  ]) {
    const result = publisher.verifyPublicPage({
      config: publisher.SITE_CONFIGS.jinan,
      html: `${hiddenMonth}${images}`,
      monthText: 'September',
      imageUrlsByClinic: { jinan: '/uploads/jinan.png', yian: '/uploads/yian.png' },
    });
    assert.equal(result.monthFound, false);
    assert.equal(result.verified, false);
  }
});

test('public verification accepts images only from included actual img elements', () => {
  for (const hiddenImages of [
    '<!-- <img src="/uploads/jinan.png"><img src="/uploads/yian.png"> -->',
    '<script>const images = `<img src="/uploads/jinan.png"><img src="/uploads/yian.png">`;</script>',
    '<template><img src="/uploads/jinan.png"><img src="/uploads/yian.png"></template>',
  ]) {
    const result = publisher.verifyPublicPage({
      config: publisher.SITE_CONFIGS.jinan,
      html: `<p>September</p>${hiddenImages}`,
      monthText: 'September',
      imageUrlsByClinic: { jinan: '/uploads/jinan.png', yian: '/uploads/yian.png' },
    });
    assert.deepEqual(result.missingImageUrls, ['/uploads/jinan.png', '/uploads/yian.png']);
    assert.equal(result.verified, false);
  }
});

test('hidden stale content cannot satisfy image existence or ordering', () => {
  for (const hiddenOpening of [
    '<section hidden>',
    '<section aria-hidden="true">',
    '<section style=" color:red; DISPLAY: none ">',
    '<section style="visibility: hidden">',
  ]) {
    const result = publisher.verifyPublicPage({
      config: publisher.SITE_CONFIGS.jinan,
      html: `<p>September</p>${hiddenOpening}<img src="/uploads/jinan.png"></section><img src="/uploads/yian.png"><img src="/uploads/jinan.png">`,
      monthText: 'September',
      imageUrlsByClinic: { jinan: '/uploads/jinan.png', yian: '/uploads/yian.png' },
    });
    assert.equal(result.imagesInExpectedOrder, false);
    assert.equal(result.verified, false);
  }
});

test('public verification still accepts normal actual img order', () => {
  const result = publisher.verifyPublicPage({
    config: publisher.SITE_CONFIGS.jinan,
    html: '<main><p>September</p><img src="/uploads/jinan.png"><img src="/uploads/yian.png"></main>',
    monthText: 'September',
    imageUrlsByClinic: { jinan: '/uploads/jinan.png', yian: '/uploads/yian.png' },
  });
  assert.equal(result.verified, true);
});

test('clinic image priority comes from each site config', () => {
  const images = {
    jinan: '/uploads/jinan-september.png',
    yian: '/uploads/yian-september.png',
  };
  const jinanResult = publisher.verifyPublicPage({
    config: publisher.SITE_CONFIGS.jinan,
    html: publicHtml,
    monthText: '2026 年 9 月',
    imageUrlsByClinic: images,
  });
  const yianResult = publisher.verifyPublicPage({
    config: publisher.SITE_CONFIGS.yian,
    html: publicHtml,
    monthText: '2026 年 9 月',
    imageUrlsByClinic: images,
  });
  assert.deepEqual(jinanResult.expectedImageUrls, [images.jinan, images.yian]);
  assert.deepEqual(yianResult.expectedImageUrls, [images.yian, images.jinan]);
  assert.equal(jinanResult.imagesInExpectedOrder, true);
  assert.equal(yianResult.imagesInExpectedOrder, false);
});

test('publisher classifier returns success only for confirmed CMS plus verified public state', () => {
  assert.deepEqual(publisher.classifyPublisherResult({ cmsState: 'confirmed' }), {
    status: 'uncertain',
    requiresPublicVerification: true,
  });
  assert.deepEqual(publisher.classifyPublisherResult({ cmsState: 'failed' }), {
    status: 'failed',
    requiresPublicVerification: false,
  });
  assert.deepEqual(publisher.classifyPublisherResult({ cmsState: 'ambiguous' }), {
    status: 'uncertain',
    requiresPublicVerification: true,
  });
  assert.deepEqual(publisher.classifyPublisherResult({
    cmsState: 'confirmed',
    publicVerification: { verified: true },
  }), { status: 'success', requiresPublicVerification: false });
  assert.deepEqual(publisher.classifyPublisherResult({
    cmsState: 'ambiguous',
    publicVerification: { verified: false },
  }), { status: 'uncertain', requiresPublicVerification: true });
  assert.deepEqual(publisher.classifyPublisherResult({
    cmsState: 'unexpected-new-state',
    publicVerification: { verified: true },
  }), { status: 'uncertain', requiresPublicVerification: true });
});

test('unknown CMS redirect is never direct success', () => {
  assert.deepEqual(publisher.classifyPublisherResult({ cmsState: 'unknown-redirect' }), {
    status: 'uncertain',
    requiresPublicVerification: true,
  });
  assert.deepEqual(publisher.classifyPublisherResult({
    cmsState: 'unknown-redirect',
    publicVerification: { verified: true },
  }), { status: 'uncertain', requiresPublicVerification: true });
});
