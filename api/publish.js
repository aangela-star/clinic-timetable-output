const { hasValidSession } = require('../lib/server-session');
const { parsePngDataUrl } = require('../lib/publish-contract');

const REQUIRED_KEYS = ['action', 'channelIds', 'primaryClinicId', 'title', 'pngDataUrl'];
const REQUIRED_KEY_SET = new Set(REQUIRED_KEYS);
const TITLE_CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/;

function json(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

function methodNotAllowed(res) {
  res.setHeader('Allow', 'POST');
  return json(res, 405, { ok: false, error: 'METHOD_NOT_ALLOWED' });
}

function hasSafeValidSession(req) {
  try {
    return hasValidSession(req);
  } catch (_) {
    return false;
  }
}

function defaultPreflightPublish(payload) {
  const { publishJinanCms } = require('../lib/jinan-cms');
  return publishJinanCms(payload);
}

function skipJsonString(source, start) {
  let escaped = false;
  for (let i = start + 1; i < source.length; i += 1) {
    const char = source[i];
    if (escaped) {
      escaped = false;
    } else if (char === '\\') {
      escaped = true;
    } else if (char === '"') {
      return i + 1;
    }
  }
  return -1;
}

function hasDuplicateTopLevelJsonKey(source) {
  const first = source.search(/\S/);
  if (first === -1 || source[first] !== '{') return false;

  const seen = new Set();
  let depth = 0;
  for (let i = first; i < source.length; i += 1) {
    const char = source[i];
    if (char === '"') {
      const end = skipJsonString(source, i);
      if (end === -1) return false;
      if (depth === 1) {
        let cursor = end;
        while (/\s/.test(source[cursor] || '')) cursor += 1;
        if (source[cursor] === ':') {
          let key;
          try {
            key = JSON.parse(source.slice(i, end));
          } catch (_) {
            return false;
          }
          if (seen.has(key)) return true;
          seen.add(key);
        }
      }
      i = end - 1;
    } else if (char === '{' || char === '[') {
      depth += 1;
    } else if (char === '}' || char === ']') {
      depth -= 1;
    }
  }
  return false;
}

function parseRequestBody(rawBody) {
  if (typeof rawBody !== 'string') return rawBody || {};
  if (hasDuplicateTopLevelJsonKey(rawBody)) return null;
  try {
    return JSON.parse(rawBody);
  } catch (_) {
    return null;
  }
}

function isPlainJsonObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (Object.getPrototypeOf(value) !== Object.prototype) return false;
  if (Object.getOwnPropertySymbols(value).length !== 0) return false;

  const names = Object.getOwnPropertyNames(value);
  if (names.length !== REQUIRED_KEYS.length) return false;
  for (const name of names) {
    if (!REQUIRED_KEY_SET.has(name)) return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, name);
    if (!descriptor || !descriptor.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
      return false;
    }
  }

  const keys = Object.keys(value);
  return keys.length === REQUIRED_KEYS.length && REQUIRED_KEYS.every((key) => keys.includes(key));
}

function isExactChannelSelection(value) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return false;
  if (Object.getOwnPropertySymbols(value).length !== 0) return false;
  const names = Object.getOwnPropertyNames(value).sort();
  if (names.length !== 2 || names[0] !== '0' || names[1] !== 'length') return false;
  const descriptor = Object.getOwnPropertyDescriptor(value, '0');
  return Boolean(
    descriptor &&
    descriptor.enumerable &&
    Object.prototype.hasOwnProperty.call(descriptor, 'value') &&
    value.length === 1 &&
    value[0] === 'jinan-website',
  );
}

function hasValidTitle(value) {
  if (typeof value !== 'string' || TITLE_CONTROL_CHARS.test(value)) return false;
  const title = value.trim();
  return title.length >= 1 && title.length <= 100;
}

