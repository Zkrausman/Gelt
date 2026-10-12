import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { sendWebListeningAcknowledgement } from './web-ipc.mjs';
import {
  BOOTSTRAP_TTL_MS,
  FIXED_ARTIFACT_PATH,
  OWNER_DEMO_MAX_MS,
  assertLoopbackPortsFree,
  RESEARCH_EVIDENCE_BYTES,
  RESEARCH_EVIDENCE_ID,
  RESEARCH_EVIDENCE_SHA256,
  runOwnerResearchDemo,
  startOwnedWeb,
  stopOwnedWeb,
  waitForResearchPage,
} from './research-owner-demo.mjs';

const sourceRoot = fileURLToPath(new URL('../../', import.meta.url));
const original = readFileSync(join(sourceRoot, 'research/paper2agent/artifacts/evidence.json'));

function fakeChild({
  exitsOnShutdown = true,
  shutdownSendError = false,
  exitsOnKill = null,
} = {}) {
  const child = new EventEmitter();
  child.exitCode = null;
  child.signalCode = null;
  child.connected = true;
  child.spawned = true;
  child.pid = 424242;
  child.kills = [];
  child.messages = [];
  child.sendCallbackCount = 0;
  child.send = (message, callback) => {
    child.messages.push(message);
    if (callback) {
      child.sendCallbackCount += 1;
      callback(shutdownSendError ? new Error('synthetic IPC send failure') : null);
    }
    if (exitsOnShutdown && !shutdownSendError) {
      child.exitCode = 0;
      child.connected = false;
      child.emit('exit', 0, null);
      child.emit('close', 0, null);
    }
    return true;
  };
  child.kill = signal => {
    child.kills.push(signal);
    if (signal === exitsOnKill) {
      child.signalCode = signal;
      child.connected = false;
      child.emit('exit', null, signal);
      child.emit('close', null, signal);
    }
    return true;
  };
  return child;
}

