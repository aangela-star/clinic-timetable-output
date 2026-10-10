'use strict';
// Evidence-harness regression tests only; no application modules or credentials.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const net = require('node:net');
const http = require('node:http');

function harness() {
  const calls = [];
  const socket = {connect(...args) { calls.push(args); return this; }};
  const modules = {
    'node:net': {Socket: {prototype: socket}},
    'node:dns': {lookup() {}},
    'node:dgram': {},
  };
  vm.runInNewContext(fs.readFileSync(__dirname + '/offline-guard.cjs', 'utf8'), {
    require: name => modules[name], URL, fetch() {},
  });
  return {socket, calls};
}

test('normalized numeric loopback arguments reach original connect unchanged', () => {
  for (const host of ['127.0.0.1', '::1']) {
    const {socket, calls} = harness();
    const args = net._normalizeArgs([{host, port: 12345}, () => {}]);
    assert.equal(socket.connect(args), socket);
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], args);
  }
});

test('external, missing-host and socket-path inputs remain blocked before transport', () => {
  for (const options of [
    {host: '203.0.113.1', port: 80}, {host: 'example.invalid', port: 80},
    {host: 'localhost', port: 80}, {port: 80},
    {host: '127.0.0.1', path: '/tmp/unused-evidence-socket'},
  ]) {
    for (const args of [[options], [net._normalizeArgs([options])]]) {
      const {socket, calls} = harness();
      assert.throws(() => socket.connect(...args), /EVIDENCE_EXTERNAL_NETWORK_FORBIDDEN/);
      assert.equal(calls.length, 0);
    }
  }
});

test('local-only HTTP fetch under the real guard', {timeout: 5000}, async t => {
  require('./offline-guard.cjs');
  const server = http.createServer((req, res) => res.end('loopback-ok'));
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
  } catch (error) {
    if (error.code === 'EPERM') {
      t.skip('Sandbox listener EPERM: actual HTTP acceptance remains unverified');
      return;
    }
    throw error;
  }
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/`, {
      signal: AbortSignal.timeout(2000),
    });
    assert.equal(await response.text(), 'loopback-ok');
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
