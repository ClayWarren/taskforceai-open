import { createFileRoute } from '@tanstack/react-router';

import { BlogPostPage } from '@/components/blog/BlogPostPage';
import { getRequiredBlogPost } from '@/blog-data/posts';
import { pageHead } from '@/lib/seo';

const post = getRequiredBlogPost('introducing-taskforceai');

export const Route = createFileRoute('/blog/introducing-taskforceai')({
  component: IntroducingTaskForceAIPost,
  head: () =>
    pageHead({ title: post.title, description: post.description, path: `/blog/${post.slug}` }),
});

function IntroducingTaskForceAIPost() {
  return <BlogPostPage post={post} />;
}
