import { createFileRoute } from '@tanstack/react-router';

import { pageHead } from '@/lib/seo';

const title = 'TaskForceAI Mobile';
const description = 'Install TaskForceAI for iOS and Android and learn how mobile updates ship.';

export const Route = createFileRoute('/mobile/')({
  component: MobilePage,
  head: () => pageHead({ title, description, path: '/mobile' }),
});

import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import { env } from '@/env';
import { isExternalHref, resolveMobileIosUrl, resolveMobileAndroidUrl } from '@/lib/mobile-links';
import { splitInternalRouterHref } from '@/lib/router-links';
import { MarketingLayout } from '@/components/layout/MarketingLayout';

const iosDownloadUrl = resolveMobileIosUrl(env.NEXT_PUBLIC_MOBILE_IOS_APP_URL);
const androidDownloadUrl = resolveMobileAndroidUrl(env.NEXT_PUBLIC_MOBILE_ANDROID_APP_URL);

function Section({
  id,
  title: sectionTitle,
  description: sectionDescription,
  children,
}: {
  id: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      className="space-y-6 rounded-3xl border border-slate-200 bg-white/60 p-8 shadow-sm transition-all hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900/40 dark:hover:border-slate-700"
    >
      <div className="space-y-2">
        <h2 className="text-2xl font-bold text-slate-900 dark:text-white">{sectionTitle}</h2>
        <p className="text-sm text-slate-600 dark:text-slate-400">{sectionDescription}</p>
      </div>
      {children}
    </section>
  );
}

function DownloadLink({
  href,
  label,
  description: linkDescription,
}: {
  href: string;
  label: string;
  description: string;
}) {
  const isExternal = href.startsWith('http');
  const className =
    'inline-flex items-center gap-2 rounded-full bg-slate-900 dark:bg-white px-6 py-3 text-sm font-bold text-white dark:text-slate-950 shadow-lg hover:bg-slate-800 dark:hover:bg-slate-100 transition-all';

  if (isExternal) {
    return (
      <a href={href} className={className} target="_blank" rel="noopener noreferrer">
        {label}
        <span className="text-[10px] font-medium tracking-tight text-slate-500 uppercase">
          {linkDescription}
        </span>
      </a>
    );
  }

  const routerHref = splitInternalRouterHref(href);
  if (!routerHref) {
    return (
      <a href={href} className={className}>
        {label}
        <span className="text-[10px] font-medium tracking-tight text-slate-500 uppercase">
          {linkDescription}
        </span>
      </a>
    );
  }

  return (
    <Link to={routerHref.to} hash={routerHref.hash} className={className}>
      {label}
      <span className="text-[10px] font-medium tracking-tight text-slate-500 uppercase">
        {linkDescription}
      </span>
    </Link>
  );
}

function StepList({ steps }: { steps: string[] }) {
  return (
    <ol className="space-y-4 text-sm text-slate-700 dark:text-slate-300">
      {steps.map((step, index) => (
        <li key={`${index}-${step}`} className="flex items-start gap-4">
          <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-slate-300 bg-slate-100 text-[10px] font-bold text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white">
            {index + 1}
          </span>
          <span className="leading-relaxed">{step}</span>
        </li>
      ))}
    </ol>
  );
}

