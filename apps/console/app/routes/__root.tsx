import { HeadContent, Scripts, createRootRoute } from '@tanstack/react-router';

import appCss from '../globals.css?url';
import { ConsoleLayout } from '../components/layout/ConsoleLayout';
import { Providers } from '../lib/providers/RootProviders';

const siteName = 'TaskForceAI Console';
const siteDescription = 'Developer console for TaskForceAI - manage API keys and monitor usage.';

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: siteName },
      { name: 'description', content: siteDescription },
      { name: 'robots', content: 'noindex, nofollow' },
      { name: 'theme-color', content: '#000000' },
    ],
    links: [
      { rel: 'stylesheet', href: appCss },
      { rel: 'icon', href: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
      { rel: 'icon', href: '/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
      { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' },
      { rel: 'shortcut icon', href: '/favicon.ico' },
    ],
  }),
  component: RootLayout,
});

function RootLayout() {
  return (
    <html lang="en" className="dark">
      <head>
        <HeadContent />
      </head>
      <body className="bg-black text-slate-100">
        <Providers>
          <ConsoleLayout />
        </Providers>
        <Scripts />
      </body>
    </html>
  );
}
