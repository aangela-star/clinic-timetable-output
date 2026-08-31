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
  const jar = publisher.createCookieJar({ now: () => Date.UTC(2026, 8, 1) });
  jar.ingest('https://one.example/admin/login.php', ['session=first; Path=/; HttpOnly']);
  jar.ingest('https://two.example/admin/login.php', ['session=other; Path=/']);
  jar.ingest('https://one.example/admin/login.php', ['session=replacement; Path=/admin; Secure']);

  assert.equal(jar.header('https://one.example/admin/index.php'), 'session=replacement; session=first');
  assert.equal(jar.header('https://two.example/admin/index.php'), 'session=other');
  assert.deepEqual(jar.metadata('https://one.example', 'session'), {
    path: '/',
    secure: false,
    httpOnly: true,
  });
  assert.deepEqual(jar.metadata('https://one.example', 'session', '/admin'), {
    path: '/admin',
    secure: true,
    httpOnly: false,
  });
});

test('cookie jar matches RFC-style paths and never sends admin session to public time page', () => {
  const jar = publisher.createCookieJar({ now: () => Date.UTC(2026, 8, 1) });
  jar.ingest('https://www.tainanrehab.com/admin/login.php', ['admin_session=abc; Path=/admin; HttpOnly']);

  assert.equal(jar.header('https://www.tainanrehab.com/admin'), 'admin_session=abc');
  assert.equal(jar.header('https://www.tainanrehab.com/admin/index.php'), 'admin_session=abc');
  assert.equal(jar.header('https://www.tainanrehab.com/administrator'), '');
  assert.equal(jar.header('https://www.tainanrehab.com/time.html'), '');
});

test('cookie jar applies secure, expiration, deletion, replacement, and path ordering', () => {
  let currentTime = Date.UTC(2026, 8, 1);
  const jar = publisher.createCookieJar({ now: () => currentTime });

  jar.ingest('https://www.tainanrehab.com/admin/login.php', [
    'prefs=root; Path=/; Max-Age=3600',
    'prefs=admin; Path=/admin',
    'secure_id=s1; Path=/admin; Secure',
    'gone=now; Path=/admin; Max-Age=0',
    'old=stale; Path=/admin; Expires=Tue, 01 Sep 2020 00:00:00 GMT',
  ]);

  assert.equal(
    jar.header('https://www.tainanrehab.com/admin/index.php'),
    'prefs=admin; secure_id=s1; prefs=root',
  );
  assert.equal(
    jar.header('https://www.tainanrehab.com/admin/index.php'.replace('https:', 'http:')),
    'prefs=admin; prefs=root',
  );
  assert.equal(
    jar.header('https://www.tainanrehab.com/admin/index.php'),
    'prefs=admin; secure_id=s1; prefs=root',
  );

  jar.ingest('https://www.tainanrehab.com/admin/login.php', ['prefs=rotated; Path=/admin']);
  assert.equal(
    jar.header('https://www.tainanrehab.com/admin/index.php'),
    'prefs=rotated; secure_id=s1; prefs=root',
  );

  currentTime += 3601 * 1000;
  assert.equal(jar.header('https://www.tainanrehab.com/admin/index.php'), 'prefs=rotated; secure_id=s1');
});

test('cookie jar filters Secure cookies on the same HTTP origin', () => {
  const jar = publisher.createCookieJar({ now: () => Date.UTC(2026, 8, 1) });
  jar.ingest('http://www.tainanrehab.com/admin/login.php', [
    'plain_id=p1; Path=/admin',
    'secure_id=s1; Path=/admin; Secure',
  ]);

  assert.equal(jar.header('http://www.tainanrehab.com/admin/index.php'), 'plain_id=p1');
});

test('cookie jar sends non-secure same-host cookies across schemes while filtering Secure', () => {
  const jar = publisher.createCookieJar({ now: () => Date.UTC(2026, 8, 1) });
  jar.ingest('https://www.tainanrehab.com/admin/login.php', [
    'plain_id=p1; Path=/admin',
    'secure_id=s1; Path=/admin; Secure',
  ]);

  assert.equal(jar.header('http://www.tainanrehab.com/admin/index.php'), 'plain_id=p1');
  assert.equal(jar.header('https://www.tainanrehab.com/admin/index.php'), 'plain_id=p1; secure_id=s1');
});

