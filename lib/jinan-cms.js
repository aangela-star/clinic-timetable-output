'use strict';

const { randomUUID } = require('node:crypto');
const { MAX_PNG_BYTES, parsePngDataUrl } = require('./publish-contract.js');

const JINAN_CMS_CONFIG = Object.freeze({
  origin: 'https://www.tainanrehab.com',
  loginUrl: 'https://www.tainanrehab.com/admin/login.php',
  editorUrl: 'https://www.tainanrehab.com/admin/index.php?op=time&sub=set',
  publicUrl: 'https://www.tainanrehab.com/time.html',
  quickUploadUrl: 'https://www.tainanrehab.com/scripts/ckfinder/core/connector/php/connector.php',
  publishEnabledEnvName: 'JINAN_CMS_PUBLISH_ENABLED',
  usernameEnvName: 'JINAN_CMS_USERNAME',
  passwordEnvName: 'JINAN_CMS_PASSWORD',
});

const LOGIN_SUCCESS_LANDING_URL = 'https://www.tainanrehab.com/admin/index.php';

const JINAN_CMS_RESULTS = Object.freeze({
  READY_FOR_UPLOAD: 'READY_FOR_UPLOAD',
  UPLOAD_SUCCEEDED: 'UPLOAD_SUCCEEDED',
  SUBMIT_SUCCEEDED: 'SUBMIT_SUCCEEDED',
  ALREADY_PUBLISHED: 'ALREADY_PUBLISHED',
  AUTH_FAILED: 'AUTH_FAILED',
  FORM_CHANGED: 'FORM_CHANGED',
  CMS_RESPONSE_CONTRACT_UNVERIFIED: 'CMS_RESPONSE_CONTRACT_UNVERIFIED',
  UPLOAD_FAILED: 'UPLOAD_FAILED',
  SUBMIT_FAILED: 'SUBMIT_FAILED',
  VERIFY_FAILED: 'VERIFY_FAILED',
  PUBLISH_IN_PROGRESS: 'PUBLISH_IN_PROGRESS',
  MANUAL_CHECK_REQUIRED: 'MANUAL_CHECK_REQUIRED',
  PUBLISHED: 'PUBLISHED',
});

const JINAN_CMS_LOGIN_DIAGNOSTIC_REASON_CODES = Object.freeze({
  LOGIN_POST_STATUS_MISMATCH: 'LOGIN_POST_STATUS_MISMATCH',
  LOGIN_POST_FINAL_URL_MISMATCH: 'LOGIN_POST_FINAL_URL_MISMATCH',
  LOGIN_POST_LOCATION_MISMATCH: 'LOGIN_POST_LOCATION_MISMATCH',
  LOGIN_LANDING_STATUS_MISMATCH: 'LOGIN_LANDING_STATUS_MISMATCH',
  LOGIN_LANDING_URL_MISMATCH: 'LOGIN_LANDING_URL_MISMATCH',
  LOGIN_LANDING_REDIRECT_DRIFT: 'LOGIN_LANDING_REDIRECT_DRIFT',
});
const JINAN_CMS_LOGIN_DIAGNOSTIC_REASON_CODE_SET = new Set(
  Object.values(JINAN_CMS_LOGIN_DIAGNOSTIC_REASON_CODES),
);
const JINAN_CMS_LOGIN_DIAGNOSTIC_REASON_BY_ERROR = new WeakMap();

const REQUIRED_CONTROLS = Object.freeze({
  mode: Object.freeze({ tag: 'input', type: 'hidden' }),
  note: Object.freeze({ tag: 'textarea', type: '' }),
  wtitle: Object.freeze({ tag: 'input', type: 'text' }),
  wkeyword: Object.freeze({ tag: 'input', type: 'text' }),
  wdescription: Object.freeze({ tag: 'textarea', type: '' }),
  Submit: Object.freeze({ tag: 'input', type: 'submit' }),
});
const LOGIN_CONTROLS = Object.freeze({
  mode: Object.freeze({ tag: 'input', type: 'hidden', value: 'login' }),
  username: Object.freeze({ tag: 'input', type: 'text' }),
  password: Object.freeze({ tag: 'input', type: 'password' }),
});

function cmsError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function loginDiagnosticError(code) {
  const error = cmsError(JINAN_CMS_RESULTS.VERIFY_FAILED);
  JINAN_CMS_LOGIN_DIAGNOSTIC_REASON_BY_ERROR.set(error, code);
  return error;
}

function safeLoginDiagnosticReasonCode(error, fallbackStatus) {
  const reasonCode = error instanceof Error
    ? JINAN_CMS_LOGIN_DIAGNOSTIC_REASON_BY_ERROR.get(error)
    : undefined;
  return JINAN_CMS_LOGIN_DIAGNOSTIC_REASON_CODE_SET.has(reasonCode)
    ? reasonCode
    : fallbackStatus;
}

const HTML_ENTITIES = Object.freeze({
  amp: '&',
  apos: "'",
  gt: '>',
  lt: '<',
  nbsp: '\u00a0',
  percnt: '%',
  quot: '"',
  sol: '/',
});
const TIMETABLE_REMINDER_TEXT = '門診時間如有異動，請以現場公告為準';
const TIMETABLE_HEADING_RE = /^[0-9０-９]{3}年[0-9０-９]{1,2}月醫師常規門診、門診異動及週六門診時間，詳情請往下參閱！$/;
const TIMETABLE_SEPARATOR_RE = /^-+$/;

function decodeHtml(value) {
  const decoded = String(value || '').replace(/&(#x[0-9a-fA-F]+|#[0-9]+|#[^;]*|[A-Za-z][A-Za-z0-9]*);/g, (token, body) => {
    if (Object.prototype.hasOwnProperty.call(HTML_ENTITIES, body)) return HTML_ENTITIES[body];
    if (body.startsWith('#x') || body.startsWith('#X')) {
      const digits = body.slice(2);
      if (!/^[0-9a-fA-F]+$/.test(digits)) throw cmsError(JINAN_CMS_RESULTS.FORM_CHANGED);
      const codePoint = Number.parseInt(digits, 16);
      if (!Number.isFinite(codePoint)
          || codePoint === 0
          || (codePoint >= 0x80 && codePoint <= 0x9f)
          || codePoint > 0x10ffff
          || (codePoint >= 0xd800 && codePoint <= 0xdfff)) {
        throw cmsError(JINAN_CMS_RESULTS.FORM_CHANGED);
      }
      return String.fromCodePoint(codePoint);
    }
    if (body.startsWith('#')) {
      const digits = body.slice(1);
      if (!/^[0-9]+$/.test(digits)) throw cmsError(JINAN_CMS_RESULTS.FORM_CHANGED);
      const codePoint = Number.parseInt(digits, 10);
      if (!Number.isFinite(codePoint)
          || codePoint === 0
          || (codePoint >= 0x80 && codePoint <= 0x9f)
          || codePoint > 0x10ffff
          || (codePoint >= 0xd800 && codePoint <= 0xdfff)) {
        throw cmsError(JINAN_CMS_RESULTS.FORM_CHANGED);
      }
      return String.fromCodePoint(codePoint);
    }
    throw cmsError(JINAN_CMS_RESULTS.FORM_CHANGED);
  });
  if (/&#/.test(decoded) || /&(?:#[^;\s&]*|[A-Za-z][^;\s&]*);/.test(decoded)) {
    throw cmsError(JINAN_CMS_RESULTS.FORM_CHANGED);
  }
  return decoded;
}

function isHtmlWhitespace(char) {
  return char === ' ' || char === '\n' || char === '\t' || char === '\r' || char === '\f';
}

function isAttributeNameChar(char) {
  return /^[A-Za-z0-9_:.-]$/.test(char || '');
}

function lexAttributeSequence(source) {
  const input = String(source || '');
  const attrs = Object.create(null);
  const attributes = [];
  let index = 0;

  while (index < input.length) {
    const attrStart = index;
    let hadWhitespace = false;
    while (index < input.length && isHtmlWhitespace(input[index])) {
      hadWhitespace = true;
      index += 1;
    }
    if (index >= input.length) break;

    if (input[index] === '/') {
      index += 1;
      while (index < input.length && isHtmlWhitespace(input[index])) index += 1;
      if (index !== input.length) throw cmsError(JINAN_CMS_RESULTS.FORM_CHANGED);
      break;
    }
    if (!hadWhitespace) throw cmsError(JINAN_CMS_RESULTS.FORM_CHANGED);
    if (!isAttributeNameChar(input[index])) throw cmsError(JINAN_CMS_RESULTS.FORM_CHANGED);

    const nameStart = index;
    while (index < input.length && isAttributeNameChar(input[index])) index += 1;
    const rawName = input.slice(nameStart, index);
    const name = rawName.toLowerCase();
    if (Object.prototype.hasOwnProperty.call(attrs, name)) {
      throw cmsError(JINAN_CMS_RESULTS.FORM_CHANGED);
    }
    let rawValue = '';
    let valueStart = index;
    let valueEnd = index;
    let quote = null;
    let valueProbe = index;
    while (valueProbe < input.length && isHtmlWhitespace(input[valueProbe])) valueProbe += 1;
    if (valueProbe < input.length && input[valueProbe] === '=') {
      index = valueProbe;
      index += 1;
      while (index < input.length && isHtmlWhitespace(input[index])) index += 1;
      if (index >= input.length) throw cmsError(JINAN_CMS_RESULTS.FORM_CHANGED);

      quote = input[index];
      if (quote === '"' || quote === "'") {
        index += 1;
        valueStart = index;
        while (index < input.length && input[index] !== quote) index += 1;
        if (index >= input.length) throw cmsError(JINAN_CMS_RESULTS.FORM_CHANGED);
        valueEnd = index;
        rawValue = input.slice(valueStart, valueEnd);
        index += 1;
      } else {
        if (['"', "'", '=', '<', '>', '`', '/'].includes(input[index]) || isHtmlWhitespace(input[index])) {
          throw cmsError(JINAN_CMS_RESULTS.FORM_CHANGED);
        }
        valueStart = index;
        while (index < input.length
          && !isHtmlWhitespace(input[index])
          && !['"', "'", '=', '<', '>', '`', '/'].includes(input[index])) {
          index += 1;
        }
        valueEnd = index;
        rawValue = input.slice(valueStart, valueEnd);
      }
    }

    const decodedValue = decodeHtml(rawValue);
    attrs[name] = decodedValue;
    attributes.push({
      name,
      rawName,
      value: decodedValue,
      rawValue,
      quote,
      span: { start: attrStart, end: index },
      nameSpan: { start: nameStart, end: nameStart + rawName.length },
      valueSpan: { start: valueStart, end: valueEnd },
    });
  }
  return { attrs, attributes };
}

function parseAttributes(source) {
  return lexAttributeSequence(source).attrs;
}

function actionMatches(value, expectedUrl) {
  const action = String(value || '').trim();
  if (!action) return true;
  try {
    return new URL(action, JINAN_CMS_CONFIG.origin).href === expectedUrl;
  } catch {
    return false;
  }
}

function assertExactEditorAction(opening) {
  if (!actionMatches(opening.action, JINAN_CMS_CONFIG.editorUrl)
      || String(opening.method || '').trim().toLowerCase() !== 'post'
      || String(opening.enctype || '').trim().toLowerCase() !== 'multipart/form-data') {
    throw cmsError(JINAN_CMS_RESULTS.FORM_CHANGED);
  }
}

function controlValue(tag, attrs, inner) {
  if (tag === 'input') return decodeHtml(attrs.value || '');
  return decodeHtml(inner || '');
}

function assertStrictFormAttributes(tag) {
  for (const attr of tag.attributes || []) {
    if (/[<>]/.test(attr.rawValue || '')) throw cmsError(JINAN_CMS_RESULTS.FORM_CHANGED);
  }
}

