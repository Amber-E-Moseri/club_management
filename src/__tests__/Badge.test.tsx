import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Badge } from '../components/foundation/Badge';

test('renders a badge with variant classes', () => {
  const html = renderToStaticMarkup(<Badge variant="success">Completed</Badge>);

  expect(html).toContain('Completed');
  expect(html).toContain('bg-green-500');
});
