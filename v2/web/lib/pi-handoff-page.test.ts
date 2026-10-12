import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import Home from '../app/page';

it('renders the real Next home route with a disabled, explicitly synthetic Pi handoff', () => {
  const html = renderToStaticMarkup(createElement(Home));
  expect(html).toContain('Offline Pi handoff — fixture review, not authorization');
  expect(html).toContain('Fixture state: disabled / unavailable');
  expect(html).not.toContain('Prepare synthetic handoff</button>');
  expect(html).toContain('Request fresh exact preview — unavailable');
  expect(html).toContain('Confirm exact terms — unavailable');
});
