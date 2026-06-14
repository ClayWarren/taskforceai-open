import { HeadContent, Outlet, Scripts, createRootRoute } from '@tanstack/react-router';

import appCss from '../globals.css?url';
import { StatusHeader } from '../components/status/BrandMark';
import { StatusErrorBoundary } from '../components/status/StatusErrorBoundary';

const siteName = 'TaskForceAI System Status';
const siteDescription = 'Real-time system status and uptime for TaskForceAI services.';
const rssUrl = import.meta.env.VITE_STATUS_RSS_URL;

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: siteName },
      { name: 'description', content: siteDescription },
      { name: 'theme-color', content: '#1a1a1a' },
    ],
    links: [
      { rel: 'stylesheet', href: appCss },
      { rel: 'icon', href: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
      { rel: 'icon', href: '/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
      { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' },
      { rel: 'shortcut icon', href: '/favicon.ico' },
      ...(rssUrl
        ? [{ rel: 'alternate', type: 'application/rss+xml', title: siteName, href: rssUrl }]
        : []),
    ],
  }),
  component: RootLayout,
  notFoundComponent: NotFoundPage,
});

function RootLayout() {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body className="bg-background text-foreground">
        <StatusErrorBoundary>
          <Outlet />
        </StatusErrorBoundary>
        <Scripts />
      </body>
    </html>
  );
}

function NotFoundPage() {
  return (
    <div className="min-h-screen bg-background">
      <StatusHeader />
      <main className="mx-auto max-w-4xl px-4 py-12">
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <p className="mb-2 text-lg font-semibold text-foreground">Page not found</p>
          <p className="mb-6 max-w-md text-sm text-muted-foreground">
            The requested status page route does not exist.
          </p>
          <a
            href="/"
            className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
          >
            Return to status overview
          </a>
        </div>
      </main>
    </div>
  );
}
