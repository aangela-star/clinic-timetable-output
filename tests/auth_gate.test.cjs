const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
const test = require('node:test');

const AuthGateModule = require('../auth-gate.js');
const { CLINIC_AUTH_CONFIG } = require('../auth-config.js');

function makeStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

function makeGate(storage = makeStorage()) {
  return AuthGateModule.createAuthGate(
    {
      crypto: webcrypto,
      sessionStorage: storage,
    },
    CLINIC_AUTH_CONFIG,
  );
}

test('correct password authenticates and wrong password does not', async () => {
  const gate = makeGate();

  assert.equal(await gate.verifyPassword('wrong password'), false);
  assert.equal(gate.isAuthenticated(), false);

  assert.equal(await gate.verifyPassword('LOCAL_TEST_ONLY_PASSWORD'), true);
  assert.equal(gate.isAuthenticated(), true);
});

test('authentication survives reload in the same session storage', async () => {
  const storage = makeStorage();
  const firstGate = makeGate(storage);

  assert.equal(await firstGate.verifyPassword('LOCAL_TEST_ONLY_PASSWORD'), true);

  const reloadedGate = makeGate(storage);
  assert.equal(reloadedGate.isAuthenticated(), true);
});

test('logout clears the authenticated session', async () => {
  const storage = makeStorage();
  const gate = makeGate(storage);

  assert.equal(await gate.verifyPassword('LOCAL_TEST_ONLY_PASSWORD'), true);
  gate.logout();

  assert.equal(gate.isAuthenticated(), false);
});

test('new storage starts unauthenticated like a new browser session', async () => {
  const firstGate = makeGate(makeStorage());
  assert.equal(await firstGate.verifyPassword('LOCAL_TEST_ONLY_PASSWORD'), true);

  const nextSessionGate = makeGate(makeStorage());
  assert.equal(nextSessionGate.isAuthenticated(), false);
});
