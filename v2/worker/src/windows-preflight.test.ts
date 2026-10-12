import { it } from 'vitest';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { prerequisiteProbes, nativePrerequisiteProbe, prerequisiteFailure, prerequisiteRequired } from './windows-prerequisite-fixture.js';
import { verifyNativeTransportFixtures } from './windows-transport-fixture.js';
import { safeStorageStage } from './windows-storage.js';
import { storageFixture } from './storage-fixture.js';
import { privateDirectory, writePrivateNew, readPrivate, replacePrivate, removePrivate } from './private-files.js';

// Each independent process retains the production deadline; failures cannot hide
// later operations or the transport/NTFS tests. Only sanitized results are printed.
for (const probe of prerequisiteProbes) {
  it.skipIf(process.platform !== 'win32')(`native ${prerequisiteRequired(probe) ? 'prerequisite' : 'diagnostic comparison'}: ${probe}`, async () => {
    const result = await nativePrerequisiteProbe(probe);
    console.log('Native synthetic prerequisite', JSON.stringify(result));
    if (prerequisiteFailure(probe, result.passed)) throw new Error(`Native prerequisite unavailable at ${result.stage}; no native acceptance`);
  });
}

it.skipIf(process.platform !== 'win32')('native preflight: closed/open/split-open framed success and actual DPAPI', async () => {
  // Identical public frames run under direct Node as well as Vitest. Retain
  // open-pipe/split-header/split-payload success, not just early rejection.
  try { await verifyNativeTransportFixtures(); }
  catch (error) {
    const stage = safeStorageStage((error as { storageStage?: unknown }).storageStage);
    throw new Error(`Native preflight unavailable at ${stage}; no native acceptance`);
  }
});

// Separate tests keep six DPAPI calls and seven filesystem calls each within the
// existing test budget, even when each approaches its unchanged 15s deadline.
it.skipIf(process.platform !== 'win32')('native preflight: real private NTFS create/read/replace/remove', () => {
  let root: string | undefined;
  try {
    const started = performance.now();
    root = storageFixture('gelt-preflight-'); privateDirectory(root);
    const file = join(root, 'synthetic'); writePrivateNew(file, 'synthetic-one');
    if (readPrivate(file).toString() !== 'synthetic-one') throw new Error();
    replacePrivate(file, 'synthetic-two');
    if (readPrivate(file).toString() !== 'synthetic-two') throw new Error();
    removePrivate(file);
    // Only public stage names and elapsed ms, never stdout/path/exception data.
    console.log('Native preflight seven synchronous private operations ms', Math.round(performance.now() - started));
  } catch (error) {
    const value = (error as { storageStage?: string }).storageStage;
    const stage = safeStorageStage(value ?? 'OPERATION');
    throw new Error(`Native preflight unavailable at ${stage}; no native acceptance`);
  } finally { if (root) rmSync(root, { recursive: true, force: true }); }
});
