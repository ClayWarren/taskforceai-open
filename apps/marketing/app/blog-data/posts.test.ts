import { describe, expect, it } from 'bun:test';

import { blogPosts, getRequiredBlogPost, landingBlogPosts } from './posts';

describe('blog post data', () => {
  it('selects the first three posts for the landing page', () => {
    expect(landingBlogPosts).toEqual(blogPosts.slice(0, 3));
  });

  it('returns required posts and throws when a required slug is missing', () => {
    const firstPost = blogPosts[0];
    expect(firstPost).toBeDefined();
    if (!firstPost) {
      throw new Error('expected at least one blog post');
    }
    expect(getRequiredBlogPost(firstPost.slug)).toBe(firstPost);
    expect(() => getRequiredBlogPost('missing-post')).toThrow('Missing blog post: missing-post');
  });
});
