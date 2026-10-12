import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { helperStages as stages, storageOperations, nativeChecks, rememberStorageDiagnostic } from './storage-diagnostics.js';
// Fixed executable and reviewed packaged sources, not PATH, SystemRoot or input scripts.
// Supported installation: C:\Windows; launch from the trusted v2 checkout.
const executable = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
const hashes: Record<string, string> = {
  'prerequisite-probe.ps1': 'b3e47b49d5d54181af7b8f20e937134d2a4f667f04d6a3dbfe8bb322ceb19467',
  'private-storage.ps1': '28774f8e1d76e7cda78446643d5df122d616dd8aa1208e6738e3d24f0f2b57f3',
  'read-frame.ps1': 'df451d8538972c801b4ec49443cfc4cf436bd0431c5ea92ad493f027478bef3b',
  'PrivateStorage.cs': 'ff8a844ea4f7d1eb7567038e7e893659892b946c8d38b6d700ff523607b34e13',
};
export type WindowsOperation = typeof storageOperations[number];
const operations: readonly WindowsOperation[] = storageOperations;
export function helperRequest(op: WindowsOperation, path: string, data: Buffer = Buffer.alloc(0), max = 0) {
  if (!operations.includes(op) || typeof path !== 'string' || path.length > 220 || !Buffer.isBuffer(data) || data.length > 150000 || !Number.isInteger(max) || max < 0 || max > 150000) throw new Error('secure storage unavailable');
  if (['protect', 'unprotect'].includes(op) ? path !== '' || max !== 0 : !/^[A-Za-z]:\\/.test(path)) throw new Error('secure storage unavailable');
  return frameRequest(JSON.stringify({ version: 1, op, path, data: data.toString('base64'), max }));
}
// Length framing completes on an open stdin pipe; EOF is not part of the protocol.
export function frameRequest(json: string): Buffer {
  const payload = Buffer.from(json, 'utf8');
  if (!payload.length || payload.length > 220000) throw new Error('secure storage unavailable');
  const header = Buffer.alloc(4); header.writeUInt32BE(payload.length);
  return Buffer.concat([header, payload]);
}
export const completeDiagnostics = stages.join('\n') + '\n';
const prefix = (index: number) => stages.slice(0, index + 1).join('\n') + '\n';
export function helperStage(stderr: string, stdout = ''): string {
  // Exact contiguous stages; CLEANUP may follow any failing prefix, never skip a step.
  if (stderr.length > 1024 || stdout.length > 200004) return 'PROTOCOL';
  if (stdout.startsWith('FAIL:')) {
    const parts = stdout.split(':');
    const stage = parts[1], index = stages.indexOf(stage as typeof stages[number]);
    if (index < 0 || stage === 'DONE') return 'PROTOCOL';
    if (parts.length !== 2) return 'PROTOCOL'; // detailed failures parsed with operation below
    if (stage === 'CLEANUP') return stages.slice(0, -2).some((_, i) => stderr === prefix(i) + 'CLEANUP\n') ? stage : 'PROTOCOL';
    return stderr === prefix(index) + 'CLEANUP\n' ? stage : 'PROTOCOL';
  }
  if (stdout !== '') {
    if (stderr !== completeDiagnostics) return 'PROTOCOL';
    if (stdout === 'MISSING') return 'DONE';
    try { helperResponse(stdout, 'read'); return 'DONE'; } catch { return 'PROTOCOL'; }
  }
  if (stderr === '') return 'STARTUP';
  const index = stages.findIndex((_, i) => stderr === prefix(i));
  return index < 0 ? 'PROTOCOL' : stages[index];
}
// Diagnostics crossing into synthetic CI reports still use this closed vocabulary.
export function safeStorageStage(value: unknown): string {
  return typeof value === 'string' && (stages.includes(value as typeof stages[number]) || ['SOURCE', 'STARTUP', 'PROTOCOL'].includes(value)) ? value : 'PROTOCOL';
}
export function windowsHelperEnvironment(): NodeJS.ProcessEnv {
  // Explicit nonsecret root, never inherited OS temp, PATH, credentials or options.
  return { NODE_ENV: 'production', SystemRoot: 'C:\\Windows', WINDIR: 'C:\\Windows',
    PSModulePath: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\Modules',
    GELT_WINDOWS_PRIVATE_PARENT: process.env.GELT_WINDOWS_PRIVATE_PARENT };
}
export function verifyHelperSources() {
  const dir = resolve('worker/native');
  try {
    for (const [file, hash] of Object.entries(hashes)) if (createHash('sha256').update(readFileSync(resolve(dir, file))).digest('hex') !== hash) throw new Error();
    return dir;
  } catch { throw Object.assign(new Error('secure storage unavailable'), { storageStage: 'SOURCE' }); }
}
export function helperResponse(text: string, op: WindowsOperation): Buffer {
  if (text === 'MISSING' && op === 'read') throw Object.assign(new Error('private file missing'), { code: 'ENOENT' });
  if (text.length > 200004 || !/^OK:([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(text)) throw new Error('secure storage unavailable');
  const value = Buffer.from(text.slice(3), 'base64');
  if (value.toString('base64') !== text.slice(3)) throw new Error('secure storage unavailable');
  if (!['read', 'protect', 'unprotect'].includes(op) && value.length) throw new Error('secure storage unavailable');
  return value;
}
function transportError(op: WindowsOperation, stage = 'PROTOCOL', check = 'PROTOCOL', kind?: string): Error {
  const error = Object.assign(new Error('secure storage unavailable'), { storageStage: safeStorageStage(stage) });
  rememberStorageDiagnostic(error, { stage, operation: op, check, ...(kind ? { kind } : {}) });
  return error;
}
function compatibleFailure(op: WindowsOperation, check: string, kind?: string): boolean {
  if (!nativeChecks.includes(check as typeof nativeChecks[number])) return false;
  if (op === 'protect' || op === 'unprotect') return kind === undefined && ['REQUEST', 'DPAPI', 'INTERNAL'].includes(check);
  if (check === 'DPAPI') return false;
  if (kind === 'parent' && ['CREATE', 'READ', 'WRITE', 'FLUSH', 'MOVE', 'DELETE'].includes(check)) return false;
  if (kind !== undefined && kind !== 'parent' && !(['sqlite-set', 'sqlite-file'].includes(op) && ['main', 'wal', 'shm', 'journal'].includes(kind))) return false;
  if (['CREATE', 'WRITE', 'FLUSH'].includes(check) && !['new', 'replace', ...(check === 'CREATE' ? ['mkdir', 'sqlite-mkdir'] : [])].includes(op)) return false;
  if (check === 'MOVE' && op !== 'replace' || check === 'DELETE' && op !== 'remove' || check === 'READ' && !['read', 'remove', 'replace'].includes(op)) return false;
  if (['sqlite-set', 'sqlite-file'].includes(op) && kind === undefined && !['REQUEST', 'PATH', 'FILESYSTEM', 'INTERNAL'].includes(check)) return false;
  return true;
}
// Testable transport seam. No raw output or exception is retained on failure.
export function helperTransport(result: { status: number | null; stdout: string; stderr: string; error?: unknown; signal?: unknown }, op: WindowsOperation): Buffer {
  const fail = () => transportError(op);
  if (!operations.includes(op) || result.error || result.signal || typeof result.stdout !== 'string' || typeof result.stderr !== 'string' || result.stdout.length > 200004 || result.stderr.length > 1024) throw fail();
  if (result.status === 0 && result.stderr === completeDiagnostics) {
    try { return helperResponse(result.stdout, op); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        rememberStorageDiagnostic(error as Error, { stage: 'OPERATION', operation: op, check: 'OPEN' });
        throw error;
      }
      throw fail();
    }
  }
  if (result.status !== 1 || !result.stdout.startsWith('FAIL:') || result.stdout.length > 80) throw fail();
  const parts = result.stdout.split(':');
  if (parts.length === 2) {
    const stage = helperStage(result.stderr, result.stdout);
    if (stage !== 'PROTOCOL') throw transportError(op, stage, 'STAGE');
  } else if ((parts.length === 3 || parts.length === 4) && parts[1] === 'OPERATION' &&
      result.stderr === prefix(stages.indexOf('OPERATION')) + 'CLEANUP\n' &&
      compatibleFailure(op, parts[2], parts[3])) {
    throw transportError(op, 'OPERATION', parts[2], parts[3]);
  }
  throw fail();
}
export function windowsStorage(op: WindowsOperation, path: string, data: Buffer = Buffer.alloc(0), max = 0): Buffer {
  const input = helperRequest(op, path, data, max);
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('secure storage unavailable');
  let dir: string;
  try { dir = verifyHelperSources(); } catch { throw transportError(op, 'SOURCE', 'STAGE'); }
  let result;
  try {
    result = spawnSync(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', resolve(dir, 'private-storage.ps1')], {
      input, encoding: 'utf8', timeout: 15000, maxBuffer: 220000, windowsHide: true,
      env: windowsHelperEnvironment(), stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch { throw transportError(op, 'STARTUP', 'STAGE'); }
  return helperTransport(result, op);
}
export function protectKey(key: Buffer): Buffer {
  if (process.platform !== 'win32') return key;
  return Buffer.from(JSON.stringify({ version: 1, protection: 'DPAPI-CurrentUser', data: windowsStorage('protect', '', key).toString('base64') }));
}
export function unprotectKey(bytes: Buffer): Buffer {
  if (process.platform !== 'win32') return bytes;
  try {
    const value = JSON.parse(bytes.toString('utf8'));
    if (Object.keys(value).sort().join(',') !== 'data,protection,version' || value.version !== 1 || value.protection !== 'DPAPI-CurrentUser' || typeof value.data !== 'string' || value.data.length > 12000 || Buffer.from(value.data, 'base64').toString('base64') !== value.data) throw new Error();
    const key = windowsStorage('unprotect', '', Buffer.from(value.data, 'base64'));
    if (key.length !== 32) throw new Error(); return key;
  } catch { throw new Error('secure key unavailable'); }
}
