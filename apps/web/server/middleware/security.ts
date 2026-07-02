import { appendResponseHeader, eventHandler } from 'h3';
import { env } from '../../app/lib/config/env';

/**
 * Security headers middleware for TanStack Start.
 * Ported from Next.js proxy.ts.
 */
export default eventHandler((event) => {
  const isProduction = env.NODE_ENV === 'production';
  const scriptSrc = isProduction
    ? [
        "script-src 'self'",
        'https://js.stripe.com',
        'https://va.vercel-scripts.com',
        'https://vercel.live',
        'blob:',
      ].join(' ')
    : "script-src 'self' 'unsafe-eval' 'unsafe-inline' https: blob:";
  const styleSrc = isProduction ? "style-src 'self'" : "style-src 'self' 'unsafe-inline'";
  const connectSrc = isProduction
    ? [
        "connect-src 'self'",
        'https://taskforceai.chat',
        'https://*.taskforceai.chat',
        'https://api.vercel.ai',
        'https://vitals.vercel-insights.com',
        'https://*.sentry.io',
        'https://*.ingest.sentry.io',
        'https://*.public.blob.vercel-storage.com',
        'wss://*.taskforceai.chat',
        'ipc://localhost',
      ].join(' ')
    : "connect-src 'self' https: wss: ipc://localhost";
  const frameSrc = isProduction
    ? "frame-src 'self' https://js.stripe.com https://*.stripe.com"
    : "frame-src 'self' https: data:";

  // Content Security Policy
  const cspDirectives = [
    "default-src 'self'",
    scriptSrc,
    styleSrc,
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    connectSrc,
    frameSrc,
    "worker-src 'self' blob:",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ];

  appendResponseHeader(event, 'Content-Security-Policy', cspDirectives.join('; '));

  // Strict Transport Security (HSTS) - production only
  if (isProduction) {
    appendResponseHeader(
      event,
      'Strict-Transport-Security',
      'max-age=63072000; includeSubDomains; preload'
    );
  }

  // Prevent clickjacking attacks
  appendResponseHeader(event, 'X-Frame-Options', 'DENY');

  // Prevent MIME type sniffing
  appendResponseHeader(event, 'X-Content-Type-Options', 'nosniff');

  // XSS Protection (legacy but still useful for older browsers)
  appendResponseHeader(event, 'X-XSS-Protection', '0');

  // Permissions Policy - control which browser features can be used
  appendResponseHeader(event, 'Permissions-Policy', 'camera=(), microphone=(self), geolocation=()');
});
