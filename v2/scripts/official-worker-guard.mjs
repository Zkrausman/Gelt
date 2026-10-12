// Application guard, not an OS sandbox. Only the dedicated worker gets this mode.
// TLS hostname allowlist plus provider.ts's fixed full URL/redirect policy.
import net from 'node:net';
import tls from 'node:tls';
import dns from 'node:dns';
import { syncBuiltinESMExports } from 'node:module';
const official = new Set(['agent.robinhood.com', 'api.robinhood.com']);
const local = new Set(['127.0.0.1', '::1', 'localhost']);
function fail() { console.error('WORKER_EGRESS_DENIED'); process.exit(78); }
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const o = Array.isArray(args[0]) ? args[0][0] : args[0];
  // TLS uses TLSSocket; raw TCP to official hosts is not permitted.
  if (typeof o !== 'object' || o.path || (!local.has(o.host ?? 'localhost') && !(this instanceof tls.TLSSocket && official.has(o.host) && Number(o.port) === 443))) fail();
  return connect.apply(this, args);
};
const tlsConnect = tls.connect;
tls.connect = function (...args) {
  const o = args[0];
  if (typeof o !== 'object' || !official.has(o.host) || o.servername !== o.host || Number(o.port) !== 443 || o.rejectUnauthorized === false || o.checkServerIdentity) fail();
  return tlsConnect.apply(this, args);
};
for (const object of [dns, dns.promises]) for (const name of Object.keys(object).filter(k => k === 'lookup' || k.startsWith('resolve') || k === 'reverse')) {
  if (typeof object[name] !== 'function') continue;
  const original = object[name]; object[name] = function (host, ...args) { if (!official.has(host) && !local.has(host)) fail(); return original.call(this, host, ...args); };
}
syncBuiltinESMExports();
