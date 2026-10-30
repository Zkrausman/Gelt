import { PassThrough, Readable, Writable } from 'node:stream';
import { afterEach, expect, it, vi } from 'vitest';
import { executePAMRProposalCommand, pamrProposalCommand } from './pamr-proposal-command.js';
import { runPAMRProposalCLI } from './pamr-proposal-cli.js';
import { boundedDataTransportLimits } from './bounded-data-stdio.js';

afterEach(() => vi.useRealTimers());
function sink() {
  const chunks: Buffer[] = [];
  const output = new Writable({ write(b, _e, done) { chunks.push(Buffer.from(b)); done(); } });
  return { output, text: () => Buffer.concat(chunks).toString('utf8') };
}
const wrap = (inputText: string) => JSON.stringify({ schema: pamrProposalCommand.requestSchema, operation: 'propose', inputText });

it('describes fixed constructed-only operations and holds without reading stdin', async () => {
  const s = sink(), input = new PassThrough();
  expect(await runPAMRProposalCLI(['--describe'], input, s.output)).toBe(0);
  expect(input.readableFlowing).toBeNull(); input.destroy();
  expect(JSON.parse(s.text())).toEqual(pamrProposalCommand);
  expect(JSON.parse(s.text())).toMatchObject({ dataOperations: ['propose', 'verify'], classification: 'constructed_offline_test',
    inputBytes: 262144, outputBytes: 8192, effectAuthority: 'none', dispatchAllowed: false, promotionAllowed: false,
    consumption: 'not_performed', authenticity: 'not_established', production: 'CLOSED', operations: 'DEFER' });
});

it('rejects absent/legacy/detached and unsupported effect or callback requests without reflection', () => {
  for (const raw of [null, {}, '', '{}', '{"schema":1,"schema":2}',
    JSON.stringify({ schema: pamrProposalCommand.requestSchema, operation: 'dispatch', inputText: 'PRIVATE_SENTINEL' }),
    JSON.stringify({ schema: pamrProposalCommand.requestSchema, operation: 'propose', inputText: '{}', verifier: 'PRIVATE_SENTINEL' }),
    JSON.stringify({ schema: pamrProposalCommand.requestSchema, operation: 'verify', inputText: '{}' }),
    JSON.stringify({ schema: 'gelt.pamr-consumer-proposal.v1', proposalId: 'PRIVATE_SENTINEL' }),
  ]) {
    const r = executePAMRProposalCommand(raw); expect(r.exitCode).toBe(2);
    expect(JSON.parse(r.text)).toMatchObject({ status: 'rejected', reason: 'invalid_input', C07: 'UNKNOWN', C13: 'UNKNOWN', C14: 'UNKNOWN' });
    expect(r.text).not.toContain('PRIVATE_SENTINEL');
  }
});

it('bounds aggregate/inner proposal and valid UTF16 before decoding or matching', () => {
  for (const raw of [' '.repeat(262145), JSON.stringify({ schema: pamrProposalCommand.requestSchema, operation: 'verify', inputText: '{}', proposalText: ' '.repeat(8193) })]) {
    expect(JSON.parse(executePAMRProposalCommand(raw).text).reason).toBe('resource_limit');
  }
  for (const raw of ['\ud800', wrap('\udfff')]) expect(JSON.parse(executePAMRProposalCommand(raw).text).reason).toBe('invalid_input');
  expect(JSON.parse(executePAMRProposalCommand(' '.repeat(262144)).text).reason).toBe('invalid_input');
});

it('retains the shared once-only lifecycle and invalid-argument privacy in the second entry', async () => {
  const s = sink(); expect(await runPAMRProposalCLI(['--dispatch', '/private/SECRET'], new PassThrough(), s.output)).toBe(64);
  expect(s.text()).not.toContain('/private/SECRET'); expect(s.text()).not.toContain('--dispatch');
  let writes = 0;
  const failed = new Writable({
    write(_b, _e, done) { writes++; done(); },
    destroy(_error, done) { setImmediate(() => done(new Error('PRIVATE_SENTINEL'))); },
  });
  expect(await runPAMRProposalCLI(['--describe'], new PassThrough(), failed)).toBe(74);
  expect(writes).toBe(1); await new Promise(resolve => setImmediate(resolve));
  expect(() => failed.emit('error', new Error('SECOND_PRIVATE_SENTINEL'))).not.toThrow();
});

it('rejects strict UTF8, stalled input and output in the second fixed command without retries', async () => {
  const bad = sink(); expect(await runPAMRProposalCLI([], Readable.from([Buffer.from([0xff])]), bad.output)).toBe(2);
  expect(JSON.parse(bad.text()).reason).toBe('invalid_utf8');
  vi.useFakeTimers(); const input = new PassThrough(), s = sink();
  const pending = runPAMRProposalCLI([], input, s.output);
  await vi.advanceTimersByTimeAsync(boundedDataTransportLimits.inputTimeoutMs);
  expect(await pending).toBe(2); expect(JSON.parse(s.text()).reason).toBe('input_timeout');
  let writes = 0; const output = new Writable({ write() { writes++; } });
  const stalled = runPAMRProposalCLI(['--describe'], new PassThrough(), output);
  await vi.advanceTimersByTimeAsync(boundedDataTransportLimits.outputTimeoutMs);
  expect(await stalled).toBe(74); expect(writes).toBe(1);
});

it('preserves whole-input validator rejection through actual stdin without copied input or raw exceptions', async () => {
  const input = wrap('{"private":"PRIVATE_SENTINEL"}'), s = sink();
  expect(await runPAMRProposalCLI([], Readable.from([Buffer.from(input)]), s.output)).toBe(2);
  expect(s.text()).toBe(executePAMRProposalCommand(input).text);
  expect(s.text()).not.toContain('PRIVATE_SENTINEL'); expect(Buffer.byteLength(s.text())).toBeLessThanOrEqual(8192);
  expect(JSON.parse(s.text())).toMatchObject({ effectAuthority: 'none', dispatchAllowed: false, qualification: 'NOT_READY' });
});
