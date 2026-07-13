import { type Result, err, ok } from '@taskforceai/client-core/result';

const TRUSTED_BILLING_HOST_SUFFIXES = ['stripe.com', 'taskforceai.chat'];

type BillingPortalUrlError = {
  kind: 'invalid' | 'untrusted' | 'insecure';
  message: string;
};

const isTrustedBillingHost = (hostname: string): boolean => {
  const normalized = hostname.trim().toLowerCase();
  return TRUSTED_BILLING_HOST_SUFFIXES.some(
    (suffix) => normalized === suffix || normalized.endsWith(`.${suffix}`)
  );
};

const isExplicitHttpUrl = (value: string): boolean => /^https?:\/\//i.test(value);

const isSafeRelativePath = (value: string): boolean => /^\/(?!\/)/.test(value);

const toLogSafeUrl = (value: string): string => {
  const rawValue = value.trim();
  if (!rawValue) {
    return '';
  }

  const fallbackBase = 'https://console.taskforceai.chat';
  const baseOrigin =
    typeof window !== 'undefined' ? window.location.origin : new URL(fallbackBase).origin;

  try {
    const parsed = new URL(rawValue, baseOrigin);
    if (parsed.origin === baseOrigin) {
      return parsed.pathname;
    }
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return rawValue.slice(0, 128);
  }
};

const resolveTrustedBillingUrl = (value: string): Result<string, BillingPortalUrlError> => {
  const rawValue = value.trim();
  if (!rawValue) {
    return err({ kind: 'invalid', message: 'Billing portal URL is missing.' });
  }

  if (typeof window === 'undefined') {
    return err({ kind: 'invalid', message: 'Billing redirect is only available in browser.' });
  }

  const isRelativePath = isSafeRelativePath(rawValue);
  if (!isRelativePath && !isExplicitHttpUrl(rawValue)) {
    return err({
      kind: 'invalid',
      message: 'Billing portal URL must be absolute or root-relative.',
    });
  }

  let parsed: URL;
  try {
    parsed = new URL(rawValue, window.location.origin);
  } catch {
    return err({ kind: 'invalid', message: 'Billing portal URL could not be parsed.' });
  }

  const isSameOrigin = parsed.origin === window.location.origin;
  if (isSameOrigin) {
    return ok(parsed.toString());
  }

  if (parsed.protocol !== 'https:') {
    return err({ kind: 'insecure', message: 'Billing portal URL must use HTTPS.' });
  }

  if (!isTrustedBillingHost(parsed.hostname)) {
    return err({ kind: 'untrusted', message: 'Billing portal URL host is not trusted.' });
  }

  return ok(parsed.toString());
};

export const resolveTrustedBillingPortalUrl = (
  value: string
): Result<string, BillingPortalUrlError> => resolveTrustedBillingUrl(value);

export const resolveTrustedBillingInvoiceUrl = (
  value: string
): Result<string, BillingPortalUrlError> => resolveTrustedBillingUrl(value);

export const redactBillingUrlForLogs = (value: string): string => toLogSafeUrl(value);
