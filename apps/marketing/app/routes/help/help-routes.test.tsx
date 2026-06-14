import { render, screen, within } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'bun:test';
import React from 'react';

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

class MockNotFoundError extends Error {
  constructor() {
    super('Not Found');
    this.name = 'MockNotFoundError';
  }
}

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
    content: 'Sync keeps your conversation list up to date.',
    lastUpdated: '2025-01-15',
  },
];

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: (_path: string) => (options: any) => {
    let loaderData: unknown;

    return {
      options,
      useLoaderData: () => loaderData,
      __setLoaderData: (data: unknown) => {
        loaderData = data;
      },
    };
  },
  notFound: () => new MockNotFoundError(),
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
  Outlet: () => <div data-testid="help-outlet" />,
}));

vi.mock('../../../../components/help/MarkdownRenderer', () => ({
  default: ({ content }: { content: string }) => (
    <div data-testid="markdown-content">{content}</div>
  ),
}));

vi.mock('../../components/help/HelpCenter', () => ({
  HelpCenter: () => <div data-testid="help-center" />,
}));

vi.mock('../../components/landing/Background', () => ({
  Background: () => <div data-testid="help-background" />,
}));

vi.mock('../../components/landing/Footer', () => ({
  LandingFooter: () => <div data-testid="help-footer" />,
}));

vi.mock('../../components/landing/Header', () => ({
  Header: ({ navigationLinks }: { navigationLinks: Array<{ label: string; href: string }> }) => (
    <nav data-testid="help-header">
      {navigationLinks.map((link) => (
        <a key={link.href} href={link.href}>
          {link.label}
        </a>
      ))}
    </nav>
  ),
}));

vi.mock('../../../help-data/categories', () => ({
  helpCategories: mockHelpCategories,
}));

vi.mock('../../../../help-data/categories', () => ({
  helpCategories: mockHelpCategories,
}));

vi.mock('../../../help-data/articles', () => ({
  helpArticles: mockHelpArticles,
}));

vi.mock('../../../../help-data/articles', () => ({
  helpArticles: mockHelpArticles,
}));

let ArticleRoute: any;
let CategoryRoute: any;
let HelpLayoutRoute: any;
let HelpIndexRoute: any;
let helpMetadata: { title: string; description: string };

beforeAll(async () => {
  ({ Route: ArticleRoute } = await import('./$category/$slug/index'));
  ({ Route: CategoryRoute } = await import('./$category/index'));
  ({ Route: HelpLayoutRoute } = await import('./route'));
  ({ Route: HelpIndexRoute } = await import('./index'));
  ({ metadata: helpMetadata } = await import('./index'));
});

async function expectNotFoundError(task: Promise<unknown>) {
  try {
    await task;
  } catch (error) {
    expect((error as Error).name).toBe('MockNotFoundError');
    return;
  }

  throw new Error('Expected loader to throw notFound error');
}

