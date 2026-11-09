// Sibling observed-data evidence codec, never a v1 store migration.
import * as fs from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import Database from 'better-sqlite3';
import { canonical } from './ledger-canonical.js';
import { LedgerStorage } from './ledger-storage.js';
import { privateDirectory, writePrivateNew } from './private-files.js';
import { assessObservedEvidence, type ObservedAssessment } from './a64-observed-snapshot-evidence.js';
import { observedBindingSchema, observedDigestSchema, observedLimits, observedHash, observedCaseEpoch, observedNegativeSchema, observedRejectionReasonSchema, parseObservedText, ObservedSnapshotError, type ObservedBinding, type ObservedReason } from './alpaca-observed-snapshot-contract.js';
const receiptBody = z.object({
    schema: z.literal('gelt.a64-observed-evidence-receipt.v2'), binding: observedBindingSchema, profileSha256: observedDigestSchema,
    status: z.enum(['assessed_data', 'rejected']), reason: observedRejectionReasonSchema.nullable(),
    fullEvidenceRetained: z.boolean(), historyUpdates: z.union([z.literal(64), z.literal(0)]),
    inputBytes: z.number().int().positive().max(observedLimits.input), rawInputSha256: observedDigestSchema,
    assessmentSha256: observedDigestSchema.nullable(), artifactSha256: observedDigestSchema.nullable(), contextSha256: observedDigestSchema.nullable(),
    receiptSequence: z.literal(1), previousReceiptSha256: z.null(), purpose: z.literal('evidence_retention_only'),
    persistence: z.literal('evidence_record_only'), consumptionAttempts: z.literal(0), operationalDecisions: z.literal(0),
    rejectionMeaning: z.literal('locally_reported_not_recomputed_source_failure').nullable(),
    completion: z.literal('unknown'), vintage: z.literal('unknown'), authenticity: z.literal('not_established'), runtimeQualification: z.literal('not_established'),
    dispatchAllowed: z.literal(false), promotionAllowed: z.literal(false), qualification: z.literal('NOT_READY'), production: z.literal('CLOSED'), operations: z.literal('DEFER'),
}).strict();
const receiptSchema = receiptBody.extend({ receiptSha256: observedDigestSchema }).strict().refine(({ receiptSha256, ...body }) => {
    const positive = body.status === 'assessed_data';
    return receiptSha256 === observedHash('receipt', body) && body.fullEvidenceRetained === positive
        && body.historyUpdates === (positive ? 64 : 0) && (positive ? body.reason === null && body.rejectionMeaning === null
        && body.assessmentSha256 !== null && body.artifactSha256 !== null && body.contextSha256 !== null
        : body.reason !== null && body.rejectionMeaning !== null && body.assessmentSha256 === null && body.artifactSha256 === null && body.contextSha256 === null);
});
export type ObservedReceipt = z.infer<typeof receiptSchema>;
const filename = 'a64-observed-evidence.sqlite';
const checkpointPageSize = 4096, checkpointPageCeiling = 128;
const checkpointByteLimit = checkpointPageSize * checkpointPageCeiling;
const pendingName = 'a64-observed-evidence.pending';
const schema = [
    'CREATE TABLE binding (id INTEGER PRIMARY KEY CHECK(id=1), body TEXT NOT NULL) STRICT',
    'CREATE TABLE receipt (id INTEGER PRIMARY KEY CHECK(id=1), input TEXT NOT NULL, assessment TEXT NOT NULL, body TEXT NOT NULL) STRICT',
];
type Identity = {
    dev: number;
    ino: number;
};
function identity(path: string): Identity { return fs.lstatSync(path); }
function same(a: Identity, b: Identity): boolean { return a.dev === b.dev && a.ino === b.ino; }
function byteHash(value: Buffer): string { return createHash('sha256').update(value).digest('hex'); }
function absent(path: string): boolean {
    try {
        fs.lstatSync(path);
        return false;
    }
    catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT')
            return true;
        throw e;
    }
}
function regularDescriptor(path: string): number {
    const before = fs.lstatSync(path);
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1
        || before.uid !== process.getuid!() || (before.mode & 0o777) !== 0o600)
        throw new Error();
    // NONBLOCK also covers replacement by a FIFO between lstat and open.
    const fd = fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK | fs.constants.O_NOFOLLOW);
    try {
        const current = fs.fstatSync(fd);
        if (!current.isFile() || current.nlink !== 1 || current.uid !== before.uid || current.mode !== before.mode
            || !same(current, before) || !same(current, identity(path)))
            throw new Error();
        return fd;
    }
    catch (error) {
        fs.closeSync(fd);
        throw error;
    }
}
function regularFile(path: string): void { fs.closeSync(regularDescriptor(path)); }
function binding(raw: unknown): ObservedBinding {
    try {
        return observedBindingSchema.parse(raw);
    }
    catch {
        throw new ObservedSnapshotError('invalid_input');
    }
}
function snapshot(root: string, allowLock: boolean): void {
    if (process.platform !== 'linux' || root !== resolve(root))
        throw new Error();
    privateDirectory(root);
    if (![0xef53, 0x58465342, 0x9123683e, 0x794c7630].includes(fs.statfsSync(root).type))
        throw new Error();
    const allowed = new Set([filename,
        ...(allowLock ? [filename + '-wal', filename + '-shm', filename + '-journal', filename + '.lock', pendingName] : [])]);
    let bytes = 0, count = 0;
    const directory = fs.opendirSync(root);
    try {
        for (let entry = directory.readSync(); entry; entry = directory.readSync()) {
            if (++count > allowed.size || !allowed.has(entry.name))
                throw new Error();
            const path = join(root, entry.name);
            regularFile(path);
            const size = fs.lstatSync(path).size;
            if (entry.name === filename && size > checkpointByteLimit)
                throw new Error();
            bytes += size;
            if (bytes > observedLimits.store)
                throw new Error();
        }
    }
    finally {
        directory.closeSync();
    }
}
function databaseSnapshot(path: string, limit = checkpointByteLimit): Buffer {
    const fd = regularDescriptor(path);
    try {
        const before = fs.fstatSync(fd);
        if (before.size > limit)
            throw new Error();
        const data = Buffer.alloc(before.size + 1);
        let n = 0;
        while (n < data.length) {
            const count = fs.readSync(fd, data, n, data.length - n, n);
            if (!count)
                break;
            n += count;
        }
        const after = fs.fstatSync(fd);
        if (n !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs
            || after.nlink !== 1 || !same(before, after))
            throw new Error();
        return data.subarray(0, n);
    }
    finally {
        fs.closeSync(fd);
    }
}
function checkedInput(text: unknown, owner: ObservedBinding) {
    try {
        return checkedDecodedInput(text, owner);
    }
    catch (e) {
        if (e instanceof ObservedSnapshotError)
            throw e;
        throw new ObservedSnapshotError('invalid_input');
    }
}
function checkedDecodedInput(text: unknown, owner: ObservedBinding) {
    const raw = parseObservedText(text, observedLimits.input);
    let assessment: ObservedAssessment | null = null;
    let profileSha256: string, status: 'assessed_data' | 'rejected', reason: ObservedReason | null = null;
    if (raw && typeof raw === 'object' && 'schema' in raw && raw.schema === 'gelt.a64-observed-rejection.v2') {
        const negative = observedNegativeSchema.parse(raw);
        if (canonical(negative.binding) !== canonical(owner) || owner.caseEpochSha256 !== observedCaseEpoch(negative.profile))
            throw new ObservedSnapshotError('invalid_input');
        profileSha256 = negative.profile.profileSha256;
        status = 'rejected';
        reason = negative.reason;
    }
    else {
        const result = assessObservedEvidence(text);
        if (result.status !== 'assessed_data' || canonical(result.value.binding) !== canonical(owner))
            throw new ObservedSnapshotError('invalid_input');
        assessment = result.value;
        profileSha256 = assessment.profileSha256;
        status = 'assessed_data';
    }
    const input = text as string;
    const body = { schema: 'gelt.a64-observed-evidence-receipt.v2', binding: owner, profileSha256,
        status, reason, fullEvidenceRetained: status === 'assessed_data', historyUpdates: status === 'assessed_data' ? 64 : 0,
        inputBytes: Buffer.byteLength(input), rawInputSha256: observedHash('retained-text', input),
        assessmentSha256: assessment?.assessmentSha256 ?? null, artifactSha256: assessment?.artifactSha256 ?? null,
        contextSha256: assessment?.contextSha256 ?? null, receiptSequence: 1, previousReceiptSha256: null,
        purpose: 'evidence_retention_only', persistence: 'evidence_record_only', consumptionAttempts: 0, operationalDecisions: 0,
        rejectionMeaning: status === 'rejected' ? 'locally_reported_not_recomputed_source_failure' : null,
        completion: 'unknown', vintage: 'unknown', authenticity: 'not_established', runtimeQualification: 'not_established',
        dispatchAllowed: false, promotionAllowed: false, qualification: 'NOT_READY', production: 'CLOSED', operations: 'DEFER' };
    const receipt = receiptSchema.parse({ ...body, receiptSha256: observedHash('receipt', body) });
    const assessmentText = canonical(assessment);
    parseObservedText(assessmentText, observedLimits.assessment);
    parseObservedText(canonical(receipt), observedLimits.receipt);
    return { input, assessment: assessmentText, receipt, value: assessment };
}
/** One pre-existing private directory is one owner-bound case/epoch namespace.
 * Never reopen it as a writer, reclaim locks or create another storage allowance.
 * Caller-owned directory/namespace selection is trusted, not authenticated by data.
 */
