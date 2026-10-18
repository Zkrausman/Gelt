import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const hash = value => createHash('sha256').update(value).digest('hex');
const self = fileURLToPath(import.meta.url);
const build = new URL('../worker/dist/', import.meta.url);
const MAX_RECORD = 256 * 1024;
const digestPattern = /^[a-f0-9]{64}$/;
const failure = () => new Error('unavailable');
const holidays = new Set(['2025-11-27', '2025-12-25', '2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25', '2026-06-19', '2026-07-03', '2026-09-07']);

// Frozen proposed window. It is not an attestation of exchange completeness.
function scheduledWindow() {
  const rows = [];
  const offset = day => day < '2025-11-02' || day >= '2026-03-08' ? 4 : 5;
  for (let value = Date.parse('2025-10-15T00:00:00.000Z'); value <= Date.parse('2026-10-16T00:00:00.000Z'); value += 86400000) {
    const date = new Date(value), day = date.toISOString().slice(0, 10);
    if (date.getUTCDay() === 0 || date.getUTCDay() === 6 || holidays.has(day)) continue;
    const next = new Date(value + 86400000).toISOString().slice(0, 10);
    const core = day === '2025-11-28' || day === '2025-12-24' ? 13 : 16;
    rows.push(Object.freeze({
      providerTimestamp: new Date(value + offset(day) * 3600000).toISOString(),
      closedAt: new Date(value + (offset(day) + core) * 3600000).toISOString(),
      completedAt: new Date(value + 86400000 + offset(next) * 3600000).toISOString(),
    }));
  }
  return Object.freeze(rows);
}
export const proposedSessions = scheduledWindow();
export const fixedRequest = Object.freeze({ symbol: 'SPY', feed: 'iex', timeframe: '1Day', currency: 'USD', adjustment: 'raw', sort: 'desc', start: '2025-10-15T04:00:00.000Z', end: '2026-10-16T04:00:00.000Z', asof: '2026-10-16' });
export const requestSha256 = hash(JSON.stringify({ request: fixedRequest, sessions: proposedSessions }));

function argsOf(argv) {
  if (argv.length === 1 && argv[0] === '--describe') return { describe: true };
  if (argv.length !== 5 || argv[0] !== '--acquire-once' || argv[1] !== '--data-dir' || argv[3] !== '--approval-record') throw failure();
  for (const path of [argv[2], argv[4]]) if (!isAbsolute(path) || resolve(path) !== path || path.includes('\0')) throw failure();
  return { data: argv[2], record: argv[4] };
}

// No symlink traversal, no credential contents: inspect each ancestor in order.
function directoryChain(path, uid) {
  const paths = []; let current = path;
  for (;;) { paths.unshift(current); if (dirname(current) === current) break; current = dirname(current); }
  for (const entry of paths) {
    const s = fs.lstatSync(entry);
    if (!s.isDirectory() || s.isSymbolicLink() || (s.uid !== 0 && s.uid !== uid) || (s.mode & 0o022)) throw failure();
  }
  const s = fs.lstatSync(path);
  if (s.uid !== uid || (s.mode & 0o777) !== 0o700) throw failure();
}

function readRecord(path, uid) {
  directoryChain(dirname(path), uid);
  const named = fs.lstatSync(path);
  if (!named.isFile() || named.isSymbolicLink() || named.uid !== uid || named.nlink !== 1 || (named.mode & 0o777) !== 0o600 || named.size < 1 || named.size > MAX_RECORD) throw failure();
  const fd = fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const opened = fs.fstatSync(fd);
    if (opened.dev !== named.dev || opened.ino !== named.ino || opened.size !== named.size) throw failure();
    const bytes = Buffer.alloc(MAX_RECORD + 1);
    const count = fs.readSync(fd, bytes, 0, bytes.length, 0);
    const after = fs.fstatSync(fd), renamed = fs.lstatSync(path);
    if (count !== named.size || count > MAX_RECORD || after.size !== count || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs || renamed.dev !== opened.dev || renamed.ino !== opened.ino) throw failure();
    return bytes.subarray(0, count);
  } finally { fs.closeSync(fd); }
}

async function loadModules() {
  for (const name of ['alpaca-iex-contract.js', 'alpaca-iex-connector.js', 'alpaca-iex-credentials.js', 'research-json.js']) {
    const s = fs.lstatSync(fileURLToPath(new URL(name, build)));
    if (!s.isFile() || s.isSymbolicLink()) throw failure();
  }
  const contract = await import(new URL('alpaca-iex-contract.js', build));
  const connector = await import(new URL('alpaca-iex-connector.js', build));
  const credentials = await import(new URL('alpaca-iex-credentials.js', build));
  const json = await import(new URL('research-json.js', build));
  return { ...contract, ...connector, ...credentials, ...json };
}

