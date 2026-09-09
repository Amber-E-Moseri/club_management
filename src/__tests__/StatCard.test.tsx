import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StatCard } from '../components/feature/StatCard';
import { Badge } from '../components/foundation/Badge';

test('renders StatCard label, value, subtext, and badge', () => {
  const html = renderToStaticMarkup(
    <StatCard
      label="Members"
      value={42}
      sub="3 this month"
      badge={<Badge variant="primary">New</Badge>}
    />,
  );

  expect(html).toContain('Members');
  expect(html).toContain('42');
  expect(html).toContain('3 this month');
  expect(html).toContain('New');
});
