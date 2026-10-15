import fs from 'node:fs';
import { EventEmitter } from 'node:events';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runAlpacaKeyEntryCli } from '../../scripts/alpaca-key-entry.mjs';
import { enterAlpacaKeyPairFromTty } from './alpaca-iex-credentials.js';

const syntheticPair = {
  keyId: 'SYNTHETIC_KEY_ID_123456',
  secretKey: 'SYNTHETIC_SECRET_12345678901234567890',
};
const roots: string[] = [];

function directories() {
  const root = fs.mkdtempSync(join(tmpdir(), 'gelt-alpaca-key-cli-'));
  fs.chmodSync(root, 0o700);
  const dataParent = join(root, 'data-parent');
  const broker = join(root, 'broker-vault');
  fs.mkdirSync(dataParent, { mode: 0o700 });
  fs.mkdirSync(broker, { mode: 0o700 });
  fs.chmodSync(dataParent, 0o700);
  fs.chmodSync(broker, 0o700);
  roots.push(root);
  return { root, data: join(dataParent, 'alpaca-data'), dataParent, broker };
}

function copiedCliFixture(paths: ReturnType<typeof directories>, compiledSource?: string) {
  const fixture = join(paths.root, 'fixture');
  const v2 = join(fixture, 'v2');
  const scripts = join(v2, 'scripts');
  const worker = join(v2, 'worker');
  const dist = join(worker, 'dist');
  const away = join(fixture, 'elsewhere');
  for (const directory of [fixture, v2, scripts, worker, dist, away]) {
    fs.mkdirSync(directory, { mode: 0o700 });
    fs.chmodSync(directory, 0o700);
  }
  fs.writeFileSync(join(worker, 'package.json'), '{"type":"module"}\n', { mode: 0o600 });
  const copiedCli = join(scripts, 'alpaca-key-entry.mjs');
  fs.copyFileSync(fileURLToPath(new URL('../../scripts/alpaca-key-entry.mjs', import.meta.url)), copiedCli);
  if (compiledSource !== undefined) {
    fs.writeFileSync(join(dist, 'alpaca-iex-credentials.js'), compiledSource, { mode: 0o600 });
  }
  return { moduleUrl: pathToFileURL(copiedCli).href, away };
}

function runCopiedCliFromAway(fixture: ReturnType<typeof copiedCliFixture>, paths: ReturnType<typeof directories>) {
  const driver = join(fixture.away, 'driver.mjs');
  const source = `
    import { EventEmitter } from 'node:events';
    import { runAlpacaKeyEntryCli } from ${JSON.stringify(fixture.moduleUrl)};
    class Input extends EventEmitter {
      isTTY = true; isRaw = false;
      setRawMode(mode) { this.isRaw = mode; }
      resume() { return this; }
      pause() { return this; }
    }
    class Output extends EventEmitter {
      isTTY = true;
      write(text) { process.stdout.write(text); return true; }
    }
    const code = await runAlpacaKeyEntryCli({
      argv: ${JSON.stringify(argv(paths))}, env: {}, platform: 'linux', nodeVersion: '22.12.0', execArgv: [],
      input: new Input(), output: new Output(), errorOutput: process.stderr,
    });
    process.exitCode = code;
  `;
  fs.writeFileSync(driver, source, { mode: 0o600 });
  return spawnSync(process.execPath, [driver], {
    cwd: fixture.away,
    encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '/usr/bin:/bin' },
  });
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  vi.restoreAllMocks();
});

class SyntheticInput extends EventEmitter {
  isTTY = true;
  isRaw = false;
  readonly modes: boolean[] = [];
  setRawMode(mode: boolean) { this.isRaw = mode; this.modes.push(mode); }
  resume() { return this; }
  pause() { return this; }
  send(value: string | Buffer) { this.emit('data', Buffer.isBuffer(value) ? value : Buffer.from(value)); }
}

class SyntheticOutput extends EventEmitter {
  isTTY = true;
  readonly written: string[] = [];
  write(value: string) { this.written.push(value); return true; }
}

class SyntheticSignals {
  readonly listeners = new Map<string, Set<() => void>>();
  readonly terminated: string[] = [];
  on(signal: string, listener: () => void) {
    const listeners = this.listeners.get(signal) ?? new Set<() => void>();
    listeners.add(listener);
    this.listeners.set(signal, listeners);
  }
  off(signal: string, listener: () => void) { this.listeners.get(signal)?.delete(listener); }
  terminate(signal: string) { this.terminated.push(signal); }
  emit(signal: string) { for (const listener of [...(this.listeners.get(signal) ?? [])]) listener(); }
  count(signal: string) { return this.listeners.get(signal)?.size ?? 0; }
}