function fakeRun({
  readyError = null,
  stopReason = 'signal:SIGINT',
  shutdownConfirmed = true,
  portError = null,
  writerMarkerAfterStop = false,
  bootstrapMarkerAfterStop = false,
  bootstrapInspectionError = false,
} = {}) {
  let serial = 0;
  let nonce = 0;
  const child = fakeChild({ exitsOnShutdown: shutdownConfirmed });
  const created = [];
  const removed = [];
  const writes = new Map();
  const reports = [];
  const timeouts = [];
  const launch = [];
  let provisioned = null;
  let importedBytes = null;
  let researchReadCount = 0;
  let writerMarkerPresent = false;
  let bootstrapMarkerPresent = false;
  let bffRoot = null;
  let bootstrapCheckCount = 0;
  const stopReportExitFlags = [];
  const signalController = {
    reason: null,
    signal: new Promise(() => {}),
    dispose() {},
  };
  const deps = {
    nodeMajor: 22,
    webRoot: '/target/v2',
    signalController,
    now: () => 1000,
    randomBytes(size) {
      nonce += 1;
      return Buffer.alloc(size, nonce);
    },
    createHash,
    readArtifact(path) {
      assert.equal(path, FIXED_ARTIFACT_PATH);
      return original;
    },
    storageFixture(prefix) {
      const path = '/private/' + prefix + String(++serial);
      if (prefix === 'gelt-research-owner-bff-') bffRoot = path;
      created.push(path);
      return path;
    },
    writePrivateNew(path, value) {
      writes.set(path, Buffer.isBuffer(value) ? Buffer.from(value) : Buffer.from(value));
    },
    provisionResearch(path, excluded) {
      provisioned = { path, excluded };
    },
    importResearchFile(path, inputPath) {
      importedBytes = writes.get(inputPath);
      const record = {
        evidence: { evidenceId: RESEARCH_EVIDENCE_ID },
        originalSha256: createHash('sha256').update(importedBytes).digest('hex'),
        originalBytes: importedBytes.length,
      };
      return { status: 'imported', record };
    },
    readResearch(path, evidenceId) {
      assert.equal(evidenceId, RESEARCH_EVIDENCE_ID);
      researchReadCount += 1;
      if (writerMarkerPresent) return { state: 'unavailable' };
      return {
        state: 'available',
        record: {
          evidence: { evidenceId },
          originalSha256: RESEARCH_EVIDENCE_SHA256,
          originalBytes: RESEARCH_EVIDENCE_BYTES,
        },
      };
    },
    childEnvironment() {
      return {
        NODE_ENV: 'production',
        NEXT_TELEMETRY_DISABLED: '1',
        API_HOST: '127.0.0.1',
        API_PORT: '4000',
        WORKER_HOST: '127.0.0.1',
        WORKER_PORT: '4100',
      };
    },
    async assertPortsFree() {
      if (portError) throw portError;
    },
    bootstrapMarkerClear(path) {
      assert.equal(path, bffRoot);
      assert.ok(child.exitCode !== null || child.signalCode !== null, 'inspect only after owned child exit');
      bootstrapCheckCount += 1;
      if (bootstrapInspectionError) throw new Error('synthetic bootstrap marker inspection failure');
      return !bootstrapMarkerPresent;
    },
    spawnWeb(options) {
      launch.push(options);
      return child;
    },
    async waitUntilReady() {
      if (readyError) throw readyError;
    },
    async waitForOwnerStop(web, controller, timeoutMs) {
      timeouts.push(timeoutMs);
      return stopReason;
    },
    async stopWeb(web) {
      const stopped = await stopOwnedWeb(web, async (owned, timeoutMs) => {
        timeouts.push(timeoutMs);
        if (shutdownConfirmed && (owned.exitCode !== null || owned.signalCode !== null)) return true;
        return false;
      });
      if (stopped && writerMarkerAfterStop) writerMarkerPresent = true;
      if (stopped && bootstrapMarkerAfterStop) bootstrapMarkerPresent = true;
      return stopped;
    },
    removeDirectory(path) {
      removed.push(path);
    },
    report(message) {
      if (message.includes('viewer stopped')) {
        stopReportExitFlags.push(child.exitCode !== null || child.signalCode !== null);
      }
      reports.push(message);
    },
  };
  return {
    deps, child, created, removed, writes, reports, timeouts, launch, stopReportExitFlags,
    get bffRoot() { return bffRoot; },
    get provisioned() { return provisioned; },
    get importedBytes() { return importedBytes; },
    get researchReadCount() { return researchReadCount; },
    get bootstrapCheckCount() { return bootstrapCheckCount; },
  };
}

test('imports only the fixed adopted bytes into distinct private roots and starts web with a minimal offline environment', async () => {
  const state = fakeRun();
  const result = await runOwnerResearchDemo(state.deps);

  assert.equal(result.status, 'stopped');
  assert.equal(result.evidenceId, RESEARCH_EVIDENCE_ID);
  assert.equal(result.originalSha256, RESEARCH_EVIDENCE_SHA256);
  assert.equal(result.originalBytes, RESEARCH_EVIDENCE_BYTES);
  assert.deepEqual(state.importedBytes, original);
  assert.equal(state.provisioned.excluded.length, 5);
  assert.equal(new Set([state.provisioned.path, ...state.provisioned.excluded]).size, 6);
  assert.equal(state.created.length, 7);
  assert.equal(state.launch.length, 1);
  assert.equal(state.launch[0].env.GELT_MODE, 'offline');
  assert.equal(state.launch[0].env.GELT_BFF_CONFIG, join(state.bffRoot, 'bff.json'));
  assert.ok(state.launch[0].env.GELT_RESEARCH_ROOT);
  for (const name of ['NODE_OPTIONS', 'HTTPS_PROXY', 'OPENAI_API_KEY', 'GELT_WORKER_CONFIG']) {
    assert.equal(state.launch[0].env[name], undefined);
  }
  const bootstrapPath = state.created
    .map(root => join(root, 'bootstrap.json'))
    .find(path => state.writes.has(path));
  const grant = JSON.parse(state.writes.get(bootstrapPath).toString('utf8'));
  assert.equal(grant.expiresAt, 1000 + BOOTSTRAP_TTL_MS);
  assert.equal(grant.digest, createHash('sha256').update(state.reports[2]).digest('hex'));
  assert.equal([...state.writes.values()].some(value => value.toString('utf8').includes(state.reports[2])), false);
  assert.equal(state.reports.some(line => line.includes('synthetic owner grant')), true);
  assert.equal(state.researchReadCount, 2, 'store is revalidated after web exit');
  assert.equal(state.bootstrapCheckCount, 1, 'bootstrap marker is checked after web exit');
  assert.deepEqual(state.stopReportExitFlags, [true]);
  assert.equal(state.reports.some(line => line.includes('stop requested')), true);
  assert.deepEqual(state.removed, [...state.created].reverse());
});

