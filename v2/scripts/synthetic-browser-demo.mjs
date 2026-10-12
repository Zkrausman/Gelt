// Explicit opt-in disposable test-only launcher; never imported by start/runtime.
import { rmSync } from 'node:fs';
import { dirname } from 'node:path';
const args = process.argv.slice(2);
if ((args.length !== 1 && args.length !== 2) || args[0] !== '--offline-test-only'
  || (args.length === 2 && args[1] !== '--application-mock-test-only') || process.env.NODE_ENV !== 'test') {
  throw Error('Use NODE_ENV=test node scripts/synthetic-browser-demo.mjs --offline-test-only [--application-mock-test-only] after tsc -p worker');
}
const applicationMock = args[1] === '--application-mock-test-only';
process.env.GELT_SYNTHETIC_ORDER_HARNESS = 'offline-test-only';
if (applicationMock) process.env.GELT_SYNTHETIC_MOCK_ROBINHOOD = 'offline-test-only';
else delete process.env.GELT_SYNTHETIC_MOCK_ROBINHOOD;
const { createSyntheticBrowserDemo } = await import('../worker/dist/synthetic-browser-demo.js');
const demo = createSyntheticBrowserDemo(Date.now, { applicationMock });
let shutdownPromise;
function stop() {
  if (shutdownPromise) return shutdownPromise;
  shutdownPromise = (async () => {
    let timer;
    try {
      await Promise.race([demo.close(), new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Synthetic demo cleanup exceeded five seconds; fixture retained.')), 5000);
      })]);
      rmSync(dirname(dirname(demo.path)), { recursive: true, force: true });
    } finally { clearTimeout(timer); }
  })();
  return shutdownPromise;
}
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void stop().then(() => process.exit(0), () => process.exit(1)); });
try {
  const port = await demo.start();
  console.log(`SYNTHETIC OFFLINE TEST / NOT BROKER DATA: http://127.0.0.1:${port}/`);
} catch (error) { await stop(); throw error; }
