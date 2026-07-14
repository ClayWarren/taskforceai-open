import { ArrowLeft, Sparkles } from 'lucide-react';
import { Link } from '@tanstack/react-router';

import type { BlogPost } from '@/blog-data/posts';
import { MarketingLayout } from '@/components/layout/MarketingLayout';

export function BlogPostPage({ post }: { post: BlogPost }) {
  return (
    <MarketingLayout>
      <article className="mx-auto max-w-3xl py-16">
        <header className="mb-12">
          <Link
            to="/blog"
            className="group mb-8 inline-flex items-center text-sm font-bold text-slate-500 transition-colors hover:text-slate-900 dark:hover:text-white"
          >
            <ArrowLeft className="mr-2 h-4 w-4 transition-transform group-hover:-translate-x-1" />
            Back to blog
          </Link>
          <p className="mb-4 text-xs font-bold tracking-[0.3em] text-blue-400 uppercase">
            {post.date} · {post.readTime}
          </p>
          <h1 className="text-4xl font-extrabold tracking-tight text-slate-900 sm:text-5xl lg:text-6xl dark:text-white">
            {post.title}
          </h1>
          <p className="mt-8 text-xl leading-relaxed text-slate-600 dark:text-slate-400">
            {post.description}
          </p>
        </header>

        <div className="mb-16 grid gap-4 rounded-3xl border border-slate-200 bg-white/60 p-8 shadow-2xl dark:border-slate-800 dark:bg-slate-900/40">
          {post.highlights.map((item, highlightIndex) => (
            <div key={`${item}-${highlightIndex}`} className="flex items-start gap-4">
              <Sparkles className="mt-1 h-5 w-5 shrink-0 text-blue-400" aria-hidden="true" />
              <p className="text-lg font-medium text-slate-700 dark:text-slate-300">{item}</p>
            </div>
          ))}
        </div>

        <div className="space-y-16">
          {post.sections.map((section, sectionIndex) => (
            <section
              key={`${section.heading}-${sectionIndex}`}
              className="space-y-6 text-lg leading-relaxed text-slate-600 dark:text-slate-400"
            >
              <h2 className="text-3xl font-bold text-slate-900 dark:text-white">
                {section.heading}
              </h2>
              {section.paragraphs.map((paragraph, paragraphIndex) => (
                <p key={`${paragraph}-${paragraphIndex}`}>{paragraph}</p>
              ))}
              {section.bullets ? (
                <ul className="grid list-none gap-4 p-0">
                  {section.bullets.map((item, bulletIndex) => (
                    <li key={`${item}-${bulletIndex}`} className="flex items-start gap-3">
                      <div className="mt-2.5 h-2 w-2 shrink-0 rounded-full bg-blue-500" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          ))}
        </div>

        <footer className="mt-16 rounded-3xl border border-slate-200 bg-white/70 p-12 text-center dark:border-slate-800 dark:bg-slate-900/60">
          <h2 className="mb-4 text-2xl font-bold text-slate-900 dark:text-white">
            Build with TaskForceAI
          </h2>
          <p className="mx-auto mb-10 max-w-xl text-slate-600 dark:text-slate-400">
            Explore the docs, launch the web app, or install a native surface for deeper agentic
            workflows.
          </p>
          <div className="flex flex-wrap justify-center gap-4">
            <a
              href="https://docs.taskforceai.chat/docs"
              className="rounded-full border border-slate-200 bg-slate-900/5 px-8 py-3 text-sm font-bold text-slate-900 transition-all hover:bg-slate-900/10 dark:border-white/10 dark:bg-white/5 dark:text-white dark:hover:bg-white/10"
            >
              Documentation
            </a>
            <a
              href="https://taskforceai.chat/login"
              className="rounded-full bg-blue-600 px-8 py-3 text-sm font-bold text-white shadow-lg shadow-blue-500/25 transition-all hover:bg-blue-500"
            >
              Get started
            </a>
          </div>
        </footer>
      </article>
    </MarketingLayout>
  );
}
