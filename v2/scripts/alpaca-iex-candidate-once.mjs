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
// Keep the capture-only entry inert and unchanged; never execute a source dependency before its integrity gate.
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
  if (argv.length !== 5 || argv[0] !== '--candidate-once' || argv[1] !== '--data-dir' || argv[3] !== '--approval-record') throw failure();
  for (const path of [argv[2], argv[4]]) if (!isAbsolute(path) || resolve(path) !== path || path.includes('\0')) throw failure();
  // Never consume the protected credential directory as an approval record.
  if (argv[4] === argv[2] || argv[4].startsWith(argv[2] + '/')) throw failure();
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


// Full pinned candidate-mode compiled closure, verified before any worker import.
export const requiredCandidateBuildDigests = Object.freeze({
  "node_modules/zod/index.js": "6419c4ac0e637ff08463083e31886d10354f74cbcc4e584400b2b837e39ac881",
  "node_modules/zod/package.json": "70eedbe34fd52385a4ae2f3e5759b19682189f0118ea73a6e7c32c677f61668e",
  "node_modules/zod/v3/ZodError.js": "f5ac9e86b92e201d41e294d7aa35986a2aa28829e1bcc8ac25f7c8dce0674b99",
  "node_modules/zod/v3/errors.js": "d40831f478288d76e82bbbcc3b7e95c8513b6e76471f2d49a37c979bc57d492d",
  "node_modules/zod/v3/external.js": "5d26d2e47e2352def36f89a3e8bf8581da22b7f857e07ef3114cd52cf4813445",
  "node_modules/zod/v3/helpers/errorUtil.js": "68589c0cf44c8b4ad19b77418f53caad2cd1dbc8d714f526e1876ebdee4828c5",
  "node_modules/zod/v3/helpers/parseUtil.js": "b57484013bb360bac2e334d58fcd5f6cbfa63ffcc7d8ff3dbbb3380ca659b956",
  "node_modules/zod/v3/helpers/typeAliases.js": "8e609bb71c20b858c77f0e9f90bb1319db8477b13f9f965f1a1e18524bf50881",
  "node_modules/zod/v3/helpers/util.js": "906ef685e5853d496e293ee8f8a2bb8b1ed2d078a1bcdfedb2dfd61d75b6330c",
  "node_modules/zod/v3/locales/en.js": "51a6dcc5d4bd52a64da127c012c6c963395c1d9a343ad75d4a8eca662fc8b205",
  "node_modules/zod/v3/types.js": "9763a2938f0e7f983363ef4bf6530e7583e3f2d54f8a4a6684efad58febc6e8e",
  "scripts/alpaca-iex-acquire-once.mjs": "e6077219f639118593e6e7950ad98357385db45c55ecb33e3743fd6a7f152cb9",
  "worker/dist/alpaca-iex-candidate-mode.js": "fb477c425834ca3e680fcc3aeaac4fd81e7513d927fcf4f62fa7208770112325",
  "worker/dist/alpaca-iex-connector.js": "e9ba067d73462c7b67fad24c26a25e66b88f91a8db0112cbe44dffef62a8c30d",
  "worker/dist/alpaca-iex-contract.js": "be67a47535328b9ce48ffc5653bf9f7e036e65c9175d8cca39065bc680c0ada4",
  "worker/dist/alpaca-iex-credentials.js": "8b7dce1e0344a6061ad1231ffc5f138d25eb6e4c107456d394f72233cc876fa9",
  "worker/dist/alpaca-iex-normalization.js": "4659ca9a5834615eb7407bfd8f01d33641da4e236b8305a1a8027f00c795175e",
  "worker/dist/alpaca-shadow-candidate.js": "3321d1e25dcd933072af82c891763335fb3991fb529b803032974bdf1ebca72e",
  "worker/dist/ledger-canonical.js": "101df3ae0860b9cbaf572bf2b6ace7697126b1898c852553bea50e2ee22fbc52",
  "worker/dist/ledger-contract.js": "63d9e4c9ee20c56f38007fcabc0107e131970e485495e3d02d9e617d0e3e9b16",
  "worker/dist/private-files.js": "7d2930f27cccd9514cc181a32c964fc42a722ab5449491b8f389630147a7c2c9",
  "worker/dist/research-json.js": "de5e0c71ef092a6e4a0b9cf841c73c9342f946955b06a8540b7e9c8e7af3031d",
  "worker/dist/shadow-rule-contract.js": "9d6274e4df70fc213bb82c69e78239ebdce4fe5fae97d21729b52fc418c30ff8",
  "worker/dist/shadow-rule.js": "0196b6800e30fd0f2e3baa15789439d5108781966e39329f3855e28262ff6a51",
  "worker/dist/storage-diagnostics.js": "cae9f5f7109a0fb0aae86a1acf74460ed916d36ff19767729a4c212ead756d1f",
  "worker/dist/windows-storage.js": "be9a0da3a6a2625f07e1146ee8d7f8260f50355fa1b46eb77e0101765a522d28",
  "worker/package.json": "2e723299fa80e53ee63ff401c6329d88884f326b18f5fba5bfd88b6cf39b3e8f"
});
const shadowPaths = ['worker/dist/package.json', 'worker/dist/node_modules', 'worker/node_modules', 'node_modules/zod/v3/package.json', 'node_modules/zod/v3/helpers/package.json', 'node_modules/zod/v3/locales/package.json'];
export function verifyCandidateBuild(root, overrides = {}) {
  const io = overrides.io ?? fs, expected = overrides.expected ?? requiredCandidateBuildDigests;
  for (const path of shadowPaths) {
    try { io.lstatSync(resolve(root, path)); } catch (error) { if (error?.code === 'ENOENT') continue; throw failure(); }
    throw failure();
  }
  for (const [relative, expectedDigest] of Object.entries(expected)) {
    const parts = relative.split('/'); let path = root;
    for (const part of parts.slice(0, -1)) {
      path = resolve(path, part); const directory = io.lstatSync(path);
      if (!directory.isDirectory() || directory.isSymbolicLink()) throw failure();
    }
    path = resolve(root, relative); const named = io.lstatSync(path);
    if (!named.isFile() || named.isSymbolicLink() || named.size > 1024 * 1024) throw failure();
    if (hash(io.readFileSync(path)) !== expectedDigest) throw failure();
  }
}

