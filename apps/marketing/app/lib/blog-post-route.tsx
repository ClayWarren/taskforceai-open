import { createFileRoute, type FileRoutesByPath } from '@tanstack/react-router';

import { getRequiredBlogPost } from '@/blog-data/posts';
import { BlogPostPage } from '@/components/blog/BlogPostPage';
import { pageHead } from '@/lib/seo';

type BlogRoutePath = Extract<keyof FileRoutesByPath, `/blog/${string}`>;

export function createBlogPostRoute(path: BlogRoutePath, slug: string) {
  const post = getRequiredBlogPost(slug);

  function BlogPostRoute() {
    return <BlogPostPage post={post} />;
  }

  return createFileRoute(path)({
    component: BlogPostRoute,
    head: () => pageHead({ title: post.title, description: post.description, path }),
  });
}
