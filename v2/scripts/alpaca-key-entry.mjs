import fs from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const helperUrl = new URL('../worker/dist/alpaca-iex-credentials.js', import.meta.url);
const EXIT = Object.freeze({ ok: 0, usage: 2, runtime: 3, preflight: 4, build: 5, uncertain: 6 });
const USAGE = [
  'Usage: node v2/scripts/alpaca-key-entry.mjs --data-dir ABSOLUTE_PATH --broker-vault-dir ABSOLUTE_PATH',
  'Enter an Alpaca key ID and secret key through a dedicated hidden Linux TTY.',
  'This stores a local key pair only; it does not check provider access or activate an account.',
].join('\n');
const START_NOTICE = [
  'If entry is interrupted or reports an error, treat storage as uncertain.',
  'Stop. Do not retry, delete, chmod, revoke, or clean up. Follow the read-only metadata reconciliation procedure in docs/specs/Alpaca-Key-Entry-CLI.md.',
].join('\n');
const UNCERTAIN_NOTICE = 'Entry outcome is uncertain. Stop. Do not retry, delete, chmod, revoke, or clean up. Follow the read-only metadata reconciliation procedure in docs/specs/Alpaca-Key-Entry-CLI.md.';
const WRITE_CALLBACK_TIMEOUT_MS = 5_000;

class UsageFailure extends Error {}
class PreflightFailure extends Error {}

function outputLifecycle(streams) {
  let failed = false;
  let pending = 0;
  const listeners = [];
  const failureHandlers = new Set();
  const drainWaiters = [];

  const fail = () => {
    if (failed) return;
    failed = true;
    for (const handler of [...failureHandlers]) {
      try { handler(); } catch { /* Keep the output boundary sanitized. */ }
    }
  };
  const completeOne = () => {
    pending--;
    if (pending === 0) for (const resolveWaiter of drainWaiters.splice(0)) resolveWaiter();
  };

  for (const stream of new Set(streams)) {
    if (typeof stream?.on !== 'function' || typeof stream?.off !== 'function') {
      fail();
      continue;
    }
    const listener = () => fail();
    try {
      stream.on('error', listener);
      listeners.push({ stream, listener });
    } catch { fail(); }
  }

  return {
    get failed() { return failed; },
    onFailure(handler) {
      if (failed) {
        try { handler(); } catch { /* Keep the output boundary sanitized. */ }
        return () => {};
      }
      failureHandlers.add(handler);
      return () => failureHandlers.delete(handler);
    },
    write(stream, value) {
      if (typeof stream?.write !== 'function') {
        fail();
        return false;
      }
      pending++;
      let completed = false;
      let timer;
      const complete = error => {
        if (error) fail();
        if (completed) return;
        completed = true;
        if (timer) clearTimeout(timer);
        completeOne();
      };
      timer = setTimeout(() => {
        fail();
        complete();
      }, WRITE_CALLBACK_TIMEOUT_MS);
      try {
        stream.write(value, complete);
        return !failed;
      } catch {
        fail();
        complete();
        return false;
      }
    },
    async drain() {
      for (;;) {
        if (pending > 0) await new Promise(resolveWaiter => drainWaiters.push(resolveWaiter));
        // A Writable callback may run before a queued error event from that same write.
        await Promise.resolve();
        if (pending === 0) return;
      }
    },
    async checkpointNextTurn() {
      await this.drain();
      await new Promise(resolveTurn => setImmediate(resolveTurn));
      await this.drain();
    },
    close() {
      failureHandlers.clear();
      for (const { stream, listener } of listeners.splice(0)) {
        try { stream.off('error', listener); } catch { /* Do not leak raw stream errors. */ }
      }
    },
  };
}

function writeLine(output, value, lifecycle) {
  return lifecycle.write(output, `${value}\n`);
}

function installMainOutputErrorGuard() {
  let failed = false;
  const swallow = () => {
    failed = true;
    try {
      if (process.exitCode == null || process.exitCode === EXIT.ok) process.exitCode = EXIT.uncertain;
    } catch { /* Never print or replace an output-stream error. */ }
  };
  for (const stream of new Set([process.stdout, process.stderr])) {
    try { stream.on('error', swallow); } catch { failed = true; }
  }
  return { get failed() { return failed; } };
}

function parseArguments(argv) {
  if (argv.length === 1 && argv[0] === '--help') return { help: true };
  if (argv.length !== 4) throw new UsageFailure();
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    if ((flag !== '--data-dir' && flag !== '--broker-vault-dir') || values.has(flag)) throw new UsageFailure();
    values.set(flag, argv[index + 1]);
  }
  if (values.size !== 2) throw new UsageFailure();
  return { help: false, dataDirectory: values.get('--data-dir'), brokerVaultDirectory: values.get('--broker-vault-dir') };
}

function safeAbsoluteDirectory(path) {
  return typeof path === 'string' && isAbsolute(path) && path === resolve(path)
    && basename(path) !== '.' && basename(path) !== '/';
}

