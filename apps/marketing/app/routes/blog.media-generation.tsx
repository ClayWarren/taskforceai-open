import { createFileRoute } from '@tanstack/react-router';

import { BlogPostPage } from '@/components/blog/BlogPostPage';
import { getRequiredBlogPost } from '@/blog-data/posts';
import { pageHead } from '@/lib/seo';

const post = getRequiredBlogPost('media-generation');

export const Route = createFileRoute('/blog/media-generation')({
  component: MediaGenerationPost,
  head: () =>
    pageHead({ title: post.title, description: post.description, path: `/blog/${post.slug}` }),
});

function MediaGenerationPost() {
  return <BlogPostPage post={post} />;
}
