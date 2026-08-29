const { getServerSecret, hasValidSession } = require('../lib/server-session');

const APPS_SCRIPT_WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbz5OXGNDZJWEj2-W1g-1r_SISPjYYcI-7gsUsivt3Rx7-zY6AzpQqqZTIFROVKMU1eh3w/exec';

function json(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

function validMonth(month) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(month || ''));
}

async function forwardToAppsScript(payload) {
  const response = await fetch(APPS_SCRIPT_WEB_APP_URL, {
    method: 'POST',
    redirect: 'follow',
    headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
    body: JSON.stringify({ ...payload, secret: getServerSecret() }),
  });

  const text = await response.text();

  if (!response.ok) {
    const contentType = response.headers.get('content-type') || '';
    const responsePreview = text.slice(0, 160).replace(/\s+/g, ' ');
    console.error(`apps script upstream http error status=${response.status} statusText=${response.statusText || '-'} contentType=${contentType} preview=${responsePreview}`);
    const error = new Error(`Apps Script HTTP ${response.status}`);
    error.code = 'UPSTREAM_HTTP_ERROR';
    error.upstreamStatus = response.status;
    throw error;
  }

  try {
    return JSON.parse(text);
  } catch (_) {
    console.error(`apps script upstream invalid json status=${response.status} contentType=${response.headers.get('content-type') || ''}`);
    const error = new Error('Apps Script did not return JSON.');
    error.code = 'UPSTREAM_INVALID_RESPONSE';
    error.upstreamStatus = response.status;
    throw error;
  }
}

module.exports = async function handler(req, res) {
  try {
    if (!hasValidSession(req)) {
      return json(res, 401, { ok: false, error: 'AUTH_REQUIRED', message: '請重新登入後再操作。' });
    }

    if (req.method === 'GET') {
      const month = String(req.query?.month || '');
      if (!validMonth(month)) return json(res, 400, { ok: false, error: 'INVALID_MONTH_KEY' });
      const result = await forwardToAppsScript({ action: 'load', month });
      return json(res, result.ok ? 200 : 400, result);
    }

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      if (body.action !== 'save' || !validMonth(body.month)) {
        return json(res, 400, { ok: false, error: 'INVALID_REQUEST' });
      }
      const result = await forwardToAppsScript({ action: 'save', month: body.month, schemaVersion: body.schemaVersion, data: body.data });
      return json(res, result.ok ? 200 : 400, result);
    }

    res.setHeader('Allow', 'GET, POST');
    return json(res, 405, { ok: false, error: 'METHOD_NOT_ALLOWED' });
  } catch (err) {
    const code = err && err.code ? err.code : 'UNKNOWN';
    const upstreamStatus = err && err.upstreamStatus ? err.upstreamStatus : '-';
    console.error(`schedule proxy failed code=${code} upstreamStatus=${upstreamStatus}`);
    return json(res, 502, { ok: false, error: err.code || 'SCHEDULE_PROXY_FAILED', message: '門診資料服務暫時無法使用。' });
  }
};