test('owner demo deadline is finite and cleanup follows the confirmed owned-child stop', async () => {
  const state = fakeRun({ stopReason: 'deadline' });
  const result = await runOwnerResearchDemo(state.deps);

  assert.equal(OWNER_DEMO_MAX_MS, 30 * 60 * 1000);
  assert.equal(result.stopReason, 'deadline');
  assert.ok(state.timeouts.includes(OWNER_DEMO_MAX_MS));
  assert.deepEqual(state.removed, [...state.created].reverse());
});

test('startup failure stops and joins only its owned web child before removing fixtures', async () => {
  const state = fakeRun({ readyError: new Error('synthetic readiness failure') });

  await assert.rejects(runOwnerResearchDemo(state.deps), /synthetic readiness failure/);
  assert.deepEqual(state.child.messages, [{ type: 'gelt:shutdown' }]);
  assert.deepEqual(state.removed, [...state.created].reverse());
});

test('port conflict refuses before creating fixtures or spawning a child', async () => {
  const state = fakeRun({ portError: new Error('EADDRINUSE') });

  await assert.rejects(runOwnerResearchDemo(state.deps), /EADDRINUSE/);
  assert.deepEqual(state.created, []);
  assert.deepEqual(state.launch, []);
  assert.deepEqual(state.removed, []);
});

test('uncertain child termination uses bounded escalation and preserves every fixture', async () => {
  const state = fakeRun({ shutdownConfirmed: false });

  await assert.rejects(runOwnerResearchDemo(state.deps), /termination was not confirmed/);
  assert.deepEqual(state.child.messages, [{ type: 'gelt:shutdown' }]);
  assert.deepEqual(state.child.kills, ['SIGTERM', 'SIGKILL']);
  assert.deepEqual(state.timeouts.slice(-3), [3000, 2000, 2000]);
  assert.deepEqual(state.removed, []);
  assert.deepEqual(state.stopReportExitFlags, []);
  assert.ok(state.reports.some(line => line.includes('fixture retained')));
});

test('owned spawn attaches an immediate error listener and fails readiness on spawn error', async () => {
  const child = fakeChild();
  let spawnOptions;
  const owned = startOwnedWeb({ cwd: '/target/v2', env: { GELT_MODE: 'offline' } }, (...args) => {
    spawnOptions = args;
    return child;
  });
  assert.equal(child.listenerCount('error'), 1);
  assert.equal(spawnOptions[0], process.execPath);
  assert.deepEqual(spawnOptions[1], ['--import', './scripts/offline-guard.mjs', 'scripts/web.mjs']);

  let pollStarted = false;
  const readiness = waitForResearchPage(owned, { reason: null }, {
    fetchImpl: async (_url, options) => {
      pollStarted = true;
      assert.equal(options.redirect, 'manual');
      await new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
    },
    now: () => 0,
    timeoutMs: 10000,
  });
  assert.equal(pollStarted, false, 'HTTP probing waits for an IPC bind confirmation');
  child.emit('error', new Error('synthetic spawn failure'));
  await assert.rejects(readiness, /Owned research web failed to start/);
});

