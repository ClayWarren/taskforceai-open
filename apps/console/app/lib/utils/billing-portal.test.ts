import { beforeEach, describe, expect, it } from 'bun:test';
import {
  redactBillingUrlForLogs,
  resolveTrustedBillingInvoiceUrl,
  resolveTrustedBillingPortalUrl,
} from './billing-portal';
import '../../../../../tests/setup/dom';

describe('billing portal URL validation', () => {
  beforeEach(() => {
    window.location.href = 'http://localhost/';
  });

  it('accepts trusted Stripe billing portal URLs', () => {
    const result = resolveTrustedBillingPortalUrl('https://billing.stripe.com/p/session');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe('https://billing.stripe.com/p/session');
    }
  });

  it('accepts same-origin relative paths', () => {
    const result = resolveTrustedBillingPortalUrl('/billing/portal');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe('http://localhost/billing/portal');
    }
  });

  it('rejects javascript URLs', () => {
    const result = resolveTrustedBillingPortalUrl('javascript:alert(1)');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('invalid');
    }
  });

  it('rejects untrusted hosts', () => {
    const result = resolveTrustedBillingPortalUrl('https://attacker.example/path');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('untrusted');
    }
  });

  it('rejects untrusted invoice URLs', () => {
    const result = resolveTrustedBillingInvoiceUrl('https://evil.example/invoice');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('untrusted');
    }
  });

  it('redacts query and hash from URLs logged for diagnostics', () => {
    expect(redactBillingUrlForLogs('https://billing.stripe.com/p/session?token=secret#frag')).toBe(
      'https://billing.stripe.com/p/session'
    );
    expect(redactBillingUrlForLogs('/billing/preferences?session=secret#billing')).toBe(
      '/billing/preferences'
    );
  });

  it('handles empty or blank URLs for log redaction', () => {
    expect(redactBillingUrlForLogs('')).toBe('');
    expect(redactBillingUrlForLogs('   ')).toBe('');
  });

  it('handles parsing errors in log redaction gracefully', () => {
    // A malformed URL that throws on new URL
    const malformed = 'https://[invalid-host]/';
    expect(redactBillingUrlForLogs(malformed)).toBe(malformed);
  });

  it('rejects empty or missing URLs', () => {
    const result = resolveTrustedBillingPortalUrl('');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('invalid');
      expect(result.error.message).toContain('is missing');
    }
  });

  it('rejects insecure HTTP URLs', () => {
    const result = resolveTrustedBillingPortalUrl('http://billing.stripe.com/p/session');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('insecure');
      expect(result.error.message).toContain('must use HTTPS');
    }
  });

  it('rejects unsafe relative or non-explicit paths', () => {
    // Starts with //, which is a protocol-relative URL
    const result = resolveTrustedBillingPortalUrl('//attacker.example/billing');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('invalid');
      expect(result.error.message).toContain('absolute or root-relative');
    }

    // Relative without a leading slash
    const result2 = resolveTrustedBillingPortalUrl('billing/portal');
    expect(result2.ok).toBe(false);
    if (!result2.ok) {
      expect(result2.error.kind).toBe('invalid');
    }
  });

  it('rejects unparseable URLs during resolution', () => {
    const result = resolveTrustedBillingPortalUrl('https://[invalid-host]/');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('invalid');
      expect(result.error.message).toContain('could not be parsed');
    }
  });

  it('rejects untrusted suffixes mimicking trusted ones', () => {
    const result = resolveTrustedBillingPortalUrl('https://notstripe.com/p/session');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('untrusted');
    }

    const result2 = resolveTrustedBillingPortalUrl('https://stripe.com.evil.com/p/session');
    expect(result2.ok).toBe(false);
    if (!result2.ok) {
      expect(result2.error.kind).toBe('untrusted');
    }
  });

  it('rejects when window is undefined (SSR environment)', () => {
    const originalWindow = global.window;
    Reflect.deleteProperty(globalThis, 'window');
    try {
      const result = resolveTrustedBillingPortalUrl('https://billing.stripe.com/p/session');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe('invalid');
        expect(result.error.message).toContain('only available in browser');
      }
    } finally {
      global.window = originalWindow;
    }
  });

  it('redacts correctly in SSR environment (window undefined)', () => {
    const originalWindow = global.window;
    Reflect.deleteProperty(globalThis, 'window');
    try {
      expect(redactBillingUrlForLogs('/billing/preferences?session=secret')).toBe(
        '/billing/preferences'
      );
      expect(redactBillingUrlForLogs('https://console.taskforceai.chat/billing?secret=1')).toBe(
        '/billing'
      );
    } finally {
      global.window = originalWindow;
    }
  });
});