function directoryMetadata(path, uid) {
  if (!safeAbsoluteDirectory(path) || fs.realpathSync.native(path) !== path) throw new PreflightFailure();
  const chain = [];
  let current = path;
  for (;;) {
    const stat = fs.lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new PreflightFailure();
    const mode = stat.mode & 0o777;
    if (current === path) {
      if (stat.uid !== uid || mode !== 0o700) throw new PreflightFailure();
    } else {
      const trustedOwner = stat.uid === 0 || stat.uid === uid;
      const safeMode = (mode & 0o022) === 0 || (stat.uid === 0 && (stat.mode & 0o1000) !== 0);
      if (!trustedOwner || !safeMode) throw new PreflightFailure();
    }
    chain.push({ dev: stat.dev, ino: stat.ino });
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return chain;
}

function contains(parent, child) {
  const path = relative(parent, child);
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}

function validatePaths(dataDirectory, brokerVaultDirectory, uid) {
  if (!safeAbsoluteDirectory(dataDirectory) || !safeAbsoluteDirectory(brokerVaultDirectory)) throw new PreflightFailure();
  if (contains(dataDirectory, brokerVaultDirectory) || contains(brokerVaultDirectory, dataDirectory)) throw new PreflightFailure();
  const parent = dirname(dataDirectory);
  const parentChain = directoryMetadata(parent, uid);
  const brokerChain = directoryMetadata(brokerVaultDirectory, uid);
  const brokerIdentity = brokerChain[0];
  if (parentChain.some(entry => entry.dev === brokerIdentity.dev && entry.ino === brokerIdentity.ino)) throw new PreflightFailure();
  try {
    fs.lstatSync(dataDirectory);
    throw new PreflightFailure();
  } catch (error) {
    if (error instanceof PreflightFailure) throw error;
    if (error?.code !== 'ENOENT') throw new PreflightFailure();
  }
}

function validateRuntime(platform, nodeVersion, env, execArgv) {
  if (platform !== 'linux' || !/^22\.\d+\.\d+$/.test(String(nodeVersion)) || typeof process.getuid !== 'function') throw new Error('runtime');
  const unsafeEnvironment = ['NODE_OPTIONS', 'NODE_DEBUG', 'NODE_DEBUG_NATIVE', 'NODE_V8_COVERAGE', 'NODE_REDIRECT_WARNINGS']
    .some(name => typeof env[name] === 'string' && env[name].length > 0);
  if (unsafeEnvironment || !Array.isArray(execArgv) || execArgv.length !== 0) throw new Error('launch');
}

function validateTerminal(input, output) {
  try {
    if (!input?.isTTY || !output?.isTTY || typeof input.isRaw !== 'boolean'
      || typeof input.setRawMode !== 'function' || typeof input.listenerCount !== 'function'
      || typeof input.on !== 'function' || typeof input.off !== 'function'
      || typeof input.pause !== 'function' || typeof input.resume !== 'function'
      || typeof output.write !== 'function' || typeof output.on !== 'function' || typeof output.off !== 'function'
      || input.listenerCount('data') !== 0 || input.listenerCount('readable') !== 0) throw new PreflightFailure();
  } catch {
    throw new PreflightFailure();
  }
}

function entryTerminal(input, output, signals, lifecycle) {
  let outputFailed = false;
  let inputErrorListener;
  const onOutputError = () => {
    outputFailed = true;
    try { inputErrorListener?.(); } catch { /* The entry helper owns sanitized cleanup. */ }
  };
  const removeFailureHandler = lifecycle.onFailure(onOutputError);
  const wrappedInput = {
    get isTTY() { return input.isTTY; },
    get isRaw() { return input.isRaw; },
    listenerCount(event) { return input.listenerCount(event); },
    setRawMode(mode) { return input.setRawMode(mode); },
    on(event, listener) {
      const result = input.on(event, listener);
      if (event === 'error') {
        inputErrorListener = listener;
        if (outputFailed) listener();
      }
      return result;
    },
    off(event, listener) {
      if (event === 'error' && inputErrorListener === listener) inputErrorListener = undefined;
      return input.off(event, listener);
    },
    resume() { return input.resume(); },
    pause() { return input.pause(); },
  };
  return {
    terminal: {
      input: wrappedInput,
      output: { get isTTY() { return output.isTTY; }, write(value) { return lifecycle.write(output, value); } },
      signals,
    },
    get outputFailed() { return outputFailed; },
    close() {
      inputErrorListener = undefined;
      removeFailureHandler();
    },
  };
}

async function loadBuiltHelper(url) {
  const path = fileURLToPath(url);
  const stat = fs.lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('build');
  return import(url.href);
}

/** Test seam: injected dependencies are available only through module import, never CLI flags. */
export async function runAlpacaKeyEntryCli(overrides = {}) {
  const argv = overrides.argv ?? process.argv.slice(2);
  const env = overrides.env ?? process.env;
  const platform = overrides.platform ?? process.platform;
  const nodeVersion = overrides.nodeVersion ?? process.versions.node;
  const execArgv = overrides.execArgv ?? process.execArgv;
  const input = overrides.input ?? process.stdin;
  const output = overrides.output ?? process.stdout;
  const errorOutput = overrides.errorOutput ?? process.stderr;
  const lifecycle = outputLifecycle([output, errorOutput]);
  let entryStarted = false;
  let result = EXIT.preflight;
  const execute = async () => {
    let args;
    try { args = parseArguments(argv); } catch {
      writeLine(errorOutput, 'Invalid arguments.', lifecycle);
      writeLine(errorOutput, USAGE, lifecycle);
      return EXIT.usage;
    }
    if (args.help) return writeLine(output, USAGE, lifecycle) ? EXIT.ok : EXIT.preflight;

    try { validateRuntime(platform, nodeVersion, env, execArgv); }
    catch (error) {
      if (error.message === 'runtime') {
        writeLine(errorOutput, 'Unsupported runtime. Use trusted Node.js 22 on Linux.', lifecycle);
        return EXIT.runtime;
      }
      writeLine(errorOutput, 'Unsafe Node launch settings. Unset NODE_OPTIONS, NODE_DEBUG, NODE_DEBUG_NATIVE, NODE_V8_COVERAGE, and NODE_REDIRECT_WARNINGS; launch Node without extra runtime flags.', lifecycle);
      return EXIT.runtime;
    }

    try {
      validatePaths(args.dataDirectory, args.brokerVaultDirectory, process.getuid());
      validateTerminal(input, output);
    } catch {
      writeLine(errorOutput, 'Preflight failed. No credentials were requested. Check the path and dedicated-TTY requirements in docs/specs/Alpaca-Key-Entry-CLI.md.', lifecycle);
      return EXIT.preflight;
    }

    let helper;
    try {
      helper = overrides.loadHelper ? await overrides.loadHelper(helperUrl) : await loadBuiltHelper(helperUrl);
      if (typeof helper?.enterAlpacaKeyPairFromTty !== 'function') throw new Error('build');
    } catch {
      writeLine(errorOutput, 'Worker build unavailable. Run `npm run build:worker` in v2; the CLI never builds or installs automatically.', lifecycle);
      return EXIT.build;
    }

    const bridge = entryTerminal(input, output, overrides.signals, lifecycle);
    if (!writeLine(output, START_NOTICE, lifecycle)) {
      bridge.close();
      writeLine(errorOutput, 'Unable to display the safety notice. No credentials were requested.', lifecycle);
      return EXIT.preflight;
    }
    await lifecycle.checkpointNextTurn();
    if (lifecycle.failed || bridge.outputFailed) {
      bridge.close();
      writeLine(errorOutput, 'Unable to display the safety notice. No credentials were requested.', lifecycle);
      return EXIT.preflight;
    }
    try {
      entryStarted = true;
      await helper.enterAlpacaKeyPairFromTty(args.dataDirectory, args.brokerVaultDirectory, bridge.terminal);
      if (bridge.outputFailed || lifecycle.failed) {
        writeLine(errorOutput, UNCERTAIN_NOTICE, lifecycle);
        return EXIT.uncertain;
      }
      writeLine(output, 'Credentials stored locally. No provider, account, rights, admission, or activation check was performed.', lifecycle);
      return EXIT.ok;
    } catch {
      writeLine(errorOutput, UNCERTAIN_NOTICE, lifecycle);
      return EXIT.uncertain;
    } finally {
      bridge.close();
    }
  };

  try {
    result = await execute();
  } catch {
    writeLine(errorOutput, 'CLI unavailable. No error details or credential values are displayed.', lifecycle);
    result = entryStarted ? EXIT.uncertain : EXIT.preflight;
  }
  try { await lifecycle.checkpointNextTurn(); } catch { /* A failed flush is handled below without exposing stream errors. */ }
  const outputFailed = lifecycle.failed;
  lifecycle.close();
  if (outputFailed) {
    if (entryStarted) return EXIT.uncertain;
    if (result === EXIT.ok) return EXIT.preflight;
  }
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // The runner drains tracked writes, but a Writable may still emit a later error.
  // Keep this guard only for the real standalone process, never on module import.
  const mainOutputGuard = installMainOutputErrorGuard();
  void runAlpacaKeyEntryCli().then(code => {
    process.exitCode = mainOutputGuard.failed && code === EXIT.ok ? EXIT.uncertain : code;
  }, () => {
    const lifecycle = outputLifecycle([process.stdout, process.stderr]);
    writeLine(process.stderr, 'CLI unavailable. No error details or credential values are displayed.', lifecycle);
    void lifecycle.drain().finally(() => lifecycle.close());
    process.exitCode = mainOutputGuard.failed ? EXIT.uncertain : EXIT.preflight;
  });
}
