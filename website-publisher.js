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

function createCookieJar(options = {}) {
  const hosts = new Map();
  const now = typeof options.now === 'function' ? options.now : () => Date.now();
  let sequence = 0;

  function parseUrl(value) {
    try {
      const url = new URL(value);
      return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
    } catch {
      return null;
    }
  }

  function parseMaxAge(value) {
    if (typeof value !== 'string' || !/^[+-]?\d+$/.test(value)) return null;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
  }

  function defaultPath(pathname) {
    if (!pathname || pathname[0] !== '/') return '/';
    const lastSlash = pathname.lastIndexOf('/');
    return lastSlash <= 0 ? '/' : pathname.slice(0, lastSlash);
  }

  function normalizeCookiePath(value, requestPathname) {
    if (typeof value !== 'string' || !value.startsWith('/')) return defaultPath(requestPathname);
    return value;
  }

  function pathMatches(cookiePath, requestPath) {
    if (requestPath === cookiePath) return true;
    if (!requestPath.startsWith(cookiePath)) return false;
    return cookiePath.endsWith('/') || requestPath[cookiePath.length] === '/';
  }

  function purgeExpired(cookies) {
    const current = now();
    for (const [key, cookie] of cookies) {
      if (cookie.expiresAt !== null && cookie.expiresAt <= current) cookies.delete(key);
    }
  }

  function ingest(requestUrl, setCookieValues) {
    const url = parseUrl(requestUrl);
    if (!url) return;
    const hostKey = url.hostname.toLowerCase();
    const cookies = hosts.get(hostKey) || new Map();
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
      if (attributes.has('secure') && url.protocol !== 'https:') continue;
      const path = normalizeCookiePath(attributes.get('path'), url.pathname);
      const maxAge = attributes.get('max-age');
      let expiresAt = null;
      if (maxAge !== undefined) {
        const seconds = parseMaxAge(maxAge);
        if (seconds !== null) expiresAt = now() + seconds * 1000;
      }
      if (expiresAt === null && attributes.get('expires') !== undefined) {
        const parsedExpires = Date.parse(attributes.get('expires'));
        if (!Number.isNaN(parsedExpires)) expiresAt = parsedExpires;
      }
      const key = `${name}\n${path}`;
      if (expiresAt !== null && expiresAt <= now()) {
        cookies.delete(key);
        continue;
      }
      const existing = cookies.get(key);
      cookies.set(key, {
        name,
        value,
        path,
        expiresAt,
        sequence: existing?.sequence ?? sequence,
        metadata: {
          path,
          secure: attributes.has('secure'),
          httpOnly: attributes.has('httponly'),
        },
      });
      if (!existing) sequence += 1;
    }
    purgeExpired(cookies);
    hosts.set(hostKey, cookies);
  }

  return {
    ingest,
    header(requestUrl) {
      const url = parseUrl(requestUrl);
      if (!url) return '';
      const cookies = hosts.get(url.hostname.toLowerCase()) || new Map();
      purgeExpired(cookies);
      return Array.from(cookies.values())
        .filter((cookie) => pathMatches(cookie.path, url.pathname)
          && (!cookie.metadata.secure || url.protocol === 'https:'))
        .sort((left, right) => right.path.length - left.path.length
          || left.sequence - right.sequence)
        .map((cookie) => `${cookie.name}=${cookie.value}`)
        .join('; ');
    },
    metadata(origin, name, path = '/') {
      const url = parseUrl(origin);
      const hostKey = url ? url.hostname.toLowerCase() : String(origin).toLowerCase();
      const cookie = (hosts.get(hostKey) || new Map()).get(`${name}\n${path}`);
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

function decodePercentSegment(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new Error('QuickUpload callback URL contains malformed percent encoding.');
  }
}

function validateQuickUploadRelativeUrl(value) {
  if (/[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error('QuickUpload callback URL must not contain control characters.');
  }
  if (value.includes('\\')) {
    throw new Error('QuickUpload callback URL must not contain backslashes.');
  }
  if (/%25/i.test(value)) {
    throw new Error('QuickUpload callback URL must not contain encoded percent signs.');
  }
  if (/%(?:2f|5c)/i.test(value)) {
    throw new Error('QuickUpload callback URL must not contain encoded path separators.');
  }
  for (const segment of value.split('/')) {
    let decoded = segment;
    for (let depth = 0; depth < 4; depth += 1) {
      if (/[\u0000-\u001f\u007f]/.test(decoded)) {
        throw new Error('QuickUpload callback URL must not contain control characters.');
      }
      if (decoded.includes('\\')) {
        throw new Error('QuickUpload callback URL must not contain backslashes.');
      }
      if (decoded === '.' || decoded === '..') {
        throw new Error('QuickUpload callback URL must not contain path traversal.');
      }
      if (/%(?:2e|2f|5c|00|0a|0d)/i.test(decoded)) {
        throw new Error('QuickUpload callback URL must not contain nested unsafe encoding.');
      }
      if (!/%[0-9a-f]{2}/i.test(decoded)) break;
      const next = decodePercentSegment(decoded);
      if (next === decoded) break;
      decoded = next;
    }
  }
}

function parseQuickUploadCallback(config, html, expectedCallbackNumber) {
  validateCallbackNumber(expectedCallbackNumber);
  const source = String(html || '');
  const callbackSource = "window\\.parent\\.CKEDITOR\\.tools\\.callFunction\\(\\s*(\\d+)\\s*,\\s*(['\"])((?:\\\\.|(?!\\2).)*)\\2\\s*,\\s*(['\"])((?:\\\\.|(?!\\4).)*)\\4\\s*\\)\\s*;?";
  const callbackPattern = new RegExp(`^\\s*${callbackSource}\\s*$`, 's');
  const scriptPattern = new RegExp(`^\\s*<script>\\s*${callbackSource}\\s*</script>\\s*$`, 's');
  const match = callbackPattern.exec(source) || scriptPattern.exec(source);
  if (!match) throw new Error('Malformed or ambiguous CKFinder QuickUpload callback.');
  const callbackNumber = Number(match[1]);
  if (callbackNumber !== expectedCallbackNumber) {
    throw new Error('Unexpected CKEditor callback number.');
  }
  if (match[3].includes('\\')) {
    throw new Error('QuickUpload callback URL must not contain backslashes.');
  }
  const relativeUrl = decodeJavaScriptString(match[3]);
  if (relativeUrl.includes('\\')) {
    throw new Error('QuickUpload callback URL must not contain backslashes.');
  }
  validateQuickUploadRelativeUrl(relativeUrl);
  if (/^[a-z][a-z0-9+.-]*:/i.test(relativeUrl)) {
    let resolved;
    try {
      resolved = new URL(relativeUrl);
    } catch {
      throw new Error('QuickUpload callback URL could not be resolved.');
    }
    if (resolved.origin !== new URL(config.origin).origin) {
      throw new Error('QuickUpload callback URL must resolve to same-origin.');
    }
    throw new Error('QuickUpload callback URL must be a root-relative upload path.');
  }
  if (!relativeUrl.startsWith('/') || relativeUrl.startsWith('//')) {
    throw new Error('QuickUpload callback URL must be a root-relative same-origin upload path.');
  }
  if (!/^\/uploads?\//.test(relativeUrl)) {
    throw new Error('QuickUpload callback URL must be a root-relative upload path.');
  }
  let canonicalUrl;
  try {
    canonicalUrl = new URL(relativeUrl, config.origin);
  } catch {
    throw new Error('QuickUpload callback URL could not be resolved.');
  }
  if (canonicalUrl.origin !== new URL(config.origin).origin) {
    throw new Error('QuickUpload callback URL must resolve to same-origin.');
  }
  if (!['/upload/', '/uploads/'].some((prefix) => canonicalUrl.pathname.startsWith(prefix))) {
    throw new Error('QuickUpload callback URL must resolve to a canonical upload path.');
  }
  return {
    callbackNumber,
    relativeUrl,
    canonicalUrl: canonicalUrl.href,
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

function parseAttributesStrict(source) {
  const attributes = Object.create(null);
  const names = new Set();
  const pattern = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let match;
  while ((match = pattern.exec(source))) {
    const name = match[1].toLowerCase();
    if (names.has(name)) return { attributes, ambiguous: true };
    names.add(name);
    attributes[name] = match[2] ?? match[3] ?? match[4] ?? '';
  }
  return { attributes, ambiguous: false };
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

function parseCmsEditorForm(config, html) {
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
  const expectedUrl = new URL(config.protectedEditorPath, config.origin).href;
  let actionUrl;
  try {
    actionUrl = new URL(decodeHtml(opening?.action || ''), expectedUrl).href;
  } catch {
    actionUrl = null;
  }
  if (!opening
      || actionUrl !== expectedUrl
      || String(opening.method).trim().toLowerCase() !== 'post'
      || String(opening.enctype).trim().toLowerCase() !== 'multipart/form-data') {
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
    mode: 'edit',
    note: fields.note,
    wtitle: fields.wtitle,
    wkeyword: fields.wkeyword,
    wdescription: fields.wdescription,
    Submit: '送出',
  };
}

function findTagEnd(html, start) {
  let quote = null;
  for (let index = start; index < html.length; index += 1) {
    const character = html[index];
    if (quote) {
      if (character === quote) quote = null;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === '>') {
      return index;
    }
  }
  return -1;
}

function isHiddenElement(attributes) {
  if (attributes.hidden !== undefined) return true;
  if (String(attributes['aria-hidden'] || '').trim().toLowerCase() === 'true') return true;
  const declarations = String(attributes.style || '').split(';').map((declaration) => {
    const separator = declaration.indexOf(':');
    if (separator === -1) return null;
    return {
      property: declaration.slice(0, separator).trim().toLowerCase(),
      value: declaration.slice(separator + 1).trim().toLowerCase(),
    };
  }).filter(Boolean);
  const hasHiddenOverflow = declarations.some(({ property, value }) => property === 'overflow'
    && /^(?:hidden|clip)(?:\s*!important)?$/.test(value));
  return declarations.some(({ property, value }) => {
    return (property === 'display' && /^none(?:\s*!important)?$/.test(value))
      || (property === 'visibility' && /^(?:hidden|collapse)(?:\s*!important)?$/.test(value))
      || (property === 'opacity' && /^0(?:\.0+)?(?:\s*!important)?$/.test(value))
      || (hasHiddenOverflow
        && /^(?:height|max-height|width|max-width)$/.test(property)
        && /^0(?:px|em|rem|%)?(?:\s*!important)?$/.test(value));
  });
}

function publicResponseContext(config, response) {
  const context = {
    hasContext: false,
    statusOk: false,
    protocolOk: false,
    originOk: false,
    pathOk: false,
    eligible: false,
  };
  if (!response || typeof response !== 'object') return context;
  const { status, finalUrl, html } = response;
  context.hasContext = Number.isInteger(status)
    && typeof finalUrl === 'string'
    && typeof html === 'string';
  if (!context.hasContext) return context;
  context.status = status;
  context.finalUrl = finalUrl;
  context.statusOk = status >= 200 && status < 300;
  let actualUrl;
  let expectedUrl;
  try {
    actualUrl = new URL(finalUrl);
    expectedUrl = new URL(config.publicVerificationPath, config.origin);
  } catch {
    return context;
  }
  if (actualUrl.username || actualUrl.password) return context;
  context.protocolOk = actualUrl.protocol === 'http:' || actualUrl.protocol === 'https:';
  context.originOk = actualUrl.origin === expectedUrl.origin;
  context.pathOk = actualUrl.pathname === expectedUrl.pathname
    && actualUrl.search === expectedUrl.search;
  context.eligible = context.statusOk && context.protocolOk && context.originOk && context.pathOk;
  return context;
}

function extractIncludedDocumentContent(source) {
  const html = String(source || '');
  const voidElements = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
  const excludedElements = new Set(['head', 'title', 'style', 'script', 'template', 'meta', 'link', 'base', 'noscript']);
  const stack = [];
  const visibleText = [];
  const imageUrls = [];
  let hiddenSubtreeFound = false;
  let classAmbiguityFound = false;
  let attributeAmbiguityFound = false;
  let nestedContractFound = false;
  let contractRootCount = 0;
  let contractDepth = 0;
  let cursor = 0;

  try {
    while (cursor < html.length) {
      const excluded = stack.at(-1)?.excluded;
      if (excluded) {
        const closingPattern = new RegExp(`</${excluded}\\s*>`, 'ig');
        closingPattern.lastIndex = cursor;
        const closing = closingPattern.exec(html);
        if (!closing) return { uncertain: true, visibleText: '', imageUrls: [] };
        cursor = closingPattern.lastIndex;
        const popped = stack.pop();
        if (popped.inContract) contractDepth -= 1;
        continue;
      }

      const openingIndex = html.indexOf('<', cursor);
      if (openingIndex === -1) {
        if (contractDepth > 0 && !stack.some((entry) => entry.hidden)) visibleText.push(html.slice(cursor));
        cursor = html.length;
        break;
      }
      if (contractDepth > 0 && !stack.some((entry) => entry.hidden)) {
        visibleText.push(html.slice(cursor, openingIndex));
      }

      if (html.startsWith('<!--', openingIndex)) {
        const commentEnd = html.indexOf('-->', openingIndex + 4);
        if (commentEnd === -1) return { uncertain: true, visibleText: '', imageUrls: [] };
        cursor = commentEnd + 3;
        continue;
      }

      const tagEnd = findTagEnd(html, openingIndex + 1);
      if (tagEnd === -1) return { uncertain: true, visibleText: '', imageUrls: [] };
      const tagSource = html.slice(openingIndex + 1, tagEnd);
      cursor = tagEnd + 1;
      if (/^\s*[!?]/.test(tagSource)) continue;

      const closing = /^\s*\/\s*([a-z][\w:-]*)\s*$/i.exec(tagSource);
      if (closing) {
        const name = closing[1].toLowerCase();
        if (stack.at(-1)?.name !== name) return { uncertain: true, visibleText: '', imageUrls: [] };
        const popped = stack.pop();
        if (popped.inContract) contractDepth -= 1;
        continue;
      }

      const opening = /^\s*([a-z][\w:-]*)([\s\S]*?)\s*(\/)?\s*$/i.exec(tagSource);
      if (!opening) return { uncertain: true, visibleText: '', imageUrls: [] };
      const name = opening[1].toLowerCase();
      const parsedAttributes = parseAttributesStrict(opening[2]);
      const attributes = parsedAttributes.attributes;
      if (parsedAttributes.ambiguous) attributeAmbiguityFound = true;
      const hidden = stack.some((entry) => entry.hidden) || isHiddenElement(attributes);
      const entersContract = attributes['data-public-visible'] === 'clinic-timetable';
      if (entersContract) {
        contractRootCount += 1;
        if (contractDepth > 0) nestedContractFound = true;
        if (stack.some((entry) => entry.hidden)) hiddenSubtreeFound = true;
        if (stack.some((entry) => entry.ambiguousVisibility)) classAmbiguityFound = true;
      }
      const inContract = contractDepth > 0 || entersContract;
      const ambiguousVisibility = attributes.class !== undefined || attributes.style !== undefined;
      if (inContract && ambiguousVisibility) classAmbiguityFound = true;
      if (inContract && hidden) hiddenSubtreeFound = true;
      if (name === 'img' && inContract && !hidden && attributes.src !== undefined) {
        imageUrls.push(decodeHtml(attributes.src));
      }
      if (!opening[3] && !voidElements.has(name)) {
        stack.push({
          name,
          hidden,
          inContract,
          ambiguousVisibility,
          excluded: excludedElements.has(name) ? name : null,
        });
        if (inContract) contractDepth += 1;
      }
    }
    if (stack.length !== 0) return { uncertain: true, visibleText: '', imageUrls: [] };
    return {
      uncertain: false,
      visibleText: decodeHtml(visibleText.join('')),
      imageUrls,
      hiddenSubtreeFound,
      classAmbiguityFound,
      attributeAmbiguityFound,
      nestedContractFound,
      contractRootCount,
    };
  } catch {
    return { uncertain: true, visibleText: '', imageUrls: [] };
  }
}

function verifyPublicPage({ config, response, monthText, imageUrlsByClinic }) {
  const expectedImageUrls = config.clinicPriority.flatMap((clinicId) => {
    const value = imageUrlsByClinic[clinicId];
    return Array.isArray(value) ? value : [value];
  });
  if (expectedImageUrls.some((value) => typeof value !== 'string'
      || !value.startsWith('/') || value.startsWith('//'))) {
    throw new Error('Expected image URLs must be relative URLs.');
  }
  const context = publicResponseContext(config, response);
  const extracted = context.eligible
    ? extractIncludedDocumentContent(response.html)
    : { uncertain: true, visibleText: '', imageUrls: [] };
  const actualImageUrls = extracted.imageUrls;
  const missingImageUrls = expectedImageUrls.filter((url) => !actualImageUrls.includes(url));
  const positions = expectedImageUrls.map((url) => actualImageUrls.indexOf(url));
  const imagesInExpectedOrder = missingImageUrls.length === 0
    && positions.every((position, index) => index === 0 || position > positions[index - 1]);
  const contractRootOk = extracted.contractRootCount === 1 && !extracted.nestedContractFound;
  const monthFound = !extracted.uncertain
    && context.eligible
    && contractRootOk
    && !extracted.hiddenSubtreeFound
    && !extracted.classAmbiguityFound
    && !extracted.attributeAmbiguityFound
    && typeof monthText === 'string'
    && monthText.length > 0
    && extracted.visibleText.includes(monthText);
  return {
    context,
    monthFound,
    expectedImageUrls,
    missingImageUrls,
    imagesInExpectedOrder,
    verified: monthFound
      && missingImageUrls.length === 0
      && imagesInExpectedOrder
      && context.eligible
      && contractRootOk
      && !extracted.hiddenSubtreeFound
      && !extracted.classAmbiguityFound
      && !extracted.attributeAmbiguityFound,
  };
}

function classifyPublisherResult({ cmsState, publicVerification }) {
  if (cmsState === 'failed') {
    return { status: 'failed', requiresPublicVerification: false };
  }
  if (cmsState === 'confirmed'
      && publicVerification?.verified === true
      && publicVerification?.context?.eligible === true) {
    return { status: 'success', requiresPublicVerification: false };
  }
  if (cmsState === 'confirmed' && publicVerification?.verified === false) {
    return { status: 'failed', requiresPublicVerification: false };
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