function collectNamedFormControls(html, expectedName) {
  const forms = [];
  const formStack = [];

  function currentForm() {
    return formStack.length > 0 ? formStack[formStack.length - 1] : null;
  }

  scanHtml(
    html,
    (tag) => {
      if (tag.name === 'form') {
        assertStrictFormAttributes(tag);
        if (tag.isClosing) {
          const form = formStack.pop();
          if (!form) throw cmsError(JINAN_CMS_RESULTS.FORM_CHANGED);
          if (form.attrs.name === expectedName) forms.push(form);
          return;
        }
        if (currentForm()) throw cmsError(JINAN_CMS_RESULTS.FORM_CHANGED);
        formStack.push({ attrs: tag.attrs, controls: [] });
        return;
      }

      if (tag.isClosing) return;
      if (!currentForm() || !['input', 'button', 'select'].includes(tag.name)) return;
      assertStrictFormAttributes(tag);
      currentForm().controls.push({ tag: tag.name, attrs: tag.attrs, inner: '' });
    },
    null,
    (raw) => {
      if (!currentForm() || raw.name !== 'textarea') return;
      assertStrictFormAttributes(raw);
      currentForm().controls.push({ tag: raw.name, attrs: raw.attrs, inner: raw.inner });
    },
  );

  if (formStack.length > 0) throw cmsError(JINAN_CMS_RESULTS.FORM_CHANGED);
  return forms;
}

function parseCmsEditorForm(html) {
  const forms = collectNamedFormControls(html, 'addAdminFrm');
  if (forms.length !== 1) throw cmsError(JINAN_CMS_RESULTS.FORM_CHANGED);

  const { attrs: opening, controls: discoveredControls } = forms[0];
  assertExactEditorAction(opening);

  const fields = Object.create(null);
  const seen = new Set();
  const controls = [];
  for (const discovered of discoveredControls) {
    const { tag, attrs, inner } = discovered;
    const name = attrs.name;
    if (!name) continue;
    if (seen.has(name)) throw cmsError(JINAN_CMS_RESULTS.FORM_CHANGED);
    seen.add(name);

    const type = tag === 'input' ? String(attrs.type || 'text').trim().toLowerCase() : '';
    const contract = REQUIRED_CONTROLS[name];
    if (contract) {
      if (contract.tag !== tag || contract.type !== type) throw cmsError(JINAN_CMS_RESULTS.FORM_CHANGED);
    } else if (!(tag === 'input' && type === 'hidden')) {
      throw cmsError(JINAN_CMS_RESULTS.FORM_CHANGED);
    }

    controls.push({ tag, type, name });
    fields[name] = controlValue(tag, attrs, inner);
  }

  for (const name of Object.keys(REQUIRED_CONTROLS)) {
    if (!seen.has(name)) throw cmsError(JINAN_CMS_RESULTS.FORM_CHANGED);
  }
  if (fields.mode !== 'edit') throw cmsError(JINAN_CMS_RESULTS.FORM_CHANGED);

  return {
    action: JINAN_CMS_CONFIG.editorUrl,
    method: 'POST',
    enctype: 'multipart/form-data',
    fields: { ...fields },
    controls,
  };
}

function parseLoginForm(html) {
  const forms = collectNamedFormControls(html, 'loginForm');
  if (forms.length !== 1) throw cmsError(JINAN_CMS_RESULTS.FORM_CHANGED);

  const { attrs: opening, controls: discoveredControls } = forms[0];
  const enctype = String(opening.enctype || 'application/x-www-form-urlencoded').trim().toLowerCase();
  if (!actionMatches(opening.action, JINAN_CMS_CONFIG.loginUrl)
      || String(opening.method || '').trim().toLowerCase() !== 'post'
      || (enctype && enctype !== 'application/x-www-form-urlencoded')) {
    throw cmsError(JINAN_CMS_RESULTS.FORM_CHANGED);
  }

  const seen = new Set();
  const controls = [];
  for (const discovered of discoveredControls) {
    const { tag, attrs, inner } = discovered;
    const name = attrs.name;
    if (!name) continue;
    if (seen.has(name)) throw cmsError(JINAN_CMS_RESULTS.FORM_CHANGED);
    seen.add(name);

    const type = tag === 'input' ? String(attrs.type || 'text').trim().toLowerCase() : '';
    const contract = LOGIN_CONTROLS[name];
    if (!contract || contract.tag !== tag || contract.type !== type) {
      throw cmsError(JINAN_CMS_RESULTS.FORM_CHANGED);
    }
    if (contract.value !== undefined && controlValue(tag, attrs, inner) !== contract.value) {
      throw cmsError(JINAN_CMS_RESULTS.FORM_CHANGED);
    }
    controls.push({ tag, type, name });
  }

  if (seen.size !== Object.keys(LOGIN_CONTROLS).length) throw cmsError(JINAN_CMS_RESULTS.FORM_CHANGED);
  for (const name of Object.keys(LOGIN_CONTROLS)) {
    if (!seen.has(name)) throw cmsError(JINAN_CMS_RESULTS.FORM_CHANGED);
  }

  return {
    action: JINAN_CMS_CONFIG.loginUrl,
    method: 'POST',
    enctype: 'application/x-www-form-urlencoded',
    controls,
  };
}

function validateRootRelativeUploadUrl(value) {
  if (typeof value !== 'string'
      || value.length < 1
      || value.length > 1024
      || !/^\/uploads?\//.test(value)
      || value.startsWith('//')
      || /[?#]/.test(value)
      || /[\u0000-\u001f\u007f-\u009f\\]/.test(value)
      || /\/(?:\.|\.\.)(?:\/|$)/.test(value)
      || /%(?:2e|2f|3f|23|5c|00|0a|0d)/i.test(value)) {
    throw cmsError(JINAN_CMS_RESULTS.FORM_CHANGED);
  }
  let decoded = value;
  const maxDecodeDepth = 8;
  for (let depth = 0; decoded.includes('%') && depth < maxDecodeDepth; depth += 1) {
    try {
      decoded = decodeURIComponent(decoded);
    } catch {
      throw cmsError(JINAN_CMS_RESULTS.FORM_CHANGED);
    }
    if (decoded.length > 1024
        || /[\u0000-\u001f\u007f-\u009f\\]/.test(decoded)
        || /[?#]/.test(decoded)
        || /\/(?:\.|\.\.)(?:\/|$)/.test(decoded)
        || /%(?:2e|2f|3f|23|5c|00|0a|0d)/i.test(decoded)) {
      throw cmsError(JINAN_CMS_RESULTS.FORM_CHANGED);
    }
  }
  if (decoded.includes('%')) throw cmsError(JINAN_CMS_RESULTS.FORM_CHANGED);
  let resolved;
  try {
    resolved = new URL(value, JINAN_CMS_CONFIG.origin);
  } catch {
    throw cmsError(JINAN_CMS_RESULTS.FORM_CHANGED);
  }
  if (resolved.origin !== JINAN_CMS_CONFIG.origin
      || !/^\/uploads?\//.test(resolved.pathname)
      || `${resolved.pathname}${resolved.search}${resolved.hash}` !== value) {
    throw cmsError(JINAN_CMS_RESULTS.FORM_CHANGED);
  }
  return value;
}

function exactHtmlDecodedUploadPath(value) {
  return validateRootRelativeUploadUrl(decodeHtml(value || ''));
}

function normalizeLegacyExistingImageSource(value) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 1024) {
    throw cmsError(JINAN_CMS_RESULTS.FORM_CHANGED);
  }
  let decoded = decodeHtml(value);
  if (decoded.length < 1
      || decoded.length > 1024
      || !/^\/uploads?\//.test(decoded)
      || decoded.startsWith('//')
      || /[?#]/.test(decoded)
      || /[\u0000-\u001f\u007f-\u009f\\]/.test(decoded)
      || /\/(?:\.|\.\.)(?:\/|$)/.test(decoded)
      || /%(?:2e|2f|3f|23|5c|00|0a|0d)/i.test(decoded)) {
    throw cmsError(JINAN_CMS_RESULTS.FORM_CHANGED);
  }

  const maxDecodeDepth = 8;
  for (let depth = 0; decoded.includes('%') && depth < maxDecodeDepth; depth += 1) {
    try {
      decoded = decodeURIComponent(decoded);
    } catch {
      throw cmsError(JINAN_CMS_RESULTS.FORM_CHANGED);
    }
    if (decoded.length > 1024
        || !/^\/uploads?\//.test(decoded)
        || decoded.startsWith('//')
        || /[?#]/.test(decoded)
        || /[\u0000-\u001f\u007f-\u009f\\]/.test(decoded)
        || /\/(?:\.|\.\.)(?:\/|$)/.test(decoded)
        || /%(?:2e|2f|3f|23|5c|00|0a|0d)/i.test(decoded)) {
      throw cmsError(JINAN_CMS_RESULTS.FORM_CHANGED);
    }
  }
  if (decoded.includes('%')) throw cmsError(JINAN_CMS_RESULTS.FORM_CHANGED);
  return decoded;
}

const RAW_TEXT_TAGS = Object.freeze(new Set([
  'script',
  'style',
  'template',
  'noscript',
  'textarea',
  'title',
  'xmp',
  'iframe',
  'noembed',
  'noframes',
]));

const VOID_TAGS = Object.freeze(new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]));

function findTagEnd(html, start) {
  let quote = null;
  for (let index = start + 1; index < html.length; index += 1) {
    const char = html[index];
    if (quote) {
      if (char === quote) quote = null;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === '>') {
      return index;
    }
  }
  throw cmsError(JINAN_CMS_RESULTS.FORM_CHANGED);
}

function parseHtmlTag(html, start) {
  const end = findTagEnd(html, start);
  const token = html.slice(start, end + 1);
  let index = 1;
  let isClosing = false;
  if (token[index] === '/') {
    isClosing = true;
    index += 1;
  }
  if (!/[A-Za-z]/.test(token[index] || '')) {
    return { kind: 'other', start, end: end + 1, token };
  }
  const nameStart = index;
  index += 1;
  while (/[A-Za-z0-9:.-]/.test(token[index] || '')) index += 1;
  const name = token.slice(nameStart, index).toLowerCase();
  const sourceEnd = token.length - 1;

  if (isClosing) {
    while (index < sourceEnd && isHtmlWhitespace(token[index])) index += 1;
    if (index !== sourceEnd) return { kind: 'malformed-close', start, end: end + 1, token, name };
    return { kind: 'tag', start, end: end + 1, token, name, isClosing, attrs: Object.create(null), attributes: [] };
  }

  const attrSource = token.slice(index, sourceEnd);
  const { attrs, attributes } = lexAttributeSequence(attrSource);
  return {
    kind: 'tag',
    start,
    end: end + 1,
    token,
    name,
    isClosing,
    isSelfClosing: /\/\s*$/.test(attrSource),
    attrOffset: start + index,
    attrs,
    attributes,
  };
}

function findRawTextClose(html, start, name) {
  const lower = html.toLowerCase();
  const needle = `</${name}`;
  let searchFrom = start;
  while (searchFrom < html.length) {
    const closeStart = lower.indexOf(needle, searchFrom);
    if (closeStart < 0) throw cmsError(JINAN_CMS_RESULTS.FORM_CHANGED);
    const closeTag = parseHtmlTag(html, closeStart);
    if (closeTag.kind === 'tag' && closeTag.isClosing && closeTag.name === name) return { start: closeStart, end: closeTag.end };
    if (closeTag.kind === 'malformed-close' && closeTag.name === name) {
      throw cmsError(JINAN_CMS_RESULTS.FORM_CHANGED);
    }
    searchFrom = closeStart + needle.length;
  }
  throw cmsError(JINAN_CMS_RESULTS.FORM_CHANGED);
}

