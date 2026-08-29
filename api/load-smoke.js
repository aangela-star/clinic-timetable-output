const { getServerSecret } = require('../lib/server-session');

const APPS_SCRIPT_WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbz5OXGNDZJWEj2-W1g-1r_SISPjYYcI-7gsUsivt3Rx7-zY6AzpQqqZTIFROVKMU1eh3w/exec';
const TEST_MONTH = '2026-08';

function inferMonthKeyFromTitle(title) {
  if (typeof title !== 'string') return null;
  const match = title.trim().match(/^(\d{3,4})\s*(?:年|[\/.\-])\s*(\d{1,2})\s*月?$/);
  if (!match) return null;
  let year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return null;
  if (year < 1911) year += 1911;
  return `${year}-${String(month).padStart(2, '0')}`;
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET') {
    res.statusCode = 405;
    return res.end(JSON.stringify({ ok: false, error: 'METHOD_NOT_ALLOWED' }));
  }

  try {
    const upstream = await fetch(APPS_SCRIPT_WEB_APP_URL, {
      method: 'POST',
      redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify({ action: 'load', month: TEST_MONTH, secret: getServerSecret() }),
    });
    const text = await upstream.text();
    let payload = null;
    try { payload = JSON.parse(text); } catch (_) {}

    const data = payload && payload.data;
    const dataShapeValid = Boolean(
      data && typeof data === 'object' &&
      typeof data.title === 'string' &&
      typeof data.note === 'string' &&
      Array.isArray(data.clinics) && data.clinics.length > 0
    );

    res.statusCode = 200;
    return res.end(JSON.stringify({
      ok: Boolean(upstream.ok && payload && payload.ok),
      upstreamHttpStatus: upstream.status,
      appError: payload && payload.error ? payload.error : null,
      found: Boolean(payload && payload.found),
      month: payload && payload.month ? payload.month : TEST_MONTH,
      schemaVersion: payload && payload.schemaVersion ? payload.schemaVersion : null,
      dataShapeValid,
      titleMonthKey: dataShapeValid ? inferMonthKeyFromTitle(data.title) : null,
      returnedJson: Boolean(payload),
    }));
  } catch (err) {
    res.statusCode = 200;
    return res.end(JSON.stringify({
      ok: false,
      error: err && err.code ? err.code : 'SMOKE_FAILED',
      message: err && err.message ? err.message : String(err),
    }));
  }
};
