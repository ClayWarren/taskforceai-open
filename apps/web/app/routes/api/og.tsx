import '@tanstack/react-start';
import { createFileRoute } from '@tanstack/react-router';

import { handleOgImageRequest } from './-og-handler';

/**
 * OG Image API Route
 *
 * Generates Open Graph images for social media sharing.
 * Falls back to static icon if @vercel/og is unavailable.
 */
export const Route = createFileRoute('/api/og')({
  server: {
    handlers: {
      GET: async ({ request }) => handleOgImageRequest(request),
    },
  },
});
