import { beforeAll, describe, expect, it, vi } from 'bun:test';
import type React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: (_path: string) => (options: any) => ({ options }),
  createRootRoute: (options: any) => options,
  HeadContent: () => <meta data-testid="head-content" />,
  Outlet: () => <div data-testid="router-outlet" />,
  Scripts: () => <script data-testid="router-scripts" />,
}));

vi.mock('../components/layout/ConsoleLayout', () => ({
  ConsoleLayout: () => <main>Console layout</main>,
}));

vi.mock('../lib/providers/RootProviders', () => ({
  Providers: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="console-providers">{children}</div>
  ),
}));

let RootRoute: any;

beforeAll(async () => {
  ({ Route: RootRoute } = await import('./__root'));
});

describe('console root route', () => {
  it('exports console metadata and icons', () => {
    const head = RootRoute.head();

    expect(head.meta).toContainEqual({ title: 'TaskForceAI Console' });
    expect(head.meta).toContainEqual({
      name: 'description',
      content: 'Developer console for TaskForceAI - manage API keys and monitor usage.',
    });
    expect(head.links).toContainEqual({
      rel: 'icon',
      href: '/favicon-32x32.png',
      sizes: '32x32',
      type: 'image/png',
    });
  });

  it('renders the dark console shell around providers and scripts', () => {
    const RootLayout = RootRoute.component as React.ComponentType;

    const html = renderToStaticMarkup(<RootLayout />);

    expect(html).toContain('<html lang="en" class="dark">');
    expect(html).toContain('data-testid="head-content"');
    expect(html).toContain('data-testid="console-providers"');
    expect(html).toContain('Console layout');
    expect(html).toContain('data-testid="router-scripts"');
  });
});
