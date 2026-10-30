import { PassThrough, Readable, Writable } from 'node:stream';
import { afterEach, expect, it, vi } from 'vitest';
import { a64InspectionCommand, executeA64InspectionCommand } from './a64-inspection-command.js';
import { runA64InspectionCLI, a64InspectionTransportLimits } from './a64-inspection-cli.js';

afterEach(() => vi.useRealTimers());

function sink() {
  const chunks: Buffer[] = [];
  const stream = new Writable({ write(chunk, _encoding, done) { chunks.push(Buffer.from(chunk)); done(); } });
  return { stream, text: () => Buffer.concat(chunks).toString('utf8') };
}

it('describes one read-only command without consuming stdin or acquiring authority', async () => {
  const input = new PassThrough(), output = sink();
  expect(await runA64InspectionCLI(['--describe'], input, output.stream)).toBe(0);
  expect(input.readableFlowing).toBeNull();
  const d = JSON.parse(output.text());
  expect(d).toEqual(a64InspectionCommand);
  expect(d).toMatchObject({ inputBytes: 262144, artifactBytes: 180000, contextBytes: 8192, outputBytes: 8192,
    effectAuthority: 'none', dispatchAllowed: false, promotionAllowed: false, operationalDecisions: 0,
    persistence: 'not_performed', persistenceEffects: false, networkAccess: false, filesystemAccess: false, production: 'CLOSED' });
  input.destroy();
});

it.each([['--run'], ['--describe', '--run'], ['/private/token'], ['--output', '/private/token']])(
  'rejects unsupported arguments without reading or echoing them: %j', async (...args) => {
    const input = new PassThrough(), output = sink();
    expect(await runA64InspectionCLI(args, input, output.stream)).toBe(64);
    expect(JSON.parse(output.text())).toMatchObject({ status: 'rejected', reason: 'usage_error', effectAuthority: 'none', dispatchAllowed: false });
    expect(output.text()).not.toContain('/private/token'); expect(input.readableFlowing).toBeNull(); input.destroy();
  },
);

it('passes one complete input to the real assessor and rejects legacy/detached/multiple JSON without raw reflection', async () => {
  for (const text of ['', '{}', '{"schema":"legacy","token":"PRIVATE_SENTINEL"}', '{}\n{}', '{"schema":1,"schema":2}', 'null']) {
    const expected = executeA64InspectionCommand(text), output = sink();
    expect(await runA64InspectionCLI([], Readable.from([Buffer.from(text)]), output.stream)).toBe(2);
    expect(output.text()).toBe(expected.text);
    expect(JSON.parse(output.text())).toMatchObject({ status: 'rejected', qualification: 'NOT_READY', production: 'CLOSED', operations: 'DEFER' });
    expect(output.text()).not.toContain('PRIVATE_SENTINEL');
    expect(Buffer.byteLength(output.text())).toBeLessThanOrEqual(8192);
  }
});

it('bounds exact bytes and chunks before complete-input decoding, without partial assessment', async () => {
  for (const input of [Readable.from([Buffer.alloc(262145, 32)]), Readable.from(Array.from({ length: 4097 }, () => Buffer.from(' ')))]) {
    const output = sink(); expect(await runA64InspectionCLI([], input, output.stream)).toBe(2);
    expect(JSON.parse(output.text())).toMatchObject({ status: 'rejected', reason: 'resource_limit' });
    expect(input.destroyed).toBe(true);
  }
  const output = sink();
  expect(await runA64InspectionCLI([], Readable.from([Buffer.alloc(262144, 32)]), output.stream)).toBe(2);
  expect(JSON.parse(output.text()).reason).toBe('invalid_input');
});

