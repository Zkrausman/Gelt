import { z } from 'zod';
import { dirname } from 'node:path';
import { Ledger } from './ledger.js';
import { ledgerId } from './ledger-contract.js';
import { readPrivate, separateDirectories } from './private-files.js';
import { registrationSchema, opaque } from './connection-contract.js';
import { OfficialProvider } from './provider.js';
import { EncryptedVault } from './vault.js';
import { Connection } from './connection.js';
const configSchema = z.object({ serviceSecret: opaque, ownerId: ledgerId, ledgerPath: z.string(), keyPath: z.string(), vaultPath: z.string(), registration: registrationSchema }).strict();
export function setup(path?: string) {
  if (!path) return { connection: new Connection(), close: () => {}, serviceSecret: undefined, ledger: undefined, ownerId: undefined };
  const config = configSchema.parse(JSON.parse(readPrivate(path).toString('utf8')));
  if (![config.keyPath, config.vaultPath, path].every(p => separateDirectories(dirname(p), dirname(config.ledgerPath)))) throw new Error('ledger unavailable');
  const vault = new EncryptedVault(config.vaultPath, config.keyPath);
  let ledger: Ledger | undefined;
  try {
    ledger = new Ledger(config.ledgerPath, config.ownerId);
    const connection = new Connection(new OfficialProvider(config.registration), vault, config.registration);
    return { connection, ledger, ownerId: config.ownerId, serviceSecret: config.serviceSecret, close: () => { connection.shutdown(); try { ledger!.close(); } finally { vault.close(); } } };
  } catch { try { ledger?.close(); } finally { vault.close(); } throw new Error('secure setup unavailable'); }
}
