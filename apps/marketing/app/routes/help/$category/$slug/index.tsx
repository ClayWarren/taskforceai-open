import { Calendar } from 'lucide-react';
import { Link, createFileRoute, notFound } from '@tanstack/react-router';

import MarkdownRenderer from '../../../../components/help/MarkdownRenderer';
import { helpArticles } from '../../../../help-data/articles';
import { helpCategories } from '../../../../help-data/categories';
import { pageHead } from '../../../../lib/seo';

export const Route = createFileRoute('/help/$category/$slug/')({
  component: ArticlePage,
  loader: async ({ params }) => {
    const { category: categoryId, slug } = params;
    const article = helpArticles.find((a) => a.slug === slug && a.categoryId === categoryId);

    if (!article) {
      throw notFound();
    }

    const category = helpCategories.find((c) => c.id === categoryId);

    if (!category) {
      throw notFound();
    }

    return { article, category };
  },
  head: ({ loaderData }) => {
    const { article } = loaderData as any;
    return pageHead({
      title: `${article.title} - Help Center`,
      description: article.description,
      path: `/help/${article.categoryId}/${article.slug}`,
    });
  },
});

function ArticlePage() {
  const { article, category } = Route.useLoaderData();

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-8">
      <nav className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
        <Link to="/help" className="transition-colors hover:text-blue-400">
          Help Center
        </Link>
        <span>/</span>
        <Link
          to="/help/$category"
          params={{ category: category.id }}
          className="group inline-flex items-center gap-2 text-sm font-medium text-slate-600 transition-colors hover:text-blue-400 dark:text-slate-400"
        >
          {' '}
          {category.title}
        </Link>
        <span>/</span>
        <span className="truncate text-slate-900 dark:text-white">{article.title}</span>
      </nav>

      <article className="flex flex-col gap-8">
        <header className="space-y-4 border-b border-slate-200 pb-8 dark:border-white/10">
          <h1 className="text-3xl font-bold text-slate-900 md:text-4xl dark:text-white">
            {article.title}
          </h1>
          <div className="flex items-center gap-4 text-sm text-slate-600 dark:text-slate-400">
            <div className="flex items-center gap-1.5">
              <Calendar className="h-4 w-4" />
              <span>Last updated: {article.lastUpdated}</span>
            </div>
            <span>•</span>
            <span>{Math.ceil(article.content.split(' ').length / 200)} min read</span>
          </div>
        </header>

        <MarkdownRenderer content={article.content} />
      </article>

      <div className="mt-12 border-t border-slate-200 pt-8 dark:border-white/10">
        <div className="flex flex-col gap-4 rounded-xl border border-blue-500/20 bg-blue-500/5 p-6 md:flex-row md:items-center md:justify-between">
          <div className="space-y-1">
            <h3 className="font-semibold text-slate-900 dark:text-white">Still need help?</h3>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Our support team is available to assist you.
            </p>
          </div>
          <a
            href="mailto:support@taskforceai.chat"
            className="inline-flex items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500"
          >
            Contact Support
          </a>
        </div>
      </div>
    </div>
  );
}
