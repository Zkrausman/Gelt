import * as fs from 'node:fs';
import { EventEmitter } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { enterAlpacaKeyPairFromTty, provisionAlpacaKeyPair, readAlpacaKeyPair } from './alpaca-iex-credentials.js';

const keyPair = { keyId: 'SYNTHETIC_KEY_ID_123456', secretKey: 'SYNTHETIC_SECRET_12345678901234567890' };
const roots: string[] = [];
function directories() {
  const root = fs.mkdtempSync(join(tmpdir(), 'gelt-alpaca-credentials-'));
  fs.chmodSync(root, 0o700); roots.push(root);
  const data = join(root, 'alpaca-data'), broker = join(root, 'broker-vault');
  fs.mkdirSync(broker, { mode: 0o700 });
  return { root, data, broker };
}
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

class SyntheticInput extends EventEmitter {
  isTTY = true;
  isRaw = false;
  readonly modes: boolean[] = [];
  order: string[] = [];
  throwAfterDataRegistration = false;
  setRawMode(mode: boolean) { this.order.push(`raw:${mode}`); this.isRaw = mode; this.modes.push(mode); }
  override on(event: string, listener: (...args: any[]) => void): this {
    this.order.push(`on:${event}`);
    super.on(event, listener);
    if (event === 'data' && this.throwAfterDataRegistration) throw new Error('synthetic registration failure');
    return this;
  }
  override off(event: string, listener: (...args: any[]) => void): this { this.order.push(`off:${event}`); return super.off(event, listener); }
  resume() { return this; }
  pause() { return this; }
  send(value: string | Buffer) { this.emit('data', Buffer.isBuffer(value) ? value : Buffer.from(value)); }
}
class SyntheticSignals {
  readonly listeners = new Map<string, Set<() => void>>();
  readonly terminated: string[] = [];
  constructor(readonly order: string[]) {}
  on(signal: string, listener: () => void) {
    this.order.push(`signal:on:${signal}`);
    const set = this.listeners.get(signal) ?? new Set<() => void>(); set.add(listener); this.listeners.set(signal, set);
  }
  off(signal: string, listener: () => void) {
    this.order.push(`signal:off:${signal}`); this.listeners.get(signal)?.delete(listener);
  }
  terminate(signal: string) { this.order.push(`terminate:${signal}`); this.terminated.push(signal); }
  emit(signal: string) { for (const listener of [...(this.listeners.get(signal) ?? [])]) listener(); }
  count(signal: string) { return this.listeners.get(signal)?.size ?? 0; }
}
function terminal(input = new SyntheticInput(), failNewline = false) {
  const order: string[] = []; input.order = order;
  const output = {
    isTTY: true, written: [] as string[],
    write(text: string) { order.push(text === '\n' ? 'output:newline' : 'output:prompt'); this.written.push(text); if (failNewline && text === '\n') throw new Error('synthetic output failure'); },
  };
  const signals = new SyntheticSignals(order);
  return { input, output, signals, order, terminal: { input, output, signals } as any };
}
const nextTurn = () => new Promise<void>(resolve => setImmediate(resolve));

