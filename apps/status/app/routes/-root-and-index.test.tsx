import '@testing-library/jest-dom';

import { cleanup, render, screen } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it, mock } from 'bun:test';
import type React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import '../../../../tests/setup/dom';

mock.restore();

mock.module('@tanstack/react-router', () => ({
  createFileRoute: (_path: string) => (options: any) => ({ options }),
  createRootRoute: (options: any) => options,
  HeadContent: () => <meta data-testid="head-content" />,
  Outlet: () => <div data-testid="router-outlet" />,
  Scripts: () => <script data-testid="router-scripts" />,
}));

let RootRoute: any;
let IndexRoute: any;
let StatusPage: React.ComponentType;

beforeAll(async () => {
  ({ Route: RootRoute } = await import('./__root'));
  ({ Route: IndexRoute } = await import('./index'));
  ({ StatusPage } = await import('../components/status/StatusPage'));
});

afterAll(() => {
  mock.restore();
});

afterEach(() => {
  cleanup();
});

describe('status root and index routes', () => {
  it('exports status metadata and icons', () => {
    const head = RootRoute.head();

    expect(head.meta).toContainEqual({ title: 'TaskForceAI System Status' });
    expect(head.meta).toContainEqual({
      name: 'description',
      content: 'Real-time system status and uptime for TaskForceAI services.',
    });
    expect(head.links).toContainEqual({
      rel: 'icon',
      href: '/favicon-32x32.png',
      sizes: '32x32',
      type: 'image/png',
    });
  });

  it('wraps the outlet in the status error boundary', () => {
    const RootLayout = RootRoute.component as React.ComponentType;

    const html = renderToStaticMarkup(<RootLayout />);

    expect(html).toContain('data-testid="head-content"');
    expect(html).toContain('data-testid="router-outlet"');
    expect(html).toContain('data-testid="router-scripts"');
  });

  it('renders the status not-found recovery link', () => {
    const NotFound = RootRoute.notFoundComponent as React.ComponentType;

    render(<NotFound />);

    expect(screen.getByText('TaskForceAI')).toBeInTheDocument();
    expect(screen.getByText('Page not found')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Return to status overview' }).getAttribute('href')
    ).toBe('/');
  });

  it('renders the public status overview route', () => {
    expect(IndexRoute.options.component).toBe(StatusPage);
  });
});
