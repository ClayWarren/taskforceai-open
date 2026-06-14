import { createFileRoute } from '@tanstack/react-router';

import { BlogPostPage } from '@/components/blog/BlogPostPage';
import { getRequiredBlogPost } from '@/blog-data/posts';
import { pageHead } from '@/lib/seo';

const post = getRequiredBlogPost('desktop-mobile-pairing');

export const Route = createFileRoute('/blog/desktop-mobile-pairing')({
  component: DesktopMobilePairingPost,
  head: () =>
    pageHead({ title: post.title, description: post.description, path: `/blog/${post.slug}` }),
});

function DesktopMobilePairingPost() {
  return <BlogPostPage post={post} />;
}