async function loadModules() {
  for (const name of ['alpaca-iex-contract.js', 'alpaca-iex-connector.js', 'alpaca-iex-credentials.js', 'research-json.js', 'alpaca-iex-candidate-mode.js']) {
    const s = fs.lstatSync(fileURLToPath(new URL(name, build)));
    if (!s.isFile() || s.isSymbolicLink()) throw failure();
  }
  const contract = await import(new URL('alpaca-iex-contract.js', build));
  const connector = await import(new URL('alpaca-iex-connector.js', build));
  const credentials = await import(new URL('alpaca-iex-credentials.js', build));
  const json = await import(new URL('research-json.js', build));
  const candidate = await import(new URL('alpaca-iex-candidate-mode.js', build));
  return { ...contract, ...connector, ...credentials, ...json, ...candidate };
}

function approvedRecord(value, modules, commandSha256) {
  const keys = ['schema', 'repositoryId', 'commandSha256', 'requestSha256', 'calendar', 'calendarEvidenceSha256', 'rightsEvidenceSha256', 'retentionEvidenceSha256', 'actionEvidenceSha256', 'retention', 'dataDirectory', 'candidateContext', 'availabilityBasis', 'availabilityEvidenceSha256'];
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== keys.sort().join(',')) throw failure();
  if (value.schema !== 'gelt.alpaca-iex-candidate-once-approval.v1' || value.repositoryId !== 1415613140 || value.commandSha256 !== commandSha256 || value.requestSha256 !== requestSha256 || value.retention !== 'process_memory_only') throw failure();
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
export async function runAlpacaIexCandidateOnce(overrides = {}) {
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
    (overrides.verifyBuild ?? verifyCandidateBuild)(fileURLToPath(new URL('../', import.meta.url)));
    const modules = await (overrides.loadModules ?? loadModules)();
    const uid = overrides.uid ?? process.getuid();
    const raw = (overrides.readRecord ?? readRecord)(args.record, uid);
    const record = modules.parseResearchJSON(Buffer.from(raw, 'utf8'));
    const calendar = approvedRecord(record, modules, overrides.commandSha256 ?? hash(fs.readFileSync(self)));
    if (record.dataDirectory !== args.data || record.candidateContext?.rightsEvidenceSha256 !== record.rightsEvidenceSha256) throw failure();
    const plan = modules.prepareAlpacaCandidateModePlan(Buffer.from(JSON.stringify({
      schema: 'gelt.alpaca-iex-candidate-plan.v1', calendar, context: record.candidateContext,
      availabilityBasis: record.availabilityBasis, availabilityEvidenceSha256: record.availabilityEvidenceSha256,
    }), 'utf8'));
    // Hash references are externally reviewed assertions, never runtime rights attestation.
    // This does not acquire while only the public calendar proposal is available.
    (overrides.checkDataDirectory ?? directoryChain)(args.data, uid);
    const now = (overrides.now ?? (() => Date.now()))();
    if (!Number.isFinite(now) || Date.parse(calendar.sessions.at(-1).completedAt) > now) throw failure();
    await writeStatus(output, 'One bounded candidate capture requested. Unverified diagnostic only; no account, order, strategy or runner operation.');
    if (outputFailed) throw failure();
    // Exactly one helper read and one connector call; connector owns its three-page budget.
    let credentials = modules.readAlpacaKeyPair(args.data);
    let acquisition;
    try { attempted = true; acquisition = await modules.acquireAlpacaIexDailyBars({ enabled: true, symbol: 'SPY', feed: 'iex', adjustment: 'raw', start: fixedRequest.start, end: fixedRequest.end, asof: fixedRequest.asof, calendar }, credentials); }
    finally { credentials = undefined; }
    if (!modules.verifyAlpacaIexAcquisition(acquisition) || acquisition.observations.length !== 253 || acquisition.calendarSha256 !== calendar.sha256) throw failure();
    for (let i = 0; i < 253; i++) if (acquisition.observations[252 - i].providerTimestamp !== calendar.sessions[i].providerTimestamp) throw failure();
    const decisionAt = new Date((overrides.now ?? (() => Date.now()))()).toISOString();
    const summary = modules.completeAlpacaCandidateMode(acquisition, plan, decisionAt);
    const metadata = { symbol: 'SPY', feed: 'iex', timeframe: '1Day', adjustment: 'raw', requestSha256,
      calendarSha256: calendar.sha256, observations: acquisition.observations.length, pages: acquisition.pages.length, receivedAt: acquisition.receivedAt };
    acquisition = undefined;
    await writeStatus(output, JSON.stringify({ ...metadata, ...summary }));
    return outputFailed ? 1 : 0;
  } catch {
    try { await writeStatus(errorOutput, attempted ? 'Candidate unavailable. Stop; no automatic retry or fallback.' : 'Candidate preflight unavailable. No data request was started.'); } catch { /* No raw errors. */ }
    return 1;
  } finally {
    output.off('error', onOutputError); errorOutput.off('error', onOutputError);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === self) {
  // Standalone-only lifetime guards prevent late stream errors printing raw diagnostics.
  for (const stream of new Set([process.stdout, process.stderr])) stream.on('error', () => { process.exitCode = 1; });
  process.exitCode = await runAlpacaIexCandidateOnce();
}
