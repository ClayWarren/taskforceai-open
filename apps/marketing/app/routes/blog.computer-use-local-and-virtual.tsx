import { createFileRoute } from '@tanstack/react-router';

import { BlogPostPage } from '@/components/blog/BlogPostPage';
import { getRequiredBlogPost } from '@/blog-data/posts';
import { pageHead } from '@/lib/seo';

const post = getRequiredBlogPost('computer-use-local-and-virtual');

export const Route = createFileRoute('/blog/computer-use-local-and-virtual')({
  component: ComputerUseLocalAndVirtualPost,
  head: () =>
    pageHead({ title: post.title, description: post.description, path: `/blog/${post.slug}` }),
});

function ComputerUseLocalAndVirtualPost() {
  return <BlogPostPage post={post} />;
}
