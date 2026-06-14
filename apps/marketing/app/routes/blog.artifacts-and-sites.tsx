import { createFileRoute } from '@tanstack/react-router';

import { BlogPostPage } from '@/components/blog/BlogPostPage';
import { getRequiredBlogPost } from '@/blog-data/posts';
import { pageHead } from '@/lib/seo';

const post = getRequiredBlogPost('artifacts-and-sites');

export const Route = createFileRoute('/blog/artifacts-and-sites')({
  component: ArtifactsAndSitesPost,
  head: () =>
    pageHead({ title: post.title, description: post.description, path: `/blog/${post.slug}` }),
});

function ArtifactsAndSitesPost() {
  return <BlogPostPage post={post} />;
}
