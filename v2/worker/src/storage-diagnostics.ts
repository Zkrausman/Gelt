// Internal synthetic-test evidence only. Never serialize through public APIs or logs.
export const helperStages = ['START', 'FRAME', 'FRAME_PATH', 'FRAME_PATH_DONE', 'FRAME_SOURCE', 'FRAME_SOURCE_DONE', 'FRAME_ENTER', 'FRAME_STDIN', 'FRAME_STDIN_DONE', 'FRAME_ALLOC', 'FRAME_ALLOC_DONE', 'FRAME_HEADER', 'FRAME_HEADER_DONE', 'FRAME_PAYLOAD', 'FRAME_PAYLOAD_DONE', 'FRAME_UTF8', 'MODULE', 'MODULE_DONE', 'FRAME_JSON', 'FRAME_SCHEMA', 'ROOT', 'COMPILE', 'OPERATION', 'CLEANUP', 'DONE'] as const;
export const storageOperations = ['sqlite-set', 'sqlite-file', 'sqlite-mkdir', 'directory', 'mkdir', 'read', 'new', 'replace', 'remove', 'protect', 'unprotect'] as const;
export const nativeChecks = ['REQUEST', 'PATH', 'OPEN', 'CREATE', 'METADATA', 'TYPE', 'REPARSE', 'LINKS', 'SIZE', 'CANONICAL', 'FILESYSTEM', 'SECURITY', 'OWNER', 'DACL', 'ACCESS', 'READ', 'WRITE', 'FLUSH', 'MOVE', 'DELETE', 'DPAPI', 'INTERNAL'] as const;
export const storageKinds = ['parent', 'main', 'wal', 'shm', 'journal', 'marker', 'identity'] as const;
export type StorageKind = typeof storageKinds[number];
type Diagnostic = Readonly<{ stage: string; operation: string; check: string; kind?: StorageKind }>;
const protocol: Diagnostic = Object.freeze({ stage: 'PROTOCOL', operation: 'unknown', check: 'PROTOCOL' });
const includes = (values: readonly string[], value: unknown): value is string => typeof value === 'string' && values.includes(value);
export function sanitizeStorageDiagnostic(value: unknown): Diagnostic {
  try {
    if (!value || typeof value !== 'object') return protocol;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(value).sort();
    if (keys.join(',') !== 'check,operation,stage' && keys.join(',') !== 'check,kind,operation,stage') return protocol;
    if (Object.values(descriptors).some(d => !('value' in d))) return protocol;
    const { stage, operation, check, kind } = Object.fromEntries(Object.entries(descriptors).map(([k, d]) => [k, d.value]));
    if (!includes([...helperStages, 'SOURCE', 'STARTUP', 'PROTOCOL', 'LEDGER'], stage) ||
        !includes([...storageOperations, 'validate', 'unknown'], operation) ||
        !includes([...nativeChecks, 'PROTOCOL', 'STAGE', 'IDENTITY', 'MARKER'], check) ||
        ('kind' in descriptors && !includes(storageKinds, kind))) return protocol;
    return Object.freeze({ stage, operation, check, ...(kind === undefined ? {} : { kind: kind as StorageKind }) });
  } catch { return protocol; }
}
// Weak evidence avoids adding diagnostic fields to ordinary errors/results/ledger JSON.
const evidence = new WeakMap<object, Diagnostic>();
export function rememberStorageDiagnostic(target: object, value: unknown) { evidence.set(target, sanitizeStorageDiagnostic(value)); }
export function clearStorageDiagnostic(target: object) { evidence.delete(target); }
export function storageDiagnosticForTest(target: unknown): Diagnostic {
  return sanitizeStorageDiagnostic(target !== null && typeof target === 'object' ? evidence.get(target) : undefined);
}
export function formatStorageDiagnosticForTest(target: unknown): string {
  const d = storageDiagnosticForTest(target);
  return [d.stage, d.operation, d.check, ...(d.kind ? [d.kind] : [])].join(':');
}
export function ledgerStorageError(error: unknown, kind?: StorageKind): Error {
  const known = error !== null && typeof error === 'object' ? evidence.get(error) : undefined;
  const d = known ?? { stage: 'LEDGER', operation: 'validate', check: 'INTERNAL' };
  const result = new Error('ledger unavailable');
  rememberStorageDiagnostic(result, { ...d, ...(d.kind ? {} : kind ? { kind } : {}) });
  return result;
}
export function storageBoundary<T>(kind: StorageKind, body: () => T): T {
  try { return body(); } catch (error) { throw ledgerStorageError(error, kind); }
}
export function storageInvariant(check: 'IDENTITY' | 'MARKER', kind: StorageKind): never {
  const error = new Error('ledger unavailable');
  rememberStorageDiagnostic(error, { stage: 'LEDGER', operation: 'validate', check, kind });
  throw error;
}
