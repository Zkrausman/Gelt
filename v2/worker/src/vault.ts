import { dirname } from 'node:path';
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { z } from 'zod';
import { Credentials, credentialsSchema } from './connection-contract.js';
import { privateDirectory, readPrivate, writePrivateNew, replacePrivate, removePrivate, separateDirectories } from './private-files.js';
import { unprotectKey } from './windows-storage.js';
export interface Vault { read(): Credentials | null; write(value: Credentials | null): void }
const envelope = z.object({ version: z.literal(1), iv: z.string().regex(/^[a-f0-9]{24}$/), tag: z.string().regex(/^[a-f0-9]{32}$/), data: z.string().regex(/^[a-f0-9]+$/).max(70000) }).strict();
export class EncryptedVault implements Vault {
  private key: Buffer;
  private lock: string;
  private failed = false;
  private closed = false;
  constructor(private path: string, keyPath: string) {
    privateDirectory(dirname(path)); privateDirectory(dirname(keyPath));
    if (!separateDirectories(dirname(path), dirname(keyPath))) throw new Error('separate key directory required');
    this.key = unprotectKey(readPrivate(keyPath, process.platform === 'win32' ? 16000 : 32));
    if (this.key.length !== 32) throw new Error('invalid key');
    this.lock = path + '.lock';
    try { writePrivateNew(this.lock, 'owned'); } catch { this.key.fill(0); throw new Error('vault ownership unavailable'); }
  }
  read() {
    if (this.failed || this.closed) throw new Error('vault unavailable');
    let raw: Buffer;
    try { raw = readPrivate(this.path, 75000); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') { privateDirectory(dirname(this.path)); return null; } throw e; }
    const v = envelope.parse(JSON.parse(raw.toString('utf8')));
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(v.iv, 'hex'));
    decipher.setAAD(Buffer.from('Gelt/M3/v1')); decipher.setAuthTag(Buffer.from(v.tag, 'hex'));
    const value = JSON.parse(Buffer.concat([decipher.update(Buffer.from(v.data, 'hex')), decipher.final()]).toString('utf8'));
    return value === null ? null : credentialsSchema.parse(value);
  }
  write(value: Credentials | null) {
    if (this.failed || this.closed) throw new Error('vault unavailable');
    try {
      privateDirectory(dirname(this.path));
      // Validate existing protections even when replacing/clearing.
      try { readPrivate(this.path, 75000); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
      const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', this.key, iv);
      cipher.setAAD(Buffer.from('Gelt/M3/v1'));
      const data = Buffer.concat([cipher.update(JSON.stringify(value === null ? null : credentialsSchema.parse(value))), cipher.final()]);
      replacePrivate(this.path, JSON.stringify({ version: 1, iv: iv.toString('hex'), tag: cipher.getAuthTag().toString('hex'), data: data.toString('hex') }));
    } catch { this.failed = true; throw new Error('vault persistence unavailable'); }
  }
  close() {
    if (this.closed) return; this.closed = true; this.key.fill(0);
    if (!this.failed) removePrivate(this.lock);
  }
}
