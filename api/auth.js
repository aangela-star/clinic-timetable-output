const crypto = require('crypto');
const {
  clearSessionCookie,
  createSessionToken,
  sessionCookie,
  timingSafeEqualText,
} = require('../lib/server-session');

const EXPECTED_PASSWORD_SHA256 = 'c6cd74a999b732d791159f2e08ddf7fb52f004b60d409d14367facf0d546a615';

function json(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

module.exports = async function handler(req, res) {
  if (req.method === 'DELETE') {
    res.setHeader('Set-Cookie', clearSessionCookie());
    return json(res, 200, { ok: true });
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, DELETE');
    return json(res, 405, { ok: false, error: 'METHOD_NOT_ALLOWED' });
  }

  try {
    const password = typeof req.body === 'string' ? JSON.parse(req.body).password : req.body?.password;
    if (typeof password !== 'string') {
      return json(res, 400, { ok: false, error: 'INVALID_REQUEST' });
    }

    const actual = crypto.createHash('sha256').update(password, 'utf8').digest('hex');
    if (!timingSafeEqualText(actual, EXPECTED_PASSWORD_SHA256)) {
      return json(res, 401, { ok: false, error: 'INVALID_PASSWORD' });
    }

    const token = createSessionToken();
    res.setHeader('Set-Cookie', sessionCookie(token));
    return json(res, 200, { ok: true });
  } catch (err) {
    console.error('auth failed', err && err.code ? err.code : err);
    return json(res, 500, { ok: false, error: err.code || 'AUTH_FAILED' });
  }
};
