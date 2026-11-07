// Offline evidence retention only. No provider, decision or lifecycle entry.
import * as fs from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { canonical, digest } from './ledger-canonical.js';
import { LedgerStorage } from './ledger-storage.js';
import { privateDirectory, writePrivateNew } from './private-files.js';
import { assessA64InspectionEvidence } from './pamr-a64-inspection-evidence.js';
import {
  type A64InspectionEvidenceAssessmentV1,
} from './pamr-a64-inspection-evidence-contract.js';
import {
  a64ReceiptBindingSchema, a64ReceiptDisclosure, a64ReceiptHash,
  a64ReceiptLimits, a64ReceiptSchema, parseA64Receipt,
  A64EvidenceReceiptError, type A64ReceiptBinding, type A64EvidenceReceipt,
} from './a64-evidence-receipt-contract.js';

const filename = 'a64-evidence-receipt.sqlite';
const pendingName = 'a64-evidence-receipt.pending';
const schema = [
  'CREATE TABLE binding (id INTEGER PRIMARY KEY CHECK(id=1), body TEXT NOT NULL) STRICT',
  'CREATE TABLE receipt (id INTEGER PRIMARY KEY CHECK(id=1), input TEXT NOT NULL, assessment TEXT NOT NULL, body TEXT NOT NULL) STRICT',
];
type Identity = { dev: number; ino: number };
function identity(path: string): Identity { return fs.lstatSync(path); }
function same(a: Identity, b: Identity): boolean { return a.dev === b.dev && a.ino === b.ino; }
function byteHash(value: Buffer): string { return createHash('sha256').update(value).digest('hex'); }
function absent(path: string): boolean {
  try { fs.lstatSync(path); return false; }
  catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return true; throw e; }
}
function regularDescriptor(path: string): number {
  const before = fs.lstatSync(path);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1
    || before.uid !== process.getuid!() || (before.mode & 0o777) !== 0o600) throw new Error();
  // NONBLOCK also covers replacement by a FIFO between lstat and open.
  const fd = fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK | fs.constants.O_NOFOLLOW);
  try {
    const current = fs.fstatSync(fd);
    if (!current.isFile() || current.nlink !== 1 || current.uid !== before.uid || current.mode !== before.mode
      || !same(current, before) || !same(current, identity(path))) throw new Error();
    return fd;
  } catch (error) { fs.closeSync(fd); throw error; }
}
function regularFile(path: string): void { fs.closeSync(regularDescriptor(path)); }
function binding(raw: unknown): A64ReceiptBinding {
  try { return a64ReceiptBindingSchema.parse(raw); }
  catch { throw new A64EvidenceReceiptError('invalid_input'); }
}
function snapshot(root: string, allowLock: boolean): void {
  if (process.platform !== 'linux' || root !== resolve(root)) throw new Error();
  privateDirectory(root);
  if (![0xef53, 0x58465342, 0x9123683e, 0x794c7630].includes(fs.statfsSync(root).type)) throw new Error();
  const allowed = new Set([filename,
    ...(allowLock ? [filename + '-wal', filename + '-shm', filename + '-journal', filename + '.lock', pendingName] : [])]);
  let bytes = 0, count = 0;
  const directory = fs.opendirSync(root);
  try {
    for (let entry = directory.readSync(); entry; entry = directory.readSync()) {
      if (++count > allowed.size || !allowed.has(entry.name)) throw new Error();
      const path = join(root, entry.name);
      regularFile(path);
      bytes += fs.lstatSync(path).size;
      if (bytes > a64ReceiptLimits.store) throw new Error();
    }
  } finally { directory.closeSync(); }
}
function databaseSnapshot(path: string): Buffer {
  const fd = regularDescriptor(path);
  try {
    const before = fs.fstatSync(fd);
    if (before.size > a64ReceiptLimits.store) throw new Error();
    const data = Buffer.alloc(before.size + 1);
    let n = 0;
    while (n < data.length) {
      const count = fs.readSync(fd, data, n, data.length - n, n);
      if (!count) break;
      n += count;
    }
    const after = fs.fstatSync(fd);
    if (n !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs
      || after.nlink !== 1 || !same(before, after)) throw new Error();
    return data.subarray(0, n);
  } finally { fs.closeSync(fd); }
}
function checkedInput(text: unknown, owner: A64ReceiptBinding) {
  const result = assessA64InspectionEvidence(text);
  if (result.status !== 'assessed_data' || result.value.bindings.caseEpochSha256 !== owner.caseEpochSha256) {
    throw new A64EvidenceReceiptError('invalid_input');
  }
  // The unchanged assessor already enforces complete input, parser and replay bounds.
  const input = text as string;
  const assessment = canonical(result.value);
  const body = {
    schema: 'gelt.a64-evidence-retention-receipt.v1', binding: owner,
    inputBytes: Buffer.byteLength(input), rawInputSha256: digest(input),
    assessmentSha256: result.value.assessmentSha256,
    artifactSha256: result.value.bindings.artifactSha256,
    contextSha256: result.value.contextSha256,
    ...a64ReceiptDisclosure,
  };
  const receipt = a64ReceiptSchema.parse({ ...body, receiptSha256: a64ReceiptHash(body) });
  if (Buffer.byteLength(assessment) > a64ReceiptLimits.assessment
    || Buffer.byteLength(canonical(receipt)) > a64ReceiptLimits.receipt) throw new A64EvidenceReceiptError('invalid_input');
  return { input, assessment, receipt, value: result.value };
}

