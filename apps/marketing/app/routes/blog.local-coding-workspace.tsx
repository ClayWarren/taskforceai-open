import { createFileRoute } from '@tanstack/react-router';

import { BlogPostPage } from '@/components/blog/BlogPostPage';
import { getRequiredBlogPost } from '@/blog-data/posts';
import { pageHead } from '@/lib/seo';

const post = getRequiredBlogPost('local-coding-workspace');

export const Route = createFileRoute('/blog/local-coding-workspace')({
  component: LocalCodingWorkspacePost,
  head: () =>
    pageHead({ title: post.title, description: post.description, path: `/blog/${post.slug}` }),
});

function LocalCodingWorkspacePost() {
  return <BlogPostPage post={post} />;
}
