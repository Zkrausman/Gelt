import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
export const root = fileURLToPath(new URL('../', import.meta.url));
const guard = new URL('offline-guard.mjs', import.meta.url).href;
export function childEnvironment(role = 'offline') {
  // Intentionally omit inherited credentials, NODE_OPTIONS, proxy URLs and settings.
  const specific = {};
  if (process.env.GELT_MODE === 'official-worker') {
    if (role === 'worker') specific.GELT_WORKER_CONFIG = process.env.GELT_WORKER_CONFIG;
    if (role === 'web') { specific.GELT_BFF_CONFIG = process.env.GELT_BFF_CONFIG; specific.GELT_RESEARCH_ROOT = process.env.GELT_RESEARCH_ROOT; }
  }
  return { ...specific, ...(process.platform === 'win32' ? { SystemRoot: 'C:\\Windows', WINDIR: 'C:\\Windows', GELT_WINDOWS_PRIVATE_PARENT: process.env.GELT_WINDOWS_PRIVATE_PARENT } : {}), NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1',
    API_HOST: '127.0.0.1', API_PORT: '4000', WORKER_HOST: '127.0.0.1', WORKER_PORT: '4100' };
}
export function launch(commands = [
  ['server/dist/index.js'], ['worker/dist/index.js'],
  ['scripts/web.mjs'],
]) {
  if (process.env.GELT_MODE && !['offline', 'official-worker'].includes(process.env.GELT_MODE)) throw new Error('Invalid network mode');
  if (process.env.GELT_MODE === 'official-worker' && (!process.env.GELT_WORKER_CONFIG || !process.env.GELT_BFF_CONFIG)) throw new Error('Explicit private configuration required');
  const children = commands.map(args => {
    const role = args[0] === 'worker/dist/index.js' ? 'worker' : args[0] === 'scripts/web.mjs' ? 'web' : 'offline';
    const official = process.env.GELT_MODE === 'official-worker' && role === 'worker';
    const preload = official ? new URL('official-worker-guard.mjs', import.meta.url).href : guard;
    const child = spawn(process.execPath, ['--import', preload, ...args], { cwd: root, env: childEnvironment(role), stdio: ['inherit', 'inherit', 'inherit', 'ipc'] });
    const entry = { child, exited: false, result: null, done: null };
    entry.done = new Promise(resolve => {
      child.once('error', error => { entry.exited = true; entry.result = error.message; resolve(); });
      child.once('exit', (code, signal) => { entry.exited = true; entry.result = `${code}/${signal}`; resolve(); });
    });
    return entry;
  });
  let stopping;
  return {
    children,
    assertAlive() { if (children.some(c => c.exited)) throw new Error('Foundation child exited unexpectedly'); },
    exited: Promise.race(children.map(c => c.done)),
    stop() {
      stopping ??= (async () => {
        for (const c of children) if (!c.exited) {
          if (c.child.connected) c.child.send({ type: 'gelt:shutdown' }, () => {});
          else c.child.kill('SIGTERM');
        }
        const timer = setTimeout(() => { for (const c of children) if (!c.exited) c.child.kill('SIGKILL'); }, commands.some(args => args[0] === '-e') ? 1000 : commands.some(args => args[0] === 'scripts/start.mjs') ? 30000 : 20000);
        try { await Promise.all(children.map(c => c.done)); } finally { clearTimeout(timer); }
      })();
      return stopping;
    },
  };
}
export async function ready(group, timeout = 20000) {
  const end = Date.now() + timeout;
  const urls = ['http://127.0.0.1:4000/v1/health', 'http://127.0.0.1:4100/v1/health', 'http://127.0.0.1:3000/'];
  while (Date.now() < end) {
    group.assertAlive();
    try {
      const responses = await Promise.all(urls.map(url => fetch(url, { signal: AbortSignal.timeout(1000) })));
      const texts = await Promise.all(responses.map(r => r.text()));
      const homeReady = texts[2].includes('GELT / LOCAL TRADING DESK') && texts[2].includes('SAFETY GATE');
      if (responses.every(r => r.ok) && texts[0].includes('market-analysis') && texts[1].includes('execution-worker') && homeReady) {
        // An occupied port might briefly answer before our child reports EADDRINUSE.
        await delay(200); group.assertAlive(); return;
      }
    } catch { /* bounded readiness retry; process failures checked each iteration */ }
    await delay(100);
  }
  throw new Error('Foundation readiness timeout');
}
