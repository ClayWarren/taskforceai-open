import { createFileRoute, Outlet } from '@tanstack/react-router';

export const Route = createFileRoute('/help')({
  component: HelpLayout,
});

import { Background } from '../../components/landing/Background';
import { LandingFooter } from '../../components/landing/Footer';
import { Header } from '../../components/landing/Header';
import type { NavigationLink } from '../../components/landing/types';

const navigationLinks: NavigationLink[] = [
  { label: 'Home', href: '/' },
  { label: 'Docs', href: 'https://docs.taskforceai.chat/docs' },
  { label: 'Status', href: 'https://status.taskforceai.chat' },
];

function HelpLayout() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-white text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <Background />

      <div className="relative z-10 mx-auto flex min-h-screen max-w-6xl flex-col gap-12 px-6 pt-12 pb-24 md:px-8 lg:px-10">
        <Header navigationLinks={navigationLinks} />

        <main className="w-full flex-1">
          <Outlet />
        </main>

        <LandingFooter />
      </div>
    </div>
  );
}
