import * as fs from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { alpacaCredentialPairSchema, type AlpacaCredentialPair } from './alpaca-iex-contract.js';
import { privateDirectory, separateDirectories } from './private-files.js';
import { parseResearchJSON } from './research-json.js';

const credentialFile = 'alpaca-keypair.json';
const credentialSchema = 'gelt.alpaca-keypair.v1' as const;
const maxCredentialBytes = 1024;
const unavailable = () => new Error('Alpaca credential storage unavailable');
const flags = fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW;

type Identity = { dev: number; ino: number; uid: number; mode: number };
function identity(st: fs.Stats): Identity { return { dev: st.dev, ino: st.ino, uid: st.uid, mode: st.mode & 0o777 }; }
function sameIdentity(a: Identity, b: Identity) { return a.dev === b.dev && a.ino === b.ino && a.uid === b.uid && a.mode === b.mode; }
function requireLinux() {
  if (process.platform !== 'linux' || !process.getuid || !fs.constants.O_DIRECTORY || !fs.constants.O_NOFOLLOW) throw unavailable();
}
function absoluteDirectory(path: string) {
  if (typeof path !== 'string' || path !== resolve(path) || basename(path) === '.' || basename(path) === '/') throw unavailable();
  return path;
}
type PinnedDirectory = { path: string; canonical: string; entries: Array<{ path: string; fd: number; stat: Identity }> };
function pinDirectoryChain(path: string): PinnedDirectory {
  requireLinux();
  path = absoluteDirectory(path);
  privateDirectory(path);
  const canonical = fs.realpathSync.native(path);
  if (canonical !== path) throw unavailable();
  const entries: PinnedDirectory['entries'] = [];
  let pendingFd: number | undefined;
  try {
    let current = '/';
    pendingFd = fs.openSync(current, flags);
    let stat = identity(fs.fstatSync(pendingFd));
    let named = identity(fs.lstatSync(current));
    if (!fs.fstatSync(pendingFd).isDirectory() || !sameIdentity(stat, named)) throw unavailable();
    entries.push({ path: current, fd: pendingFd, stat });
    pendingFd = undefined;
    for (const component of path.split('/').filter(Boolean)) {
      current = current === '/' ? `/${component}` : `${current}/${component}`;
      pendingFd = fs.openSync(fdPath(entries[entries.length - 1].fd, component), flags);
      const opened = fs.fstatSync(pendingFd), linked = fs.lstatSync(current);
      stat = identity(opened); named = identity(linked);
      if (!opened.isDirectory() || linked.isSymbolicLink() || !sameIdentity(stat, named)) {
        throw unavailable();
      }
      entries.push({ path: current, fd: pendingFd, stat });
      pendingFd = undefined;
    }
    if (entries[entries.length - 1].path !== path) throw unavailable();
    return { path, canonical, entries };
  } catch (error) {
    for (const entry of entries.reverse()) { try { fs.closeSync(entry.fd); } catch { /* Close remaining pinned ancestors. */ } }
    throw error;
  } finally {
    if (pendingFd !== undefined) { try { fs.closeSync(pendingFd); } catch { /* Close any descriptor not yet pinned. */ } }
  }
}
function recheckDirectoryChain(pin: PinnedDirectory) {
  privateDirectory(pin.path);
  if (fs.realpathSync.native(pin.path) !== pin.canonical) throw unavailable();
  for (const entry of pin.entries) {
    const opened = fs.fstatSync(entry.fd), linked = fs.lstatSync(entry.path);
    if (!opened.isDirectory() || linked.isSymbolicLink()
      || !sameIdentity(identity(opened), entry.stat) || !sameIdentity(identity(linked), entry.stat)) throw unavailable();
  }
}
function closeDirectoryChain(pin: PinnedDirectory | undefined) {
  if (!pin) return;
  for (const entry of [...pin.entries].reverse()) { try { fs.closeSync(entry.fd); } catch { /* Continue closing pinned ancestors. */ } }
}
function openPrivateDirectory(path: string): { fd: number; stat: Identity } {
  requireLinux();
  path = absoluteDirectory(path);
  privateDirectory(path);
  const fd = fs.openSync(path, flags);
  try {
    const st = fs.fstatSync(fd), lst = fs.lstatSync(path);
    const actual = identity(st), named = identity(lst);
    if (!st.isDirectory() || lst.isSymbolicLink() || st.uid !== process.getuid!() || actual.mode !== 0o700
      || !sameIdentity(actual, named)) throw unavailable();
    return { fd, stat: actual };
  } catch (e) { fs.closeSync(fd); throw e; }
}
function recheckDirectory(path: string, fd: number, expected: Identity) {
  privateDirectory(path);
  const st = fs.fstatSync(fd), named = fs.lstatSync(path);
  if (!st.isDirectory() || named.isSymbolicLink() || !sameIdentity(identity(st), expected)
    || !sameIdentity(identity(named), expected)) throw unavailable();
}
function fdPath(fd: number, name: string) { return `/proc/self/fd/${fd}/${name}`; }
function readPinnedFile(directory: string, dirFd: number, expectedDirectory: Identity): Buffer {
  const path = fdPath(dirFd, credentialFile);
  const fd = fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const st = fs.fstatSync(fd), lst = fs.lstatSync(path);
    if (!st.isFile() || lst.isSymbolicLink() || st.nlink !== 1 || st.uid !== process.getuid!()
      || (st.mode & 0o777) !== 0o600 || st.size < 1 || st.size > maxCredentialBytes
      || !sameIdentity(identity(st), identity(lst))) throw unavailable();
    const before = fs.fstatSync(fd, { bigint: true });
    const bounded = Buffer.alloc(maxCredentialBytes + 1);
    let length = 0;
    while (length < bounded.length) {
      const read = fs.readSync(fd, bounded, length, bounded.length - length, null);
      if (read === 0) break;
      length += read;
    }
    const after = fs.fstatSync(fd, { bigint: true });
    if (length !== st.size || length > maxCredentialBytes
      || before.dev !== after.dev || before.ino !== after.ino || before.uid !== after.uid
      || before.nlink !== after.nlink || before.mode !== after.mode || before.size !== after.size
      || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs) throw unavailable();
    recheckDirectory(directory, dirFd, expectedDirectory);
    return Buffer.from(bounded.subarray(0, length));
  } finally { fs.closeSync(fd); }
}