function io() {
  return { input: new SyntheticInput(), output: new SyntheticOutput(), errorOutput: new SyntheticOutput(), signals: new SyntheticSignals() };
}

function argv(paths: { data: string; broker: string }) {
  return ['--data-dir', paths.data, '--broker-vault-dir', paths.broker];
}

function invocation(paths: { data: string; broker: string }, terminal: ReturnType<typeof io>, extra: Record<string, unknown> = {}) {
  return {
    argv: argv(paths),
    env: {},
    platform: 'linux',
    nodeVersion: '22.12.0',
    execArgv: [],
    input: terminal.input,
    output: terminal.output,
    errorOutput: terminal.errorOutput,
    signals: terminal.signals,
    ...extra,
  };
}

const turn = () => new Promise<void>(resolve => setImmediate(resolve));
const outputText = (terminal: ReturnType<typeof io>) => terminal.output.written.join('') + terminal.errorOutput.written.join('');

describe('standalone Alpaca key-entry CLI (synthetic only)', () => {
  it('declares an explicit worker build command without adding an install step', () => {
    const packageJson = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
    expect(packageJson.scripts['build:worker']).toBe('tsc -p worker');
    expect(packageJson.scripts['build:worker']).not.toMatch(/npm install|npm ci|npx/);
  });

  it('imports without prompting, loading the worker helper, or touching paths', async () => {
    const stdout = vi.spyOn(process.stdout, 'write');
    const stderr = vi.spyOn(process.stderr, 'write');
    const inputDataListeners = process.stdin.listenerCount('data');
    const inputReadableListeners = process.stdin.listenerCount('readable');
    const module = await import('../../scripts/alpaca-key-entry.mjs?inert-test');
    expect(typeof module.runAlpacaKeyEntryCli).toBe('function');
    expect(stdout).not.toHaveBeenCalled();
    expect(stderr).not.toHaveBeenCalled();
    expect(process.stdin.listenerCount('data')).toBe(inputDataListeners);
    expect(process.stdin.listenerCount('readable')).toBe(inputReadableListeners);
  });

  it('handles exact help independently of runtime and rejects malformed flags without loading the helper', async () => {
    const paths = directories(), terminal = io(), loaded: unknown[] = [];
    const helpCode = await runAlpacaKeyEntryCli({
      argv: ['--help'], platform: 'win32', nodeVersion: '24.0.0', input: terminal.input,
      output: terminal.output, errorOutput: terminal.errorOutput,
      loadHelper: async url => { loaded.push(url); return {}; },
    });
    expect(helpCode).toBe(0);
    expect(terminal.output.written.join('')).toContain('Usage: node v2/scripts/alpaca-key-entry.mjs');
    expect(loaded).toEqual([]);

    const malformed = await runAlpacaKeyEntryCli({ ...invocation(paths, terminal), argv: ['--data-dir', paths.data, '--data-dir', paths.data] });
    expect(malformed).toBe(2);
    expect(terminal.output.written.join('')).not.toContain('Alpaca key ID');
    expect(loaded).toEqual([]);

    const secretArgument = await runAlpacaKeyEntryCli({
      ...invocation(paths, terminal),
      argv: [...argv(paths), '--key-id', syntheticPair.keyId],
      loadHelper: async url => { loaded.push(url); return {}; },
    });
    expect(secretArgument).toBe(2);
    expect(outputText(terminal)).not.toContain(syntheticPair.keyId);
    expect(loaded).toEqual([]);
  });

  it.each([
    ['unsupported runtime', { platform: 'darwin' }],
    ['unsupported Node major', { nodeVersion: '24.0.0' }],
    ['inherited Node options', { env: { NODE_OPTIONS: '--require=/tmp/inject.cjs' } }],
    ['debug logging', { env: { NODE_DEBUG: 'fs' } }],
    ['native debug logging', { env: { NODE_DEBUG_NATIVE: 'ALL' } }],
    ['coverage instrumentation', { env: { NODE_V8_COVERAGE: '/tmp/coverage' } }],
    ['runtime flags', { execArgv: ['--inspect'] }],
  ])('fails before prompts for %s', async (_name, override) => {
    const paths = directories(), terminal = io();
    const code = await runAlpacaKeyEntryCli(invocation(paths, terminal, override));
    expect(code).toBe(3);
    expect(terminal.output.written).toEqual([]);
    expect(terminal.input.modes).toEqual([]);
    expect(fs.existsSync(paths.data)).toBe(false);
  });

  it.each(['existing-target', 'non-tty', 'shared-consumer', 'noncanonical-path', 'symlink-parent'] as const)(
    'rejects %s before the helper loads or credentials are requested', async kind => {
      const paths = directories(), terminal = io();
      let loaded = 0;
      const loadHelper = async () => { loaded++; return { enterAlpacaKeyPairFromTty }; };
      if (kind === 'existing-target') fs.mkdirSync(paths.data, { mode: 0o700 });
      if (kind === 'non-tty') terminal.input.isTTY = false;
      if (kind === 'shared-consumer') terminal.input.on('data', () => {});
      if (kind === 'noncanonical-path') paths.data = `${paths.data}/../alpaca-data`;
      if (kind === 'symlink-parent') {
        const alias = join(paths.root, 'data-alias');
        fs.symlinkSync(paths.dataParent, alias, 'dir');
        paths.data = join(alias, 'alpaca-data');
      }
      const code = await runAlpacaKeyEntryCli(invocation(paths, terminal, { loadHelper }));
      expect(code).toBe(4);
      expect(loaded).toBe(0);
      expect(terminal.output.written).toEqual([]);
      expect(terminal.input.modes).toEqual([]);
    },
  );

  it.each(['missing', 'malformed'] as const)('rejects a %s default compiled module without prompting or logging import errors', async kind => {
    const paths = directories();
    const source = kind === 'malformed' ? 'export const unrelated = true;\n' : undefined;
    const fixture = copiedCliFixture(paths, source);
    const result = runCopiedCliFromAway(fixture, paths);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(5);
    expect(result.stdout).not.toContain('Alpaca key ID (hidden): ');
    expect(result.stderr).toContain('Worker build unavailable.');
    expect(result.stderr).not.toContain(paths.root);
    expect(result.stderr).not.toContain(syntheticPair.secretKey);
    expect(fs.existsSync(paths.data)).toBe(false);
  });

  it('loads the default compiled helper beside a copied CLI when the process CWD is elsewhere', async () => {
    const paths = directories();
    const fixture = copiedCliFixture(paths,
      "export async function enterAlpacaKeyPairFromTty() { throw new Error('synthetic compiled helper failure'); }\n");
    const result = runCopiedCliFromAway(fixture, paths);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(6);
    expect(result.stdout).toContain('treat storage as uncertain');
    expect(result.stderr).toContain('Entry outcome is uncertain. Stop.');
    expect(result.stderr).not.toContain('synthetic compiled helper failure');
    expect(result.stderr).not.toContain(paths.root);
    expect(fs.existsSync(paths.data)).toBe(false);
  });

  it('uses the unchanged helper for hidden synthetic entry and reports local storage only', async () => {
    const paths = directories(), terminal = io();
    const sentinel = join(paths.broker, 'synthetic-sentinel');
    fs.writeFileSync(sentinel, 'synthetic broker vault sentinel', { mode: 0o600 });
    const helperUrls: string[] = [];
    const completion = runAlpacaKeyEntryCli(invocation(paths, terminal, {
      env: { ALPACA_KEY_ID: syntheticPair.keyId, ALPACA_SECRET_KEY: syntheticPair.secretKey },
      loadHelper: async (url: URL) => {
        helperUrls.push(url.href);
        return { enterAlpacaKeyPairFromTty };
      },
    }));
    await turn();
    expect(terminal.output.written[0]).toContain('treat storage as uncertain');
    expect(terminal.output.written[1]).toBe('Alpaca key ID (hidden): ');
    terminal.input.send(`${syntheticPair.keyId}\r`);
    await turn();
    terminal.input.send(`${syntheticPair.secretKey}\r`);
    expect(await completion).toBe(0);

    expect(helperUrls[0].endsWith('/v2/worker/dist/alpaca-iex-credentials.js')).toBe(true);
    expect(terminal.input.modes).toEqual([true, false, true, false]);
    expect(terminal.input.isRaw).toBe(false);
    expect(terminal.input.listenerCount('data')).toBe(0);
    expect(terminal.signals.count('SIGINT')).toBe(0);
    expect(terminal.signals.count('SIGTERM')).toBe(0);
    expect(outputText(terminal)).not.toContain(syntheticPair.keyId);
    expect(outputText(terminal)).not.toContain(syntheticPair.secretKey);
    expect(outputText(terminal)).not.toContain(paths.root);
    expect(outputText(terminal)).toContain('Credentials stored locally.');
    expect(outputText(terminal)).toContain('No provider, account, rights, admission, or activation check was performed.');
    const directory = fs.lstatSync(paths.data);
    const file = fs.lstatSync(join(paths.data, 'alpaca-keypair.json'));
    expect(directory.mode & 0o777).toBe(0o700);
    expect(file.mode & 0o777).toBe(0o600);
    expect(file.isFile()).toBe(true);
    expect(file.nlink).toBe(1);
    expect(file.uid).toBe(process.getuid!());
    expect(fs.readFileSync(sentinel, 'utf8')).toBe('synthetic broker vault sentinel');
  });

  it('prints uncertainty before entry and preserves partial evidence after a single helper failure', async () => {
    const paths = directories(), terminal = io();
    const sentinel = join(paths.broker, 'synthetic-sentinel');
    fs.writeFileSync(sentinel, 'synthetic broker vault sentinel', { mode: 0o600 });
    let helperCalls = 0;
    const helper = async (data: string, broker: string, input: unknown) => {
      helperCalls++;
      return enterAlpacaKeyPairFromTty(data, broker, input as never);
    };
    const fsync = vi.spyOn(fs, 'fsyncSync').mockImplementation(() => { throw new Error(syntheticPair.secretKey); });
    const completion = runAlpacaKeyEntryCli(invocation(paths, terminal, {
      loadHelper: async () => ({ enterAlpacaKeyPairFromTty: helper }),
    }));
    try {
      await turn();
      const message = outputText(terminal);
      expect(message.indexOf('treat storage as uncertain')).toBeLessThan(message.indexOf('Alpaca key ID (hidden): '));
      terminal.input.send(`${syntheticPair.keyId}\r`);
      await turn();
      terminal.input.send(`${syntheticPair.secretKey}\r`);
      expect(await completion).toBe(6);
    } finally {
      fsync.mockRestore();
    }
    expect(helperCalls).toBe(1);
    expect(terminal.input.isRaw).toBe(false);
    expect(terminal.input.listenerCount('data')).toBe(0);
    expect(terminal.signals.count('SIGINT')).toBe(0);
    expect(terminal.signals.count('SIGTERM')).toBe(0);
    expect(outputText(terminal)).toContain('Entry outcome is uncertain. Stop.');
    expect(outputText(terminal)).not.toContain(syntheticPair.keyId);
    expect(outputText(terminal)).not.toContain(syntheticPair.secretKey);
    expect(outputText(terminal)).not.toContain(paths.root);
    expect(fs.lstatSync(paths.data).isDirectory()).toBe(true);
    expect(fs.lstatSync(join(paths.data, 'alpaca-keypair.json')).isFile()).toBe(true);
    expect(fs.readFileSync(sentinel, 'utf8')).toBe('synthetic broker vault sentinel');
    expect(fsync).toBeDefined();
  });

  it('sanitizes asynchronous output errors and restores terminal state', async () => {
    const paths = directories(), terminal = io();
    const completion = runAlpacaKeyEntryCli(invocation(paths, terminal, {
      loadHelper: async () => ({ enterAlpacaKeyPairFromTty }),
    }));
    await turn();
    terminal.output.emit('error', new Error(syntheticPair.secretKey));
    expect(await completion).toBe(6);
    expect(terminal.input.isRaw).toBe(false);
    expect(terminal.input.listenerCount('data')).toBe(0);
    expect(terminal.input.modes).toEqual([true, false]);
    expect(outputText(terminal)).toContain('Entry outcome is uncertain. Stop.');
    expect(outputText(terminal)).not.toContain(syntheticPair.secretKey);
    expect(fs.existsSync(paths.data)).toBe(false);
  });

  it('restores the TTY before preserving signal termination semantics', async () => {
    const paths = directories(), terminal = io();
    const completion = runAlpacaKeyEntryCli(invocation(paths, terminal, {
      loadHelper: async () => ({ enterAlpacaKeyPairFromTty }),
    }));
    await turn();
    terminal.signals.emit('SIGTERM');
    expect(await completion).toBe(6);
    expect(terminal.input.isRaw).toBe(false);
    expect(terminal.input.modes).toEqual([true, false]);
    expect(terminal.signals.terminated).toEqual(['SIGTERM']);
    expect(terminal.output.written[0]).toContain('Do not retry, delete, chmod, revoke, or clean up.');
    expect(fs.existsSync(paths.data)).toBe(false);
  });
});
