import { blogPosts } from '../blog-data/posts';
import { helpArticles } from '../help-data/articles';
import { helpCategories } from '../help-data/categories';

const CANONICAL_ORIGIN = 'https://www.taskforceai.chat';

type SitemapEntry = {
  path: string;
  changeFrequency: 'weekly' | 'monthly' | 'yearly';
  priority: string;
  lastModified?: string;
};

const staticEntries: SitemapEntry[] = [
  { path: '/home', changeFrequency: 'weekly', priority: '1.0' },
  { path: '/benchmarks', changeFrequency: 'weekly', priority: '0.8' },
  { path: '/pricing', changeFrequency: 'weekly', priority: '0.9' },
  { path: '/enterprise', changeFrequency: 'monthly', priority: '0.8' },
  { path: '/company', changeFrequency: 'monthly', priority: '0.8' },
  { path: '/about', changeFrequency: 'monthly', priority: '0.8' },
  { path: '/help', changeFrequency: 'monthly', priority: '0.7' },
  { path: '/support', changeFrequency: 'monthly', priority: '0.7' },
  { path: '/downloads', changeFrequency: 'weekly', priority: '0.8' },
  { path: '/mobile', changeFrequency: 'monthly', priority: '0.7' },
  { path: '/sdk', changeFrequency: 'monthly', priority: '0.7' },
  { path: '/changelog', changeFrequency: 'weekly', priority: '0.7' },
  { path: '/blog', changeFrequency: 'weekly', priority: '0.8' },
  { path: '/privacy', changeFrequency: 'yearly', priority: '0.3' },
  { path: '/terms', changeFrequency: 'yearly', priority: '0.3' },
];

function sitemapEntries(): SitemapEntry[] {
  return [
    ...staticEntries,
    ...blogPosts.map((post) => ({
      path: `/blog/${post.slug}`,
      changeFrequency: 'monthly' as const,
      priority: '0.7',
    })),
    ...helpCategories.map((category) => ({
      path: `/help/${category.id}`,
      changeFrequency: 'monthly' as const,
      priority: '0.6',
    })),
    ...helpArticles.map((article) => ({
      path: `/help/${article.categoryId}/${article.slug}`,
      changeFrequency: 'monthly' as const,
      priority: '0.5',
      lastModified: article.lastUpdated,
    })),
  ];
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

export function marketingSitemapPaths(): string[] {
  return sitemapEntries().map((entry) => entry.path);
}

export function buildMarketingSitemap(): string {
  const entries = sitemapEntries()
    .map((entry) => {
      const location = escapeXml(new URL(entry.path, CANONICAL_ORIGIN).href);
      const lastModified = entry.lastModified
        ? `\n    <lastmod>${escapeXml(entry.lastModified)}</lastmod>`
        : '';
      return `  <url>\n    <loc>${location}</loc>${lastModified}\n    <changefreq>${entry.changeFrequency}</changefreq>\n    <priority>${entry.priority}</priority>\n  </url>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</urlset>\n`;
}
