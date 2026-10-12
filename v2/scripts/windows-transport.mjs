// Run compiled fixture code in plain Node, without Vitest transforms or timers.
// Non-Windows is a hard failure, never a native acceptance receipt.
if (process.platform !== 'win32' || process.arch !== 'x64' || !process.version.startsWith('v22.')) {
  console.error('Native transport requires Windows x64 Node22; no native acceptance');
  process.exitCode = 1;
} else {
  try {
    const { verifyNativeTransportFixtures } = await import('../worker/dist/windows-transport-fixture.js');
    const { verifyNativePrerequisiteFixtures } = await import('../worker/dist/windows-prerequisite-fixture.js');
    let failed = false;
    // A stalled prerequisite must not suppress the transport comparison.
    for (const verify of [verifyNativePrerequisiteFixtures, verifyNativeTransportFixtures]) {
      try { await verify(); } catch { failed = true; }
    }
    if (failed) throw new Error();
    console.log('Direct Node native transport passed; private NTFS preflight and full suite still required');
  } catch {
    // Never print loader errors, paths, native output, environment or stack traces.
    console.error('Direct Node native transport unavailable; no native acceptance');
    process.exitCode = 1;
  }
}
