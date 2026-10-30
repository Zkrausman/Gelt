import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Readable, Writable } from 'node:stream';
import { canonical } from './ledger-canonical.js';
import { runBoundedDataCLI } from './bounded-data-stdio.js';
import { pamrProposalCommand, executePAMRProposalCommand, rejectPAMRProposalCommand } from './pamr-proposal-command.js';

const protocol = Object.freeze({
  inputBytes: pamrProposalCommand.inputBytes, outputBytes: pamrProposalCommand.outputBytes,
  descriptionText: canonical(pamrProposalCommand) + '\n', execute: executePAMRProposalCommand, reject: rejectPAMRProposalCommand,
});
export function runPAMRProposalCLI(args: readonly string[], input: Readable, output: Writable): Promise<number> {
  return runBoundedDataCLI(args, input, output, protocol);
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  runPAMRProposalCLI(process.argv.slice(2), process.stdin, process.stdout)
    .then(code => { process.exitCode = code; })
    .catch(() => { process.exitCode = 74; });
}
