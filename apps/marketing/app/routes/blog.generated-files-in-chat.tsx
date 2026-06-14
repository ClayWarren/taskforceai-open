import { createFileRoute } from '@tanstack/react-router';

import { BlogPostPage } from '@/components/blog/BlogPostPage';
import { getRequiredBlogPost } from '@/blog-data/posts';
import { pageHead } from '@/lib/seo';

const post = getRequiredBlogPost('generated-files-in-chat');

export const Route = createFileRoute('/blog/generated-files-in-chat')({
  component: GeneratedFilesInChatPost,
  head: () =>
    pageHead({ title: post.title, description: post.description, path: `/blog/${post.slug}` }),
});

function GeneratedFilesInChatPost() {
  return <BlogPostPage post={post} />;
}
