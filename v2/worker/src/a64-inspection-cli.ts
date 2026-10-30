import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Readable, Writable } from 'node:stream';
import { canonical } from './ledger-canonical.js';
import {
  a64InspectionCommand, executeA64InspectionCommand, rejectA64Command,
  a64InspectionTransportLimits,
  type A64CommandOutput,
} from './a64-inspection-command.js';

export { a64InspectionTransportLimits } from './a64-inspection-command.js';

// One finite stdin document. No filename arguments, environment configuration,
// readline history, filesystem discovery, subprocess, network or persisted data.
function readInput(input: Readable): Promise<string | A64CommandOutput> {
  return new Promise(resolveInput => {
    const chunks: Buffer[] = [];
    let bytes = 0, count = 0, settled = false;
    const finish = (value: string | A64CommandOutput) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      input.off('data', data); input.off('end', end); input.off('error', error); input.off('close', close);
      input.pause();
      // This command owns its stdin; stop reading on every terminal outcome.
      input.once('error', () => {});
      input.destroy();
      chunks.length = 0;
      resolveInput(value);
    };
    const data = (chunk: unknown) => {
      if (!Buffer.isBuffer(chunk)) return finish(rejectA64Command('input_transport_failed'));
      if (++count > a64InspectionTransportLimits.inputChunks
        || chunk.length > a64InspectionCommand.inputBytes - bytes) {
        return finish(rejectA64Command('resource_limit'));
      }
      bytes += chunk.length;
      chunks.push(Buffer.from(chunk));
    };
    const end = () => {
      try { finish(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(Buffer.concat(chunks, bytes))); }
      catch { finish(rejectA64Command('invalid_utf8')); }
    };
    const error = () => finish(rejectA64Command('input_transport_failed'));
    const close = () => { if (!input.readableEnded) error(); };
    const timer = setTimeout(() => finish(rejectA64Command('input_timeout')), a64InspectionTransportLimits.inputTimeoutMs);
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
    const timer = setTimeout(error, a64InspectionTransportLimits.outputTimeoutMs);
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

export async function runA64InspectionCLI(
  args: readonly string[], input: Readable, output: Writable,
): Promise<number> {
  let result: A64CommandOutput;
  if (args.length === 1 && args[0] === '--describe') {
    result = { exitCode: 0, text: canonical(a64InspectionCommand) + '\n' };
  } else if (args.length !== 0) {
    result = rejectA64Command('usage_error');
  } else {
    const value = await readInput(input);
    result = typeof value === 'string' ? executeA64InspectionCommand(value) : value;
  }
  // Output errors give no partial-success claim or raw exception to stderr.
  return await writeOutput(output, result.text) ? result.exitCode : 74;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  runA64InspectionCLI(process.argv.slice(2), process.stdin, process.stdout)
    .then(code => { process.exitCode = code; })
    .catch(() => { process.exitCode = 74; });
}
