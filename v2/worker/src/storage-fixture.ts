// Synthetic, isolated test-owned roots; no credential discovery or ACL repair.
import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { createPrivateDirectory } from './private-files.js';
export function storageFixture(prefix: string) {
  const parent = process.platform === 'win32' ? process.env.GELT_WINDOWS_PRIVATE_PARENT : realpathSync(tmpdir());
  if (!parent) throw new Error('explicit private fixture parent required');
  const path = join(parent, prefix + randomBytes(16).toString('hex'));
  createPrivateDirectory(path); return path;
}
