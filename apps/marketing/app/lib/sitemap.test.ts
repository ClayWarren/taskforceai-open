import { describe, expect, it } from 'bun:test';

import { blogPosts } from '../blog-data/posts';
import { helpArticles } from '../help-data/articles';
import { helpCategories } from '../help-data/categories';
import { buildMarketingSitemap, marketingSitemapPaths } from './sitemap';

describe('marketing sitemap', () => {
  it('contains every blog and help route exactly once', () => {
    const paths = marketingSitemapPaths();
    const uniquePaths = new Set(paths);

    expect(uniquePaths.size).toBe(paths.length);
    expect(paths).toContain('/help');

    for (const category of helpCategories) {
      expect(paths).toContain(`/help/${category.id}`);
    }
    for (const article of helpArticles) {
      expect(paths).toContain(`/help/${article.categoryId}/${article.slug}`);
    }
    for (const post of blogPosts) {
      expect(paths).toContain(`/blog/${post.slug}`);
    }
  });

  it('renders canonical XML locations and article modification dates', () => {
    const sitemap = buildMarketingSitemap();

    expect(sitemap).toStartWith('<?xml version="1.0" encoding="UTF-8"?>');
    expect(sitemap).toContain(
      '<loc>https://www.taskforceai.chat/help/api/api-authentication</loc>'
    );
    expect(sitemap).toContain('<lastmod>2026-06-06</lastmod>');
  });
});
