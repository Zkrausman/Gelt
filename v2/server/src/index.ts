// M2 offline entrypoint. Retained providers/AI/portfolio modules are NOT loaded.
// In particular, importing portfolio would open the non-authoritative analysis DB.
import { createServer } from "node:http";
const host = process.env.API_HOST ?? "127.0.0.1";
const rawPort = process.env.API_PORT ?? "4000";
if (host !== "127.0.0.1") throw new Error("API_HOST must be 127.0.0.1");
if (!/^\d+$/.test(rawPort) || Number(rawPort) < 1 || Number(rawPort) > 65535) throw new Error("Invalid API_PORT");
const port = Number(rawPort);
const server = createServer((req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  if (req.headers.host !== `${host}:${port}` || (req.headers.origin !== undefined && req.headers.origin !== `http://${host}:${port}`)) {
    res.writeHead(403); res.end('{"error":"unsupported origin or host"}'); return;
  }
  if (req.method !== "GET" || req.headers["transfer-encoding"] || (req.headers["content-length"] && req.headers["content-length"] !== "0")) {
    res.writeHead(405); res.end('{"error":"read-only foundation"}'); return;
  }
  if (req.url === "/v1/health") {
    res.end(JSON.stringify({ version: "v1", service: "market-analysis", status: "offline", providers: "disabled", ai: false, portfolio: false }));
  } else { res.writeHead(503); res.end('{"error":"market and optional surfaces disabled in M2"}'); }
});
server.requestTimeout = 5000;
server.headersTimeout = 5000;
server.listen(port, host, () => console.log(`Offline market backend http://${host}:${port}`));
let stopping = false;
const stop = () => { if (stopping) return; stopping = true; server.close(() => { if (process.connected) process.disconnect(); }); server.closeAllConnections(); };
for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, stop);
process.on('message', message => { if ((message as { type?: string })?.type === 'gelt:shutdown') stop(); });
process.on('disconnect', stop);
