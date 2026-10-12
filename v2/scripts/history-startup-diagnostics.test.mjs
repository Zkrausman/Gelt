import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  appendBoundedText,
  BROWSER_DISCOVERY_TIMEOUT_MS,
  createBoundedTextBuffer,
  diagnosticLimits,
  discoverBrowserPage,
  formatStartupFailure,
  readBoundedText,
} from './history-startup-diagnostics.mjs';

test('browser target discovery uses the existing 3000ms budget and reports only HTTP metadata', async () => {
  const timeoutRequests = [];
  const fakeClock = {
    now: 25,
    timeoutSignal(milliseconds) {
      timeoutRequests.push(milliseconds);
      return { deadline: this.now + milliseconds };
    },
  };
  const initialClockNow = fakeClock.now;
  let observedUrl, observedSignal, request;
  const target = { type: 'page', webSocketDebuggerUrl: 'ws://127.0.0.1:9000/devtools/page/fixture' };
  const page = await discoverBrowserPage(45678, {
    timeoutSignal: milliseconds => fakeClock.timeoutSignal(milliseconds),
    fetchImpl: async (url, options) => {
      observedUrl = url;
      observedSignal = options.signal;
      return { ok: true, status: 200, async json() { return [{ type: 'service' }, target]; } };
    },
    onRequest: value => { request = value; },
  });

  assert.equal(BROWSER_DISCOVERY_TIMEOUT_MS, 3000);
  assert.deepEqual(timeoutRequests, [3000]);
  assert.deepEqual(observedSignal, { deadline: fakeClock.now + 3000 });
  assert.equal(observedUrl, 'http://127.0.0.1:45678/json/list');
  assert.equal(page, target);
  assert.deepEqual({ label: request.label, outcome: request.outcome, status: request.status, attempts: request.attempts }, {
    label: 'Browser DevTools target list', outcome: 'http-ok', status: 200, attempts: 1,
  });
  assert.equal(fakeClock.now, initialClockNow);
});

test('browser target discovery preserves HTTP failures and records network failures without response content', async () => {
  let request;
  await assert.rejects(discoverBrowserPage(45678, {
    timeoutSignal: () => ({}),
    fetchImpl: async () => ({ ok: false, status: 503, async json() { return []; } }),
    onRequest: value => { request = value; },
  }), /owned browser page must expose CDP/);
  assert.deepEqual({ outcome: request.outcome, status: request.status }, { outcome: 'http-error', status: 503 });

  const secret = 'synthetic-browser-secret-123456789';
  await assert.rejects(discoverBrowserPage(45678, {
    timeoutSignal: () => ({}),
    fetchImpl: async () => { throw Error(`request https://127.0.0.1/private?token=${secret}`); },
    onRequest: value => { request = value; },
  }), /request https/);
  assert.deepEqual({ outcome: request.outcome, status: request.status }, { outcome: 'network-error', status: null });
});

test('startup process probes retain numeric exit status without command output', () => {
  const output = formatStartupFailure({
    error: new Error('command output must not be emitted'),
    phase: 'browser discovery',
    startedAt: 0,
    now: 25,
    deadlineAt: 180000,
    request: { label: 'Browser version probe', outcome: 'process-exit-nonzero', status: null, processStatus: 127, attempts: 1 },
  });
  assert.match(output, /Browser version probe outcome=process-exit-nonzero attempts=1 status=none processStatus=127/);
  assert.doesNotMatch(output, /command output|127\.0\.0\.1/);
});

