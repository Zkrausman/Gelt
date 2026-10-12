import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { root, childEnvironment } from './runtime.mjs';
import { storageFixture } from '../worker/dist/storage-fixture.js';
import { privateDirectory, writePrivateNew } from '../worker/dist/private-files.js';
import { provisionResearch, importResearchFile, readResearch } from '../worker/dist/research-store.js';
import { createRecordedSimulationFixture } from './recorded-simulation-fixture.mjs';
import { runOwnerResearchDemo, createStopController, assertLoopbackPortsFree, bootstrapConsumptionMarkerClear, startOwnedWeb, waitForResearchPage, waitForOwnerStop, stopOwnedWeb } from './research-owner-demo.mjs';

export async function runRecordedTerminal(acceptance) {
  if (Number(process.versions.node.split('.')[0]) !== 22) throw Error('Supported Node 22 required');
  const fixture = await createRecordedSimulationFixture();
  let grant = null;
  const controller = createStopController(process);
  // The existing launcher owns its auth/research fixture and shutdown. On any
  // uncertain failure retain the view snapshot rather than assuming web exit.
  const result = await runOwnerResearchDemo({ nodeMajor: 22, storageFixture, writePrivateNew, provisionResearch, importResearchFile, readResearch,
    readArtifact: readFileSync, randomBytes, createHash, now: Date.now,
    assertPortsFree: () => assertLoopbackPortsFree(), bootstrapMarkerClear: p => bootstrapConsumptionMarkerClear(p, privateDirectory),
    childEnvironment: () => ({ ...childEnvironment(), GELT_SIMULATION_VIEW: 'recorded-fixture-only', GELT_SIMULATION_FIXTURE: fixture.path, GELT_SIMULATION_FIXTURE_SHA256: fixture.digest }),
    spawnWeb: options => startOwnedWeb({ ...options, cwd: root }), waitUntilReady: waitForResearchPage,
    waitForOwnerStop: acceptance ? async () => { if (!grant) throw Error('Synthetic viewer grant unavailable'); let timer;
      try { await Promise.race([acceptance({ grant, snapshot: fixture.snapshot }), new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Recorded-view acceptance deadline exceeded')), 180000); })]); return 'accepted-recorded-view'; }
      finally { clearTimeout(timer); }
    } : waitForOwnerStop,
    stopWeb: stopOwnedWeb, removeDirectory: p => rmSync(p, { recursive: true, force: false }), signalController: controller, webRoot: root,
    report: value => { if (/^[A-Za-z0-9_-]{43}$/.test(value)) { grant = value; if (!acceptance) console.log(value); }
      else if (!acceptance) console.log(value.includes('then inspect /research') ? 'Enter this one-use viewer grant, then open /simulation. This grants no trading authority:' : value); },
  });
  fixture.close(); return result;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3 || process.argv[2] !== '--recorded-terminal-only') { console.error('Usage: node scripts/recorded-terminal-demo.mjs --recorded-terminal-only'); process.exitCode = 2; }
  else {
    process.env.NODE_ENV = 'test'; process.env.GELT_SYNTHETIC_ORDER_HARNESS = 'offline-test-only'; process.env.GELT_SYNTHETIC_MOCK_ROBINHOOD = 'offline-test-only';
    void runRecordedTerminal().catch(() => { console.error('Recorded terminal unavailable; uncertain owned fixtures retained for review.'); process.exitCode = 1; });
  }
}
