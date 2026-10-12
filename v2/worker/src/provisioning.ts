import * as fs from 'node:fs';
import { resolve, join } from 'node:path';
import { randomBytes, createHash, randomUUID } from 'node:crypto';
import { privateDirectory, readPrivate, writePrivateNew, separateDirectories } from './private-files.js';
import { registrationSchema } from './connection-contract.js';
import { protectKey } from './windows-storage.js';
const random = () => randomBytes(32).toString('base64url');
function explicit(path: string) {
  if (process.platform === 'win32' && path !== resolve(path)) throw new Error('explicit canonical path required');
  return resolve(path);
}
function separate(paths: string[]) {
  const dirs = paths.map(explicit);
  for (const d of dirs) privateDirectory(d);
  if (dirs.some((a, i) => dirs.some((b, j) => i !== j && !separateDirectories(a, b)))) throw new Error('separate directories required');
  return dirs;
}
function writeNew(files: [string, string | Buffer][]) {
  for (const [p] of files) if (fs.existsSync(p)) throw new Error('refuse overwrite');
  for (const [p, value] of files) writePrivateNew(p, value);
}
function grant(bff: string, owner: string): [string, string][] {
  const bootstrap = random();
  return [[join(owner, 'bootstrap.txt'), bootstrap], [join(bff, 'bootstrap.json'), JSON.stringify({ digest: createHash('sha256').update(bootstrap).digest('hex'), expiresAt: Date.now() + 600000 })]];
}
export function provisionOwner(args: string[]) {
  if (args.length !== 6) throw new Error('arguments');
  const [registrationPath, ...paths] = args, dirs = separate(paths);
  const registration = registrationSchema.parse(JSON.parse(readPrivate(explicit(registrationPath)).toString('utf8')));
  const serviceSecret = random();
  writeNew([
    [join(dirs[0], 'vault.key'), protectKey(randomBytes(32))],
    [join(dirs[1], 'worker.json'), JSON.stringify({ serviceSecret, ownerId: randomUUID(), ledgerPath: join(dirs[4], 'execution.sqlite'), keyPath: join(dirs[0], 'vault.key'), vaultPath: join(dirs[1], 'credentials.vault'), registration })],
    [join(dirs[2], 'bff.json'), JSON.stringify({ serviceSecret })],
    ...grant(dirs[2], dirs[3]),
  ]);
}
export function renewGrant(args: string[]) {
  if (args.length !== 2) throw new Error('arguments');
  const [bff, owner] = separate(args); readPrivate(join(bff, 'bff.json'));
  writeNew(grant(bff, owner));
}
