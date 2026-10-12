import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { createHash, randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join, resolve } from 'node:path';
import { childEnvironment, root } from './runtime.mjs';

export const RESEARCH_EVIDENCE_ID = 'pyportfolioopt-min-variance-e5d60a73f45f77f1edf7234b';
export const RESEARCH_EVIDENCE_BYTES = 12160;
export const RESEARCH_EVIDENCE_SHA256 = 'c386b43d907f3375563422f27c5313268337f7f399821c318a69261f0731bb96';
export const OWNER_DEMO_MAX_MS = 30 * 60 * 1000;
export const BOOTSTRAP_TTL_MS = 30 * 60 * 1000;
export const STARTUP_TIMEOUT_MS = 30 * 1000;
const IPC_SEND_CALLBACK_WAIT_MS = 1000;
const SHUTDOWN_WAIT_MS = 3000;
const TERM_WAIT_MS = 2000;
const KILL_WAIT_MS = 2000;
export const FIXED_ARTIFACT_PATH = resolve(root, '../research/paper2agent/artifacts/evidence.json');

const childErrorObservations = new WeakMap();
const childListeningObservations = new WeakMap();

function observeOwnedWebListening(child) {
  let observed = childListeningObservations.get(child);
  if (observed) return observed;
  observed = { listening: false };
  const onMessage = message => {
    if (message?.type !== 'gelt:web-listening') return;
    observed.listening = true;
    child.removeListener('message', onMessage);
    child.removeListener('exit', removeMessageListener);
  };
  const removeMessageListener = () => child.removeListener('message', onMessage);
  child.on('message', onMessage);
  child.once('exit', removeMessageListener);
  childListeningObservations.set(child, observed);
  return observed;
}

export function observeOwnedChildErrors(child) {
  let observed = childErrorObservations.get(child);
  if (!observed) {
    let resolveFirstError;
    observed = {
      error: null,
      firstError: new Promise(resolve => { resolveFirstError = resolve; }),
    };
    child.on('error', error => {
      observed.error ??= error;
      if (resolveFirstError) {
        resolveFirstError(error);
        resolveFirstError = null;
      }
    });
    childErrorObservations.set(child, observed);
  }
  return observed;
}

function childHasExited(child) {
  return Boolean(child && (
    (child.exitCode !== null && child.exitCode !== undefined) ||
    (child.signalCode !== null && child.signalCode !== undefined) ||
    (child.pid === undefined && child.spawned === false)
  ));
}

export function createStopController(target = process) {
  let reason = null;
  let resolveSignal;
  const signal = new Promise(resolve => { resolveSignal = resolve; });
  const handlers = new Map();
  for (const name of ['SIGINT', 'SIGTERM']) {
    const handler = () => {
      if (reason !== null) return;
      reason = name;
      resolveSignal(name);
    };
    handlers.set(name, handler);
    target.once(name, handler);
  }
  return {
    get reason() { return reason; },
    signal,
    dispose() {
      for (const [name, handler] of handlers) target.removeListener(name, handler);
    },
  };
}

export async function assertLoopbackPortsFree(createServerImpl = createServer, ports = [3000, 4100]) {
  for (const port of ports) {
    const probe = createServerImpl();
    let listening = false;
    try {
      await new Promise((resolveListen, reject) => {
        probe.once('error', reject);
        probe.listen({ host: '127.0.0.1', port, exclusive: true }, resolveListen);
      });
      listening = true;
    } finally {
      if (listening) await new Promise(resolveClose => probe.close(resolveClose));
    }
  }
}

function waitForChildExit(child, timeoutMs) {
  observeOwnedChildErrors(child);
  if (childHasExited(child)) return Promise.resolve(true);
  return new Promise(resolve => {
    let settled = false;
    const finish = result => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.removeListener('exit', onExit);
      child.removeListener('close', onExit);
      resolve(result);
    };
    const onExit = () => finish(true);
    const timer = setTimeout(() => finish(childHasExited(child)), timeoutMs);
    child.once('exit', onExit);
    child.once('close', onExit);
    if (childHasExited(child)) finish(true);
  });
}

function signalOwnedChild(child, signal) {
  try { return child.kill(signal); } catch { return false; }
}

