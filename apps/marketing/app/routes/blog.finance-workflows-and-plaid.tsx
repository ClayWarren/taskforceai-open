import { createFileRoute } from '@tanstack/react-router';

import { BlogPostPage } from '@/components/blog/BlogPostPage';
import { getRequiredBlogPost } from '@/blog-data/posts';
import { pageHead } from '@/lib/seo';

const post = getRequiredBlogPost('finance-workflows-and-plaid');

export const Route = createFileRoute('/blog/finance-workflows-and-plaid')({
  component: FinanceWorkflowsAndPlaidPost,
  head: () =>
    pageHead({ title: post.title, description: post.description, path: `/blog/${post.slug}` }),
});

function FinanceWorkflowsAndPlaidPost() {
  return <BlogPostPage post={post} />;
}
