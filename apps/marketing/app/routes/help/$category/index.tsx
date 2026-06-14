import { ArrowLeft, ArrowRight } from 'lucide-react';
import { createFileRoute, notFound, Link } from '@tanstack/react-router';

import { CategoryIcon } from '../../../components/help/CategoryIcon';
import { helpArticles } from '../../../help-data/articles';
import { helpCategories } from '../../../help-data/categories';
import { pageHead } from '../../../lib/seo';

export const Route = createFileRoute('/help/$category/')({
  component: CategoryPage,
  loader: async ({ params }) => {
    const { category: categoryId } = params;
    const category = helpCategories.find((c) => c.id === categoryId);

    if (!category) {
      throw notFound();
    }

    return { category, categoryId };
  },
  head: ({ loaderData }) => {
    const { category } = loaderData as any;
    return pageHead({
      title: `${category.title} - Help Center`,
      description: category.description,
      path: `/help/${category.id}`,
    });
  },
});

function CategoryPage() {
  const { category, categoryId } = Route.useLoaderData();

  const articles = helpArticles.filter((a) => a.categoryId === categoryId);

  return (
    <div className="flex flex-col gap-10">
      <Link
        to="/help"
        className="group inline-flex items-center gap-2 text-sm font-medium text-slate-600 transition-colors hover:text-blue-400 dark:text-slate-400"
      >
        <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-1" />
        Back to Help Center
      </Link>

      <header className="flex items-start gap-6 border-b border-slate-200 pb-10 dark:border-white/10">
        <div className="rounded-2xl border border-slate-200 bg-white/70 p-4 text-blue-400 shadow-xl backdrop-blur dark:border-white/10 dark:bg-slate-900/60">
          <CategoryIcon icon={category.icon} className="h-8 w-8" />
        </div>
        <div className="space-y-2">
          <h1 className="text-3xl font-semibold text-slate-900 dark:text-white">
            {category.title}
          </h1>
          <p className="max-w-2xl text-lg text-slate-600 dark:text-slate-400">
            {category.description}
          </p>
        </div>
      </header>

      <div className="grid gap-4">
        {articles.map((article) => (
          <Link
            key={article.slug}
            to="/help/$category/$slug"
            params={{ category: category.id, slug: article.slug }}
            className="group flex items-center justify-between rounded-xl border border-slate-200 bg-white/60 p-6 transition hover:border-slate-200 hover:bg-white/70 dark:border-white/5 dark:bg-slate-900/40 dark:hover:border-white/10 dark:hover:bg-slate-900/60"
          >
            <div className="space-y-1">
              <h3 className="text-lg font-medium text-slate-900 transition-colors group-hover:text-blue-400 dark:text-white">
                {article.title}
              </h3>
              <p className="text-sm text-slate-600 dark:text-slate-400">{article.description}</p>
            </div>
            <ArrowRight className="h-5 w-5 text-slate-500 opacity-0 transition-all group-hover:translate-x-1 group-hover:text-blue-400 group-hover:opacity-100" />
          </Link>
        ))}

        {articles.length === 0 && (
          <div className="py-12 text-center text-slate-500">
            No articles found in this category.
          </div>
        )}
      </div>
    </div>
  );
}
