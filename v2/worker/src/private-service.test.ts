import { request } from 'node:http';
import { it, expect } from 'vitest';
import { createWorker } from './service.js';
import { Connection } from './connection.js';
it('real private HTTP requires service authentication, session identity, exact Host, no Origin/forwarding and closed named operations', async () => {
  const secret = 's'.repeat(43), server = createWorker(new Connection(), secret);
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r)); const port = (server.address() as any).port;
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}`, 'X-Gelt-Session': 'a'.repeat(43), 'X-Gelt-Session-Expires': String(Date.now() + 300000) };
  const call = (operation = 'status', extra = {}, body = '{}') => new Promise<{ status: number }>((resolve, reject) => { const req = request({ hostname: '127.0.0.1', port, path: `/v1/connection/${operation}`, method: 'POST', headers: { ...headers, 'Content-Length': Buffer.byteLength(body), ...extra } }, res => { res.resume(); res.on('end', () => resolve({ status: res.statusCode! })); }); req.on('error', reject); req.end(body); });
  try {
    expect((await call()).status).toBe(200);
    for (const extra of [{ 'X-Gelt-Session-Expires': '' }, { 'X-Gelt-Session-Expires': '1' }, { 'X-Gelt-Session-Expires': '999999999999999' }, { Authorization: '' }, { Authorization: 'Bearer wrong' }, { 'X-Gelt-Session': 'bad' }, { Origin: `http://127.0.0.1:${port}` }, { Host: 'evil' }, { Forwarded: 'host=evil' }, { 'X-Forwarded-Host': `127.0.0.1:${port}` }]) expect((await call('status', extra)).status, JSON.stringify(extra)).toBe(403);
    for (const tool of ['place_order', 'cancel_order', 'exercise', 'funding', 'tools', 'get_accounts', 'status?x=1']) expect((await call(tool)).status).toBe(404);
    expect((await call('status', {}, '{"tool":"get_accounts"}')).status).toBe(409);
    expect((await call('status', {}, 'x'.repeat(5000))).status).toBe(400);
  } finally { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); }
});
