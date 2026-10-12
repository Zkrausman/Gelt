import { it, expect } from 'vitest';
import * as fs from 'node:fs';
import { join } from 'node:path';
import { provisionOwner, renewGrant } from './provisioning.js';
import { Ledger } from './ledger.js';
import { createLedgerDirectory } from './ledger-storage.js';
import { setup } from './setup.js';
import { storageFixture } from './storage-fixture.js';
import { createPrivateDirectory, writePrivateNew } from './private-files.js';
it('explicit provisioning creates distinct private secrets, no default lookup, no overwrite; renew only bootstrap', () => {
  const root = storageFixture('gelt-provision-');
  try {
    const dirs = ['key', 'worker', 'bff', 'owner', 'ledger'].map(p => join(root, p)); for (const [i, d] of dirs.entries()) { if (i === 4) createLedgerDirectory(d); else createPrivateDirectory(d); }
    const path = join(root, 'registration.json');
    writePrivateNew(path, JSON.stringify({ clientId: 'offline-fixture', redirectUri: 'http://127.0.0.1:3000/api/connection/callback', issuer: 'https://agent.robinhood.com/mcp/trading', authorizationEndpoint: 'https://robinhood.com/oauth', tokenEndpoint: 'https://api.robinhood.com/oauth2/token/', scope: 'internal', tokenEndpointAuthMethod: 'none', pkce: 'S256' }));
    expect(() => provisionOwner([])).toThrow(); expect(() => provisionOwner([path, ...dirs.slice(0, 3), dirs[0]])).toThrow();
    provisionOwner([path, ...dirs]); expect(() => provisionOwner([path, ...dirs])).toThrow();
    const bff = JSON.parse(fs.readFileSync(join(dirs[2], 'bff.json'), 'utf8')); expect(Object.keys(bff)).toEqual(['serviceSecret']);
    const bootstrap = fs.readFileSync(join(dirs[3], 'bootstrap.txt'), 'utf8'); expect(bootstrap).not.toBe(bff.serviceSecret); expect(bootstrap.length).toBe(43);
    const configured = setup(join(dirs[1], 'worker.json')); expect(configured.connection.status().state).toBe('disconnected'); configured.close();
    const config = JSON.parse(fs.readFileSync(join(dirs[1], 'worker.json'), 'utf8'));
    const holder = new Ledger(config.ledgerPath, config.ownerId);
    try { expect(() => setup(join(dirs[1], 'worker.json'))).toThrow(); expect(fs.existsSync(join(dirs[1], 'credentials.vault.lock'))).toBe(false); }
    finally { holder.close(); }
    expect(() => renewGrant([dirs[2], dirs[3]])).toThrow(); fs.unlinkSync(join(dirs[2], 'bootstrap.json')); fs.unlinkSync(join(dirs[3], 'bootstrap.txt'));
    renewGrant([dirs[2], dirs[3]]); expect(fs.readFileSync(join(dirs[3], 'bootstrap.txt'), 'utf8')).not.toBe(bootstrap);
    if (process.platform === 'linux') for (const d of dirs) for (const file of fs.readdirSync(d)) expect(fs.statSync(join(d, file)).mode & 0o777).toBe(0o600);
    expect(setup().connection.status().reason).toBe('offline'); expect(() => setup(join(root, 'missing'))).toThrow();
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