function sendOwnedShutdown(child) {
  if (!child.connected) return Promise.resolve(false);
  return new Promise(resolve => {
    let settled = false;
    const finish = sent => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(sent);
    };
    const timer = setTimeout(() => finish(false), IPC_SEND_CALLBACK_WAIT_MS);
    try {
      const queued = child.send({ type: 'gelt:shutdown' }, error => finish(!error));
      if (queued === false) finish(false);
    } catch {
      finish(false);
    }
  });
}

/** Bounded join of this launcher's web child only. Never discovers or kills by port/PID. */
export async function stopOwnedWeb(child, waitForExit = waitForChildExit) {
  if (!child || childHasExited(child)) return true;
  observeOwnedChildErrors(child);
  const sentShutdown = await sendOwnedShutdown(child);
  let sentTerm = false;
  if (!sentShutdown) {
    signalOwnedChild(child, 'SIGTERM');
    sentTerm = true;
  }
  if (childHasExited(child) || await waitForExit(child, SHUTDOWN_WAIT_MS)) return true;
  if (childHasExited(child)) return true;

  if (!sentTerm) signalOwnedChild(child, 'SIGTERM');
  if (await waitForExit(child, TERM_WAIT_MS)) return true;
  if (childHasExited(child)) return true;

  signalOwnedChild(child, 'SIGKILL');
  return waitForExit(child, KILL_WAIT_MS);
}

export async function waitForResearchPage(child, stopController, {
  fetchImpl = fetch,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  now = Date.now,
  timeoutMs = STARTUP_TIMEOUT_MS,
} = {}) {
  const observed = observeOwnedChildErrors(child);
  const ownedWeb = observeOwnedWebListening(child);
  const abort = new AbortController();
  const startupFailure = observed.firstError.then(() => {
    throw new Error('Owned research web failed to start.');
  });
  const poll = async () => {
    const deadline = now() + timeoutMs;
    while (now() < deadline) {
      if (stopController.reason) throw new Error('Stop requested during web startup.');
      if (observed.error) throw new Error('Owned research web failed during startup.');
      if (childHasExited(child)) throw new Error('Owned research web exited during startup.');
      // Do not even probe HTTP until this child confirms its own listen callback.
      // This avoids reusing a connection to a competing server that won the port race.
      if (!ownedWeb.listening) {
        await sleep(100);
        continue;
      }
      let response;
      try {
        response = await fetchImpl('http://127.0.0.1:3000/research', {
          redirect: 'manual',
          signal: AbortSignal.any([AbortSignal.timeout(1000), abort.signal]),
        });
      } catch {
        if (observed.error) throw new Error('Owned research web failed during startup.');
      }
      if (observed.error) throw new Error('Owned research web failed during startup.');
      if (response && (response.redirected || (response.status >= 300 && response.status < 400))) {
        try { await response.body?.cancel(); } catch {}
        throw new Error('Research web readiness rejected a redirect.');
      }
      if (response?.ok) {
        const page = await response.text();
        if (stopController.reason) throw new Error('Stop requested during web startup.');
        if (observed.error) throw new Error('Owned research web failed during startup.');
        if (childHasExited(child)) throw new Error('Owned research web exited during startup.');
        if (page.includes('Research evidence')) return;
      }
      await sleep(100);
    }
    throw new Error('Research web readiness timed out.');
  };
  try {
    await Promise.race([poll(), startupFailure]);
  } finally {
    abort.abort();
  }
}

export function waitForOwnerStop(child, stopController, timeoutMs = OWNER_DEMO_MAX_MS) {
  if (childHasExited(child)) return Promise.resolve('child-exit');
  if (stopController.reason) return Promise.resolve('signal:' + stopController.reason);
  return new Promise(resolve => {
    let settled = false;
    const finish = result => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.removeListener('exit', onExit);
      child.removeListener('close', onExit);
      resolve(result);
    };
    const onExit = () => finish('child-exit');
    const timer = setTimeout(() => finish('deadline'), timeoutMs);
    child.once('exit', onExit);
    child.once('close', onExit);
    stopController.signal.then(reason => finish('signal:' + reason));
    if (childHasExited(child)) finish('child-exit');
    else if (stopController.reason) finish('signal:' + stopController.reason);
  });
}

