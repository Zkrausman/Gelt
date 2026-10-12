import { afterEach, it, expect } from 'vitest';
import * as fs from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { EncryptedVault } from './vault.js';
import { storageFixture } from './storage-fixture.js';
import { createPrivateDirectory, writePrivateNew } from './private-files.js';
import { protectKey } from './windows-storage.js';
const roots: string[] = [];
afterEach(() => { for (const path of roots.splice(0)) fs.rmSync(path, { recursive: true, force: true }); });
function fixture() {
  const root = storageFixture('gelt-vault-'); roots.push(root);
  const keyDir = join(root, 'key'), dataDir = join(root, 'data'); createPrivateDirectory(keyDir); createPrivateDirectory(dataDir);
  const key = join(keyDir, 'key'), data = join(dataDir, 'vault'); writePrivateNew(key, protectKey(randomBytes(32))); return { key, data, root, dataDir };
}
const credential = { access: 'SECRET-access', refresh: 'SECRET-refresh', expiresAt: 1000000 };
it('AES-GCM fresh nonces, authenticated round trip/restart/clear, private files and single writer', () => {
  const f = fixture(), v = new EncryptedVault(f.data, f.key);
  expect(v.read()).toBeNull(); v.write(credential); const first = fs.readFileSync(f.data, 'utf8');
  expect(first).not.toContain('SECRET'); expect(v.read()).toEqual(credential);
  expect(() => new EncryptedVault(f.data, f.key)).toThrow();
  v.write(credential); expect(fs.readFileSync(f.data, 'utf8')).not.toBe(first); if (process.platform === 'linux') expect(fs.statSync(f.data).mode & 0o777).toBe(0o600);
  v.close(); const restarted = new EncryptedVault(f.data, f.key); expect(restarted.read()).toEqual(credential); restarted.write(null); expect(restarted.read()).toBeNull(); restarted.close();
});
it('rejects corruption and wrong key without returning plaintext', () => {
  const f = fixture(), v = new EncryptedVault(f.data, f.key); v.write(credential);
  const saved = fs.readFileSync(f.data); fs.writeFileSync(f.data, '{bad'); expect(() => v.read()).toThrow(); fs.writeFileSync(f.data, saved); v.close();
  fs.writeFileSync(f.key, protectKey(randomBytes(32))); const wrong = new EncryptedVault(f.data, f.key); expect(() => wrong.read()).toThrow(); wrong.close();
});
it.skipIf(process.platform !== 'linux')('rejects missing/short/neighbor key, public permissions, symlinks and hardlinks', () => {
  const f = fixture();
  expect(() => new EncryptedVault(join(f.root, 'vault'), f.key)).toThrow();
  fs.chmodSync(f.key, 0o644); expect(() => new EncryptedVault(f.data, f.key)).toThrow(); fs.chmodSync(f.key, 0o600);
  const other = f.key + '.other'; fs.renameSync(f.key, other); fs.symlinkSync(other, f.key); expect(() => new EncryptedVault(f.data, f.key)).toThrow(); fs.unlinkSync(f.key);
  fs.linkSync(other, f.key); expect(() => new EncryptedVault(f.data, f.key)).toThrow(); fs.unlinkSync(f.key); fs.renameSync(other, f.key);
  fs.chmodSync(f.dataDir, 0o755); expect(() => new EncryptedVault(f.data, f.key)).toThrow(); fs.chmodSync(f.dataDir, 0o700);
  fs.writeFileSync(f.key, 'short'); expect(() => new EncryptedVault(f.data, f.key)).toThrow(); fs.unlinkSync(f.key); expect(() => new EncryptedVault(f.data, f.key)).toThrow();
});
it.skipIf(process.platform !== 'linux')('refuses unsafe ciphertext replacement and leaves previous ciphertext intact on protection failure', () => {
  const f = fixture(), v = new EncryptedVault(f.data, f.key); v.write(credential); const before = fs.readFileSync(f.data);
  fs.chmodSync(f.data, 0o644); expect(() => v.write(null)).toThrow(); expect(fs.readFileSync(f.data)).toEqual(before); expect(() => v.read()).toThrow(); v.close();
  expect(fs.existsSync(f.data + '.lock')).toBe(true); expect(() => new EncryptedVault(f.data, f.key)).toThrow();
});
