import { HeadContent, Outlet, Scripts, createRootRoute } from '@tanstack/react-router';
import { getRuntimeEnv } from '@taskforceai/shared/config/app-env';

import { CookieBanner, ErrorBoundary, StructuredData } from '@taskforceai/ui-kit';
import { Analytics } from '../components/shell/Analytics';
import '../globals.css';
import { TauriReadySignal } from '../lib/platform/TauriReadySignal';
import { Providers } from '../lib/providers/RootProviders';

const siteUrl = getRuntimeEnv('VITE_SITE_URL')?.trim();
const ogImageUrl = siteUrl ? `${siteUrl}/api/og` : '/api/og';

const siteName = 'TaskForceAI';
const siteDescription =
  'Multi-agent AI orchestration platform powered by Sentinel, our core high-reasoning layer. Intelligent task decomposition and synthesis through parallel agent execution.';

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: siteName },
      { name: 'description', content: siteDescription },
      { name: 'application-name', content: siteName },
      { name: 'theme-color', content: '#1a1a1a' },
      // Open Graph
      { property: 'og:type', content: 'website' },
      { property: 'og:locale', content: 'en_US' },
      ...(siteUrl ? [{ property: 'og:url', content: siteUrl }] : []),
      { property: 'og:site_name', content: siteName },
      { property: 'og:title', content: siteName },
      { property: 'og:description', content: siteDescription },
      { property: 'og:image', content: ogImageUrl },
      { property: 'og:image:width', content: '1200' },
      { property: 'og:image:height', content: '630' },
      // Twitter
      { name: 'twitter:card', content: 'summary_large_image' },
      { name: 'twitter:title', content: siteName },
      { name: 'twitter:description', content: siteDescription },
      { name: 'twitter:creator', content: '@taskforceai' },
      { name: 'twitter:image', content: ogImageUrl },
    ],

    links: [
      { rel: 'manifest', href: '/manifest.json' },
      { rel: 'icon', href: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
      { rel: 'icon', href: '/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
      { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' },
      { rel: 'shortcut icon', href: '/favicon.ico' },
    ],
  }),
  notFoundComponent: NotFoundPage,
  component: RootLayout,
});

function RootLayout() {
  const rawApiUrl = import.meta.env['VITE_API_URL']?.trim();
  const apiUrl = rawApiUrl && /^https?:\/\//.test(rawApiUrl) ? rawApiUrl : undefined;

  return (
    <html lang="en">
      <head>
        <HeadContent />
        {/* Prefetch critical API endpoints for faster navigation */}
        {apiUrl ? (
          <>
            <link rel="dns-prefetch" href={apiUrl} />
            <link rel="preconnect" href={apiUrl} />
          </>
        ) : null}
      </head>
      <body>
        <StructuredData siteUrl={siteUrl} />
        <TauriReadySignal />

        <ErrorBoundary>
          <Providers>
            <Outlet />
          </Providers>
        </ErrorBoundary>
        <CookieBanner />
        <Analytics />
        <Scripts />
      </body>
    </html>
  );
}

function NotFoundPage() {
  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: '2rem' }}>
      <div style={{ textAlign: 'center' }}>
        <h1 style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>404</h1>
        <p style={{ marginBottom: '1rem' }}>Page not found.</p>
        <a href="/">Go to home</a>
      </div>
    </main>
  );
}