export function makeResearchWebEnvironment(base, bffConfig, researchRoot) {
  return {
    ...base,
    GELT_MODE: 'offline',
    GELT_SIMULATION_DIAGNOSTICS: '1',
    GELT_BFF_CONFIG: bffConfig,
    GELT_RESEARCH_ROOT: researchRoot,
  };
}

function matchesAdoptedResearch(readback, digest) {
  return readback?.state === 'available' &&
    readback.record?.evidence?.evidenceId === RESEARCH_EVIDENCE_ID &&
    readback.record?.originalSha256 === digest &&
    readback.record?.originalBytes === RESEARCH_EVIDENCE_BYTES;
}

export function bootstrapConsumptionMarkerClear(bffRoot, verifyPrivateDirectory) {
  verifyPrivateDirectory(bffRoot);
  const marker = join(bffRoot, 'bootstrap.json.lock');
  try {
    fs.lstatSync(marker);
    return false;
  } catch (error) {
    if (error?.code === 'ENOENT') return true;
    throw error;
  }
}

function validateAdoptedArtifact(bytes, createHashImpl = createHash) {
  if (!Buffer.isBuffer(bytes)) throw new Error('Fixed research evidence is not a byte buffer.');
  if (bytes.length !== RESEARCH_EVIDENCE_BYTES) throw new Error('Fixed research evidence length mismatch.');
  const digest = createHashImpl('sha256').update(bytes).digest('hex');
  if (digest !== RESEARCH_EVIDENCE_SHA256) throw new Error('Fixed research evidence digest mismatch.');
  let parsed;
  try { parsed = JSON.parse(bytes.toString('utf8')); } catch { throw new Error('Fixed research evidence JSON is invalid.'); }
  if (parsed?.evidenceId !== RESEARCH_EVIDENCE_ID) throw new Error('Fixed research evidence ID mismatch.');
  return digest;
}

/**
 * Compose existing private fixture/store/session/web mechanisms. Dependencies are
 * injected only to make lifecycle decisions testable without starting services.
 */
