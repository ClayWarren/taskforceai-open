import { ArrowRight } from 'lucide-react';
import { Link } from '@tanstack/react-router';

import type { BlogPostConfig } from './types';

export function BlogPostsSection({ posts }: { posts: BlogPostConfig[] }) {
  return (
    <section id="blog" className="space-y-6">
      <div className="space-y-2">
        <p className="text-sm font-semibold tracking-[0.26em] text-pink-300 uppercase">Blog</p>
        <h2 className="text-3xl font-semibold text-slate-900 md:text-4xl dark:text-white">
          Latest updates
        </h2>
        <p className="max-w-2xl text-base text-slate-700 dark:text-slate-300">
          Architecture notes, releases, and learnings.
        </p>
      </div>
      <div className="grid gap-6 md:grid-cols-2">
        {posts.map((post) => (
          <article
            key={post.slug}
            className="flex h-full flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-900/5 p-6 shadow-lg shadow-pink-500/10 dark:border-white/10 dark:bg-white/5"
          >
            <div className="flex items-center gap-3 text-sm text-slate-700 dark:text-slate-300">
              <span className="rounded-full bg-pink-500/20 px-3 py-1 text-xs font-semibold text-pink-200 uppercase">
                {post.tag}
              </span>
              <span>•</span>
              <span>{post.publishedAt}</span>
              <span>•</span>
              <span>{post.readTime}</span>
            </div>
            <h3 className="text-xl font-semibold text-slate-900 dark:text-white">{post.title}</h3>
            <p className="text-sm text-slate-800 dark:text-slate-200">{post.description}</p>
            <div className="mt-auto">
              <Link
                to={post.href}
                className="inline-flex items-center gap-2 text-sm font-semibold text-blue-400 hover:text-blue-300"
              >
                Read the post
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

export default BlogPostsSection;
