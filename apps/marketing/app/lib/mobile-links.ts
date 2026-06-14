export const MOBILE_IOS_TESTFLIGHT_URL = 'https://testflight.apple.com/join/NamSXhUZ';

const TESTFLIGHT_PLACEHOLDER_TOKEN = 'REPLACE_WITH_CODE';
const ANDROID_INSTALL_FALLBACK_URL = '#android-install';

function isSafeHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

function isSafeInternalHref(url: string): boolean {
  return url.startsWith('/') || url.startsWith('#');
}

export function resolveMobileIosUrl(candidateUrl: string | undefined): string {
  const normalizedUrl = candidateUrl?.trim();
  if (
    !normalizedUrl ||
    normalizedUrl === '' ||
    normalizedUrl.includes(TESTFLIGHT_PLACEHOLDER_TOKEN) ||
    !isSafeHttpUrl(normalizedUrl)
  ) {
    return MOBILE_IOS_TESTFLIGHT_URL;
  }
  return normalizedUrl;
}

export function resolveMobileAndroidUrl(
  candidateUrl: string | undefined,
  fallbackUrl = ANDROID_INSTALL_FALLBACK_URL
): string {
  const normalizedUrl = candidateUrl?.trim();
  if (!normalizedUrl || normalizedUrl === '') {
    return fallbackUrl;
  }
  if (!isSafeHttpUrl(normalizedUrl) && !isSafeInternalHref(normalizedUrl)) {
    return fallbackUrl;
  }
  return normalizedUrl;
}

export function isExternalHref(href: string): boolean {
  return isSafeHttpUrl(href.trim());
}