// Creates a new 0700 child directory and an exclusive 0600 keypair file via
// an open directory descriptor. The existing broker-vault directory is never
// read or modified. Path and file identities are checked before and after.
export function provisionAlpacaKeyPair(dataDirectory: string, brokerVaultDirectory: string, value: unknown): string {
  let parentPin: PinnedDirectory | undefined, brokerPin: PinnedDirectory | undefined,
    dataPin: PinnedDirectory | undefined, fileFd: number | undefined;
  try {
    requireLinux();
    const dataPath = absoluteDirectory(dataDirectory), brokerPath = absoluteDirectory(brokerVaultDirectory);
    if (!separateDirectories(dataPath, brokerPath)) throw unavailable();
    const pair = alpacaCredentialPairSchema.parse(value);
    const parent = dirname(dataPath), childName = basename(dataPath);
    parentPin = pinDirectoryChain(parent);
    brokerPin = pinDirectoryChain(brokerPath);
    const brokerIdentity = brokerPin.entries[brokerPin.entries.length - 1].stat;
    if (parentPin.entries.some(entry => sameIdentity(entry.stat, brokerIdentity))) throw unavailable();
    recheckDirectoryChain(parentPin); recheckDirectoryChain(brokerPin);
    const parentFd = parentPin.entries[parentPin.entries.length - 1].fd;
    const anchoredChild = fdPath(parentFd, childName);
    fs.mkdirSync(anchoredChild, { mode: 0o700 });
    dataPin = pinDirectoryChain(dataPath);
    const dataHandle = dataPin.entries[dataPin.entries.length - 1];
    if (dataHandle.stat.uid !== process.getuid!() || dataHandle.stat.mode !== 0o700) throw unavailable();
    const bytes = Buffer.from(JSON.stringify({ schema: credentialSchema, ...pair }));
    if (bytes.length > maxCredentialBytes) throw unavailable();
    recheckDirectoryChain(parentPin); recheckDirectoryChain(brokerPin); recheckDirectoryChain(dataPin);
    const filePath = fdPath(dataHandle.fd, credentialFile);
    fileFd = fs.openSync(filePath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
    fs.writeFileSync(fileFd, bytes);
    fs.fsyncSync(fileFd);
    const fileStat = fs.fstatSync(fileFd), fileNamed = fs.lstatSync(filePath);
    if (!fileStat.isFile() || fileNamed.isSymbolicLink() || fileStat.nlink !== 1
      || fileStat.uid !== process.getuid!() || (fileStat.mode & 0o777) !== 0o600
      || fileStat.size !== bytes.length || !sameIdentity(identity(fileStat), identity(fileNamed))) throw unavailable();
    fs.fsyncSync(dataHandle.fd);
    recheckDirectoryChain(dataPin); recheckDirectoryChain(parentPin); recheckDirectoryChain(brokerPin);
    const readback = readPinnedFile(dataPath, dataHandle.fd, dataHandle.stat);
    if (!readback.equals(bytes)) throw unavailable();
    recheckDirectoryChain(dataPin); recheckDirectoryChain(parentPin); recheckDirectoryChain(brokerPin);
    return 'stored';
  } catch { throw unavailable(); }
  finally {
    if (fileFd !== undefined) fs.closeSync(fileFd);
    closeDirectoryChain(dataPin);
    closeDirectoryChain(brokerPin);
    closeDirectoryChain(parentPin);
  }
}

export function readAlpacaKeyPair(dataDirectory: string): AlpacaCredentialPair {
  let fd: number | undefined;
  try {
    const path = absoluteDirectory(dataDirectory), opened = openPrivateDirectory(path); fd = opened.fd;
    const bytes = readPinnedFile(path, fd, opened.stat);
    const record = parseResearchJSON(bytes) as Record<string, unknown>;
    if (!record || record.schema !== credentialSchema) throw unavailable();
    const { schema: _schema, ...pair } = record;
    return alpacaCredentialPairSchema.parse(pair);
  } catch { throw unavailable(); }
  finally { if (fd !== undefined) fs.closeSync(fd); }
}

export type AlpacaTerminalSignal = 'SIGINT' | 'SIGTERM';
export type AlpacaTerminalSignals = {
  on(signal: AlpacaTerminalSignal, listener: () => void): unknown;
  off(signal: AlpacaTerminalSignal, listener: () => void): unknown;
  terminate(signal: AlpacaTerminalSignal): void;
};
export type HiddenTerminal = Readonly<{
  input: {
    isTTY: boolean;
    isRaw?: boolean;
    setRawMode(mode: boolean): unknown;
    on(event: string, listener: (...args: any[]) => void): unknown;
    off(event: string, listener: (...args: any[]) => void): unknown;
    resume(): unknown;
    pause(): unknown;
  };
  output: { isTTY: boolean; write(text: string): unknown };
  signals?: AlpacaTerminalSignals;
}>;

const processSignals: AlpacaTerminalSignals = {
  on: (signal, listener) => process.on(signal, listener),
  off: (signal, listener) => process.off(signal, listener),
  terminate: signal => { process.kill(process.pid, signal); },
};
const defaultTerminal = (): HiddenTerminal => ({ input: process.stdin, output: process.stdout, signals: processSignals }) as HiddenTerminal;

class TerminalSignalInterruption extends Error {
  constructor(readonly signal: AlpacaTerminalSignal) { super('terminal interrupted'); }
}

async function readHiddenLine(prompt: string, terminal: HiddenTerminal): Promise<string> {
  const { input, output } = terminal;
  if (!input.isTTY || !output.isTTY || typeof input.setRawMode !== 'function') throw unavailable();
  const wasRaw = input.isRaw === true;
  const bytes: number[] = [];
  let listener: ((chunk: Buffer | string) => void) | undefined;
  let endListener: (() => void) | undefined, closeListener: (() => void) | undefined;
  let errorListener: (() => void) | undefined;
  let interruptListener: (() => void) | undefined, terminateListener: (() => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let rawModeAttempted = false;
  let dataRegistrationAttempted = false, endRegistrationAttempted = false;
  let closeRegistrationAttempted = false, errorRegistrationAttempted = false;
  let interruptRegistrationAttempted = false, terminateRegistrationAttempted = false;
  const signals = terminal.signals ?? processSignals;
  try {
    input.pause();
    rawModeAttempted = true;
    input.setRawMode(true);
    return await new Promise<string>((resolveLine, rejectLine) => {
      let settled = false;
      const reject = (error: Error = unavailable()) => { if (!settled) { settled = true; rejectLine(error); } };
      timer = setTimeout(() => reject(), 120_000);
      timer.unref?.();
      listener = chunk => {
        try {
          if (settled) return;
          const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, 'utf8');
          for (const byte of data) {
            if (byte === 3) { reject(new TerminalSignalInterruption('SIGINT')); return; }
            if (byte === 10 || byte === 13) {
              const line = Buffer.from(bytes).toString('ascii');
              output.write('\n');
              settled = true; resolveLine(line); return;
            }
            if (byte === 8 || byte === 127) { bytes.pop(); continue; }
            if (byte < 0x20 || byte > 0x7e || bytes.length >= 128) { reject(); return; }
            bytes.push(byte);
          }
        } catch { reject(); }
      };
      endListener = () => reject(); closeListener = () => reject(); errorListener = () => reject();
      interruptListener = () => reject(new TerminalSignalInterruption('SIGINT'));
      terminateListener = () => reject(new TerminalSignalInterruption('SIGTERM'));
      interruptRegistrationAttempted = true; signals.on('SIGINT', interruptListener);
      terminateRegistrationAttempted = true; signals.on('SIGTERM', terminateListener);
      if (settled) return;
      output.write(prompt);
      dataRegistrationAttempted = true; input.on('data', listener);
      endRegistrationAttempted = true; input.on('end', endListener);
      closeRegistrationAttempted = true; input.on('close', closeListener);
      errorRegistrationAttempted = true; input.on('error', errorListener);
      input.resume();
    });
  } catch (error) {
    if (error instanceof TerminalSignalInterruption) throw error;
    throw unavailable();
  }
  finally {
    if (timer) clearTimeout(timer);
    try { if (dataRegistrationAttempted && listener) input.off('data', listener); } catch { /* Restore terminal mode below. */ }
    try { if (endRegistrationAttempted && endListener) input.off('end', endListener); } catch { /* Restore terminal mode below. */ }
    try { if (closeRegistrationAttempted && closeListener) input.off('close', closeListener); } catch { /* Restore terminal mode below. */ }
    try { if (errorRegistrationAttempted && errorListener) input.off('error', errorListener); } catch { /* Restore terminal mode below. */ }
    try { if (interruptRegistrationAttempted && interruptListener) signals.off('SIGINT', interruptListener); } catch { /* Restore terminal mode below. */ }
    try { if (terminateRegistrationAttempted && terminateListener) signals.off('SIGTERM', terminateListener); } catch { /* Restore terminal mode below. */ }
    try { input.pause(); } catch { /* Restore terminal mode below. */ }
    try { if (rawModeAttempted) input.setRawMode(wasRaw); } catch { bytes.fill(0); throw unavailable(); }
    bytes.fill(0);
  }
}

// Future explicit operator entry. It reads both fields from a hidden TTY only;
// callers cannot pass credentials through args, environment, or chat. This
// function is not wired to any app/startup path and must only be invoked after
// a separate owner approval for actual local credential provisioning.
export async function enterAlpacaKeyPairFromTty(dataDirectory: string, brokerVaultDirectory: string, terminal = defaultTerminal()): Promise<void> {
  let keyId = '', secretKey = '';
  try {
    keyId = await readHiddenLine('Alpaca key ID (hidden): ', terminal);
    secretKey = await readHiddenLine('Alpaca secret key (hidden): ', terminal);
    const pair = alpacaCredentialPairSchema.parse({ keyId, secretKey });
    provisionAlpacaKeyPair(dataDirectory, brokerVaultDirectory, pair);
  } catch (error) {
    if (error instanceof TerminalSignalInterruption) {
      try { (terminal.signals ?? processSignals).terminate(error.signal); } catch { /* Preserve the sanitized caller boundary. */ }
    }
    throw new Error('Alpaca credential entry unavailable');
  }
  finally { keyId = ''; secretKey = ''; }
}
