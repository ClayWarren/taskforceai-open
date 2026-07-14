import { describe, expect, it } from 'bun:test';
import {
  FRONTEND_STRICT_TRANSPORT_SECURITY,
  buildFrontendContentSecurityPolicy,
  getFrontendSecurityHeaders,
} from './frontend-security-headers';

describe('frontend browser security headers', () => {
  it('restores the web CSP surface from the server middleware', () => {
    const csp = buildFrontendContentSecurityPolicy('web', { environment: 'production' });

    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain('https://js.stripe.com');
    expect(csp).toContain('https://*.taskforceai.chat');
    expect(csp).toContain('https://*.public.blob.vercel-storage.com');
    expect(csp).toContain('https://featureassets.org');
    expect(csp).toContain('https://assetsconfigcdn.org');
    expect(csp).toContain('https://prodregistryv2.org');
    expect(csp).toContain('https://beyondwickedmapping.org');
    expect(csp).toContain('https://statsigapi.net');
    expect(csp).toContain('wss://ai-gateway.vercel.sh');
    expect(csp).not.toContain('https://cloudflare-dns.com');
    expect(csp).toContain('ipc://localhost');
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain("'unsafe-inline'");
    expect(csp).not.toContain("'unsafe-eval'");
  });

  it('keeps development CSP compatible with Vite and local websocket traffic', () => {
    const csp = buildFrontendContentSecurityPolicy('web', { environment: 'development' });

    expect(csp).toContain("script-src 'self' 'unsafe-eval' 'unsafe-inline' https: blob:");
    expect(csp).toContain("connect-src 'self' https: wss: ipc://localhost");
    expect(csp).toContain("frame-src 'self' https: data:");
  });

  it('sets the shared baseline headers for production apps', () => {
    const headers = getFrontendSecurityHeaders('console', { environment: 'production' });

    expect(headers['Content-Security-Policy']).toContain("frame-ancestors 'none'");
    expect(headers['X-Frame-Options']).toBe('DENY');
    expect(headers['X-Content-Type-Options']).toBe('nosniff');
    expect(headers['X-XSS-Protection']).toBe('0');
    expect(headers['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
    expect(headers['Permissions-Policy']).toBe('camera=(), microphone=(self), geolocation=()');
    expect(headers['Strict-Transport-Security']).toBe(FRONTEND_STRICT_TRANSPORT_SECURITY);
  });

  it('preserves the status SPA Blob-backed status JSON allowlist', () => {
    const headers = getFrontendSecurityHeaders('status', { environment: 'production' });

    expect(headers['Content-Security-Policy']).toContain(
      "connect-src 'self' https://api.taskforceai.chat https://*.sentry.io https://*.public.blob.vercel-storage.com"
    );
    expect(headers['Content-Security-Policy']).toContain("script-src 'self' 'unsafe-inline'");
    expect(headers['Content-Security-Policy']).toContain("style-src 'self' 'unsafe-inline'");
  });
});