function scanHtml(html, onVisibleTag, onExcluded, onRawText) {
  const source = String(html || '');
  const stack = [];
  let index = 0;
  while (index < source.length) {
    const tagStart = source.indexOf('<', index);
    if (tagStart < 0) break;
    if (source.startsWith('<!--', tagStart)) {
      const commentEnd = source.indexOf('-->', tagStart + 4);
      if (commentEnd < 0) throw cmsError(JINAN_CMS_RESULTS.FORM_CHANGED);
      if (onExcluded) onExcluded({ start: tagStart, end: commentEnd + 3 });
      index = commentEnd + 3;
      continue;
    }

    const tag = parseHtmlTag(source, tagStart);
    if (tag.kind === 'other') {
      index = tag.end;
      continue;
    }
    if (tag.kind === 'malformed-close') throw cmsError(JINAN_CMS_RESULTS.FORM_CHANGED);
    if (tag.isClosing) {
      const current = stack.pop();
      if (!current || current.name !== tag.name) throw cmsError(JINAN_CMS_RESULTS.FORM_CHANGED);
      if (onVisibleTag) onVisibleTag({ ...tag, hiddenByAncestor: current.hiddenByAncestor }, source);
      index = tag.end;
      continue;
    }
    if (tag.name === 'plaintext') throw cmsError(JINAN_CMS_RESULTS.FORM_CHANGED);
    if (!VOID_TAGS.has(tag.name) && tag.isSelfClosing) throw cmsError(JINAN_CMS_RESULTS.FORM_CHANGED);
    if (!tag.isClosing && RAW_TEXT_TAGS.has(tag.name)) {
      const close = findRawTextClose(source, tag.end, tag.name);
      if (onRawText) {
        onRawText({
          ...tag,
          inner: source.slice(tag.end, close.start),
          innerSpan: { start: tag.end, end: close.start },
          closeEnd: close.end,
        }, source);
      }
      if (onExcluded) onExcluded({ start: tagStart, end: close.end });
      index = close.end;
      continue;
    }
    const hiddenByAncestor = stack.some((entry) => entry.hidden);
    const visibleTag = { ...tag, hiddenByAncestor };
    if (onVisibleTag) onVisibleTag(visibleTag, source);
    if (!VOID_TAGS.has(tag.name) && !tag.isSelfClosing) {
      stack.push({ name: tag.name, hidden: hiddenByAncestor || isHiddenImage(tag.attrs), hiddenByAncestor });
    }
    index = tag.end;
  }
  if (stack.length > 0) throw cmsError(JINAN_CMS_RESULTS.FORM_CHANGED);
  return source;
}

function getRequiredSrcAttribute(tag) {
  const srcAttr = tag.attributes.find((attr) => attr.name === 'src');
  if (!srcAttr || srcAttr.quote === null) throw cmsError(JINAN_CMS_RESULTS.FORM_CHANGED);
  return srcAttr;
}

function isEmptyHtmlWhitespaceString(value) {
  return Array.from(String(value || '')).every(isHtmlWhitespace);
}

function isHiddenImage(attrs) {
  if (Object.prototype.hasOwnProperty.call(attrs, 'hidden')) return true;
  if (String(attrs['aria-hidden'] || '').trim().toLowerCase() === 'true') return true;
  if (Object.prototype.hasOwnProperty.call(attrs, 'style')
      && !isEmptyHtmlWhitespaceString(attrs.style)) return true;
  return false;
}

function isHiddenHtmlElement(attrs) {
  if (Object.prototype.hasOwnProperty.call(attrs, 'hidden')) return true;
  if (String(attrs['aria-hidden'] || '').trim().toLowerCase() === 'true') return true;
  if (Object.prototype.hasOwnProperty.call(attrs, 'style') && !isEmptyHtmlWhitespaceString(attrs.style)) {
    const declarations = normalizedCssDeclarations(attrs.style);
    return declarations.some((declaration) => (declaration.name === 'display' && declaration.value === 'none')
      || (declaration.name === 'visibility' && declaration.value === 'hidden')
      || (declaration.name === 'opacity' && declaration.value === '0'));
  }
  return false;
}

function collectHtmlSequenceTokens(source) {
  const html = String(source || '');
  const tokens = [];
  const stack = [];
  let index = 0;

  function parentKey() {
    return stack.map((entry) => `${entry.name}:${entry.start}`).join('/');
  }

  while (index < html.length) {
    const tagStart = html.indexOf('<', index);
    if (tagStart < 0) {
      if (index < html.length) {
        tokens.push({ kind: 'text', start: index, end: html.length, parentKey: parentKey(), depth: stack.length });
      }
      break;
    }
    if (tagStart > index) {
      tokens.push({ kind: 'text', start: index, end: tagStart, parentKey: parentKey(), depth: stack.length });
    }
    if (html.startsWith('<!--', tagStart)) {
      const commentEnd = html.indexOf('-->', tagStart + 4);
      if (commentEnd < 0) throw cmsError(JINAN_CMS_RESULTS.FORM_CHANGED);
      tokens.push({ kind: 'other', start: tagStart, end: commentEnd + 3, parentKey: parentKey(), depth: stack.length });
      index = commentEnd + 3;
      continue;
    }

    const tag = parseHtmlTag(html, tagStart);
    if (tag.kind === 'other') {
      tokens.push({ kind: 'other', start: tag.start, end: tag.end, parentKey: parentKey(), depth: stack.length });
      index = tag.end;
      continue;
    }
    if (tag.kind === 'malformed-close') throw cmsError(JINAN_CMS_RESULTS.FORM_CHANGED);
    if (tag.isClosing) {
      const current = stack.pop();
      if (!current || current.name !== tag.name) throw cmsError(JINAN_CMS_RESULTS.FORM_CHANGED);
      tokens.push({ kind: 'close', tag, start: tag.start, end: tag.end, parentKey: parentKey(), depth: stack.length });
      index = tag.end;
      continue;
    }
    if (tag.name === 'plaintext') throw cmsError(JINAN_CMS_RESULTS.FORM_CHANGED);
    if (!VOID_TAGS.has(tag.name) && tag.isSelfClosing) throw cmsError(JINAN_CMS_RESULTS.FORM_CHANGED);
    if (RAW_TEXT_TAGS.has(tag.name)) {
      const close = findRawTextClose(html, tag.end, tag.name);
      tokens.push({ kind: 'other', start: tag.start, end: close.end, parentKey: parentKey(), depth: stack.length });
      index = close.end;
      continue;
    }

    const hiddenByAncestor = stack.some((entry) => entry.hidden);
    const inLink = stack.some((entry) => entry.name === 'a');
    tokens.push({
      kind: 'tag',
      tag: { ...tag, hiddenByAncestor },
      start: tag.start,
      end: tag.end,
      parentKey: parentKey(),
      depth: stack.length,
      inLink,
    });
    if (!VOID_TAGS.has(tag.name) && !tag.isSelfClosing) {
      stack.push({ name: tag.name, start: tag.start, hidden: hiddenByAncestor || isHiddenHtmlElement(tag.attrs) });
    }
    index = tag.end;
  }
  if (stack.length > 0) throw cmsError(JINAN_CMS_RESULTS.FORM_CHANGED);
  return tokens;
}

function normalizedCssDeclarations(value) {
  const style = String(value || '').trim();
  if (!style) return [];
  if (style.includes('/*') || style.includes('*/') || style.includes('\\')) {
    throw cmsError(JINAN_CMS_RESULTS.FORM_CHANGED);
  }
  return style
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const colon = part.indexOf(':');
      if (colon <= 0 || part.indexOf(':', colon + 1) !== -1) throw cmsError(JINAN_CMS_RESULTS.FORM_CHANGED);
      return {
        name: part.slice(0, colon).trim().toLowerCase(),
        value: part.slice(colon + 1).trim().toLowerCase().replace(/\s+/g, ' '),
      };
    });
}

function isExactTextCenterStyle(value) {
  const declarations = normalizedCssDeclarations(value);
  return declarations.length === 1
    && declarations[0].name === 'text-align'
    && declarations[0].value === 'center';
}

function isWidthHeightOnlyStyle(value) {
  const declarations = normalizedCssDeclarations(value);
  if (declarations.length !== 2) return false;
  const byName = Object.fromEntries(declarations.map((declaration) => [declaration.name, declaration.value]));
  return Object.keys(byName).length === 2
    && byName.width === '1280px'
    && byName.height === '720px';
}

function classListContains(attrs, expected) {
  return String(attrs.class || '').split(/\s+/).filter(Boolean).includes(expected);
}

function imageTokenInfo(token, { legacyExistingSource = false } = {}) {
  if (token.kind !== 'tag' || token.tag.name !== 'img' || token.tag.isClosing) return null;
  const srcAttr = getRequiredSrcAttribute(token.tag);
  return {
    token,
    src: legacyExistingSource ? normalizeLegacyExistingImageSource(srcAttr.value) : exactHtmlDecodedUploadPath(srcAttr.value),
  };
}

