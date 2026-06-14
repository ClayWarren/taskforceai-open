import { createFileRoute } from '@tanstack/react-router';

import { BlogPostPage } from '@/components/blog/BlogPostPage';
import { getRequiredBlogPost } from '@/blog-data/posts';
import { pageHead } from '@/lib/seo';

const post = getRequiredBlogPost('agent-teams-everywhere');

export const Route = createFileRoute('/blog/agent-teams-everywhere')({
  component: AgentTeamsEverywherePost,
  head: () =>
    pageHead({ title: post.title, description: post.description, path: `/blog/${post.slug}` }),
});

function AgentTeamsEverywherePost() {
  return <BlogPostPage post={post} />;
}
