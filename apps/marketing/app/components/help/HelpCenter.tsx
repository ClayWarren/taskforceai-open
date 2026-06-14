import { Search } from 'lucide-react';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';

import { helpArticles } from '../../help-data/articles';
import { helpCategories } from '../../help-data/categories';
import { CategoryIcon } from './CategoryIcon';

export function HelpCenter() {
  const [searchQuery, setSearchQuery] = useState('');

  const filteredArticles = searchQuery
    ? helpArticles.filter(
        (article) =>
          article.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
          article.description.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : [];

  return (
    <div className="flex flex-col gap-12">
      {/* Hero Section */}
      <section className="flex flex-col items-center justify-center gap-8 py-12 text-center">
        <h1
          className="text-4xl font-semibold text-slate-900 md:text-5xl dark:text-white"
          style={{
            fontSize: 'clamp(2.25rem, 4vw, 3rem)',
            fontWeight: 600,
            letterSpacing: '-0.02em',
          }}
        >
          How can we help?
        </h1>

        <div className="relative w-full max-w-2xl">
          <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4 text-slate-600 dark:text-slate-400">
            <Search className="h-5 w-5" />
          </div>
          <input
            type="text"
            className="w-full rounded-xl border border-slate-200 bg-white/70 py-4 pr-4 pl-12 text-lg text-slate-900 placeholder-slate-400 shadow-xl shadow-blue-500/5 backdrop-blur transition focus:border-blue-500/50 focus:ring-2 focus:ring-blue-500/20 focus:outline-none dark:border-white/10 dark:bg-slate-900/60 dark:text-white"
            placeholder="Search for articles, guides, and docs..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              backdropFilter: 'blur(20px)',
              background: 'rgba(15, 23, 42, 0.6)',
            }}
          />
        </div>
      </section>

      {/* Content Section */}
      <section>
        {searchQuery ? (
          <div className="mx-auto flex max-w-3xl flex-col gap-4">
            <h2 className="mb-4 text-xl font-medium text-slate-700 dark:text-slate-300">
              {filteredArticles.length} result{filteredArticles.length !== 1 ? 's' : ''} for "
              {searchQuery}"
            </h2>
            {filteredArticles.length > 0 ? (
              filteredArticles.map((article) => (
                <Link
                  key={article.slug}
                  to="/help/$category/$slug"
                  params={{ category: article.categoryId, slug: article.slug }}
                  className="group flex flex-col gap-2 rounded-xl border border-slate-200 bg-white/60 p-6 transition hover:border-slate-200 hover:bg-white/70 dark:border-white/5 dark:bg-slate-900/40 dark:hover:border-white/10 dark:hover:bg-slate-900/60"
                >
                  <h3 className="text-lg font-semibold text-slate-900 transition-colors group-hover:text-blue-400 dark:text-white">
                    {article.title}
                  </h3>
                  <p className="text-slate-600 dark:text-slate-400">{article.description}</p>
                </Link>
              ))
            ) : (
              <div className="py-12 text-center text-slate-600 dark:text-slate-400">
                <p>No articles found matching your search.</p>
              </div>
            )}
          </div>
        ) : (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {helpCategories.map((category: any) => {
              const articleCount = helpArticles.filter(
                (a: any) => a.categoryId === category.id
              ).length;

              return (
                <Link
                  key={category.id}
                  to="/help/$category"
                  params={{ category: category.id }}
                  className="group flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white/70 p-6 shadow-xl shadow-blue-500/5 backdrop-blur transition hover:-translate-y-1 hover:shadow-blue-500/20 dark:border-white/10 dark:bg-slate-900/60"
                  style={{
                    background:
                      'linear-gradient(140deg, rgba(15, 23, 42, 0.85), rgba(30, 64, 175, 0.15))',
                    backdropFilter: 'blur(10px)',
                  }}
                >
                  <div className="flex items-center justify-between">
                    <div className="rounded-lg border border-slate-200 bg-slate-900/5 p-3 text-blue-400 transition-colors group-hover:text-blue-300 dark:border-white/10 dark:bg-white/5">
                      <CategoryIcon icon={category.icon} />
                    </div>
                    <span className="text-sm font-medium text-slate-500 group-hover:text-slate-600 dark:group-hover:text-slate-400">
                      {articleCount} articles
                    </span>
                  </div>

                  <div>
                    <h3 className="mb-2 text-xl font-semibold text-slate-900 dark:text-white">
                      {category.title}
                    </h3>
                    <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                      {category.description}
                    </p>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
