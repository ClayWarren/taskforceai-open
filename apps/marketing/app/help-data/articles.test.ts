import { describe, expect, it } from 'bun:test';

import { getArticleBySlug, getArticlesByCategory, helpArticles, searchArticles } from './articles';

describe('help article data helpers', () => {
  it('returns only articles for the requested category', () => {
    const mobileArticles = getArticlesByCategory('mobile');

    expect(mobileArticles.length).toBeGreaterThan(0);
    expect(mobileArticles.every((article) => article.categoryId === 'mobile')).toBe(true);
  });

  it('requires both category and slug to match an article', () => {
    const article = helpArticles[0];
    if (!article) {
      throw new Error('Expected at least one help article fixture');
    }

    expect(getArticleBySlug(article.categoryId, article.slug)?.title).toBe(article.title);
    expect(getArticleBySlug('not-the-category', article.slug)).toBeUndefined();
    expect(getArticleBySlug(article.categoryId, 'not-the-slug')).toBeUndefined();
  });

  it('searches titles, descriptions, and content case-insensitively', () => {
    const apiMatches = searchArticles('API key');
    expect(apiMatches.some((article) => article.categoryId === 'api')).toBe(true);

    const contentToken = helpArticles.find((article) =>
      article.content.toLowerCase().includes('your_api_key')
    );
    if (!contentToken) {
      throw new Error('Expected a help article mentioning YOUR_API_KEY');
    }

    const contentMatches = searchArticles('YOUR_API_KEY');
    expect(contentMatches.some((article) => article.slug === contentToken.slug)).toBe(true);
  });

  it('keeps CLI and enterprise guidance aligned with supported entry points', () => {
    const cliContent = getArticlesByCategory('cli')
      .map((article) => article.content)
      .join('\n');
    const enterpriseContent = getArticlesByCategory('enterprise')
      .map((article) => article.content)
      .join('\n');

    expect(cliContent).toContain('https://taskforceai.chat/install.sh');
    expect(cliContent).toContain('taskforceai --prompt');
    expect(cliContent).not.toContain('taskforceai.dev');
    expect(cliContent).not.toContain('taskforceai login');
    expect(enterpriseContent).not.toContain('/saml/acs');
    expect(enterpriseContent).not.toContain('/oidc/callback');
    expect(enterpriseContent).not.toContain('api.taskforceai.chat/scim/v2');
  });
});
