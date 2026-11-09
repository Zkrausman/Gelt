import { expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { canonical } from './ledger-canonical.js';
import { evidence, copy, profile, owner, credentials, transport, clock } from './a64-observed-snapshot.test-support.js';
import { assessObservedEvidence, observedArtifactForData } from './a64-observed-snapshot-evidence.js';
import { reserveObservedOriginal, isConnectorIssuedAlpacaAcquisition, verifyObservedAcquisitionData, acquireObservedSnapshot } from './alpaca-iex-connector.js';
import { observedHash, observedLimits } from './alpaca-observed-snapshot-contract.js';
import { verifySpy253PAMRInspectionData, verifyPAMRArtifact } from './pamr-reference-artifact.js';
import { assessA64InspectionEvidence } from './pamr-a64-inspection-evidence.js';
import { derivePAMRConsumerPrefix } from './pamr-consumer-adapter.js';
it('recomputes bytes/selection/math under new identities; old paths reject', async () => {
    const f = await evidence(), r = assessObservedEvidence(f.text);
    expect(r.status).toBe('assessed_data');
    if (r.status !== 'assessed_data')
        throw Error('bad synthetic evidence');
    expect(r.value).toMatchObject({ completion: 'unknown', vintage: 'unknown', historyUpdates: 64, consumptionAttempts: 0, operationalDecisions: 0, persistence: 'not_performed', provenance: 'serialized_declarations_not_private_issuance' });
    expect(f.artifact.steps).toHaveLength(64);
    expect(f.artifact.steps.every(s => s.tau === '0/1' && s.loss === '1/2' && canonical(s.weightsAfter) === '["1/2","1/2"]')).toBe(true);
    expect(f.artifact.request.rows).toEqual(Array.from({ length: 64 }, () => ['1', '1']));
    expect(Buffer.byteLength(f.text)).toBeLessThan(observedLimits.input);
    expect(isConnectorIssuedAlpacaAcquisition(f.original)).toBe(false);
    expect(() => reserveObservedOriginal(copy(f.original), f.p)).toThrow();
    reserveObservedOriginal(f.original, f.p);
    expect(() => reserveObservedOriginal(f.original, f.p)).toThrow();
    expect(verifySpy253PAMRInspectionData(canonical(f.artifact)).status).toBe('rejected');
    expect(verifyPAMRArtifact(canonical(f.artifact)).status).toBe('rejected');
    expect(assessA64InspectionEvidence(f.text).status).toBe('rejected');
    expect(() => derivePAMRConsumerPrefix(canonical(f.artifact))).toThrow();
});
it('rejects coherent hash rewrites without complete recomputation and forged timing/claims', async () => {
    const f = await evidence();
    for (const mutate of [(x: any) => x.original.observations[0].close.value = '101', (x: any) => { const p = x.original.pages[0], b = Buffer.from(p.bodyBase64, 'base64').toString().replace('"c":100', '"c":101'); p.bodyBase64 = Buffer.from(b).toString('base64'); p.byteLength = Buffer.byteLength(b); p.sha256 = createHash('sha256').update(b).digest('hex'); }, (x: any) => x.artifact.steps[0].weightsAfter = ['0/1', '1/1'], (x: any) => x.context.inspectionStart.mono = 0, (x: any) => x.binding.ownerNamespaceSha256 = 'c'.repeat(64), (x: any) => x.original.request.pageRequests[2].limit = 52, (x: any) => x.original.vintage = 'final', (x: any) => x.context.qualified = true, (x: any) => x.artifact.schema = 'gelt.pamr-inert-candidate.v1']) {
        const x = JSON.parse(f.text);
        mutate(x);
        x.context.originalBundleSha256 = observedHash('original-bundle', x.original);
        expect(assessObservedEvidence(canonical(x)).status).toBe('rejected');
    }
    const bad = copy(f.original);
    bad.pages[0].bodyBase64 += '\n';
    expect(verifyObservedAcquisitionData(bad)).toBe(false);
    expect(assessObservedEvidence(f.text.slice(0, -1)).status).toBe('rejected');
    expect(assessObservedEvidence('x'.repeat(observedLimits.input + 1)).status).toBe('rejected');
});
it('binds newest65 with exact ratios and rejects nonterminating math instead of rounding', async () => {
    const p = profile(), t = transport(p, [100, 100, 53], i => i === 0 ? '200' : '100'), original = await acquireObservedSnapshot(p, credentials, { fetcher: t.fetcher, clock: clock() }), a = observedArtifactForData(original, owner(p));
    expect(a.request.rows[63]).toEqual(['2', '1']);
    expect(a.steps[63]).toMatchObject({ loss: '1/1', tau: '2/1', weightsAfter: ['0/1', '1/1'] });
    expect(a.request.rows.slice(0, 63)).toEqual(Array.from({ length: 63 }, () => ['1', '1']));
    const t2 = transport(p, [100, 100, 53], i => i === 1 ? '3' : '100'), o = await acquireObservedSnapshot(p, credentials, { fetcher: t2.fetcher, clock: clock() });
    expect(() => observedArtifactForData(o, owner(p))).toThrow('Observed evidence unavailable');
});
it('accepts the aggregate exact byte cap and rejects one byte over without truncation', async () => {
    const f = await evidence(), at = f.text + ' '.repeat(observedLimits.input - Buffer.byteLength(f.text));
    expect(Buffer.byteLength(at)).toBe(observedLimits.input);
    expect(assessObservedEvidence(at).status).toBe('assessed_data');
    expect(assessObservedEvidence(at + ' ').status).toBe('rejected');
});
