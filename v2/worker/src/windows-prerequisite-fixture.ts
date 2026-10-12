// Independent fixed probes ensure a stalled operation cannot hide other results.
// These are diagnostics, not DPAPI/ACL acceptance or an alternate storage backend.
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { verifyHelperSources, windowsHelperEnvironment } from './windows-storage.js';
export const prerequisiteProbes = ['path', 'source', 'stdin', 'array', 'join-path', 'new-object', 'json', 'add-type', 'enum-mask'] as const;
type Probe = typeof prerequisiteProbes[number];
// Only unused implicit-autoload comparisons are informational. All replacement
// APIs, trusted imports and enum masks are mandatory, as is production DPAPI.
export function prerequisiteRequired(probe: Probe): boolean {
  return probe !== 'join-path' && probe !== 'new-object';
}
export function prerequisiteFailure(probe: Probe, passed: boolean): boolean {
  return prerequisiteRequired(probe) && !passed;
}
export function prerequisiteStage(stderr: string): string {
  const stages = ['START', 'MODULE', 'MODULE_DONE', 'BEFORE', 'AFTER', 'DONE'];
  if (stderr.length > 256) return 'PROTOCOL';
  const lines = stderr.split('\n');
  if (lines.pop() !== '' || lines.length > stages.length) return 'PROTOCOL';
  let index = -1;
  for (const line of lines) {
    const next = stages.indexOf(line);
    if (next <= index) return 'PROTOCOL';
    index = next;
  }
  return index < 0 ? 'STARTUP' : stages[index];
}
export async function nativePrerequisiteProbe(probe: Probe) {
  if (!prerequisiteProbes.includes(probe) || process.platform !== 'win32' || process.arch !== 'x64') throw new Error('native prerequisite unavailable');
  const dir = verifyHelperSources();
  const start = performance.now();
  const child = spawn('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', resolve(dir, 'prerequisite-probe.ps1'), '-Probe', probe], {
    env: windowsHelperEnvironment(), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stderr = '', stdout = '', timedOut = false, failed = false;
  const times: Record<string, number> = {};
  const mark = (stage: string) => { times[stage] ??= Math.round(performance.now() - start); };
  const closed = new Promise<number | null>(done => child.once('close', done));
  const timer = setTimeout(() => { timedOut = true; mark('DEADLINE'); child.kill(); }, 15000);
  child.on('error', () => { failed = true; });
  child.stdin.on('error', () => { failed = true; });
  // Deliberately open and empty: OpenStandardInput must not depend on EOF/data.
  child.stdout.on('data', bytes => {
    if (stdout.length + bytes.length > 16) { failed = true; child.kill(); }
    else stdout += bytes.toString('utf8');
  });
  child.stderr.on('data', bytes => {
    if (stderr.length + bytes.length > 256) { failed = true; child.kill(); return; }
    stderr += bytes.toString('utf8');
    let prefix = '';
    for (const line of stderr.split('\n').slice(0, -1)) {
      prefix += line + '\n';
      const stage = prerequisiteStage(prefix);
      if (!['PROTOCOL', 'STARTUP'].includes(stage)) mark(stage);
    }
  });
  try {
    const status = await closed; mark('JOINED');
    const expected = ['json', 'add-type'].includes(probe) ? 'START\nMODULE\nMODULE_DONE\nBEFORE\nAFTER\nDONE\n' : 'START\nBEFORE\nAFTER\nDONE\n';
    return { probe, required: prerequisiteRequired(probe), stage: prerequisiteStage(stderr), timedOut, times,
      passed: !failed && !timedOut && status === 0 && stdout === 'OK' && stderr === expected };
  } finally { clearTimeout(timer); child.stdin.destroy(); }
}
export async function verifyNativePrerequisiteFixtures() {
  let failed = false;
  // Independent processes, bounded individually, all attempted even after failure.
  for (const probe of prerequisiteProbes) {
    try {
      const result = await nativePrerequisiteProbe(probe);
      console.log('Native synthetic prerequisite', JSON.stringify(result));
      if (prerequisiteFailure(probe, result.passed)) failed = true;
    } catch {
      if (prerequisiteFailure(probe, false)) failed = true;
      console.log('Native synthetic prerequisite', JSON.stringify({ probe, required: prerequisiteRequired(probe), stage: 'STARTUP', passed: false }));
    }
  }
  if (failed) throw new Error('native prerequisites unavailable');
}