it('rejects invalid UTF8 and object-mode/text chunks with no replacement-character coercion', async () => {
  for (const chunk of [Buffer.from([0xc3, 0x28]), Buffer.from([0xed, 0xa0, 0x80])]) {
    const output = sink(); expect(await runA64InspectionCLI([], Readable.from([chunk]), output.stream)).toBe(2);
    expect(JSON.parse(output.text()).reason).toBe('invalid_utf8');
  }
  for (const chunk of ['{"token":"PRIVATE_SENTINEL"}', { token: 'PRIVATE_SENTINEL' }]) {
    const output = sink(); expect(await runA64InspectionCLI([], Readable.from([chunk]), output.stream)).toBe(2);
    expect(JSON.parse(output.text()).reason).toBe('input_transport_failed');
    expect(output.text()).not.toContain('PRIVATE_SENTINEL');
  }
});

it('decodes split UTF8 only after EOF and rejects malformed JSON without transport misclassification', async () => {
  const b = Buffer.from('{"extra":"π"}'), i = b.indexOf(0xcf), output = sink();
  expect(await runA64InspectionCLI([], Readable.from([b.subarray(0, i + 1), b.subarray(i + 1)]), output.stream)).toBe(2);
  expect(JSON.parse(output.text()).reason).toBe('invalid_input');
});

it('fails closed on a stalled input and releases its owned stream', async () => {
  vi.useFakeTimers(); const input = new PassThrough(), output = sink();
  const pending = runA64InspectionCLI([], input, output.stream);
  input.write('{"token":"PRIVATE_SENTINEL"');
  await vi.advanceTimersByTimeAsync(a64InspectionTransportLimits.inputTimeoutMs);
  expect(await pending).toBe(2); expect(input.destroyed).toBe(true);
  expect(JSON.parse(output.text()).reason).toBe('input_timeout'); expect(output.text()).not.toContain('PRIVATE_SENTINEL');
});

it('treats premature close and input errors as rejection, never a successful partial document', async () => {
  for (const fail of ['close', 'error']) {
    const input = new PassThrough(), output = sink(), pending = runA64InspectionCLI([], input, output.stream);
    input.write('{}'); input.destroy(fail === 'error' ? new Error('PRIVATE_SENTINEL') : undefined);
    expect(await pending).toBe(2); expect(JSON.parse(output.text()).reason).toBe('input_transport_failed');
    expect(output.text()).not.toContain('PRIVATE_SENTINEL');
  }
});

it('reports output failure by exit status and does not throw or expose sink errors', async () => {
  const failed = new Writable({ write(_c, _e, done) { done(new Error('PRIVATE_SENTINEL')); } });
  expect(await runA64InspectionCLI(['--describe'], new PassThrough(), failed)).toBe(74);
  await new Promise(resolve => setImmediate(resolve));
});

it('bounds a stalled output callback without retrying the response', async () => {
  vi.useFakeTimers(); let writes = 0;
  const output = new Writable({ write() { writes++; } });
  const pending = runA64InspectionCLI(['--describe'], new PassThrough(), output);
  await vi.advanceTimersByTimeAsync(a64InspectionTransportLimits.outputTimeoutMs);
  expect(await pending).toBe(74); expect(writes).toBe(1); expect(output.destroyed).toBe(true);
});

it('rejects successful write callback followed by an error before final completion', async () => {
  let writes = 0;
  const output = new Writable({
    write(_c, _e, done) {
      writes++; done();
      queueMicrotask(() => output.emit('error', new Error('PRIVATE_SENTINEL')));
    },
    final() { /* Hold completion so the later error belongs to this lifecycle. */ },
  });
  const observe = () => {}; output.on('error', observe);
  expect(await runA64InspectionCLI(['--describe'], new PassThrough(), output)).toBe(74);
  expect(writes).toBe(1);
  output.off('error', observe);
  expect(() => output.emit('error', new Error('SECOND_PRIVATE_SENTINEL'))).not.toThrow();
});

