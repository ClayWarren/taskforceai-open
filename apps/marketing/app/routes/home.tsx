import { createFileRoute } from '@tanstack/react-router';
import LandingPage from '@/components/landing/LandingPage';
import { MarketingLayout } from '@/components/layout/MarketingLayout';
import { pageHead } from '@/lib/seo';

const title = 'TaskForceAI - Multi-agent orchestration';
const description =
  'TaskForceAI brings multi-agent orchestration to web, desktop, mobile, CLI, SDKs, and REST APIs.';

export const Route = createFileRoute('/home')({
  component: HomePage,
  head: () => pageHead({ title, description, path: '/home' }),
});

function HomePage() {
  return (
    <MarketingLayout>
      <LandingPage />
    </MarketingLayout>
  );
}
