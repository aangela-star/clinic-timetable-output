'use strict';

const SITE_CONFIGS = Object.freeze({
  jinan: Object.freeze({
    id: 'jinan',
    clinicName: 'Jin-An',
    origin: 'https://www.tainanrehab.com',
    loginPath: '/admin/login.php',
    protectedEditorPath: '/admin/index.php?op=time&sub=set',
    publicVerificationPath: '/time.html',
    clinicPriority: Object.freeze(['jinan', 'yian']),
    credentialRef: 'JINAN_WEBSITE_PUBLISHER_CREDENTIALS',
  }),
  yian: Object.freeze({
    id: 'yian',
    clinicName: 'Yi-An',
    origin: 'https://www.ian-tainan.com',
    loginPath: '/admin/login.php',
    protectedEditorPath: '/admin/index.php?op=time&sub=set',
    publicVerificationPath: '/time.html',
    clinicPriority: Object.freeze(['yian', 'jinan']),
    credentialRef: 'YIAN_WEBSITE_PUBLISHER_CREDENTIALS',
  }),
});

function buildLoginPageRequest(config) {
  return { method: 'GET', url: new URL(config.loginPath, config.origin).href };
}

function buildLoginPostRequest(config, credentials) {
  const body = new URLSearchParams();
  body.set('mode', 'login');
  body.set('username', credentials.username);
  body.set('password', credentials.password);
  return {
    method: 'POST',
    url: new URL(config.loginPath, config.origin).href,
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  };
}

function sendHttpRequest(transport, request) {
  if (typeof transport === 'function') return transport(request);
  if (transport && typeof transport.request === 'function') return transport.request(request);
  throw new TypeError('An HTTP transport function or object with request() is required.');
}

function createCookieJar() {
  const origins = new Map();

  function ingest(origin, setCookieValues) {
    const cookies = origins.get(origin) || new Map();
    for (const setCookie of setCookieValues || []) {
      const parts = String(setCookie).split(';').map((part) => part.trim());
      const separator = parts[0].indexOf('=');
      if (separator < 1) continue;
      const name = parts[0].slice(0, separator);
      const value = parts[0].slice(separator + 1);
      const attributes = new Map(parts.slice(1).map((part) => {
        const index = part.indexOf('=');
        return index === -1
          ? [part.toLowerCase(), true]
          : [part.slice(0, index).toLowerCase(), part.slice(index + 1)];
      }));
      cookies.set(name, {
        value,
        metadata: {
          path: attributes.get('path') || null,
          secure: attributes.has('secure'),
          httpOnly: attributes.has('httponly'),
        },
      });
    }
    origins.set(origin, cookies);
  }

  return {
    ingest,
    header(origin) {
      return Array.from(origins.get(origin) || [], ([name, cookie]) => `${name}=${cookie.value}`).join('; ');
    },
    metadata(origin, name) {
      const cookie = (origins.get(origin) || new Map()).get(name);
      return cookie ? { ...cookie.metadata } : null;
    },
  };
}

