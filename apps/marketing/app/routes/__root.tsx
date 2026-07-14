import { Outlet, createRootRoute, HeadContent, Scripts } from '@tanstack/react-router';
import { CookieBanner } from '@taskforceai/ui-kit/CookieBanner';
import { ErrorBoundary } from '@taskforceai/ui-kit/ErrorBoundary';
import { StructuredData } from '@taskforceai/ui-kit/StructuredData';
import { CANONICAL_ORIGIN, canonicalUrl } from '@/lib/seo';
import '../globals.css';

// Runs before first paint to set the theme from storage (default: follow
// system), preventing a light/dark flash. Only touches documentElement since
// <body> does not exist yet; body theme classes are applied after hydration.
const themeInitScript = `(function(){try{var t=localStorage.getItem('theme');var d=t==='dark'||((t===null||t==='system')&&window.matchMedia('(prefers-color-scheme: dark)').matches);var r=document.documentElement;r.setAttribute('data-theme',d?'dark':'light');r.classList.toggle('dark',d);}catch(e){}})();`;

const siteName = 'TaskForceAI';
const siteDescription =
  'Multi-agent AI orchestration platform powered by Sentinel, our core high-reasoning layer. Intelligent task decomposition and synthesis through parallel agent execution.';
const defaultOgImageUrl = `${CANONICAL_ORIGIN}/api/og`;

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1',
      },
      { title: siteName },
      { name: 'description', content: siteDescription },
      { name: 'application-name', content: siteName },
      { name: 'author', content: 'TaskForceAI Team' },
      {
        name: 'keywords',
        content:
          'AI orchestration, multi-agent AI, Sentinel AI, task automation, AI agents, parallel processing, intelligent synthesis, AI tools',
      },
      { name: 'theme-color', content: '#1a1a1a' },
      { property: 'og:type', content: 'website' },
      { property: 'og:locale', content: 'en_US' },
      { property: 'og:url', content: canonicalUrl('/home') },
      { property: 'og:site_name', content: siteName },
      { property: 'og:title', content: siteName },
      { property: 'og:description', content: siteDescription },
      { property: 'og:image', content: defaultOgImageUrl },
      { property: 'og:image:width', content: '1200' },
      { property: 'og:image:height', content: '630' },
      { name: 'twitter:card', content: 'summary_large_image' },
      { name: 'twitter:title', content: siteName },
      { name: 'twitter:description', content: siteDescription },
      { name: 'twitter:creator', content: '@taskforceai' },
      { name: 'twitter:image', content: defaultOgImageUrl },
    ],
    links: [
      { rel: 'manifest', href: '/manifest.json' },
      { rel: 'icon', type: 'image/png', sizes: '32x32', href: '/favicon-32x32.png' },
      { rel: 'icon', type: 'image/png', sizes: '16x16', href: '/favicon-16x16.png' },
      { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' },
      { rel: 'shortcut icon', href: '/favicon.ico' },
    ],
  }),
  component: RootLayout,
});

function RootLayout() {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <HeadContent />
      </head>
      <body>
        <StructuredData siteUrl={CANONICAL_ORIGIN} />
        <ErrorBoundary>
          <Outlet />
        </ErrorBoundary>
        <CookieBanner />
        <Scripts />
      </body>
    </html>
  );
}