export async function runOwnerResearchDemo(deps) {
  if (deps.nodeMajor !== 22) throw new Error('Use the approved Node 22 runtime.');
  if (deps.signalController.reason) throw new Error('Stop requested before startup.');

  const roots = [];
  const rootSet = new Set();
  const allocate = prefix => {
    const path = deps.storageFixture(prefix);
    if (rootSet.has(path)) throw new Error('Private fixture helper returned a duplicate path.');
    rootSet.add(path);
    roots.push(path);
    return path;
  };

  let researchWriteAttempted = false;
  let researchVerified = false;
  let bffRoot = null;
  let bootstrapStateVerified = true;
  let researchRoot = null;
  let expectedDigest = null;
  let web = null;
  let stopReason = null;
  let primaryError = null;
  let cleanupError = null;
  let childStopped = true;

  try {
    await deps.assertPortsFree();
    if (deps.signalController.reason) throw new Error('Stop requested before fixture creation.');

    const original = Buffer.from(deps.readArtifact(FIXED_ARTIFACT_PATH));
    expectedDigest = validateAdoptedArtifact(original, deps.createHash);
    bffRoot = allocate('gelt-research-owner-bff-');
    researchRoot = allocate('gelt-research-owner-store-');
    const keyRoot = allocate('gelt-research-owner-key-');
    const workerRoot = allocate('gelt-research-owner-worker-');
    const ownerRoot = allocate('gelt-research-owner-bootstrap-');
    const ledgerRoot = allocate('gelt-research-owner-ledger-');
    const inputRoot = allocate('gelt-research-owner-input-');

    const inputPath = join(inputRoot, 'evidence.json');
    deps.writePrivateNew(inputPath, original);

    researchWriteAttempted = true;
    deps.provisionResearch(researchRoot, [keyRoot, workerRoot, bffRoot, ownerRoot, ledgerRoot]);
    const imported = deps.importResearchFile(researchRoot, inputPath);
    if (imported?.status !== 'imported' ||
        imported.record?.evidence?.evidenceId !== RESEARCH_EVIDENCE_ID ||
        imported.record?.originalSha256 !== expectedDigest ||
        imported.record?.originalBytes !== RESEARCH_EVIDENCE_BYTES) {
      throw new Error('Research import receipt did not bind the fixed original bytes.');
    }
    const readback = deps.readResearch(researchRoot, RESEARCH_EVIDENCE_ID);
    if (!matchesAdoptedResearch(readback, expectedDigest)) {
      throw new Error('Private research store readback did not match the adopted evidence.');
    }
    researchVerified = true;

    const bffConfig = join(bffRoot, 'bff.json');
    const serviceSecret = deps.randomBytes(32).toString('base64url');
    deps.writePrivateNew(bffConfig, JSON.stringify({ serviceSecret }));

    if (deps.signalController.reason) throw new Error('Stop requested before web startup.');
    const env = makeResearchWebEnvironment(deps.childEnvironment(), bffConfig, researchRoot);
    web = deps.spawnWeb({ cwd: deps.webRoot, env });
    observeOwnedChildErrors(web);
    await deps.waitUntilReady(web, deps.signalController);

    if (deps.signalController.reason) throw new Error('Stop requested before owner bootstrap setup.');
    if (observeOwnedChildErrors(web).error) throw new Error('Owned research web failed before owner bootstrap setup.');
    if (childHasExited(web)) throw new Error('Owned research web exited before owner bootstrap setup.');
    const bootstrap = deps.randomBytes(32).toString('base64url');
    const expiresAt = deps.now() + BOOTSTRAP_TTL_MS;
    const bootstrapPath = join(bffRoot, 'bootstrap.json');
    const grant = {
      digest: deps.createHash('sha256').update(bootstrap).digest('hex'),
      expiresAt,
    };
    if (deps.signalController.reason) throw new Error('Stop requested before owner bootstrap publication.');
    if (observeOwnedChildErrors(web).error) throw new Error('Owned research web failed before owner bootstrap publication.');
    if (childHasExited(web)) throw new Error('Owned research web exited before owner bootstrap publication.');
    deps.writePrivateNew(bootstrapPath, JSON.stringify(grant));

    deps.report('Temporary research-only view ready at http://127.0.0.1:3000/connect');
    deps.report('Enter this one-use synthetic owner grant before it expires, then inspect /research:');
    deps.report(bootstrap);
    deps.report('The grant is not a production credential. This web-only demo stops after 30 minutes or Ctrl-C.');
    stopReason = await deps.waitForOwnerStop(web, deps.signalController, OWNER_DEMO_MAX_MS);
    deps.report('Temporary research-only viewer stop requested (' + stopReason + '); waiting for the owned web process to exit.');
    if (stopReason === 'child-exit') throw new Error('Owned research web exited unexpectedly.');
  } catch (error) {
    primaryError = error instanceof Error ? error.message : 'Unknown research demo failure.';
  } finally {
    if (web) {
      try { childStopped = await deps.stopWeb(web); } catch { childStopped = false; }
      if (childStopped && stopReason && stopReason !== 'child-exit') {
        deps.report('Temporary research-only viewer stopped (' + stopReason + '). Close the browser tab to clear the protected view.');
      }
    }

    if (childStopped && researchWriteAttempted && researchRoot && expectedDigest) {
      try {
        researchVerified = matchesAdoptedResearch(deps.readResearch(researchRoot, RESEARCH_EVIDENCE_ID), expectedDigest);
      } catch {
        researchVerified = false;
      }
    }
    if (childStopped && bffRoot) {
      try {
        bootstrapStateVerified = deps.bootstrapMarkerClear(bffRoot) === true;
      } catch {
        bootstrapStateVerified = false;
      }
    }

    const mayRemove = childStopped && (!researchWriteAttempted || researchVerified) && bootstrapStateVerified;
    if (mayRemove) {
      const failures = [];
      for (const path of [...roots].reverse()) {
        try { deps.removeDirectory(path); } catch { failures.push(path); }
      }
      if (failures.length > 0) cleanupError = 'Could not clean owned fixture roots: ' + failures.join(', ');
    } else {
      deps.report('Temporary research fixture retained because store, bootstrap, or owned web termination state is uncertain:');
      for (const path of roots) deps.report(path);
    }
    deps.signalController.dispose();
  }

  if (primaryError) {
    if (!childStopped || (researchWriteAttempted && !researchVerified) || !bootstrapStateVerified) {
      throw new Error(primaryError + ' Temporary fixture roots were retained for review: ' + roots.join(', '));
    }
    if (cleanupError) throw new Error(primaryError + ' ' + cleanupError);
    throw new Error(primaryError);
  }
  if (!childStopped) {
    throw new Error('Owned research web termination was not confirmed; fixture roots were retained: ' + roots.join(', '));
  }
  if (researchWriteAttempted && !researchVerified) {
    throw new Error('Research store state was not verified; fixture roots were retained: ' + roots.join(', '));
  }
  if (!bootstrapStateVerified) {
    throw new Error('Owner bootstrap state was uncertain; fixture roots were retained: ' + roots.join(', '));
  }
  if (cleanupError) throw new Error(cleanupError);
  return { status: 'stopped', stopReason, evidenceId: RESEARCH_EVIDENCE_ID, originalSha256: RESEARCH_EVIDENCE_SHA256, originalBytes: RESEARCH_EVIDENCE_BYTES };
}

