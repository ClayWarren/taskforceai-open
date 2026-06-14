import { createFileRoute } from '@tanstack/react-router';

import { BlogPostPage } from '@/components/blog/BlogPostPage';
import { getRequiredBlogPost } from '@/blog-data/posts';
import { pageHead } from '@/lib/seo';

const post = getRequiredBlogPost('web-search-and-code-execution');

export const Route = createFileRoute('/blog/web-search-and-code-execution')({
  component: WebSearchAndCodeExecutionPost,
  head: () =>
    pageHead({ title: post.title, description: post.description, path: `/blog/${post.slug}` }),
});

function WebSearchAndCodeExecutionPost() {
  return <BlogPostPage post={post} />;
}
