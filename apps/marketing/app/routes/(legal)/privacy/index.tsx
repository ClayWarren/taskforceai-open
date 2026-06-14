import { createFileRoute } from '@tanstack/react-router';

import { pageHead } from '@/lib/seo';

const title = 'TaskForceAI Privacy Policy';
const description = 'Read the TaskForceAI privacy policy and data handling practices.';

export const Route = createFileRoute('/(legal)/privacy/')({
  component: PrivacyPolicy,
  head: () => pageHead({ title, description, path: '/privacy' }),
});

import privacyPolicyMarkdown from '../../../../../../docs/legal/privacy-policy.md?raw';

import { MarketingLayout } from '@/components/layout/MarketingLayout';
import { renderMarkdownToSafeHtml } from '@/lib/safe-markdown';

function PrivacyPolicy() {
  const htmlContent = renderMarkdownToSafeHtml(privacyPolicyMarkdown);

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
