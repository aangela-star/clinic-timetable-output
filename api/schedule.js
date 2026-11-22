const { getServerSecret, hasValidSession } = require('../lib/server-session');

const APPS_SCRIPT_WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbz5OXGNDZJWEj2-W1g-1r_SISPjYYcI-7gsUsivt3Rx7-zY6AzpQqqZTIFROVKMU1eh3w/exec';

// The only Apps Script action a browser read is allowed to trigger. The legacy 'load' action
// shares the sheet bootstrap helper with 'save': on a missing or empty Schedules sheet it inserts
// the sheet and writes its header row, so a read could create state in the bound spreadsheet.
// This action is read-only by construction in apps-script/Code.gs and says so in its response.
const READ_ONLY_LOAD_ACTION = 'loadReadOnly';

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
      // The action is chosen here, never taken from the request: a client cannot steer this GET
      // onto a writable backend path.
      const result = await forwardToAppsScript({ action: READ_ONLY_LOAD_ACTION, month });

      if (result.ok === true) {
        // Fail closed. A backend that does not confirm the read-only path may be an older
        // deployment answering some other way; we do not fall back to the legacy 'load' action,
        // because falling back is exactly the write risk this exists to remove.
        if (result.readOnly !== true) {
          console.error(`schedule read-only load unverified month=${month}`);
          return json(res, 502, {
            ok: false,
            error: 'READ_ONLY_LOAD_UNVERIFIED',
            message: '雲端沒有確認這次讀取是唯讀路徑，已停止讀取，未改用舊的讀取方式。請先部署最新的 Apps Script 後端。',
          });
        }
        return json(res, 200, result);
      }

      if (result.error === 'UNSUPPORTED_ACTION' || result.error === 'METHOD_NOT_ALLOWED') {
        console.error(`schedule read-only load unsupported by deployed backend month=${month}`);
        return json(res, 502, {
          ok: false,
          error: 'READ_ONLY_LOAD_UNSUPPORTED',
          message: '雲端後端尚未部署唯讀讀取路徑，已停止讀取，未改用可能寫入的舊讀取方式。請先部署最新的 Apps Script 後端。',
        });
      }

      return json(res, 400, result);
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
    const upstreamStatus = err && err.upstreamStatus ? err.upstreamStatus : null;
    console.error(`schedule proxy failed code=${code} upstreamStatus=${upstreamStatus || '-'}`);
    return json(res, 502, {
      ok: false,
      error: err.code || 'SCHEDULE_PROXY_FAILED',
      upstreamStatus,
      message: '門診資料服務暫時無法使用。',
    });
  }
};

// Shared server-only destination; no change to the existing save/load boundary.
module.exports.APPS_SCRIPT_WEB_APP_URL = APPS_SCRIPT_WEB_APP_URL;
