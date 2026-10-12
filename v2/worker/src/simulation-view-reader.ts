import { createHash } from 'node:crypto';
import { readPrivate } from './private-files.js';
import { parseResearchJSON } from './research-json.js';
import { simulationSnapshotSchema, simulationViewMaxBytes } from './simulation-view-contract.js';

// An explicitly supplied private snapshot, not another ledger/store or a live worker.
// No caller chooses a filesystem path; no provisioning, artifact execution or writes.
export function readSimulationSnapshot(path?: string, digest?: string, read = readPrivate) {
  if (!path || !digest || !/^[a-f0-9]{64}$/.test(digest)) return { state: 'unavailable' as const };
  let bytes: Buffer;
  try { bytes = read(path); } catch { return { state: 'unavailable' as const }; }
  try {
    if (bytes.length > simulationViewMaxBytes - 1024 || createHash('sha256').update(bytes).digest('hex') !== digest) return { state: 'corrupt' as const };
    return { state: 'available' as const, snapshot: simulationSnapshotSchema.parse(parseResearchJSON(bytes)) };
  } catch { return { state: 'corrupt' as const }; }
}