test('cookie jar evaluates Expires when Max-Age grammar is invalid', () => {
  const expired = 'Tue, 01 Sep 2020 00:00:00 GMT';
  const cases = [
    'abc',
    '',
    '0x10',
    '1.5',
  ];
  for (const maxAge of cases) {
    const jar = publisher.createCookieJar({ now: () => Date.UTC(2026, 8, 1) });
    jar.ingest('https://www.tainanrehab.com/admin/login.php', ['session=valid; Path=/admin']);
    jar.ingest('https://www.tainanrehab.com/admin/login.php', [
      `session=expired; Path=/admin; Max-Age=${maxAge}; Expires=${expired}`,
    ]);
    assert.equal(jar.header('https://www.tainanrehab.com/admin/index.php'), '');
  }
});

test('cookie jar applies request default paths and preserves same-name path ordering', () => {
  const jar = publisher.createCookieJar({ now: () => Date.UTC(2026, 8, 1) });
  jar.ingest('https://www.tainanrehab.com/admin/login.php', ['sid=admin-default']);
  jar.ingest('https://www.tainanrehab.com/admin/reports/', ['sid=reports-default']);
  jar.ingest('https://www.tainanrehab.com/admin', ['sid=root-default']);

  assert.equal(
    jar.header('https://www.tainanrehab.com/admin/reports/view.php'),
    'sid=reports-default; sid=admin-default; sid=root-default',
  );
  assert.equal(
    jar.header('https://www.tainanrehab.com/admin/index.php'),
    'sid=admin-default; sid=root-default',
  );
});

test('cookie jar deletes by expiry and ignores invalid or insecure Secure set requests', () => {
  const jar = publisher.createCookieJar({ now: () => Date.UTC(2026, 8, 1) });
  jar.ingest('https://www.tainanrehab.com/admin/login.php', [
    'plain_id=p1; Path=/admin',
    'secure_id=s1; Path=/admin; Secure',
    'expired=e1; Path=/admin',
  ]);
  jar.ingest('https://www.tainanrehab.com/admin/login.php', [
    'expired=gone; Path=/admin; Expires=Tue, 01 Sep 2020 00:00:00 GMT',
  ]);
  jar.ingest('http://www.tainanrehab.com/admin/login.php', ['http_secure=bad; Path=/admin; Secure']);
  jar.ingest('ftp://www.tainanrehab.com/admin/login.php', ['ftp_id=bad; Path=/admin']);

  assert.equal(
    jar.header('https://www.tainanrehab.com/admin/index.php'),
    'plain_id=p1; secure_id=s1',
  );
  assert.equal(jar.header('ftp://www.tainanrehab.com/admin/index.php'), '');
  assert.equal(jar.header('not a url'), '');
});

test('cookie jar keeps scheme-shared host scope but isolates hosts', () => {
  const jar = publisher.createCookieJar({ now: () => Date.UTC(2026, 8, 1) });
  jar.ingest('https://www.tainanrehab.com/admin/login.php', ['session=site; Path=/admin']);
  jar.ingest('https://sub.tainanrehab.com/admin/login.php', ['session=sub; Path=/admin']);

  assert.equal(jar.header('http://www.tainanrehab.com/admin/index.php'), 'session=site');
  assert.equal(jar.header('https://www.tainanrehab.com/admin/index.php'), 'session=site');
  assert.equal(jar.header('https://sub.tainanrehab.com/admin/index.php'), 'session=sub');
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
    publisher.SITE_CONFIGS.jinan,
    `window.parent.CKEDITOR.tools.callFunction(${callbackNumber}, '/uploads/zero.png', '');`,
    callbackNumber,
  ), {
    callbackNumber,
    relativeUrl: '/uploads/zero.png',
    canonicalUrl: 'https://www.tainanrehab.com/uploads/zero.png',
    message: '',
  });
});

