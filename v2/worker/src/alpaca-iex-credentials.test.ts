import * as fs from 'node:fs';
import { EventEmitter } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
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
  setRawMode(mode: boolean) { this.isRaw = mode; this.modes.push(mode); }
  resume() { return this; }
  pause() { return this; }
  send(value: string | Buffer) { this.emit('data', Buffer.isBuffer(value) ? value : Buffer.from(value)); }
}
function terminal(input = new SyntheticInput()) {
  const output = { isTTY: true, written: [] as string[], write(text: string) { this.written.push(text); } };
  return { input, output, terminal: { input, output } as any };
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
    expect(io.output.written.join('')).not.toContain(keyPair.keyId);
    expect(io.output.written.join('')).not.toContain(keyPair.secretKey);
    expect(readAlpacaKeyPair(paths.data)).toEqual(keyPair);
  });

  it.each(['cancel', 'close'] as const)('restores terminal mode on %s', async action => {
    const paths = directories(), io = terminal();
    const completion = enterAlpacaKeyPairFromTty(paths.data, paths.broker, io.terminal);
    await nextTurn();
    if (action === 'cancel') io.input.send(Buffer.from([3])); else io.input.emit('close');
    await expect(completion).rejects.toThrow('Alpaca credential entry unavailable');
    expect(io.input.isRaw).toBe(false);
    expect(io.input.modes).toEqual([true, false]);
    expect(fs.existsSync(paths.data)).toBe(false);
  });

  it('refuses a non-TTY before prompting or provisioning', async () => {
    const paths = directories(), io = terminal(); io.input.isTTY = false;
    await expect(enterAlpacaKeyPairFromTty(paths.data, paths.broker, io.terminal)).rejects.toThrow('Alpaca credential entry unavailable');
    expect(io.output.written).toEqual([]);
    expect(fs.existsSync(paths.data)).toBe(false);
  });
});
