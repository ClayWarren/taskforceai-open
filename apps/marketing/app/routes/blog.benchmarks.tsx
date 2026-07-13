import { createFileRoute } from '@tanstack/react-router';

import { pageHead } from '@/lib/seo';

const title = 'TaskForceAI Benchmarks';
const description =
  'Current TaskForceAI and frontier model benchmark comparisons from Artificial Analysis.';

export const Route = createFileRoute('/blog/benchmarks')({
  component: LegacyBenchmarksRoute,
  head: () => pageHead({ title, description, path: '/benchmarks' }),
});

import { BenchmarksPage } from '@/components/benchmarks/BenchmarksPage';

function LegacyBenchmarksRoute() {
  return <BenchmarksPage legacyBlogPath />;
}