export class A64ObservedSnapshotReceiptStore {
    private storage?: LedgerStorage;
    private db!: Database.Database;
    private closed = false;
    private poisoned = false;
    private readonly rootIdentity: Identity;
    private fileIdentity!: Identity;
    private checkpointSha256?: string;
    private readonly owner: ObservedBinding;
    private readonly path: string;
    private constructor(private readonly root: string, rawBinding: unknown, readonly readonlyReopen: boolean) {
        this.owner = binding(rawBinding);
        this.path = join(root, filename);
        try {
            snapshot(root, !readonlyReopen);
            this.rootIdentity = identity(root);
            if (readonlyReopen) {
                // No LedgerStorage constructor on reopen: no lock/schema/checkpoint writes.
                if (!absent(this.path + '.lock'))
                    throw new Error();
                regularFile(this.path);
                this.fileIdentity = identity(this.path);
                // Deserialize the clean checkpoint into memory. Opening a WAL-mode file
                // even with SQLite readonly can create sidecars; this route never does.
                const checkpoint = databaseSnapshot(this.path);
                this.checkpointSha256 = byteHash(checkpoint);
                // SQLite's documented deserialize workaround for a checkpointed WAL
                // image: alter ONLY the in-memory format bytes, never the stored file.
                // https://www.sqlite.org/c3ref/deserialize.html
                if (checkpoint.length < checkpointPageSize || checkpoint.length > checkpointByteLimit
                    || checkpoint.length % checkpointPageSize !== 0
                    || checkpoint.readUInt16BE(16) !== checkpointPageSize
                    || checkpoint.readUInt32BE(28) < 1 || checkpoint.readUInt32BE(28) > checkpointPageCeiling
                    || checkpoint.readUInt32BE(28) !== checkpoint.length / checkpointPageSize
                    || checkpoint.subarray(0, 16).toString() !== 'SQLite format 3\0'
                    || checkpoint[18] !== 2 || checkpoint[19] !== 2)
                    throw new Error();
                const memory = Buffer.from(checkpoint);
                memory[18] = 1;
                memory[19] = 1;
                this.db = new Database(memory);
                this.db.pragma('query_only = ON');
                this.db.pragma('trusted_schema = OFF');
                this.read();
            }
            else {
                // Only a genuinely empty, private namespace can be initialized.
                if (!absent(this.path) || fs.readdirSync(root).length !== 0)
                    throw new Error();
                this.storage = new LedgerStorage(this.path, { nonblockingValidation: true });
                this.db = this.storage.db;
                this.fileIdentity = identity(this.path);
                // Independent, durably-created close fence. LedgerStorage may unlink
                // its own lock before a directory-sync error; it never removes this one.
                writePrivateNew(join(this.root, pendingName), canonical(this.owner), true);
                // One input <=256KiB plus bounded evidence: this database cannot grow
                // into an additional 8MiB allocation, even through SQLite page growth.
                if (this.db.pragma('page_size', { simple: true }) !== checkpointPageSize)
                    throw new Error();
                this.db.pragma('max_page_count = ' + checkpointPageCeiling);
                this.db.transaction(() => {
                    for (const statement of schema)
                        this.db.exec(statement);
                    this.db.prepare('INSERT INTO binding VALUES (1, ?)').run(canonical(this.owner));
                })();
                this.validate();
            }
        }
        catch {
            this.poisoned = true;
            if (this.storage) {
                this.storage.poisoned = true;
                try {
                    this.storage.close();
                }
                catch { }
            }
            else {
                try {
                    this.db?.close();
                }
                catch { }
            }
            throw new ObservedSnapshotError('unavailable');
        }
    }
    static create(root: string, owner: unknown): A64ObservedSnapshotReceiptStore {
        return new A64ObservedSnapshotReceiptStore(root, owner, false);
    }
    static reopen(root: string, owner: unknown): A64ObservedSnapshotReceiptStore {
        return new A64ObservedSnapshotReceiptStore(root, owner, true);
    }
    private validate(): void {
        if (this.closed || this.poisoned)
            throw new Error();
        snapshot(this.root, !this.readonlyReopen);
        if (!same(identity(this.root), this.rootIdentity) || !same(identity(this.path), this.fileIdentity))
            throw new Error();
        this.storage?.validate();
        if (!this.readonlyReopen) {
            const guard = databaseSnapshot(join(this.root, pendingName), observedLimits.receipt);
            if (guard.toString('utf8') !== canonical(this.owner))
                throw new Error();
        }
        if (this.readonlyReopen && !absent(this.path + '.lock'))
            throw new Error();
        if (this.readonlyReopen && byteHash(databaseSnapshot(this.path)) !== this.checkpointSha256)
            throw new Error();
        const actualSchema = this.db.prepare('SELECT sql FROM sqlite_master ORDER BY name').all() as {
            sql: string;
        }[];
        if (canonical(actualSchema.map(r => r.sql)) !== canonical(schema))
            throw new Error();
        const rows = this.db.prepare('SELECT id, length(CAST(body AS BLOB)) AS bytes FROM binding').all() as {
            id: number;
            bytes: number;
        }[];
        if (rows.length !== 1 || rows[0].id !== 1 || rows[0].bytes > observedLimits.receipt)
            throw new Error();
        const row = this.db.prepare('SELECT body FROM binding WHERE id=1').get() as {
            body: string;
        };
        if (row.body !== canonical(this.owner))
            throw new Error();
    }
    private failed(): never {
        this.poisoned = true;
        if (this.storage)
            this.storage.poisoned = true;
        throw new ObservedSnapshotError('uncertain');
    }
    retain(text: unknown): ObservedReceipt {
        if (this.readonlyReopen)
            throw new ObservedSnapshotError('readonly');
        const data = checkedInput(text, this.owner); // rejection before storage mutation
        try {
            this.validate();
            if ((this.db.prepare('SELECT count(*) AS n FROM receipt').get() as {
                n: number;
            }).n !== 0) {
                // Inspect the original first; corruption must not look like a harmless duplicate.
                this.read();
                throw new ObservedSnapshotError('already_retained');
            }
            this.db.transaction(() => {
                this.db.prepare('INSERT INTO receipt VALUES (1, ?, ?, ?)')
                    .run(data.input, data.assessment, canonical(data.receipt));
            })();
            this.validate();
            return this.read().receipt;
        }
        catch (e) {
            if (e instanceof ObservedSnapshotError && e.reason === 'already_retained')
                throw e;
            return this.failed();
        }
    }
    read(): {
        input: string;
        receipt: ObservedReceipt;
        assessment: ObservedAssessment | null;
    } {
        try {
            this.validate();
            const lengths = this.db.prepare('SELECT id, length(CAST(input AS BLOB)) AS i, length(CAST(assessment AS BLOB)) AS a, length(CAST(body AS BLOB)) AS b FROM receipt').all() as {
                id: number;
                i: number;
                a: number;
                b: number;
            }[];
            if (lengths.length !== 1 || lengths[0].id !== 1 || lengths[0].i > observedLimits.input
                || lengths[0].a > observedLimits.assessment || lengths[0].b > observedLimits.receipt)
                throw new Error();
            const row = this.db.prepare('SELECT input, assessment, body FROM receipt WHERE id=1').get() as {
                input: string;
                assessment: string;
                body: string;
            };
            const data = checkedInput(row.input, this.owner), receipt = receiptSchema.parse(parseObservedText(row.body, observedLimits.receipt));
            if (canonical(receipt) !== row.body || canonical(data.receipt) !== row.body || data.assessment !== row.assessment)
                throw new Error();
            this.validate();
            return { input: row.input, receipt, assessment: data.value };
        }
        catch {
            return this.failed();
        }
    }
    markUncertain(): void {
        this.poisoned = true;
        if (this.storage) {
            this.storage.poisoned = true;
            try {
                this.storage.close();
            }
            catch { }
        }
        else {
            try {
                this.db.close();
            }
            catch { }
        }
        this.closed = true;
    }
    close(): void {
        if (this.closed)
            return;
        try {
            this.read(); // Empty, damaged or uncertain writers retain their existing lock.
            if (this.storage)
                this.storage.close();
            else
                this.db.close();
            if (this.storage) {
                // Last fallible operation. Unlike removePrivate, this does not unlink
                // and THEN perform a sync that could turn absence into an uncertain close.
                // No fallible work follows successful unlink. A crash may restore this
                // un-synced fence (conservative rejection), never authorize repair/retry.
                fs.unlinkSync(join(this.root, pendingName));
            }
            this.closed = true;
        }
        catch {
            this.poisoned = true;
            if (this.storage) {
                this.storage.poisoned = true;
                try {
                    this.storage.close();
                }
                catch { }
            }
            else {
                try {
                    this.db.close();
                }
                catch { }
            }
            this.closed = true;
            throw new ObservedSnapshotError('uncertain');
        }
    }
}
