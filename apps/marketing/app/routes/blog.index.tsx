import { createFileRoute } from '@tanstack/react-router';

import { pageHead } from '@/lib/seo';

const title = 'TaskForceAI Blog';
const description =
  'Read TaskForceAI product updates, research notes, and announcements on multi-agent orchestration.';

export const Route = createFileRoute('/blog/')({
  component: BlogIndex,
  head: () => pageHead({ title, description, path: '/blog' }),
});

import { ArrowRight } from 'lucide-react';
import { Link } from '@tanstack/react-router';

import { blogPosts } from '@/blog-data/posts';
import { MarketingLayout } from '@/components/layout/MarketingLayout';

function BlogIndex() {
  return (
    <MarketingLayout>
      <div className="mx-auto max-w-4xl py-16">
        <header className="mb-16">
          <h1 className="text-4xl font-extrabold tracking-tight text-slate-900 sm:text-5xl lg:text-6xl dark:text-white">
            Blog & news
          </h1>
          <p className="mt-6 text-xl leading-relaxed text-slate-600 dark:text-slate-400">
            Product updates, launch notes, and field reports from the TaskForceAI team.
          </p>
        </header>

        <section className="mb-14 rounded-3xl border border-slate-200 bg-white/70 p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900/40">
          <p className="mb-3 text-xs font-bold tracking-[0.24em] text-blue-400 uppercase">
            Research
          </p>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-white">
            <Link to="/benchmarks">Frontier Model Benchmarks</Link>
          </h2>
          <p className="mt-4 text-base leading-relaxed text-slate-600 dark:text-slate-400">
            Current Artificial Analysis comparisons for Sentinel, GPT-5.5 (xhigh), Gemini 3.1 Pro
            Preview, Claude Fable 5 (with fallback), and Grok 4.5 (high).
          </p>
          <Link
            to="/benchmarks"
            className="mt-6 inline-flex items-center text-sm font-bold text-blue-400 transition-colors hover:text-blue-300"
          >
            View benchmarks
            <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
        </section>

        <div className="grid gap-8">
          {blogPosts.map((post) => (
            <article
              key={post.slug}
              className="group relative flex flex-col items-start rounded-2xl border border-slate-200 bg-white/60 p-6 shadow-sm transition-all hover:border-blue-500/30 hover:shadow-lg hover:shadow-blue-500/5 dark:border-slate-800 dark:bg-slate-900/40"
            >
              <div className="mb-3 flex flex-wrap items-center gap-3 text-xs font-semibold tracking-wider text-slate-500 uppercase dark:text-slate-400">
                <span className="rounded-full border border-slate-200 bg-slate-900/5 px-3 py-1 text-[10px] text-slate-900 dark:border-white/10 dark:bg-white/5 dark:text-white">
                  {post.tag}
                </span>
                <time>{post.date}</time>
                <span>{post.readTime}</span>
              </div>
              <h2 className="text-2xl font-bold text-slate-900 transition-colors group-hover:text-blue-400 dark:text-white">
                <Link to={`/blog/${post.slug}` as any}>
                  <span className="absolute inset-0 z-20 rounded-2xl" />
                  <span className="relative z-10">{post.title}</span>
                </Link>
              </h2>
              <p className="relative z-10 mt-4 text-base leading-relaxed text-slate-600 dark:text-slate-400">
                {post.summary}
              </p>
              <div className="relative z-10 mt-6 flex items-center text-sm font-bold text-blue-400 transition-colors group-hover:text-blue-300">
                Read more
                <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
              </div>
            </article>
          ))}
        </div>
      </div>
    </MarketingLayout>
  );
}
