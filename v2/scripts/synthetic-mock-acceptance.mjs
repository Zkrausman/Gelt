import { execFile, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export function reportAndExit(exitCode, line, processApi = process, schedule = setTimeout) {
  // A child or descendant can keep the parent event loop alive after cleanup
  // was bounded. Always retain this final timer, including when stderr drains.
  schedule(() => processApi.exit(exitCode), 250);
  processApi.exitCode = exitCode;
  try { processApi.stderr.write(`${line}\n`); } catch { /* bounded exit still applies */ }
}

export function formatRunnerReport(state) {
  return JSON.stringify({ runner: 'synthetic-mock-acceptance', ...state });
}

function runAcceptance() {
  const workspace = fileURLToPath(new URL('..', import.meta.url));
  const environment = {
    PATH: process.env.PATH ?? '',
    NODE_ENV: 'test',
    GELT_SYNTHETIC_ORDER_HARNESS: 'offline-test-only',
    GELT_SYNTHETIC_MOCK_ROBINHOOD: 'offline-test-only',
  };
  for (const name of ['TMPDIR', 'TEMP', 'TMP', 'GELT_WINDOWS_PRIVATE_PARENT']) {
    if (process.env[name] !== undefined) environment[name] = process.env[name];
  }

  const child = spawn(process.execPath, [
    'node_modules/vitest/vitest.mjs', 'run', '--config', 'worker/vitest.config.ts',
    'worker/src/synthetic-mock-robinhood.test.ts',
  ], { cwd: workspace, env: environment, stdio: 'inherit', shell: false, detached: process.platform !== 'win32' });
  const runnerTimeoutMs = 15 * 60 * 1000;
  const terminationGraceMs = 5000;
  const settlementGraceMs = 5000;
  let timedOut = false;
  let childClosed = false;
  let childExitCode = null;
  let childSignal = null;
  let spawnFailed = false;
  let cleanupKind = null;
  let groupPoll;
  let forceTimer;
  let settlementTimer;
  let windowsTerminationDone = false;
  let windowsTerminationSucceeded = false;
  let finalized = false;
  let cleanupExitCode = 124;

  function processGroupAlive() {
    if (process.platform === 'win32' || child.pid === undefined) return undefined;
    try { process.kill(-child.pid, 0); return true; }
    catch (error) { return error?.code === 'EPERM'; }
  }

  function signalGroup(signal) {
    if (process.platform === 'win32' || child.pid === undefined) return false;
    try { process.kill(-child.pid, signal); return true; }
    catch (error) { return error?.code === 'ESRCH'; }
  }

  function report(exitCode, descendantState) {
    if (finalized) return;
    finalized = true;
    clearTimeout(runnerTimer);
    if (groupPoll) clearInterval(groupPoll);
    if (forceTimer) clearTimeout(forceTimer);
    if (settlementTimer) clearTimeout(settlementTimer);
    reportAndExit(exitCode, formatRunnerReport({ timedOut, childExitCode, childSignal,
      descendants: descendantState, termination: cleanupKind ?? 'not-needed' }));
  }

  function waitForGroupSettlement() {
    if (!childClosed || finalized) return;
    const alive = processGroupAlive();
    if (alive === false) {
      report(cleanupKind ? cleanupExitCode : (childExitCode ?? 1), 'settled');
      return;
    }
    if (alive === undefined) {
      report(cleanupKind ? cleanupExitCode : (childExitCode ?? 1), 'not-observable-on-windows');
      return;
    }
    if (!cleanupKind) beginCleanup('descendants-after-child-exit', 124);
  }

  function beginCleanup(reason, exitCode = 124) {
    if (cleanupKind || finalized) return;
    cleanupKind = reason;
    cleanupExitCode = exitCode;
    if (process.platform === 'win32') {
      if (child.pid === undefined) {
        windowsTerminationDone = true;
        return;
      }
      execFile('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'],
        { timeout: terminationGraceMs, windowsHide: true }, error => {
          windowsTerminationDone = true;
          windowsTerminationSucceeded = !error;
          if (childClosed) report(cleanupExitCode, windowsTerminationSucceeded ? 'taskkill-reported-tree-terminated' : 'unconfirmed');
        });
      settlementTimer = setTimeout(() => {
        if (childClosed && windowsTerminationDone) return;
        report(cleanupExitCode, 'unconfirmed');
      }, terminationGraceMs + settlementGraceMs);
      return;
    }

    signalGroup('SIGTERM');
    forceTimer = setTimeout(() => {
      signalGroup('SIGKILL');
      settlementTimer = setTimeout(() => report(cleanupExitCode, 'unconfirmed'), settlementGraceMs);
    }, terminationGraceMs);
    groupPoll = setInterval(waitForGroupSettlement, 100);
  }

  const runnerTimer = setTimeout(() => {
    timedOut = true;
    beginCleanup('timeout');
  }, runnerTimeoutMs);

  process.once('SIGINT', () => beginCleanup('parent-sigint', 130));
  process.once('SIGTERM', () => beginCleanup('parent-sigterm', 143));

  child.once('error', error => {
    spawnFailed = true;
    childClosed = true;
    process.stderr.write(`synthetic mock runner could not start: ${error.message}\n`);
    report(1, 'not-started');
  });
  child.once('close', (code, signal) => {
    childClosed = true;
    childExitCode = code;
    childSignal = signal;
    if (spawnFailed || finalized) return;
    if (process.platform === 'win32') {
      if (cleanupKind) {
        if (windowsTerminationDone) report(cleanupExitCode, windowsTerminationSucceeded ? 'taskkill-reported-tree-terminated' : 'unconfirmed');
        return;
      }
      report(childExitCode ?? 1, 'not-observable-on-windows');
      return;
    }
    waitForGroupSettlement();
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) runAcceptance();
