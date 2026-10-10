'use strict';
// Loaded before every Node test worker (and its process-death child).
// The runner supplies an empty, explicitly constructed environment.
const net = require('node:net');
const dns = require('node:dns');
const allowed = host => ['127.0.0.1', '::1', '[::1]'].includes(host);
const deny = () => { throw Error('EVIDENCE_EXTERNAL_NETWORK_FORBIDDEN'); };
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  // net.connect/createConnection passes Node's normalized [options, callback] array.
  // Inspect its options, but forward the original arguments unchanged.
  const inspected = Array.isArray(args[0]) ? args[0] : args;
  const options = inspected[0] && typeof inspected[0] === 'object'
    ? inspected[0] : {port: inspected[0], host: inspected[1]};
  if (options.path || !allowed(options.host)) deny();
  return connect.apply(this, args);
};
const lookup = dns.lookup;
dns.lookup = (host, ...args) => {
  if (!allowed(host)) deny();
  return lookup(host, ...args); // Numeric loopback only; no external DNS lookup.
};
for (const name of ['resolve', 'resolve4', 'resolve6']) dns[name] = deny;
const fetch = globalThis.fetch;
globalThis.fetch = (input, options) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (!allowed(url.hostname)) deny();
  return fetch(input, options);
};
require('node:dgram').createSocket = deny;