function MobilePage() {
  return (
    <MarketingLayout>
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-16 py-16">
        <header className="space-y-6 text-center">
          <p className="text-xs font-bold tracking-[0.32em] text-blue-400 uppercase">Platforms</p>
          <h1 className="text-4xl font-extrabold tracking-tight text-slate-900 sm:text-6xl dark:text-white">
            TaskForceAI on iOS & Android
          </h1>
          <p className="mx-auto max-w-2xl text-lg leading-relaxed text-slate-600 dark:text-slate-400">
            Download the iOS app from the App Store or join the Android beta today. Production
            builds receive hotfixes automatically via Expo Application Services (EAS) updates.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-4">
            <DownloadLink
              href={iosDownloadUrl}
              label="Install for iOS"
              description={isExternalHref(iosDownloadUrl) ? 'Opens App Store' : 'Link coming soon'}
            />
            <DownloadLink
              href={androidDownloadUrl}
              label="Install for Android"
              description={
                isExternalHref(androidDownloadUrl) ? 'Opens Google Play' : 'Beta link coming soon'
              }
            />
          </div>
        </header>

        <div className="grid gap-8">
          <Section
            id="ios-install"
            title="iOS App Store setup"
            description="Install the public iOS app with your Apple ID."
          >
            <StepList
              steps={[
                'Open the TaskForceAI App Store listing on your iPhone or iPad.',
                'Tap Get to download the latest public build.',
                'Open TaskForceAI and sign in or continue without an account.',
                'Enable automatic updates to receive store releases as they ship.',
              ]}
            />
          </Section>

          <Section
            id="android-install"
            title="Android internal testing"
            description="Use the Google Play Console testing track for easy distribution."
          >
            <StepList
              steps={[
                'Sign in with a tester Gmail account that has been whitelisted in the Play Console.',
                'Accept the invitation by opening the internal testing link above and opting in to the program.',
                'Download the TaskForceAI build from Google Play on your Android device and enable auto-update.',
                'For sideload testing, generate an APK from the preview build profile and share directly.',
              ]}
            />
          </Section>

          <Section
            id="updates"
            title="How updates ship"
            description="EAS Update delivers over-the-air fixes without waiting on store review."
          >
            <div className="space-y-6 text-sm text-slate-700 dark:text-slate-300">
              <p className="leading-relaxed">
                Preview builds target the{' '}
                <code className="rounded-md border border-blue-500/20 bg-blue-500/10 px-2 py-1 font-mono text-blue-400">
                  preview
                </code>{' '}
                channel while production store builds subscribe to the{' '}
                <code className="rounded-md border border-blue-500/20 bg-blue-500/10 px-2 py-1 font-mono text-blue-400">
                  production
                </code>{' '}
                channel. Each channel maps to a dedicated EAS Update branch so testers and customers
                receive the correct build consistently.
              </p>
              <div className="rounded-2xl border border-slate-200 bg-white p-6 font-mono text-xs dark:border-slate-800 dark:bg-slate-950">
                <p className="mb-3 font-bold tracking-widest text-slate-500 uppercase">
                  Ship a preview hotfix
                </p>
                <pre className="overflow-x-auto text-blue-400">
                  {`(cd apps/mobile && bunx eas-cli update \\\n  --channel preview \\\n  --message "Fix streaming indicator flicker")`}
                </pre>
                <p className="mt-6 mb-3 font-bold tracking-widest text-slate-500 uppercase">
                  Promote to production
                </p>
                <pre className="overflow-x-auto text-blue-400">
                  {`(cd apps/mobile && bunx eas-cli update \\\n  --channel production \\\n  --message "Mobile 0.3.1")`}
                </pre>
              </div>
              <p className="leading-relaxed">
                When a build requires new native modules or configuration changes, trigger a full
                store release instead by running{' '}
                <code className="rounded-md bg-slate-900/5 px-2 py-1 font-mono text-slate-900 dark:bg-white/5 dark:text-white">
                  eas build
                </code>{' '}
                for the appropriate profile and submitting through App Store Connect or Google Play
                Console.
              </p>
            </div>
          </Section>

          <Section
            id="release-checklist"
            title="Release checklist"
            description="Quick reminders before pushing a build to testers or stores."
          >
            <ul className="grid gap-3 text-sm text-slate-700 dark:text-slate-300">
              <CheckItem label="Run the mobile unit, integration, and offline sync tests." />
              <CheckItem label="Update release notes inside App Store Connect and Google Play Console." />
              <CheckItem label="Verify environment variables for API base URLs and feature flags." />
              <CheckItem label="Capture fresh screenshots for the marketing site if UI changes shipped." />
            </ul>
          </Section>
        </div>
      </div>
    </MarketingLayout>
  );
}

function CheckItem({ label }: { label: string }) {
  return (
    <li className="flex items-center gap-3">
      <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-500/10 text-blue-400">
        <svg
          className="h-3 w-3"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={3}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      </div>
      <span>{label}</span>
    </li>
  );
}