it('rejects a destruction error after successful callback and finish, before owned close', async () => {
  let writes = 0;
  const output = new Writable({
    write(_c, _e, done) { writes++; done(); },
    destroy(_error, done) { setImmediate(() => done(new Error('PRIVATE_SENTINEL'))); },
  });
  const observe = () => {}; output.on('error', observe);
  expect(await runA64InspectionCLI(['--describe'], new PassThrough(), output)).toBe(74);
  expect(writes).toBe(1);
  await new Promise(resolve => setImmediate(resolve)); output.off('error', observe);
  expect(() => output.emit('error', new Error('SECOND_PRIVATE_SENTINEL'))).not.toThrow();
});

it('rejects premature output close after callback but before finish', async () => {
  const output = new Writable({
    write(_c, _e, done) { done(); queueMicrotask(() => output.destroy()); },
    final() { /* No finish before the independently observed close. */ },
  });
  expect(await runA64InspectionCLI(['--describe'], new PassThrough(), output)).toBe(74);
});

it('times out incomplete finalization despite an already successful write callback', async () => {
  vi.useFakeTimers(); let writes = 0;
  const output = new Writable({ write(_c, _e, done) { writes++; done(); }, final() {} });
  const pending = runA64InspectionCLI(['--describe'], new PassThrough(), output);
  await vi.advanceTimersByTimeAsync(a64InspectionTransportLimits.outputTimeoutMs);
  expect(await pending).toBe(74); expect(writes).toBe(1); expect(output.destroyed).toBe(true);
});

it('requires observed close and retains guarded handling after a timed-out late callback', async () => {
  vi.useFakeTimers(); let release: (() => void) | undefined, writes = 0;
  const output = new Writable({ write(_c, _e, done) { writes++; release = () => done(); } });
  const pending = runA64InspectionCLI(['--describe'], new PassThrough(), output);
  await vi.advanceTimersByTimeAsync(a64InspectionTransportLimits.outputTimeoutMs);
  expect(await pending).toBe(74); release?.(); await vi.runAllTicks();
  expect(() => output.emit('error', new Error('PRIVATE_SENTINEL'))).not.toThrow();
  expect(() => output.emit('error', new Error('SECOND_PRIVATE_SENTINEL'))).not.toThrow();
  expect(writes).toBe(1);
});

it('does not accept finish without an observable owned close', async () => {
  vi.useFakeTimers();
  const output = new Writable({ emitClose: false, write(_c, _e, done) { done(); } });
  const pending = runA64InspectionCLI(['--describe'], new PassThrough(), output);
  await vi.advanceTimersByTimeAsync(a64InspectionTransportLimits.outputTimeoutMs);
  expect(await pending).toBe(74);
});

it('accepts one healthy output only after finish and close, guarding later errors', async () => {
  let writes = 0;
  const output = new Writable({ write(_c, _e, done) { writes++; done(); } });
  expect(await runA64InspectionCLI(['--describe'], new PassThrough(), output)).toBe(0);
  expect(output.writableFinished).toBe(true); expect(output.closed).toBe(true); expect(writes).toBe(1);
  expect(() => output.emit('error', new Error('PRIVATE_SENTINEL'))).not.toThrow();
});

it('guards repeated input errors after owned EOF or timeout without reopening the input', async () => {
  const ended = Readable.from([Buffer.from('{}')]), first = sink();
  expect(await runA64InspectionCLI([], ended, first.stream)).toBe(2);
  expect(ended.destroyed).toBe(true);
  expect(() => ended.emit('error', new Error('PRIVATE_SENTINEL'))).not.toThrow();
  expect(() => ended.emit('error', new Error('SECOND_PRIVATE_SENTINEL'))).not.toThrow();
  vi.useFakeTimers(); const stalled = new PassThrough(), second = sink();
  const pending = runA64InspectionCLI([], stalled, second.stream);
  await vi.advanceTimersByTimeAsync(a64InspectionTransportLimits.inputTimeoutMs);
  expect(await pending).toBe(2); expect(stalled.destroyed).toBe(true);
  expect(() => stalled.emit('error', new Error('PRIVATE_SENTINEL'))).not.toThrow();
  expect(() => stalled.emit('error', new Error('SECOND_PRIVATE_SENTINEL'))).not.toThrow();
});
