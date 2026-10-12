import * as fs from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { createPrivateDirectory, privateDirectory, readPrivate, removePrivate, writePrivateNew } from './private-files.js';
import { windowsStorage } from './windows-storage.js';
import { storageBoundary, storageInvariant, ledgerStorageError } from './storage-diagnostics.js';
export function createLedgerDirectory(path: string) {
  if (process.platform === 'win32') windowsStorage('sqlite-mkdir', path);
  else createPrivateDirectory(path);
}
export function validateSQLiteFile(path: string) {
  if (process.platform === 'win32') { windowsStorage('sqlite-file', path); return; }
  privateDirectory(dirname(path));
  const fd = fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile() || st.nlink !== 1 || st.uid !== process.getuid!() || (st.mode & 0o777) !== 0o600) throw new Error();
  } finally { fs.closeSync(fd); }
}
export class LedgerStorage {
  readonly db: Database.Database;
  private readonly token = randomUUID();
  private closed = false;
  private identity?: { dev: number; ino: number };
  poisoned = false;
  constructor(readonly path: string, options: { createIfMissing?: boolean } = {}) {
    let db: Database.Database | undefined;
    const createIfMissing = options.createIfMissing !== false;
    try {
      if (path !== resolve(path) || !path.endsWith('.sqlite')) throw new Error();
      storageBoundary('parent', () => privateDirectory(dirname(path)));
      // Local ext4/xfs/btrfs or container overlay only. Network and unknown locking semantics fail closed.
      if (process.platform === 'linux' && ![0xef53, 0x58465342, 0x9123683e, 0x794c7630].includes(fs.statfsSync(dirname(path)).type)) throw new Error();
      this.validate();
      storageBoundary('marker', () => writePrivateNew(path + '.lock', this.token));
      storageBoundary('main', () => {
        if (!fs.existsSync(path)) {
          if (!createIfMissing) throw new Error();
          writePrivateNew(path, Buffer.alloc(0));
        }
      });
      this.validate();
      db = new Database(path, { timeout: 250 });
      db.pragma('foreign_keys = ON'); db.pragma('trusted_schema = OFF');
      db.pragma('synchronous = FULL');
      if (db.pragma('journal_mode = WAL', { simple: true }) !== 'wal') throw new Error();
      this.db = db; this.identity = storageBoundary('identity', () => fs.lstatSync(path)); this.validate();
    } catch (error) { try { db?.close(); } catch {} throw ledgerStorageError(error); } // retain uncertain ownership
  }
  validate() {
    if (process.platform !== 'win32') storageBoundary('parent', () => privateDirectory(dirname(this.path)));
    if (this.identity) {
      const st = storageBoundary('identity', () => fs.lstatSync(this.path));
      if (st.dev !== this.identity.dev || st.ino !== this.identity.ino) storageInvariant('IDENTITY', 'identity');
      const marker = storageBoundary('marker', () => readPrivate(this.path + '.lock').toString());
      if (marker !== this.token) storageInvariant('MARKER', 'marker');
    }
    if (process.platform === 'win32') { windowsStorage('sqlite-set', this.path); return; }
    for (const [suffix, kind] of [['', 'main'], ['-wal', 'wal'], ['-shm', 'shm'], ['-journal', 'journal']] as const) {
      storageBoundary(kind, () => {
        const path = this.path + suffix;
        try { fs.lstatSync(path); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
        validateSQLiteFile(path);
      });
    }
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    try {
      this.validate();
      if (this.poisoned) throw new Error();
      const result = this.db.pragma('wal_checkpoint(TRUNCATE)') as {busy: number}[];
      if (result.length !== 1 || result[0].busy !== 0) throw new Error();
      this.db.close(); this.validate();
      if (storageBoundary('marker', () => readPrivate(this.path + '.lock').toString()) !== this.token) storageInvariant('MARKER', 'marker');
      storageBoundary('marker', () => removePrivate(this.path + '.lock'));
    } catch (error) { this.poisoned = true; try { if (this.db.open) this.db.close(); } catch {} throw ledgerStorageError(error); }
  }
}