test('QuickUpload rejects negative and non-integer callback numbers', () => {
  for (const callbackNumber of [-1, 1.5]) {
    assert.throws(() => publisher.buildQuickUploadRequest(
      publisher.SITE_CONFIGS.jinan,
      callbackNumber,
    ), /non-negative integer/);
    assert.throws(() => publisher.parseQuickUploadCallback(
      publisher.SITE_CONFIGS.jinan,
      "window.parent.CKEDITOR.tools.callFunction(1, '/uploads/image.png', '');",
      callbackNumber,
    ), /non-negative integer/);
  }
});

test('classic QuickUpload callback returns its actual relative URL and message', () => {
  assert.deepEqual(publisher.parseQuickUploadCallback(
    publisher.SITE_CONFIGS.jinan,
    "<script>window.parent.CKEDITOR.tools.callFunction(37, '/uploads/2026/clinic.png', 'uploaded');</script>",
    37,
  ), {
    callbackNumber: 37,
    relativeUrl: '/uploads/2026/clinic.png',
    canonicalUrl: 'https://www.tainanrehab.com/uploads/2026/clinic.png',
    message: 'uploaded',
  });
});

test('QuickUpload callback accepts only the exact bare or simple script response contract', () => {
  for (const html of [
    "xwindow.parent.CKEDITOR.tools.callFunction(4, '/uploads/image.png', '');",
    "window.parent.CKEDITOR.tools.callFunction(4, '/uploads/image.png', '');x",
    "'window.parent.CKEDITOR.tools.callFunction(4, \\'/uploads/image.png\\', \\'\\');'",
    '"window.parent.CKEDITOR.tools.callFunction(4, \'/uploads/image.png\', \'\');"',
    "<!-- window.parent.CKEDITOR.tools.callFunction(4, '/uploads/image.png', ''); -->",
    "// window.parent.CKEDITOR.tools.callFunction(4, '/uploads/image.png', '');",
    "/* window.parent.CKEDITOR.tools.callFunction(4, '/uploads/image.png', ''); */",
    "<script>// window.parent.CKEDITOR.tools.callFunction(4, '/uploads/image.png', '');</script>",
    "<script>/* window.parent.CKEDITOR.tools.callFunction(4, '/uploads/image.png', ''); */</script>",
    "<script>window.parent.CKEDITOR.tools.callFunction(4, '/uploads/image.png', '');alert(1);</script>",
    "<script>window.parent.CKEDITOR.tools.callFunction(4, '/uploads/one.png', '');</script><script>window.parent.CKEDITOR.tools.callFunction(4, '/uploads/two.png', '');</script>",
    "window.parent.CKEDITOR.tools.callFunction(4, '/uploads/one.png', ''); window.parent.CKEDITOR.tools.callFunction(4, '/uploads/two.png', '');",
  ]) {
    assert.throws(() => publisher.parseQuickUploadCallback(
      publisher.SITE_CONFIGS.jinan,
      html,
      4,
    ), /callback/);
  }
});

test('QuickUpload callback supports an empty message', () => {
  assert.deepEqual(publisher.parseQuickUploadCallback(
    publisher.SITE_CONFIGS.jinan,
    "window.parent.CKEDITOR.tools.callFunction(8, '/uploads/image.png', '');",
    8,
  ), {
    callbackNumber: 8,
    relativeUrl: '/uploads/image.png',
    canonicalUrl: 'https://www.tainanrehab.com/uploads/image.png',
    message: '',
  });
});

test('malformed or mismatched QuickUpload callbacks are rejected', () => {
  assert.throws(() => publisher.parseQuickUploadCallback(
    publisher.SITE_CONFIGS.jinan,
    'not a callback',
    4,
  ), /Malformed/);
  assert.throws(() => publisher.parseQuickUploadCallback(
    publisher.SITE_CONFIGS.jinan,
    "window.parent.CKEDITOR.tools.callFunction(5, '/uploads/image.png', '');",
    4,
  ), /callback number/);
  assert.throws(() => publisher.parseQuickUploadCallback(
    publisher.SITE_CONFIGS.jinan,
    "window.parent.CKEDITOR.tools.callFunction(4, 'https://other.example/image.png', '');",
    4,
  ), /same-origin/);
});

