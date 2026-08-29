const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('browser schedule config uses same-origin Vercel proxy and exposes no server secret', () => {
  const config = read('schedule-api-config.js');
  assert.match(config, /window\.location\.origin\s*\+\s*["']\/api\/schedule["']/);
  assert.doesNotMatch(config, /CLINIC_SERVER_SECRET/);
  assert.doesNotMatch(config, /script\.google\.com/);
});

test('Vercel schedule proxy requires signed session and forwards server secret only on server', () => {
  const proxy = read('api/schedule.js');
  assert.match(proxy, /verifySessionToken/);
  assert.match(proxy, /getServerSecret/);
  assert.match(proxy, /secret:\s*getServerSecret\(\)/);
});

test('Apps Script blocks direct GET and requires server secret for POST', () => {
  const appsScript = read('apps-script/Code.gs');
  assert.match(appsScript, /function doGet\(\)/);
  assert.match(appsScript, /METHOD_NOT_ALLOWED/);
  assert.match(appsScript, /assertServerSecret_\(body\.secret\)/);
  assert.match(appsScript, /CLINIC_SERVER_SECRET/);
});

test('server secret is referenced only by server-side integration code', () => {
  const browserFiles = ['index.html', 'auth-gate.js', 'schedule-api-config.js', 'schedule-save-load-core.js'];
  for (const file of browserFiles) {
    assert.doesNotMatch(read(file), /CLINIC_SERVER_SECRET/, `${file} must not expose the server secret`);
  }
});