function imageTokenSafeForAnchoredTimetable(image, allowLegacyDimensions) {
  const attrs = image.token.tag.attrs;
  if (image.token.inLink) return false;
  if (Object.prototype.hasOwnProperty.call(attrs, 'hidden')) return false;
  if (String(attrs['aria-hidden'] || '').trim().toLowerCase() === 'true') return false;
  if (Object.prototype.hasOwnProperty.call(attrs, 'style') && !isEmptyHtmlWhitespaceString(attrs.style)) {
    if (!allowLegacyDimensions || !isWidthHeightOnlyStyle(attrs.style)) return false;
  }
  if (!image.src || !/^\/uploads?\//.test(image.src)) return false;
  return true;
}

function findDirectCloseToken(tokens, openToken) {
  return tokens.find((token) => token.kind === 'close'
    && token.tag.name === openToken.tag.name
    && token.parentKey === openToken.parentKey
    && token.depth === openToken.depth);
}

function tokenParentKey(token) {
  return token.parentKey
    ? `${token.parentKey}/${token.tag.name}:${token.start}`
    : `${token.tag.name}:${token.start}`;
}

function isHiddenOrActivePrefixTag(tag) {
  const attrs = tag.attrs || Object.create(null);
  if (tag.hiddenByAncestor) return true;
  if (Object.prototype.hasOwnProperty.call(attrs, 'hidden')) return true;
  if (String(attrs['aria-hidden'] || '').trim().toLowerCase() === 'true') return true;
  for (const attr of tag.attributes || []) {
    if (attr.name.startsWith('on')) return true;
  }
  return false;
}

function isSafeTimetablePrefixStyle(tagName, value) {
  const declarations = normalizedCssDeclarations(value);
  if (declarations.length === 0) return true;
  if (tagName === 'br') return false;
  const allowed = new Set(['font-size', 'color', 'caret-color', 'background-color']);
  return declarations.every((declaration) => allowed.has(declaration.name)
    && !/(?:url|expression|javascript|behavior|-moz-binding|display\s*:|visibility\s*:|opacity\s*:)/i.test(declaration.value));
}

function normalizeTimetableVisibleLine(value) {
  return String(value || '').replace(/[\s\u00a0]+/g, '');
}

function assertConfirmedTimetablePrefixGrammar(lines) {
  const visibleLines = lines.map(normalizeTimetableVisibleLine).filter((line) => line !== '');
  let index = 0;
  while (index < visibleLines.length && TIMETABLE_SEPARATOR_RE.test(visibleLines[index])) {
    index += 1;
  }
  if (visibleLines[index] === TIMETABLE_REMINDER_TEXT) index += 1;
  if (!TIMETABLE_HEADING_RE.test(visibleLines[index] || '')) {
    throw cmsError(JINAN_CMS_RESULTS.FORM_CHANGED);
  }
  index += 1;
  if (index !== visibleLines.length) throw cmsError(JINAN_CMS_RESULTS.FORM_CHANGED);
}

function validateTimetablePrefix(source, tokens, pToken, close, firstImage) {
  let hasPrefixBreak = false;
  const visibleLines = [''];
  const allowedTags = new Set(['span', 'strong', 'br']);
  for (const candidate of tokens) {
    if (candidate.start < pToken.end || candidate.end > firstImage.token.start) continue;
    if (candidate.kind === 'text') {
      visibleLines[visibleLines.length - 1] += decodeHtml(source.slice(candidate.start, candidate.end));
      continue;
    }
    if (candidate.kind !== 'tag' && candidate.kind !== 'close') {
      throw cmsError(JINAN_CMS_RESULTS.FORM_CHANGED);
    }
    const tag = candidate.tag;
    if (!tag || !allowedTags.has(tag.name)) throw cmsError(JINAN_CMS_RESULTS.FORM_CHANGED);
    if (tag.name === 'br' && !tag.isClosing) {
      hasPrefixBreak = true;
      visibleLines.push('');
    }
    if (!tag.isClosing) {
      if (isHiddenOrActivePrefixTag(tag)) throw cmsError(JINAN_CMS_RESULTS.FORM_CHANGED);
      if (Object.prototype.hasOwnProperty.call(tag.attrs, 'style') && !isSafeTimetablePrefixStyle(tag.name, tag.attrs.style)) {
        throw cmsError(JINAN_CMS_RESULTS.FORM_CHANGED);
      }
      for (const attr of tag.attributes || []) {
        if (!['style', 'class'].includes(attr.name)) throw cmsError(JINAN_CMS_RESULTS.FORM_CHANGED);
      }
    }
  }
  if (!hasPrefixBreak) throw cmsError(JINAN_CMS_RESULTS.FORM_CHANGED);
  assertConfirmedTimetablePrefixGrammar(visibleLines);
  if (firstImage.token.start <= pToken.end || firstImage.token.end > close.start) throw cmsError(JINAN_CMS_RESULTS.FORM_CHANGED);
}

function findDirectTailTimetableImages(source, direct, close) {
  let index = direct.length - 1;
  while (index >= 0) {
    const candidate = direct[index];
    if (candidate.kind === 'close') {
      index -= 1;
      continue;
    }
    if (candidate.kind === 'text' && isEmptyHtmlWhitespaceString(source.slice(candidate.start, candidate.end))) {
      index -= 1;
      continue;
    }
    break;
  }
  if (index < 0) return null;

  const last = direct[index];
  const lastImage = imageTokenInfo(last, { legacyExistingSource: true });
  if (!lastImage) return null;

  const tail = [];
  let tailStartIndex = index;
  for (; tailStartIndex >= 0; tailStartIndex -= 1) {
    const candidate = direct[tailStartIndex];
    if (candidate.kind === 'text' && isEmptyHtmlWhitespaceString(source.slice(candidate.start, candidate.end))) {
      tail.unshift(candidate);
      continue;
    }
    if (candidate.kind !== 'tag') break;
    if (candidate.tag.name === 'br' || candidate.tag.name === 'img') {
      tail.unshift(candidate);
      continue;
    }
    break;
  }
  tailStartIndex += 1;
  while (tail.length > 0) {
    const candidate = tail[0];
    if (candidate.kind === 'text' || (candidate.kind === 'tag' && candidate.tag.name === 'br')) {
      tail.shift();
      tailStartIndex += 1;
      continue;
    }
    break;
  }

  const images = [];
  let previousSignificant = null;
  for (const candidate of tail) {
    if (candidate.kind === 'text') continue;
    if (candidate.kind !== 'tag' || !['img', 'br'].includes(candidate.tag.name)) {
      throw cmsError(JINAN_CMS_RESULTS.FORM_CHANGED);
    }
    if (candidate.tag.name === 'img') {
      const image = imageTokenInfo(candidate, { legacyExistingSource: true });
      if (!image || !imageTokenSafeForAnchoredTimetable(image, images.length === 0)) {
        throw cmsError(JINAN_CMS_RESULTS.FORM_CHANGED);
      }
      images.push(image);
      previousSignificant = 'img';
      continue;
    }
    if (images.length === 0) throw cmsError(JINAN_CMS_RESULTS.FORM_CHANGED);
    previousSignificant = 'br';
  }

  if (images.length < 1 || previousSignificant !== 'img') throw cmsError(JINAN_CMS_RESULTS.FORM_CHANGED);
  if (!isEmptyHtmlWhitespaceString(source.slice(images[images.length - 1].token.end, close.start))) {
    throw cmsError(JINAN_CMS_RESULTS.FORM_CHANGED);
  }
  return { images, tailStartIndex };
}

function findAnchoredTimetableImageCollection(source, tokens) {
  const candidates = [];
  const anchoredParents = tokens.filter((token) => token.kind === 'tag'
    && token.tag.name === 'p'
    && !token.tag.isClosing
    && !token.tag.hiddenByAncestor
    && classListContains(token.tag.attrs, 'text-center')
    && Object.prototype.hasOwnProperty.call(token.tag.attrs, 'style')
    && isExactTextCenterStyle(token.tag.attrs.style));
  if (anchoredParents.length !== 1) throw cmsError(JINAN_CMS_RESULTS.FORM_CHANGED);

  for (const token of anchoredParents) {
    const pKey = tokenParentKey(token);
    const close = findDirectCloseToken(tokens, token);
    if (!close) throw cmsError(JINAN_CMS_RESULTS.FORM_CHANGED);
    const direct = tokens.filter((candidate) => candidate.parentKey === pKey && candidate.depth === token.depth + 1);
    const tail = findDirectTailTimetableImages(source, direct, close);
    if (!tail) continue;
    const prefixDirect = direct.slice(0, tail.tailStartIndex);
    if (!prefixDirect.some((candidate) => candidate.kind === 'tag' && candidate.tag.name === 'br')) {
      throw cmsError(JINAN_CMS_RESULTS.FORM_CHANGED);
    }
    validateTimetablePrefix(source, tokens, token, close, tail.images[0]);
    candidates.push({
      start: tail.images[0].token.start,
      end: tail.images[tail.images.length - 1].token.end,
      oldImageUrls: tail.images.map((image) => image.src),
      parentKey: pKey,
    });
  }

  if (candidates.length !== 1) throw cmsError(JINAN_CMS_RESULTS.FORM_CHANGED);
  return candidates[0];
}

function findSingleTimetableImageCollection(source) {
  const html = String(source || '');
  const tokens = collectHtmlSequenceTokens(html);
  return findAnchoredTimetableImageCollection(html, tokens);
}

function captureTimetableBaseline(html) {
  const source = String(html || '');
  const collection = findSingleTimetableImageCollection(source);
  return {
    source,
    collectionHtml: source.slice(collection.start, collection.end),
    oldImageUrls: collection.oldImageUrls,
    start: collection.start,
    end: collection.end,
  };
}

function sameCollectionStructure(left, right) {
  return Array.isArray(left?.oldImageUrls)
    && Array.isArray(right?.oldImageUrls)
    && left.collectionHtml === right.collectionHtml
    && left.oldImageUrls.length === right.oldImageUrls.length
    && left.oldImageUrls.every((value, index) => value === right.oldImageUrls[index]);
}

function assertEditorMatchesPublicBaseline(editorNote, publicBaseline) {
  const editorBaseline = captureTimetableBaseline(editorNote);
  if (!sameCollectionStructure(editorBaseline, publicBaseline)) {
    throw cmsError(JINAN_CMS_RESULTS.FORM_CHANGED);
  }
  let occurrences = 0;
  let cursor = 0;
  while (cursor <= publicBaseline.source.length) {
    const index = publicBaseline.source.indexOf(editorNote, cursor);
    if (index < 0) break;
    occurrences += 1;
    cursor = index + editorNote.length;
  }
  if (occurrences !== 1) throw cmsError(JINAN_CMS_RESULTS.FORM_CHANGED);
  return editorBaseline;
}

function canonicalSourceRepresentations(source) {
  const representations = [];
  let decoded = decodeHtml(source);
  representations.push(decoded);
  for (let depth = 0; decoded.includes('%') && depth < 8; depth += 1) {
    try {
      decoded = decodeURIComponent(decoded);
    } catch {
      if (/\/uploads?\/|%(?:2f|5c)?uploads?(?:%2f|\/)/i.test(decoded)) {
        throw cmsError(JINAN_CMS_RESULTS.FORM_CHANGED);
      }
      break;
    }
    if (decoded.length > 1024 * 1024) throw cmsError(JINAN_CMS_RESULTS.FORM_CHANGED);
    representations.push(decoded);
  }
  if (decoded.includes('%') && /\/uploads?\/|%(?:2f|5c)?uploads?(?:%2f|\/)/i.test(decoded)) {
    throw cmsError(JINAN_CMS_RESULTS.FORM_CHANGED);
  }
  return representations;
}

function assertNoLegacyImageResidue(source, oldImageUrls) {
  const oldIdentities = new Set((oldImageUrls || []).map((value) => normalizeLegacyExistingImageSource(value)));
  scanHtml(source);
  for (const representation of canonicalSourceRepresentations(String(source || ''))) {
    for (const identity of oldIdentities) {
      if (representation.includes(identity)) {
        throw cmsError(JINAN_CMS_RESULTS.FORM_CHANGED);
      }
    }
  }
}

function inspectPublishedPublic({ response, baseline, savedTargetUrl }) {
  const failClosed = { status: JINAN_CMS_RESULTS.CMS_RESPONSE_CONTRACT_UNVERIFIED };
  let target;
  try {
    target = validateRootRelativeUploadUrl(savedTargetUrl);
  } catch {
    return failClosed;
  }
  if (!baseline || !Array.isArray(baseline.oldImageUrls)) return failClosed;
  if (response?.status !== 200 || !exactFinalUrl(response, JINAN_CMS_CONFIG.publicUrl) || hasLocation(response)) return failClosed;

  const body = String(response?.body || '');
  const before = baseline.source.slice(0, baseline.start);
  const after = baseline.source.slice(baseline.end);
  if (!body.startsWith(before) || !body.endsWith(after)) return failClosed;
  const replacement = body.slice(before.length, body.length - after.length);
  try {
    assertNoLegacyImageResidue(body, baseline.oldImageUrls);
  } catch {
    return failClosed;
  }

  let visibleTargetImages = 0;
  try {
    const tokens = collectHtmlSequenceTokens(replacement);
    for (const token of tokens) {
      if (token.kind === 'text' && isEmptyHtmlWhitespaceString(replacement.slice(token.start, token.end))) continue;
      const image = imageTokenInfo(token);
      if (!image) throw cmsError(JINAN_CMS_RESULTS.FORM_CHANGED);
      if (image.src !== target) throw cmsError(JINAN_CMS_RESULTS.FORM_CHANGED);
      if (token.tag.hiddenByAncestor || isHiddenImage(token.tag.attrs)) throw cmsError(JINAN_CMS_RESULTS.FORM_CHANGED);
      visibleTargetImages += 1;
    }
  } catch {
    return failClosed;
  }
  if (visibleTargetImages !== 1) return failClosed;
  return { status: JINAN_CMS_RESULTS.ALREADY_PUBLISHED };
}

function imageResourceUrl(pathname) {
  const target = validateRootRelativeUploadUrl(pathname);
  return new URL(target, JINAN_CMS_CONFIG.origin).href;
}

function inspectImageResource({ response, expectedUrl }) {
  const failClosed = { status: JINAN_CMS_RESULTS.CMS_RESPONSE_CONTRACT_UNVERIFIED };
  if (response?.status !== 200 || hasLocation(response)) return failClosed;
  if (!exactFinalUrl(response, expectedUrl)) return failClosed;
  if (contentTypeMime(response) !== 'image/png') return failClosed;
  const bytes = Buffer.isBuffer(response?.bytes)
    ? response.bytes
    : (Buffer.isBuffer(response?.body) ? response.body : null);
  if (!bytes || bytes.length === 0) return failClosed;
  try {
    parsePngDataUrl(`data:image/png;base64,${bytes.toString('base64')}`);
  } catch {
    return failClosed;
  }
  return { status: JINAN_CMS_RESULTS.ALREADY_PUBLISHED };
}

function buildSubmitRequest(parsedForm, finalImageUrl) {
  const target = validateRootRelativeUploadUrl(finalImageUrl);
  const fields = { ...(parsedForm && parsedForm.fields) };
  const note = fields.note;
  if (typeof note !== 'string') throw cmsError(JINAN_CMS_RESULTS.FORM_CHANGED);
  const collection = findSingleTimetableImageCollection(note);
  const rewrittenNote = `${note.slice(0, collection.start)}<img src="${target}" />${note.slice(collection.end)}`;
  assertNoLegacyImageResidue(rewrittenNote, collection.oldImageUrls);
  if ((rewrittenNote.match(new RegExp(target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length !== 1) {
    throw cmsError(JINAN_CMS_RESULTS.FORM_CHANGED);
  }
  fields.note = rewrittenNote;
  return {
    method: 'POST',
    url: JINAN_CMS_CONFIG.editorUrl,
    multipartFields: fields,
  };
}

function buildUploadRequest({ png, callbackNumber }) {
  if (!Number.isInteger(callbackNumber) || callbackNumber < 0) {
    throw cmsError(JINAN_CMS_RESULTS.FORM_CHANGED);
  }
  const content = Buffer.isBuffer(png) ? Buffer.from(png) : Buffer.from(png || '');
  const url = new URL(JINAN_CMS_CONFIG.quickUploadUrl);
  url.searchParams.set('command', 'QuickUpload');
  url.searchParams.set('type', 'Images');
  url.searchParams.set('CKEditor', 'note');
  url.searchParams.set('CKEditorFuncNum', String(callbackNumber));
  url.searchParams.set('langCode', 'zh');
  return {
    method: 'POST',
    url: url.href,
    multipartFieldName: 'upload',
    file: {
      filename: 'jinan-clinic-timetable-composite.png',
      contentType: 'image/png',
      byteLength: content.length,
      content,
    },
  };
}

function is2xx(response) {
  return Number.isInteger(response?.status) && response.status >= 200 && response.status < 300;
}

function is3xx(response) {
  return Number.isInteger(response?.status) && response.status >= 300 && response.status < 400;
}

function headerValue(headers, name) {
  if (!headers) return null;
  if (typeof headers.get === 'function') return headers.get(name);
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lower) return value;
  }
  return null;
}

function locationValue(response) {
  if (response?.location !== null && response?.location !== undefined) return response.location;
  return headerValue(response?.headers, 'location');
}

function contentTypeMime(response) {
  return String(response?.contentType || headerValue(response?.headers, 'content-type') || '')
    .split(';')[0]
    .trim()
    .toLowerCase();
}

function skipWs(source, index) {
  let cursor = index;
  while (/\s/.test(source[cursor] || '')) cursor += 1;
  return cursor;
}

function parseJsStringLiteral(source, start) {
  const quote = source[start];
  if (quote !== '"' && quote !== "'") throw cmsError(JINAN_CMS_RESULTS.FORM_CHANGED);
  let value = '';
  let index = start + 1;
  while (index < source.length) {
    const char = source[index];
    if (char === quote) return { value, end: index + 1 };
    if (/[\u0000-\u001f\u007f-\u009f]/.test(char)) throw cmsError(JINAN_CMS_RESULTS.FORM_CHANGED);
    if (char !== '\\') {
      value += char;
      index += 1;
      continue;
    }
    index += 1;
    const escaped = source[index];
    if (escaped === undefined) throw cmsError(JINAN_CMS_RESULTS.FORM_CHANGED);
    if (escaped === 'u') {
      const hex = source.slice(index + 1, index + 5);
      if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw cmsError(JINAN_CMS_RESULTS.FORM_CHANGED);
      const codePoint = Number.parseInt(hex, 16);
      if (codePoint === 0 || (codePoint >= 0x80 && codePoint <= 0x9f) || (codePoint >= 0xd800 && codePoint <= 0xdfff)) {
        throw cmsError(JINAN_CMS_RESULTS.FORM_CHANGED);
      }
      value += String.fromCharCode(codePoint);
      index += 5;
      continue;
    }
    const escapes = { '"': '"', "'": "'", '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };
    if (!Object.prototype.hasOwnProperty.call(escapes, escaped)) throw cmsError(JINAN_CMS_RESULTS.FORM_CHANGED);
    value += escapes[escaped];
    index += 1;
  }
  throw cmsError(JINAN_CMS_RESULTS.FORM_CHANGED);
}

function unwrapOptionalScript(source) {
  const trimmed = String(source || '').trim();
  const openMatch = /^<script\b([^>]*)>/i.exec(trimmed);
  if (!openMatch) return trimmed;
  let attrs;
  try {
    attrs = parseAttributes(openMatch[1]);
  } catch {
    throw cmsError(JINAN_CMS_RESULTS.FORM_CHANGED);
  }
  const attrNames = Object.keys(attrs);
  if (attrNames.some((name) => name !== 'type')) throw cmsError(JINAN_CMS_RESULTS.FORM_CHANGED);
  if (Object.prototype.hasOwnProperty.call(attrs, 'src')) throw cmsError(JINAN_CMS_RESULTS.FORM_CHANGED);
  if (attrs.type && String(attrs.type).trim().toLowerCase() !== 'text/javascript') {
    throw cmsError(JINAN_CMS_RESULTS.FORM_CHANGED);
  }
  const close = trimmed.toLowerCase().lastIndexOf('</script>');
  if (close < openMatch[0].length) throw cmsError(JINAN_CMS_RESULTS.FORM_CHANGED);
  const suffix = trimmed.slice(close + '</script>'.length).trim();
  if (suffix !== '' && suffix !== ';') throw cmsError(JINAN_CMS_RESULTS.FORM_CHANGED);
  if (trimmed.slice(close + '</script>'.length).trim().includes('<')) throw cmsError(JINAN_CMS_RESULTS.FORM_CHANGED);
  return trimmed.slice(openMatch[0].length, close).trim();
}

function parseUploadResponse(response, expectedRequestUrl, expectedCallbackNumber = 0) {
  if (!is2xx(response)) return { status: JINAN_CMS_RESULTS.UPLOAD_FAILED };
  if (response.status !== 200
      || contentTypeMime(response) !== 'text/html'
      || !exactFinalUrl(response, expectedRequestUrl)
      || hasLocation(response)) {
    return { status: JINAN_CMS_RESULTS.CMS_RESPONSE_CONTRACT_UNVERIFIED };
  }
  try {
    const source = unwrapOptionalScript(response.body);
    const prefix = 'window.parent.CKEDITOR.tools.callFunction';
    if (!source.startsWith(prefix)) throw cmsError(JINAN_CMS_RESULTS.FORM_CHANGED);
    let index = skipWs(source, prefix.length);
    if (source[index] !== '(') throw cmsError(JINAN_CMS_RESULTS.FORM_CHANGED);
    index = skipWs(source, index + 1);
    const numberMatch = /^(?:0|[1-9][0-9]*)/.exec(source.slice(index));
    if (!numberMatch) throw cmsError(JINAN_CMS_RESULTS.FORM_CHANGED);
    const callbackNumber = Number.parseInt(numberMatch[0], 10);
    if (callbackNumber !== expectedCallbackNumber) throw cmsError(JINAN_CMS_RESULTS.FORM_CHANGED);
    index = skipWs(source, index + numberMatch[0].length);
    if (source[index] !== ',') throw cmsError(JINAN_CMS_RESULTS.FORM_CHANGED);
    index = skipWs(source, index + 1);
    const urlLiteral = parseJsStringLiteral(source, index);
    const finalImageUrl = validateRootRelativeUploadUrl(urlLiteral.value);
    index = skipWs(source, urlLiteral.end);
    if (source[index] !== ',') throw cmsError(JINAN_CMS_RESULTS.FORM_CHANGED);
    index = skipWs(source, index + 1);
    const messageLiteral = parseJsStringLiteral(source, index);
    if (messageLiteral.value !== '') throw cmsError(JINAN_CMS_RESULTS.FORM_CHANGED);
    index = skipWs(source, messageLiteral.end);
    if (source[index] !== ')') throw cmsError(JINAN_CMS_RESULTS.FORM_CHANGED);
    index = skipWs(source, index + 1);
    if (source[index] === ';') index = skipWs(source, index + 1);
    if (index !== source.length) throw cmsError(JINAN_CMS_RESULTS.FORM_CHANGED);
    return { status: JINAN_CMS_RESULTS.UPLOAD_SUCCEEDED, finalImageUrl };
  } catch {
    return { status: JINAN_CMS_RESULTS.CMS_RESPONSE_CONTRACT_UNVERIFIED };
  }
}

function parseSubmitResponse(response, expectedRequestUrl = JINAN_CMS_CONFIG.editorUrl) {
  if (!is2xx(response) && !is3xx(response)) return { status: JINAN_CMS_RESULTS.SUBMIT_FAILED };
  if (response?.status !== 302 || !exactFinalUrl(response, expectedRequestUrl)) {
    return { status: JINAN_CMS_RESULTS.CMS_RESPONSE_CONTRACT_UNVERIFIED };
  }
  const raw = String(response.location || '').trim();
  if (!raw || raw.startsWith('//')) return { status: JINAN_CMS_RESULTS.CMS_RESPONSE_CONTRACT_UNVERIFIED };
  try {
    const location = new URL(raw, JINAN_CMS_CONFIG.origin);
    if (location.protocol !== 'https:'
        || location.origin !== JINAN_CMS_CONFIG.origin
        || location.pathname !== '/admin/index.php'
        || location.hash !== '') {
      return { status: JINAN_CMS_RESULTS.CMS_RESPONSE_CONTRACT_UNVERIFIED };
    }
    for (const [name, expected] of [['op', 'time'], ['sub', 'set'], ['mesCode', '1']]) {
      const values = location.searchParams.getAll(name);
      if (values.length !== 1 || values[0] !== expected) {
        return { status: JINAN_CMS_RESULTS.CMS_RESPONSE_CONTRACT_UNVERIFIED };
      }
    }
    return { status: JINAN_CMS_RESULTS.SUBMIT_SUCCEEDED };
  } catch {
    return { status: JINAN_CMS_RESULTS.CMS_RESPONSE_CONTRACT_UNVERIFIED };
  }
}

function createCookieJar() {
  const cookies = new Map();
  let sequence = 0;

  function defaultPath(pathname) {
    if (!pathname || !pathname.startsWith('/')) return '/';
    if (pathname === '/') return '/';
    const index = pathname.lastIndexOf('/');
    return index <= 0 ? '/' : pathname.slice(0, index);
  }

  function pathMatches(cookiePath, requestPath) {
    if (cookiePath === '/') return true;
    if (requestPath === cookiePath) return true;
    return requestPath.startsWith(cookiePath.endsWith('/') ? cookiePath : `${cookiePath}/`);
  }

  return {
    ingest(requestUrl, setCookie) {
      const url = new URL(requestUrl);
      for (const header of setCookie || []) {
        const parts = String(header || '').split(';');
        const first = parts.shift();
        const index = first.indexOf('=');
        if (index <= 0) continue;
        const attrs = Object.create(null);
        for (const part of parts) {
          const attrIndex = part.indexOf('=');
          const name = part.slice(0, attrIndex < 0 ? undefined : attrIndex).trim().toLowerCase();
          const value = attrIndex < 0 ? '' : part.slice(attrIndex + 1).trim();
          attrs[name] = value;
        }

        const name = first.slice(0, index).trim();
        if (!name) continue;
        const path = attrs.path && attrs.path.startsWith('/') ? attrs.path : defaultPath(url.pathname);
        const key = `${url.hostname}\n${path}\n${name}`;
        const maxAge = attrs['max-age'] !== undefined ? Number.parseInt(attrs['max-age'], 10) : null;
        const expiresAt = attrs.expires ? Date.parse(attrs.expires) : null;
        if (maxAge !== null && maxAge <= 0) {
          cookies.delete(key);
          continue;
        }
        if (expiresAt !== null && Number.isFinite(expiresAt) && expiresAt <= Date.now()) {
          cookies.delete(key);
          continue;
        }
        cookies.set(key, {
          host: url.hostname,
          path,
          name,
          value: first.slice(index + 1),
          secure: Object.prototype.hasOwnProperty.call(attrs, 'secure'),
          expiresAt: Number.isFinite(expiresAt) ? expiresAt : null,
          created: sequence,
        });
        sequence += 1;
      }
    },
    header(requestUrl) {
      const url = new URL(requestUrl);
      const now = Date.now();
      const eligible = [];
      for (const [key, cookie] of cookies) {
        if (cookie.expiresAt !== null && cookie.expiresAt <= now) {
          cookies.delete(key);
          continue;
        }
        if (cookie.host !== url.hostname) continue;
        if (cookie.secure && url.protocol !== 'https:') continue;
        if (!pathMatches(cookie.path, url.pathname)) continue;
        eligible.push(cookie);
      }
      eligible.sort((a, b) => b.path.length - a.path.length || a.created - b.created);
      return eligible.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
    },
  };
}

function normalizeResponse(response) {
  return {
    status: response?.status,
    finalUrl: response?.finalUrl,
    body: response?.body ?? response?.html ?? '',
    bytes: response?.bytes || (Buffer.isBuffer(response?.body) ? response.body : null),
    setCookie: response?.setCookie || response?.['set-cookie'] || response?.headers?.['set-cookie'] || [],
    location: locationValue(response),
    contentType: response?.contentType || headerValue(response?.headers, 'content-type') || null,
  };
}

async function sendWithCookies(transport, jar, request) {
  const headers = { ...(request.headers || {}) };
  const cookie = jar.header(request.url);
  if (cookie) headers.cookie = cookie;
  const raw = typeof transport === 'function'
    ? await transport({ ...request, headers })
    : await transport.request({ ...request, headers });
  const response = normalizeResponse(raw);
  jar.ingest(request.url, Array.isArray(response.setCookie) ? response.setCookie : [response.setCookie]);
  return response;
}

function buildLoginPost(username, password) {
  const body = new URLSearchParams();
  body.set('mode', 'login');
  body.set('username', username);
  body.set('password', password);
  return {
    method: 'POST',
    url: JINAN_CMS_CONFIG.loginUrl,
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  };
}

function isLoginUrl(finalUrl) {
  try {
    return new URL(finalUrl).href === JINAN_CMS_CONFIG.loginUrl;
  } catch {
    return false;
  }
}

function exactFinalUrl(response, expected) {
  try {
    return new URL(response.finalUrl).href === expected;
  } catch {
    return false;
  }
}

function validateLoginPostResponse(response) {
  if (response?.status !== 302) {
    throw loginDiagnosticError(
      JINAN_CMS_LOGIN_DIAGNOSTIC_REASON_CODES.LOGIN_POST_STATUS_MISMATCH,
    );
  }
  if (response?.finalUrl !== JINAN_CMS_CONFIG.loginUrl) {
    throw loginDiagnosticError(
      JINAN_CMS_LOGIN_DIAGNOSTIC_REASON_CODES.LOGIN_POST_FINAL_URL_MISMATCH,
    );
  }
  if (response?.location !== '/admin/index.php') {
    throw loginDiagnosticError(
      JINAN_CMS_LOGIN_DIAGNOSTIC_REASON_CODES.LOGIN_POST_LOCATION_MISMATCH,
    );
  }
}

function validateLoginSuccessLandingResponse(response) {
  if (response?.status !== 200) {
    throw loginDiagnosticError(
      JINAN_CMS_LOGIN_DIAGNOSTIC_REASON_CODES.LOGIN_LANDING_STATUS_MISMATCH,
    );
  }
  if (response?.finalUrl !== LOGIN_SUCCESS_LANDING_URL) {
    throw loginDiagnosticError(
      JINAN_CMS_LOGIN_DIAGNOSTIC_REASON_CODES.LOGIN_LANDING_URL_MISMATCH,
    );
  }
  if (hasRawLocation(response)) {
    throw loginDiagnosticError(
      JINAN_CMS_LOGIN_DIAGNOSTIC_REASON_CODES.LOGIN_LANDING_REDIRECT_DRIFT,
    );
  }
}

function isRecognizedCredentialRejection(response) {
  if (response?.status !== 200
      || response?.finalUrl !== JINAN_CMS_CONFIG.loginUrl
      || hasRawLocation(response)) {
    return false;
  }
  try {
    parseLoginForm(response.body);
    return true;
  } catch {
    return false;
  }
}

async function followLoginSuccessLanding(transport, jar, username, password) {
  const loginPostResponse = await sendWithCookies(transport, jar, buildLoginPost(username, password));
  if (isRecognizedCredentialRejection(loginPostResponse)) {
    throw cmsError(JINAN_CMS_RESULTS.AUTH_FAILED);
  }
  validateLoginPostResponse(loginPostResponse);
  const landingResponse = await sendWithCookies(transport, jar, {
    method: 'GET',
    url: LOGIN_SUCCESS_LANDING_URL,
  });
  validateLoginSuccessLandingResponse(landingResponse);
  return landingResponse;
}

function hasLocation(response) {
  return response?.location !== null
    && response?.location !== undefined
    && String(response.location).trim() !== '';
}

function hasRawLocation(response) {
  return response?.location !== null
    && response?.location !== undefined;
}

function locationIsExactLoginUrl(location) {
  const raw = String(location || '').trim();
  if (!raw || raw.startsWith('//')) return false;
  let locationUrl;
  try {
    locationUrl = new URL(raw, JINAN_CMS_CONFIG.editorUrl);
  } catch {
    return false;
  }
  return (locationUrl.protocol === 'http:' || locationUrl.protocol === 'https:')
    && locationUrl.href === JINAN_CMS_CONFIG.loginUrl;
}

function classifyEditorResponse(response) {
  if (is3xx(response)) {
    if (!exactFinalUrl(response, JINAN_CMS_CONFIG.editorUrl)) return JINAN_CMS_RESULTS.VERIFY_FAILED;
    return locationIsExactLoginUrl(response.location)
      ? JINAN_CMS_RESULTS.AUTH_FAILED
      : JINAN_CMS_RESULTS.VERIFY_FAILED;
  }
  if (hasLocation(response)) return JINAN_CMS_RESULTS.VERIFY_FAILED;
  if (isLoginUrl(response?.finalUrl)) return JINAN_CMS_RESULTS.AUTH_FAILED;
  if (is2xx(response) && exactFinalUrl(response, JINAN_CMS_CONFIG.editorUrl) && !hasLocation(response)) {
    return null;
  }
  return JINAN_CMS_RESULTS.VERIFY_FAILED;
}

async function preflightJinanCmsPublish(options) {
  const env = options?.env || process.env;
  const transport = options?.transport || createDefaultFetchTransport();
  const username = env[JINAN_CMS_CONFIG.usernameEnvName];
  const password = env[JINAN_CMS_CONFIG.passwordEnvName];
  const jar = createCookieJar();
  let png;

  try {
    png = parsePngDataUrl(options?.pngDataUrl).png;
  } catch {
    return { status: JINAN_CMS_RESULTS.VERIFY_FAILED };
  }
  if (!username || !password) return { status: JINAN_CMS_RESULTS.AUTH_FAILED };

  let publicResponse;
  let publicBaseline;
  let loginPageResponse;
  let editorResponse;
  try {
    publicResponse = await sendWithCookies(transport, jar, { method: 'GET', url: JINAN_CMS_CONFIG.publicUrl });
    if (!is2xx(publicResponse) || !exactFinalUrl(publicResponse, JINAN_CMS_CONFIG.publicUrl)) {
      return { status: JINAN_CMS_RESULTS.VERIFY_FAILED };
    }
    publicBaseline = captureTimetableBaseline(publicResponse.body);
    loginPageResponse = await sendWithCookies(transport, jar, { method: 'GET', url: JINAN_CMS_CONFIG.loginUrl });
    if (!is2xx(loginPageResponse) || !exactFinalUrl(loginPageResponse, JINAN_CMS_CONFIG.loginUrl)) {
      return { status: JINAN_CMS_RESULTS.VERIFY_FAILED };
    }
    parseLoginForm(loginPageResponse.body);
    await followLoginSuccessLanding(transport, jar, username, password);
    editorResponse = await sendWithCookies(transport, jar, { method: 'GET', url: JINAN_CMS_CONFIG.editorUrl });
  } catch (error) {
    return { status: [JINAN_CMS_RESULTS.AUTH_FAILED, JINAN_CMS_RESULTS.FORM_CHANGED].includes(error?.code)
      ? error.code
      : JINAN_CMS_RESULTS.VERIFY_FAILED };
  }

  const editorClassification = classifyEditorResponse(editorResponse);
  if (editorClassification) return { status: editorClassification };

  let parsed;
  try {
    parsed = parseCmsEditorForm(editorResponse.body);
    assertEditorMatchesPublicBaseline(parsed.fields.note, publicBaseline);
    buildUploadRequest({ png, callbackNumber: options?.callbackNumber ?? 0 });
    if (options?.finalImageUrl) buildSubmitRequest(parsed, options.finalImageUrl);
  } catch (error) {
    return { status: error?.code === JINAN_CMS_RESULTS.FORM_CHANGED
      ? JINAN_CMS_RESULTS.FORM_CHANGED
      : JINAN_CMS_RESULTS.VERIFY_FAILED };
  }

  return {
    status: JINAN_CMS_RESULTS.CMS_RESPONSE_CONTRACT_UNVERIFIED,
    summary: {
      publicChecked: true,
      loginChecked: true,
      editorFormValid: true,
      pngValidated: true,
      uploadPrepared: true,
      submitPrepared: Boolean(options?.finalImageUrl),
      uploadSent: false,
      submitSent: false,
      ...(options?.finalImageUrl ? {} : { freshSubmitBaseCaptured: true }),
    },
  };
}

function createAttemptRecord(id) {
  return { id, uploadedImageUrl: null, status: JINAN_CMS_RESULTS.READY_FOR_UPLOAD };
}

function markUploadRecorded(record, uploadedImageUrl) {
  const target = validateRootRelativeUploadUrl(uploadedImageUrl);
  if (record?.uploadedImageUrl) throw cmsError(JINAN_CMS_RESULTS.FORM_CHANGED);
  return { ...record, uploadedImageUrl: target, status: JINAN_CMS_RESULTS.UPLOAD_SUCCEEDED };
}

function planRetry(record) {
  const uploadUrl = record?.status === JINAN_CMS_RESULTS.UPLOAD_SUCCEEDED
    ? record.uploadedImageUrl
    : null;
  return {
    reuseUpload: Boolean(uploadUrl),
    requiresFreshEditorGetBeforeSubmit: true,
    uploadUrl,
  };
}

function inspectPublicCurrent({ response, savedTargetUrl }) {
  const failClosed = { status: JINAN_CMS_RESULTS.CMS_RESPONSE_CONTRACT_UNVERIFIED };
  let finalUrl;
  try {
    finalUrl = new URL(response?.finalUrl).href;
  } catch {
    return failClosed;
  }
  if (!is2xx(response) || finalUrl !== JINAN_CMS_CONFIG.publicUrl) return failClosed;
  let target;
  try {
    target = validateRootRelativeUploadUrl(savedTargetUrl);
  } catch {
    return failClosed;
  }

  let matches = 0;
  try {
    scanHtml(response?.body || '', (tag) => {
      if (tag.isClosing || tag.name !== 'img') return;
      const srcAttr = getRequiredSrcAttribute(tag);
      if (exactHtmlDecodedUploadPath(srcAttr.value) !== target) return;
      if (tag.hiddenByAncestor || isHiddenImage(tag.attrs)) throw cmsError(JINAN_CMS_RESULTS.FORM_CHANGED);
      matches += 1;
    });
  } catch {
    return failClosed;
  }
  return matches === 1 ? { status: JINAN_CMS_RESULTS.ALREADY_PUBLISHED } : failClosed;
}

function safeStatus(code) {
  return { status: code };
}

function createRuntimeCoordinator() {
  return {
    inFlight: false,
    ambiguous: null,
  };
}

let defaultRuntimeCoordinator = createRuntimeCoordinator();

function attemptId() {
  return `jinan-${randomUUID()}`;
}

function safeLog(logger, event) {
  if (typeof logger !== 'function') return;
  try {
    const result = logger({
      attemptId: event.attemptId || null,
      stage: event.stage || null,
      status: event.status || null,
      errorCode: event.errorCode || null,
      finalImagePath: event.finalImagePath || null,
      orphanUploadRisk: event.orphanUploadRisk === true,
    });
    void Promise.resolve(result).catch(() => {});
  } catch (_) {
    // Logging must never affect the publishing contract.
  }
}

function manualCheck({ finalImagePath = null, orphanUploadRisk = true } = {}) {
  const result = {
    status: JINAN_CMS_RESULTS.MANUAL_CHECK_REQUIRED,
    orphanUploadRisk: true,
  };
  if (finalImagePath) result.finalImagePath = validateRootRelativeUploadUrl(finalImagePath);
  return result;
}

async function verifyAmbiguousStateBeforeMutation({ state, transport, logger, id, coordinator }) {
  const jar = createCookieJar();
  safeLog(logger, {
    attemptId: id,
    stage: 'prior-ambiguous-public-verification',
    status: 'STARTED',
    finalImagePath: state?.finalImagePath || null,
    orphanUploadRisk: state?.orphanUploadRisk === true,
  });
  let response;
  try {
    response = await sendWithCookies(transport, jar, { method: 'GET', url: JINAN_CMS_CONFIG.publicUrl });
  } catch (_) {
    const result = manualCheck(state || {});
    safeLog(logger, {
      attemptId: id,
      stage: 'prior-ambiguous-public-verification',
      status: result.status,
      errorCode: JINAN_CMS_RESULTS.VERIFY_FAILED,
      finalImagePath: result.finalImagePath || null,
      orphanUploadRisk: result.orphanUploadRisk,
    });
    return result;
  }
  if (state?.finalImagePath) {
    const publicResult = inspectPublishedPublic({
      response,
      baseline: state.publicBaseline,
      savedTargetUrl: state.finalImagePath,
    });
    if (response.status === 200
        && exactFinalUrl(response, JINAN_CMS_CONFIG.publicUrl)
        && !hasLocation(response)
        && publicResult.status === JINAN_CMS_RESULTS.ALREADY_PUBLISHED) {
      const expectedImageUrl = imageResourceUrl(state.finalImagePath);
      let imageResponse;
      try {
        imageResponse = await sendWithCookies(transport, createCookieJar(), { method: 'GET', url: expectedImageUrl, responseType: 'bytes' });
      } catch (_) {
        imageResponse = null;
      }
      if (inspectImageResource({ response: imageResponse, expectedUrl: expectedImageUrl }).status !== JINAN_CMS_RESULTS.ALREADY_PUBLISHED) {
        const result = manualCheck(state || {});
        safeLog(logger, {
          attemptId: id,
          stage: 'prior-ambiguous-public-verification',
          status: result.status,
          errorCode: JINAN_CMS_RESULTS.VERIFY_FAILED,
          finalImagePath: result.finalImagePath || null,
          orphanUploadRisk: result.orphanUploadRisk,
        });
        return result;
      }
      coordinator.ambiguous = null;
      safeLog(logger, {
        attemptId: id,
        stage: 'prior-ambiguous-public-verification',
        status: JINAN_CMS_RESULTS.PUBLISHED,
        finalImagePath: state.finalImagePath,
        orphanUploadRisk: false,
      });
      return {
        status: JINAN_CMS_RESULTS.PUBLISHED,
        channels: [{ id: 'jinan-website', ok: true }],
      };
    }
  }
  const result = manualCheck(state || {});
  safeLog(logger, {
    attemptId: id,
    stage: 'prior-ambiguous-public-verification',
    status: result.status,
    finalImagePath: result.finalImagePath || null,
    orphanUploadRisk: result.orphanUploadRisk,
  });
  return result;
}

async function publishJinanCms(options = {}) {
  const coordinator = defaultRuntimeCoordinator;
  const logger = options.logger || ((event) => {
    if (console && typeof console.info === 'function') console.info('jinanCmsPublish', event);
  });
  const id = attemptId();
  if (coordinator.inFlight) {
    safeLog(logger, {
      attemptId: id,
      stage: 'admission',
      status: JINAN_CMS_RESULTS.PUBLISH_IN_PROGRESS,
    });
    return safeStatus(JINAN_CMS_RESULTS.PUBLISH_IN_PROGRESS);
  }
  coordinator.inFlight = true;
  safeLog(logger, { attemptId: id, stage: 'start', status: 'STARTED' });
  try {
    return await publishJinanCmsUnlocked(options, coordinator, logger, id);
  } finally {
    coordinator.inFlight = false;
  }
}

async function publishJinanCmsUnlocked(options, coordinator, logger, id) {
  const env = options.env || process.env;
  if (env[JINAN_CMS_CONFIG.publishEnabledEnvName] !== 'true') {
    const result = safeStatus(JINAN_CMS_RESULTS.CMS_RESPONSE_CONTRACT_UNVERIFIED);
    safeLog(logger, { attemptId: id, stage: 'gate', status: result.status, errorCode: result.status });
    return result;
  }

  const transport = options.transport || createDefaultFetchTransport();
  if (coordinator.ambiguous?.status === JINAN_CMS_RESULTS.MANUAL_CHECK_REQUIRED) {
    return verifyAmbiguousStateBeforeMutation({
      state: coordinator.ambiguous,
      transport,
      logger,
      id,
      coordinator,
    });
  }

  let png;
  try {
    png = parsePngDataUrl(options.pngDataUrl).png;
  } catch {
    const result = safeStatus(JINAN_CMS_RESULTS.VERIFY_FAILED);
    safeLog(logger, { attemptId: id, stage: 'png', status: result.status, errorCode: result.status });
    return result;
  }

  const username = env[JINAN_CMS_CONFIG.usernameEnvName];
  const password = env[JINAN_CMS_CONFIG.passwordEnvName];
  if (!username || !password) {
    const result = safeStatus(JINAN_CMS_RESULTS.AUTH_FAILED);
    safeLog(logger, { attemptId: id, stage: 'credentials', status: result.status, errorCode: result.status });
    return result;
  }

  const jar = createCookieJar();
  let publicBaseline;
  const callbackNumber = options.callbackNumber ?? 0;
  const sleep = typeof options.sleep === 'function' ? options.sleep : async (ms) => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  };
  const verificationDelaysMs = Array.isArray(options.verificationDelaysMs)
    ? options.verificationDelaysMs
    : [500, 1000];

  try {
    const publicResponse = await sendWithCookies(transport, jar, { method: 'GET', url: JINAN_CMS_CONFIG.publicUrl });
    if (publicResponse.status !== 200 || !exactFinalUrl(publicResponse, JINAN_CMS_CONFIG.publicUrl) || hasLocation(publicResponse)) {
      const result = safeStatus(JINAN_CMS_RESULTS.VERIFY_FAILED);
      safeLog(logger, { attemptId: id, stage: 'initial-public', status: result.status, errorCode: result.status });
      return result;
    }
    publicBaseline = captureTimetableBaseline(publicResponse.body);

    const loginPageResponse = await sendWithCookies(transport, jar, { method: 'GET', url: JINAN_CMS_CONFIG.loginUrl });
    if (loginPageResponse.status !== 200 || !exactFinalUrl(loginPageResponse, JINAN_CMS_CONFIG.loginUrl) || hasLocation(loginPageResponse)) {
      const result = safeStatus(JINAN_CMS_RESULTS.VERIFY_FAILED);
      safeLog(logger, { attemptId: id, stage: 'login-page', status: result.status, errorCode: result.status });
      return result;
    }
    parseLoginForm(loginPageResponse.body);
  } catch (error) {
    const status = error?.code === JINAN_CMS_RESULTS.FORM_CHANGED
      ? JINAN_CMS_RESULTS.FORM_CHANGED
      : JINAN_CMS_RESULTS.VERIFY_FAILED;
    safeLog(logger, { attemptId: id, stage: 'pre-login', status, errorCode: status });
    return safeStatus(status);
  }

  try {
    await followLoginSuccessLanding(transport, jar, username, password);
  } catch (error) {
    const status = error?.code === JINAN_CMS_RESULTS.AUTH_FAILED
      ? JINAN_CMS_RESULTS.AUTH_FAILED
      : JINAN_CMS_RESULTS.VERIFY_FAILED;
    const result = safeStatus(status);
    safeLog(logger, {
      attemptId: id,
      stage: 'login-submit',
      status: result.status,
      errorCode: safeLoginDiagnosticReasonCode(error, result.status),
    });
    return result;
  }

  let firstEditorResponse;
  try {
    firstEditorResponse = await sendWithCookies(transport, jar, { method: 'GET', url: JINAN_CMS_CONFIG.editorUrl });
  } catch {
    const result = safeStatus(JINAN_CMS_RESULTS.VERIFY_FAILED);
    safeLog(logger, { attemptId: id, stage: 'editor-before-upload', status: result.status, errorCode: result.status });
    return result;
  }
  const firstEditorClassification = classifyEditorResponse(firstEditorResponse);
  if (firstEditorClassification) {
    safeLog(logger, { attemptId: id, stage: 'editor-before-upload', status: firstEditorClassification, errorCode: firstEditorClassification });
    return safeStatus(firstEditorClassification);
  }
  try {
    const firstEditorForm = parseCmsEditorForm(firstEditorResponse.body);
    assertEditorMatchesPublicBaseline(firstEditorForm.fields.note, publicBaseline);
  } catch (error) {
    const status = error?.code === JINAN_CMS_RESULTS.FORM_CHANGED
      ? JINAN_CMS_RESULTS.FORM_CHANGED
      : JINAN_CMS_RESULTS.VERIFY_FAILED;
    safeLog(logger, { attemptId: id, stage: 'editor-before-upload', status, errorCode: status });
    return safeStatus(status);
  }

  let finalImageUrl;
  let record = createAttemptRecord(id);
  let uploadRequest;
  try {
    uploadRequest = buildUploadRequest({ png, callbackNumber });
  } catch (error) {
    const status = error?.code === JINAN_CMS_RESULTS.FORM_CHANGED
      ? JINAN_CMS_RESULTS.FORM_CHANGED
      : JINAN_CMS_RESULTS.VERIFY_FAILED;
    safeLog(logger, { attemptId: id, stage: 'upload-prepare', status, errorCode: status });
    return safeStatus(status);
  }

  try {
    const uploadResponse = await sendWithCookies(transport, jar, uploadRequest);
    const uploadResult = parseUploadResponse(uploadResponse, uploadRequest.url, callbackNumber);
    if (uploadResult.status !== JINAN_CMS_RESULTS.UPLOAD_SUCCEEDED) {
      const state = manualCheck({ orphanUploadRisk: true });
      coordinator.ambiguous = { ...state };
      safeLog(logger, { attemptId: id, stage: 'upload', status: state.status, errorCode: uploadResult.status, orphanUploadRisk: true });
      return state;
    }
    finalImageUrl = uploadResult.finalImageUrl;
    record = markUploadRecorded(record, finalImageUrl);
    safeLog(logger, { attemptId: id, stage: 'upload', status: uploadResult.status, finalImagePath: record.uploadedImageUrl });
  } catch {
    const state = manualCheck({ orphanUploadRisk: true });
    coordinator.ambiguous = { ...state };
    safeLog(logger, { attemptId: id, stage: 'upload', status: state.status, errorCode: state.status, orphanUploadRisk: true });
    return state;
  }

  let freshEditorResponse;
  const retryPlan = planRetry(record);
  try {
    freshEditorResponse = await sendWithCookies(transport, jar, { method: 'GET', url: JINAN_CMS_CONFIG.editorUrl });
  } catch {
    const state = manualCheck({ finalImagePath: record.uploadedImageUrl, orphanUploadRisk: true });
    coordinator.ambiguous = { ...state };
    safeLog(logger, { attemptId: id, stage: 'fresh-editor', status: state.status, errorCode: JINAN_CMS_RESULTS.VERIFY_FAILED, finalImagePath: state.finalImagePath, orphanUploadRisk: true });
    return state;
  }
  const freshEditorClassification = classifyEditorResponse(freshEditorResponse);
  if (freshEditorClassification) {
    const state = manualCheck({ finalImagePath: record.uploadedImageUrl, orphanUploadRisk: true });
    coordinator.ambiguous = { ...state };
    safeLog(logger, { attemptId: id, stage: 'fresh-editor', status: state.status, errorCode: freshEditorClassification, finalImagePath: state.finalImagePath, orphanUploadRisk: true });
    return state;
  }

  let submitRequest;
  try {
    const freshEditorForm = parseCmsEditorForm(freshEditorResponse.body);
    assertEditorMatchesPublicBaseline(freshEditorForm.fields.note, publicBaseline);
    submitRequest = buildSubmitRequest(freshEditorForm, retryPlan.uploadUrl);
  } catch (error) {
    const errorCode = error?.code === JINAN_CMS_RESULTS.FORM_CHANGED
      ? JINAN_CMS_RESULTS.FORM_CHANGED
      : JINAN_CMS_RESULTS.VERIFY_FAILED;
    const state = manualCheck({ finalImagePath: record.uploadedImageUrl, orphanUploadRisk: true });
    coordinator.ambiguous = { ...state };
    safeLog(logger, { attemptId: id, stage: 'submit-prepare', status: state.status, errorCode, finalImagePath: state.finalImagePath, orphanUploadRisk: true });
    return state;
  }

  try {
    const submitResponse = await sendWithCookies(transport, jar, submitRequest);
    const submitResult = parseSubmitResponse(submitResponse, submitRequest.url);
    if (submitResult.status !== JINAN_CMS_RESULTS.SUBMIT_SUCCEEDED) {
      const state = manualCheck({ finalImagePath: record.uploadedImageUrl, orphanUploadRisk: true });
      coordinator.ambiguous = { ...state, publicBaseline };
      safeLog(logger, { attemptId: id, stage: 'submit', status: state.status, errorCode: submitResult.status, finalImagePath: state.finalImagePath, orphanUploadRisk: true });
      return state;
    }
    safeLog(logger, { attemptId: id, stage: 'submit', status: submitResult.status, finalImagePath: record.uploadedImageUrl, orphanUploadRisk: true });
  } catch {
    const state = manualCheck({ finalImagePath: record.uploadedImageUrl, orphanUploadRisk: true });
    coordinator.ambiguous = { ...state, publicBaseline };
    safeLog(logger, { attemptId: id, stage: 'submit', status: state.status, errorCode: state.status, finalImagePath: state.finalImagePath, orphanUploadRisk: true });
    return state;
  }

  const postSubmitState = manualCheck({ finalImagePath: record.uploadedImageUrl, orphanUploadRisk: true });
  coordinator.ambiguous = { ...postSubmitState, publicBaseline };
  const anonymousVerificationJar = createCookieJar();
  try {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (attempt > 0) await sleep(verificationDelaysMs[attempt - 1] ?? 0);
      let verificationResponse;
      verificationResponse = await sendWithCookies(transport, anonymousVerificationJar, { method: 'GET', url: JINAN_CMS_CONFIG.publicUrl });
      const publicResult = inspectPublishedPublic({ response: verificationResponse, baseline: publicBaseline, savedTargetUrl: retryPlan.uploadUrl });
      if (verificationResponse.status === 200
          && exactFinalUrl(verificationResponse, JINAN_CMS_CONFIG.publicUrl)
          && !hasLocation(verificationResponse)
          && publicResult.status === JINAN_CMS_RESULTS.ALREADY_PUBLISHED) {
        const expectedImageUrl = imageResourceUrl(retryPlan.uploadUrl);
        const imageResponse = await sendWithCookies(transport, createCookieJar(), { method: 'GET', url: expectedImageUrl, responseType: 'bytes' });
        if (inspectImageResource({ response: imageResponse, expectedUrl: expectedImageUrl }).status !== JINAN_CMS_RESULTS.ALREADY_PUBLISHED) {
          continue;
        }
        coordinator.ambiguous = null;
        safeLog(logger, { attemptId: id, stage: 'public-verification', status: JINAN_CMS_RESULTS.PUBLISHED, finalImagePath: record.uploadedImageUrl, orphanUploadRisk: false });
        return {
          status: JINAN_CMS_RESULTS.PUBLISHED,
          channels: [{ id: 'jinan-website', ok: true }],
        };
      }
    }
  } catch {
    safeLog(logger, { attemptId: id, stage: 'public-verification', status: postSubmitState.status, errorCode: JINAN_CMS_RESULTS.VERIFY_FAILED, finalImagePath: postSubmitState.finalImagePath, orphanUploadRisk: true });
    return postSubmitState;
  }

  safeLog(logger, { attemptId: id, stage: 'public-verification', status: postSubmitState.status, errorCode: JINAN_CMS_RESULTS.VERIFY_FAILED, finalImagePath: postSubmitState.finalImagePath, orphanUploadRisk: true });
  return postSubmitState;
}

function planRollback() {
  return {
    supported: false,
    operations: [],
    deletes: false,
    submits: false,
  };
}

function materializeFetchRequest(request) {
  const headers = { ...(request.headers || {}) };
  let body = request.body;
  if (request.multipartFields) {
    const form = new FormData();
    for (const [name, value] of Object.entries(request.multipartFields)) form.set(name, value);
    body = form;
    delete headers['content-type'];
    delete headers['Content-Type'];
  } else if (request.multipartFieldName && request.file) {
    const form = new FormData();
    form.set(
      request.multipartFieldName,
      new Blob([request.file.content], { type: request.file.contentType || 'application/octet-stream' }),
      request.file.filename || 'upload.bin',
    );
    body = form;
    delete headers['content-type'];
    delete headers['Content-Type'];
  }
  return { headers, body };
}

const MAX_TRANSPORT_TIMEOUT_MS = 60000;
const MAX_TRANSPORT_BODY_BYTES = 10 * 1024 * 1024;

function validatePositiveBoundedInteger(value, max, name) {
  if (!Number.isInteger(value) || value <= 0 || value > max) {
    throw new Error(`${name} must be a finite positive bounded integer.`);
  }
}

async function readBoundedText(response, maxBytes) {
  if (response?.body && typeof response.body.getReader === 'function') {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const parts = [];
    let bytes = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        const value = chunk.value instanceof Uint8Array ? chunk.value : new Uint8Array(chunk.value || []);
        bytes += value.byteLength;
        if (bytes > maxBytes) {
          if (typeof reader.cancel === 'function') await reader.cancel();
          throw new Error('CMS response body too large.');
        }
        parts.push(decoder.decode(value, { stream: true }));
      }
      parts.push(decoder.decode());
      return parts.join('');
    } catch (error) {
      if (bytes > maxBytes) throw error;
      throw error;
    }
  }

  const rawLength = headerValue(response?.headers, 'content-length');
  if (!/^(?:0|[1-9][0-9]*)$/.test(String(rawLength || ''))) {
    throw new Error('CMS response Content-Length is missing or invalid.');
  }
  const contentLength = Number.parseInt(rawLength, 10);
  if (!Number.isSafeInteger(contentLength) || contentLength > maxBytes) {
    throw new Error('CMS response body too large.');
  }
  if (typeof response?.text !== 'function') throw new Error('CMS response body stream is unavailable.');
  const text = await response.text();
  if (Buffer.byteLength(text, 'utf8') !== contentLength) throw new Error('CMS response Content-Length is invalid.');
  if (Buffer.byteLength(text, 'utf8') > maxBytes) throw new Error('CMS response body too large.');
  return text;
}