test('QuickUpload callback accepts only safe same-origin root-relative upload paths', () => {
  assert.deepEqual(publisher.parseQuickUploadCallback(
    publisher.SITE_CONFIGS.jinan,
    "window.parent.CKEDITOR.tools.callFunction(4, '/upload/x%20file.png', 'ok');",
    4,
  ), {
    callbackNumber: 4,
    relativeUrl: '/upload/x%20file.png',
    canonicalUrl: 'https://www.tainanrehab.com/upload/x%20file.png',
    message: 'ok',
  });

  for (const unsafeUrl of [
    'https://other.example/upload/x.png',
    '//other.example/upload/x.png',
    '/\\attacker',
    '\\upload\\x.png',
    '/upload\\x.png',
    '/uploads/%5cattacker/x.png',
    '/uploads/%5Cattacker/x.png',
    '/uploads/%2f%2fattacker.example/x.png',
    '/uploads/../admin/x.png',
    '/upload/../admin/x.png',
    '/uploads/%2e%2e/admin/x.png',
    'javascript:alert(1)',
    'data:text/plain,hi',
  ]) {
    assert.throws(() => publisher.parseQuickUploadCallback(
      publisher.SITE_CONFIGS.jinan,
      `window.parent.CKEDITOR.tools.callFunction(4, '${unsafeUrl.replaceAll('\\', '\\\\')}', '');`,
      4,
    ), /QuickUpload callback URL/);
  }
});

test('QuickUpload callback rejects canonical origin mismatch after URL resolution', () => {
  assert.throws(() => publisher.parseQuickUploadCallback(
    publisher.SITE_CONFIGS.jinan,
    "window.parent.CKEDITOR.tools.callFunction(4, 'https://www.tainanrehab.com:444/upload/x.png', '');",
    4,
  ), /same-origin/);
});

test('QuickUpload callback rejects paths that canonicalize outside uploads', () => {
  assert.throws(() => publisher.parseQuickUploadCallback(
    publisher.SITE_CONFIGS.jinan,
    "window.parent.CKEDITOR.tools.callFunction(4, '/uploads/./../admin/image.png', '');",
    4,
  ), /QuickUpload callback URL/);
});

test('QuickUpload callback requires one syntactically bounded callback payload', () => {
  for (const html of [
    "xwindow.parent.CKEDITOR.tools.callFunction(4, '/uploads/image.png', '');",
    "'window.parent.CKEDITOR.tools.callFunction(4, \\'/uploads/image.png\\', \\'\\');'",
    "<!-- window.parent.CKEDITOR.tools.callFunction(4, '/uploads/image.png', ''); -->",
    "// window.parent.CKEDITOR.tools.callFunction(4, '/uploads/image.png', '');",
    "/* window.parent.CKEDITOR.tools.callFunction(4, '/uploads/image.png', ''); */",
    "window.parent.CKEDITOR.tools.callFunction(4, '/uploads/one.png', ''); window.parent.CKEDITOR.tools.callFunction(4, '/uploads/two.png', '');",
    "<script>window.parent.CKEDITOR.tools.callFunction(4, '/uploads/one.png', '');</script><script>window.parent.CKEDITOR.tools.callFunction(4, '/uploads/one.png', '');</script>",
  ]) {
    assert.throws(() => publisher.parseQuickUploadCallback(
      publisher.SITE_CONFIGS.jinan,
      html,
      4,
    ), /callback/);
  }
});

