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

class UsageFailure extends Error {}
class PreflightFailure extends Error {}

function writeLine(output, value) {
  try {
    output.write(`${value}\n`);
    return true;
  } catch {
    return false;
  }
}

function suppressDiagnosticStreamErrors(output) {
  if (typeof output?.on !== 'function' || typeof output?.off !== 'function') return () => {};
  const listener = () => {};
  try {
    output.on('error', listener);
    return () => { try { output.off('error', listener); } catch { /* Keep diagnostics redacted. */ } };
  } catch {
    return () => {};
  }
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

function entryTerminal(input, output, signals) {
  let outputFailed = false;
  let inputErrorListener;
  const onOutputError = () => {
    outputFailed = true;
    try { inputErrorListener?.(); } catch { /* The entry helper owns sanitized cleanup. */ }
  };
  output.on('error', onOutputError);
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
    terminal: { input: wrappedInput, output, signals },
    get outputFailed() { return outputFailed; },
    close() {
      inputErrorListener = undefined;
      try { output.off('error', onOutputError); } catch { /* Do not replace the sanitized entry result. */ }
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
  const releaseDiagnosticErrorGuard = suppressDiagnosticStreamErrors(errorOutput);
  try {
    let args;
    try { args = parseArguments(argv); } catch {
      writeLine(errorOutput, 'Invalid arguments.');
      writeLine(errorOutput, USAGE);
      return EXIT.usage;
    }
    if (args.help) return writeLine(output, USAGE) ? EXIT.ok : EXIT.preflight;

    try { validateRuntime(platform, nodeVersion, env, execArgv); }
    catch (error) {
      if (error.message === 'runtime') {
        writeLine(errorOutput, 'Unsupported runtime. Use trusted Node.js 22 on Linux.');
        return EXIT.runtime;
      }
      writeLine(errorOutput, 'Unsafe Node launch settings. Unset NODE_OPTIONS, NODE_DEBUG, NODE_DEBUG_NATIVE, NODE_V8_COVERAGE, and NODE_REDIRECT_WARNINGS; launch Node without extra runtime flags.');
      return EXIT.runtime;
    }

    try {
      validatePaths(args.dataDirectory, args.brokerVaultDirectory, process.getuid());
      validateTerminal(input, output);
    } catch {
      writeLine(errorOutput, 'Preflight failed. No credentials were requested. Check the path and dedicated-TTY requirements in docs/specs/Alpaca-Key-Entry-CLI.md.');
      return EXIT.preflight;
    }

    let helper;
    try {
      helper = overrides.loadHelper ? await overrides.loadHelper(helperUrl) : await loadBuiltHelper(helperUrl);
      if (typeof helper?.enterAlpacaKeyPairFromTty !== 'function') throw new Error('build');
    } catch {
      writeLine(errorOutput, 'Worker build unavailable. Run `npm run build:worker` in v2; the CLI never builds or installs automatically.');
      return EXIT.build;
    }

    const bridge = entryTerminal(input, output, overrides.signals);
    if (!writeLine(output, START_NOTICE) || bridge.outputFailed) {
      bridge.close();
      writeLine(errorOutput, 'Unable to display the safety notice. No credentials were requested.');
      return EXIT.preflight;
    }
    try {
      await helper.enterAlpacaKeyPairFromTty(args.dataDirectory, args.brokerVaultDirectory, bridge.terminal);
      if (bridge.outputFailed || !writeLine(output, 'Credentials stored locally. No provider, account, rights, admission, or activation check was performed.')) {
        writeLine(errorOutput, UNCERTAIN_NOTICE);
        return EXIT.uncertain;
      }
      return EXIT.ok;
    } catch {
      writeLine(errorOutput, UNCERTAIN_NOTICE);
      return EXIT.uncertain;
    } finally {
      bridge.close();
    }
  } catch {
    writeLine(errorOutput, 'CLI unavailable. No error details or credential values are displayed.');
    return EXIT.preflight;
  } finally {
    releaseDiagnosticErrorGuard();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void runAlpacaKeyEntryCli().then(code => {
    process.exitCode = code;
  }, () => {
    writeLine(process.stderr, 'CLI unavailable. No error details or credential values are displayed.');
    process.exitCode = EXIT.preflight;
  });
}
