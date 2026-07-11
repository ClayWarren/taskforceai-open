import { createFileRoute } from '@tanstack/react-router';

import { pageHead } from '@/lib/seo';

export const metadata = {
  title: 'Help Center',
  description: 'Get help with TaskForceAI. Documentation, guides, and support articles.',
};

export const Route = createFileRoute('/help/')({
  component: HelpPage,
  head: () => pageHead({ ...metadata, path: '/help' }),
});

import { HelpCenter } from '../../components/help/HelpCenter';

function HelpPage() {
  return (
    <div className="py-16">
      <HelpCenter />
    </div>
  );
}