test('QuickUpload callback rejects nested encoding, controls, and absolute same-origin URLs', () => {
  for (const unsafeUrl of [
    'https://www.tainanrehab.com/upload/image.png',
    '/uploads/%252e%252e%252fadmin/image.png',
    '/uploads/%252fadmin/image.png',
    '/uploads/%255cadmin/image.png',
    '/uploads/%250aimage.png',
    '/uploads/%25%32%65%25%32%65%25%32%66admin/image.png',
    '/uploads/%00image.png',
  ]) {
    assert.throws(() => publisher.parseQuickUploadCallback(
      publisher.SITE_CONFIGS.jinan,
      `window.parent.CKEDITOR.tools.callFunction(4, '${unsafeUrl}', '');`,
      4,
    ), /QuickUpload callback URL/);
  }
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

const publicResponse = (html, overrides = {}) => ({
  status: overrides.status ?? 200,
  finalUrl: overrides.finalUrl ?? 'https://www.tainanrehab.com/time.html',
  html,
});

const publicHtml = `
  <main data-public-visible="clinic-timetable"><h1>2026 年 9 月門診時間</h1>
    <img src="/uploads/jinan-september.png">
    <img src='/uploads/yian-september.png'>
  </main>`;

test('public verification finds caller-specified month and expected relative images', () => {
  const result = publisher.verifyPublicPage({
    config: publisher.SITE_CONFIGS.jinan,
    response: publicResponse(publicHtml),
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
    response: publicResponse('<main data-public-visible="clinic-timetable"><p>September</p><img src="/uploads/jinan.png"></main>'),
    monthText: 'September',
    imageUrlsByClinic: { jinan: '/uploads/jinan.png', yian: '/uploads/yian.png' },
  });
  assert.deepEqual(missing.missingImageUrls, ['/uploads/yian.png']);
  assert.equal(missing.verified, false);

  const reversed = publisher.verifyPublicPage({
    config: publisher.SITE_CONFIGS.jinan,
    response: publicResponse('<main data-public-visible="clinic-timetable"><p>September</p><img src="/uploads/yian.png"><img src="/uploads/jinan.png"></main>'),
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
      response: publicResponse(`<main data-public-visible="clinic-timetable">${hiddenMonth}${images}</main>`),
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
      response: publicResponse(`<main data-public-visible="clinic-timetable"><p>September</p>${hiddenImages}</main>`),
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
      response: publicResponse(`<main data-public-visible="clinic-timetable"><p>September</p>${hiddenOpening}<img src="/uploads/jinan.png"></section><img src="/uploads/yian.png"><img src="/uploads/jinan.png"></main>`),
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
    response: publicResponse('<main data-public-visible="clinic-timetable"><p>September</p><img src="/uploads/jinan.png"><img src="/uploads/yian.png"></main>'),
    monthText: 'September',
    imageUrlsByClinic: { jinan: '/uploads/jinan.png', yian: '/uploads/yian.png' },
  });
  assert.equal(result.verified, true);
});

test('public verification requires exactly one non-nested visible contract root', () => {
  const base = {
    config: publisher.SITE_CONFIGS.jinan,
    monthText: 'September',
    imageUrlsByClinic: { jinan: '/uploads/jinan.png', yian: '/uploads/yian.png' },
  };
  for (const html of [
    '<p>September</p><img src="/uploads/jinan.png"><img src="/uploads/yian.png">',
    '<main data-public-visible="clinic-timetable"><p>September</p><img src="/uploads/jinan.png"></main><section data-public-visible="clinic-timetable"><img src="/uploads/yian.png"></section>',
    '<main data-public-visible="clinic-timetable"><section data-public-visible="clinic-timetable"><p>September</p><img src="/uploads/jinan.png"><img src="/uploads/yian.png"></section></main>',
  ]) {
    const result = publisher.verifyPublicPage({ ...base, response: publicResponse(html) });
    assert.equal(result.verified, false);
  }
});

test('public verification rejects ambiguous attributes and ancestor visibility paths', () => {
  const base = {
    config: publisher.SITE_CONFIGS.jinan,
    monthText: 'September',
    imageUrlsByClinic: { jinan: '/uploads/jinan.png', yian: '/uploads/yian.png' },
  };
  for (const html of [
    '<main data-public-visible="wrong" data-public-visible="clinic-timetable"><p>September</p><img src="/uploads/jinan.png"><img src="/uploads/yian.png"></main>',
    '<main data-public-visible="clinic-timetable"><img src="/safe.png" src="/uploads/jinan.png"><p>September</p><img src="/uploads/yian.png"></main>',
    '<section class="maybe-hidden"><main data-public-visible="clinic-timetable"><p>September</p><img src="/uploads/jinan.png"><img src="/uploads/yian.png"></main></section>',
    '<section style="max-height:0; overflow:hidden"><main data-public-visible="clinic-timetable"><p>September</p><img src="/uploads/jinan.png"><img src="/uploads/yian.png"></main></section>',
    '<main data-public-visible="clinic-timetable"><p style="height: 0">September</p><img src="/uploads/jinan.png"><img src="/uploads/yian.png"></main>',
  ]) {
    const result = publisher.verifyPublicPage({ ...base, response: publicResponse(html) });
    assert.equal(result.verified, false);
  }
});

test('public verification excludes head, style-only, hidden, and class-ambiguous content', () => {
  const images = '<img src="/uploads/jinan.png"><img src="/uploads/yian.png">';
  for (const html of [
    '<html><head><title>September</title></head><body><main data-public-visible="clinic-timetable"><img src="/uploads/jinan.png"><img src="/uploads/yian.png"></main></body></html>',
    '<main data-public-visible="clinic-timetable"><style>.month::before{content:"September"}</style><img src="/uploads/jinan.png"><img src="/uploads/yian.png"></main>',
    '<main data-public-visible="clinic-timetable"><p hidden>September</p><p>September</p><span style="display:none"><img src="/uploads/jinan.png"></span><img src="/uploads/yian.png"><img src="/uploads/jinan.png"></main>',
    `<main data-public-visible="clinic-timetable"><p class="shown">September</p>${images}</main>`,
  ]) {
    const result = publisher.verifyPublicPage({
      config: publisher.SITE_CONFIGS.jinan,
      response: publicResponse(html),
      monthText: 'September',
      imageUrlsByClinic: { jinan: '/uploads/jinan.png', yian: '/uploads/yian.png' },
    });
    assert.equal(result.verified, false);
  }
});

test('public verification rejects fully transparent rendered text as non-visible', () => {
  const result = publisher.verifyPublicPage({
    config: publisher.SITE_CONFIGS.jinan,
    response: publicResponse('<main data-public-visible="clinic-timetable"><p style="opacity: 0">September</p><img src="/uploads/jinan.png"><img src="/uploads/yian.png"></main>'),
    monthText: 'September',
    imageUrlsByClinic: { jinan: '/uploads/jinan.png', yian: '/uploads/yian.png' },
  });

  assert.equal(result.monthFound, false);
  assert.equal(result.verified, false);
});

test('public verification requires complete eligible HTTP response context', () => {
  const html = '<main data-public-visible="clinic-timetable"><p>September</p><img src="/uploads/jinan.png"><img src="/uploads/yian.png"></main>';
  const base = {
    config: publisher.SITE_CONFIGS.jinan,
    monthText: 'September',
    imageUrlsByClinic: { jinan: '/uploads/jinan.png', yian: '/uploads/yian.png' },
  };

  const pass = publisher.verifyPublicPage({
    ...base,
    response: publicResponse(html),
  });
  assert.equal(pass.context.eligible, true);
  assert.equal(pass.verified, true);

  for (const response of [
    publicResponse(html, { status: 500 }),
    publicResponse(html, { finalUrl: 'https://attacker.example/time.html' }),
    publicResponse(html, { finalUrl: 'https://www.tainanrehab.com/admin/login.php' }),
    publicResponse(html, { finalUrl: 'https://www.tainanrehab.com/error.html' }),
    null,
    { status: 200, html },
    { status: 200, finalUrl: 'https://www.tainanrehab.com/time.html' },
  ]) {
    const result = publisher.verifyPublicPage({ ...base, response });
    assert.equal(result.context.eligible, false);
    assert.equal(result.verified, false);
  }
});

test('public verification rejects credential-bearing final URLs despite same host and path', () => {
  const html = '<main data-public-visible="clinic-timetable"><p>September</p><img src="/uploads/jinan.png"><img src="/uploads/yian.png"></main>';
  const result = publisher.verifyPublicPage({
    config: publisher.SITE_CONFIGS.jinan,
    response: publicResponse(html, { finalUrl: 'https://user:pass@www.tainanrehab.com/time.html' }),
    monthText: 'September',
    imageUrlsByClinic: { jinan: '/uploads/jinan.png', yian: '/uploads/yian.png' },
  });

  assert.equal(result.context.eligible, false);
  assert.equal(result.verified, false);
});

test('public verification binds success to 2xx HTTP response and canonical configured URL', () => {
  const html = '<main data-public-visible="clinic-timetable"><p>September</p><img src="/uploads/jinan.png"><img src="/uploads/yian.png"></main>';
  const config = {
    ...publisher.SITE_CONFIGS.jinan,
    origin: 'https://example.test:8443',
    publicVerificationPath: '/current/../time.html?clinic=jinan&month=2026-09',
  };
  const base = {
    config,
    monthText: 'September',
    imageUrlsByClinic: { jinan: '/uploads/jinan.png', yian: '/uploads/yian.png' },
  };

  assert.equal(publisher.verifyPublicPage({
    ...base,
    response: { status: 204, finalUrl: 'https://example.test:8443/time.html?clinic=jinan&month=2026-09', html },
  }).verified, true);

  for (const response of [
    { status: 199, finalUrl: 'https://example.test:8443/time.html?clinic=jinan&month=2026-09', html },
    { status: 300, finalUrl: 'https://example.test:8443/time.html?clinic=jinan&month=2026-09', html },
    { status: 204, finalUrl: 'ftp://example.test:8443/time.html?clinic=jinan&month=2026-09', html },
    { status: 204, finalUrl: 'https://other.example:8443/time.html?clinic=jinan&month=2026-09', html },
    { status: 204, finalUrl: 'https://example.test/time.html?clinic=jinan&month=2026-09', html },
    { status: 204, finalUrl: 'https://example.test:8443/other.html?clinic=jinan&month=2026-09', html },
    { status: 204, finalUrl: 'https://example.test:8443/time.html?month=2026-09&clinic=jinan', html },
    { status: 204, finalUrl: 'https://example.test:8443/time.html?clinic=jinan', html },
    { status: 204, finalUrl: '', html },
    { status: 204, finalUrl: '/time.html?clinic=jinan&month=2026-09', html },
    { status: 204, finalUrl: 'https://[::1', html },
  ]) {
    const result = publisher.verifyPublicPage({ ...base, response });
    assert.equal(result.context.eligible, false);
    assert.equal(result.verified, false);
  }
});

test('clinic image priority comes from each site config', () => {
  const images = {
    jinan: '/uploads/jinan-september.png',
    yian: '/uploads/yian-september.png',
  };
  const jinanResult = publisher.verifyPublicPage({
    config: publisher.SITE_CONFIGS.jinan,
    response: publicResponse(publicHtml),
    monthText: '2026 年 9 月',
    imageUrlsByClinic: images,
  });
  const yianResult = publisher.verifyPublicPage({
    config: publisher.SITE_CONFIGS.yian,
    response: publicResponse(publicHtml, { finalUrl: 'https://www.ian-tainan.com/time.html' }),
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
    publicVerification: { verified: true, context: { eligible: true } },
  }), { status: 'success', requiresPublicVerification: false });
  assert.deepEqual(publisher.classifyPublisherResult({
    cmsState: 'accepted',
    publicVerification: { verified: true, context: { eligible: true } },
  }), { status: 'uncertain', requiresPublicVerification: true });
  assert.deepEqual(publisher.classifyPublisherResult({
    cmsState: 'ambiguous',
    publicVerification: { verified: false, context: { eligible: true } },
  }), { status: 'uncertain', requiresPublicVerification: true });
  assert.deepEqual(publisher.classifyPublisherResult({
    cmsState: 'unexpected-new-state',
    publicVerification: { verified: true, context: { eligible: true } },
  }), { status: 'uncertain', requiresPublicVerification: true });
  assert.deepEqual(publisher.classifyPublisherResult({
    cmsState: 'confirmed',
    publicVerification: { verified: true, context: { eligible: false } },
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
