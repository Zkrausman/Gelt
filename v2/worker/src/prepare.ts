// Explicit new application directories only. Registration is stdin, never argv.
import { join, resolve } from 'node:path';
import { createPrivateDirectory, separateDirectories, writePrivateNew } from './private-files.js';
import { createLedgerDirectory } from './ledger-storage.js';
import { registrationSchema } from './connection-contract.js';
try {
  const dirs = process.argv.slice(2);
  if (dirs.length !== 6 || dirs.some(p => p !== resolve(p)) || dirs.some((a, i) => dirs.some((b, j) => i !== j && !separateDirectories(a, b)))) throw new Error();
  let size = 0; const parts: Buffer[] = [];
  for await (const part of process.stdin) { size += part.length; if (size > 65536) throw new Error(); parts.push(part); }
  const registration = registrationSchema.parse(JSON.parse(Buffer.concat(parts).toString('utf8')));
  for (const [index, dir] of dirs.entries()) { if (index === 5) createLedgerDirectory(dir); else createPrivateDirectory(dir); }
  writePrivateNew(join(dirs[0], 'registration.json'), JSON.stringify(registration));
  console.log('New private registration, key, worker, BFF, owner and ledger directories prepared.');
} catch { console.error('Private preparation unavailable; only new explicit separate application directories are supported.'); process.exitCode = 1; }