describe('Help routes', () => {
  it('throws notFound for unknown categories', async () => {
    const categoryRoute = CategoryRoute;

    await expectNotFoundError(categoryRoute.options.loader({ params: { category: 'not-real' } }));
  });

  it('throws notFound for unknown article slugs', async () => {
    const articleRoute = ArticleRoute;

    await expectNotFoundError(
      articleRoute.options.loader({ params: { category: 'api', slug: 'missing-article' } })
    );
  });

  it('throws notFound when category and slug do not match', async () => {
    const articleRoute = ArticleRoute;

    await expectNotFoundError(
      articleRoute.options.loader({ params: { category: 'mobile', slug: 'api-authentication' } })
    );
  });

  it('builds category and article metadata from loader data', async () => {
    const categoryRoute = CategoryRoute;
    const articleRoute = ArticleRoute;

    const categoryLoaderData = await categoryRoute.options.loader({ params: { category: 'api' } });
    const categoryHead = categoryRoute.options.head({ loaderData: categoryLoaderData });

    expect(categoryHead.meta).toContainEqual({ title: 'API - Help Center' });
    expect(categoryHead.meta).toContainEqual({
      name: 'description',
      content: 'REST API authentication and endpoints.',
    });
    expect(categoryHead.links).toContainEqual({
      rel: 'canonical',
      href: 'https://www.taskforceai.chat/help/api',
    });

    const articleLoaderData = await articleRoute.options.loader({
      params: { category: 'api', slug: 'api-authentication' },
    });
    const articleHead = articleRoute.options.head({ loaderData: articleLoaderData });

    expect(articleHead.meta).toContainEqual({ title: 'API authentication - Help Center' });
    expect(articleHead.meta).toContainEqual({
      name: 'description',
      content: 'Authenticate your API requests.',
    });
    expect(articleHead.links).toContainEqual({
      rel: 'canonical',
      href: 'https://www.taskforceai.chat/help/api/api-authentication',
    });
  });

  it('renders breadcrumb links using article loader data', () => {
    const article = mockHelpArticles.find((entry) => entry.slug === 'api-authentication');
    if (!article) {
      throw new Error('Missing fixture article: api-authentication');
    }

    const category = mockHelpCategories.find((entry) => entry.id === article.categoryId);
    if (!category) {
      throw new Error('Missing fixture category for api-authentication');
    }

    const articleRoute = ArticleRoute;
    articleRoute.useLoaderData = () => ({ article, category });

    const ArticleComponent = articleRoute.options.component as React.ComponentType;
    render(<ArticleComponent />);

    const breadcrumb = screen.getByRole('navigation');

    const helpCenterLink = within(breadcrumb).getByRole('link', { name: 'Help Center' });
    expect(helpCenterLink.getAttribute('href')).toBe('/help');

    const categoryLink = within(breadcrumb).getByRole('link', { name: category.title });
    expect(categoryLink.getAttribute('href')).toBe(`/help/${category.id}`);

    expect(within(breadcrumb).getByText(article.title)).toBeTruthy();
  });

  it('renders computed read time and support CTA in article view', () => {
    const category = mockHelpCategories.find((entry) => entry.id === 'api');
    if (!category) {
      throw new Error('Missing fixture category: api');
    }

    const articleRoute = ArticleRoute;
    articleRoute.useLoaderData = () => ({
      article: {
        slug: 'long-article',
        categoryId: category.id,
        title: 'Long article',
        description: 'Detailed guidance',
        content: Array.from({ length: 401 }, () => 'word').join(' '),
        lastUpdated: '2026-02-10',
      },
      category,
    });

    const ArticleComponent = articleRoute.options.component as React.ComponentType;
    render(<ArticleComponent />);

    expect(screen.getByText('Last updated: 2026-02-10')).toBeTruthy();
    expect(screen.getByText('3 min read')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Contact Support' }).getAttribute('href')).toBe(
      'mailto:support@taskforceai.chat'
    );
  });

  it('renders category article links for the active category only', () => {
    const categoryRoute = CategoryRoute;
    const category = mockHelpCategories.find((entry) => entry.id === 'api');
    if (!category) {
      throw new Error('Missing fixture category: api');
    }

    categoryRoute.useLoaderData = () => ({ category, categoryId: category.id });

    const CategoryComponent = categoryRoute.options.component as React.ComponentType;
    render(<CategoryComponent />);

    const articleLink = screen.getByRole('link', { name: /API authentication/i });
    expect(articleLink.getAttribute('href')).toBe('/help/api/api-authentication');
    expect(screen.queryByRole('link', { name: /Syncing across devices/i })).toBeNull();
  });

  it('renders empty-state messaging when a category has no articles', () => {
    const categoryRoute = CategoryRoute;

    categoryRoute.useLoaderData = () => ({
      category: {
        id: 'empty',
        title: 'Empty category',
        description: 'No help articles are available yet.',
        icon: 'HelpCircle',
      },
      categoryId: 'empty',
    });

    const CategoryComponent = categoryRoute.options.component as React.ComponentType;
    render(<CategoryComponent />);

    const backLink = screen.getByRole('link', { name: 'Back to Help Center' });
    expect(backLink.getAttribute('href')).toBe('/help');
    expect(screen.getByText('No articles found in this category.')).toBeTruthy();
  });

  it('renders the help layout shell with navigation, outlet, and footer', () => {
    const layoutRoute = HelpLayoutRoute;
    const HelpLayoutComponent = layoutRoute.options.component as React.ComponentType;

    render(<HelpLayoutComponent />);

    expect(screen.getByTestId('help-background')).toBeTruthy();
    const header = screen.getByTestId('help-header');
    expect(within(header).getByRole('link', { name: 'Home' }).getAttribute('href')).toBe('/');
    expect(within(header).getByRole('link', { name: 'Docs' }).getAttribute('href')).toBe(
      'https://docs.taskforceai.chat/docs'
    );
    expect(within(header).getByRole('link', { name: 'Status' }).getAttribute('href')).toBe(
      'https://status.taskforceai.chat'
    );
    expect(screen.getByTestId('help-outlet')).toBeTruthy();
    expect(screen.getByTestId('help-footer')).toBeTruthy();
  });

  it('renders help index content without nesting marketing layout', () => {
    const indexRoute = HelpIndexRoute;
    const HelpIndexComponent = indexRoute.options.component as React.ComponentType;

    render(<HelpIndexComponent />);

    expect(screen.getByTestId('help-center')).toBeTruthy();
    expect(screen.queryByTestId('marketing-layout')).toBeNull();
  });

  it('exports metadata for the help index route', () => {
    expect(helpMetadata.title).toBe('Help Center');
    expect(helpMetadata.description).toBe(
      'Get help with TaskForceAI. Documentation, guides, and support articles.'
    );
  });

  it('exports canonical metadata for the help index route', () => {
    const head = HelpIndexRoute.options.head();

    expect(head.meta).toContainEqual({ title: 'Help Center' });
    expect(head.links).toContainEqual({
      rel: 'canonical',
      href: 'https://www.taskforceai.chat/help',
    });
  });
});
