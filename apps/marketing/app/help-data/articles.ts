import { helpArticles } from './articles/index';
import type { HelpArticle } from './articles/index';

export type { HelpArticle };

export function getArticlesByCategory(categoryId: string): HelpArticle[] {
  return helpArticles.filter((article) => article.categoryId === categoryId);
}

export function getArticleBySlug(categoryId: string, slug: string): HelpArticle | undefined {
  return helpArticles.find((article) => article.categoryId === categoryId && article.slug === slug);
}

export function searchArticles(query: string): HelpArticle[] {
  const lowerQuery = query.toLowerCase();
  return helpArticles.filter(
    (article) =>
      article.title.toLowerCase().includes(lowerQuery) ||
      article.description.toLowerCase().includes(lowerQuery) ||
      article.content.toLowerCase().includes(lowerQuery)
  );
}

export { helpArticles };
