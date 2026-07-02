import { describe, expect, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { BlogPostsSection } from './BlogPosts';
import type { BlogPostConfig } from './types';

const posts: BlogPostConfig[] = [
  {
    slug: 'artifact-workflows',
    href: '/blog/artifact-workflows',
    tag: 'Release',
    publishedAt: 'June 19, 2026',
    readTime: '4 min read',
    title: 'Artifact workflows ship faster',
    description: 'How generated files move from chat to production review.',
  },
  {
    slug: 'agent-teams',
    href: '/blog/agent-teams',
    tag: 'Research',
    publishedAt: 'June 18, 2026',
    readTime: '6 min read',
    title: 'Agent teams on every surface',
    description: 'Coordinating web, desktop, CLI, and mobile execution.',
  },
];

describe('BlogPostsSection', () => {
  it('renders blog post metadata and links to each post', () => {
    const html = renderToStaticMarkup(<BlogPostsSection posts={posts} />);

    expect(html).toContain('Latest updates');
    expect(html).toContain('Architecture notes, releases, and learnings.');

    for (const post of posts) {
      expect(html).toContain(post.tag);
      expect(html).toContain(post.publishedAt);
      expect(html).toContain(post.readTime);
      expect(html).toContain(post.title);
      expect(html).toContain(post.description);
      expect(html).toContain(`href="${post.href}"`);
    }

    expect((html.match(/Read the post/g) ?? []).length).toBe(2);
  });

  it('renders the section chrome when there are no posts', () => {
    const html = renderToStaticMarkup(<BlogPostsSection posts={[]} />);

    expect(html).toContain('Blog');
    expect(html).not.toContain('<article');
  });
});
