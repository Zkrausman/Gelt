import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Readable, Writable } from 'node:stream';
import { canonical } from './ledger-canonical.js';
import { runBoundedDataCLI } from './bounded-data-stdio.js';
import { a64InspectionCommand, executeA64InspectionCommand, rejectA64Command } from './a64-inspection-command.js';
export { a64InspectionTransportLimits } from './a64-inspection-command.js';
const protocol = Object.freeze({
  inputBytes: a64InspectionCommand.inputBytes, outputBytes: a64InspectionCommand.outputBytes,
  descriptionText: canonical(a64InspectionCommand) + '\n', execute: executeA64InspectionCommand, reject: rejectA64Command,
});
export function runA64InspectionCLI(args: readonly string[], input: Readable, output: Writable): Promise<number> {
  return runBoundedDataCLI(args, input, output, protocol);
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  runA64InspectionCLI(process.argv.slice(2), process.stdin, process.stdout)
    .then(code => { process.exitCode = code; })
    .catch(() => { process.exitCode = 74; });
}
