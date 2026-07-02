import { describe, expect, it } from 'bun:test';

import { CANONICAL_ORIGIN, canonicalUrl, pageHead } from './seo';

describe('marketing seo helpers', () => {
  it('normalizes canonical paths consistently', () => {
    expect(canonicalUrl('/')).toBe(`${CANONICAL_ORIGIN}/home`);
    expect(canonicalUrl('pricing')).toBe(`${CANONICAL_ORIGIN}/pricing`);
    expect(canonicalUrl('/pricing/')).toBe(`${CANONICAL_ORIGIN}/pricing`);
  });

  it('builds Open Graph metadata with an encoded default image URL', () => {
    const head = pageHead({
      title: 'TaskForceAI Research',
      description: 'Run repeatable evals & ship better agents',
      path: '/research/',
    });

    expect(head.links).toEqual([{ rel: 'canonical', href: `${CANONICAL_ORIGIN}/research` }]);
    expect(head.meta).toContainEqual({
      property: 'og:image',
      content:
        `${CANONICAL_ORIGIN}/api/og?` +
        'title=TaskForceAI+Research&description=Run+repeatable+evals+%26+ship+better+agents',
    });
    expect(head.meta).toContainEqual({
      name: 'twitter:image',
      content:
        `${CANONICAL_ORIGIN}/api/og?` +
        'title=TaskForceAI+Research&description=Run+repeatable+evals+%26+ship+better+agents',
    });
  });

  it('preserves absolute image URLs', () => {
    const imageUrl = 'https://cdn.example.com/social-card.png';

    const head = pageHead({
      title: 'Enterprise AI',
      description: 'Private agent operations',
      path: 'enterprise',
      imagePath: imageUrl,
    });

    expect(head.meta).toContainEqual({ property: 'og:image', content: imageUrl });
    expect(head.meta).toContainEqual({ name: 'twitter:image', content: imageUrl });
  });
});
