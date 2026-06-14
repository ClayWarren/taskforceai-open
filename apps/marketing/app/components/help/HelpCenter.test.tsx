import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'bun:test';
import React from 'react';

import { HelpCenter } from './HelpCenter';

const mockHelpCategories = [
  {
    id: 'api',
    title: 'API',
    description: 'REST API authentication and endpoints.',
    icon: 'Server',
  },
  {
    id: 'mobile',
    title: 'Mobile',
    description: 'iOS and Android applications.',
    icon: 'Smartphone',
  },
  {
    id: 'getting-started',
    title: 'Getting Started',
    description: 'New to TaskForceAI? Start here.',
    icon: 'Rocket',
  },
];

const mockHelpArticles = [
  {
    slug: 'api-authentication',
    categoryId: 'api',
    title: 'API authentication',
    description: 'Authenticate your API requests.',
    content: 'Use an API key to authenticate your requests.',
    lastUpdated: '2025-01-15',
  },
  {
    slug: 'syncing-across-devices',
    categoryId: 'mobile',
    title: 'Syncing across devices',
    description: 'Keep your conversations in sync everywhere.',
    content: 'Sync ensures your conversations stay up to date.',
    lastUpdated: '2025-01-15',
  },
];

function resolveHref(to: string, params?: Record<string, string>) {
  if (!params) {
    return to;
  }

  let resolvedHref = to;
  for (const [key, value] of Object.entries(params)) {
    resolvedHref = resolvedHref.replace(`$${key}`, value);
  }
  return resolvedHref;
}

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    params,
    ...props
  }: {
    children: React.ReactNode;
    to: string;
    params?: Record<string, string>;
  } & React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={resolveHref(to, params)} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('../../help-data/categories', () => ({
  helpCategories: mockHelpCategories,
}));

vi.mock('../../help-data/articles', () => ({
  helpArticles: mockHelpArticles,
}));

describe('HelpCenter', () => {
  it('renders category links when search is empty', () => {
    render(<HelpCenter />);

    expect(screen.getByRole('heading', { name: 'How can we help?' })).toBeTruthy();
    expect(screen.getAllByRole('link').length).toBe(mockHelpCategories.length);
    expect(screen.queryByText('No articles found matching your search.')).toBeNull();
  });

  it('shows per-category article counts and category route links', () => {
    render(<HelpCenter />);

    const apiCategoryCard = screen.getByText('API').closest('a');
    expect(apiCategoryCard?.getAttribute('href')).toBe('/help/api');

    const gettingStartedCard = screen.getByText('Getting Started').closest('a');
    expect(gettingStartedCard?.getAttribute('href')).toBe('/help/getting-started');

    expect(screen.getAllByText('1 articles').length).toBe(2);
    expect(screen.getByText('0 articles')).toBeTruthy();
  });

  it('filters articles by title and description', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    render(<HelpCenter />);

    const searchInput = screen.getByPlaceholderText('Search for articles, guides, and docs...');

    await user.type(searchInput, 'aPi AuThEnTiCaTiOn');

    expect(screen.getByText('1 result for "aPi AuThEnTiCaTiOn"')).toBeTruthy();
    expect(screen.getByRole('link', { name: /API authentication/i })).toBeTruthy();

    await user.clear(searchInput);
    await user.type(searchInput, 'sync everywhere');

    expect(screen.getByText('1 result for "sync everywhere"')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Syncing across devices/i })).toBeTruthy();
  });

  it('shows an empty state for searches with no results', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    render(<HelpCenter />);

    const searchInput = screen.getByPlaceholderText('Search for articles, guides, and docs...');
    await user.type(searchInput, 'no-matches-here');

    expect(screen.getByText('0 results for "no-matches-here"')).toBeTruthy();
    expect(screen.getByText('No articles found matching your search.')).toBeTruthy();
  });

  it('treats whitespace input as a search and returns to category grid when cleared', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    render(<HelpCenter />);

    const searchInput = screen.getByPlaceholderText('Search for articles, guides, and docs...');

    await user.type(searchInput, '   ');
    expect(screen.getByText(/0 results for "\s+"/)).toBeTruthy();
    expect(screen.queryByText('Getting Started')).toBeNull();

    await user.type(searchInput, '{backspace}{backspace}{backspace}');
    expect(screen.getByText('Getting Started')).toBeTruthy();
    expect(screen.queryByText(/result for/i)).toBeNull();
  });
});
