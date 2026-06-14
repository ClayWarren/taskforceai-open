import { beforeAll, describe, expect, it, vi } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('@taskforceai/ui-kit', () => ({
  CookieBanner: () => <div data-testid="cookie-banner" />,
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="error-boundary">{children}</div>
  ),
  QueryProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="query-provider">{children}</div>
  ),
  StructuredData: ({ siteUrl }: { siteUrl: string }) => (
    <script data-testid="structured-data" data-site-url={siteUrl} />
  ),
}));

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: (_path: string) => (options: any) => ({ options }),
  createRootRoute: (options: any) => options,
  HeadContent: () => <meta data-testid="head-content" />,
  Link: ({
    children,
    to,
    ...props
  }: {
    children: React.ReactNode;
    to: string;
  } & React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
  notFound: () => new Error('Not Found'),
  Outlet: () => <main data-testid="root-outlet" />,
  redirect: (options: { to: string }) => new Error(`Redirect to ${options.to}`),
  Scripts: () => <script data-testid="router-scripts" />,
}));

vi.mock('@/env', () => ({
  env: {
    NEXT_PUBLIC_SITE_URL: 'https://marketing.example.test',
  },
}));

let RootRoute: any;

beforeAll(async () => {
  ({ Route: RootRoute } = await import('./__root'));
});

describe('Root route', () => {
  it('exports global metadata and icon links', () => {
    const head = RootRoute.head();

    expect(head.meta).toContainEqual({ title: 'TaskForceAI' });
    expect(head.meta).toContainEqual({
      property: 'og:url',
      content: 'https://www.taskforceai.chat/home',
    });
    expect(head.meta).toContainEqual({ name: 'twitter:card', content: 'summary_large_image' });
    expect(head.meta).toContainEqual({ name: 'twitter:creator', content: '@taskforceai' });
    expect(head.links).toContainEqual({ rel: 'manifest', href: '/manifest.json' });
    expect(head.links).toContainEqual({
      rel: 'icon',
      type: 'image/png',
      sizes: '32x32',
      href: '/favicon-32x32.png',
    });
    expect(head.links).toContainEqual({ rel: 'apple-touch-icon', href: '/apple-touch-icon.png' });
  });

  it('renders the document shell around routed content and scripts', () => {
    const RootLayout = RootRoute.component as React.ComponentType;
    const html = renderToStaticMarkup(<RootLayout />);

    expect(html).toContain('<html lang="en">');
    expect(html).toContain('data-testid="head-content"');
    expect(html).toContain('data-testid="query-provider"');
    expect(html).toContain('data-testid="structured-data"');
    expect(html).toContain('data-site-url="https://www.taskforceai.chat"');
    expect(html).toContain('data-testid="error-boundary"');
    expect(html).toContain('data-testid="root-outlet"');
    expect(html).toContain('data-testid="cookie-banner"');
    expect(html).toContain('data-testid="router-scripts"');
  });
});
