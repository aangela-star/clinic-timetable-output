const test = require('node:test');
const assert = require('node:assert/strict');

process.env.CLINIC_SERVER_SECRET = 'test-only-secret-value-that-is-longer-than-32-characters';
const session = require('../lib/server-session.js');

test('signed session token verifies before expiry and fails after expiry', () => {
  const now = Date.UTC(2026, 7, 30, 0, 0, 0);
  const token = session.createSessionToken(now);
  assert.equal(session.verifySessionToken(token, now + 1000), true);
  assert.equal(session.verifySessionToken(token, now + (8 * 60 * 60 * 1000) + 1), false);
});

test('tampered signed session token is rejected', () => {
  const token = session.createSessionToken();
  const tampered = token.slice(0, -1) + (token.endsWith('a') ? 'b' : 'a');
  assert.equal(session.verifySessionToken(tampered), false);
});

test('session cookie is HttpOnly, Secure and SameSite Strict', () => {
  const cookie = session.sessionCookie(session.createSessionToken());
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Strict/);
});