test('matching loopback research HTML is ignored until the owned child confirms its listen callback', async () => {
  const child = fakeChild();
  let fetchCalls = 0;
  let readinessSettled = false;
  let releaseSleep;
  let sleepEntered;
  const enteredSleep = new Promise(resolve => { sleepEntered = resolve; });
  const readiness = waitForResearchPage(child, { reason: null }, {
    fetchImpl: async () => {
      fetchCalls += 1;
      return { status: 200, ok: true, redirected: false, async text() { return 'Research evidence'; } };
    },
    sleep: () => new Promise(resolve => {
      releaseSleep = resolve;
      sleepEntered();
    }),
    now: () => 0,
    timeoutMs: 1000,
  }).then(() => { readinessSettled = true; });

  await enteredSleep;
  await Promise.resolve();
  assert.equal(fetchCalls, 0, 'a competing listener cannot supply readiness HTML before owned bind confirmation');
  assert.equal(readinessSettled, false);

  child.emit('message', { type: 'gelt:web-listening' });
  releaseSleep();
  await readiness;
  assert.equal(fetchCalls, 1);
  assert.equal(readinessSettled, true);
});

test('owned bind failure before IPC confirmation rejects readiness and cleans only its owned fixtures', async () => {
  const state = fakeRun();
  let fetchCalls = 0;
  state.deps.waitUntilReady = (child, controller) => waitForResearchPage(child, controller, {
    fetchImpl: async () => {
      fetchCalls += 1;
      return { status: 200, ok: true, redirected: false, async text() { return 'Research evidence'; } };
    },
    sleep: async () => {
      child.exitCode = 1;
      child.connected = false;
      child.emit('exit', 1, null);
    },
    now: () => 0,
    timeoutMs: 250,
  });

  await assert.rejects(runOwnerResearchDemo(state.deps), /Owned research web exited during startup/);
  assert.equal(fetchCalls, 0);
  assert.deepEqual(state.removed, [...state.created].reverse());
  assert.deepEqual(state.launch.length, 1);
});

test('owned bind acknowledgement timeout follows bounded shutdown before fixture cleanup', async () => {
  const state = fakeRun();
  let now = 0;
  let fetchCalls = 0;
  state.deps.waitUntilReady = (child, controller) => waitForResearchPage(child, controller, {
    fetchImpl: async () => {
      fetchCalls += 1;
      return { status: 200, ok: true, redirected: false, async text() { return 'Research evidence'; } };
    },
    sleep: async ms => { now += ms; },
    now: () => now,
    timeoutMs: 250,
  });

  await assert.rejects(runOwnerResearchDemo(state.deps), /Research web readiness timed out/);
  assert.equal(fetchCalls, 0);
  assert.deepEqual(state.child.messages, [{ type: 'gelt:shutdown' }]);
  assert.deepEqual(state.child.kills, [], 'confirmed IPC shutdown needs no unbounded escalation');
  assert.deepEqual(state.removed, [...state.created].reverse());
});

test('owned web exit while readiness HTML is read prevents owner grant publication', async () => {
  const state = fakeRun();
  state.deps.waitUntilReady = (child, controller) => waitForResearchPage(child, controller, {
    fetchImpl: async () => ({
      status: 200,
      ok: true,
      redirected: false,
      async text() {
        child.exitCode = 1;
        child.connected = false;
        child.emit('exit', 1, null);
        return 'Research evidence';
      },
    }),
    sleep: async () => { child.emit('message', { type: 'gelt:web-listening' }); },
    now: () => 0,
    timeoutMs: 250,
  });
  await assert.rejects(runOwnerResearchDemo(state.deps), /Owned research web exited during startup/);
  assert.equal([...state.writes.keys()].some(path => path.endsWith('/bootstrap.json')), false);
  assert.equal(state.reports.some(line => line.includes('synthetic owner grant')), false);
  assert.deepEqual(state.removed, [...state.created].reverse());
});

