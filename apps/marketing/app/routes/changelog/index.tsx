import { logger } from '@/lib/logger';
import ChangelogPanel from '@/components/changelog/ChangelogPanel';
import { MarketingLayout } from '@/components/layout/MarketingLayout';
import changelogContent from '../../../../../CHANGELOG.md?raw';

export function parseChangelog(content: string): { content: string; lastUpdated?: string } {
  const match = content.match(/##\s+(?:\[?)(?:Week of\s+)?(\d{4}-\d{2}-\d{2})(?:\]?)/);
  if (!match) {
    logger.warn('Regex failed to extract lastUpdated date from changelog content');
  }

  return { content, lastUpdated: match?.[1] ?? undefined };
}

const loadChangelog = () => parseChangelog(changelogContent);

const stripDocumentTitle = (content: string): string =>
  content.replace(/^#\s+TaskForceAI Unified Changelog\s*\n+/u, '');

import { createFileRoute } from '@tanstack/react-router';
import { pageHead } from '@/lib/seo';

const title = 'TaskForceAI Changelog';
const description = 'Latest updates, improvements, and fixes across the TaskForceAI platform.';

export const Route = createFileRoute('/changelog/')({
  component: ChangelogPage,
  loader: loadChangelog,
  head: () => pageHead({ title, description, path: '/changelog' }),
});

function ChangelogPage() {
  const changelog = Route.useLoaderData();

  return (
    <MarketingLayout containerClassName="gap-8">
      <div className="mt-12 flex-1">
        <ChangelogPanel
          content={stripDocumentTitle(changelog.content)}
          lastUpdated={changelog.lastUpdated}
        />
      </div>
    </MarketingLayout>
  );
}
