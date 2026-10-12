// Fixed public synthetic transport comparison, shared by compiled direct Node and
// Vitest. No configurable input, secrets, paths or native output enter reports.
import { nativeHelperProbe } from './windows-helper-fixture.js';
import { completeDiagnostics, helperRequest, helperResponse, helperStage, safeStorageStage, windowsStorage } from './windows-storage.js';

export async function verifyNativeTransportFixtures() {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('native Windows x64 required');
  let firstFailure: string | undefined;
  // Continue all three even on failure: hosted comparison must not stop at the
  // first failed variant. Each helper keeps the production 15-second deadline.
  for (const mode of ['closed', 'open', 'split-open'] as const) {
    let stage = 'STARTUP';
    try {
      const key = Buffer.alloc(32, 0x47); // public fixture, never an owner key
      const probe = await nativeHelperProbe(helperRequest('protect', '', key), { open: mode !== 'closed', split: mode === 'split-open' });
      stage = helperStage(probe.stderr, probe.stdout);
      console.log('Native synthetic transport', JSON.stringify({ mode, stage, timedOut: probe.timedOut, times: probe.times }));
      if (probe.timedOut || probe.status !== 0 || probe.stderr !== completeDiagnostics) throw new Error();
      stage = 'OPERATION';
      const encrypted = helperResponse(probe.stdout, 'protect');
      if (encrypted.includes(key) || !windowsStorage('unprotect', '', encrypted).equals(key)) throw new Error();
      console.log('Native synthetic DPAPI roundtrip passed', mode);
    } catch (error) {
      const reported = (error as { storageStage?: unknown })?.storageStage;
      stage = safeStorageStage(reported ?? stage);
      console.log('Native synthetic transport unavailable', JSON.stringify({ mode, stage }));
      firstFailure ??= stage;
    }
  }
  if (firstFailure) throw Object.assign(new Error('native transport unavailable'), { storageStage: firstFailure });
}