test('web listen acknowledgement handles a synchronous IPC send failure through owned shutdown', () => {
  let stopped = 0;
  const connected = {
    connected: true,
    send() { throw new Error('synthetic disconnected channel'); },
  };

  assert.equal(sendWebListeningAcknowledgement(connected, () => { stopped += 1; }), false);
  assert.equal(stopped, 1);
});

test('web listen acknowledgement handles an asynchronous IPC send failure through owned shutdown', () => {
  let stopped = 0;
  let callback;
  const connected = {
    connected: true,
    send(_message, onComplete) { callback = onComplete; return true; },
  };

  assert.equal(sendWebListeningAcknowledgement(connected, () => { stopped += 1; }), true);
  callback(new Error('synthetic IPC callback failure'));
  assert.equal(stopped, 1);
});

test('IPC shutdown callback failure falls back to TERM for the owned child', async () => {
  const child = fakeChild({
    exitsOnShutdown: false,
    shutdownSendError: true,
    exitsOnKill: 'SIGTERM',
  });

  assert.equal(await stopOwnedWeb(child), true);
  assert.deepEqual(child.messages, [{ type: 'gelt:shutdown' }]);
  assert.equal(child.sendCallbackCount, 1);
  assert.deepEqual(child.kills, ['SIGTERM']);
});

test('post-exit store revalidation preserves roots when a synthetic writer marker appears', async () => {
  const state = fakeRun({ writerMarkerAfterStop: true });

  await assert.rejects(runOwnerResearchDemo(state.deps), /Research store state was not verified/);
  assert.equal(state.researchReadCount, 2, 'the second read occurs after the owned child exits');
  assert.deepEqual(state.removed, []);
  assert.deepEqual(state.stopReportExitFlags, [true]);
  assert.ok(state.reports.some(line => line.includes('fixture retained')));
});

test('post-exit bootstrap consumption marker preserves all fixture roots', async () => {
  const state = fakeRun({ bootstrapMarkerAfterStop: true });

  await assert.rejects(runOwnerResearchDemo(state.deps), /Owner bootstrap state was uncertain/);
  assert.equal(state.bootstrapCheckCount, 1);
  assert.equal(state.researchReadCount, 2);
  assert.deepEqual(state.removed, []);
  assert.ok(state.reports.some(line => line.includes('fixture retained')));
});

test('bootstrap marker inspection failure preserves all fixture roots', async () => {
  const state = fakeRun({ bootstrapInspectionError: true });

  await assert.rejects(runOwnerResearchDemo(state.deps), /Owner bootstrap state was uncertain/);
  assert.equal(state.bootstrapCheckCount, 1);
  assert.deepEqual(state.removed, []);
  assert.ok(state.reports.some(line => line.includes('fixture retained')));
});

test('readiness rejects redirects without reading redirected research HTML', async () => {
  const child = fakeChild();
  let now = 0;
  let calls = 0;
  let textReads = 0;
  const readiness = waitForResearchPage(child, { reason: null }, {
    fetchImpl: async (_url, options) => {
      calls += 1;
      assert.equal(options.redirect, 'manual');
      return {
        status: 200,
        ok: true,
        redirected: true,
        body: { async cancel() {} },
        async text() { textReads += 1; return 'Research evidence'; },
      };
    },
    sleep: async ms => { now += ms; },
    now: () => now,
    timeoutMs: 250,
  });
  child.emit('message', { type: 'gelt:web-listening' });

  await assert.rejects(readiness, /Research web readiness rejected a redirect/);
  assert.equal(calls, 1);
  assert.equal(textReads, 0);
});

test('preflight refuses occupied research or worker loopback ports without launching', async () => {
  const ports = [];
  class Probe extends EventEmitter {
    listen(options, ready) { ports.push(options.port); ready(); }
    close(done) { done(); }
  }
  await assertLoopbackPortsFree(() => new Probe());
  assert.deepEqual(ports, [3000, 4100]);
});