describe('standalone Alpaca keypair storage and hidden entry (synthetic only)', () => {
  it('creates an exclusive owner-only keypair in a directory separate from the broker vault', () => {
    const paths = directories();
    expect(provisionAlpacaKeyPair(paths.data, paths.broker, keyPair)).toBe('stored');
    const directory = fs.statSync(paths.data), filePath = join(paths.data, 'alpaca-keypair.json'), file = fs.statSync(filePath);
    expect(directory.mode & 0o777).toBe(0o700);
    expect(file.mode & 0o777).toBe(0o600);
    expect(file.nlink).toBe(1);
    expect(file.uid).toBe(process.getuid!());
    expect(readAlpacaKeyPair(paths.data)).toEqual(keyPair);
    expect(() => provisionAlpacaKeyPair(paths.data, paths.broker, keyPair)).toThrow('Alpaca credential storage unavailable');
  });

  it('closes a just-opened directory descriptor when identity inspection fails', () => {
    const paths = directories(), opened: number[] = [];
    const originalOpen = fs.openSync;
    const originalFstat = fs.fstatSync;
    const openSpy = vi.spyOn(fs, 'openSync').mockImplementation((...args: any[]) => {
      const fd = (originalOpen as (...values: any[]) => number)(...args);
      opened.push(fd);
      return fd;
    });
    const fstatSpy = vi.spyOn(fs, 'fstatSync').mockImplementation(((...args: any[]) => {
      if (opened.length > 0) throw new Error('synthetic identity inspection failure');
      return (originalFstat as (...values: any[]) => fs.Stats)(...args);
    }) as typeof fs.fstatSync);
    try {
      expect(() => provisionAlpacaKeyPair(paths.data, paths.broker, keyPair)).toThrow('Alpaca credential storage unavailable');
    } finally {
      fstatSpy.mockRestore();
      openSpy.mockRestore();
    }
    expect(opened).toHaveLength(1);
    expect(() => fs.fstatSync(opened[0])).toThrow();
  });

  it.each(['symlink-directory', 'symlink-file', 'hardlink-file', 'wrong-file-mode', 'wrong-directory-mode'] as const)(
    'rejects %s without exposing secret or path details', kind => {
      const paths = directories();
      if (kind === 'symlink-directory') fs.symlinkSync(paths.broker, paths.data, 'dir');
      else provisionAlpacaKeyPair(paths.data, paths.broker, keyPair);
      const filePath = join(paths.data, 'alpaca-keypair.json');
      if (kind === 'symlink-file') {
        const outside = join(paths.root, 'outside');
        fs.writeFileSync(outside, JSON.stringify({ schema: 'gelt.alpaca-keypair.v1', ...keyPair }), { mode: 0o600 });
        fs.rmSync(filePath); fs.symlinkSync(outside, filePath);
      }
      if (kind === 'hardlink-file') fs.linkSync(filePath, join(paths.root, 'linked-copy'));
      if (kind === 'wrong-file-mode') fs.chmodSync(filePath, 0o640);
      if (kind === 'wrong-directory-mode') fs.chmodSync(paths.data, 0o750);
      let error: unknown;
      try { readAlpacaKeyPair(paths.data); } catch (caught) { error = caught; }
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe('Alpaca credential storage unavailable');
      expect((error as Error).message).not.toContain(keyPair.secretKey);
      expect((error as Error).message).not.toContain(paths.root);
    },
  );

  it('accepts two hidden TTY fields, restores raw mode for each, and never echoes entered values', async () => {
    const paths = directories(), io = terminal();
    const completion = enterAlpacaKeyPairFromTty(paths.data, paths.broker, io.terminal);
    await nextTurn(); io.input.send(`${keyPair.keyId}\r`);
    await nextTurn(); io.input.send(`${keyPair.secretKey}\r`);
    await completion;
    expect(io.input.modes).toEqual([true, false, true, false]);
    expect(io.order.indexOf('raw:true')).toBeLessThan(io.order.indexOf('output:prompt'));
    expect(io.order.indexOf('raw:true')).toBeLessThan(io.order.indexOf('on:data'));
    expect(io.output.written.join('')).not.toContain(keyPair.keyId);
    expect(io.output.written.join('')).not.toContain(keyPair.secretKey);
    expect(readAlpacaKeyPair(paths.data)).toEqual(keyPair);
  });

  it.each(['data', 'readable'] as const)('refuses a TTY with an existing %s consumer before changing its state', async event => {
    const paths = directories(), io = terminal(), observed: unknown[] = [];
    const existingListener = (...args: unknown[]) => observed.push(...args);
    io.input.on(event, existingListener);
    await expect(enterAlpacaKeyPairFromTty(paths.data, paths.broker, io.terminal))
      .rejects.toThrow('Alpaca credential entry unavailable');
    expect(io.output.written).toEqual([]);
    expect(io.input.modes).toEqual([]);
    expect(io.input.isRaw).toBe(false);
    expect(io.input.listenerCount(event)).toBe(1);
    expect(io.input.listenerCount('data')).toBe(event === 'data' ? 1 : 0);
    expect(io.input.listenerCount('readable')).toBe(event === 'readable' ? 1 : 0);
    expect(io.signals.count('SIGINT')).toBe(0);
    expect(io.signals.count('SIGTERM')).toBe(0);
    expect(observed).toEqual([]);
    expect(fs.existsSync(paths.data)).toBe(false);
    io.input.off(event, existingListener);
  });

  it('refuses concurrent entry on the same TTY without disturbing the active entry', async () => {
    const paths = directories(), io = terminal();
    const listenerCount = vi.spyOn(io.input, 'listenerCount');
    const first = enterAlpacaKeyPairFromTty(paths.data, paths.broker, io.terminal);
    await nextTurn();
    expect(io.output.written).toEqual(['Alpaca key ID (hidden): ']);
    expect(io.input.isRaw).toBe(true);
    const checksBeforeSecond = listenerCount.mock.calls.length;

    await expect(enterAlpacaKeyPairFromTty(paths.data, paths.broker, io.terminal))
      .rejects.toThrow('Alpaca credential entry unavailable');
    expect(listenerCount.mock.calls).toHaveLength(checksBeforeSecond);
    expect(io.output.written).toEqual(['Alpaca key ID (hidden): ']);
    expect(io.input.modes).toEqual([true]);
    expect(io.input.isRaw).toBe(true);
    expect(io.input.listenerCount('data')).toBe(1);
    expect(fs.existsSync(paths.data)).toBe(false);

    io.input.send(`${keyPair.keyId}\r`);
    await nextTurn();
    expect(io.output.written).toEqual(['Alpaca key ID (hidden): ', '\n', 'Alpaca secret key (hidden): ']);
    io.input.send(`${keyPair.secretKey}\r`);
    await first;
    expect(io.input.listenerCount('data')).toBe(0);
    expect(io.input.isRaw).toBe(false);
    expect(fs.readdirSync(paths.data)).toEqual(['alpaca-keypair.json']);
    expect(readAlpacaKeyPair(paths.data)).toEqual(keyPair);
  });

  it('restores raw mode and settles when newline output throws', async () => {
    const paths = directories(), io = terminal(new SyntheticInput(), true);
    const completion = enterAlpacaKeyPairFromTty(paths.data, paths.broker, io.terminal);
    await nextTurn(); io.input.send(`${keyPair.keyId}\r`);
    await expect(completion).rejects.toThrow('Alpaca credential entry unavailable');
    expect(io.input.isRaw).toBe(false);
    expect(io.input.listenerCount('data')).toBe(0);
    expect(io.signals.count('SIGINT')).toBe(0);
    expect(io.signals.count('SIGTERM')).toBe(0);
    expect(fs.existsSync(paths.data)).toBe(false);
  });

  it('restores raw mode and signal handlers when prompt output fails', async () => {
    const paths = directories(), io = terminal();
    io.output.write = () => { throw new Error('synthetic prompt output failure'); };
    await expect(enterAlpacaKeyPairFromTty(paths.data, paths.broker, io.terminal)).rejects.toThrow('Alpaca credential entry unavailable');
    expect(io.input.isRaw).toBe(false);
    expect(io.input.listenerCount('data')).toBe(0);
    expect(io.signals.count('SIGINT')).toBe(0);
    expect(io.signals.count('SIGTERM')).toBe(0);
    expect(fs.existsSync(paths.data)).toBe(false);
  });

  it('restores raw mode and removes partially registered listeners after registration failure', async () => {
    const paths = directories(), input = new SyntheticInput(); input.throwAfterDataRegistration = true;
    const io = terminal(input);
    await expect(enterAlpacaKeyPairFromTty(paths.data, paths.broker, io.terminal)).rejects.toThrow('Alpaca credential entry unavailable');
    expect(io.input.isRaw).toBe(false);
    expect(io.input.listenerCount('data')).toBe(0);
    expect(io.signals.count('SIGINT')).toBe(0);
    expect(io.signals.count('SIGTERM')).toBe(0);
  });

  it.each(['cancel', 'close'] as const)('restores terminal mode on %s', async action => {
    const paths = directories(), io = terminal();
    const completion = enterAlpacaKeyPairFromTty(paths.data, paths.broker, io.terminal);
    await nextTurn();
    if (action === 'cancel') io.input.send(Buffer.from([3])); else io.input.emit('close');
    await expect(completion).rejects.toThrow('Alpaca credential entry unavailable');
    expect(io.input.isRaw).toBe(false);
    expect(io.input.modes).toEqual([true, false]);
    expect(io.input.listenerCount('data')).toBe(0);
    expect(io.signals.count('SIGINT')).toBe(0);
    expect(io.signals.count('SIGTERM')).toBe(0);
    expect(io.signals.terminated).toEqual(action === 'cancel' ? ['SIGINT'] : []);
    if (action === 'cancel') {
      expect(io.order.indexOf('terminate:SIGINT')).toBeGreaterThan(io.order.lastIndexOf('raw:false'));
    }
    expect(fs.existsSync(paths.data)).toBe(false);
  });

  it('refuses a non-TTY before prompting or provisioning', async () => {
    const paths = directories(), io = terminal(); io.input.isTTY = false;
    await expect(enterAlpacaKeyPairFromTty(paths.data, paths.broker, io.terminal)).rejects.toThrow('Alpaca credential entry unavailable');
    expect(io.output.written).toEqual([]);
    expect(fs.existsSync(paths.data)).toBe(false);
  });

  it.each(['SIGINT', 'SIGTERM'] as const)('restores the TTY before preserving %s termination semantics', async signal => {
    const paths = directories(), io = terminal();
    const completion = enterAlpacaKeyPairFromTty(paths.data, paths.broker, io.terminal);
    await nextTurn(); io.signals.emit(signal);
    await expect(completion).rejects.toThrow('Alpaca credential entry unavailable');
    expect(io.input.isRaw).toBe(false);
    expect(io.input.listenerCount('data')).toBe(0);
    expect(io.signals.count('SIGINT')).toBe(0);
    expect(io.signals.count('SIGTERM')).toBe(0);
    expect(io.signals.terminated).toEqual([signal]);
    expect(io.order.indexOf(`terminate:${signal}`)).toBeGreaterThan(io.order.lastIndexOf('raw:false'));
    expect(fs.existsSync(paths.data)).toBe(false);
  });

  it('rejects physical broker-vault containment and symlink aliases without touching the vault', () => {
    const paths = directories(), sentinel = join(paths.broker, 'sentinel');
    fs.writeFileSync(sentinel, 'synthetic-vault-sentinel', { mode: 0o600 });
    const nested = join(paths.broker, 'nested'); fs.mkdirSync(nested, { mode: 0o700 });
    const alias = join(paths.root, 'broker-alias'); fs.symlinkSync(paths.broker, alias, 'dir');
    const parentAlias = join(paths.root, 'parent-alias'); fs.symlinkSync(paths.root, parentAlias, 'dir');
    const attempts: Array<[string, string]> = [
      [join(nested, 'alpaca-data'), paths.broker],
      [join(parentAlias, 'new-alpaca-data'), paths.broker],
      [paths.data, alias],
      [paths.data, join(parentAlias, 'broker')],
      [paths.broker, paths.broker],
    ];
    for (const [dataPath, brokerPath] of attempts) {
      expect(() => provisionAlpacaKeyPair(dataPath, brokerPath, keyPair)).toThrow('Alpaca credential storage unavailable');
    }
    expect(fs.readFileSync(sentinel, 'utf8')).toBe('synthetic-vault-sentinel');
    expect(fs.readdirSync(paths.broker).sort()).toEqual(['nested', 'sentinel']);
    expect(fs.readdirSync(nested)).toEqual([]);
  });
});