async function readBoundedBytes(response, maxBytes) {
  if (response?.body && typeof response.body.getReader === 'function') {
    const reader = response.body.getReader();
    const chunks = [];
    let bytes = 0;
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      const value = chunk.value instanceof Uint8Array ? chunk.value : new Uint8Array(chunk.value || []);
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        if (typeof reader.cancel === 'function') await reader.cancel();
        throw new Error('CMS response body too large.');
      }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks, bytes);
  }

  const rawLength = headerValue(response?.headers, 'content-length');
  if (!/^(?:0|[1-9][0-9]*)$/.test(String(rawLength || ''))) {
    throw new Error('CMS response Content-Length is missing or invalid.');
  }
  const contentLength = Number.parseInt(rawLength, 10);
  if (!Number.isSafeInteger(contentLength) || contentLength > maxBytes) {
    throw new Error('CMS response body too large.');
  }
  if (typeof response?.arrayBuffer !== 'function') throw new Error('CMS response byte stream is unavailable.');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > maxBytes) throw new Error('CMS response body too large.');
  if (bytes.length !== contentLength) {
    throw new Error('CMS response Content-Length is invalid.');
  }
  return bytes;
}

const DEFAULT_TRANSPORT_HTML_BODY_BYTES = 1024 * 1024;
const DEFAULT_TRANSPORT_IMAGE_RESOURCE_BYTES = MAX_PNG_BYTES;