async function waitForChildBuilds() {
  const required = [
    join(root, 'web', '.next'),
    join(root, 'worker', 'dist', 'research-store.js'),
    join(root, 'worker', 'dist', 'storage-fixture.js'),
    join(root, 'worker', 'dist', 'private-files.js'),
  ];
  if (required.some(path => !fs.existsSync(path))) {
    throw new Error('Build the locked V2 workspace first; this opt-in launcher never installs dependencies or builds the app.');
  }
}

export function startOwnedWeb({ cwd, env }, spawnImpl = spawn) {
  const child = spawnImpl(process.execPath, [
    '--import', './scripts/offline-guard.mjs',
    'scripts/web.mjs',
  ], {
    cwd,
    env,
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  });
  observeOwnedChildErrors(child);
  observeOwnedWebListening(child);
  return child;
}

async function main() {
  if (Number(process.versions.node.split('.')[0]) !== 22) {
    throw new Error('This temporary viewer requires the supported Node 22 runtime.');
  }
  await waitForChildBuilds();

  const storage = await import(pathToFileURL(join(root, 'worker', 'dist', 'storage-fixture.js')).href);
  const privateFiles = await import(pathToFileURL(join(root, 'worker', 'dist', 'private-files.js')).href);
  const research = await import(pathToFileURL(join(root, 'worker', 'dist', 'research-store.js')).href);
  const signalController = createStopController(process);
  await runOwnerResearchDemo({
    nodeMajor: Number(process.versions.node.split('.')[0]),
    storageFixture: storage.storageFixture,
    writePrivateNew: privateFiles.writePrivateNew,
    provisionResearch: research.provisionResearch,
    importResearchFile: research.importResearchFile,
    readResearch: research.readResearch,
    readArtifact: path => fs.readFileSync(path),
    randomBytes,
    createHash,
    now: Date.now,
    assertPortsFree: () => assertLoopbackPortsFree(),
    bootstrapMarkerClear: bffRoot => bootstrapConsumptionMarkerClear(bffRoot, privateFiles.privateDirectory),
    childEnvironment: () => childEnvironment(),
    spawnWeb: options => startOwnedWeb({ ...options, cwd: root }),
    waitUntilReady: (child, controller) => waitForResearchPage(child, controller),
    waitForOwnerStop,
    stopWeb: child => stopOwnedWeb(child),
    removeDirectory: path => fs.rmSync(path, { recursive: true, force: true }),
    signalController,
    webRoot: root,
    report: message => console.log(message),
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3 || process.argv[2] !== '--owner-demo-only') {
    console.error('Usage: node scripts/research-owner-demo.mjs --owner-demo-only');
    process.exitCode = 2;
  } else {
    void main().catch(error => {
      console.error('Research owner demo stopped: ' + (error instanceof Error ? error.message : 'unknown failure'));
      process.exitCode = 1;
    });
  }
}
