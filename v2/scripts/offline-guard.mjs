// Defense in depth for the documented baseline startup, not an OS sandbox.
// No provider modules are loaded. Fail the process even if a caller catches errors.
import net from 'node:net';
import dns from 'node:dns';
import { syncBuiltinESMExports } from 'node:module';
function deny(host) {
  if (host !== '127.0.0.1' && host !== '::1' && host !== 'localhost') {
    console.error('OFFLINE_EGRESS_DENIED');
    process.exit(78);
  }
}
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const options = Array.isArray(args[0]) ? args[0][0] : args[0];
  if (typeof options === 'object') {
    if (options.path) deny('unix-socket');
    deny(options.host ?? 'localhost');
  } else if (typeof options === 'number') deny(typeof args[1] === 'string' ? args[1] : 'localhost');
  else deny('unknown-connection');
  return connect.apply(this, args);
};
for (const object of [dns, dns.promises]) {
  for (const name of Object.keys(object).filter(k => k === 'lookup' || k.startsWith('resolve') || k === 'reverse')) {
    if (typeof object[name] !== 'function') continue;
    const original = object[name];
    object[name] = function (host, ...args) { deny(host); return original.call(this, host, ...args); };
  }
}
syncBuiltinESMExports();
