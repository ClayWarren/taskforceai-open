import React from 'react';
import { Background } from '../landing/Background';
import { LandingFooter } from '../landing/Footer';
import { Header } from '../landing/Header';
import type { NavigationLink } from '../landing/types';

const navigationLinks: NavigationLink[] = [
  { label: 'Platforms', href: '/home#platforms' },
  { label: 'Developers', href: '/home#developers' },
  { label: 'Blog', href: '/blog' },
  { label: 'Docs', href: 'https://docs.taskforceai.chat/docs' },
  { label: 'Pricing', href: '/pricing' },
  { label: 'Enterprise', href: '/enterprise' },
];

interface MarketingLayoutProps {
  children: React.ReactNode;
  className?: string;
  containerClassName?: string;
}

export function MarketingLayout({
  children,
  className = '',
  containerClassName = '',
}: MarketingLayoutProps) {
  return (
    <div
      className={`relative min-h-screen overflow-hidden bg-white text-slate-900 dark:bg-slate-950 dark:text-slate-100 ${className}`}
    >
      <Background />

      <div
        className={`relative z-10 mx-auto flex min-h-screen max-w-6xl flex-col px-6 pt-12 pb-24 md:px-8 lg:px-10 ${containerClassName}`}
      >
        <Header navigationLinks={navigationLinks} />
        <main className="flex-1">{children}</main>
        <LandingFooter />
      </div>
    </div>
  );
}
