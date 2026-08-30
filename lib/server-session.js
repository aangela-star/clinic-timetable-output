const crypto = require('crypto');

const COOKIE_NAME = 'clinic_timetable_session';
const SESSION_TTL_SECONDS = 8 * 60 * 60;

function getServerSecret() {
  const secret = String(process.env.CLINIC_SERVER_SECRET || '');
  if (secret.length < 32) {
    const error = new Error('CLINIC_SERVER_SECRET is not configured.');
    error.code = 'SERVER_SECRET_NOT_CONFIGURED';
    throw error;
  }
  return secret;
}

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}

function sign(value, secret) {
  return crypto.createHmac('sha256', secret).update(value).digest('base64url');
}

function createSessionToken(nowMs = Date.now()) {
  const secret = getServerSecret();
  const payload = base64url(JSON.stringify({ exp: nowMs + SESSION_TTL_SECONDS * 1000 }));
  return `${payload}.${sign(payload, secret)}`;
}

function timingSafeEqualText(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function verifySessionToken(token, nowMs = Date.now()) {
  if (!token || typeof token !== 'string') return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;

  const [payload, signature] = parts;
  const expected = sign(payload, getServerSecret());
  if (!timingSafeEqualText(signature, expected)) return false;

  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return Number.isFinite(parsed.exp) && parsed.exp > nowMs;
  } catch (_) {
    return false;
  }
}

function parseCookies(header) {
  return String(header || '').split(';').reduce((cookies, part) => {
    const index = part.indexOf('=');
    if (index === -1) return cookies;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) cookies[key] = decodeURIComponent(value);
    return cookies;
  }, {});
}

function hasValidSession(req) {
  const cookies = parseCookies(req.headers.cookie);
  return verifySessionToken(cookies[COOKIE_NAME]);
}

function sessionCookie(token) {
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_TTL_SECONDS}`;
}

function clearSessionCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

module.exports = {
  clearSessionCookie,
  createSessionToken,
  getServerSecret,
  hasValidSession,
  sessionCookie,
  timingSafeEqualText,
  verifySessionToken,
};
