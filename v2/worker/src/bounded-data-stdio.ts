import type { Readable, Writable } from 'node:stream';

export const boundedDataTransportLimits = Object.freeze({ inputTimeoutMs: 5000, outputTimeoutMs: 5000, inputChunks: 4096 });
export type DataTransportFailure = 'usage_error' | 'input_transport_failed' | 'input_timeout' | 'resource_limit' | 'invalid_utf8';
export type DataCommandOutput = Readonly<{ exitCode: number; text: string }>;
// Internal compiled-source configuration only. No request, argv or environment
// field can supply a handler, description or resource limit.
export type BoundedDataProtocol = Readonly<{
  inputBytes: number; outputBytes: number; descriptionText: string;
  execute: (text: unknown) => DataCommandOutput;
  reject: (reason: DataTransportFailure) => DataCommandOutput;
}>;

// One finite stdin document. No filename arguments, environment configuration,
// readline history, filesystem discovery, subprocess, network or persisted data.
function readInput(input: Readable, protocol: BoundedDataProtocol): Promise<string | DataCommandOutput> {
  return new Promise(resolveInput => {
    const chunks: Buffer[] = [];
    let bytes = 0, count = 0, settled = false;
    const finish = (value: string | DataCommandOutput) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      input.off('data', data); input.off('end', end); input.off('error', error); input.off('close', close);
      input.pause();
      // This command owns its stdin; stop reading on every terminal outcome.
      // The owned input stays terminal; repeated delayed errors must not leak
      // exception details after EOF, cancellation or timeout either.
      input.on('error', () => {});
      input.destroy();
      chunks.length = 0;
      resolveInput(value);
    };
    const data = (chunk: unknown) => {
      if (!Buffer.isBuffer(chunk)) return finish(protocol.reject('input_transport_failed'));
      if (++count > boundedDataTransportLimits.inputChunks
        || chunk.length > protocol.inputBytes - bytes) {
        return finish(protocol.reject('resource_limit'));
      }
      bytes += chunk.length;
      chunks.push(Buffer.from(chunk));
    };
    const end = () => {
      try { finish(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(Buffer.concat(chunks, bytes))); }
      catch { finish(protocol.reject('invalid_utf8')); }
    };
    const error = () => finish(protocol.reject('input_transport_failed'));
    const close = () => { if (!input.readableEnded) error(); };
    const timer = setTimeout(() => finish(protocol.reject('input_timeout')), boundedDataTransportLimits.inputTimeoutMs);
    input.on('data', data); input.once('end', end); input.once('error', error); input.once('close', close);
    if (input.destroyed || input.readableEnded) error();
  });
}

function writeOutput(output: Writable, text: string): Promise<boolean> {
  return new Promise(resolveOutput => {
    let settled = false, writeSucceeded = false, finished = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      output.off('finish', onFinish); output.off('close', onClose);
      // Keep the owned stream's error guard even after terminal close/timeout:
      // delayed callbacks or destruction errors must not expose exception text.
      if (!ok) { try { output.destroy(); } catch { /* generic output failure */ } }
      resolveOutput(ok);
    };
    const error = () => finish(false);
    // Node's stdio wrapper can reset stream flags during destruction. Bind
    // completion to the observed callback -> finish -> close events instead of
    // re-reading reset flags after close; this is not an OS-release guarantee.
    const onClose = () => finish(writeSucceeded && finished);
    const onFinish = () => {
      if (!writeSucceeded || !output.writableFinished) return finish(false);
      finished = true;
      // Join this command's owned output lifecycle, including asynchronous
      // destruction; a successful write callback alone is not completion.
      try { output.destroy(); } catch { finish(false); }
    };
    const timer = setTimeout(error, boundedDataTransportLimits.outputTimeoutMs);
    output.on('error', error); output.once('finish', onFinish); output.once('close', onClose);
    if (output.destroyed || output.writableEnded) return finish(false);
    try {
      output.write(text, failure => {
        if (settled || writeSucceeded) return;
        if (failure) return finish(false);
        writeSucceeded = true;
        try { output.end(); } catch { finish(false); }
      });
    } catch { finish(false); }
  });
}

export async function runBoundedDataCLI(
  args: readonly string[], input: Readable, output: Writable, protocol: BoundedDataProtocol,
): Promise<number> {
  let result: DataCommandOutput;
  if (args.length === 1 && args[0] === '--describe') {
    result = { exitCode: 0, text: protocol.descriptionText };
  } else if (args.length !== 0) {
    result = protocol.reject('usage_error');
  } else {
    const value = await readInput(input, protocol);
    result = typeof value === 'string' ? protocol.execute(value) : value;
  }
  if (Buffer.byteLength(result.text, 'utf8') > protocol.outputBytes) result = protocol.reject('resource_limit');
  if (Buffer.byteLength(result.text, 'utf8') > protocol.outputBytes) return 74;
  // Output errors give no partial-success claim or raw exception to stderr.
  return await writeOutput(output, result.text) ? result.exitCode : 74;
}
