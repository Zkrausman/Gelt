import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Readable, Writable } from 'node:stream';
import { z } from 'zod';
import { canonical } from './ledger-canonical.js';
import { runBoundedDataCLI, boundedDataTransportLimits, type DataTransportFailure } from './bounded-data-stdio.js';
import { A64ObservedSnapshotReceiptStore } from './a64-observed-snapshot-receipt.js';
import { observedBindingSchema, observedClaims, observedRejectionReasonSchema, parseObservedText, ObservedSnapshotError } from './alpaca-observed-snapshot-contract.js';

const inputSchema = 'gelt.agent.a64-observed-receipt-inspection-input.v1';
const limits = Object.freeze({ inputBytes: 8192, rootBytes: 4096, outputBytes: 8192 });
const input = z.object({ schema: z.literal(inputSchema),
  root: z.string().min(1).max(limits.rootBytes).refine(v => !v.includes('\0') && Buffer.byteLength(v) <= limits.rootBytes && resolve(v) === v),
  binding: observedBindingSchema,
}).strict();
const common = Object.freeze({
  ...observedClaims,
  schema: 'gelt.agent.a64-observed-receipt-inspection-response.v1',
  command: 'inspect_a64_observed_receipt',
  meaning: 'existing_retained_evidence_not_operating_admission',
  filesystemAccess: 'owner_supplied_private_store_read_only',
  networkAccess: false, inspectionWrites: 0,
});
export const observedReceiptInspectionCommand = Object.freeze({
  ...common, schema: 'gelt.agent.a64-observed-receipt-inspection-capability.v1',
  inputSchema, ...limits, transport: boundedDataTransportLimits,
  inputFields: Object.keys(input.shape), bindingFields: Object.keys(observedBindingSchema.shape),
  bindingSchema: observedBindingSchema.shape.schema.value,
  supportedPlatform: 'linux',
  locatorMeaning: 'explicit_read_locator_not_authentication',
  storedReceiptSchema: 'gelt.a64-observed-evidence-receipt.v2',
  outputStatuses: ['assessed_data', 'rejected', 'unavailable'],
  rejectionReasons: [...observedRejectionReasonSchema.options, 'usage_error', 'input_transport_failed', 'input_timeout', 'invalid_utf8'],
  unavailableReason: 'evidence_unavailable',
  exits: { completeAssessment: 0, rejectedOrUnavailable: 2, unsupportedArguments: 64, outputUnavailable: 74 },
});
type Failure = DataTransportFailure | 'invalid_input';
function rejection(reason: Failure) {
  return Object.freeze({ exitCode: reason === 'usage_error' ? 64 : 2,
    text: canonical({ ...common, status: 'rejected', reason }) + '\n' });
}

// Explicit read-only library calls only. No acquisition, retention, callback,
// environment configuration, repair or retry. Close failures suppress success.
export function executeObservedReceiptInspection(text: unknown): Readonly<{ exitCode: number; text: string }> {
  let request: z.infer<typeof input>;
  try { request = input.parse(parseObservedText(text, limits.inputBytes)); }
  catch (e) { return rejection(e instanceof ObservedSnapshotError && e.reason === 'resource_limit' ? 'resource_limit' : 'invalid_input'); }
  let store: A64ObservedSnapshotReceiptStore | undefined;
  let data: ReturnType<A64ObservedSnapshotReceiptStore['read']> | undefined;
  let failed = false;
  try { store = A64ObservedSnapshotReceiptStore.reopen(request.root, request.binding); data = store.read(); }
  catch { failed = true; }
  finally { if (store) { try { store.close(); } catch { failed = true; } } }
  if (failed || !data) return Object.freeze({ exitCode: 2,
    text: canonical({ ...common, status: 'unavailable', reason: 'evidence_unavailable' }) + '\n' });
  const response = canonical({ ...common, status: data.receipt.status,
    reason: data.receipt.reason, receipt: data.receipt, assessment: data.assessment }) + '\n';
  if (Buffer.byteLength(response) > limits.outputBytes) return rejection('resource_limit');
  return Object.freeze({ exitCode: data.receipt.status === 'assessed_data' ? 0 : 2, text: response });
}
const protocol = Object.freeze({ ...limits, descriptionText: canonical(observedReceiptInspectionCommand) + '\n',
  execute: executeObservedReceiptInspection, reject: rejection });
export function runObservedReceiptInspectionCLI(args: readonly string[], stdin: Readable, stdout: Writable): Promise<number> {
  return runBoundedDataCLI(args, stdin, stdout, protocol);
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  runObservedReceiptInspectionCLI(process.argv.slice(2), process.stdin, process.stdout)
    .then(code => { process.exitCode = code; }).catch(() => { process.exitCode = 74; });
}
