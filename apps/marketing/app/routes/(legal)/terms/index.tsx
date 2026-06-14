import { createFileRoute } from '@tanstack/react-router';

import { pageHead } from '@/lib/seo';

const title = 'TaskForceAI Terms of Service';
const description = 'Read the TaskForceAI terms of service.';

export const Route = createFileRoute('/(legal)/terms/')({
  component: TermsOfService,
  head: () => pageHead({ title, description, path: '/terms' }),
});

import termsMarkdown from '../../../../../../docs/legal/terms-of-service.md?raw';

import { MarketingLayout } from '@/components/layout/MarketingLayout';
import { renderMarkdownToSafeHtml } from '@/lib/safe-markdown';

function TermsOfService() {
  const htmlContent = renderMarkdownToSafeHtml(termsMarkdown);

  return (
    <MarketingLayout>
      <div className="mx-auto max-w-4xl py-16">
        <div
          className="prose prose-slate prose-invert max-w-none rounded-3xl border border-slate-200 bg-white/70 p-8 shadow-2xl backdrop-blur-xl md:p-12 dark:border-slate-800 dark:bg-slate-900/60"
          dangerouslySetInnerHTML={{ __html: htmlContent }}
        />
      </div>
    </MarketingLayout>
  );
}
