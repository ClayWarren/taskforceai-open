import { describe, expect, it } from 'bun:test';

import {
  isExternalHref,
  MOBILE_IOS_APP_STORE_URL,
  resolveMobileAndroidUrl,
  resolveMobileIosUrl,
} from './mobile-links';

describe('resolveMobileIosUrl', () => {
  it('returns canonical App Store URL when value is missing', () => {
    expect(resolveMobileIosUrl(undefined)).toBe(MOBILE_IOS_APP_STORE_URL);
  });

  it('returns canonical App Store URL when value contains placeholder token', () => {
    expect(resolveMobileIosUrl('https://testflight.apple.com/join/REPLACE_WITH_CODE')).toBe(
      MOBILE_IOS_APP_STORE_URL
    );
  });

  it('returns canonical App Store URL when value points to TestFlight', () => {
    expect(resolveMobileIosUrl('https://testflight.apple.com/join/CustomCode')).toBe(
      MOBILE_IOS_APP_STORE_URL
    );
  });

  it('preserves configured App Store URL when value is valid', () => {
    expect(resolveMobileIosUrl('https://apps.apple.com/us/app/taskforceai/id6754827533')).toBe(
      'https://apps.apple.com/us/app/taskforceai/id6754827533'
    );
  });

  it('rejects unsafe configured URLs', () => {
    expect(resolveMobileIosUrl('javascript:alert(1)')).toBe(MOBILE_IOS_APP_STORE_URL);
    expect(resolveMobileIosUrl('/mobile#ios-install')).toBe(MOBILE_IOS_APP_STORE_URL);
  });
});

describe('resolveMobileAndroidUrl', () => {
  it('returns the Android install anchor when value is missing', () => {
    expect(resolveMobileAndroidUrl(undefined)).toBe('#android-install');
  });

  it('supports a route-specific fallback URL', () => {
    expect(resolveMobileAndroidUrl(undefined, '/mobile#android-install')).toBe(
      '/mobile#android-install'
    );
  });

  it('preserves safe external and internal URLs', () => {
    expect(
      resolveMobileAndroidUrl('https://play.google.com/store/apps/details?id=chat.taskforceai')
    ).toBe('https://play.google.com/store/apps/details?id=chat.taskforceai');
    expect(resolveMobileAndroidUrl('/mobile/android-beta')).toBe('/mobile/android-beta');
    expect(resolveMobileAndroidUrl('#android-install')).toBe('#android-install');
  });

  it('rejects unsafe configured URLs', () => {
    expect(resolveMobileAndroidUrl('javascript:alert(1)')).toBe('#android-install');
    expect(resolveMobileAndroidUrl('data:text/html,hello', '/mobile#android-install')).toBe(
      '/mobile#android-install'
    );
  });
});

describe('isExternalHref', () => {
  it('recognizes only safe HTTP URLs as external links', () => {
    expect(isExternalHref('https://taskforceai.chat')).toBe(true);
    expect(isExternalHref(' http://localhost:3000 ')).toBe(true);
    expect(isExternalHref('/mobile')).toBe(false);
    expect(isExternalHref('javascript:alert(1)')).toBe(false);
  });
});
