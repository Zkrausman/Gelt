// Native synthetic test transport only. Fixed production script/argv, bounded I/O,
// no arbitrary executable or script input. Always join even on deadline/error.
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { helperStage, verifyHelperSources, windowsHelperEnvironment } from './windows-storage.js';
export async function nativeHelperProbe(input: Buffer, { open = false, split = false, deadline = 15000 } = {}) {
  const dir = verifyHelperSources();
  const start = performance.now();
  const child = spawn('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', resolve(dir, 'private-storage.ps1')], {
    env: windowsHelperEnvironment(), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
  });
  let stdout = '', stderr = '', failed = false, timedOut = false;
  const times: Record<string, number> = {};
  const timer = setTimeout(() => { timedOut = true; mark('FIXTURE_DEADLINE'); child.kill(); }, deadline);
  const closed = new Promise<number | null>(done => child.once('close', code => done(code)));
  child.on('error', () => { failed = true; });
  const mark = (label: string) => { times[label] ??= Math.round(performance.now() - start); };
  child.once('spawn', () => mark('FIXTURE_SPAWN'));
  child.stdin.on('error', () => mark('FIXTURE_PIPE_ERROR')); // Early rejection may close before remaining bytes.
  child.stdout.on('data', bytes => {
    if (stdout.length + bytes.length > 220000) { failed = true; child.kill(); }
    else stdout += bytes.toString('utf8');
  });
  child.stderr.on('data', bytes => {
    if (stderr.length + bytes.length > 1024) { failed = true; child.kill(); return; }
    stderr += bytes.toString('utf8');
    let prefix = '';
    for (const line of stderr.split('\n').slice(0, -1)) {
      prefix += line + '\n';
      const stage = helperStage(prefix);
      if (!['PROTOCOL', 'STARTUP'].includes(stage)) times[stage] ??= Math.round(performance.now() - start);
    }
  });
  let writer: ReturnType<typeof setTimeout> | undefined;
  const end = () => {
    if (open) { mark('FIXTURE_LEFT_OPEN'); return; }
    mark('FIXTURE_END_QUEUED'); child.stdin.end(() => mark('FIXTURE_END_DONE'));
  };
  // Fixed labels distinguish JS scheduling/pipe completion from native reads.
  // Write completion means handed to the OS, NOT consumed by PowerShell.
  if (split) {
    mark('FIXTURE_FIRST_QUEUED');
    child.stdin.write(input.subarray(0, 2), error => mark(error ? 'FIXTURE_PIPE_ERROR' : 'FIXTURE_FIRST_DONE'));
    writer = setTimeout(() => {
      mark('FIXTURE_SECOND_QUEUED');
      child.stdin.write(input.subarray(2, 7), error => mark(error ? 'FIXTURE_PIPE_ERROR' : 'FIXTURE_SECOND_DONE'));
      writer = setTimeout(() => {
        mark('FIXTURE_LAST_QUEUED');
        child.stdin.write(input.subarray(7), error => mark(error ? 'FIXTURE_PIPE_ERROR' : 'FIXTURE_LAST_DONE'));
        end();
      }, 25);
    }, 25);
  } else {
    mark('FIXTURE_WHOLE_QUEUED');
    child.stdin.write(input, error => mark(error ? 'FIXTURE_PIPE_ERROR' : 'FIXTURE_WHOLE_DONE'));
    end();
  }
  try {
    const status = await closed;
    mark('FIXTURE_JOINED');
    if (failed) throw new Error('native helper process unavailable');
    return { status, stdout, stderr, timedOut, times };
  } finally { clearTimeout(timer); clearTimeout(writer); child.stdin.destroy(); }
}
