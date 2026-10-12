import { randomBytes, createHash } from 'node:crypto';
import { Account, accountsSchema, callbackInput, Credentials, credentialsSchema, initiatedSchema, opaque, Registration, selectionInput, Status, statusSchema } from './connection-contract.js';
import { Provider } from './provider.js';
import { Vault } from './vault.js';
const random = () => randomBytes(32).toString('base64url');
export class Connection {
  private generation = 0;
  private closed = false;
  private credentials: Credentials | null = null;
  private pending: { state: string; verifier: string; session: string; expires: number; generation: number } | null = null;
  private accounts = new Map<string, Account>();
  // Never evict on rediscovery, failure or disconnect: old browser handles must
  // not acquire a new meaning. Bound memory; exhaustion requires worker restart.
  private issuedHandles = new Set<string>();
  private selected: string | null = null;
  private failed = false;
  private refreshFlight: Promise<void> | null = null;
  private discoveryFlight: Promise<Status> | null = null;
  constructor(private provider?: Provider, private vault?: Vault, private registration?: Registration, private now = Date.now, private handle = random) {
    try { this.credentials = vault?.read() ?? null; } catch { this.failed = true; }
  }
  status(): Status {
    const pending = this.pending && this.pending.expires > this.now();
    const connected = !this.failed && this.credentials && this.credentials.expiresAt > this.now() && this.accounts.size > 0;
    return statusSchema.parse({ version: 'v1', state: this.failed ? 'unavailable' : pending ? 'authorizing' : connected ? 'connected' : this.credentials ? 'unavailable' : 'disconnected', reason: this.failed ? 'provider_failure' : !this.provider ? 'offline' : pending ? 'authorization_pending' : connected ? 'ready' : 'not_connected', expiresAt: connected ? this.credentials!.expiresAt : null, accounts: connected ? [...this.accounts].map(([handle, a]) => ({ handle, label: `Account ••••${a.rhc_account_number.slice(-4)}` })) : [], selected: connected ? this.selected : null, execution: false });
  }
  private configured() { if (this.closed || !this.provider || !this.vault || !this.registration || this.failed) throw new Error('connection unavailable'); }
  initiate(session: string, sessionExpires = this.now() + 3600000) {
    this.configured(); opaque.parse(session);
    if (!Number.isSafeInteger(sessionExpires) || sessionExpires <= this.now()) throw new Error('expired session');
    if (this.credentials || (this.pending && this.pending.expires > this.now())) throw new Error('disconnect before authorizing');
    const state = random(), verifier = random();
    this.pending = { state, verifier, session, expires: Math.min(this.now() + 300000, sessionExpires), generation: ++this.generation };
    const url = new URL(this.registration!.authorizationEndpoint);
    url.search = new URLSearchParams({ response_type: 'code', client_id: this.registration!.clientId, redirect_uri: this.registration!.redirectUri, scope: 'internal', resource: this.registration!.issuer, state, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' }).toString();
    return initiatedSchema.parse({ version: 'v1', authorizationUrl: url.href });
  }
  private current(generation: number) { if (generation !== this.generation) throw new Error('stale operation'); }
  private fail(generation: number) {
    if (this.closed || generation !== this.generation) return;
    ++this.generation; this.pending = null;
    this.failed = true; this.accounts.clear(); this.selected = null; this.credentials = null;
    // No retry with uncertain credentials. Keep failure latched until disconnect succeeds.
    try { this.vault?.write(null); } catch { /* remains unavailable */ }
  }
  async callback(session: string, input: unknown) {
    const data = callbackInput.parse(input), p = this.pending;
    // Wrong session/state cannot consume another browser's transaction.
    if (!p || p.state !== data.state || p.session !== session) throw new Error('invalid callback');
    this.pending = null;
    if (p.expires <= this.now()) throw new Error('expired callback');
    try {
      if ('error' in data) throw new Error('authorization denied');
      const value = credentialsSchema.parse(await this.provider!.exchange(data.code, p.verifier));
      this.current(p.generation); if (p.expires <= this.now() || value.expiresAt <= this.now()) throw new Error('expired token');
      this.vault!.write(value); this.credentials = value;
      const status = await this.discover(p.expires);
      this.current(p.generation); if (p.expires <= this.now()) throw new Error('expired callback');
      return status;
    } catch { this.fail(p.generation); throw new Error('connection unavailable'); }
  }
  private async fresh(generation: number, validUntil: number) {
    if (!this.credentials) throw new Error('not connected');
    if (this.credentials.expiresAt > this.now() + 30000) return;
    if (!this.refreshFlight) {
      const original = this.credentials;
      const flight = (async () => {
        const value = credentialsSchema.parse(await this.provider!.refresh(original));
        this.current(generation);
        if (this.credentials !== original || value.expiresAt <= this.now() || validUntil <= this.now()) throw new Error('stale refresh');
        this.vault!.write(value); this.credentials = value;
      })();
      this.refreshFlight = flight;
      void flight.finally(() => { if (this.refreshFlight === flight) this.refreshFlight = null; }).catch(() => {});
    }
    await this.refreshFlight; this.current(generation);
  }
  discover(validUntil = Number.MAX_SAFE_INTEGER): Promise<Status> {
    if (this.closed) return Promise.reject(new Error('connection unavailable'));
    if (this.discoveryFlight) return this.discoveryFlight;
    const g = this.generation;
    const flight = (async () => {
      try {
        this.configured(); await this.fresh(g, validUntil); this.current(g);
        const credentials = this.credentials!;
        const data = accountsSchema.parse(await this.provider!.accounts(credentials.access));
        this.current(g); if (this.credentials !== credentials || credentials.expiresAt <= this.now() || validUntil <= this.now()) throw new Error('expired discovery');
        if (this.issuedHandles.size + data.accounts.length > 10000) throw new Error('handle capacity exhausted');
        const next = new Map<string, Account>();
        for (const account of data.accounts) {
          const handle = opaque.parse(this.handle());
          if (this.issuedHandles.has(handle)) throw new Error('duplicate handle');
          this.issuedHandles.add(handle);
          next.set(handle, account);
        }
        this.accounts = next; this.selected = null;
        return this.status();
      } catch { this.fail(g); throw new Error('connection unavailable'); }
    })();
    this.discoveryFlight = flight;
    void flight.finally(() => { if (this.discoveryFlight === flight) this.discoveryFlight = null; }).catch(() => {});
    return flight;
  }
  select(input: unknown) {
    const { account } = selectionInput.parse(input);
    if (this.status().state !== 'connected' || !this.accounts.has(account)) throw new Error('invalid account');
    this.selected = account; return this.status();
  }
  selectedAccountScope(): { account: Account; handle: string } | null {
    if (this.status().state !== 'connected' || !this.selected) return null;
    const account = this.accounts.get(this.selected);
    return account ? { account: { ...account }, handle: this.selected } : null;
  }
  shutdown() {
    this.closed = true; ++this.generation; this.pending = null; this.credentials = null; this.accounts.clear(); this.selected = null; this.failed = true;
  }
  disconnect() {
    if (this.closed) throw new Error('connection unavailable');
    ++this.generation; this.pending = null; this.credentials = null; this.accounts.clear(); this.selected = null;
    this.refreshFlight = null; this.discoveryFlight = null;
    try { this.vault?.write(null); this.failed = false; } catch { this.failed = true; throw new Error('disconnect unavailable'); }
    return this.status();
  }
}