function detectAuthenticatedState({ config, finalUrl, html }) {
  let url;
  try {
    url = new URL(finalUrl);
  } catch {
    return 'unknown';
  }
  const loginPath = new URL(config.loginPath, config.origin).pathname;
  if (url.origin === config.origin && url.pathname === loginPath) {
    return 'unauthenticated';
  }
  const protectedEditorUrl = new URL(config.protectedEditorPath, config.origin);
  if (url.href !== protectedEditorUrl.href) return 'unknown';
  const formOpenings = /<form\b([^>]*)>/gi;
  let formOpening;
  let hasForm = false;
  while ((formOpening = formOpenings.exec(html || ''))) {
    if (parseAttributes(formOpening[1]).name === 'addAdminFrm') {
      hasForm = true;
      break;
    }
  }
  const hasNote = /<textarea\b[^>]*name\s*=\s*["']note["'][^>]*>/i.test(html || '');
  return hasForm && hasNote ? 'authenticated' : 'unknown';
}

function validateCallbackNumber(callbackNumber) {
  if (!Number.isInteger(callbackNumber) || callbackNumber < 0) {
    throw new Error('CKEditor callback number must be a non-negative integer.');
  }
}

function buildQuickUploadRequest(config, callbackNumber) {
  validateCallbackNumber(callbackNumber);
  const url = new URL('/scripts/ckfinder/core/connector/php/connector.php', config.origin);
  url.searchParams.set('command', 'QuickUpload');
  url.searchParams.set('type', 'Images');
  url.searchParams.set('CKEditor', 'note');
  url.searchParams.set('CKEditorFuncNum', String(callbackNumber));
  url.searchParams.set('langCode', 'zh');
  return { method: 'POST', url: url.href, multipartFieldName: 'upload' };
}

function decodeJavaScriptString(value) {
  return value.replace(/\\(['"\\])/g, '$1');
}

function parseQuickUploadCallback(html, expectedCallbackNumber) {
  validateCallbackNumber(expectedCallbackNumber);
  const match = /window\.parent\.CKEDITOR\.tools\.callFunction\(\s*(\d+)\s*,\s*(['"])((?:\\.|(?!\2).)*)\2\s*,\s*(['"])((?:\\.|(?!\4).)*)\4\s*\)\s*;?/s.exec(html || '');
  if (!match) throw new Error('Malformed CKFinder QuickUpload callback.');
  const callbackNumber = Number(match[1]);
  if (callbackNumber !== expectedCallbackNumber) {
    throw new Error('Unexpected CKEditor callback number.');
  }
  const relativeUrl = decodeJavaScriptString(match[3]);
  if (!relativeUrl.startsWith('/') || relativeUrl.startsWith('//')) {
    throw new Error('QuickUpload callback must contain a relative URL.');
  }
  return {
    callbackNumber,
    relativeUrl,
    message: decodeJavaScriptString(match[5]),
  };
}

function parseAttributes(source) {
  const attributes = Object.create(null);
  const pattern = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let match;
  while ((match = pattern.exec(source))) {
    attributes[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? '';
  }
  return attributes;
}

function decodeHtml(value) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
  return String(value).replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (entity, code) => {
    if (code[0] !== '#') return named[code.toLowerCase()];
    return String.fromCodePoint(code[1].toLowerCase() === 'x'
      ? Number.parseInt(code.slice(2), 16)
      : Number.parseInt(code.slice(1), 10));
  });
}

function parseLoginForm(config, html) {
  const forms = /<form\b([^>]*)>([\s\S]*?)<\/form\s*>/gi;
  const matches = [];
  let form;
  while ((form = forms.exec(html || ''))) {
    const attributes = parseAttributes(form[1]);
    if (attributes.name === 'loginForm') matches.push({ attributes, content: form[2] });
  }
  if (matches.length !== 1) throw new Error('Invalid or missing loginForm contract.');

  const { attributes, content } = matches[0];
  const expectedUrl = new URL(config.loginPath, config.origin).href;
  const enctype = attributes.enctype === undefined
    ? 'application/x-www-form-urlencoded'
    : String(attributes.enctype).toLowerCase();
  if ((attributes.id !== undefined && attributes.id !== 'loginForm')
      || attributes.action !== ''
      || new URL(attributes.action, expectedUrl).href !== expectedUrl
      || String(attributes.method).toLowerCase() !== 'post'
      || enctype !== 'application/x-www-form-urlencoded'
      || attributes.onsubmit !== undefined) {
    throw new Error('Invalid loginForm contract.');
  }

  const controls = [];
  const values = Object.create(null);
  const tags = /<(input|textarea|button|select)\b([^>]*)>(?:([\s\S]*?)<\/\1\s*>)?/gi;
  let tag;
  while ((tag = tags.exec(content))) {
    const attributesForControl = parseAttributes(tag[2]);
    const controlTag = tag[1].toLowerCase();
    const type = String(attributesForControl.type || '').toLowerCase();
    if ((controlTag === 'input' && type === 'submit')
        || (controlTag === 'button' && (type === '' || type === 'submit'))) {
      throw new Error('loginForm must contain exactly the approved named controls.');
    }
    if (!attributesForControl.name) continue;
    controls.push({
      tag: controlTag,
      type,
      name: attributesForControl.name,
      ...(attributesForControl.id === undefined ? {} : { id: attributesForControl.id }),
    });
    if (attributesForControl.name === 'mode') {
      values.mode = decodeHtml(attributesForControl.value || '');
    }
  }
  const expected = [
    { tag: 'input', type: 'hidden', name: 'mode' },
    { tag: 'input', type: 'text', name: 'username', id: 'username' },
    { tag: 'input', type: 'password', name: 'password', id: 'password' },
  ];
  const contractsByName = new Map(expected.map((contract) => [contract.name, contract]));
  const names = new Set(controls.map((control) => control.name));
  if (controls.length !== expected.length
      || names.size !== expected.length
      || controls.some((control) => {
        const contract = contractsByName.get(control.name);
        return !contract
          || control.tag !== contract.tag
          || control.type !== contract.type
          || (contract.id === undefined
            ? control.id !== undefined
            : control.id !== contract.id);
      })) {
    throw new Error('loginForm must contain exactly the approved named controls.');
  }
  if (values.mode !== 'login') throw new Error('loginForm mode must be login.');
  return {
    form: {
      name: 'loginForm',
      id: attributes.id ?? null,
      action: '',
      actionUrl: expectedUrl,
      method: 'POST',
      enctype,
    },
    controls,
    mode: values.mode,
  };
}

function parseCmsEditorForm(html) {
  const forms = /<form\b([^>]*)>([\s\S]*?)<\/form\s*>/gi;
  let form;
  let opening;
  let content;
  while ((form = forms.exec(html || ''))) {
    const attributes = parseAttributes(form[1]);
    if (attributes.name === 'addAdminFrm') {
      opening = attributes;
      content = form[2];
      break;
    }
  }
  if (!opening
      || opening.action !== ''
      || String(opening.method).toLowerCase() !== 'post'
      || String(opening.enctype).toLowerCase() !== 'multipart/form-data') {
    throw new Error('Invalid addAdminFrm contract.');
  }

  const controls = [];
  const values = Object.create(null);
  const tags = /<(input|textarea|button|select)\b([^>]*)>(?:([\s\S]*?)<\/\1\s*>)?/gi;
  let tag;
  while ((tag = tags.exec(content))) {
    const attributes = parseAttributes(tag[2]);
    if (!attributes.name) continue;
    controls.push({
      tag: tag[1].toLowerCase(),
      type: String(attributes.type || '').toLowerCase(),
      name: attributes.name,
    });
    values[attributes.name] = decodeHtml(tag[1].toLowerCase() === 'input'
      ? (attributes.value || '')
      : (tag[3] || attributes.value || ''));
  }
  const expected = [
    { tag: 'input', type: 'hidden', name: 'mode' },
    { tag: 'textarea', type: '', name: 'note' },
    { tag: 'input', type: 'text', name: 'wtitle' },
    { tag: 'input', type: 'text', name: 'wkeyword' },
    { tag: 'textarea', type: '', name: 'wdescription' },
    { tag: 'input', type: 'submit', name: 'Submit' },
  ];
  const contractsByName = new Map(expected.map((contract) => [contract.name, contract]));
  const names = new Set(controls.map((control) => control.name));
  if (controls.length !== expected.length
      || names.size !== expected.length
      || controls.some((control) => {
        const contract = contractsByName.get(control.name);
        return !contract || control.tag !== contract.tag || control.type !== contract.type;
      })) {
    throw new Error('addAdminFrm must contain exactly the approved named controls.');
  }
  if (values.mode !== 'edit') throw new Error('addAdminFrm mode must be edit.');
  return {
    mode: values.mode,
    note: values.note,
    wtitle: values.wtitle,
    wkeyword: values.wkeyword,
    wdescription: values.wdescription,
  };
}

function buildMainFormPayload(fields) {
  return {
    mode: fields.mode ?? 'edit',
    note: fields.note,
    wtitle: fields.wtitle,
    wkeyword: fields.wkeyword,
    wdescription: fields.wdescription,
    Submit: fields.Submit ?? '送出',
  };
}

function verifyPublicPage({ config, html, monthText, imageUrlsByClinic }) {
  const expectedImageUrls = config.clinicPriority.flatMap((clinicId) => {
    const value = imageUrlsByClinic[clinicId];
    return Array.isArray(value) ? value : [value];
  });
  if (expectedImageUrls.some((value) => typeof value !== 'string'
      || !value.startsWith('/') || value.startsWith('//'))) {
    throw new Error('Expected image URLs must be relative URLs.');
  }
  const actualImageUrls = [];
  const images = /<img\b([^>]*)>/gi;
  let image;
  while ((image = images.exec(html || ''))) {
    const attributes = parseAttributes(image[1]);
    if (attributes.src !== undefined) actualImageUrls.push(decodeHtml(attributes.src));
  }
  const missingImageUrls = expectedImageUrls.filter((url) => !actualImageUrls.includes(url));
  const positions = expectedImageUrls.map((url) => actualImageUrls.indexOf(url));
  const imagesInExpectedOrder = missingImageUrls.length === 0
    && positions.every((position, index) => index === 0 || position > positions[index - 1]);
  const monthFound = typeof monthText === 'string'
    && monthText.length > 0
    && decodeHtml(html || '').includes(monthText);
  return {
    monthFound,
    expectedImageUrls,
    missingImageUrls,
    imagesInExpectedOrder,
    verified: monthFound && missingImageUrls.length === 0 && imagesInExpectedOrder,
  };
}

function classifyPublisherResult({ cmsState, publicVerification }) {
  if (cmsState === 'confirmed') {
    return { status: 'success', requiresPublicVerification: false };
  }
  if (cmsState === 'failed') {
    return { status: 'failed', requiresPublicVerification: false };
  }
  if (publicVerification) {
    return {
      status: publicVerification.verified ? 'success' : 'failed',
      requiresPublicVerification: false,
    };
  }
  return { status: 'uncertain', requiresPublicVerification: true };
}

module.exports = {
  SITE_CONFIGS,
  buildLoginPageRequest,
  buildLoginPostRequest,
  parseLoginForm,
  sendHttpRequest,
  createCookieJar,
  detectAuthenticatedState,
  buildQuickUploadRequest,
  parseQuickUploadCallback,
  parseCmsEditorForm,
  buildMainFormPayload,
  verifyPublicPage,
  classifyPublisherResult,
};