function approvedRecord(value, modules, commandSha256) {
  const keys = ['schema', 'repositoryId', 'commandSha256', 'requestSha256', 'calendar', 'calendarEvidenceSha256', 'rightsEvidenceSha256', 'retentionEvidenceSha256', 'actionEvidenceSha256', 'retention', 'dataDirectory'];
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== keys.sort().join(',')) throw failure();
  if (value.schema !== 'gelt.alpaca-iex-acquire-once-approval.v1' || value.repositoryId !== 1415613140 || value.commandSha256 !== commandSha256 || value.requestSha256 !== requestSha256 || value.retention !== 'process_memory_only') throw failure();
  for (const key of ['commandSha256', 'calendarEvidenceSha256', 'rightsEvidenceSha256', 'retentionEvidenceSha256', 'actionEvidenceSha256']) if (typeof value[key] !== 'string' || !digestPattern.test(value[key])) throw failure();
  const calendar = modules.alpacaSessionCalendarSchema.parse(value.calendar);
  if (calendar.symbol !== 'SPY' || calendar.sessions.length !== proposedSessions.length || calendar.sessions.length !== 253) throw failure();
  for (let i = 0; i < proposedSessions.length; i++) {
    const actual = calendar.sessions[i], expected = proposedSessions[i];
    if (actual.sessionOrdinal !== i || actual.providerTimestamp !== expected.providerTimestamp || actual.closedAt !== expected.closedAt || actual.completedAt !== expected.completedAt) throw failure();
  }
  return calendar;
}

async function writeStatus(stream, message) {
  await new Promise((resolveWrite, reject) => {
    const timer = setTimeout(() => reject(failure()), 5000);
    try { stream.write(message + '\n', error => { clearTimeout(timer); error ? reject(failure()) : resolveWrite(); }); }
    catch { clearTimeout(timer); reject(failure()); }
  });
  await new Promise(next => setImmediate(next));
}

/** Injection is an import-only synthetic test seam, never a command-line option. */
export async function runAlpacaIexAcquireOnce(overrides = {}) {
  const output = overrides.output ?? process.stdout, errorOutput = overrides.errorOutput ?? process.stderr;
  let outputFailed = false, attempted = false;
  const onOutputError = () => { outputFailed = true; };
  output.on('error', onOutputError); errorOutput.on('error', onOutputError);
  try {
    const args = argsOf(overrides.argv ?? process.argv.slice(2));
    if (args.describe) {
      await writeStatus(output, JSON.stringify({ request: fixedRequest, requestSha256, expectedObservations: 253, pagesMaximum: 3, status: 'proposal_only_no_credentials_or_requests', calendarAccepted: false, effectAuthority: 'none' }));
      return outputFailed ? 1 : 0;
    }
    const platform = overrides.platform ?? process.platform, version = overrides.nodeVersion ?? process.versions.node;
    const env = overrides.env ?? process.env, execArgv = overrides.execArgv ?? process.execArgv;
    // An inherited TLS/CA/proxy override can defeat a fixed HTTPS URL. Require
    // an explicitly clean environment, rather than trying to enumerate every
    // present or future Node/OpenSSL/proxy switch. PATH is never used to spawn.
    if (platform !== 'linux' || !/^22\./.test(version) || execArgv.length || Object.keys(env).some(k => !['PATH', 'LANG', 'LC_ALL', 'TZ'].includes(k))) throw failure();
    const modules = await (overrides.loadModules ?? loadModules)();
    const uid = overrides.uid ?? process.getuid();
    const raw = (overrides.readRecord ?? readRecord)(args.record, uid);
    const record = modules.parseResearchJSON(Buffer.from(raw, 'utf8'));
    const calendar = approvedRecord(record, modules, overrides.commandSha256 ?? hash(fs.readFileSync(self)));
    if (record.dataDirectory !== args.data) throw failure();
    // Hash references are externally reviewed assertions, never runtime rights attestation.
    // This does not acquire while only the public calendar proposal is available.
    (overrides.checkDataDirectory ?? directoryChain)(args.data, uid);
    const now = (overrides.now ?? (() => Date.now()))();
    if (!Number.isFinite(now) || Date.parse(calendar.sessions.at(-1).completedAt) > now) throw failure();
    await writeStatus(output, 'One bounded data acquisition requested. No account, order, strategy or runner operation.');
    if (outputFailed) throw failure();
    // Exactly one helper read and one connector call; connector owns its three-page budget.
    let credentials = modules.readAlpacaKeyPair(args.data);
    let acquisition;
    try { attempted = true; acquisition = await modules.acquireAlpacaIexDailyBars({ enabled: true, symbol: 'SPY', feed: 'iex', adjustment: 'raw', start: fixedRequest.start, end: fixedRequest.end, asof: fixedRequest.asof, calendar }, credentials); }
    finally { credentials = undefined; }
    if (!modules.verifyAlpacaIexAcquisition(acquisition) || acquisition.observations.length !== 253 || acquisition.calendarSha256 !== calendar.sha256) throw failure();
    for (let i = 0; i < 253; i++) if (acquisition.observations[252 - i].providerTimestamp !== calendar.sessions[i].providerTimestamp) throw failure();
    await writeStatus(output, JSON.stringify({ status: 'captured_unverified_memory_only', symbol: 'SPY', feed: 'iex', timeframe: '1Day', adjustment: 'raw', requestSha256, calendarSha256: calendar.sha256, observations: acquisition.observations.length, pages: acquisition.pages.length, receivedAt: acquisition.receivedAt, effectAuthority: 'none', promotionAllowed: false }));
    acquisition = undefined;
    return outputFailed ? 1 : 0;
  } catch {
    try { await writeStatus(errorOutput, attempted ? 'Acquisition unavailable. Stop; no automatic retry or fallback.' : 'Acquisition preflight unavailable. No data request was started.'); } catch { /* No raw errors. */ }
    return 1;
  } finally {
    output.off('error', onOutputError); errorOutput.off('error', onOutputError);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === self) {
  // Standalone-only lifetime guards prevent late stream errors printing raw diagnostics.
  for (const stream of new Set([process.stdout, process.stderr])) stream.on('error', () => { process.exitCode = 1; });
  process.exitCode = await runAlpacaIexAcquireOnce();
}
