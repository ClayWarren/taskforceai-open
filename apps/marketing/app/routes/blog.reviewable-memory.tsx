import { createFileRoute } from '@tanstack/react-router';

import { BlogPostPage } from '@/components/blog/BlogPostPage';
import { getRequiredBlogPost } from '@/blog-data/posts';
import { pageHead } from '@/lib/seo';

const post = getRequiredBlogPost('reviewable-memory');

export const Route = createFileRoute('/blog/reviewable-memory')({
  component: ReviewableMemoryPost,
  head: () =>
    pageHead({ title: post.title, description: post.description, path: `/blog/${post.slug}` }),
});

function ReviewableMemoryPost() {
  return <BlogPostPage post={post} />;
}
