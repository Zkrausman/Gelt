// Synthetic process-boundary harness only; no provider or credentials.
import Database from 'better-sqlite3';
import { Ledger } from '../ledger.js';
import { intent, id } from '../ledger-fixture.js';
const [mode, path] = process.argv.slice(2);
let ledger: Ledger | undefined, raw: Database.Database | undefined;
try {
  if (mode === 'busy') { raw = new Database(path); raw.exec('BEGIN IMMEDIATE'); }
  else {
    ledger = new Ledger(path, id(1));
    if (mode === 'crash') {
      if (!ledger.recordIntent(intent).ok) throw new Error();
      raw = new Database(path); raw.exec('BEGIN IMMEDIATE');
      // Simulate interrupted projection work; never committed and must not survive.
      raw.prepare('UPDATE intents SET projection=?').run('{"uncommitted":true}');
    }
  }
  process.send?.('ready');
  process.on('message', () => { if (raw?.inTransaction) raw.exec('ROLLBACK'); raw?.close(); ledger?.close(); process.disconnect(); });
} catch { process.send?.('unavailable'); process.disconnect(); }
