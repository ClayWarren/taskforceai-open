import { render, screen } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'bun:test';
import React from 'react';

const warnCalls: Array<unknown[]> = [];

vi.mock('@/lib/logger', () => ({
  logger: {
    warn: (...args: unknown[]) => {
      warnCalls.push(args);
    },
  },
}));

vi.mock('@/components/changelog/ChangelogPanel', () => ({
  default: (props: { content?: string; lastUpdated?: string }) => (
    <section data-testid="changelog-panel">
      <time>{props.lastUpdated}</time>
      <div>{props.content}</div>
    </section>
  ),
}));

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: (_path: string) => (options: any) => {
    let loaderData: unknown;
    return {
      options,
      useLoaderData: () => loaderData,
      __setLoaderData: (next: unknown) => {
        loaderData = next;
      },
    };
  },
  Link: ({
    children,
    to,
    ...props
  }: {
    children: React.ReactNode;
    to: string;
  } & React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={to} data-router-link="true" {...props}>
      {children}
    </a>
  ),
}));

let Route: any;
let parseChangelog: (content: string) => { content: string; lastUpdated?: string };

beforeAll(async () => {
  ({ Route, parseChangelog } = await import('./index'));
});

beforeEach(() => {
  warnCalls.length = 0;
});

describe('Changelog route', () => {
  it('extracts lastUpdated from bracketed date headings', async () => {
    const result = parseChangelog('## [2026-02-18]\n- Added improvements');

    expect(result).toEqual({
      content: '## [2026-02-18]\n- Added improvements',
      lastUpdated: '2026-02-18',
    });
    expect(warnCalls.length).toBe(0);
  });

  it('extracts lastUpdated from Week-of headings', async () => {
    const result = parseChangelog('## Week of 2026-01-07\n- Weekly updates');

    expect(result.lastUpdated).toBe('2026-01-07');
    expect(warnCalls.length).toBe(0);
  });

  it('returns undefined lastUpdated and logs warning when no date heading exists', async () => {
    const result = parseChangelog('# Changelog\nNo section date here');

    expect(result).toEqual({
      content: '# Changelog\nNo section date here',
      lastUpdated: undefined,
    });
    expect(warnCalls[0]?.[0]).toBe(
      'Regex failed to extract lastUpdated date from changelog content'
    );
  });

  it('loads bundled changelog data and exports metadata', () => {
    const loaderData = Route.options.loader();
    expect(loaderData.content).toContain('TaskForceAI Unified Changelog');
    expect(loaderData.lastUpdated).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const ChangelogPage = Route.options.component as React.ComponentType;
    expect(typeof ChangelogPage).toBe('function');
    const head = Route.options.head();
    expect(head.meta).toContainEqual({ title: 'TaskForceAI Changelog' });
    expect(head.meta).toContainEqual({
      name: 'description',
      content: 'Latest updates, improvements, and fixes across the TaskForceAI platform.',
    });
    expect(head.links).toContainEqual({
      rel: 'canonical',
      href: 'https://www.taskforceai.chat/changelog',
    });
  });

  it('renders the changelog layout with loader data', () => {
    Route.__setLoaderData({
      content: '## [2026-06-13]\n- Marketing app route coverage',
      lastUpdated: '2026-06-13',
    });

    const ChangelogPage = Route.options.component as React.ComponentType;
    render(<ChangelogPage />);

    expect(screen.getByTestId('changelog-panel')).toBeTruthy();
    expect(screen.getByText('2026-06-13')).toBeTruthy();
    expect(screen.getByText(/Marketing app route coverage/)).toBeTruthy();
  });
});