test('failure diagnostics redact secrets and omit exception messages, response bodies, and URLs', () => {
  const secret = 'synthetic-bootstrap-secret-123456789';
  const error = Object.assign(new Error(`https://local.invalid/history body={"token":"${secret}"}`), { code: 'EACCES' });
  const output = formatStartupFailure({
    error,
    phase: 'browser target discovery',
    startedAt: 100,
    now: 275,
    deadlineAt: 30100,
    children: {
      browser: { process: { pid: 101, exitCode: null, signalCode: null, connected: false }, stderr: `DevTools ERROR https://local.invalid?token=${secret} Bearer ${secret} response body={"private":"fixture"}` },
    },
    request: { label: 'Browser DevTools target list', outcome: 'http-error', status: 503, attempts: 1, error },
    secrets: [secret],
  });

  assert.match(output, /phase=browser target discovery elapsed=175ms globalDeadlineRemaining=29825ms/);
  assert.match(output, /Error: Error/);
  assert.match(output, /browser=running\(pid=101, connected=false\)/);
  assert.match(output, /outcome=http-error attempts=1 status=503/);
  assert.match(output, /stderr browser \(bounded to 1200 chars\)/);
  assert.doesNotMatch(output, /synthetic-bootstrap-secret|local\.invalid|Bearer/);
  assert.doesNotMatch(output, /response body=|\{"private"|synthetic-bootstrap-secret|local\.invalid|Bearer/);
});

test('secret is redacted before a bounded buffer can cut it at the edge', () => {
  const secret = 'ABCDEFGHIJKLMNOPQRST';
  const buffer = createBoundedTextBuffer(12);
  appendBoundedText(buffer, `1234567890${secret}\n`, [secret]);
  const output = readBoundedText(buffer);

  assert.equal(buffer.output.length, 12);
  assert.ok(output.length <= 12);
  assert.doesNotMatch(buffer.output, /ABCDEFGHIJKLMNOPQRST|IJKLMNOPQRST/);
  assert.doesNotMatch(output, /ABCDEFGHIJKLMNOPQRST|IJKLMNOPQRST/);
});

test('credential split across stderr chunks stays withheld until redacted', () => {
  const credential = 'synthetic-secret-value-123456789';
  const buffer = createBoundedTextBuffer();
  appendBoundedText(buffer, `Authorization: Bearer ${credential.slice(0, 18)}`, [credential]);
  assert.doesNotMatch(buffer.output, /synthetic-secret|value-123456789/);

  appendBoundedText(buffer, `${credential.slice(18)}\n`, [credential]);
  const output = readBoundedText(buffer);
  assert.doesNotMatch(output, /synthetic-secret|value-123456789/);
  assert.match(output, /Authorization:/);
});

test('failure snapshot omits an unfinished registered bare-secret line', () => {
  const secret = 'bare-registered-secret-value-123456';
  const prefix = secret.slice(0, 17);
  const buffer = createBoundedTextBuffer();
  appendBoundedText(buffer, prefix, [secret]);

  const snapshotBeforeRemainder = readBoundedText(buffer);
  assert.equal(snapshotBeforeRemainder, '');
  assert.doesNotMatch(snapshotBeforeRemainder, /bare-registered|registered-secret/);

  appendBoundedText(buffer, `${secret.slice(prefix.length)}\n`, [secret]);
  const completeSnapshot = readBoundedText(buffer);
  assert.doesNotMatch(completeSnapshot, /bare-registered-secret-value-123456|registered-secret-value-123456/);
});

test('failure snapshot omits an incomplete JSON CSRF credential line', () => {
  const csrf = 'csrf-secret-value-opaque-123456789';
  const prefix = csrf.slice(0, 15);
  const buffer = createBoundedTextBuffer();
  appendBoundedText(buffer, `{"csrf":"${prefix}`, [csrf]);

  const snapshotBeforeRemainder = readBoundedText(buffer);
  assert.equal(snapshotBeforeRemainder, '');
  assert.doesNotMatch(snapshotBeforeRemainder, /csrf-secret|secret-value/);

  appendBoundedText(buffer, `${csrf.slice(prefix.length)}"}\n`, [csrf]);
  const completeSnapshot = readBoundedText(buffer);
  assert.doesNotMatch(completeSnapshot, /csrf-secret-value-opaque-123456789|secret-value-opaque-123456789/);
  assert.match(completeSnapshot, /structured data omitted/);
});

test('generic credential and URL query values split across chunks are redacted', () => {
  const buffer = createBoundedTextBuffer();
  appendBoundedText(buffer, 'Authorization: Bearer ');
  assert.equal(buffer.output, '');
  appendBoundedText(buffer, 'unlisted-opaque-token\n');
  appendBoundedText(buffer, 'GET http://127.0.0.1/?access_token=');
  appendBoundedText(buffer, 'unlisted-query-token&mode=test\n');
  const output = readBoundedText(buffer);

  assert.doesNotMatch(output, /unlisted-opaque-token|opaque-token|unlisted-query-token|http:\/\/127\.0\.0\.1/);
  assert.match(output, /Authorization: \[redacted\]/);
  assert.match(output, /GET \[url\]/);
});

test('pretty-printed JSON credential keys are redacted in buffered and final diagnostics', () => {
  const values = ['unlisted-private-value', 'unlisted-access-value', 'unlisted-api-key-value'];
  const stderr = [
    '{',
    `  "password": "${values[0]}",`,
    `  "access_token": "${values[1]}",`,
    `  "api_key": "${values[2]}"`,
    '}',
    '',
  ].join('\n');
  const buffer = createBoundedTextBuffer();
  appendBoundedText(buffer, stderr);
  const bufferedOutput = readBoundedText(buffer);
  assert.doesNotMatch(bufferedOutput, /unlisted-private-value|unlisted-access-value|unlisted-api-key-value/);
  assert.match(bufferedOutput, /"password": \[redacted\]/);
  assert.match(bufferedOutput, /"access_token": \[redacted\]/);
  assert.match(bufferedOutput, /"api_key": \[redacted\]/);

  for (const diagnosticStderr of [stderr, bufferedOutput]) {
    const report = formatStartupFailure({
      error: new Error('fixture failure'),
      phase: 'startup',
      startedAt: 0,
      now: 1,
      deadlineAt: 100,
      children: { Next: { process: null, stderr: diagnosticStderr } },
    });
    assert.doesNotMatch(report, /unlisted-private-value|unlisted-access-value|unlisted-api-key-value/);
    assert.match(report, /"password": \[redacted\]/);
    assert.match(report, /"access_token": \[redacted\]/);
    assert.match(report, /"api_key": \[redacted\]/);
  }
});

test('escaped quotes cannot expose a credential line tail', () => {
  const privateTail = 'unlisted-private-tail';
  const stderr = [
    '{',
    String.raw`  "password": "prefix\" ${privateTail}",`,
    '}',
    '',
  ].join('\n');
  const buffer = createBoundedTextBuffer();
  appendBoundedText(buffer, stderr);
  const bufferedOutput = readBoundedText(buffer);
  assert.doesNotMatch(bufferedOutput, /prefix|unlisted-private-tail/);
  assert.match(bufferedOutput, /"password": \[redacted\]/);

  for (const diagnosticStderr of [stderr, bufferedOutput]) {
    const report = formatStartupFailure({
      error: new Error('fixture failure'),
      phase: 'startup',
      startedAt: 0,
      now: 1,
      deadlineAt: 100,
      children: { Next: { process: null, stderr: diagnosticStderr } },
    });
    assert.doesNotMatch(report, /prefix|unlisted-private-tail/);
    assert.match(report, /"password": \[redacted\]/);
  }
});

test('single-quoted credential keys mask ordinary and escaped value tails', () => {
  const ordinaryCases = [
    ['api-key', 'unlisted-api-key-value'],
    ['access_token', 'unlisted-access-token-value'],
    ['password', 'unlisted-password-value'],
  ];
  const escapedTail = 'unlisted-single-quote-tail';
  const stderr = [
    '{',
    ...ordinaryCases.map(([key, value]) => `  '${key}': '${value}',`),
    String.raw`  'api-key': 'prefix\' ${escapedTail}',`,
    '}',
    '',
  ].join('\n');
  const privateValues = [...ordinaryCases.map(([, value]) => value), escapedTail];
  const buffer = createBoundedTextBuffer();
  appendBoundedText(buffer, stderr);
  const bufferedOutput = readBoundedText(buffer);
  for (const value of privateValues) assert.doesNotMatch(bufferedOutput, new RegExp(value));
  for (const [key] of ordinaryCases) assert.match(bufferedOutput, new RegExp(`'${key}': \\[redacted\\]`));
  assert.doesNotMatch(bufferedOutput, /prefix/);

  for (const diagnosticStderr of [stderr, bufferedOutput]) {
    const report = formatStartupFailure({
      error: new Error('fixture failure'),
      phase: 'startup',
      startedAt: 0,
      now: 1,
      deadlineAt: 100,
      children: { Next: { process: null, stderr: diagnosticStderr } },
    });
    for (const value of privateValues) assert.doesNotMatch(report, new RegExp(value));
    for (const [key] of ordinaryCases) assert.match(report, new RegExp(`'${key}': \\[redacted\\]`));
    assert.doesNotMatch(report, /prefix/);
  }
});

test('standalone credential aliases sanitize before bounded retention and registration', () => {
  const aliases = ['csrf', 'access', 'refresh', 'bootstrap', 'secret', 'state', 'session', 'code'];
  const keyForms = [
    (key, value) => `${key}: ${value}`,
    (key, value) => `'${key}': '${value}'`,
    (key, value) => `"${key}": "${value}"`,
  ];
  const safeTail = 'S'.repeat(1184);

  for (const alias of aliases) {
    for (const [formIndex, formatKey] of keyForms.entries()) {
      const privateValue = `unlisted-${alias}-${formIndex}-private-tail-0123456789`;
      const privateSuffix = privateValue.slice(-16);
      const stderr = `${formatKey(alias, privateValue)}\n${safeTail}\n`;
      const buffer = createBoundedTextBuffer();
      appendBoundedText(buffer, `${formatKey(alias, privateValue)}\n`);
      appendBoundedText(buffer, `${safeTail}\n`);

      assert.equal(buffer.output.length, diagnosticLimits.maxChars);
      assert.equal(buffer.output.includes(privateValue), false);
      assert.equal(buffer.output.includes(privateSuffix), false);
      const laterRegisteredRead = readBoundedText(buffer, [privateValue]);
      assert.equal(laterRegisteredRead.includes(privateValue), false);
      assert.equal(laterRegisteredRead.includes(privateSuffix), false);

      for (const diagnosticStderr of [stderr, buffer.output]) {
        const report = formatStartupFailure({
          error: new Error('fixture failure'),
          phase: 'startup',
          startedAt: 0,
          now: 1,
          deadlineAt: 100,
          children: { Next: { process: null, stderr: diagnosticStderr } },
        });
        assert.equal(report.includes(privateValue), false);
        assert.equal(report.includes(privateSuffix), false);
      }
    }
  }
});

test('overlong unterminated stderr unit is discarded within the pending-memory bound', () => {
  const buffer = createBoundedTextBuffer();
  appendBoundedText(buffer, `Authorization: Bearer ${'overlong-private-token-'.repeat(70)}`);
  assert.equal(buffer.pending, '');
  assert.equal(buffer.discarding, true);
  assert.ok(buffer.output.length <= diagnosticLimits.maxChars);
  assert.doesNotMatch(readBoundedText(buffer), /overlong-private-token/);

  appendBoundedText(buffer, 'untrusted-tail\nsafe diagnostic line\n');
  const output = readBoundedText(buffer);
  assert.doesNotMatch(output, /overlong-private-token|untrusted-tail/);
  assert.match(output, /safe diagnostic line/);
});

test('wrapped child with absent, undefined, or null process is not started', () => {
  const output = formatStartupFailure({
    error: new Error('fixture failure'),
    phase: 'startup',
    startedAt: 0,
    now: 1,
    deadlineAt: 100,
    children: { absent: {}, undefined: { process: undefined }, null: { process: null } },
  });
  assert.match(output, /absent=not-started/);
  assert.match(output, /undefined=not-started/);
  assert.match(output, /null=not-started/);
});

test('diagnostics stay bounded and describe cleanup at the unchanged global deadline', () => {
  const buffer = createBoundedTextBuffer(32);
  for (let index = 0; index < 80; index++) appendBoundedText(buffer, `${'old'.repeat(10)}\n`);
  appendBoundedText(buffer, 'tail\n');
  const appended = readBoundedText(buffer);
  assert.equal(appended.length, 32);
  assert.ok(appended.endsWith('tail\n'));

  const output = formatStartupFailure({
    error: new Error('cleanup error detail must not be emitted'),
    phase: 'cleanup',
    startedAt: 1000,
    now: 181000,
    deadlineAt: 181000,
    children: {
      browser: { process: { pid: 7, exitCode: 0, signalCode: null, connected: false }, stderr: 'x'.repeat(4000) },
      Next: { process: null, stderr: '' },
    },
    request: { label: 'Next HTTP readiness', outcome: 'http-error', status: 503, attempts: 4 },
  });

  assert.match(output, /phase=cleanup elapsed=180000ms globalDeadlineRemaining=0ms/);
  assert.match(output, /browser=exited\(code=0\)/);
  assert.match(output, /Next=not-started/);
  assert.match(output, /outcome=http-error attempts=4 status=503/);
  assert.match(output, /stderr browser \(bounded to 1200 chars\)/);
  assert.ok(output.length < 3000);
  assert.doesNotMatch(output, /cleanup error detail/);
  assert.equal(diagnosticLimits.maxChars, 1200);
});

test('acceptance retains its exact deadline, owned-child join, and sandbox preconditions', () => {
  const source = readFileSync(new URL('./running-next-history-acceptance.mjs', import.meta.url), 'utf8');
  assert.match(source, /const deadline = startedAt \+ 180000/);
  assert.match(source, /Math\.min\(deadline, Date\.now\(\) \+ limit\)/);
  assert.match(source, /await Promise\.race\(\[new Promise\(resolveChild => child\.once\('exit', resolveChild\)\), delay\(2000\)\]\)/);
  assert.match(source, /owned child must be joined before cleanup completes/);
  assert.match(source, /browser security sandbox enabled/);
});
