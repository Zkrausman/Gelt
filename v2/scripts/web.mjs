// The raw ingress gate runs BEFORE Next synthesizes forwarded headers.
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import next from 'next';
import { sendWebListeningAcknowledgement } from './web-ipc.mjs';
process.env.GELT_INGRESS_SECRET = randomBytes(32).toString('base64url');
const app = next({ dev: false, dir: './web', hostname: '127.0.0.1', port: 3000 });
await app.prepare();
const handler = app.getRequestHandler();
const server = createServer((req, res) => {
  if (req.headers.host !== '127.0.0.1:3000' || Object.keys(req.headers).some(k => k === 'forwarded' || k.startsWith('x-forwarded-') || k === 'x-gelt-ingress')) {
    res.writeHead(403, { 'Cache-Control': 'no-store' }); return res.end();
  }
  // Do not log URLs: callback query contains single-use authorization material.
  req.headers['x-gelt-ingress'] = process.env.GELT_INGRESS_SECRET;
  void handler(req, res).catch(() => { res.writeHead(500); res.end(); });
});
server.requestTimeout = 10000; server.headersTimeout = 5000; server.maxHeadersCount = 32;
let stopping = false;
const stop = () => {
  if (stopping) return; stopping = true;
  server.close(() => { void app.close().then(() => { if (process.connected) process.disconnect(); }); }); server.closeAllConnections();
};
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, stop);
process.on('message', message => { if (message?.type === 'gelt:shutdown') stop(); });
process.on('disconnect', stop);
server.listen(3000, '127.0.0.1', () => {
  // The temporary owner launcher uses its private IPC channel to distinguish
  // this process binding successfully from a competing loopback listener.
  sendWebListeningAcknowledgement(process, stop);
});
