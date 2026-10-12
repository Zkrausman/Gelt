// Synthetic unit input only. The browser delivery fixture is separately recorded
// by exercising the real G02 mock core; this object is never loaded by startup.
export function simulationViewTestFixture() {
  return { version: 1, source: 'gelt-recorded-mock-view-v1', runs: [{ id: 'recorded-unit', label: 'Unit fixture', recordedAt: '2026-10-12T00:00:00.000Z', decision: 'scripted_fixture_not_agent', paper: 'not_linked',
    requested: { instrument: 'SYNTH-RH-USD', quantity: { value: '0.010', precision: 4, scale: 3 }, limitPrice: { value: '0.90', precision: 3, scale: 2 }, currency: 'USD' },
    history: { source: 'synthetic-offline-v1', syntheticIntentId: '00000000-0000-4000-8000-000000000001', eventCount: 1, facts: [{ source: 'synthetic-offline-v1', occurredAt: '2026-10-12T00:00:00.000Z', syntheticType: 'dispatch-outcome-unknown' }] },
    mock: { source: 'gelt-synthetic-robinhood-mock-v1', dispatchId: '00000000-0000-4000-8000-000000000001', mockOrderId: 'mock-unit', previewId: '00000000-0000-4000-8000-000000000002', status: 'accepted', executions: [], cancelAcknowledged: false },
  }] };
}
