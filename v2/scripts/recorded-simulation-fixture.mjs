import assert from 'node:assert/strict';
import { request } from 'node:http';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { rmSync } from 'node:fs';
import { createSyntheticOrderHarness } from '../worker/dist/synthetic-order-harness.js';
import { storageFixture } from '../worker/dist/storage-fixture.js';
import { privateDirectory, writePrivateNew, readPrivate } from '../worker/dist/private-files.js';
import { simulationSnapshotSchema, simulationViewMaxBytes } from '../worker/dist/simulation-view-contract.js';

// Fresh G03 recorded fixtures only. No agent/market input or new ledger is introduced.
export async function createRecordedSimulationFixture() {
  if (process.env.NODE_ENV !== 'test' || process.env.GELT_SYNTHETIC_ORDER_HARNESS !== 'offline-test-only'
    || process.env.GELT_SYNTHETIC_MOCK_ROBINHOOD !== 'offline-test-only') throw Error('Explicit recorded-fixture gates required');
  const runs = [];
  for (const scenario of ['partial-cancel', 'unknown']) {
    const now = Date.now();
    const fixture = createSyntheticOrderHarness(() => now, { applicationMock: true, mockRequestTimeoutMsForTest: 30000 });
    const fixtureRoot = dirname(dirname(fixture.path));
    let closed = false, closeAttempted = false;
    try {
      const port = await fixture.start();
      const call = async (operation, value = {}) => {
        const body = JSON.stringify(value);
        return new Promise((resolve, reject) => {
          const req = request({ hostname: '127.0.0.1', port, signal: AbortSignal.timeout(45000), path: `/v1/synthetic-orders/${operation}`, method: 'POST', headers: {
            Host: `127.0.0.1:${port}`, Authorization: `Bearer ${fixture.auth.bearer}`, 'X-Gelt-Session': fixture.auth.session,
            'X-Gelt-Session-Expires': String(fixture.auth.expiresAt), 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body),
          } }, res => {
            let bytes = 0; const chunks = [];
            res.on('data', chunk => { bytes += chunk.length; if (bytes > simulationViewMaxBytes) res.destroy(Error('Large fixture response')); else chunks.push(chunk); });
            res.once('error', reject); res.once('aborted', () => reject(Error('Fixture response aborted')));
            res.once('end', () => { try { assert.equal(res.statusCode, 200); const envelope = JSON.parse(Buffer.concat(chunks).toString('utf8')); assert.equal(envelope.source, 'synthetic-offline-v1'); resolve(envelope.value); } catch (e) { reject(e); } });
          });
          req.once('error', reject); req.end(body);
        });
      };
      const order = { route: 'RHS', instrumentId: 'SYNTH-RH-USD', side: 'buy', requestedQuantity: { value: '0.010', precision: 4, scale: 3 }, requestedLimitPrice: { value: '0.90', precision: 3, scale: 2 }, currency: 'USD' };
      await call('resume'); const preview = await call('preview', order);
      if (scenario === 'unknown') fixture.mockTransport.loseNextSubmitResponseForTest();
      const confirmation = await call('confirm', { confirmationToken: preview.confirmationToken, termsHash: preview.termsHash });
      assert.equal(confirmation.outcome, scenario === 'unknown' ? 'unknown' : 'acknowledged');
      const dispatchId = confirmation.intentId;
      if (scenario === 'partial-cancel') {
        fixture.mockStore.observeExecution(dispatchId, { executionId: 'recorded-fill-a', quantity: { value: '0.004', precision: 4, scale: 3 }, price: { value: '0.90', precision: 3, scale: 2 }, fee: { value: '0.003', precision: 4, scale: 3 }, currency: 'USD' });
        await call('reconcile'); await call('cancel', { intentId: dispatchId });
        fixture.mockStore.settleCanceled(dispatchId); await call('reconcile');
      }
      const history = await call('history'), independent = await call('mock-history', { dispatchId });
      assert.equal(history.items.length, 1); assert.ok(independent.order);
      assert.equal(independent.order.status, scenario === 'unknown' ? 'accepted' : 'canceled');
      assert.equal(independent.order.executions.length, scenario === 'unknown' ? 0 : 1);
      assert.equal(history.items[0].facts.some(f => f.syntheticType === 'dispatch-outcome-unknown'), scenario === 'unknown');
      runs.push({ id: `recorded-${scenario}`, label: scenario === 'unknown' ? 'Unknown dispatch · no observed fill' : 'Partial fill · cancellation settled', recordedAt: new Date(now).toISOString(), decision: 'scripted_fixture_not_agent', paper: 'not_linked',
        requested: { instrument: order.instrumentId, quantity: order.requestedQuantity, limitPrice: order.requestedLimitPrice, currency: order.currency }, history: history.items[0], mock: independent.order });
      closeAttempted = true; await fixture.close(); closed = true;
    } finally {
      if (!closeAttempted) { closeAttempted = true; try { await fixture.close(); closed = true; } catch { /* retain uncertain root; never retry close */ } }
      if (closed) { privateDirectory(fixtureRoot); rmSync(fixtureRoot, { recursive: true, force: false }); }
    }
  }
  const snapshot = simulationSnapshotSchema.parse({ version: 1, source: 'gelt-recorded-mock-view-v1', runs });
  const bytes = Buffer.from(JSON.stringify(snapshot)); assert.ok(bytes.length <= simulationViewMaxBytes - 1024);
  const root = storageFixture('gelt-recorded-view-'), path = join(root, 'recorded.json');
  writePrivateNew(path, bytes.toString('utf8'));
  const digest = createHash('sha256').update(bytes).digest('hex');
  return { path, digest, snapshot, close() {
    privateDirectory(root); assert.equal(createHash('sha256').update(readPrivate(path)).digest('hex'), digest, 'Uncertain snapshot retained');
    rmSync(root, { recursive: true, force: false });
  } };
}