function createDefaultFetchTransport({
  timeoutMs = 10000,
  maxBodyBytes = DEFAULT_TRANSPORT_HTML_BODY_BYTES,
  maxImageBodyBytes = DEFAULT_TRANSPORT_IMAGE_RESOURCE_BYTES,
} = {}) {
  validatePositiveBoundedInteger(timeoutMs, MAX_TRANSPORT_TIMEOUT_MS, 'timeoutMs');
  validatePositiveBoundedInteger(maxBodyBytes, MAX_TRANSPORT_BODY_BYTES, 'maxBodyBytes');
  validatePositiveBoundedInteger(maxImageBodyBytes, DEFAULT_TRANSPORT_IMAGE_RESOURCE_BYTES, 'maxImageBodyBytes');
  return async function fetchTransport(request) {
    if (typeof fetch !== 'function') throw new Error('fetch is unavailable.');
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timeout = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    const materialized = materializeFetchRequest(request);
    try {
      const response = await fetch(request.url, {
        method: request.method,
        headers: materialized.headers,
        body: materialized.body,
        redirect: 'manual',
        signal: controller?.signal,
      });
      return {
        status: response.status,
        finalUrl: response.url,
        body: request.responseType === 'bytes' ? '' : await readBoundedText(response, maxBodyBytes),
        bytes: request.responseType === 'bytes' ? await readBoundedBytes(response, maxImageBodyBytes) : null,
        setCookie: response.headers.getSetCookie ? response.headers.getSetCookie() : [],
        location: response.headers.get ? response.headers.get('location') : null,
        contentType: response.headers.get ? response.headers.get('content-type') : null,
      };
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  };
}

module.exports = {
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
  publishJinanCms,
  parseSubmitResponse,
  parseUploadResponse,
  planRetry,
  planRollback,
  preflightPublish: preflightJinanCmsPublish,
  preflightJinanCmsPublish,
  validateLoginPostResponse,
};