/** One pre-existing private directory is one owner-bound case/epoch namespace.
 * Never reopen it as a writer, reclaim locks or create another storage allowance.
 * Caller-owned directory/namespace selection is trusted, not authenticated by data.
 */
export class A64EvidenceReceiptStore {
  private storage?: LedgerStorage;
  private db!: Database.Database;
  private closed = false;
  private poisoned = false;
  private readonly rootIdentity: Identity;
  private fileIdentity!: Identity;
  private checkpointSha256?: string;
  private readonly owner: A64ReceiptBinding;
  private readonly path: string;

  private constructor(private readonly root: string, rawBinding: unknown, readonly readonlyReopen: boolean) {
    this.owner = binding(rawBinding);
    this.path = join(root, filename);
    try {
      snapshot(root, !readonlyReopen);
      this.rootIdentity = identity(root);
      if (readonlyReopen) {
        // No LedgerStorage constructor on reopen: no lock/schema/checkpoint writes.
        if (!absent(this.path + '.lock')) throw new Error();
        regularFile(this.path);
        this.fileIdentity = identity(this.path);
        // Deserialize the clean checkpoint into memory. Opening a WAL-mode file
        // even with SQLite readonly can create sidecars; this route never does.
        const checkpoint = databaseSnapshot(this.path);
        this.checkpointSha256 = byteHash(checkpoint);
        // SQLite's documented deserialize workaround for a checkpointed WAL
        // image: alter ONLY the in-memory format bytes, never the stored file.
        // https://www.sqlite.org/c3ref/deserialize.html
        if (checkpoint.length < 100 || checkpoint.subarray(0, 16).toString() !== 'SQLite format 3\0'
          || checkpoint[18] !== 2 || checkpoint[19] !== 2) throw new Error();
        const memory = Buffer.from(checkpoint);
        memory[18] = 1; memory[19] = 1;
        this.db = new Database(memory);
        this.db.pragma('query_only = ON');
        this.db.pragma('trusted_schema = OFF');
        this.read();
      } else {
        // Only a genuinely empty, private namespace can be initialized.
        if (!absent(this.path) || fs.readdirSync(root).length !== 0) throw new Error();
        this.storage = new LedgerStorage(this.path);
        this.db = this.storage.db;
        this.fileIdentity = identity(this.path);
        // Independent, durably-created close fence. LedgerStorage may unlink
        // its own lock before a directory-sync error; it never removes this one.
        writePrivateNew(join(this.root, pendingName), canonical(this.owner));
        // One input <=256KiB plus bounded evidence: this database cannot grow
        // into an additional 8MiB allocation, even through SQLite page growth.
        if (this.db.pragma('page_size', { simple: true }) !== 4096) throw new Error();
        this.db.pragma('max_page_count = 128');
        this.db.transaction(() => {
          for (const statement of schema) this.db.exec(statement);
          this.db.prepare('INSERT INTO binding VALUES (1, ?)').run(canonical(this.owner));
        })();
        this.validate();
      }
    } catch {
      this.poisoned = true;
      if (this.storage) { this.storage.poisoned = true; try { this.storage.close(); } catch {} }
      else { try { this.db?.close(); } catch {} }
      throw new A64EvidenceReceiptError('unavailable');
    }
  }
  static create(root: string, owner: unknown): A64EvidenceReceiptStore {
    return new A64EvidenceReceiptStore(root, owner, false);
  }
  static reopen(root: string, owner: unknown): A64EvidenceReceiptStore {
    return new A64EvidenceReceiptStore(root, owner, true);
  }
  private validate(): void {
    if (this.closed || this.poisoned) throw new Error();
    snapshot(this.root, !this.readonlyReopen);
    if (!same(identity(this.root), this.rootIdentity) || !same(identity(this.path), this.fileIdentity)) throw new Error();
    this.storage?.validate();
    if (!this.readonlyReopen) {
      const guard = databaseSnapshot(join(this.root, pendingName));
      if (guard.toString('utf8') !== canonical(this.owner)) throw new Error();
    }
    if (this.readonlyReopen && !absent(this.path + '.lock')) throw new Error();
    if (this.readonlyReopen && byteHash(databaseSnapshot(this.path)) !== this.checkpointSha256) throw new Error();
    const actualSchema = this.db.prepare('SELECT sql FROM sqlite_master ORDER BY name').all() as {sql: string}[];
    if (canonical(actualSchema.map(r => r.sql)) !== canonical(schema)) throw new Error();
    const rows = this.db.prepare('SELECT id, length(CAST(body AS BLOB)) AS bytes FROM binding').all() as {id:number;bytes:number}[];
    if (rows.length !== 1 || rows[0].id !== 1 || rows[0].bytes > a64ReceiptLimits.receipt) throw new Error();
    const row = this.db.prepare('SELECT body FROM binding WHERE id=1').get() as {body:string};
    if (row.body !== canonical(this.owner)) throw new Error();
  }
  private failed(): never {
    this.poisoned = true;
    if (this.storage) this.storage.poisoned = true;
    throw new A64EvidenceReceiptError('uncertain');
  }
  retain(text: unknown): A64EvidenceReceipt {
    if (this.readonlyReopen) throw new A64EvidenceReceiptError('readonly');
    const data = checkedInput(text, this.owner); // rejection before storage mutation
    try {
      this.validate();
      if ((this.db.prepare('SELECT count(*) AS n FROM receipt').get() as {n:number}).n !== 0) {
        // Inspect the original first; corruption must not look like a harmless duplicate.
        this.read();
        throw new A64EvidenceReceiptError('already_retained');
      }
      this.db.transaction(() => {
        this.db.prepare('INSERT INTO receipt VALUES (1, ?, ?, ?)')
          .run(data.input, data.assessment, canonical(data.receipt));
      })();
      this.validate();
      return this.read().receipt;
    } catch (e) {
      if (e instanceof A64EvidenceReceiptError && e.reason === 'already_retained') throw e;
      return this.failed();
    }
  }
  read(): { receipt: A64EvidenceReceipt; assessment: A64InspectionEvidenceAssessmentV1 } {
    try {
      this.validate();
      const lengths = this.db.prepare('SELECT id, length(CAST(input AS BLOB)) AS i, length(CAST(assessment AS BLOB)) AS a, length(CAST(body AS BLOB)) AS b FROM receipt').all() as {id:number;i:number;a:number;b:number}[];
      if (lengths.length !== 1 || lengths[0].id !== 1 || lengths[0].i > a64ReceiptLimits.input
        || lengths[0].a > a64ReceiptLimits.assessment || lengths[0].b > a64ReceiptLimits.receipt) throw new Error();
      const row = this.db.prepare('SELECT input, assessment, body FROM receipt WHERE id=1').get() as {input:string;assessment:string;body:string};
      const data = checkedInput(row.input, this.owner), receipt = parseA64Receipt(row.body);
      if (canonical(receipt) !== row.body || canonical(data.receipt) !== row.body || data.assessment !== row.assessment) throw new Error();
      this.validate();
      return { receipt, assessment: data.value };
    } catch { return this.failed(); }
  }
  close(): void {
    if (this.closed) return;
    try {
      this.read(); // Empty, damaged or uncertain writers retain their existing lock.
      if (this.storage) this.storage.close(); else this.db.close();
      if (this.storage) {
        // Last fallible operation. Unlike removePrivate, this does not unlink
        // and THEN perform a sync that could turn absence into an uncertain close.
        // No fallible work follows successful unlink. A crash may restore this
        // un-synced fence (conservative rejection), never authorize repair/retry.
        fs.unlinkSync(join(this.root, pendingName));
      }
      this.closed = true;
    } catch {
      this.poisoned = true;
      if (this.storage) { this.storage.poisoned = true; try { this.storage.close(); } catch {} }
      else { try { this.db.close(); } catch {} }
      this.closed = true;
      throw new A64EvidenceReceiptError('uncertain');
    }
  }
}
