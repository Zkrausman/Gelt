// Explicit opt-in disposable test-only launcher; never imported by start/runtime.
import { rmSync } from 'node:fs';
import { dirname } from 'node:path';
if (process.argv.length !== 3 || process.argv[2] !== '--offline-test-only' || process.env.NODE_ENV !== 'test') {
  throw Error('Use NODE_ENV=test node scripts/synthetic-browser-demo.mjs --offline-test-only after tsc -p worker');
}
process.env.GELT_SYNTHETIC_ORDER_HARNESS = 'offline-test-only';
const { createSyntheticBrowserDemo } = await import('../worker/dist/synthetic-browser-demo.js');
const demo = createSyntheticBrowserDemo();
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  try { await demo.close(); } finally { rmSync(dirname(dirname(demo.path)), { recursive: true, force: true }); }
}
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void stop().then(() => process.exit(0), () => process.exit(1)); });
try {
  const port = await demo.start();
  console.log(`SYNTHETIC OFFLINE TEST / NOT BROKER DATA: http://127.0.0.1:${port}/`);
} catch (error) { await stop(); throw error; }
