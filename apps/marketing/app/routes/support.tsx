import { createFileRoute } from '@tanstack/react-router';
import { Mail, ShieldCheck, Wrench } from 'lucide-react';
import type React from 'react';

import { MarketingLayout } from '@/components/layout/MarketingLayout';
import { pageHead } from '@/lib/seo';

const pageTitle = 'TaskForceAI Support';
const description =
  'Contact TaskForceAI support and find help for account, billing, privacy, and app issues.';

export const Route = createFileRoute('/support')({
  component: SupportPage,
  head: () => pageHead({ title: pageTitle, description, path: '/support' }),
});

function SupportPage() {
  return (
    <MarketingLayout>
      <main className="mx-auto max-w-5xl px-6 py-16">
        <section className="mb-14 max-w-3xl">
          <h1 className="text-4xl font-bold tracking-tight text-slate-950 md:text-5xl dark:text-white">
            TaskForceAI Support
          </h1>
          <p className="mt-5 text-lg leading-8 text-slate-600 dark:text-slate-300">
            Get help with the mobile app, subscriptions, account access, privacy requests, and
            product questions.
          </p>
        </section>

        <section className="grid gap-4 md:grid-cols-3">
          <SupportLink
            href="mailto:support@taskforceai.chat"
            icon={<Mail className="h-5 w-5" />}
            title="Contact support"
            body="Email support@taskforceai.chat for app, account, subscription, and billing help."
          />
          <SupportLink
            href="/help"
            icon={<Wrench className="h-5 w-5" />}
            title="Help center"
            body="Browse setup, troubleshooting, billing, mobile, and API support articles."
          />
          <SupportLink
            href="/help/privacy-security/ai-provider-data-sharing"
            icon={<ShieldCheck className="h-5 w-5" />}
            title="Privacy and AI"
            body="Review what data is sent to AI providers and how mobile permission works."
          />
        </section>
      </main>
    </MarketingLayout>
  );
}

function SupportLink({
  href,
  icon,
  title,
  body,
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <a
      href={href}
      className="rounded-lg border border-slate-200 bg-white/80 p-6 shadow-sm transition hover:border-blue-300 hover:bg-blue-50/70 dark:border-slate-800 dark:bg-slate-900/70 dark:hover:border-blue-500/60 dark:hover:bg-blue-950/30"
    >
      <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-300">
        {icon}
      </div>
      <h2 className="text-lg font-semibold text-slate-950 dark:text-white">{title}</h2>
      <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">{body}</p>
    </a>
  );
}
