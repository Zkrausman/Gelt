import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import Orders from '../app/orders/page';

it('renders the real protected-status route with a disabled, explicitly synthetic Pi handoff', () => {
  const html = renderToStaticMarkup(createElement(Orders));
  expect(html).toContain('Offline Pi handoff — fixture review, not authorization');
  expect(html).toContain('Fixture state: disabled / unavailable');
  expect(html).not.toContain('Prepare synthetic handoff</button>');
  expect(html).toContain('Request fresh exact preview — unavailable');
  expect(html).toContain('Confirm exact terms — unavailable');
});
