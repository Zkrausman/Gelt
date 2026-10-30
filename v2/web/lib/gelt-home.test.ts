import { expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Home from '../app/page';
import SimulationWorkspace from '../components/SimulationWorkspace';

it('renders an evidence-first home without exposing or inventing account, candidate or execution data', () => {
  const html = renderToStaticMarkup(createElement(Home));
  for (const text of ['Evidence before execution.', 'Qualification NOT_READY', 'production CLOSED', 'operations DEFER', 'UNKNOWN', '/research', '/orders', '/simulation', '/history', '/connect']) expect(html).toContain(text);
  for (const prohibited of ['<input', '<iframe', 'OPENTERMINAL', 'portfolio balance', 'NYSE OPEN']) expect(html).not.toContain(prohibited);
  expect(html).toContain('not a live runtime or account-health report');
  expect(html).toContain('not a live shadow campaign');
});

it('renders all recorded-data sections without a viewer grant or persisted market widgets', () => {
  const html = renderToStaticMarkup(createElement(SimulationWorkspace));
  for (const text of ['Recorded simulation results', 'run', 'paper', 'data', 'decision', 'orders', 'results', 'No recorded run selected', 'Open viewer session']) expect(html).toContain(text);
  expect(html).toMatch(/disabled=""[^>]*>Load recorded runs/);
  expect(html).not.toContain('<tbody');
  expect(html).not.toContain('AI Assistant');
  expect(html).not.toContain('OPENTERMINAL');
});