function validatePublishBody(body) {
  if (!isPlainJsonObject(body)) return { error: 'INVALID_REQUEST' };
  if (body.action !== 'publish') return { error: 'INVALID_REQUEST' };
  if (!hasValidTitle(body.title)) return { error: 'INVALID_REQUEST' };
  if (typeof body.pngDataUrl !== 'string') return { error: 'INVALID_REQUEST' };
  if (!Array.isArray(body.channelIds)) return { error: 'INVALID_REQUEST' };
  if (body.channelIds.length === 0) return { error: 'CHANNEL_REQUIRED' };
  if (!isExactChannelSelection(body.channelIds)) return { error: 'INVALID_REQUEST' };
  if (typeof body.primaryClinicId !== 'string') return { error: 'INVALID_REQUEST' };
  if (body.primaryClinicId !== 'clinic-1') {
    return { error: 'PRIMARY_CLINIC_REQUIRED', primaryClinicId: body.primaryClinicId };
  }

  return {
    payload: Object.freeze({
      action: 'publish',
      channelIds: Object.freeze(['jinan-website']),
      primaryClinicId: 'clinic-1',
      title: body.title.trim(),
      pngDataUrl: body.pngDataUrl,
    }),
  };
}

function respondToPublishResult(res, result) {
  switch (result && result.status) {
    case 'PUBLISHED':
      return json(res, 200, { ok: true, status: 'PUBLISHED', channels: [{ id: 'jinan-website', ok: true }] });
    case 'AUTH_FAILED':
      return json(res, 502, { ok: false, error: 'AUTH_FAILED' });
    case 'FORM_CHANGED':
      return json(res, 409, { ok: false, error: 'FORM_CHANGED' });
    case 'UPLOAD_FAILED':
      return json(res, 502, { ok: false, error: 'UPLOAD_FAILED' });
    case 'SUBMIT_FAILED':
      return json(res, 502, { ok: false, error: 'SUBMIT_FAILED' });
    case 'VERIFY_FAILED':
      return json(res, 502, { ok: false, error: 'VERIFY_FAILED' });
    case 'CMS_RESPONSE_CONTRACT_UNVERIFIED':
    case 'ALREADY_PUBLISHED':
      return json(res, 409, {
        ok: false,
        error: 'CMS_RESPONSE_CONTRACT_UNVERIFIED',
        message: '晉安官網發布串接尚待完成最後驗證',
      });
    default:
      return json(res, 502, { ok: false, error: 'PUBLISH_FAILED' });
  }
}

function createHandler({ preflightPublish = defaultPreflightPublish } = {}) {
  return async function handler(req, res) {
    if (!hasSafeValidSession(req)) {
      return json(res, 401, { ok: false, error: 'AUTH_REQUIRED', message: '請重新登入後再操作。' });
    }
    if (req.method !== 'POST') {
      return methodNotAllowed(res);
    }

    const body = parseRequestBody(req.body);
    const validation = validatePublishBody(body);
    if (validation.error === 'CHANNEL_REQUIRED') {
      return json(res, 400, { ok: false, error: 'CHANNEL_REQUIRED' });
    }
    if (validation.error === 'INVALID_REQUEST') {
      return json(res, 400, { ok: false, error: 'INVALID_REQUEST' });
    }
    if (validation.error === 'PRIMARY_CLINIC_REQUIRED') {
      return json(res, 400, {
        ok: false,
        error: 'PRIMARY_CLINIC_REQUIRED',
        primaryClinicId: validation.primaryClinicId,
      });
    }
    try {
      parsePngDataUrl(validation.payload.pngDataUrl);
    } catch (err) {
      if (err && err.code === 'INVALID_PNG') {
        return json(res, 400, { ok: false, error: 'INVALID_PNG' });
      }
      throw err;
    }

    try {
      const result = await preflightPublish(validation.payload);
      return respondToPublishResult(res, result);
    } catch (_) {
      return json(res, 502, { ok: false, error: 'VERIFY_FAILED' });
    }
  };
}

module.exports = createHandler();
module.exports.createHandler = createHandler;
